#!/usr/bin/env node
/* Проверка сборки в headless Chromium (Playwright) с макетом RGS Stake Engine.
 *   node tools/check_fe.mjs [--only sizes,ui,demo,rgs,currencies,flags,social,replay,i18n] [--build build] [--shots shots]
 *
 *   sizes       8 размеров экрана: покой, вращение, крупный выигрыш, линии, бонус, меню, окна; геометрия и консоль
 *   ui          нижняя панель: Win над спином, меню, звук, настройки, анте, турбо; портрет; единицы контейнера; что грузит телефон; бонус-меню
 *   demo        демо-режим: анте, автоигра и её лимиты, покупка супербонуса, ретриггер, потолок выигрыша
 *   rgs         макет RGS: https:// к голому хосту, запросы, ставки из конфига, выплата по ответу сервера, незавершённый раунд
 *   currencies  15 валют: формат баланса, ставки и выигрыша
 *   flags       каждый флаг юрисдикции по отдельности
 *   social      Social Mode: ?currency=XGC — нигде нет запрещённых слов
 *   replay      Replay Mode от ссылки до «Replay again»
 *   i18n        16 языков: откат на английский, ничего не вылезает на мобильном
 * Код выхода 1, если есть проблемы.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const req = n => { try { return require(n); } catch { return require('/opt/npm-tools/node_modules/' + n); } };
const { chromium } = req('playwright');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.resolve(arg('build', path.join(ROOT, 'build')));
const SHOTS = path.resolve(arg('shots', path.join(ROOT, 'shots')));
const ALL = ['sizes', 'ui', 'demo', 'rgs', 'currencies', 'flags', 'social', 'replay', 'i18n'];
const ONLY = arg('only') ? arg('only').split(',') : ALL;
const SIZES = [[1920, 1080], [1280, 720], [1024, 768], [844, 390], [600, 900], [390, 844], [375, 667], [400, 225]];
const LANGS = ['en', 'ru', 'de', 'es', 'fr', 'pt', 'tr', 'pl', 'fi', 'id', 'vi', 'ja', 'ko', 'zh', 'hi', 'ar'];
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.js': 'text/javascript', '.webm': 'video/webm', '.mp4': 'video/mp4' };
const M = require(path.join(BUILD, 'assets/js/math.js'));
global.window = {}; require(path.join(BUILD, 'assets/i18n.js')); const I18N = global.window.I18N;
const U = 1000000, NB = ' ', problems = [];
const bad = (tag, msg) => problems.push(tag + ': ' + msg);

/* ---- раунды для сценариев ищем перебором сидов: так тест не зависит от текущих TUNE ---- */
const has = (b, t) => b.events.some(e => e.type === t);
function findSeed(mode, pred, limit = 3000000) {
  for (let s = 1; s <= limit; s++) { const b = M.book(mode, s); if (pred(b)) return s; }
  throw new Error('не нашёл подходящий раунд для ' + mode);
}
const SEED = {
  lose: findSeed('BASE', b => b.payoutMultiplier === 0 && !has(b, 'freeSpinTrigger')),
  small: findSeed('BASE', b => !has(b, 'freeSpinTrigger') && b.payoutMultiplier >= 100 && b.payoutMultiplier <= 600),
  big: findSeed('BASE', b => !has(b, 'freeSpinTrigger') && b.payoutMultiplier >= 1500 && b.payoutMultiplier <= 6000 && b.events[1].wins && b.events[1].wins.length >= 2),
  bonus: findSeed('BASE', b => has(b, 'freeSpinTrigger') && !has(b, 'retrigger') && b.payoutMultiplier >= 3000 && b.payoutMultiplier <= 40000),
  retrig: findSeed('BONUS', b => has(b, 'retrigger') && b.payoutMultiplier > 0),
  sup: findSeed('SUPER', b => b.payoutMultiplier >= 5000),
  cap: findSeed('SUPER', b => has(b, 'wincap'))
};
const book = (mode, seed) => M.book(mode, seed);
const simpleRound = hundredths => [   // раунд из четырёх событий с заданным выигрышем
  { index: 0, type: 'reveal', gameType: 'basegame', board: [['L1', 'L2', 'L3', 'L4', 'H4'], ['H3', 'H2', 'H1', 'L1', 'L2'], ['L3', 'L4', 'H4', 'H3', 'H2'], ['H1', 'L1', 'L2', 'L3', 'L4'], ['H4', 'H3', 'H2', 'H1', 'L1']].map(c => c.map(name => ({ name }))) },
  { index: 1, type: 'winInfo', totalWin: hundredths, wins: [{ symbol: 'H1', kind: 3, win: hundredths, positions: [{ reel: 0, row: 4 }, { reel: 2, row: 0 }, { reel: 4, row: 2 }], meta: { lineIndex: 0, multiplier: 1, winWithoutMult: hundredths } }] },
  { index: 2, type: 'setTotalWin', amount: hundredths }, { index: 3, type: 'finalWin', amount: hundredths }];

/* 15 валют: баланс, ставка и множитель выплаты от «сервера» и то, что должно быть на экране */
const CUR = {
  USD: { bal: 1234.5, bet: 2, mult: 7.77, show: ['$1,234.50', '$2.00', '$15.54'] },
  EUR: { bal: 1234.5, bet: 2, mult: 7.77, show: ['€1,234.50', '€2.00', '€15.54'] },
  JPY: { bal: 150000, bet: 100, mult: 7.77, show: ['¥150,000.00', '¥100.00', '¥777.00'] },
  BRL: { bal: 1234.5, bet: 2, mult: 7.77, show: ['R$1,234.50', 'R$2.00', 'R$15.54'] },
  INR: { bal: 1234.5, bet: 2, mult: 7.77, show: ['₹1,234.50', '₹2.00', '₹15.54'] },
  TRY: { bal: 1234.5, bet: 2, mult: 7.77, show: ['₺1,234.50', '₺2.00', '₺15.54'] },
  CAD: { bal: 1234.5, bet: 2, mult: 7.77, show: ['CA$1,234.50', 'CA$2.00', 'CA$15.54'] },
  BTC: { bal: 1.234567, bet: 0.001234, mult: 2.5, show: ['1.234567' + NB + 'BTC', '0.001234' + NB + 'BTC', '0.0031' + NB + 'BTC'] },
  ETH: { bal: 25.5, bet: 0.01, mult: 7.77, show: ['25.50' + NB + 'ETH', '0.01' + NB + 'ETH', '0.0777' + NB + 'ETH'] },
  LTC: { bal: 100, bet: 0.1, mult: 7.77, show: ['100.00' + NB + 'LTC', '0.10' + NB + 'LTC', '0.777' + NB + 'LTC'] },
  DOGE: { bal: 50000, bet: 10, mult: 7.77, show: ['50,000.00' + NB + 'DOGE', '10.00' + NB + 'DOGE', '77.70' + NB + 'DOGE'] },
  USDT: { bal: 1234.5, bet: 2, mult: 7.77, show: ['1,234.50' + NB + 'USDT', '2.00' + NB + 'USDT', '15.54' + NB + 'USDT'] },
  XGC: { bal: 1234.5, bet: 2, mult: 7.77, show: ['1,234.50' + NB + 'GC', '2.00' + NB + 'GC', '15.5400' + NB + 'GC'] },
  XSC: { bal: 1234.5, bet: 2, mult: 7.77, show: ['1,234.50' + NB + 'SC', '2.00' + NB + 'SC', '15.5400' + NB + 'SC'] },
  XEC: { bal: 1234.5, bet: 2, mult: 7.77, show: ['1,234.50' + NB + 'SC', '2.00' + NB + 'SC', '15.5400' + NB + 'SC'] }
};
const FLAGS = { disabledTurbo: true, disabledAutoplay: true, disabledBuyFeature: true, disabledSpacebar: true, disabledSlamstop: true, displayRTP: true, minimumRoundDuration: 4000, socialCasino: true };
const NO_FLAGS = { socialCasino: false, disabledFullscreen: false, disabledTurbo: false, disabledSuperTurbo: false, disabledAutoplay: false, disabledSlamstop: false, disabledSpacebar: false, disabledBuyFeature: false, displayNetPosition: false, displayRTP: false, displaySessionTimer: false, minimumRoundDuration: 0 };

/* ---- макет RGS (тот же origin, путь /rgs). Сценарий задаётся идентификатором сессии. ---- */
const sessions = new Map();
function session(id) {
  if (sessions.has(id)) return sessions.get(id);
  const [kind, name] = String(id).split(':');
  const s = { id, kind, name, log: [], plays: 0, pending: 0, currency: 'EUR', balance: 5000 * U, active: null,
    config: { gameID: 'senbazuru', minBet: 0.2 * U, maxBet: 50 * U, stepBet: 0.2 * U, defaultBetLevel: 2 * U,
      betLevels: [0.1, 0.2, 0.3, 0.5, 1, 2, 5, 50, 100].map(v => Math.round(v * U)), betModes: {}, jurisdiction: Object.assign({}, NO_FLAGS) } };
  if (kind === 'cur') { const c = CUR[name]; s.currency = name; s.balance = Math.round(c.bal * U); const b = Math.round(c.bet * U); s.config = Object.assign(s.config, { minBet: b, maxBet: b * 100, stepBet: b, defaultBetLevel: b, betLevels: [b, b * 2, b * 5] }); }
  if (kind === 'flag' && name !== 'none') s.config.jurisdiction[name] = FLAGS[name];
  if (kind === 'resume') { const b = book('BASE', SEED.small); s.pending = Math.round(5 * U * b.payoutMultiplier / 100); s.active = { betID: 77, amount: 5 * U, payout: s.pending, payoutMultiplier: b.payoutMultiplier / 100, active: true, mode: 'BASE', event: null, state: b.events }; }
  sessions.set(id, s); return s;
}
function rgsReply(method, pathname, body) {
  if (method === 'GET' && pathname.startsWith('/bet/replay/')) {
    const [game, version, mode, event] = pathname.slice('/bet/replay/'.length).split('/').map(decodeURIComponent);
    session('replay').log.push([pathname, null]);
    if (event === '404') return [404, { error: 'NOT_FOUND', message: 'Replay data not found.' }];
    const seed = mode === 'BONUS' ? SEED.retrig : mode === 'SUPER' ? SEED.sup : event === '9' ? SEED.lose : SEED.big, b = book(mode, seed);
    return [200, { payoutMultiplier: b.payoutMultiplier / 100, costMultiplier: M.CONFIG.modes[mode].cost, state: b.events, _echo: { game, version } }];
  }
  if (method !== 'POST') return [405, { error: 'ERR_VAL' }];
  if (!body.sessionID) return [400, { error: 'ERR_IS' }];
  const s = session(body.sessionID); s.log.push([pathname, body]);
  const bal = () => ({ amount: s.balance, currency: s.currency });
  if (pathname === '/wallet/authenticate') return [200, { balance: bal(), config: s.config, round: s.active, meta: null }];
  if (pathname === '/wallet/play') {
    const mode = M.CONFIG.modes[body.mode];
    if (!mode || !Number.isInteger(body.amount)) return [400, { error: 'ERR_VAL' }];
    const cost = Math.round(body.amount * mode.cost);
    if (cost > s.balance) return [400, { error: 'ERR_IPB', message: 'insufficient balance' }];
    s.plays++;
    let events, mult, withPayout = false;
    if (s.kind === 'cur') { mult = CUR[s.name].mult; events = simpleRound(Math.round(mult * 100)); }
    else if (s.kind === 'flag') { const b = book(body.mode, s.name === 'minimumRoundDuration' || s.name === 'none2' ? SEED.lose : body.mode === 'BASE' ? SEED.big : SEED.retrig); events = b.events; mult = b.payoutMultiplier / 100; }
    else if (s.plays === 1) { const b = book('BASE', SEED.big); events = b.events; mult = b.payoutMultiplier / 100; withPayout = true; }
    else if (s.plays === 2) { const b = book(body.mode, SEED.retrig); events = b.events; mult = b.payoutMultiplier / 100; }
    else if (s.plays === 3) { mult = 7.77; events = simpleRound(777); }               // «подменённый» раунд: на доске комбинаций нет
    else if (s.plays === 4) { mult = 7.77; events = simpleRound(500); }               // события говорят 5.00×, сервер платит 7.77×
    else { const b = book('BASE', SEED.lose); events = b.events; mult = 0; }
    s.balance -= cost; s.pending = Math.round(body.amount * mult);
    const round = { betID: s.plays, amount: body.amount, payoutMultiplier: mult, active: s.pending > 0, mode: body.mode, event: null, state: events };
    if (withPayout) round.payout = s.pending;
    return [200, { balance: bal(), round }];
  }
  if (pathname === '/wallet/end-round') { s.balance += s.pending; s.pending = 0; s.active = null; return [200, { balance: bal() }]; }
  return [404, { error: 'ERR_VAL' }];
}
const server = http.createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.startsWith('/rgs/')) {
    let raw = ''; rq.on('data', d => { raw += d; }); rq.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch { /* пустое тело */ }
      const [code, data] = rgsReply(rq.method, rq.url.split('?')[0].slice(4), body);
      rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(data));
    });
    return;
  }
  const f = path.join(BUILD, p === '/' ? 'index.html' : p);
  if (!f.startsWith(BUILD) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); rs.end('not found'); return; }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rs);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/';
const liveUrl = (sid, extra = '') => `?sessionID=${encodeURIComponent(sid)}&lang=en&device=desktop&rgs_url=${encodeURIComponent(base + 'rgs')}${extra}`;

if (ONLY.length === ALL.length) fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();

