#!/usr/bin/env node
/* Этап 9: проверка сборки по чек-листу Stake Engine (ID из static/mockchecklist.json репозитория StakeEngine/docs)
 * на макете RGS, который отдаёт НАСТОЯЩИЕ книги из выгрузки math/stake (books_*.jsonl.zst).
 *   node tools/qa_stage9.mjs [--stake math/stake] [--build build] [--shots shots/qa] [--only cur,wins,refresh,resume,replay,ui,rules,popout] [--wins 10]
 *
 *   cur      USD EUR CAD MXN JPY XSC XGC: уровни ставок (59, 63, 191), мин/макс/по умолчанию, формат баланса/ставки/выигрыша,
 *            Social Mode — запрещённые слова в тексте, aria-label и правилах (77, 78)
 *   wins     по N выигрышей в каждом режиме: выигрыш на экране = выплата книги, баланс = ответ RGS (43)
 *   refresh  перезагрузка посреди вращения: выигрышный раунд — ставка раунда (187), проигрышный — defaultBetLevel (242)
 *   resume   незавершённый раунд: end-round оборван, после перезагрузки раунд показан и закрыт, ставка из раунда
 *   replay   повтор книги по ссылке: карточка с ценой, параметры currency/lang/amount, Replay again, Social (171–174, 188)
 *   ui       пробел (44), автоигра с подтверждением (104), покупка с подтверждением (31), звук (107), rgs_url (66)
 *   rules    экран правил: выплаты, линии, RTP и max win по режимам, цены, фриспины, дисклеймер (24–27, 29, 185)
 *   popout   мини-плеер Stake и малые экраны (195): геометрия, прокрутка
 * Везде: ошибки и предупреждения консоли, любые запросы не к макету (внешние хосты). Итог — shots/qa/qa_stage9.json.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import readline from 'node:readline';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const req = n => { try { return require(n); } catch { return require('/opt/npm-tools/node_modules/' + n); } };
const { chromium } = req('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAKE = path.resolve(arg('stake', path.join(ROOT, 'math/stake'))), BUILD = path.resolve(arg('build', path.join(ROOT, 'build')));
const SHOTS = path.resolve(arg('shots', path.join(ROOT, 'shots/qa')));
const ALL = ['cur', 'wins', 'refresh', 'resume', 'replay', 'ui', 'rules', 'popout'];
const ONLY = arg('only') ? arg('only').split(',') : ALL;
const NWINS = Number(arg('wins', 10));
const U = 1000000;
const index = JSON.parse(fs.readFileSync(path.join(STAKE, 'index.json'), 'utf8'));
const MODES = Object.fromEntries(index.modes.map(m => [m.name, m]));
const R = {};                                   // результаты по разделам: { ok, notes[], problems[] }
let cur = null;
const sec = name => (cur = R[name] = { problems: [], notes: [] });
const bad = msg => cur.problems.push(msg), note = msg => cur.notes.push(msg);

/* ---------- книги ---------- */
const has = (b, t) => b.events.some(e => e.type === t);
async function readBooks(name, want) {
  const out = Object.fromEntries(Object.keys(want).map(k => [k, []]));
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(STAKE, MODES[name].events)).pipe(zlib.createZstdDecompress()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const b = JSON.parse(line);
    for (const [k, [n, fn]] of Object.entries(want)) if (out[k].length < n && fn(b)) { out[k].push(b); break; }
    if (Object.entries(want).every(([k, [n]]) => out[k].length >= n)) break;
  }
  rl.close();
  return out;
}
const fsTot = b => (b.events.find(e => e.type === 'freeSpinTrigger') || {}).totalFs || 0;
const BOOKS = {};
for (const name of Object.keys(MODES)) {
  const buyMode = name === 'bonus' || name === 'super';
  BOOKS[name] = await readBooks(name, buyMode
    ? { win: [NWINS, b => b.payoutMultiplier > 0 && !has(b, 'wincap') && fsTot(b) <= 10 && !has(b, 'retrigger')], zero: [1, b => b.payoutMultiplier === 0] }
    : { line: [NWINS - 3, b => b.payoutMultiplier > 0 && !has(b, 'freeSpinTrigger')], bonus: [3, b => b.payoutMultiplier > 0 && fsTot(b) === 8 && !has(b, 'retrigger') && !has(b, 'wincap')],
      zero: [3, b => b.payoutMultiplier === 0], small: [3, b => b.payoutMultiplier > 0 && b.payoutMultiplier <= 200 && !has(b, 'freeSpinTrigger')] });
}
const winsOf = name => name === 'bonus' || name === 'super' ? BOOKS[name].win : [...BOOKS[name].line, ...BOOKS[name].bonus];

