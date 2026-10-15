#!/usr/bin/env node
/* Сверка экрана правил (Info) с математикой.
 *   node tools/check_rules.mjs
 * Берёт CONFIG и PAYTABLE из index.html и сравнивает каждое число, которое показывают правила, с движком assets/js/math.js
 * (CONFIG и TUNE), а RTP режимов и частоту входа в бонус — ещё и с выгрузкой для Stake (math/stake_report.json).
 * Проверяет и тексты: в ключах экрана Info нет вписанных чисел (кроме «3, 4 или 5» в rule2 и номера первого барабана) —
 * все числа приходят подстановками из CONFIG. Код выхода 1, если есть расхождения. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = require(path.join(ROOT, 'assets/js/math.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// объект-литерал из index.html: от «const NAME = {» до парной закрывающей скобки
function literal(name) {
  const i = html.indexOf('const ' + name + ' = {'); if (i < 0) throw new Error('нет ' + name + ' в index.html');
  let j = html.indexOf('{', i), depth = 0, k = j;
  for (; k < html.length; k++) { const c = html[k]; if (c === '{') depth++; else if (c === '}' && --depth === 0) break; }
  return vm.runInNewContext('(' + html.slice(j, k + 1) + ')');
}
const FE = literal('CONFIG'), PT = literal('PAYTABLE');
const rows = [], bad = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(what, shown, engine) { const ok = same(shown, engine); rows.push([what, JSON.stringify(shown), JSON.stringify(engine), ok]); if (!ok) bad.push(what); }

const E = M.CONFIG, TU = M.TUNE, vals = pairs => pairs.map(([v]) => v).sort((a, b) => a - b);
check('поле (барабаны×ряды)', [FE.reels, FE.rows], [E.reels, E.rows]);
check('линии', FE.lines, E.lines);
check('таблица выплат', PT, E.paytable);
check('максимальный выигрыш, ×', FE.maxWin, E.maxWin);
check('фриспины за 3/4/5 скаттеров', FE.fsAward, Object.fromEntries(Object.entries(E.fsAward).map(([k, v]) => [k, v])));
check('ретриггер: скаттеров / +вращений', FE.retrigger, E.retrigger);
check('предел фриспинов за бонус', FE.maxFs, E.maxFs);
check('барабаны вайлда', FE.wildReels, E.wildReels);
check('множители вайлда, основная игра', FE.wildMult.base, vals(TU.base.wildMult));
check('множители вайлда, фриспины', FE.wildMult.fs, vals(TU.fs.wildMult));
check('множители вайлда, суперфриспины', FE.wildMult.fs, vals(TU.super.wildMult));
check('стартовые вайлды супербонуса: число', FE.superStartWilds, E.superStartWilds);
check('стартовые вайлды супербонуса: множители', FE.wildMult.superStart, vals(TU.super.startMult));
check('цены режимов, × ставки', Object.fromEntries(Object.entries(FE.modes).map(([m, v]) => [m, v.cost])), Object.fromEntries(Object.entries(E.modes).map(([m, v]) => [m, v.cost])));

// вайлдов на клетку: суперфриспины против обычных (правила говорят «чаще»)
const share = (sym, wild) => wild / (sym.reduce((a, b) => a + b, 0) + wild);
const fsShare = share(TU.fs.sym, TU.fs.wild), superShare = share(TU.fs.sym, TU.super.wild);
check('в суперфриспинах вайлды чаще', FE.superMoreWilds, superShare > fsShare);

// вход во фриспины: 1 раз за N вращений, точная формула по весам скаттера (не больше одного на барабан)
const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
const pTrig = p => { let s = 0; for (let k = E.retrigger.scatters; k <= E.reels; k++) s += C(E.reels, k) * p ** k * (1 - p) ** (E.reels - k); return s; };
check('вход во фриспины, 1 из N (BASE)', FE.fsOdds.BASE, Math.round(1 / pTrig(TU.base.scatter)));
for (const a of ['ANTE2', 'ANTE4']) check(`вход во фриспины, 1 из N (${a})`, FE.fsOdds[a], Math.round(1 / pTrig(TU[a.toLowerCase()].scatter)));

// выгрузка для Stake: RTP таблиц и частота входа в бонус
const repPath = path.join(ROOT, 'math/stake_report.json');
if (fs.existsSync(repPath)) {
  const rep = JSON.parse(fs.readFileSync(repPath, 'utf8')).modes;
  for (const m of Object.keys(FE.modes)) {
    const r = rep[m.toLowerCase()]; if (!r) { bad.push('нет режима ' + m + ' в выгрузке'); continue; }
    check('RTP ' + m + ' (выгрузка), %', FE.modes[m].rtp.toFixed(2), (r.rtp * 100).toFixed(2));
  }
  check('RTP на экране, %', FE.rtp.toFixed(2), (rep.base.rtp * 100).toFixed(2));
  check('вход во фриспины, 1 из N (выгрузка BASE)', FE.fsOdds.BASE, Math.round(1 / rep.base.triggerProb));
  for (const a of ['ANTE2', 'ANTE4']) check(`вход во фриспины, 1 из N (выгрузка ${a})`, FE.fsOdds[a], Math.round(1 / rep[a.toLowerCase()].triggerProb));
} else bad.push('нет math/stake_report.json — RTP не сверен');

// поведение, которое правила описывают словами: проверяем на раундах движка
const facts = { rounds: 0, perReel: 0, wildOff: 0, multBase: new Set(), multFs: new Set(), buyMin: Infinity, superReels: new Set(), superMult: new Set(),
  retrigAdd: new Set(), maxTotal: 0, capLeft: 0, trigWinKept: 0, trigWinRounds: 0, stickyLost: 0 };
for (const mode of Object.keys(E.modes)) {
  const n = !E.modes[mode].force ? 20000 : 3000;
  for (let seed = 1; seed <= n; seed++) {
    const b = M.book(mode, seed); facts.rounds++;
    let fsMode = false, first = true, stickyPrev = new Set(), total = 0, firstWin = 0;
    for (const ev of b.events) {
      if (ev.type === 'reveal') {
        const sticky = new Set();
        ev.board.forEach((col, reel) => {
          if (col.filter(c => c.name === 'S').length > 1) facts.perReel++;
          col.forEach((c, row) => {
            if (c.name !== 'W') return;
            if (!E.wildReels.includes(reel)) facts.wildOff++;
            (fsMode ? facts.multFs : facts.multBase).add(c.multiplier);
            if (c.sticky) sticky.add(reel + ',' + row);
          });
        });
        if (fsMode) { for (const k of stickyPrev) if (!sticky.has(k)) facts.stickyLost++; stickyPrev = sticky; }
        if (first && (mode === 'BONUS' || mode === 'SUPER')) facts.buyMin = Math.min(facts.buyMin, ev.board.flat().filter(c => c.name === 'S').length);
        first = false;
      } else if (ev.type === 'setTotalWin') { total = ev.amount; if (!fsMode) firstWin = ev.amount; }
      else if (ev.type === 'freeSpinTrigger') {
        fsMode = true; if (firstWin > 0) facts.trigWinRounds++;
        if (ev.startWilds) for (const w of ev.startWilds) { facts.superReels.add(w.reel); facts.superMult.add(w.multiplier); stickyPrev.add(w.reel + ',' + w.row); }
        facts.maxTotal = Math.max(facts.maxTotal, ev.totalFs);
      } else if (ev.type === 'retrigger') { facts.retrigAdd.add(ev.added); facts.maxTotal = Math.max(facts.maxTotal, ev.total); }
      else if (ev.type === 'updateFreeSpin') facts.maxTotal = Math.max(facts.maxTotal, ev.total);
      else if (ev.type === 'bonusEnd' && firstWin > 0 && total >= firstWin) facts.trigWinKept++;
    }
  }
}
const sorted = s => [...s].sort((a, b) => a - b);
check('раунды: не больше одного скаттера на барабан', facts.perReel, 0);
check('раунды: вайлды только на барабанах вайлда', facts.wildOff, 0);
check('раунды: множители вайлда в основной игре', sorted(facts.multBase), FE.wildMult.base);
check('раунды: множители вайлда во фриспинах', sorted(facts.multFs), FE.wildMult.fs);
check('раунды: липкий вайлд не исчезает до конца фриспинов', facts.stickyLost, 0);
check('раунды: в покупке на первом вращении ≥ скаттеров', facts.buyMin >= Math.min(...Object.keys(FE.fsAward).map(Number)), true);
check('раунды: стартовые вайлды супербонуса — по одному на барабанах', sorted(facts.superReels), FE.wildReels);
check('раунды: множители стартовых вайлдов', sorted(facts.superMult), FE.wildMult.superStart);
check('раунды: ретриггер добавляет не больше', Math.max(...facts.retrigAdd) <= FE.retrigger.add, true);
check('раунды: фриспинов за бонус не больше предела', facts.maxTotal <= FE.maxFs, true);
check('раунды: выигрыш вращения-триггера входит в итог', facts.trigWinKept, facts.trigWinRounds);

// тексты: никаких вписанных чисел в ключах экрана Info
globalThis.window = {}; require(path.join(ROOT, 'assets/i18n.js')); const I18N = globalThis.window.I18N;
const INFO_KEYS = ['intro1', 'intro4', 'linesNote', 'payKinds', 'payNote', 'secSymbols', 'cardWild', 'cardScatter', 'cardSticky', 'cardMult', 'cardSuper',
  'wild1', 'wild2', 'wild3', 'wild4', 'wild5', 'wild6', 'wild7', 'secFs', 'fs1', 'fs2', 'fs3', 'fs4', 'fs5', 'fs6', 'fs7', 'perSpin', 'xBet',
  'anteInfo', 'bonusInfo', 'superInfo', 'maxText', 'maxText2', 'rtpLine', 'rule3'];
let textHits = 0;
for (const [l, d] of Object.entries(I18N)) for (const k of INFO_KEYS) {
  const s = (d[k] || I18N.en[k] || '').replace(/\{\w+\}/g, '');
  if (/[02-9]|1\d/.test(s)) { textHits++; bad.push(`текст ${l}.${k}: число вписано в перевод — «${s.slice(0, 60)}»`); }
}

const w = [Math.max(...rows.map(r => r[0].length)), 28];
console.log('Правила (index.html) против движка (math.js, выгрузка Stake):\n');
for (const [what, a, b, ok] of rows) console.log((ok ? '  ok  ' : '  !!  ') + what.padEnd(w[0]) + '  экран ' + a + (ok ? '' : '  ≠  движок ' + b));
console.log(`\nтексты Info: ${Object.keys(I18N).length} языков × ${INFO_KEYS.length} ключей, вписанных чисел: ${textHits}`);
if (bad.length) { console.log('\nРАСХОЖДЕНИЯ (' + bad.length + '):\n  ' + bad.join('\n  ')); process.exit(1); }
console.log('\nok: правила совпадают с математикой');