/* ---- общие проверки в странице ---- */
const GEOM = () => {
  const ids = ['logo', 'multHud', 'board', 'fsBox', 'balanceBox', 'winBox', 'betGroup', 'btnBetDown', 'btnBetUp', 'btnMenu', 'btnBonus', 'btnSpin', 'btnTurbo', 'btnAuto', 'menuPop', 'replayCard', 'replayBadge'];
  const app = document.getElementById('app'), tiny = !!app.dataset.tiny;
  const out = { rects: {}, small: [], mode: app.dataset.mode, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight };
  const shown = el => { const cs = getComputedStyle(el); return !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && !!el.offsetParent; };
  for (const id of ids) {
    const el = document.getElementById(id); if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    if (id === 'board') { const bs = parseFloat(getComputedStyle(el).getPropertyValue('--bs')) * 0.03; x0 -= bs; y0 -= bs; x1 += bs; y1 += bs; }
    out.rects[id] = [x0, y0, x1, y1].map(v => Math.round(v * 10) / 10);
  }
  // размер шрифта подписей и чисел на панели и HUD
  for (const [sel, min, minTiny] of [['#panel .lbl, #panel .cap, #menuPop .cap', 5.5, 3.2], ['#panel .val', 9, 6], ['#fsBox .val, #multHud .hv', 8, 5.5], ['#msg', 7.5, 0]]) {
    document.querySelectorAll(sel).forEach(el => { if (!shown(el)) return; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < (tiny ? minTiny : min)) out.small.push('мелкий шрифт ' + fs.toFixed(1) + ' px: «' + el.textContent.trim().slice(0, 30) + '»'); });
  }
  // подписи, которые подгоняются по ширине, не выходят за свою табличку или кнопку
  document.querySelectorAll('[data-fit]').forEach(el => {
    if (!shown(el) || !el.textContent.trim()) return; const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
    if (r.left < p.left - 1 || r.right > p.right + 1) out.small.push('подпись шире своей таблички: «' + el.textContent.trim().slice(0, 40) + '»');
  });
  // текст внутри плашек и кнопок не шире самой плашки
  document.querySelectorAll('.tag, .pill, .modecard, .plank, .rrows div, #bigwinTitle, #bigwinAmount, .hud, .sq').forEach(el => {
    const r = el.getBoundingClientRect(); if (!r.width || !shown(el)) return;
    if (el.scrollWidth > el.clientWidth + 1.5) out.small.push('текст шире элемента: «' + el.textContent.trim().slice(0, 40) + '»');
    if (r.left < -0.5 || r.right > innerWidth + 0.5) out.small.push('за краем экрана: «' + el.textContent.trim().slice(0, 40) + '»');
  });
  const sheet = document.querySelector('.modal:not([hidden]) .sheet');
  if (sheet && sheet.scrollWidth > sheet.clientWidth + 1.5) out.small.push('в окне появилась горизонтальная прокрутка');
  const modal = document.querySelector('.modal:not([hidden])');
  if (modal && (modal.id === 'autoModal' || modal.id === 'settingsModal') && sheet.scrollHeight > sheet.clientHeight + 1.5) out.small.push('окно ' + modal.id + ' не помещается по высоте');
  // экран Info: на весь экран, круглый крестик справа вверху, колонка по центру, ничего не шире экрана
  if (modal && modal.id === 'infoModal') {
    const R = el => el.getBoundingClientRect(), sc = document.getElementById('infoScroll'), col = document.getElementById('infoSheet'), x = R(document.getElementById('infoClose'));
    const m = R(modal), c = R(col);
    if (m.left > 0.5 || m.top > 0.5 || m.right < innerWidth - 0.5 || m.bottom < innerHeight - 0.5) out.small.push('Info не на весь экран');
    if (!/blur/.test(getComputedStyle(modal).backdropFilter || getComputedStyle(modal).webkitBackdropFilter || '')) out.small.push('у Info нет размытого фона');
    if (x.right > innerWidth + 0.5 || x.top < 0 || x.left < innerWidth * 0.7 || x.top > 80 || Math.abs(x.width - x.height) > 1 || parseFloat(getComputedStyle(document.getElementById('infoClose')).borderRadius) < x.width / 2 - 1) out.small.push('крестик Info не круглый или не справа вверху');
    if (x.width < 36) out.small.push('крестик Info меньше 36 px');
    if (sc.scrollWidth > sc.clientWidth + 1.5) out.small.push('в Info появилась горизонтальная прокрутка');
    if (Math.abs((c.left - m.left) - (m.right - c.right - (sc.offsetWidth - sc.clientWidth))) > 2) out.small.push('колонка Info не по центру');
    col.querySelectorAll('.icard, .ipay, .itbl, .ilines figure, .ichips span, .imax, h2, h3').forEach(el => { const r = R(el); if (r.left < -0.5 || r.right > innerWidth + 0.5) out.small.push('в Info за краем экрана: «' + el.textContent.trim().slice(0, 30) + '»'); });
    const h2 = R(col.querySelector('h2'));
    if (sc.scrollTop < 1 && h2.top < x.bottom && h2.right > x.left) out.small.push('заголовок Info под крестиком');
    document.querySelectorAll('#infoSheet p, #infoSheet td, #infoSheet b').forEach(el => { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 9) out.small.push('мелкий шрифт в Info ' + fs.toFixed(1) + ' px: «' + el.textContent.trim().slice(0, 30) + '»'); });
  }
  // меню бонус-режимов: шапка, крестик и доски
  if (modal && modal.id === 'bonusModal') {
    const R = id => document.getElementById(id).getBoundingClientRect(), rd = v => Math.round(v * 10) / 10;
    const head = modal.querySelector('.bm-head').getBoundingClientRect(), x = R('bonusClose'), body = R('bmBody'), bodyEl = document.getElementById('bmBody');
    const inner = !document.getElementById('bonusConfirm').hidden ? R('bonusConfirm') : R('modeCards');
    const cards = Array.from(modal.querySelectorAll('.modecard, #bonusConfirm')).filter(shown).map(e => e.getBoundingClientRect());
    const landscape = innerWidth > innerHeight, scroll = bodyEl.scrollHeight > bodyEl.clientHeight + 1.5;
    if (x.top < 0 || x.right > innerWidth + 0.5 || x.left < innerWidth * 0.75 || x.top > innerHeight * 0.12) out.small.push('крестик бонус-меню не в правом верхнем углу');
    for (const c of cards) {
      if (c.left < -0.5 || c.right > innerWidth + 0.5 || (!scroll && (c.top < -0.5 || c.bottom > innerHeight + 0.5))) out.small.push('доска бонус-меню за краем экрана');
      const ox = Math.min(c.right, x.right) - Math.max(c.left, x.left), oy = Math.min(c.bottom, x.bottom) - Math.max(c.top, x.top);
      if (ox > 1 && oy > 1 && !scroll) out.small.push('крестик бонус-меню наезжает на доску');
    }
    if (landscape) {
      if (scroll) out.small.push('бонус-меню в ландшафте не помещается без прокрутки');
      if (head.top > innerHeight * 0.06 + 8) out.small.push('шапка бонус-меню не прижата к верху: ' + rd(head.top));
      if (cards.some(c => c.top < x.bottom - 1)) out.small.push('крестик бонус-меню не выше досок');
      if (Math.abs((inner.top + inner.bottom) / 2 - (body.top + body.bottom) / 2) > 2) out.small.push('доски бонус-меню не по центру свободного места: ' + rd((inner.top + inner.bottom) / 2) + ' против ' + rd((body.top + body.bottom) / 2));
      if (inner.top < head.bottom - 1) out.small.push('доски бонус-меню наезжают на шапку');
    }
    if (!document.getElementById('bonusConfirm').hidden) {
      const c = R('bonusConfirm'), cx = (c.left + c.right) / 2;
      for (const id of ['buyQ', 'buyPrice']) { const el = document.getElementById(id), rg = document.createRange(); rg.selectNodeContents(el); const t = rg.getBoundingClientRect(); if (Math.abs((t.left + t.right) / 2 - cx) > 1.5) out.small.push('подтверждение покупки: ' + id + ' не по центру доски'); }
    }
  }
  return out;
};
function checkGeom(tag, g, w, h) {
  const names = Object.keys(g.rects), free = new Set(['replayBadge', 'menuPop', 'btnBetDown', 'btnBetUp']);
  for (const n of names) {
    const [x0, y0, x1, y1] = g.rects[n];
    if (x0 < -0.5 || y0 < -0.5 || x1 > w + 0.5 || y1 > h + 0.5) bad(tag, `${n} выходит за экран [${g.rects[n]}]`);
    if (x1 - x0 < 8 || y1 - y0 < 6) bad(tag, `${n} схлопнулся [${g.rects[n]}]`);
  }
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const pair = [names[i], names[j]];
    if (pair.some(n => free.has(n))) continue;
    if (pair[0] === 'board' && (pair[1] === 'replayCard' || pair[1] === 'fsBox')) continue;   // карточка повтора лежит на доске, табличка фриспинов — на верхней планке рамки
    const a = g.rects[names[i]], b = g.rects[names[j]];
    const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (ox > 1 && oy > 1) bad(tag, `${names[i]} и ${names[j]} пересекаются на ${Math.round(ox)}×${Math.round(oy)} px`);
  }
  // кнопки − и + лежат внутри группы ставки; меню — над кнопкой Menu и не закрывает спин
  for (const n of ['btnBetDown', 'btnBetUp']) if (g.rects.betGroup && !g.rects[n]) bad(tag, n + ' не виден');
  if (g.rects.menuPop) {
    const m = g.rects.menuPop, b = g.rects.btnMenu, sp = g.rects.btnSpin;
    if (m[3] > b[1] + 1) bad(tag, 'меню не над кнопкой Menu');
    if (sp && Math.min(m[2], sp[2]) - Math.max(m[0], sp[0]) > 1 && Math.min(m[3], sp[3]) - Math.max(m[1], sp[1]) > 1) bad(tag, 'меню закрывает кнопку спина');
  }
  for (const s of new Set(g.small)) bad(tag, s);
  if (g.scrollW > w || g.scrollH > h) bad(tag, `страница шире/выше экрана (${g.scrollW}×${g.scrollH})`);
}
const TEXTS = () => {
  const out = [], walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = walk.nextNode())) { const p = n.parentElement; if (!p || p.closest('script,style')) continue; const s = n.textContent.trim(); if (s) out.push(s); }
  document.querySelectorAll('[aria-label],[title],[alt]').forEach(el => { for (const a of ['aria-label', 'title', 'alt']) { const v = el.getAttribute(a); if (v) out.push(v); } });
  return out;
};
async function open(w, h, query = '', opts = {}) {
  const ctx = opts.ctx || await browser.newContext(Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: opts.locale || 'en-US' }, opts.context || {}));
  const page = await ctx.newPage(); const errs = [];
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !(opts.allow && opts.allow.test(m.text()))) errs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => errs.push('[requestfailed] ' + r.url()));
  page.on('response', r => { if (r.status() >= 400 && !(opts.allow && opts.allow.test(r.url()))) errs.push(`[${r.status()}] ${r.url()}`); });
  if (opts.before) await opts.before(page);
  await page.goto(base + query + (query.includes('?') ? '&' : '?') + 'intro=0');   // интро студии проверяется отдельно (раздел ui)
  await enter(page);
  return { ctx, page, errs };
}
/* заставка: дождаться «Press to continue» и тапнуть */
const enter = async page => {
  await page.waitForFunction(() => document.getElementById('loader').classList.contains('ready'), null, { timeout: 20000 });
  await page.click('#loader');
  await page.waitForFunction(() => window.__game && window.__game.ready && document.getElementById('loader').hidden, null, { timeout: 20000 });
};
const idle = (page, ms = 60000) => page.waitForFunction(() => !window.__game.busy, null, { timeout: ms });
const started = page => page.waitForFunction(() => window.__game.busy, null, { timeout: 5000 });
const state = page => page.evaluate(() => window.__game.state);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent : null; }, sel);
const visible = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); if (!el || el.hidden) return false; const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && !!el.offsetParent && el.getBoundingClientRect().width > 0; }, sel);
const openInfo = async page => { await page.click('#btnMenu'); await page.click('#btnInfo'); };
const rect = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.right, b: r.bottom }; }, sel);
const bannerUp = page => page.waitForFunction(() => !document.getElementById('bigwin').hidden, null, { timeout: 20000 });
const finish = (errs, tag) => { if (errs.length) problems.push(...errs.map(e => `${tag}: консоль ${e}`)); };
/* сыграть заданный раунд в демо и сверить экран с книгой */
async function playForced(page, tag, mode, seed, viaSpace = false) {
  const before = await state(page), b = book(mode, seed);
  await page.evaluate(s => window.__game.force(s), seed);
  if (viaSpace) await page.keyboard.press('Space'); else await page.evaluate(m => { window.__game.spin(m === 'BASE' || m.startsWith('ANTE') ? undefined : m); }, mode);
  await started(page);
  return { before, b, async done() {
    await idle(page, 180000);
    const st = await state(page), cost = Math.round(before.bet * M.CONFIG.modes[mode].cost), win = Math.round(before.bet * b.payoutMultiplier / 100);
    if (st.win !== win) bad(tag, `на экране выигрыш ${st.win / U}, в раунде ${win / U} (${mode}, seed ${seed})`);
    if (st.balance !== before.balance - cost + win) bad(tag, `баланс ${st.balance / U}, ожидался ${(before.balance - cost + win) / U} (${mode}, seed ${seed})`);
    if (st.fs || st.sticky) bad(tag, 'после раунда остался режим фриспинов');
    return st;
  } };
}
const run = async (name, fn) => {
  if (!ONLY.includes(name)) return; const t0 = Date.now();
  try { await fn(); } catch (e) { bad(name, 'тест прервался: ' + String(e.message).split('\n')[0]); for (const c of browser.contexts()) await c.close().catch(() => {}); }
  console.log(`— ${name}: ${((Date.now() - t0) / 1000).toFixed(0)} c`);
};

/* ================= sizes ================= */
await run('sizes', async () => {
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    const { ctx, page, errs } = await open(w, h, '?lang=en');
    await page.waitForTimeout(600);
    await shot(page, `${tag}_1_idle`);
    checkGeom(tag, await page.evaluate(GEOM), w, h);

    const r1 = await playForced(page, tag, 'BASE', SEED.big, true);
    await page.waitForTimeout(350); await shot(page, `${tag}_2_spin`);
    await bannerUp(page).catch(() => bad(tag, 'не появилась плашка крупного выигрыша'));
    await page.waitForTimeout(900); await shot(page, `${tag}_3_bigwin`);
    checkGeom(tag + ' (крупный выигрыш)', await page.evaluate(GEOM), w, h);
    await r1.done();
    await page.waitForTimeout(2300); await shot(page, `${tag}_4_lines`);

    await page.click('#btnTurbo');
    const r2 = await playForced(page, tag, 'BASE', SEED.bonus, true);
    await page.waitForFunction(() => window.__game.state.fs, null, { timeout: 20000 }).catch(() => bad(tag, 'не начались фриспины'));
    await page.waitForTimeout(350); await shot(page, `${tag}_5_fs_start`);
    await page.waitForFunction(() => window.__game.state.sticky > 0 && document.getElementById('bigwin').hidden, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(500); await shot(page, `${tag}_6_fs`);
    checkGeom(tag + ' (фриспины)', await page.evaluate(GEOM), w, h);
    await page.waitForFunction(() => window.__game.state.fs && !document.getElementById('bigwin').hidden && !document.getElementById('bigwinAmount').hidden, null, { timeout: 120000 }).catch(() => bad(tag, 'нет итога бонуса'));
    await page.waitForTimeout(700); await shot(page, `${tag}_7_fs_total`);
    const st = await r2.done();

    await page.click('#btnMenu'); await page.waitForTimeout(250); await shot(page, `${tag}_8a_menu`);
    checkGeom(tag + ' (меню)', await page.evaluate(GEOM), w, h);
    await page.click('#btnInfo'); await page.waitForTimeout(250); await shot(page, `${tag}_8_info`);
    checkGeom(tag + ' (правила)', await page.evaluate(GEOM), w, h); await page.keyboard.press('Escape');
    await page.click('#btnMenu'); await page.click('#btnSettings'); await page.waitForTimeout(200); await shot(page, `${tag}_8b_settings`);
    checkGeom(tag + ' (настройки)', await page.evaluate(GEOM), w, h); await page.keyboard.press('Escape');
    await page.click('#btnBonus'); await page.waitForTimeout(250); await shot(page, `${tag}_9_modes`);
    checkGeom(tag + ' (режимы)', await page.evaluate(GEOM), w, h);
    await page.click('#buySUPER'); await page.waitForTimeout(200); await shot(page, `${tag}_9a_confirm`);
    checkGeom(tag + ' (подтверждение)', await page.evaluate(GEOM), w, h); await page.click('#buyCancel');
    await page.click('#anteANTE2'); await page.waitForTimeout(200); await shot(page, `${tag}_9b_modes_ante`);
    checkGeom(tag + ' (режимы, анте)', await page.evaluate(GEOM), w, h); await page.click('#bonusClose'); await page.waitForTimeout(150);
    await shot(page, `${tag}_9c_ante`); checkGeom(tag + ' (анте включён)', await page.evaluate(GEOM), w, h); await page.click('#btnBonus');
    await page.click('#btnBet'); await page.waitForTimeout(200); await shot(page, `${tag}_10_bet`);
    checkGeom(tag + ' (ставки)', await page.evaluate(GEOM), w, h); await page.keyboard.press('Escape');
    await page.click('#btnAuto'); await page.waitForTimeout(200); await shot(page, `${tag}_11_auto`);
    checkGeom(tag + ' (автоигра)', await page.evaluate(GEOM), w, h); await page.keyboard.press('Escape');

    finish(errs, tag);
    console.log(`${tag}  mode=${st.mode}  build=${st.build}  ошибок консоли: ${errs.length}`);
    await ctx.close();
  }
});