/* ---------- макет RGS ---------- */
// Уровни ставок — как в шаблонах Stake из чек-листа: USD $0.10–$1,000 (по умолч. $1), JPY ¥10–¥150,000 (¥100), MXN 1–15,000 (10)
const ladder = (k) => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100, 120, 160, 200, 240, 300, 400, 500, 600, 800, 1000].map(v => Math.round(v * k * U));
const CUR = {
  USD: { levels: ladder(1), def: 1 * U, bal: 5000 * U },
  EUR: { levels: ladder(1), def: 1 * U, bal: 5000 * U },
  CAD: { levels: ladder(1), def: 1 * U, bal: 5000 * U },
  MXN: { levels: ladder(10).filter(v => v >= U && v <= 15000 * U).concat([15000 * U]), def: 10 * U, bal: 100000 * U },
  JPY: { levels: ladder(150).map(v => Math.round(v / U / 10) * 10 * U).filter((v, i, a) => v >= 10 * U && a.indexOf(v) === i), def: 100 * U, bal: 1000000 * U },
  XSC: { levels: ladder(1), def: 1 * U, bal: 5000 * U, social: true },
  XGC: { levels: ladder(100), def: 100 * U, bal: 500000 * U, social: true }
};
CUR.JPY.levels = [10, 20, 30, 40, 50, 60, 80, 100, 120, 160, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 5000, 10000, 20000, 50000, 100000, 150000].map(v => v * U);
const sessions = new Map(), allReq = [];
function session(id) {
  if (sessions.has(id)) return sessions.get(id);
  const [kind, c] = String(id).split(':'), cfg = CUR[c] || CUR.USD;
  const s = { id, kind, currency: CUR[c] ? c : 'USD', balance: cfg.bal, pending: 0, active: null, next: [], log: [], holdPlay: false,
    config: { minBet: cfg.levels[0], maxBet: cfg.levels[cfg.levels.length - 1], stepBet: 10000, defaultBetLevel: cfg.def, betLevels: cfg.levels.slice(),
      jurisdiction: { socialCasino: !!cfg.social } } };
  sessions.set(id, s); return s;
}
let replayBook = null;
function rgsReply(method, p, body) {
  if (method === 'GET' && p.startsWith('/bet/replay/')) {
    const [game, version, mode, event] = p.slice(12).split('/').map(decodeURIComponent);
    session('replay').log.push([p, null]);
    const m = MODES[String(mode).toLowerCase()];
    if (!m) return [404, { error: 'ERR_VAL', message: 'unknown mode ' + mode }];
    const b = replayBook && String(replayBook.id) === event ? replayBook : null;
    if (!b) return [404, { error: 'NOT_FOUND' }];
    return [200, { payoutMultiplier: b.payoutMultiplier / 100, costMultiplier: m.cost, state: b.events, _seen: { game, version, mode } }];
  }
  if (method !== 'POST') return [405, { error: 'ERR_VAL' }];
  const s = session(body.sessionID); s.log.push([p, body]);
  const bal = () => ({ amount: s.balance, currency: s.currency });
  if (p === '/wallet/authenticate') return [200, { balance: bal(), config: s.config, round: s.active }];
  if (p === '/wallet/play') {
    const m = MODES[String(body.mode).toLowerCase()];
    if (!m || !Number.isInteger(body.amount)) return [400, { error: 'ERR_VAL' }];
    if (!s.config.betLevels.includes(body.amount)) return [400, { error: 'ERR_VAL', message: 'amount not in betLevels' }];
    const cost = Math.round(body.amount * m.cost);
    if (cost > s.balance) return [400, { error: 'ERR_IPB' }];
    const b = s.next.shift() || BOOKS[String(body.mode).toLowerCase()].zero[0];
    s.balance -= cost; s.pending = Math.round(body.amount * b.payoutMultiplier / 100);
    const round = { betID: b.id, amount: body.amount, payout: s.pending, payoutMultiplier: b.payoutMultiplier / 100, active: s.pending > 0, mode: body.mode, event: String(b.id), state: b.events };
    s.active = round.active ? round : null; s.lastBook = b;
    return [200, { balance: bal(), round }];
  }
  if (p === '/wallet/end-round') {
    if (s.dropEnd) { s.dropEnd = false; return null; }      // обрыв: ответа нет, раунд остаётся открытым
    s.balance += s.pending; s.pending = 0; s.active = null; return [200, { balance: bal() }];
  }
  return [404, { error: 'ERR_VAL' }];
}
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.js': 'text/javascript', '.webm': 'video/webm', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.startsWith('/rgs/')) {
    let raw = ''; rq.on('data', d => { raw += d; }); rq.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch { /* пусто */ }
      const r = rgsReply(rq.method, rq.url.split('?')[0].slice(4), body);
      if (!r) { rs.destroy(); return; }
      rs.writeHead(r[0], { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); rs.end(JSON.stringify(r[1]));
    });
    return;
  }
  const f = path.join(BUILD, p === '/' ? 'index.html' : p);
  if (!f.startsWith(BUILD) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); rs.end('not found'); return; }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rs);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const HOST = '127.0.0.1:' + server.address().port, base = 'http://' + HOST + '/';
