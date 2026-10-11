#!/usr/bin/env node
/* Проигрывает книги из выгрузки для Stake Engine в настоящем фронтенде (headless Chromium, макет RGS).
 *   node tools/check_stake_fe.mjs [--stake math/stake] [--build build] [--shots shots]
 * Из каждого режима берутся характерные книги (пустой раунд, выигрыш, бонус, ретриггер, потолок); макет RGS отдаёт их
 * так же, как отдаёт RGS: round.state = events, round.payoutMultiplier = выплата книги / 100.
 * Проверяется: имена режимов из index.json совпадают с теми, что шлёт игра (без учёта регистра); цена режима совпадает;
 * итог на экране и баланс равны выплате книги; в консоли нет ошибок и предупреждения «события расходятся с выплатой RGS».
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
const STAKE = path.resolve(arg('stake', path.join(ROOT, 'math/stake'))), BUILD = path.resolve(arg('build', path.join(ROOT, 'build'))), SHOTS = path.resolve(arg('shots', path.join(ROOT, 'shots')));
const U = 1000000, BET = 2 * U, problems = [], bad = (tag, msg) => problems.push(tag + ': ' + msg);
const index = JSON.parse(fs.readFileSync(path.join(STAKE, 'index.json'), 'utf8'));
const modes = Object.fromEntries(index.modes.map(m => [m.name, m]));

/* какие книги ищем в каждом режиме: [подпись, условие по тексту строки и разобранной книге] */
const has = (b, t) => b.events.some(e => e.type === t);
const fsTotal = b => (b.events.find(e => e.type === 'freeSpinTrigger') || {}).totalFs;
const WANT = {
  base: [['пустой раунд', b => b.payoutMultiplier === 0], ['выигрыш по линиям', b => !has(b, 'freeSpinTrigger') && b.payoutMultiplier >= 300 && b.payoutMultiplier <= 3000],
    ['крупный выигрыш без бонуса', b => !has(b, 'freeSpinTrigger') && b.payoutMultiplier >= 20000], ['бонус с ретриггером', b => has(b, 'retrigger') && !has(b, 'wincap')], ['потолок', b => has(b, 'wincap')]],
  ante: [['бонус, 4 скаттера', b => fsTotal(b) === 10 && !has(b, 'wincap') && !has(b, 'retrigger')], ['пустой раунд', b => b.payoutMultiplier === 0]],
  bonus: [['бонус, 5 скаттеров', b => fsTotal(b) === 12 && !has(b, 'wincap')], ['бонус без выигрыша', b => b.payoutMultiplier === 0], ['потолок', b => has(b, 'wincap')]],
  super: [['супербонус', b => !has(b, 'wincap') && b.payoutMultiplier >= 20000 && b.payoutMultiplier <= 60000], ['потолок', b => has(b, 'wincap')]]
};
async function pick(name) {
  const want = WANT[name].map(([label, fn]) => ({ label, fn, book: null }));
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(STAKE, modes[name].events)).pipe(zlib.createZstdDecompress()), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line) continue; n++;
    const open = want.filter(w => !w.book); if (!open.length) break;
    // разбираем не каждую строку: только те, что могут подойти хоть одному условию
    const cheap = open.some(w => w.label.startsWith('потолок')) && line.includes('"wincap"') || open.some(w => !w.label.startsWith('потолок'));
    if (!cheap) continue;
    const b = JSON.parse(line);
    for (const w of open) if (!w.book && w.fn(b)) { w.book = b; break; }
  }
  rl.close();
  for (const w of want) if (!w.book) bad(name, `в книгах не нашлось раунда «${w.label}»`);
  return want.filter(w => w.book);
}
const picked = {}; for (const name of Object.keys(WANT)) { if (!modes[name]) { bad('index.json', 'нет режима ' + name); continue; } picked[name] = await pick(name); }

/* макет RGS */
const S = { balance: 1000000 * U, pending: 0, next: null, log: [] };
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.js': 'text/javascript' };
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.startsWith('/rgs/')) {
    let raw = ''; rq.on('data', d => { raw += d; }); rq.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}, send = (code, data) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(data)); };
      const bal = () => ({ amount: S.balance, currency: 'USD' });
      if (p === '/rgs/wallet/authenticate') return send(200, { balance: bal(), config: { minBet: 0.1 * U, maxBet: 1000 * U, stepBet: 0.1 * U, defaultBetLevel: BET, betLevels: [U, BET, 5 * U], jurisdiction: {} }, round: null });
      if (p === '/rgs/wallet/play') {
        const mode = modes[String(body.mode).toLowerCase()], book = S.next; S.next = null; S.log.push(body);
        if (!mode || !book) return send(400, { error: 'ERR_VAL', message: 'unknown mode ' + body.mode });
        S.balance -= Math.round(body.amount * mode.cost); S.pending = Math.round(body.amount * book.payoutMultiplier / 100);
        return send(200, { balance: bal(), round: { betID: book.id, amount: body.amount, payout: S.pending, payoutMultiplier: book.payoutMultiplier / 100, active: S.pending > 0, mode: body.mode, event: null, state: book.events } });
      }
      if (p === '/rgs/wallet/end-round') { S.balance += S.pending; S.pending = 0; return send(200, { balance: bal() }); }
      send(404, { error: 'ERR_VAL' });
    });
    return;
  }
  const f = path.join(BUILD, p === '/' ? 'index.html' : p);
  if (!f.startsWith(BUILD) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); rs.end('not found'); return; }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rs);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port + '/';

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-US' }), page = await ctx.newPage(), errs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
await page.goto(base + `?sessionID=stake-books&lang=en&device=desktop&intro=0&rgs_url=${encodeURIComponent(base + 'rgs')}`);
await page.waitForFunction(() => document.getElementById('loader').classList.contains('ready'), null, { timeout: 20000 }); await page.click('#loader');
await page.waitForFunction(() => window.__game && window.__game.ready && document.getElementById('loader').hidden, null, { timeout: 20000 });
await page.click('#btnTurbo');
const feModes = await page.evaluate(() => window.__game.config.modes);
for (const [name, m] of Object.entries(modes)) { const fe = feModes[name.toUpperCase()]; if (!fe) bad('режимы', `игра не знает режим ${name}`); else if (fe.cost !== m.cost) bad('режимы', `${name}: цена в index.json ${m.cost}, в игре ${fe.cost}`); }
for (const k of Object.keys(feModes)) if (!modes[k.toLowerCase()]) bad('режимы', `в index.json нет режима игры ${k}`);