/* ================= ui ================= */
await run('ui', async () => {
  const css = (page, sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
  // 1) верхняя строка «Balance | Win | Bet» и нижняя строка кнопок; на десктопе центр Win = центр спина
  const centres = [];
  for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 768], [1600, 900], [1366, 768]]) {
    const tag = `панель ${w}x${h}`, { ctx, page, errs } = await open(w, h, '?lang=en');
    const g = {}; for (const id of ['balanceBox', 'winBox', 'betGroup', 'betBox', 'btnBetDown', 'btnBetUp', 'btnMenu', 'btnBonus', 'btnSpin', 'btnTurbo', 'btnAuto', 'board']) g[id] = await rect(page, '#' + id);
    centres.push(`${w}×${h}: Win ${g.winBox.cx.toFixed(2)} / Spin ${g.btnSpin.cx.toFixed(2)}`);
    if (Math.abs(g.winBox.cx - g.btnSpin.cx) > 0.5) bad(tag, `центр Win ${g.winBox.cx} ≠ центр спина ${g.btnSpin.cx}`);
    if (Math.abs(g.winBox.cx - g.board.cx) > 0.5) bad(tag, `Win не под центром поля: ${g.winBox.cx} против ${g.board.cx}`);
    if (g.winBox.b > g.btnSpin.y + 1) bad(tag, 'Win не над кнопкой спина');
    if (!(g.balanceBox.r <= g.winBox.x && g.winBox.r <= g.betGroup.x) || Math.abs(g.balanceBox.cy - g.winBox.cy) > 1 || Math.abs(g.betBox.cy - g.winBox.cy) > 1) bad(tag, 'верхняя строка не «Balance | Win | Bet»');
    if (!(g.btnBetDown.r <= g.betBox.x + 1 && g.btnBetUp.x >= g.betBox.r - 1)) bad(tag, 'кнопки − и + не по сторонам от Bet');
    if (!(g.btnMenu.r <= g.btnBonus.x && g.btnBonus.r < g.btnSpin.x && g.btnSpin.r < g.btnTurbo.x && g.btnTurbo.r <= g.btnAuto.x)) bad(tag, 'нижняя строка не «Menu Bonus | Spin | Turbo Autoplay»');
    for (const id of ['btnMenu', 'btnBonus']) if (Math.abs(g[id].w - g[id].h) > 0.5 || !(parseFloat(await css(page, '#' + id, 'borderTopLeftRadius')) >= 10)) bad(tag, id + ' не квадратная со скруглением');
    if (g.btnSpin.w < g.btnMenu.w * 1.25) bad(tag, 'спин не крупнее остальных кнопок');
    const green = await page.evaluate(() => getComputedStyle(document.getElementById('btnSpin')).getPropertyValue('--c').trim() + '|' + getComputedStyle(document.getElementById('app')).getPropertyValue('--spin').trim());
    if (!/2fb364/i.test(green)) bad(tag, 'спин не зелёный: ' + green);
    finish(errs, tag); await ctx.close();
  }
  console.log('ui: центры Win и спина — ' + centres.join('; '));

  // 2) меню, звук, настройки, анте, турбо
  {
    const { ctx, page, errs } = await open(1280, 720, '?lang=en');
    const icons = () => page.evaluate(() => { const d = s => getComputedStyle(document.querySelector(s)).display !== 'none'; return { bars: d('#btnMenu .ico-bars'), x: d('#btnMenu .ico-x'), open: !document.getElementById('menuPop').hidden, exp: document.getElementById('btnMenu').getAttribute('aria-expanded') }; });
    let m = await icons();
    if (!m.bars || m.x || m.open || await text(page, '#btnMenu .cap') !== 'Menu') bad('меню', 'закрытое меню: ' + JSON.stringify(m));
    await page.click('#btnMenu'); await page.waitForTimeout(250); m = await icons();
    if (m.bars || !m.x || !m.open || m.exp !== 'true') bad('меню', 'открытое меню — нет крестика: ' + JSON.stringify(m));
    const items = await page.evaluate(() => Array.from(document.querySelectorAll('#menuPop button')).map(b => b.id + ':' + b.querySelector('.cap').textContent));
    if (items.join() !== 'btnInfo:Info,btnSettings:Settings,btnSound:Sound') bad('меню', 'пункты меню: ' + items.join());
    const pop = await rect(page, '#menuPop'), mb = await rect(page, '#btnMenu');
    if (pop.b > mb.y + 0.5 || mb.cx < pop.x || mb.cx > pop.r) bad('меню', 'меню раскрылось не вверх над кнопкой Menu');
    // звук
    const snd = () => page.evaluate(() => { const b = document.getElementById('btnSound'), cs = getComputedStyle(b), d = s => getComputedStyle(b.querySelector(s)).display !== 'none';
      return { off: b.classList.contains('off'), pressed: b.getAttribute('aria-pressed'), on: d('.ico-on'), cross: d('.ico-off'), color: cs.color, shadow: cs.boxShadow, filter: cs.filter, bg: cs.getPropertyValue('--c').trim(), sound: window.__game.state.sound }; });
    let s1 = await snd();
    if (s1.off || !s1.on || s1.cross || s1.color !== 'rgb(255, 255, 255)' || !/59, 224, 127/.test(s1.shadow) || !s1.sound) bad('звук', 'включённый звук: ' + JSON.stringify(s1));
    await page.click('#btnSound'); await page.waitForTimeout(200); await shot(page, 'ui_menu_sound_off');
    let s2 = await snd();
    if (!s2.off || s2.on || !s2.cross || s2.color === 'rgb(255, 255, 255)' || /59, 224, 127/.test(s2.shadow) || !/brightness/.test(s2.filter) || s2.sound || s2.pressed !== 'false') bad('звук', 'выключенный звук: ' + JSON.stringify(s2));
    if (!(await icons()).open) bad('меню', 'переключение звука закрыло меню');
    await page.reload(); await enter(page);
    if ((await state(page)).sound) bad('звук', 'выключенный звук не сохранился после перезагрузки');
    await page.click('#btnMenu'); await page.click('#btnSound'); await page.waitForTimeout(150); await shot(page, 'ui_menu_sound_on');
    if (!(await state(page)).sound) bad('звук', 'звук не включился обратно');
    await page.mouse.click(900, 200); await page.waitForTimeout(100);
    if ((await icons()).open) bad('меню', 'клик мимо не закрыл меню');
    await page.click('#btnMenu'); await page.keyboard.press('Escape'); if ((await icons()).open) bad('меню', 'Escape не закрыл меню');
    // интро студии и заставка: видео стартует, тап пропускает, «Press to continue» запускает звук; в портрете заставка влезает целиком
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }), p2 = await c2.newPage(), e2 = [];
      p2.on('pageerror', e => e2.push(e.message)); p2.on('console', m => { if (m.type() === 'error') e2.push(m.text()); });
      const t0 = Date.now(); await p2.goto(base + '?lang=en');
      await p2.waitForFunction(() => !document.getElementById('intro').hidden, null, { timeout: 5000 }).catch(() => bad('интро', w + 'x' + h + ': интро не показано'));
      const vid = await p2.waitForFunction(() => { const v = document.getElementById('introVideo'); return v.currentTime > 0.2 && !v.paused ? [v.videoWidth, v.videoHeight, v.muted] : null; }, null, { timeout: 4000 }).then(h => h.jsonValue()).catch(() => null);
      if (!vid || !vid[2]) bad('интро', w + 'x' + h + ': видео не стартовало или со звуком: ' + JSON.stringify(vid));
      const geo = await p2.evaluate(() => { const r = document.getElementById('intro').getBoundingClientRect(); return [r.width, r.height, getComputedStyle(document.getElementById('intro')).backgroundColor]; });
      if (Math.round(geo[0]) !== w || Math.round(geo[1]) !== h || geo[2] !== 'rgb(0, 0, 0)') bad('интро', w + 'x' + h + ': не на чёрном во весь экран: ' + JSON.stringify(geo));
      await p2.waitForTimeout(400); await shot(p2, `intro_${w}x${h}_1_video`);
      if (w === 1280) { await p2.click('#intro'); await p2.waitForTimeout(450); if (!(await p2.evaluate(() => document.getElementById('intro').hidden))) bad('интро', 'тап не пропустил видео'); }
      else { await p2.waitForFunction(() => document.getElementById('intro').hidden, null, { timeout: 9000 }).catch(() => bad('интро', 'видео не завершилось само')); if (Date.now() - t0 < 3500) bad('интро', 'видео закончилось слишком рано: ' + (Date.now() - t0) + ' мс'); }
      await p2.waitForFunction(() => document.getElementById('loader').classList.contains('ready'), null, { timeout: 20000 }).catch(() => bad('заставка', 'не дождались «Press to continue»'));
      const sp = await p2.evaluate(() => {
        const ld = document.getElementById('loader'), out = { text: document.getElementById('ldText').textContent, planks: ld.querySelectorAll('.ld-plank').length, clouds: ld.querySelectorAll('.cloud').length, over: [], tops: [] };
        for (const el of ld.querySelectorAll('.ld-logo, .ld-plank .board, #ldText')) { const r = el.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) out.over.push(el.className || el.id); }
        ld.querySelectorAll('.ld-plank .board').forEach(b => out.tops.push(Math.round(b.getBoundingClientRect().top)));
        out.sway = getComputedStyle(ld.querySelector('.ld-logo')).animationName; out.swing = getComputedStyle(ld.querySelector('.ld-plank')).animationName; out.drift = getComputedStyle(ld.querySelector('.cloud')).animationName;
        return out; });
      if (sp.text !== 'Press to continue' || sp.planks !== 3 || sp.clouds < 2 || sp.over.length || new Set(sp.tops).size !== 3 || sp.sway !== 'sway' || sp.swing !== 'swing' || sp.drift !== 'cloud') bad('заставка', w + 'x' + h + ': ' + JSON.stringify(sp));
      await shot(p2, `intro_${w}x${h}_2_splash`);
      if ((await state(p2)).ready) bad('заставка', 'игра стала готова до тапа');
      await p2.click('#loader'); await p2.waitForFunction(() => window.__game.ready && document.getElementById('loader').hidden, null, { timeout: 5000 }).catch(() => bad('заставка', 'тап не запустил игру'));
      const snd = await p2.evaluate(() => !!(window.__game.sndCtx && window.__game.sndCtx !== 'closed'));
      if (!snd) bad('заставка', 'тап не запустил звук');
      finish(e2, 'интро ' + w + 'x' + h); await c2.close();
    }
    // звук: файлы загружены, события раунда с бонусом дают нужные эффекты, музыка переключается по режиму
    {
      const c3 = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }), p3 = await c3.newPage(), e3 = [];
      p3.on('pageerror', e => e3.push(e.message)); p3.on('console', m => { if (m.type() === 'error') e3.push(m.text()); });
      await p3.goto(base + '?lang=en&intro=0'); await enter(p3);
      await p3.waitForFunction(() => window.__game.sndLog.loaded >= 39 && window.__game.sndLog.musicLoaded >= 4, null, { timeout: 30000 }).catch(() => bad('звук', 'не все файлы загрузились: ' + JSON.stringify(p3.evaluate(() => window.__game.sndLog))));
      const s0 = await p3.evaluate(() => window.__game.sndLog);
      if (s0.music !== 'base') bad('звук', 'в базовой игре не играет music_base: ' + s0.music);
      await p3.evaluate(() => window.__game.sndClear()); await p3.click('#btnTurbo');
      const rb = await playForced(p3, 'звук', 'BASE', SEED.bonus);
      await p3.waitForFunction(() => window.__game.state.fs, null, { timeout: 20000 }).catch(() => {});
      const inFs = await p3.evaluate(() => window.__game.sndLog.music);
      await rb.done(); await p3.waitForTimeout(600);
      const sl = await p3.evaluate(() => window.__game.sndLog), L = sl.log, has = n => L.some(x => x === n), count = n => L.filter(x => x === n).length;
      const missing = ['spin_start', 'reel_spin_loop', 'reel_stop', 'scatter_land_1', 'scatter_land_2', 'scatter_land_3', 'bonus_trigger', 'fs_intro', 'wild_sticky', 'count_loop', 'count_end', 'bonus_end'].filter(n => !has(n));
      const unloaded = L.filter(x => x.endsWith('?'));
      if (missing.length || unloaded.length || count('reel_stop') < 5 || inFs !== 'fs' || sl.music !== 'base') bad('звук', `нет событий: [${missing}], без файла: [${[...new Set(unloaded)]}], reel_stop ${count('reel_stop')}, музыка во фриспинах ${inFs}, после ${sl.music}`);
      if (!L.some(x => /^win_(small|medium|large)$/.test(x))) bad('звук', 'нет звука выигрыша линии');
      console.log('звук: файлов ' + sl.loaded + ' + музыки ' + sl.musicLoaded + '; за бонусный раунд событий ' + L.length + ', уникальных: ' + [...new Set(L)].join(' '));
      finish(e3, 'звук'); await c3.close();
    }
    // Info — единственный пункт с правилами и таблицей выплат
    await openInfo(page); const info = await text(page, '#infoSheet');
    if (!(await visible(page, '#infoModal')) || !info.includes('Paytable') || !info.includes('Free spins — trigger and retrigger')) bad('меню', 'Info не открыл правила с таблицей выплат');
    // порядок разделов и юридический текст в самом низу
    const order = await page.evaluate(() => Array.from(document.querySelectorAll('#infoSheet h3')).map(e => e.textContent));
    const want = ['Special symbols', 'Lines', 'Paytable', 'How WILD works', 'Free spins — trigger and retrigger', 'Bonus modes', 'Max win'];
    if (JSON.stringify(order) !== JSON.stringify(want)) bad('правила', 'порядок разделов: ' + order.join(' / '));
    const last = await page.evaluate(() => document.querySelector('#infoSheet > :last-child').textContent);
    if (!last.startsWith('Malfunction voids all wins and plays.') || !/TM and © \d{4} Engine\.$/.test(last)) bad('правила', 'юридический текст не в самом низу: ' + last.slice(0, 60));
    for (const need of ['Lands on reels 2, 3, 4', '×2, ×3, ×5', '×2, ×3, ×5, ×10', 'at most 40 free spins', 'once in 80 spins instead of once in 400', 'once in 32 spins instead of once in 400', '15,000× the bet amount', 'one line can reach ×1,000'])
      if (!info.includes(need)) bad('правила', 'нет «' + need + '»');
    const shots = await page.evaluate(() => [document.querySelectorAll('#infoSheet .ipay tr').length - 1, document.querySelectorAll('#infoSheet .ilines figure').length, document.querySelectorAll('#infoSheet .itbl').length]);
    if (shots[0] !== 8 || shots[1] !== 5 || shots[2] !== 2) bad('правила', 'таблица выплат / схема линий / таблицы фриспинов: ' + shots.join(' / '));
    await page.click('#infoClose'); if (await visible(page, '#infoModal')) bad('правила', 'круглый крестик не закрыл Info');
    await openInfo(page);
    if ((await icons()).open) bad('меню', 'меню осталось открытым поверх правил');
    await page.keyboard.press('Escape');
    // настройки: пробел можно выключить
    await page.click('#btnTurbo');
    await page.click('#btnMenu'); await page.click('#btnSettings'); await page.waitForTimeout(100);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#settingsModal .setrow')).filter(r => !r.hidden).map(r => r.querySelector('span').textContent + '=' + r.querySelector('.switch').getAttribute('aria-checked')));
    if (rows.join('|') !== 'Music=true|Sound effects=true|Space bar starts a spin=true') bad('настройки', 'строки: ' + rows.join('|'));
    await page.click('#swSpace'); await page.click('#settingsClose');
    await page.evaluate(s => window.__game.force(s), SEED.lose);
    await page.keyboard.press('Space'); await page.waitForTimeout(600);
    if ((await state(page)).log.length) bad('настройки', 'пробел выключен в настройках, но раунд запустился');
    await page.click('#btnMenu'); await page.click('#btnSettings'); await page.click('#swSpace'); await page.keyboard.press('Escape');
    await page.keyboard.press('Space'); await started(page).catch(() => bad('настройки', 'пробел включён, но раунд не запустился')); await idle(page);
    // строки сообщений нет (убрана по заданию); небольшой выигрыш — без таблички
    if (await page.$('#msg')) bad('сообщения', 'строка сообщений не должна существовать');
    await page.evaluate(s => window.__game.force(s), SEED.small); await page.keyboard.press('Space'); await started(page);
    await idle(page);
    if (!(await page.evaluate(() => document.getElementById('bigwin').hidden))) bad('таблички', 'табличка показана при выигрыше меньше 15× ставки');
    const mult = book('BASE', SEED.small).payoutMultiplier / 100;
    if (await text(page, '#multVal') !== '×' + mult.toLocaleString('en-US', { maximumFractionDigits: 2 })) bad('HUD', `множитель раунда «${await text(page, '#multVal')}», ожидался ×${mult}`);
    // анте: реальная цена в Bet, бейдж ×K, золотая кнопка Deactivate
    const gold = await page.evaluate(() => getComputedStyle(document.getElementById('app')).getPropertyValue('--gold').trim());
    await page.click('#btnBonus'); await page.click('#anteANTE2'); await page.click('#bonusClose'); await page.waitForTimeout(150);
    const a = await page.evaluate(() => { const b = document.getElementById('btnBonus'), cs = getComputedStyle(b), d = s => getComputedStyle(b.querySelector(s)).display !== 'none';
      return { bet: document.getElementById('betVal').textContent, badge: document.getElementById('anteBadge').hidden ? null : document.getElementById('anteBadge').textContent, cap: document.getElementById('bonusVal').textContent, tt: getComputedStyle(document.getElementById('bonusVal')).textTransform, c: cs.getPropertyValue('--c').trim(), on: b.classList.contains('on'), off: d('.ico-off'), star: d('.ico-bonus') }; });
    if (a.bet !== '$2.00' || a.badge !== '×2' || a.cap !== 'Deactivate' || a.tt !== 'uppercase' || !a.on || a.c !== gold && a.c !== 'var(--gold)' || !a.off || a.star) bad('анте', 'панель при анте: ' + JSON.stringify(a) + ' gold=' + gold);
    if (!(await visible(page, '#anteBadge'))) bad('анте', 'бейдж ×K не виден');
    await shot(page, 'ui_ante_on'); checkGeom('ui анте', await page.evaluate(GEOM), 1280, 720);
    await page.click('#btnBetUp'); if (await text(page, '#betVal') !== '$4.00') bad('анте', 'цена после +: ' + await text(page, '#betVal')); await page.click('#btnBetDown');
    await page.click('#btnBonus'); await page.waitForTimeout(100);
    const a2 = { ante: (await state(page)).ante, bet: await text(page, '#betVal'), badge: await visible(page, '#anteBadge'), cap: await text(page, '#bonusVal'), modal: await visible(page, '#bonusModal') };
    if (a2.ante || a2.bet !== '$1.00' || a2.badge || a2.cap !== 'Bonus' || a2.modal) bad('анте', 'Deactivate не выключил режим одним нажатием: ' + JSON.stringify(a2));
    // бонус-меню: три доски, бейдж, название, описание, волатильность, цена ×N и в валюте, кнопка
    await page.click('#btnBonus'); await page.waitForTimeout(200);
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('#modeCards .modecard')).map(c => ({ mode: c.dataset.mode, plank: c.classList.contains('plank'), img: c.querySelector('img').naturalWidth > 0 && /mode_/.test(c.querySelector('img').src),
      name: c.querySelector('b').textContent, desc: c.querySelector('.desc').textContent.length > 10, vol: c.querySelector('.vol').textContent, bars: c.querySelectorAll('.bars i.f').length + '/' + c.querySelectorAll('.bars i').length,
      price: c.querySelector('.price').childNodes[0].textContent, cur: c.querySelector('.price small').textContent, btn: (c.querySelector('button span') || c.querySelector('button')).textContent, dis: c.querySelector('button').disabled, why: (c.querySelector('.why') || {}).textContent || '' })));
    const wantCards = [['ANTE', 'Ante', '2× / 4×', '$2.00 / $4.00', 'Activate'], ['BONUS', 'Free spins', '100×', '$100.00', 'Buy'], ['SUPER', 'Super free spins', '300×', '$300.00', 'Buy'], ['LANTERN', 'Lantern spins', '75×', '$75.00', 'Buy'], ['FOLD', 'Fold spins', '150×', '$150.00', 'Buy']];
    if (cards.length !== wantCards.length) bad('бонус-меню', 'досок не ' + wantCards.length + ': ' + cards.length);
    cards.forEach((c, i) => { const w = wantCards[i]; if (!w || c.mode !== w[0] || c.name !== w[1] || c.price !== w[2] || c.cur !== w[3] || c.btn !== w[4] || !c.plank || !c.img || !c.desc || c.vol !== 'VolatilityHigh' || c.bars !== '4/5' || c.dis || c.why) bad('бонус-меню', 'доска ' + i + ': ' + JSON.stringify(c)); });
    if (await text(page, '#bmBetVal') !== '$1.00' || await text(page, '#bonusModal h2') !== 'Bonus modes') bad('бонус-меню', 'шапка: ' + await text(page, '#bonusModal h2') + ' / ' + await text(page, '#bmBetVal'));
    await page.click('#bmBetUp'); await page.waitForTimeout(100);
    const p2 = await page.evaluate(() => Array.from(document.querySelectorAll('#modeCards .price small')).map(e => e.textContent).join());
    if (p2 !== '$4.00 / $8.00,$200.00,$600.00,$150.00,$300.00' || await text(page, '#bmBetVal') !== '$2.00' || (await state(page)).bet !== 2 * U) bad('бонус-меню', 'ставка + в меню: ' + p2);
    await page.click('#bmBetDown');
    // анте включён — покупки недоступны, с подписью почему
    await page.click('#anteANTE2'); await page.waitForTimeout(150); await shot(page, 'ui_bonus_locked');
    const lock = await page.evaluate(() => ({ ante: document.querySelector('#anteANTE2 > span').textContent, b: document.getElementById('buyBONUS').disabled, s: document.getElementById('buySUPER').disabled && document.getElementById('buyLANTERN').disabled && document.getElementById('buyFOLD').disabled, why: Array.from(document.querySelectorAll('#modeCards .why')).map(e => e.textContent) }));
    if (lock.ante !== 'Deactivate' || !lock.b || !lock.s || lock.why.length !== 4 || lock.why[0] !== 'Bonus buys are unavailable while Ante is on. Deactivate Ante first.') bad('бонус-меню', 'при анте покупки должны быть закрыты: ' + JSON.stringify(lock));
    await page.click('#buyBONUS', { force: true }).catch(() => {}); if (await visible(page, '#bonusConfirm')) bad('бонус-меню', 'при анте открылось подтверждение покупки');
    await page.click('#anteANTE2'); await page.waitForTimeout(100);
    if (await page.isDisabled('#buyBONUS') || await page.evaluate(() => document.querySelectorAll('#modeCards .why').length)) bad('бонус-меню', 'после Deactivate покупки не открылись');
    // подтверждение на такой же доске
    await page.click('#buyBONUS'); await page.waitForTimeout(150);
    const conf = await page.evaluate(() => ({ plank: document.getElementById('bonusConfirm').classList.contains('plank'), cards: document.getElementById('modeCards').hidden, q: document.getElementById('buyQ').textContent, price: document.getElementById('buyPrice').textContent, ok: document.getElementById('buyConfirm').textContent, img: /mode_bonus/.test(document.getElementById('buyImg').src) }));
    if (!conf.plank || !conf.cards || conf.q !== 'Buy Free spins?' || conf.price !== '100× · $100.00' || conf.ok !== 'Buy for $100.00' || !conf.img) bad('бонус-меню', 'подтверждение: ' + JSON.stringify(conf));
    checkGeom('ui подтверждение', await page.evaluate(GEOM), 1280, 720);
    await page.click('#buyCancel'); if (!(await visible(page, '#modeCards')) || await visible(page, '#bonusConfirm')) bad('бонус-меню', 'Cancel не вернул к доскам');
    await page.click('#bonusClose'); if (await visible(page, '#bonusModal')) bad('бонус-меню', 'крестик не закрыл меню');
    finish(errs, 'ui'); await ctx.close();
  }
  // 3) турбо ускоряет и барабаны, и показ выигрыша
  {
    const time = async turbo => {
      const { ctx, page, errs } = await open(1280, 720, '?lang=en');
      if (turbo) { await page.click('#btnTurbo'); if (await page.getAttribute('#btnTurbo', 'aria-pressed') !== 'true') bad('турбо', 'кнопка не отмечена нажатой'); }
      const out = [];
      for (const seed of [SEED.lose, SEED.small]) { await page.evaluate(s => window.__game.force(s), seed); const t0 = Date.now(); await page.click('#btnSpin'); await started(page); await idle(page); out.push(Date.now() - t0); }
      finish(errs, 'турбо'); await ctx.close(); return out;
    };
    const slow = await time(false), fast = await time(true);
    if (fast[0] > slow[0] * 0.7 || fast[1] > slow[1] * 0.75) bad('турбо', `турбо не ускоряет: обычный ${slow} мс, турбо ${fast} мс`);
    console.log(`ui: турбо — пустой раунд ${slow[0]} → ${fast[0]} мс, раунд с выигрышем ${slow[1]} → ${fast[1]} мс`);
  }
  // 4) портрет: логотип слева вверху, HUD справа вверху, табличка фриспинов на верхней планке, поле по всей ширине, Turbo и Autoplay в правом нижнем углу
  for (const [w, h] of [[390, 844], [375, 667], [600, 900]]) {
    const tag = `портрет ${w}x${h}`, { ctx, page, errs } = await open(w, h, '?lang=en');
    await page.click('#btnTurbo'); const r = await playForced(page, tag, 'BASE', SEED.bonus);
    await page.waitForFunction(() => window.__game.state.fs && document.getElementById('bigwin').hidden, null, { timeout: 40000 }).catch(() => bad(tag, 'не начались фриспины'));
    await page.waitForTimeout(300);
    const g = {}; for (const id of ['logo', 'multHud', 'fsBox', 'board', 'btnTurbo', 'btnAuto', 'btnSpin', 'panel', 'btnMenu']) g[id] = await rect(page, '#' + id);
    const frame = g.board.w / 0.94 * 0.03, top = g.board.y - frame;   // рамка — 3% стороны
    if (g.logo.x > w * 0.08 || g.logo.cy > top || g.logo.r > g.multHud.x) bad(tag, 'логотип не слева вверху');
    if (g.multHud.r < w * 0.92 || g.multHud.cy > top || g.multHud.b > top + 1) bad(tag, 'HUD множителя не справа вверху');
    if (Math.abs(g.fsBox.cx - g.board.cx) > 1 || g.fsBox.y > top || g.fsBox.b < top + frame * 0.5 || g.fsBox.b > g.board.y + g.board.h * 0.08) bad(tag, `табличка фриспинов не на верхней планке рамки: ${g.fsBox.y.toFixed(1)}…${g.fsBox.b.toFixed(1)}, планка ${top.toFixed(1)}…${g.board.y.toFixed(1)}`);
    if (g.fsBox.x < g.logo.r - 1 && g.fsBox.y < g.logo.b - 1 || g.fsBox.r > g.multHud.x + 1 && g.fsBox.y < g.multHud.b - 1) bad(tag, 'табличка фриспинов наезжает на логотип или HUD');
    if (g.board.w / 0.94 < w * 0.93 && g.board.y + g.board.h < g.panel.y - 30) bad(tag, `поле не по всей ширине: ${(g.board.w / 0.94).toFixed(0)} из ${w}`);
    if (g.btnAuto.r < w - Math.max(14, w * 0.04) || g.btnAuto.b < h - Math.max(16, h * 0.03) || g.btnTurbo.r > g.btnAuto.x + 1 || Math.abs(g.btnTurbo.b - g.btnAuto.b) > 1) bad(tag, `Turbo и Autoplay не прижаты к правому нижнему краю: [${g.btnAuto.r.toFixed(0)}, ${g.btnAuto.b.toFixed(0)}]`);
    if (g.panel.h > h * 0.3) bad(tag, `панель не компактная: ${g.panel.h.toFixed(0)} px из ${h}`);
    checkGeom(tag + ' (фриспины)', await page.evaluate(GEOM), w, h); await shot(page, `ui_portrait_${w}x${h}_fs`);
    await r.done(); finish(errs, tag); await ctx.close();
  }
  // 5) числа на HUD масштабируются от самого элемента (container units), а не от ширины экрана
  {
    const { ctx, page, errs } = await open(390, 844, '?lang=en');
    const res = await page.evaluate(() => {
      const fs = s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize), out = {};
      document.getElementById('fsBox').hidden = false; document.getElementById('fsVal').textContent = '3 / 8'; document.getElementById('fsLbl').textContent = 'Free spins';
      for (const [name, boxSel, textSel] of [['balance', '#balanceBox', '#balanceVal'], ['win', '#winBox', '#winVal'], ['bet', '#betBox', '#betVal'], ['fs', '#fsBox', '#fsVal'], ['mult', '#multHud', '#multVal']]) {
        const box = document.querySelector(boxSel), el = document.querySelector(textSel);
        el.style.setProperty('--k', '1'); const a = fs(textSel), h0 = box.getBoundingClientRect().height, w0 = box.getBoundingClientRect().width;
        box.style.height = h0 * 2 + 'px'; box.style.width = w0 * 2 + 'px'; box.style.flex = 'none'; el.style.setProperty('--k', '1');
        const b = fs(textSel); box.style.height = h0 + 'px'; box.style.width = w0 + 'px';
        out[name] = [a, b, getComputedStyle(box).containerType || getComputedStyle(el.closest('.box, #multHud, #fsBox') || box).containerType];
      }
      return out;
    });
    for (const [k, v] of Object.entries(res)) if (!(v[1] > v[0] * 1.9 && v[1] < v[0] * 2.1)) bad('единицы контейнера', `${k}: шрифт ${v[0]} → ${v[1]} px при удвоении элемента (должен удвоиться)`);
    const src = fs.readFileSync(path.join(BUILD, 'index.html'), 'utf8').split('<style id="fonts">')[0];
    const vwInHud = (src.match(/#(?:fsBox|multHud|balanceBox|winBox|betBox)[^{}]*\{[^}]*\b\d[\d.]*v[wh]\b[^}]*\}/g) || []).concat(src.match(/\.(?:tag|hud)[^{}]*\{[^}]*font[^};]*\d[\d.]*v(?:w|h|min|max)\b[^}]*\}/g) || []);
    if (vwInHud.length) bad('единицы контейнера', 'в стилях HUD остались vw/vh: ' + vwInHud[0].slice(0, 80));
    console.log('ui: шрифт чисел при удвоении элемента (px) — ' + Object.entries(res).map(([k, v]) => `${k} ${v[0].toFixed(1)}→${v[1].toFixed(1)}`).join(', '));
    finish(errs, 'единицы контейнера'); await ctx.close();
  }
  // 6) компактный режим: ландшафт на телефоне и маленький попап — кнопки меньше
  {
    const sizes = {};
    for (const [w, h] of [[1280, 720], [844, 390], [667, 375], [400, 225], [568, 320]]) {
      const tag = `компакт ${w}x${h}`, { ctx, page, errs } = await open(w, h, '?lang=en');
      const st = await state(page), sp = await rect(page, '#btnSpin'), mn = await rect(page, '#btnMenu'), pn = await rect(page, '#panel');
      const u = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('app')).getPropertyValue('--u')));   // единица панели
      sizes[tag] = `${st.mode}: спин ${sp.w.toFixed(0)} px (${(sp.w / h * 100).toFixed(0)}% высоты), панель ${(pn.h / h * 100).toFixed(0)}%`;
      if (h < 440) {
        if (st.mode !== 'compact') bad(tag, `режим ${st.mode}`);
        if (sp.w / u > 6 || mn.w / u > 4.6 || sp.w > 70) bad(tag, `кнопки не уменьшены: спин ${sp.w.toFixed(0)} px (${(sp.w / u).toFixed(1)} ед.), меню ${mn.w.toFixed(0)} px`);
        if (pn.h / h > 0.3) bad(tag, `панель занимает ${(pn.h / h * 100).toFixed(0)}% высоты`);
        if (h < 330 !== (await page.evaluate(() => !!document.getElementById('app').dataset.tiny))) bad(tag, 'признак маленького попапа выставлен неверно');
        checkGeom(tag, await page.evaluate(GEOM), w, h);
      } else if (st.mode !== 'desk' || sp.w / u < 6.5) bad(tag, 'на десктопе должны быть полноразмерные кнопки');
      finish(errs, tag); await ctx.close();
    }
    console.log('ui: ' + Object.entries(sizes).map(([k, v]) => k + ' — ' + v).join('; '));
  }
  // 7) телефон (coarse pointer, короткая сторона < 700): не грузим видео и большие декорации за кадром
  {
    const load = async (w, h, context) => {
      const urls = [];
      const { ctx, page, errs } = await open(w, h, '?lang=en', { context, before: async page => { page.on('request', r => urls.push(r.url().replace(base, '').split('?')[0])); } });
      await page.waitForTimeout(500);
      const st = await state(page), decor = await page.evaluate(() => document.querySelectorAll('.decor').length), video = await page.evaluate(() => document.querySelectorAll('video:not(#introVideo)').length);
      const bytes = urls.filter(u => u.startsWith('assets/')).reduce((a, u) => a + (fs.existsSync(path.join(BUILD, u)) ? fs.statSync(path.join(BUILD, u)).size : 0), 0);
      checkGeom(`загрузка ${w}x${h}`, await page.evaluate(GEOM), w, h);
      finish(errs, `загрузка ${w}x${h}`); await ctx.close(); return { urls, lite: st.lite, decor, video, bytes };
    };
    const touch = { hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
    const phoneP = await load(390, 844, touch), phoneL = await load(844, 390, touch), tablet = await load(1024, 768, touch), desk = await load(1920, 1080), small = await load(600, 400);
    const heavy = u => !/\/intro\//.test(u) && /decor_|\.webm$|\.mp4$|bg_land\.webp|bg_port\.webp/.test(u);   // интро студии играет и на телефоне
    for (const [name, r, bg] of [['телефон, портрет', phoneP, 'assets/bg/bg_port_s.webp'], ['телефон, ландшафт', phoneL, 'assets/bg/bg_land_s.webp']]) {
      if (!r.lite) bad('телефон', name + ': не распознан как телефон');
      const hv = r.urls.filter(heavy); if (hv.length || r.decor || r.video) bad('телефон', name + ': загружено лишнее — ' + hv.join(', ') + ` (декораций ${r.decor}, видео ${r.video})`);
      if (!r.urls.includes(bg)) bad('телефон', name + ': не загружен облегчённый фон ' + bg);
      if (r.urls.filter(u => /bg_(land|port)/.test(u)).length !== 1) bad('телефон', name + ': фон должен грузиться только для текущей ориентации — ' + r.urls.filter(u => /bg_/.test(u)).join(', '));
    }
    if (tablet.lite || !tablet.urls.includes('assets/bg/bg_land.webp')) bad('телефон', 'планшет 1024×768 ошибочно считается телефоном');
    if (desk.lite || desk.decor !== 2 || !desk.urls.includes('assets/bg/decor_left.webp') || !desk.urls.includes('assets/bg/bg_land.webp')) bad('телефон', 'на десктопе нет декораций или полного фона');
    if (small.lite || small.decor) bad('телефон', 'маленькое окно с мышью: lite=' + small.lite + ', декораций ' + small.decor);
    const kb = r => (r.bytes / 1024).toFixed(0) + ' КБ';
    console.log(`ui: загрузка ассетов — телефон портрет ${kb(phoneP)}, телефон ландшафт ${kb(phoneL)}, планшет ${kb(tablet)}, десктоп ${kb(desk)}; на телефоне нет decor_*, полноразмерных фонов и видео`);
  }
});