// rgs_url без схемы и на отдельном пути: игра должна сама дописать https://… — поэтому в тестах передаём полный http-адрес макета
const live = (sid, extra = '') => `?sessionID=${encodeURIComponent(sid)}&lang=en&device=desktop&rgs_url=${encodeURIComponent(base + 'rgs')}${extra}`;

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
async function open(w, h, query, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'en-US' }, opts.context || {}));
  const page = await ctx.newPage(), errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { if (opts.allow && opts.allow.test(m.text())) return; errs.push(`[${m.type()}] ${m.text()}`); } });
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('request', r => { const u = new URL(r.url()); allReq.push(r.url()); if (!/^(data|blob):/.test(r.url()) && u.host !== HOST) errs.push('[внешний запрос] ' + r.url()); });
  page.on('response', r => { if (r.status() >= 400 && !(opts.allow && opts.allow.test(r.url()))) errs.push(`[${r.status()}] ${r.url()}`); });
  await page.goto(base + query + (query.includes('?') ? '&' : '?') + 'intro=0');
  if (opts.enter !== false) await enter(page);
  return { ctx, page, errs };
}
const enter = async page => {
  await page.waitForFunction(() => document.getElementById('loader').classList.contains('ready'), null, { timeout: 30000 });
  await page.click('#loader');
  await page.waitForFunction(() => window.__game && window.__game.ready && document.getElementById('loader').hidden, null, { timeout: 30000 });
};
const state = page => page.evaluate(() => window.__game.state);
const idle = (page, ms = 600000) => page.waitForFunction(() => !window.__game.busy, null, { timeout: ms });
const started = page => page.waitForFunction(() => window.__game.busy, null, { timeout: 8000 });
const txt = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/[\u00a0\u202f]/g, ' ').trim() : null; }, sel);
const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
const done = (errs) => { for (const e of errs) bad('консоль/сеть: ' + e); errs.length = 0; };
const run = async (name, fn) => {
  if (!ONLY.includes(name)) return; sec(name); const t0 = Date.now();
  try { await fn(); } catch (e) { bad('тест прервался: ' + String(e.message).split('\n')[0]); for (const c of browser.contexts()) await c.close().catch(() => {}); }
  console.log(`— ${name}: ${((Date.now() - t0) / 1000).toFixed(0)} c, проблем ${R[name].problems.length}`);
};
const fmtNum = (v, min, max) => v.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
// как деньги должны выглядеть: знак и число знаков по Intl, социальные — число и SC/GC
function expectMoney(c, amount, win) {
  const v = amount / U, soc = { XSC: 'SC', XGC: 'GC' }[c];
  if (soc) return fmtNum(v, 2, win ? 4 : 2) + ' ' + soc;
  const d = new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits;
  const sym = { USD: '$', EUR: '€', CAD: 'CA$', MXN: 'MX$', JPY: '¥' }[c];
  return sym + fmtNum(v, d, win ? Math.max(d, 4) : d);
}
const SOCIAL_BAD = /\b(bet|bets|betting|total bet|stake|stakes|buy|buys|bought|purchase|purchased|purchases|bonus buy|pay|pays|paid|payout|payouts|paytable|pay table|money|cash|credit|credits|fund|funds|currency|deposit|withdraw|gamble|gambling|wager|wagers|rebet|casino)\b/i;
const socialScan = page => page.evaluate(() => {
  const parts = [document.body.innerText];
  document.querySelectorAll('[aria-label],[title],img[alt]').forEach(e => parts.push(e.getAttribute('aria-label') || '', e.getAttribute('title') || '', e.getAttribute('alt') || ''));
  parts.push(document.title);
  return parts.join('\n');
});
const socialHits = text => { const out = new Set(); const re = new RegExp(SOCIAL_BAD.source, 'gi'); let m; while ((m = re.exec(text))) out.add(m[0].toLowerCase()); return [...out]; };
async function playBook(page, s, book, mode) {
  s.next.push(book);
  const before = await state(page);
  if (mode === 'bonus' || mode === 'super') await page.evaluate(m => { window.__game.spin(m); }, mode.toUpperCase()); else await page.keyboard.press('Space');
  await started(page); await idle(page); await page.waitForTimeout(200);
  const st = await state(page), sent = s.log.filter(x => x[0] === '/wallet/play').pop()[1];
  return { before, st, sent, win: Math.round(sent.amount * book.payoutMultiplier / 100), cost: Math.round(sent.amount * MODES[mode].cost) };
}

