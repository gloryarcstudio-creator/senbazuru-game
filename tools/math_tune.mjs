#!/usr/bin/env node
/* Подгонка TUNE под целевой RTP во всех режимах.
 *   node tools/math_tune.mjs [--rtp 0.96] [--bonus-every 400] [--write]
 *
 * Что подгоняется и чем:
 *   base.scatter  — частота входа в бонус (формула)            -> 1 из bonus-every
 *   fs.wild       — вес вайлда во фриспинах (симуляция)         -> BONUS = rtp × цена
 *   base.wild     — вес вайлда в базовой игре (точный перебор)  -> BASE  = rtp
 *   ante2/ante4.scatter — частота скаттера с анте (формула + V_k) -> ANTE2 = rtp × 2, ANTE4 = rtp × 4
 *   super.wild    — вес вайлда в супер-бонусе (симуляция)       -> SUPER = rtp × цена
 * Остальное (выплаты, веса символов, множители, число фриспинов) — дизайн, руками в math.js.
 */
import fs from 'node:fs';
import { M, CONFIG, MATH_PATH, simParallel, summary, exactLines, scatterDist, triggerProb, solve, pct } from './math_lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const TARGET = Number(arg('rtp', 0.96)), BONUS_EVERY = Number(arg('bonus-every', 400));
const N_SEARCH = Number(arg('n-search', 2000000)), N_FINE = Number(arg('n-fine', 12000000));
const T = JSON.parse(JSON.stringify(M.TUNE));
const log = (...a) => console.log(...a);
const mean = async (mode, n, seed) => summary(await simParallel(T, mode, n, seed), mode);

/* поиск параметра по симуляции: деление пополам на общих случайных числах, затем поправка по большому прогону */
async function fitSim(label, mode, get, set, lo, hi, targetMean) {
  const cost = CONFIG.modes[mode].cost;
  for (let i = 0; i < 11; i++) {
    const mid = (lo + hi) / 2; set(mid);
    const s = await mean(mode, N_SEARCH, 101);
    log(`  ${label} = ${mid.toFixed(3)} -> ${(s.rtp * cost).toFixed(2)}×`);
    if (s.rtp * cost < targetMean) lo = mid; else hi = mid;
  }
  let x = (lo + hi) / 2;
  for (let pass = 0; pass < 2; pass++) { // поправка: наклон на общих числах, уровень — на независимом большом прогоне
    set(x * 0.98); const a = await mean(mode, N_SEARCH, 202); set(x * 1.02); const b = await mean(mode, N_SEARCH, 202);
    const slope = (b.rtp - a.rtp) * cost / (x * 0.04);
    set(x); const big = await mean(mode, N_FINE, 303 + pass * 17);
    const dx = (targetMean - big.rtp * cost) / slope;
    log(`  поправка ${pass + 1}: ${label} = ${x.toFixed(4)}, среднее ${(big.rtp * cost).toFixed(3)}× ± ${(big.ci95 * cost).toFixed(3)} -> ${dx >= 0 ? '+' : ''}${dx.toFixed(4)}`);
    x += dx; set(x);
  }
  return get();
}

log(`Цель: RTP ${pct(TARGET)} во всех режимах, бонус в базовой игре 1 из ${BONUS_EVERY}`);

// 1. частота входа
T.base.scatter = solve(triggerProb, 1e-4, 0.5, 1 / BONUS_EVERY);
const pTrig = triggerProb(T.base.scatter);
log(`1) base.scatter = ${T.base.scatter.toFixed(6)} (вход 1 из ${(1 / pTrig).toFixed(1)})`);

// 2. грубо base.wild (бонус ≈ 96×), затем fs.wild по симуляции BONUS
const lineRtp = wild => { const t = JSON.parse(JSON.stringify(T)); t.base.wild = wild; return exactLines(M.createEngine(t).profiles.base).rtp; };
const bonusCost = CONFIG.modes.BONUS.cost;
T.base.wild = solve(lineRtp, 1, 2000, TARGET - pTrig * (TARGET * bonusCost - 0.4));
log(`2) base.wild ≈ ${T.base.wild.toFixed(3)} (предварительно)`);
log('3) fs.wild по симуляции BONUS:');
await fitSim('fs.wild', 'BONUS', () => T.fs.wild, v => { T.fs.wild = v; }, 20, 200, TARGET * bonusCost);

// 4. точные значения бонуса по числу скаттеров и окончательный base.wild
const bon = await mean('BONUS', N_FINE, 404);
const V = k => (bon.byK[k].n >= 2000 ? bon.byK[k].mean : bon.byK[3].mean * CONFIG.fsAward[k] / CONFIG.fsAward[3]);
log(`4) бонус по скаттерам: 3 -> ${V(3).toFixed(2)}×, 4 -> ${V(4).toFixed(2)}×, 5 -> ${V(5).toFixed(2)}× (в среднем ${bon.fsMean.toFixed(2)}× ± ${bon.fsCi95.toFixed(2)})`);
const bonusPart = q => { const d = scatterDist(q); return d[3] * V(3) + d[4] * V(4) + d[5] * V(5); };
T.base.wild = solve(lineRtp, 1, 2000, TARGET - bonusPart(T.base.scatter));
log(`   base.wild = ${T.base.wild.toFixed(4)}: линии ${pct(lineRtp(T.base.wild))} + бонус ${pct(bonusPart(T.base.scatter))}`);

// 5. анте
for (const prof of ['ante2', 'ante4']) {
  const anteCost = CONFIG.modes[prof.toUpperCase()].cost;
  const anteRtp = q => { const t = JSON.parse(JSON.stringify(T)); t[prof].scatter = q; return (exactLines(M.createEngine(t).profiles[prof]).rtp + bonusPart(q)) / anteCost; };
  T[prof].scatter = solve(anteRtp, T.base.scatter, 0.6, TARGET);
  log(`5) ${prof}.scatter = ${T[prof].scatter.toFixed(6)} (вход 1 из ${(1 / triggerProb(T[prof].scatter)).toFixed(1)}, оценка RTP ${pct(anteRtp(T[prof].scatter))})`);
}

// 6. супер-бонус
log('6) super.wild по симуляции SUPER:');
await fitSim('super.wild', 'SUPER', () => T.super.wild, v => { T.super.wild = v; }, 20, 300, TARGET * CONFIG.modes.SUPER.cost);

// округление и запись
const r = (v, d) => Number(v.toFixed(d));
T.base.scatter = r(T.base.scatter, 6); T.ante2.scatter = r(T.ante2.scatter, 6); T.ante4.scatter = r(T.ante4.scatter, 6); T.base.wild = r(T.base.wild, 3); T.fs.wild = r(T.fs.wild, 3); T.super.wild = r(T.super.wild, 3);
const block = 'const TUNE = {\n' + Object.keys(T).map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(T[k]).replace(/,/g, ', ').replace(/:/g, ': ').replace(/\{/g, '{ ').replace(/\}/g, ' }')}`).join(',\n') + '\n};\n';
log('\n' + block);
if (process.argv.includes('--write')) {
  const src = fs.readFileSync(MATH_PATH, 'utf8');
  const out = src.replace(/(\/\*TUNE-BEGIN\*\/\n)[\s\S]*?(\/\*TUNE-END\*\/)/, (_, a, b) => a + block + b);
  if (out === src) throw new Error('не найден блок TUNE в math.js');
  fs.writeFileSync(MATH_PATH, out); log('TUNE записан в assets/js/math.js');
}