/* ================= demo ================= */
await run('demo', async () => {
  const { ctx, page, errs } = await open(1280, 720, '?lang=en');
  const cfg = await page.evaluate(() => ({ pay: window.__game.paytable, modes: window.__game.config.modes, maxWin: window.__game.config.maxWin, fs: window.__game.config.fsAward, re: window.__game.config.retrigger }));
  if (JSON.stringify(cfg.pay) !== JSON.stringify(M.CONFIG.paytable)) bad('демо', 'таблица выплат в index.html не совпадает с математикой');
  for (const m of Object.keys(M.CONFIG.modes)) if (!cfg.modes[m] || cfg.modes[m].cost !== M.CONFIG.modes[m].cost) bad('демо', 'цена режима ' + m + ' не совпадает с математикой');
  { const { spawnSync } = await import('node:child_process'); const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/check_rules.mjs')], { encoding: 'utf8' });
    if (r.status !== 0) bad('демо', 'правила не совпадают с математикой: ' + (r.stdout.split('РАСХОЖДЕНИЯ')[1] || r.stderr).trim().slice(0, 300)); }
  if (cfg.maxWin !== M.CONFIG.maxWin || JSON.stringify(cfg.fs) !== JSON.stringify(M.CONFIG.fsAward) || cfg.re.add !== M.CONFIG.retrigger.add) bad('демо', 'max win или таблица фриспинов не совпадают с математикой');

  await page.click('#btnTurbo');
  // анте через меню режимов, ставка через меню ставок, автоигра 10 раундов
  await page.click('#btnBonus'); await page.click('#anteANTE2');
  if (await text(page, '#anteANTE2 > span') !== 'Deactivate') bad('демо', 'после включения анте кнопка в меню не «Deactivate»');
  await page.click('#bonusClose');
  if (await text(page, '#bonusVal') !== 'Deactivate') bad('демо', 'главная кнопка при включённом анте не «Deactivate»: ' + await text(page, '#bonusVal'));
  await page.click('#btnBet'); await page.click('#betPills .pill:nth-child(7)');
  const s0 = await state(page);
  if (s0.bet !== 2 * U || !s0.ante || await text(page, '#betVal') !== '$4.00') bad('демо', `анте и ставка из меню: bet ${s0.bet / U}, ante ${s0.ante}, поле ${await text(page, '#betVal')}`);
  await page.click('#btnAuto'); await page.waitForTimeout(100);
  const opts = await page.evaluate(() => ['autoPills', 'autoLossPills', 'autoWinPills'].map(id => Array.from(document.querySelectorAll('#' + id + ' .pill')).map(p => p.textContent).join(' ')));
  if (opts[0] !== '10 25 50 100 500' || opts[1] !== 'No limit $20.00 $50.00 $100.00 $200.00' || opts[2] !== opts[1]) bad('демо', 'настройки автоигры: ' + JSON.stringify(opts));
  await page.click('#autoPills .pill:first-child'); await page.click('#autoStart');
  await page.waitForFunction(() => window.__game.state.auto > 0 && !document.getElementById('autoLeft').hidden, null, { timeout: 5000 }).catch(() => bad('демо', 'на кнопке автоигры нет счётчика'));
  const left = Number(await text(page, '#autoLeft')); if (!(left >= 8 && left <= 10)) bad('демо', 'счётчик на кнопке автоигры: ' + left);
  await shot(page, 'demo_auto_counter');
  await page.waitForFunction(() => window.__game.state.auto === 0 && !window.__game.busy, null, { timeout: 240000 });
  if (await visible(page, '#autoLeft')) bad('демо', 'счётчик автоигры остался после её конца');
  const s1 = await state(page);
  const spent = s1.log.reduce((a, r) => a + r.cost, 0), won = s1.log.reduce((a, r) => a + r.win, 0);
  if (s1.log.length !== 10 || s1.log.some(r => r.mode !== 'ANTE2' || r.cost !== 4 * U)) bad('демо', 'автоигра с анте — не те раунды: ' + JSON.stringify(s1.log.map(r => [r.mode, r.cost / U])));
  if (s1.balance !== s0.balance - spent + won) bad('демо', `баланс не сходится с журналом (${s1.balance / U} против ${(s0.balance - spent + won) / U})`);
  console.log(`демо: анте, автоигра 10 раундов — потрачено ${spent / U}, выиграно ${won / U}, баланс ${s1.balance / U}`);
  await page.click('#btnBonus');   // при включённом анте кнопка сразу его выключает
  if ((await state(page)).ante || await text(page, '#bonusVal') !== 'Bonus') bad('демо', 'кнопка «Deactivate» не выключила анте');
  await page.click('#btnBetDown');

  // лимиты автоигры: раунды заданы очередью сидов
  const auto = async (name, seeds, rounds, lossIdx, winIdx, wantRounds) => {
    const n0 = (await state(page)).log.length;
    await page.evaluate(q => window.__game.queue(q), seeds);
    await page.click('#btnAuto'); await page.click(`#autoPills .pill:nth-child(${rounds})`); await page.click(`#autoLossPills .pill:nth-child(${lossIdx})`); await page.click(`#autoWinPills .pill:nth-child(${winIdx})`);
    await page.click('#autoStart');
    await page.waitForFunction(() => window.__game.state.auto === 0 && !window.__game.busy, null, { timeout: 240000 });
    const st = await state(page), played = st.log.length - n0;
    await page.evaluate(() => window.__game.queue([]));
    if (played !== wantRounds) bad('демо', `автоигра, ${name}: сыграно ${played} раундов, ожидалось ${wantRounds}`);
    return played;
  };
  const lose = n => Array(n).fill(SEED.lose);
  const a1 = await auto('стоп по одиночному выигрышу ×10', lose(2).concat([SEED.small, SEED.big], lose(8)), 2, 1, 2, 4);     // 25 раундов; small (до 6×) не останавливает, big (от 15×) — да
  const a2 = await auto('стоп по падению баланса на 10 ставок', lose(25), 2, 2, 1, 10);                                     // 25 раундов, 10 проигрышей подряд
  const a3 = await auto('без лимитов', lose(10), 1, 1, 1, 10);
  // ручная остановка кнопкой автоигры
  await page.evaluate(q => window.__game.queue(q), lose(25));
  const n0 = (await state(page)).log.length;
  await page.click('#btnAuto'); await page.click('#autoPills .pill:nth-child(2)'); await page.click('#autoStart');
  await page.waitForFunction(n => window.__game.state.log.length >= n + 2, n0, { timeout: 60000 }); await page.click('#btnAuto');
  await page.waitForFunction(() => window.__game.state.auto === 0 && !window.__game.busy, null, { timeout: 60000 });
  const stopped = (await state(page)).log.length - n0; if (stopped > 4 || await visible(page, '#autoModal')) bad('демо', 'кнопка автоигры не остановила серию: сыграно ' + stopped);
  await page.evaluate(() => window.__game.queue([]));
  console.log(`демо: автоигра — стоп по выигрышу после ${a1} раундов, по падению баланса после ${a2}, без лимитов ${a3}, ручная остановка после ${stopped}`);

  await page.evaluate(s => window.__game.force(s), SEED.sup);
  const sb = await state(page);
  await page.click('#btnBonus'); await page.click('#buySUPER'); await page.waitForTimeout(150); await shot(page, 'demo_buy_confirm');
  if (await text(page, '#buyConfirm') !== 'Buy for $300.00') bad('демо', 'кнопка подтверждения: ' + await text(page, '#buyConfirm'));
  await page.click('#buyConfirm');
  await page.waitForFunction(() => window.__game.state.fs && window.__game.state.sticky >= 1, null, { timeout: 20000 }).catch(() => bad('демо', 'супербонус не стартовал с липкими вайлдами'));
  await idle(page, 180000);
  const ss = await state(page), supWin = Math.round(sb.bet * book('SUPER', SEED.sup).payoutMultiplier / 100);
  if (ss.win !== supWin || ss.balance !== sb.balance - 300 * sb.bet + supWin) bad('демо', `супербонус — выигрыш ${ss.win / U} (ожидался ${supWin / U}), баланс ${ss.balance / U}`);
  console.log(`демо: супербонус за ${300 * sb.bet / U} — выигрыш ${ss.win / U}`);

  const rr = await playForced(page, 'демо ретриггер', 'BONUS', SEED.retrig); const sr = await rr.done();
  const rc = await playForced(page, 'демо потолок', 'SUPER', SEED.cap);
  await page.waitForFunction(() => !document.getElementById('bigwin').hidden && !document.getElementById('bigwinAmount').hidden, null, { timeout: 180000 }).catch(() => bad('демо', 'нет плашки потолка'));
  await page.waitForTimeout(1500); await shot(page, 'demo_maxwin');
  const sc = await rc.done();
  if (sc.win !== M.CONFIG.maxWin * sc.bet) bad('демо', `потолок — выигрыш ${sc.win / U}, ожидался ${M.CONFIG.maxWin * sc.bet / U}`);
  console.log(`демо: ретриггер — выигрыш ${sr.win / U}; потолок — выигрыш ${sc.win / U} (${M.CONFIG.maxWin}× ставки)`);
  finish(errs, 'демо');
  await ctx.close();
});