/* ================= cur ================= */
await run('cur', async () => {
  for (const c of Object.keys(CUR)) {
    const sid = 'cur:' + c, s = session(sid), cfg = s.config;
    const { ctx, page, errs } = await open(1280, 720, live(sid, `&currency=${c}` + (CUR[c].social ? '&social=true' : '')));
    let st = await state(page);
    if (st.currency !== c) bad(`${c}: валюта игры ${st.currency}`);
    if (JSON.stringify(st.betLevels) !== JSON.stringify(cfg.betLevels)) bad(`${c}: уровни ставок игры ${st.betLevels.length} шт. не совпадают с betLevels RGS (${cfg.betLevels.length})`);
    if (st.bet !== cfg.defaultBetLevel) bad(`${c}: ставка по умолчанию ${st.bet / U}, в конфиге ${cfg.defaultBetLevel / U}`);
    const bal = await txt(page, '#balanceVal'), betT = await txt(page, '#betVal');
    if (bal !== expectMoney(c, s.balance)) bad(`${c}: баланс «${bal}», ожидалось «${expectMoney(c, s.balance)}»`);
    if (!betT || !betT.includes(expectMoney(c, cfg.defaultBetLevel))) bad(`${c}: ставка «${betT}», ожидалось «${expectMoney(c, cfg.defaultBetLevel)}»`);
    // минимум и максимум достижимы кнопками
    for (let i = 0; i < 60 && !(await page.isDisabled('#btnBetDown')); i++) await page.click('#btnBetDown');
    const minT = await txt(page, '#betVal'); st = await state(page);
    if (st.bet !== cfg.minBet) bad(`${c}: минимальная ставка кнопкой «−» ${st.bet / U}, в конфиге ${cfg.minBet / U}`);
    for (let i = 0; i < 60 && !(await page.isDisabled('#btnBetUp')); i++) await page.click('#btnBetUp');
    const maxT = await txt(page, '#betVal'); st = await state(page);
    if (st.bet !== cfg.maxBet) bad(`${c}: максимальная ставка кнопкой «+» ${st.bet / U}, в конфиге ${cfg.maxBet / U}`);
    // окно выбора ставки: все уровни
    await page.click('#btnBet'); await page.waitForTimeout(150);
    const pills = await page.evaluate(() => document.querySelectorAll('#betPills button').length);
    if (pills !== cfg.betLevels.length) bad(`${c}: в окне ставок ${pills} кнопок, уровней ${cfg.betLevels.length}`);
    const wrap = await page.evaluate(() => Array.from(document.querySelectorAll('#betPills button')).filter(e => e.scrollWidth > e.clientWidth + 1 || e.getClientRects().length && e.getBoundingClientRect().height > 2.2 * parseFloat(getComputedStyle(e).fontSize) + 12).map(e => e.textContent));
    if (wrap.length) bad(`${c}: в окне ставок суммы не помещаются в кнопки: ${wrap.slice(0, 3).join(', ')}`);
    await shot(page, `cur_${c}_betmenu`); await page.keyboard.press('Escape');
    // выигрыш из книги — формат и сумма
    await page.evaluate(() => { const b = document.getElementById('btnTurbo'); if (!window.__game.state.turbo) b.click(); });
    for (let i = 0; i < 60 && !(await page.isDisabled('#btnBetDown')); i++) await page.click('#btnBetDown');
    for (let i = 0; i < 7; i++) await page.click('#btnBetUp');   // $1 / ¥100 / MX$10 — по умолчанию в шаблонах
    const bk = BOOKS.base.small[0], r = await playBook(page, s, bk, 'base');
    const winT = await txt(page, '#winVal');
    if (r.st.win !== r.win) bad(`${c}: выигрыш ${r.st.win / U}, в книге ${r.win / U}`);
    if (winT !== expectMoney(c, r.win, true)) bad(`${c}: выигрыш «${winT}», ожидалось «${expectMoney(c, r.win, true)}»`);
    if (r.st.balance !== s.balance) bad(`${c}: баланс ${r.st.balance / U}, у RGS ${s.balance / U}`);
    await shot(page, `cur_${c}_win`);
    note(`${c}: баланс ${bal}; ставки ${minT} … ${maxT}, по умолч. ${betT}; выигрыш книги ${bk.id} (${bk.payoutMultiplier / 100}×) → ${winT}`);
    if (CUR[c].social) {
      let text = await socialScan(page);
      await page.click('#btnMenu'); await page.click('#btnInfo'); await page.waitForTimeout(300); text += '\n' + await socialScan(page); await page.keyboard.press('Escape');
      await page.click('#btnBonus'); await page.waitForTimeout(200); text += '\n' + await socialScan(page);
      await page.click('#buySUPER'); await page.waitForTimeout(150); text += '\n' + await socialScan(page); await page.keyboard.press('Escape');
      await page.click('#btnAuto'); await page.waitForTimeout(150); text += '\n' + await socialScan(page); await page.keyboard.press('Escape');
      await page.click('#btnMenu'); await page.click('#btnSettings'); await page.waitForTimeout(150); text += '\n' + await socialScan(page); await page.keyboard.press('Escape');
      const hits = socialHits(text);
      if (hits.length) bad(`${c}: запрещённые в Social слова: ${hits.join(', ')}`);
      if (/\$|€|USD/.test(await txt(page, '#balanceVal'))) bad(`${c}: в балансе знак фиатной валюты`);
      note(`${c}: Social — проверено ${text.length} символов текста (экран, правила, бонус-меню, покупка, автоигра, настройки, aria-label), запрещённых слов: ${hits.length}`);
    }
    done(errs); await ctx.close();
  }
});