/* подписи выигрышей линий: в сумме равны totalWin вращения, в том числе на вращении, обрезанном потолком */
let capSpins = 0, winSpins = 0;
for (const name of Object.keys(picked)) for (const w of picked[name]) for (const ev of w.book.events) {
  if (ev.type !== 'winInfo') continue;
  const raw = ev.wins.reduce((a, x) => a + x.win, 0), shown = await page.evaluate(e => window.__game.readWins(e), ev), sum = shown.reduce((a, x) => a + x.money, 0);
  winSpins++; if (raw > ev.totalWin) capSpins++;
  if (sum !== Math.round(BET * ev.totalWin / 100) || shown.some(x => x.money > Math.round(BET * ev.totalWin / 100)) || shown.some(x => !x.money !== !!x.noLabel)) bad(`${name} id ${w.book.id}`, `подписи линий дают ${sum / U}, итог вращения ${BET * ev.totalWin / 100 / U}`);
}
if (!capSpins) bad('подписи линий', 'среди выбранных книг нет вращения, обрезанного потолком');
const rows = [];
for (const name of Object.keys(picked)) for (const w of picked[name]) {
  const tag = `${name} / ${w.label} (id ${w.book.id})`, feMode = name.toUpperCase(), before = S.balance, t0 = Date.now();
  S.next = w.book;
  // base и ante — обычное вращение (анте включён через меню бонус-режимов), bonus и super — покупка
  await page.evaluate(m => { window.__game.spin(m === 'BONUS' || m === 'SUPER' ? m : undefined); }, feMode).catch(e => bad(tag, e.message));
  await page.waitForFunction(() => window.__game.busy, null, { timeout: 5000 }).catch(() => bad(tag, 'раунд не начался'));
  await page.waitForFunction(() => !window.__game.busy, null, { timeout: 600000 }).catch(() => bad(tag, 'раунд не закончился за 10 минут'));
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => window.__game.state), sent = S.log[S.log.length - 1] || {};
  const win = Math.round(BET * w.book.payoutMultiplier / 100), cost = Math.round(BET * modes[name].cost);
  if (String(sent.mode) !== feMode || sent.amount !== BET) bad(tag, `запрос play: mode ${sent.mode}, amount ${sent.amount}`);
  if (st.win !== win) bad(tag, `на экране ${st.win / U}, в книге ${win / U}`);
  if (st.balance !== S.balance || S.balance !== before - cost + win) bad(tag, `баланс ${st.balance / U}, ожидался ${(before - cost + win) / U}`);
  if (st.fs || st.sticky) bad(tag, 'после раунда остался режим фриспинов');
  if (/потолок/.test(w.label)) await page.screenshot({ path: path.join(SHOTS, `stake_${name}_cap.png`) });
  rows.push(`${tag}: ${w.book.events.length} событий, выплата ${(w.book.payoutMultiplier / 100).toLocaleString('en-US')}× — на экране ${(st.win / U).toLocaleString('en-US')} при ставке ${BET / U}, ${((Date.now() - t0) / 1000).toFixed(0)} c`);
  // анте: следующий раунд этого режима должен уйти с mode=ANTE
  if (name === 'base' && w === picked.base[picked.base.length - 1]) { await page.click('#btnBonus'); await page.click('#anteToggle'); await page.click('#bonusClose'); }
  if (name === 'ante' && w === picked.ante[picked.ante.length - 1]) await page.click('#btnBonus');   // Deactivate
}
if (errs.length) problems.push(...errs.map(e => 'консоль: ' + e));
await browser.close(); server.close();
console.log(rows.join('\n'));
if (problems.length) { console.log('\nПРОБЛЕМЫ (' + problems.length + '):\n' + problems.join('\n')); process.exit(1); }
console.log(`\nok: ${rows.length} книг из выгрузки проиграны во фронтенде, итоги совпали с выплатами книг; подписи линий проверены на ${winSpins} вращениях, из них обрезано потолком ${capSpins}`);