/* ================= rgs ================= */
await run('rgs', async () => {
  // 1) rgs_url приходит голым хостом: запрос должен уйти на https://
  {
    const seen = [];
    const { ctx, page, errs } = await open(1280, 720, '?sessionID=abc&rgs_url=rgs.example.test&lang=en&currency=USD&device=mobile&social=false', { before: async page => {
      await page.route('**://rgs.example.test/**', route => {
        seen.push(route.request().method() + ' ' + route.request().url() + ' ' + (route.request().postData() || ''));
        route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ balance: { amount: 10 * U, currency: 'USD' }, config: { minBet: U, maxBet: 10 * U, stepBet: U, defaultBetLevel: U, betLevels: [U, 2 * U], jurisdiction: NO_FLAGS }, round: null }) });
      });
    } });
    if (seen.length !== 1 || !seen[0].startsWith('POST https://rgs.example.test/wallet/authenticate {"sessionID":"abc","language":"en"}')) bad('RGS', 'запрос к голому хосту: ' + JSON.stringify(seen));
    const dev = await page.evaluate(() => document.getElementById('app').dataset.device);
    if (dev !== 'mobile') bad('RGS', 'параметр device не учтён');
    finish(errs, 'RGS https'); await ctx.close();
  }
  // 2) основной сценарий
  const sid = 'base:1', s = session(sid);
  const { ctx, page, errs } = await open(1280, 720, liveUrl(sid), { allow: /расходятся с выплатой RGS/ });
  const expectBal = () => '€' + (s.balance / U).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const eur = v => '€' + v.toLocaleString('en-US', { minimumFractionDigits: 2 });
  const read = () => page.evaluate(() => ({ st: window.__game.state, bal: document.getElementById('balanceVal').textContent, win: document.getElementById('winVal').textContent,
    bet: document.getElementById('betVal').textContent, demo: !document.getElementById('demoTag').hidden }));
  // ставки из конфига: внутри minBet…maxBet и кратны stepBet
  let r = await read();
  const want = [0.2, 1, 2, 5, 50].map(v => v * U);
  if (JSON.stringify(r.st.betLevels) !== JSON.stringify(want)) bad('RGS', 'уровни ставок: ' + JSON.stringify(r.st.betLevels.map(v => v / U)) + ', ожидались ' + JSON.stringify(want.map(v => v / U)));
  if (r.bet !== '€2.00' || r.bal !== '€5,000.00') bad('RGS', 'ставка по умолчанию или баланс: ' + r.bet + ' / ' + r.bal);
  await page.click('#btnBetUp'); if (await text(page, '#betVal') !== '€5.00') bad('RGS', 'кнопка + : ' + await text(page, '#betVal'));
  await page.click('#btnBetUp');
  if (await text(page, '#betVal') !== '€50.00' || !(await page.isDisabled('#btnBetUp'))) bad('RGS', 'максимальная ставка: ' + await text(page, '#betVal'));
  await page.click('#btnBet'); await page.waitForTimeout(150);
  const pills = await page.evaluate(() => Array.from(document.querySelectorAll('#betPills .pill')).map(p => p.textContent));
  if (JSON.stringify(pills) !== JSON.stringify(['€0.20', '€1.00', '€2.00', '€5.00', '€50.00'])) bad('RGS', 'меню ставок: ' + JSON.stringify(pills));
  await shot(page, 'live_0_betmenu');
  await page.click('#betPills .pill:nth-child(1)'); if (await text(page, '#betVal') !== '€0.20' || !(await page.isDisabled('#btnBetDown'))) bad('RGS', 'минимальная ставка из меню: ' + await text(page, '#betVal'));
  await page.click('#btnBetUp'); await page.click('#btnBetUp');   // обратно на 2.00
  // обычный раунд: выплата из поля payout
  await page.keyboard.press('Space'); await started(page); await idle(page); await page.waitForTimeout(200);
  r = await read(); await shot(page, 'live_1_base');
  const w1 = eur(2 * book('BASE', SEED.big).payoutMultiplier / 100);
  if (r.win !== w1 || r.bal !== expectBal() || r.bet !== '€2.00') bad('RGS', 'обычный раунд — суммы: ' + JSON.stringify([r.win, r.bal, r.bet]) + ', ожидалось ' + w1 + ' / ' + expectBal());
  // покупка бонуса через меню: режим BONUS, сумма — базовая ставка
  await page.click('#btnBonus'); await page.click('#buyBONUS'); await page.click('#buyConfirm');
  await started(page); await idle(page, 240000); await page.waitForTimeout(200);
  r = await read();
  const w2 = eur(2 * book('BONUS', SEED.retrig).payoutMultiplier / 100);
  if (r.win !== w2 || r.bal !== expectBal()) bad('RGS', 'покупка бонуса — суммы: ' + JSON.stringify([r.win, r.bal]) + ', ожидалось ' + w2 + ' / ' + expectBal());
  // подменённый раунд: экран показывает то, что пришло, а не то, что «на доске»
  await page.keyboard.press('Space'); await started(page); await idle(page); await page.waitForTimeout(1000);
  r = await read(); await shot(page, 'live_3_playback_only');
  if (r.win !== '€15.54' || r.bal !== expectBal()) bad('RGS', 'презентация пересчитала раунд сама: ' + JSON.stringify([r.win, r.bal]));
  // события расходятся с выплатой сервера: на экране и в балансе — сумма сервера
  await page.keyboard.press('Space'); await started(page); await idle(page); await page.waitForTimeout(300);
  r = await read();
  if (r.win !== '€15.54' || r.bal !== expectBal()) bad('RGS', 'выплата взята не из ответа RGS: ' + JSON.stringify([r.win, r.bal]) + ', ожидалось €15.54 / ' + expectBal());
  // проигрыш: end-round не вызывается, баланс из ответа play
  await page.keyboard.press('Space'); await started(page); await idle(page); await page.waitForTimeout(200);
  r = await read();
  if (r.win !== '€0.00' || r.bal !== expectBal()) bad('RGS', 'проигрыш — суммы: ' + JSON.stringify([r.win, r.bal]));

  const seq = s.log.map(x => x[0].replace('/wallet/', '')).join(' ');
  const plays = s.log.filter(x => x[0] === '/wallet/play').map(x => x[1]);
  console.log(`RGS: ${seq} | баланс ${r.bal}`);
  if (seq !== 'authenticate play end-round play end-round play end-round play end-round play') bad('RGS', 'неверная последовательность запросов: ' + seq);
  if (plays.length !== 5 || plays.map(p => p.mode).join() !== 'BASE,BONUS,BASE,BASE,BASE' || plays.some(p => p.amount !== 2 * U || p.sessionID !== sid)) bad('RGS', 'неверные тела play: ' + JSON.stringify(plays));
  if (r.demo || !r.st.live) bad('RGS', 'игра не в боевом режиме');
  if (await page.evaluate(() => typeof window.SenbazuruMath !== 'undefined')) bad('RGS', 'в боевом режиме загружена демо-математика');
  // выбранная ставка переживает перезагрузку
  await page.click('#btnBetUp'); await page.reload(); await enter(page);
  if (await text(page, '#betVal') !== '€5.00') bad('RGS', 'ставка не сохранилась после перезагрузки: ' + await text(page, '#betVal'));
  finish(errs, 'RGS'); await ctx.close();
  // 3) незавершённый раунд: показать и закрыть
  {
    const rs = session('resume:1'), startBal = rs.balance, pend = rs.pending;
    const { ctx, page, errs } = await open(1280, 720, liveUrl('resume:1'));
    await idle(page, 60000); await page.waitForTimeout(300);
    const st = await state(page), q = rs.log.map(x => x[0].replace('/wallet/', '')).join(' ');
    if (q !== 'authenticate end-round' || st.balance !== startBal + pend || st.win !== pend || st.bet !== 5 * U) bad('RGS', `незавершённый раунд: запросы «${q}», баланс ${st.balance / U}, выигрыш ${st.win / U}, ставка ${st.bet / U}`);
    console.log(`RGS: незавершённый раунд доигран — ${q}, выигрыш ${st.win / U}`);
    finish(errs, 'RGS resume'); await ctx.close();
  }
});