/* ================= wins ================= */
await run('wins', async () => {
  const sid = 'wins:USD', s = session(sid);
  const { ctx, page, errs } = await open(1280, 720, live(sid));
  await page.click('#btnTurbo');
  for (const mode of ['base', 'ante', 'bonus', 'super']) {
    if (mode === 'ante') { await page.click('#btnBonus'); await page.click('#anteToggle'); await page.click('#bonusClose'); }
    if (mode === 'bonus') await page.click('#btnBonus');   // анте выключить (кнопка Deactivate)
    let n = 0;
    for (const bk of winsOf(mode)) {
      const r = await playBook(page, s, bk, mode);
      if (String(r.sent.mode).toLowerCase() !== mode) bad(`${mode}: игра отправила mode=${r.sent.mode}`);
      if (r.st.win !== r.win) bad(`${mode} книга ${bk.id}: на экране ${r.st.win / U}, выплата ${r.win / U}`);
      if (r.st.balance !== s.balance || r.st.balance !== r.before.balance - r.cost + r.win) bad(`${mode} книга ${bk.id}: баланс ${r.st.balance / U}, RGS ${s.balance / U}`);
      if (r.st.fs || r.st.sticky) bad(`${mode} книга ${bk.id}: после раунда остались фриспины`);
      n++;
    }
    note(`${mode}: ${n} выигрышных книг, mode в play = «${s.log.filter(x => x[0] === '/wallet/play').pop()[1].mode}», выигрыш на экране = выплате книги, баланс = ответу RGS`);
    await shot(page, `wins_${mode}`);
  }
  const ends = s.log.filter(x => x[0] === '/wallet/end-round').length, wins = s.log.filter(x => x[0] === '/wallet/play').length;
  note(`play: ${wins}, end-round: ${ends} (все раунды выигрышные)`);
  // проигрыш — end-round не вызывается
  const e0 = ends; await page.click('#btnBonus').catch(() => {}); await page.keyboard.press('Escape');
  await playBook(page, s, BOOKS.base.zero[0], 'base');
  if (s.log.filter(x => x[0] === '/wallet/end-round').length !== e0) bad('end-round вызван после проигрыша'); else note('проигрыш: end-round не вызван');
  done(errs); await ctx.close();
});

/* ================= refresh (187) ================= */
await run('refresh', async () => {
  for (const kind of ['zero', 'win']) {
    const sid = 'refresh-' + kind + ':USD', s = session(sid);
    let { ctx, page, errs } = await open(1280, 720, live(sid));
    for (let i = 0; i < 5; i++) await page.click('#btnBetUp');
    const want = (await state(page)).bet;
    s.next.push(kind === 'zero' ? BOOKS.base.zero[1] : BOOKS.base.bonus[0]);
    await page.keyboard.press('Space'); await started(page); await page.waitForTimeout(400);
    await page.reload(); await enter(page);
    if (kind === 'win') await idle(page);
    const st = await state(page);
    // 0x-раунд RGS закрывает сам — активного раунда нет, ставка = defaultBetLevel; выигрышный остаётся открытым — ставка раунда
    const exp = kind === 'zero' ? s.config.defaultBetLevel : want;
    if (st.bet !== exp) bad(`${kind}: после перезагрузки посреди вращения ставка ${st.bet / U}, ожидалась ${exp / U}`);
    else note(`${kind === 'zero' ? 'проигрышный' : 'выигрышный'} раунд: после перезагрузки посреди вращения ставка ${st.bet / U} (выбрана ${want / U}, по умолчанию ${s.config.defaultBetLevel / U})`);
    done(errs); await ctx.close();
  }
});