/* ================= currencies ================= */
await run('currencies', async () => {
  const rows = [];
  for (const cur of Object.keys(CUR)) {
    const c = CUR[cur], sid = 'cur:' + cur, s = session(sid);
    const { ctx, page, errs } = await open(1024, 768, liveUrl(sid, '&currency=' + cur));
    await page.click('#btnTurbo').catch(() => {});
    const before = [await text(page, '#balanceVal'), await text(page, '#betVal')];
    await page.keyboard.press('Space'); await started(page); await idle(page); await page.waitForTimeout(200);
    const win = await text(page, '#winVal'), st = await state(page);
    if (before[0] !== c.show[0]) bad('валюта ' + cur, `баланс «${before[0]}», ожидался «${c.show[0]}»`);
    if (before[1] !== c.show[1]) bad('валюта ' + cur, `ставка «${before[1]}», ожидалась «${c.show[1]}»`);
    if (win !== c.show[2]) bad('валюта ' + cur, `выигрыш «${win}», ожидался «${c.show[2]}»`);
    if (st.balance !== s.balance) bad('валюта ' + cur, `баланс после раунда ${st.balance} ≠ серверу ${s.balance}`);
    if (st.social !== ['XGC', 'XSC', 'XEC'].includes(cur)) bad('валюта ' + cur, 'Social Mode включён неверно: ' + st.social);
    checkGeom('валюта ' + cur, await page.evaluate(GEOM), 1024, 768);
    if (['BTC', 'JPY', 'XEC'].includes(cur)) await shot(page, 'cur_' + cur);
    rows.push(`${cur}: ${before[0]} | ${before[1]} | ${win}`);
    finish(errs, 'валюта ' + cur); await ctx.close();
  }
  console.log('валюты (баланс | ставка | выигрыш):\n  ' + rows.join('\n  ').replace(/ /g, ' '));
});