/* ================= resume ================= */
await run('resume', async () => {
  const sid = 'resume:USD', s = session(sid);
  let { ctx, page, errs } = await open(1280, 720, live(sid), { allow: /end-round|Failed to fetch|ERR_EMPTY|NetworkError|net::/ });
  await page.click('#btnTurbo');
  for (let i = 0; i < 3; i++) await page.click('#btnBetUp');
  const bk = BOOKS.base.line[0], bet = (await state(page)).bet;
  s.next.push(bk);
  // обрыв связи на end-round: запрос до макета не доходит, раунд у RGS остаётся открытым
  await page.route('**/wallet/end-round', r => r.abort('connectionreset'));
  await page.keyboard.press('Space'); await started(page); await idle(page);
  await page.unroute('**/wallet/end-round');
  if (!s.active) bad('после обрыва end-round раунд у RGS закрыт — сценарий не воспроизвёлся');
  // новая сессия с другой ставкой по умолчанию: ставка должна прийти из раунда
  await page.evaluate(() => localStorage.clear());
  const before = s.balance;
  await page.reload(); await enter(page); await idle(page); await page.waitForTimeout(300);
  const st = await state(page), win = Math.round(bet * bk.payoutMultiplier / 100);
  const ends = s.log.filter(x => x[0] === '/wallet/end-round').length;
  if (s.active) bad('после перезагрузки незавершённый раунд не закрыт (end-round не вызван)');
  if (st.bet !== bet) bad(`ставка после восстановления ${st.bet / U}, в раунде ${bet / U}`);
  if (st.win !== win) bad(`выигрыш после восстановления ${st.win / U}, в раунде ${win / U}`);
  if (st.balance !== before + win || st.balance !== s.balance) bad(`баланс после восстановления ${st.balance / U}, RGS ${s.balance / U}`);
  await shot(page, 'resume_after');
  note(`end-round оборван, перезагрузка: раунд книги ${bk.id} показан, выигрыш ${st.win / U}, end-round вызван (всего ${ends}), ставка ${st.bet / U} из раунда, баланс = RGS`);
  errs.length = 0;   // ожидаемая ошибка сети от оборванного end-round
  await ctx.close();
});

/* ================= replay (171–174, 188) ================= */
await run('replay', async () => {
  const cases = [
    { mode: 'base', book: BOOKS.base.bonus[0], cur: 'USD', lang: 'en', amount: 2 * U },
    { mode: 'super', book: BOOKS.super.win[0], cur: 'EUR', lang: 'de', amount: 1 * U },
    { mode: 'ante', book: BOOKS.ante.line[0], cur: 'JPY', lang: 'ja', amount: 100 * U },
    { mode: 'bonus', book: BOOKS.bonus.win[0], cur: 'XSC', lang: 'en', amount: 1 * U, social: true }
  ];
  for (const c of cases) {
    replayBook = c.book; const before = session('replay').log.length;
    const q = `?replay=true&game=senbazuru&version=1&mode=${c.mode}&event=${c.book.id}&rgs_url=${encodeURIComponent(base + 'rgs')}&currency=${c.cur}&lang=${c.lang}&amount=${c.amount}` + (c.social ? '&social=true' : '');
    const { ctx, page, errs } = await open(c.mode === 'base' ? 400 : 1280, c.mode === 'base' ? 225 : 720, q);
    const card = await page.evaluate(() => Object.fromEntries(['rMode', 'rBase', 'rCostM', 'rCost', 'rPayM', 'rWin'].map(id => [id, document.getElementById(id).textContent.replace(/[\u00a0\u202f]/g, ' ').trim()])));
    const st = await state(page), cost = Math.round(c.amount * MODES[c.mode].cost), win = Math.round(c.amount * c.book.payoutMultiplier / 100);
    const path0 = session('replay').log[before] && session('replay').log[before][0];
    if (st.lang !== (c.social ? 'en' : c.lang)) bad(`${c.mode}: язык ${st.lang}, ожидался ${c.lang}`);
    if (st.currency !== c.cur) bad(`${c.mode}: валюта ${st.currency}`);
    if (card.rBase !== expectMoney(c.cur, c.amount)) bad(`${c.mode}: базовая ставка «${card.rBase}», ожидалось «${expectMoney(c.cur, c.amount)}»`);
    if (card.rCost !== expectMoney(c.cur, cost)) bad(`${c.mode}: реальная цена «${card.rCost}», ожидалось «${expectMoney(c.cur, cost)}»`);
    if (!card.rCostM.includes(String(MODES[c.mode].cost).replace('.0', ''))) bad(`${c.mode}: множитель цены «${card.rCostM}»`);
    const wallet = sessions.size && [...sessions.values()].some(s => s.id === undefined);
    await shot(page, `replay_${c.mode}_card`);
    await page.click('#btnReplay'); await started(page); await idle(page); await page.waitForTimeout(1300);
    const st2 = await state(page);
    if (st2.win !== win) bad(`${c.mode}: выигрыш в повторе ${st2.win / U}, книга ${win / U}`);
    const again = await txt(page, '#btnReplay'), cardShown = await page.evaluate(() => !document.getElementById('replayCard').hidden);
    if (!cardShown) bad(`${c.mode}: после повтора нет карточки с кнопкой повтора`);
    await page.click('#btnReplay'); await started(page); await idle(page);
    const ctl = await page.evaluate(() => ['btnSpin', 'btnAuto', 'btnBonus', 'btnBetUp', 'btnBetDown', 'btnBet'].filter(id => { const e = document.getElementById(id); return e && e.offsetParent && !e.disabled && getComputedStyle(e).visibility !== 'hidden'; }));
    if (ctl.length) bad(`${c.mode}: в повторе доступны кнопки ставок: ${ctl.join(', ')}`);
    if (c.social) { const hits = socialHits(await socialScan(page)); if (hits.length) bad(`повтор Social: запрещённые слова ${hits.join(', ')}`); else note('повтор Social (XSC): запрещённых слов нет (188)'); }
    note(`${c.mode} ${c.cur}/${c.lang}: запрос ${path0}; карточка: ${card.rMode} · ставка ${card.rBase} · цена ${card.rCostM} = ${card.rCost} · итог ${card.rPayM} = ${card.rWin}; повтор сыгран дважды, кнопка «${again}»`);
    done(errs); await ctx.close();
  }
  const wl = [...sessions.values()].filter(s => s.id === 'replay').flatMap(s => s.log).filter(x => x[0].startsWith('/wallet/'));
  if (wl.length) bad('в повторе вызывались методы кошелька'); else note('в повторе вызовов кошелька нет');
  // ошибка загрузки — без кнопки Start
  replayBook = null;
  const { ctx, page, errs } = await open(1280, 720, `?replay=true&game=senbazuru&version=1&mode=base&event=999999999&rgs_url=${encodeURIComponent(base + 'rgs')}`, { allow: /404|replay|Failed|Error/ });
  const dis = await page.isDisabled('#btnReplay'), msg = await txt(page, '#rMsg');
  if (!dis) bad('повтор несуществующей книги: кнопка Start доступна'); else note(`несуществующая книга: «${msg}», Start недоступен`);
  errs.length = 0; await ctx.close();
});