/* ================= flags ================= */
await run('flags', async () => {
  const res = {};
  const live = async (flag, n = 1) => open(1280, 720, liveUrl('flag:' + flag + (n > 1 ? ':' + n : '')));
  // без флагов: всё доступно
  {
    const { ctx, page, errs } = await live('none');
    const v = { turbo: await visible(page, '#btnTurbo'), auto: await visible(page, '#btnAuto') };
    await page.click('#btnBonus'); v.buy = await visible(page, '#buyBONUS') && await visible(page, '#buySUPER'); await page.keyboard.press('Escape');
    await openInfo(page); const info = await text(page, '#infoSheet'); await page.keyboard.press('Escape');
    v.rtpLine = info.includes('Theoretical RTP'); v.rtpTable = info.includes('96.00%');   // без флага displayRTP RTP не показывается
    // пробел запускает раунд; плашку крупного выигрыша можно пропустить
    await page.keyboard.press('Space'); await started(page).catch(() => bad('флаги', 'без флагов пробел не запустил раунд'));
    v.stopEnabled = !(await page.isDisabled('#btnSpin'));
    await bannerUp(page); await page.waitForTimeout(300); await page.keyboard.press('Space'); await page.waitForTimeout(250);   // первый тап — к итогу
    const a1 = await text(page, '#bigwinAmount'); await page.waitForTimeout(200); const a2 = await text(page, '#bigwinAmount');
    v.toTotal = a1 === a2 && a1 !== '$0.00' && !(await page.evaluate(() => document.getElementById('bigwin').hidden));   // счётчик остановился на итоге, табличка на месте
    await page.keyboard.press('Space'); await page.waitForTimeout(400);   // второй — закрыть
    v.skipped = await page.evaluate(() => document.getElementById('bigwin').hidden);
    await idle(page);
    if (!v.turbo || !v.auto || !v.buy || v.rtpLine || v.rtpTable || !v.stopEnabled || !v.skipped || !v.toTotal) bad('флаги', 'без флагов: ' + JSON.stringify(v));
    res.none = 'турбо, автоигра, покупка, пробел и пропуск анимаций доступны; RTP в правилах не показан';
    finish(errs, 'флаги none'); await ctx.close();
  }
  { // disabledTurbo
    const { ctx, page, errs } = await live('disabledTurbo');
    if (await visible(page, '#btnTurbo') || (await state(page)).turbo) bad('флаги', 'disabledTurbo: турбо доступно');
    await openInfo(page); if ((await text(page, '#infoSheet')).includes('Turbo')) bad('флаги', 'disabledTurbo: турбо упомянуто в правилах'); await page.keyboard.press('Escape');
    checkGeom('disabledTurbo', await page.evaluate(GEOM), 1280, 720); await shot(page, 'flag_disabledTurbo');
    res.disabledTurbo = 'кнопка турбо скрыта, из правил убрано'; finish(errs, 'флаги disabledTurbo'); await ctx.close();
  }
  { // disabledAutoplay
    const { ctx, page, errs } = await live('disabledAutoplay');
    if (await visible(page, '#btnAuto')) bad('флаги', 'disabledAutoplay: автоигра доступна');
    await openInfo(page); if ((await text(page, '#infoSheet')).includes('Autoplay')) bad('флаги', 'disabledAutoplay: автоигра упомянута в правилах'); await page.keyboard.press('Escape');
    res.disabledAutoplay = 'кнопка автоигры скрыта, из правил убрано'; finish(errs, 'флаги disabledAutoplay'); await ctx.close();
  }
  { // disabledBuyFeature
    const { ctx, page, errs } = await live('disabledBuyFeature');
    await page.click('#btnBonus'); await page.waitForTimeout(150);
    const v = { ante: await visible(page, '#anteANTE2'), buy: await visible(page, '#buyBONUS') || await visible(page, '#buySUPER') };
    await shot(page, 'flag_disabledBuyFeature'); checkGeom('disabledBuyFeature', await page.evaluate(GEOM), 1280, 720);
    const one = await rect(page, '#modeCards .modecard'); if (Math.abs(one.cx - 640) > 1.5 || await page.evaluate(() => document.querySelectorAll('#modeCards .modecard').length) !== 1) bad('флаги', 'disabledBuyFeature: единственная доска не по центру (' + one.cx + ')');
    await page.keyboard.press('Escape');
    await openInfo(page); const info = await text(page, '#infoSheet'); await page.keyboard.press('Escape');
    if (!v.ante || v.buy || /Bonus buy/i.test(info)) bad('флаги', 'disabledBuyFeature: ' + JSON.stringify(v) + (/Bonus buy/i.test(info) ? ', покупка осталась в правилах' : ''));
    res.disabledBuyFeature = 'в меню режимов остался только анте, покупки убраны из меню и правил'; finish(errs, 'флаги disabledBuyFeature'); await ctx.close();
  }
  { // disabledSpacebar
    const { ctx, page, errs } = await live('disabledSpacebar');
    await page.keyboard.press('Space'); await page.waitForTimeout(700);
    if ((await state(page)).busy || session('flag:disabledSpacebar').plays) bad('флаги', 'disabledSpacebar: пробел запустил раунд');
    await page.click('#btnSpin'); await started(page).catch(() => bad('флаги', 'disabledSpacebar: кнопка вращения не работает')); await idle(page);
    res.disabledSpacebar = 'пробел не запускает раунд, кнопка работает'; finish(errs, 'флаги disabledSpacebar'); await ctx.close();
  }
  { // disabledSlamstop
    const { ctx, page, errs } = await live('disabledSlamstop');
    await page.click('#btnSpin'); await started(page);
    const stopDisabled = await page.isDisabled('#btnSpin');
    await bannerUp(page); await page.waitForTimeout(300);
    await page.keyboard.press('Space'); await page.click('#bigwin', { force: true }); await page.click('#board', { force: true, position: { x: 20, y: 20 } }); await page.waitForTimeout(500);
    const stillUp = await page.evaluate(() => !document.getElementById('bigwin').hidden);
    await idle(page);
    if (!stopDisabled || !stillUp) bad('флаги', `disabledSlamstop: кнопка стоп ${stopDisabled ? 'выключена' : 'ВКЛЮЧЕНА'}, плашка ${stillUp ? 'осталась' : 'ПРОПУЩЕНА'}`);
    res.disabledSlamstop = 'пробел, клик по плашке и по полю не пропускают анимацию, кнопка «стоп» выключена'; finish(errs, 'флаги disabledSlamstop'); await ctx.close();
  }
  { // displayRTP
    const { ctx, page, errs } = await live('displayRTP');
    await openInfo(page); const info = await text(page, '#infoSheet'); await page.waitForTimeout(150); await shot(page, 'flag_displayRTP'); await page.keyboard.press('Escape');
    if (!info.includes('Theoretical RTP: 96.00%')) bad('флаги', 'displayRTP: нет строки RTP в правилах');
    const rtpBeforeLegal = await page.evaluate(() => { const r = document.querySelector('#infoSheet .irtp'), l = document.querySelector('#infoSheet .ilegal'); return !!r && !!(r.compareDocumentPosition(l) & 4); });
    if (!rtpBeforeLegal) bad('флаги', 'displayRTP: строка RTP не перед юридическим текстом');
    res.displayRTP = 'в правилах появилась строка «Theoretical RTP: 96.00%»'; finish(errs, 'флаги displayRTP'); await ctx.close();
  }
  { // minimumRoundDuration: проигрышный раунд в турбо обычно короче секунды
    const timeRound = async flag => {
      const { ctx, page, errs } = await live(flag);
      await page.click('#btnTurbo'); const t0 = Date.now();
      await page.click('#btnSpin'); await started(page); await idle(page); const ms = Date.now() - t0;
      finish(errs, 'флаги ' + flag); await ctx.close(); return ms;
    };
    const slow = await timeRound('minimumRoundDuration'), fast = await timeRound('none2');
    if (slow < 4000 || fast > 3000) bad('флаги', `minimumRoundDuration: раунд ${slow} мс при минимуме 4000 мс, без флага ${fast} мс`);
    res.minimumRoundDuration = `раунд длился ${slow} мс при минимуме 4000 мс (без флага ${fast} мс)`;
  }
  { // socialCasino
    const { ctx, page, errs } = await live('socialCasino');
    const st = await state(page);
    if (!st.social || await text(page, '#betGroup .lbl') !== 'Play' || await text(page, '#bonusVal') !== 'Feature') bad('флаги', 'socialCasino: Social Mode не включился');
    res.socialCasino = 'включается Social Mode'; finish(errs, 'флаги socialCasino'); await ctx.close();
  }
  console.log('флаги юрисдикции:\n  ' + Object.entries(res).map(([k, v]) => k + ' — ' + v).join('\n  '));
});

/* ================= social ================= */
const RESTRICTED = /\b(bet|bets|betting|buy|buys|buying|bought|bonus|bonuses|cash|credit|credits|currency|deposit|gamble|gambling|money|paid|pay|pays|payout|payouts|paytable|payer|profit|rebet|stake|wager|withdraw)\b/i;
await run('social', async () => {
  const seen = new Set(); const hits = [];
  const scan = async (page, where) => { for (const s of await page.evaluate(TEXTS)) { seen.add(s); const m = s.match(RESTRICTED); if (m) hits.push(`${where}: «${m[0]}» в «${s.slice(0, 70)}»`); } };
  // язык из адреса игнорируется: Social Mode всегда на английском
  const { ctx, page, errs } = await open(1280, 720, '?currency=XGC&lang=de');
  const st = await state(page);
  if (!st.social || st.lang !== 'en' || st.currency !== 'XGC') bad('social', 'режим не включился: ' + JSON.stringify([st.social, st.lang, st.currency]));
  const lab = { bet: await text(page, '#betGroup .lbl'), bonus: await text(page, '#bonusVal'), bal: await text(page, '#balanceVal'), betVal: await text(page, '#betVal') };
  if (lab.bet !== 'Play' || lab.bonus !== 'Feature' || lab.bal !== '1,000.00' + NB + 'GC' || lab.betVal !== '1.00' + NB + 'GC') bad('social', 'подписи: ' + JSON.stringify(lab));
  await scan(page, 'главный экран'); await shot(page, 'social_1_main');
  await openInfo(page); await page.waitForTimeout(200); await scan(page, 'правила'); await shot(page, 'social_2_info');
  const info = await text(page, '#infoSheet');
  for (const need of ['Win table', 'Feature modes', 'play amount', 'Feature purchase: free spins']) if (!info.includes(need) && need !== 'Feature modes') bad('social', 'в правилах нет «' + need + '»');
  await page.keyboard.press('Escape');
  await page.click('#btnBet'); await page.waitForTimeout(150); await scan(page, 'меню суммы игры');
  if (await text(page, '#betModal h2') !== 'Play amount') bad('social', 'заголовок меню ставок: ' + await text(page, '#betModal h2'));
  await page.keyboard.press('Escape');
  await page.click('#btnAuto'); await page.waitForTimeout(150); await scan(page, 'автоигра'); await page.keyboard.press('Escape');
  await page.click('#btnBonus'); await page.waitForTimeout(150); await scan(page, 'меню режимов'); await shot(page, 'social_3_modes');
  const menu = { title: await text(page, '#bonusModal h2'), buy: await text(page, '#buyBONUS'), ante: await text(page, '#anteANTE2 > span') };
  if (menu.title !== 'Feature modes' || menu.buy !== 'Purchase' || menu.ante !== 'Activate') bad('social', 'меню режимов: ' + JSON.stringify(menu));
  await page.click('#anteANTE2'); await scan(page, 'меню режимов, анте включён');
  if (await text(page, '#anteANTE2 > span') !== 'Deactivate') bad('social', 'кнопка анте: ' + await text(page, '#anteANTE2 > span'));
  if (await text(page, '#modeCards .why') !== 'Feature purchases are unavailable while Ante is on. Deactivate Ante first.') bad('social', 'подпись о закрытых покупках: ' + await text(page, '#modeCards .why'));
  await page.click('#anteANTE2');   // покупки доступны только при выключенном анте
  await page.click('#buySUPER'); await page.waitForTimeout(150); await scan(page, 'подтверждение покупки'); await shot(page, 'social_4_confirm');
  const conf = [await text(page, '#buyQ'), await text(page, '#buyConfirm')];
  if (conf[0] !== 'Purchase Super free spins?' || conf[1] !== 'Purchase for 300.00' + NB + 'GC') bad('social', 'подтверждение: ' + JSON.stringify(conf));
  await page.click('#buyCancel'); await page.click('#anteANTE2'); await page.click('#bonusClose'); await scan(page, 'главный экран, анте включён');
  if (await text(page, '#bonusVal') !== 'Deactivate') bad('social', 'главная кнопка при анте: ' + await text(page, '#bonusVal'));
  await page.click('#btnBonus');
  // бонусный раунд: плашки и подписи фриспинов, выигрыш с 4 знаками
  await page.click('#btnTurbo'); await page.evaluate(s => window.__game.force(s), SEED.bonus);
  const titles = new Set();
  await page.exposeFunction('__title', s => { titles.add(s); });
  await page.evaluate(() => { new MutationObserver(() => { const el = document.getElementById('bigwin'); if (!el.hidden) window.__title(document.getElementById('bigwinTitle').getAttribute('aria-label') || ''); }).observe(document.getElementById('bigwin'), { attributes: true, childList: true, subtree: true, characterData: true }); });
  await page.keyboard.press('Space'); await started(page);
  await page.waitForFunction(() => window.__game.state.fs, null, { timeout: 20000 }); await scan(page, 'фриспины');
  await idle(page, 120000); await scan(page, 'после бонуса');
  for (const s of titles) { const m = s.match(RESTRICTED); if (m) hits.push(`плашка: «${m[0]}» в «${s}»`); }
  const win = await text(page, '#winVal'), wantWin = (book('BASE', SEED.bonus).payoutMultiplier / 100).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + NB + 'GC';
  if (win !== wantWin) bad('social', `выигрыш «${win}», ожидался «${wantWin}»`);
  // весь словарь Social Mode и юридический текст
  const dict = await page.evaluate(() => ({ d: window.__game.dict(), legal: window.__game.legal, err: window.__game.t('errIPB') }));
  for (const [k, v] of Object.entries(dict.d)) { const m = String(v).match(RESTRICTED); if (m) hits.push(`словарь ${k}: «${m[0]}» в «${String(v).slice(0, 70)}»`); }
  for (const v of dict.legal) { const m = v.match(RESTRICTED); if (m) hits.push(`юридический текст: «${m[0]}»`); }
  for (const h of Array.from(new Set(hits))) bad('social', h);
  console.log(`social: ?currency=XGC&lang=de — язык ${st.lang}, проверено строк на экранах: ${seen.size}, строк словаря: ${Object.keys(dict.d).length}, плашки: ${Array.from(titles).join(' / ')}; запрещённых слов: ${new Set(hits).size}`);
  console.log(`social: Bet → «${lab.bet}», Bonus → «${lab.bonus}», Buy → «${menu.buy}», Bonus modes → «${menu.title}», выигрыш «${win.replace(NB, ' ')}», ошибка баланса: «${dict.err}»`);
  finish(errs, 'social'); await ctx.close();
  // XEC показывается как SC
  {
    const { ctx, page, errs } = await open(390, 844, '?currency=XEC');
    if (await text(page, '#balanceVal') !== '1,000.00' + NB + 'SC') bad('social', 'XEC: баланс ' + await text(page, '#balanceVal'));
    await scan(page, 'XEC главный экран'); await shot(page, 'social_5_xec_mobile');
    checkGeom('social XEC', await page.evaluate(GEOM), 390, 844);
    finish(errs, 'social XEC'); await ctx.close();
  }
});