/* ================= ui (31, 44, 66, 104, 107) ================= */
await run('ui', async () => {
  const sid = 'ui:USD', s = session(sid);
  const { ctx, page, errs } = await open(1280, 720, live(sid));
  const plays = () => s.log.filter(x => x[0] === '/wallet/play').length;
  // 66: первые запросы ушли на rgs_url
  const auth = allReq.find(u => u.includes('/wallet/authenticate'));
  if (!auth || !auth.startsWith(base + 'rgs/')) bad('authenticate не на rgs_url: ' + auth); else note('authenticate → ' + auth.replace(base, '{rgs_url}/').replace('{rgs_url}/rgs/', '{rgs_url}/'));
  // 44: пробел = спин, в том числе после клика по другой кнопке
  await page.click('#btnTurbo'); s.next.push(BOOKS.base.zero[0]);
  let p0 = plays(); await page.keyboard.press('Space'); await started(page); await idle(page);
  if (plays() !== p0 + 1) bad('пробел не запустил вращение'); else note('пробел после клика по Turbo запускает вращение (play отправлен)');
  // 104: автоигра — сначала окно, без play
  p0 = plays(); await page.click('#btnAuto'); await page.waitForTimeout(250);
  const autoOpen = await page.evaluate(() => !document.getElementById('autoModal').hidden);
  if (!autoOpen || plays() !== p0) bad('автоигра стартовала одним кликом'); else note('автоигра: клик открывает окно настроек, play не отправлен до «Start»');
  await shot(page, 'ui_auto'); await page.click('#autoCancel');
  // 31: покупка 100× и 300× — с подтверждением цены
  for (const m of ['BONUS', 'SUPER']) {
    p0 = plays(); await page.click('#btnBonus'); await page.click('#buy' + m); await page.waitForTimeout(200);
    const conf = await page.evaluate(() => !document.getElementById('bonusConfirm').hidden), price = await txt(page, '#buyConfirm');
    if (!conf || plays() !== p0) bad(`${m}: покупка без подтверждения`); else note(`${m} ${MODES[m.toLowerCase()].cost}×: после выбора — подтверждение «${price}», play не отправлен`);
    if (m === 'SUPER') await shot(page, 'ui_buy_confirm');
    await page.click('#buyCancel'); await page.click('#bonusClose');
  }
  // ante 1.25× — переключатель, цена в поле ставки
  await page.click('#btnBonus'); await page.click('#anteToggle'); await page.click('#bonusClose');
  const betT = await txt(page, '#betVal'); note(`ANTE 1.25× (< 2×): переключатель, поле ставки «${betT}»`);
  await page.click('#btnBonus');
  // 107: звук
  await page.click('#btnMenu'); const s0 = (await state(page)).sound; await page.click('#btnSound'); const s1 = (await state(page)).sound;
  if (s0 === s1) bad('кнопка звука не переключает звук'); else note(`кнопка звука в меню: звук ${s0 ? 'вкл' : 'выкл'} → ${s1 ? 'вкл' : 'выкл'}; в настройках — отдельно музыка и эффекты`);
  await page.click('#btnSound');
  done(errs); await ctx.close();
});

/* ================= rules (24–27, 29, 185) ================= */
await run('rules', async () => {
  const sid = 'rules:USD';
  const { ctx, page, errs } = await open(1280, 720, live(sid));
  await page.click('#btnMenu'); await page.click('#btnInfo'); await page.waitForTimeout(400);
  const text = await page.evaluate(() => document.getElementById('infoSheet').innerText.replace(/\s+/g, ' '));
  const need = {
    '24 выплаты символов': [0.2, 0.6, 2.5, 0.3, 1, 4, 0.6, 2, 8, 1, 4, 15, 2, 8, 40, 5, 25, 150].map(v => new RegExp('×' + String(v).replace('.', '\\.') + '\\b')),
    '26 линии и правила выигрыша': [/one line on each row/, /from left to right, starting on the first reel/, /Only the highest win on each line counts/],
    '25 RTP по режимам': [/96\.00%/],
    '25 max win': [/15,000×/],
    '27 цены режимов': [/100×/, /300×/, /1\.25×/],
    '29 фриспины': [/3 8 4 10 5 12/, /3 \+5 4 \+5 5 \+5/, /at most 40 free spins/],
    '185 дисклеймер': [/Malfunction voids all wins and plays/, /reload the game to finish any uncompleted rounds/, /Remote Game Server/, /TM and © \d{4}/]
  };
  for (const [k, res] of Object.entries(need)) for (const re of res) if (!re.test(text)) bad(`${k}: в правилах нет ${re}`);
  const rtpCount = (text.match(/96\.00%/g) || []).length;
  note(`правила: ${text.length} символов; «96.00%» встречается ${rtpCount} раз; дисклеймер: «${(text.match(/Malfunction[^.]*\./) || [''])[0]} … ${(text.match(/TM and ©[^.]*\./) || [''])[0]}»`);
  const sections = await page.evaluate(() => Array.from(document.querySelectorAll('#infoSheet h2, #infoSheet h3')).map(h => h.textContent.trim()));
  note('разделы: ' + sections.join(' · '));
  await shot(page, 'rules_top');
  done(errs); await ctx.close();
});

/* ================= popout (193–195) ================= */
await run('popout', async () => {
  const sizes = [[400, 225], [480, 270], [640, 360], [854, 480], [300, 533]];
  for (const [w, h] of sizes) {
    const sid = `pop${w}:USD`, s = session(sid);
    const { ctx, page, errs } = await open(w, h, live(sid));
    const g = await page.evaluate(() => {
      const vis = id => { const e = document.getElementById(id); if (!e || e.hidden || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
      return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight,
        r: Object.fromEntries(['board', 'btnSpin', 'btnBetUp', 'btnBetDown', 'btnMenu', 'btnBonus', 'btnAuto', 'btnTurbo', 'balanceBox', 'winBox'].map(id => [id, vis(id)])) };
    });
    if (g.sw > g.iw + 1 || g.sh > g.ih + 1) bad(`${w}×${h}: прокрутка ${g.sw}×${g.sh}`);
    for (const [id, r] of Object.entries(g.r)) {
      if (!r) { bad(`${w}×${h}: не видно ${id}`); continue; }
      if (r[0] < -1 || r[1] < -1 || r[2] > w + 1 || r[3] > h + 1) bad(`${w}×${h}: ${id} за краем ${r}`);
    }
    s.next.push(BOOKS.base.small[1]); await page.keyboard.press('Space'); await started(page); await idle(page);
    await shot(page, `popout_${w}x${h}`);
    note(`${w}×${h}: без прокрутки, поле и кнопки в кадре, спин работает`);
    done(errs); await ctx.close();
  }
});

await browser.close(); server.close();
const ext = allReq.filter(u => !u.startsWith(base) && !/^(data|blob):/.test(u));
const summary = { build: BUILD, stake: STAKE, requests: allReq.length, external: ext, sections: R };
fs.writeFileSync(path.join(SHOTS, 'qa_stage9.json'), JSON.stringify(summary, null, 1));
let total = 0;
for (const [k, v] of Object.entries(R)) { console.log(`\n[${k}] ${v.problems.length ? 'ПРОБЛЕМ ' + v.problems.length : 'ok'}`); v.notes.forEach(n => console.log('  · ' + n)); v.problems.forEach(p => console.log('  ✗ ' + p)); total += v.problems.length; }
console.log(`\nзапросов ${allReq.length}, внешних ${ext.length}`);
process.exit(total || ext.length ? 1 : 0);