/* ================= replay ================= */
await run('replay', async () => {
  const rurl = (q) => '?replay=true&rgs_url=' + encodeURIComponent(base + 'rgs') + q;
  const card = page => page.evaluate(() => Object.fromEntries(['rMode', 'rBase', 'rCostM', 'rCost', 'rPayM', 'rWin', 'rMsg', 'btnReplay'].map(id => [id, document.getElementById(id).textContent])));
  const b = book('BONUS', SEED.retrig), pm = b.payoutMultiplier / 100;
  const eur = v => '€' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  for (const [w, h] of [[1280, 720], [390, 844], [844, 390]]) {
    const tag = `replay ${w}x${h}`; const wallet = [];
    const { ctx, page, errs } = await open(w, h, rurl('&game=01996148-eecf&version=3&mode=BONUS&event=55&amount=2000000&lang=en&currency=EUR&social=false&device=desktop'), { before: async page => {
      page.on('request', r => { if (/\/wallet\//.test(r.url())) wallet.push(r.url()); });
    } });
    let c = await card(page);
    const want = { rMode: 'Bonus buy: free spins', rBase: '€2.00', rCostM: '100×', rCost: '€200.00', rPayM: (Math.round(pm * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '×', rWin: eur(2 * pm), btnReplay: 'Start replay' };
    for (const k of Object.keys(want)) if (c[k] !== want[k]) bad(tag, `карточка ${k}: «${c[k]}», ожидалось «${want[k]}»`);
    for (const id of ['balanceBox', 'betGroup', 'btnBetDown', 'btnBetUp', 'btnSpin', 'btnBonus', 'btnAuto', 'btnTurbo']) if (await visible(page, '#' + id)) bad(tag, id + ' виден в режиме повтора');
    if (!(await visible(page, '#replayBadge')) || (await text(page, '#replayBadge')) !== 'Replay') bad(tag, 'нет бейджа Replay');
    if (!(await visible(page, '#winBox'))) bad(tag, 'скрыто поле выигрыша');
    checkGeom(tag, await page.evaluate(GEOM), w, h); await shot(page, `replay_${w}x${h}_1_card`);
    const inBoard = await page.evaluate(() => { const a = document.getElementById('replayCard').getBoundingClientRect(), b = document.getElementById('board').getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1; });
    if (!inBoard) bad(tag, 'карточка выходит за доску');
    // запуск
    await page.click('#btnReplay'); await started(page);
    if (await visible(page, '#replayCard')) bad(tag, 'карточка осталась во время повтора');
    await page.waitForFunction(() => window.__game.state.fs, null, { timeout: 30000 }).catch(() => bad(tag, 'фриспины в повторе не начались'));
    await page.waitForTimeout(2500); await shot(page, `replay_${w}x${h}_2_playing`);
    await page.keyboard.press('Space');   // пробел не должен начать обычную игру
    await idle(page, 300000); await page.waitForTimeout(300);
    c = await card(page); const st = await state(page);
    if (!(await visible(page, '#replayCard')) || c.btnReplay !== 'Replay again') bad(tag, 'после повтора нет кнопки «Replay again»: ' + c.btnReplay);
    if (st.win !== Math.round(2 * U * pm) || (await text(page, '#winVal')) !== eur(2 * pm)) bad(tag, `итог повтора ${st.win / U}, ожидался ${2 * pm}`);
    await shot(page, `replay_${w}x${h}_3_done`);
    if (w === 1280) { // повторить ещё раз
      await page.click('#btnReplay'); await started(page); await page.waitForTimeout(1500);
      if (await visible(page, '#replayCard')) bad(tag, '«Replay again» не запустил повтор');
      await page.keyboard.press('Space'); await page.keyboard.press('Space');
      await idle(page, 300000);
      if ((await state(page)).win !== Math.round(2 * U * pm)) bad(tag, 'второй повтор дал другой итог');
    }
    if (wallet.length) bad(tag, 'в режиме повтора были запросы кошелька: ' + wallet.join(', '));
    finish(errs, tag); await ctx.close();
  }
  const gets = session('replay').log.map(x => x[0]);
  if (!gets.every(p => p === '/bet/replay/01996148-eecf/3/BONUS/55')) bad('replay', 'путь запроса: ' + JSON.stringify(Array.from(new Set(gets))));
  console.log(`replay: GET /bet/replay/01996148-eecf/3/BONUS/55 ×${gets.length}, запросов кошелька нет`);
  { // без суммы и валюты — 1.00 USD; проигрышный раунд
    const { ctx, page, errs } = await open(1280, 720, rurl('&game=g&version=1&mode=BASE&event=9'));
    const c = await card(page);
    if (c.rBase !== '$1.00' || c.rCost !== '$1.00' || c.rCostM !== '1×' || c.rWin !== '$0.00' || c.rMode !== 'Normal spin') bad('replay', 'значения по умолчанию: ' + JSON.stringify(c));
    await page.click('#btnReplay'); await started(page); await idle(page); await page.waitForTimeout(200);
    if ((await card(page)).btnReplay !== 'Replay again') bad('replay', 'проигрышный раунд: нет «Replay again»');
    finish(errs, 'replay default'); await ctx.close();
  }
  { // ошибка загрузки
    const { ctx, page, errs } = await open(1280, 720, rurl('&game=g&version=1&mode=BASE&event=404&lang=en'), { allow: /404|Replay data not found|NOT_FOUND/ });
    const c = await card(page);
    if (!c.rMsg.startsWith('The round could not be loaded') || !(await page.isDisabled('#btnReplay'))) bad('replay', 'ошибка загрузки не показана: ' + JSON.stringify(c));
    await shot(page, 'replay_error'); finish(errs, 'replay 404'); await ctx.close();
  }
  { // Social Mode в повторе: XEC → SC, без запрещённых слов; по умолчанию 1 SC
    const { ctx, page, errs } = await open(390, 844, rurl('&game=g&version=1&mode=SUPER&event=5&amount=5000000&currency=XEC&social=true&lang=ru'));
    const c = await card(page), texts = await page.evaluate(TEXTS);
    if (c.rBase !== '5.00' + NB + 'SC' || c.rCost !== '1,500.00' + NB + 'SC' || c.rMode !== 'Feature purchase: super free spins') bad('replay social', 'карточка: ' + JSON.stringify(c));
    if (!/^[\d,]+\.\d{4} SC$/.test(c.rWin)) bad('replay social', 'выигрыш не с 4 знаками: ' + c.rWin);
    for (const s of texts) { const m = s.match(RESTRICTED); if (m) bad('replay social', `«${m[0]}» в «${s.slice(0, 60)}»`); }
    const heads = await page.evaluate(() => Array.from(document.querySelectorAll('#replayCard dt')).map(e => e.textContent));
    if (heads.join('|') !== 'Mode|Base play|Cost multiplier|Total play cost|Win multiplier|Total win') bad('replay social', 'подписи карточки: ' + heads.join('|'));
    await shot(page, 'replay_social'); finish(errs, 'replay social'); await ctx.close();
    const d = await open(1280, 720, rurl('&game=g&version=1&mode=BASE&event=9&social=true'));
    if ((await card(d.page)).rBase !== '1.00' + NB + 'SC') bad('replay social', 'по умолчанию не 1 SC: ' + (await card(d.page)).rBase);
    finish(d.errs, 'replay social default'); await d.ctx.close();
  }
});

/* ================= i18n ================= */
await run('i18n', async () => {
  const keys = Object.keys(I18N.en);
  for (const l of LANGS) {
    if (!I18N[l]) { bad('i18n', 'нет языка ' + l); continue; }
    const miss = keys.filter(k => !(k in I18N[l])); if (miss.length) bad('i18n', `${l}: нет ключей ${miss.join(', ')}`);
    const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join();
    const pb = keys.filter(k => k in I18N[l] && ph(I18N[l][k]) !== ph(I18N.en[k])); if (pb.length) bad('i18n', `${l}: подстановки не совпадают в ${pb.join(', ')}`);
  }
  // выбор языка и откат на английский
  for (const [q, want] of [['br', 'pt'], ['pt-BR', 'pt'], ['zh-CN', 'zh'], ['xx', 'en'], ['DE', 'de'], ['po', 'pl']]) {
    const { ctx, page, errs } = await open(390, 844, '?lang=' + q);
    const got = (await state(page)).lang; if (got !== want) bad('i18n', `?lang=${q} дал язык ${got}, ожидался ${want}`);
    if (q === 'DE') {
      const r = await page.evaluate(() => { delete window.I18N.de.bet; delete window.I18N.de.rule3; window.__game.retext(); return [document.querySelector('#betGroup .lbl').textContent, document.querySelector('#balanceBox .lbl').textContent, window.__game.t('rule3'), window.__game.t('нет_такого_ключа')]; });
      if (r[0] !== 'Bet' || r[1] !== 'Guthaben' || !r[2].startsWith('Only the highest win') || r[3] !== 'нет_такого_ключа') bad('i18n', 'откат на английский: ' + JSON.stringify(r));
    }
    finish(errs, 'i18n ' + q); await ctx.close();
  }
  console.log('i18n: br → pt, pt-BR → pt, zh-CN → zh, po → pl, неизвестный → en; ключ без перевода показан по-английски');
  // все языки на мобильном: главный экран, правила, меню режимов, подтверждение, ставки, автоигра, повтор
  const report = [];
  for (const l of LANGS) {
    for (const [w, h] of (['de', 'fi', 'ru'].includes(l) ? [[375, 667], [390, 844], [844, 390]] : [[375, 667]])) {
      const tag = `i18n ${l} ${w}x${h}`, D = I18N[l];
      const { ctx, page, errs } = await open(w, h, '?lang=' + l);
      const got = { bal: await text(page, '#balanceBox .lbl'), bet: await text(page, '#betGroup .lbl'), win: await text(page, '#winBox .lbl'), bonus: await text(page, '#bonusVal'), spin: await page.getAttribute('#btnSpin', 'aria-label'), htmlLang: await page.evaluate(() => document.documentElement.lang) };
      if (got.bal !== D.balance || got.bet !== D.bet || got.win !== D.win || got.bonus !== D.bonus || got.spin !== D.aSpin || got.htmlLang !== l) bad(tag, 'подписи не переведены: ' + JSON.stringify(got));
      checkGeom(tag, await page.evaluate(GEOM), w, h); await shot(page, `i18n_${l}_${w}x${h}_1_main`);
      await page.click('#btnMenu'); await page.waitForTimeout(150);
      const caps = await page.evaluate(() => Array.from(document.querySelectorAll('#menuPop .cap, #btnMenu .cap')).map(e => e.textContent).join('|'));
      if (caps !== [D.menu, D.info, D.settings, D.aSound].join('|')) bad(tag, 'меню не переведено: ' + caps);
      checkGeom(tag + ' меню', await page.evaluate(GEOM), w, h); if (w !== 390) await shot(page, `i18n_${l}_${w}x${h}_1a_menu`);
      await page.click('#btnInfo'); await page.waitForTimeout(150);
      const info = await text(page, '#infoSheet');
      for (const k of ['paytable', 'rule2', 'wild6', 'secFs', 'retrigTitle', 'colExtra', 'modeSUPER', 'fs4']) if (!info.includes(D[k])) bad(tag, 'в правилах нет перевода ' + k);
      if (!info.includes('Malfunction voids all wins and plays.')) bad(tag, 'юридический текст должен остаться английским');
      checkGeom(tag + ' правила', await page.evaluate(GEOM), w, h); if (w === 375) await shot(page, `i18n_${l}_${w}x${h}_2_info`);
      await page.keyboard.press('Escape');
      await page.click('#btnBonus'); await page.waitForTimeout(150);
      if (await text(page, '#bonusModal h2') !== D.modesTitle || await text(page, '#buyBONUS') !== D.buy || await text(page, '#anteANTE2 > span') !== D.activate) bad(tag, 'меню режимов не переведено');
      checkGeom(tag + ' режимы', await page.evaluate(GEOM), w, h); await shot(page, `i18n_${l}_${w}x${h}_3_modes`);
      await page.click('#anteANTE2'); await page.waitForTimeout(80); checkGeom(tag + ' анте', await page.evaluate(GEOM), w, h);
      if (await text(page, '#anteANTE2 > span') !== D.deactivate || await text(page, '#modeCards .why') !== D.buyLocked || !(await page.isDisabled('#buySUPER'))) bad(tag, 'при анте покупки не закрыты или подпись не переведена');
      if (w === 375) await shot(page, `i18n_${l}_${w}x${h}_3a_modes_ante`);
      await page.click('#anteANTE2');
      await page.click('#buySUPER'); await page.waitForTimeout(100);
      if (await text(page, '#buyQ') !== D.buyQuestion.replace('{name}', D.superName)) bad(tag, 'подтверждение покупки не переведено');
      checkGeom(tag + ' подтверждение', await page.evaluate(GEOM), w, h);
      await page.click('#buyCancel'); await page.click('#anteANTE2'); await page.click('#bonusClose');
      if (await text(page, '#bonusVal') !== D.deactivate) bad(tag, 'кнопка при анте: ' + await text(page, '#bonusVal'));
      await page.waitForTimeout(80); checkGeom(tag + ' анте включён', await page.evaluate(GEOM), w, h); await page.click('#btnBonus');
      await page.click('#btnBet'); await page.waitForTimeout(100); if (await text(page, '#betModal h2') !== D.betTitle) bad(tag, 'меню ставок не переведено');
      checkGeom(tag + ' ставки', await page.evaluate(GEOM), w, h); await page.keyboard.press('Escape');
      await page.click('#btnAuto'); await page.waitForTimeout(100); if (await text(page, '#autoStart') !== D.start) bad(tag, 'автоигра не переведена');
      checkGeom(tag + ' автоигра', await page.evaluate(GEOM), w, h); await page.keyboard.press('Escape');
      // бонус: подпись фриспинов и плашки
      if (['de', 'fi', 'ru', 'ja', 'ar', 'vi'].includes(l) && w !== 390) {
        await page.click('#btnTurbo');
        const r = await playForced(page, tag, 'BASE', SEED.bonus);
        await page.waitForFunction(() => window.__game.state.fs, null, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(250); await shot(page, `i18n_${l}_${w}x${h}_4_fs_start`);
        if (await text(page, '#fsLbl') !== D.freeSpins) bad(tag, 'подпись фриспинов: ' + await text(page, '#fsLbl'));
        checkGeom(tag + ' фриспины', await page.evaluate(GEOM), w, h);
        await page.waitForFunction(() => window.__game.state.fs && !document.getElementById('bigwin').hidden && !document.getElementById('bigwinAmount').hidden, null, { timeout: 120000 }).catch(() => {});
        await page.waitForTimeout(500); checkGeom(tag + ' итог бонуса', await page.evaluate(GEOM), w, h); await shot(page, `i18n_${l}_${w}x${h}_5_fs_total`);
        await r.done();
      }
      finish(errs, tag); await ctx.close();
      // карточка повтора
      const rp = await open(w, h, '?replay=true&rgs_url=' + encodeURIComponent(base + 'rgs') + '&game=g&version=1&mode=SUPER&event=5&amount=10000000&currency=EUR&lang=' + l);
      const heads = await rp.page.evaluate(() => Array.from(document.querySelectorAll('#replayCard dt')).map(e => e.textContent));
      if (heads.join('|') !== [D.rMode, D.rBaseBet, D.rCostMult, D.rTotalCost, D.rPayoutMult, D.rTotalWin].join('|') || await text(rp.page, '#btnReplay') !== D.rStart || await text(rp.page, '#rMode') !== D.modeSUPER) bad(tag, 'карточка повтора не переведена');
      checkGeom(tag + ' повтор', await rp.page.evaluate(GEOM), w, h); await shot(rp.page, `i18n_${l}_${w}x${h}_6_replay`);
      finish(rp.errs, tag + ' повтор'); await rp.ctx.close();
    }
    report.push(l);
  }
  console.log('i18n: проверены на мобильном без вылезаний и наложений — ' + report.join(', '));
});

await browser.close(); server.close();
if (problems.length) { console.log('\nПРОБЛЕМЫ (' + problems.length + '):\n' + problems.join('\n')); process.exit(1); }
console.log('\nok: ' + ONLY.join(', ') + ' — ошибок нет. Скриншоты: ' + path.relative(ROOT, SHOTS));
