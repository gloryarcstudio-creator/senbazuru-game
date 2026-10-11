/* Общая часть симулятора и подгонки: точные формулы для базовой игры и накопление статистики. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MATH_PATH = path.join(ROOT, 'assets/js/math.js');
export const M = require(MATH_PATH);
export const { CONFIG, UNIT } = M;
const REELS = CONFIG.reels, ROWS = CONFIG.rows;

/* Точный расчёт линий одного вращения (перебор всех комбинаций линии). scatter — вероятность скаттера на барабане. */
export function exactLines(profile) {
  const per = profile.dist.map(d => { const ps = profile.scatter / ROWS; return d.map(o => ({ code: o.code, mult: o.mult, p: o.p * (1 - ps) })).concat([{ code: M.S, mult: 1, p: ps }]); });
  const lc = new Int8Array(REELS), lm = new Int16Array(REELS); let ev = 0, hit = 0, ev2 = 0;
  (function rec(r, pr) {
    if (r === REELS) { const pay = M.linePay(lc, lm); if (pay > 0) { ev += pr * pay; ev2 += pr * pay * pay; hit += pr; } return; }
    for (const o of per[r]) { lc[r] = o.code; lm[r] = o.mult; rec(r + 1, pr * o.p); }
  })(0, 1);
  const n = CONFIG.lines.length;
  return { rtp: n * ev / UNIT, lineHit: hit, hitApprox: 1 - Math.pow(1 - hit, n) };
}
/* P(ровно k барабанов со скаттером), k = 0..5 */
export function scatterDist(q) {
  const out = []; const C = [1, 5, 10, 10, 5, 1];
  for (let k = 0; k <= REELS; k++) out.push(C[k] * Math.pow(q, k) * Math.pow(1 - q, REELS - k));
  return out;
}
export const triggerProb = q => scatterDist(q).slice(3).reduce((a, b) => a + b, 0);
export function solve(f, lo, hi, target, iters = 60) { // f монотонно возрастает
  for (let i = 0; i < iters; i++) { const mid = (lo + hi) / 2; if (f(mid) < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export const BUCKETS = [0, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000, 15000]; // границы в × ставки
export const bucketLabel = i => i === 0 ? '0' : i === BUCKETS.length ? 'max 15000×' : i === 1 ? '(0; 0.5)' : `[${BUCKETS[i - 1]}; ${BUCKETS[i]})`;

export function newStats() {
  return { n: 0, sum: 0, sumsq: 0, hits: 0, bonus: 0, capped: 0, retrig: 0, fsSpins: 0, baseSum: 0, max: 0, profit: 0,
    cnt: new Array(BUCKETS.length + 1).fill(0), amt: new Array(BUCKETS.length + 1).fill(0),
    byK: { 3: { n: 0, sum: 0, sumsq: 0 }, 4: { n: 0, sum: 0, sumsq: 0 }, 5: { n: 0, sum: 0, sumsq: 0 } } };
}
export function simulate(engine, mode, rounds, seed, st = newStats()) {
  const rnd = M.rng32(seed), cost = CONFIG.modes[mode].cost, capX = CONFIG.maxWin;
  for (let i = 0; i < rounds; i++) {
    const r = engine.playRound(mode, rnd, null), x = r.payout / UNIT;
    st.n++; st.sum += x; st.sumsq += x * x; st.baseSum += r.baseWin / UNIT;
    if (x > 0) st.hits++; if (x >= cost) st.profit++; if (x > st.max) st.max = x;
    if (r.capped) st.capped++;
    let b = 0; if (x > 0) { if (x >= capX) b = BUCKETS.length; else { b = 1; while (b < BUCKETS.length && x >= BUCKETS[b]) b++; } }
    st.cnt[b]++; st.amt[b] += x;
    if (r.bonus) { st.bonus++; st.retrig += r.retriggers; st.fsSpins += r.fsSpins; const k = st.byK[Math.min(r.scatters, 5)], f = r.fsWin / UNIT; k.n++; k.sum += f; k.sumsq += f * f; }
  }
  return st;
}
export function merge(a, b) {
  for (const k of ['n', 'sum', 'sumsq', 'hits', 'bonus', 'capped', 'retrig', 'fsSpins', 'baseSum', 'profit']) a[k] += b[k];
  a.max = Math.max(a.max, b.max);
  for (let i = 0; i < a.cnt.length; i++) { a.cnt[i] += b.cnt[i]; a.amt[i] += b.amt[i]; }
  for (const k of [3, 4, 5]) for (const f of ['n', 'sum', 'sumsq']) a.byK[k][f] += b.byK[k][f];
  return a;
}
export function summary(st, mode) {
  const cost = CONFIG.modes[mode].cost, mean = st.sum / st.n, sd = Math.sqrt(Math.max(0, st.sumsq / st.n - mean * mean));
  const fs = [3, 4, 5].reduce((a, k) => ({ n: a.n + st.byK[k].n, sum: a.sum + st.byK[k].sum, sumsq: a.sumsq + st.byK[k].sumsq }), { n: 0, sum: 0, sumsq: 0 });
  const fmean = fs.n ? fs.sum / fs.n : 0, fsd = fs.n ? Math.sqrt(Math.max(0, fs.sumsq / fs.n - fmean * fmean)) : 0;
  return {
    mode, rounds: st.n, cost, rtp: mean / cost, ci95: 1.96 * sd / Math.sqrt(st.n) / cost, sd: sd / cost,
    hitRate: st.hits / st.n, profitRate: st.profit / st.n, bonusEvery: st.bonus ? st.n / st.bonus : Infinity, bonusRate: st.bonus / st.n,
    baseRtp: st.baseSum / st.n / cost, fsRtp: fs.sum / st.n / cost,
    fsMean: fmean, fsCi95: fs.n ? 1.96 * fsd / Math.sqrt(fs.n) : 0, fsSpinsAvg: st.bonus ? st.fsSpins / st.bonus : 0, retrigPerBonus: st.bonus ? st.retrig / st.bonus : 0,
    cappedEvery: st.capped ? st.n / st.capped : Infinity, capped: st.capped, max: st.max,
    byK: Object.fromEntries([3, 4, 5].map(k => { const o = st.byK[k], m = o.n ? o.sum / o.n : 0; return [k, { n: o.n, mean: m, se: o.n ? Math.sqrt(Math.max(0, o.sumsq / o.n - m * m) / o.n) : 0 }]; })),
    dist: st.cnt.map((c, i) => ({ range: bucketLabel(i), share: c / st.n, rtpShare: st.amt[i] / st.n / cost }))
  };
}
export const pct = (v, d = 2) => (v * 100).toFixed(d) + '%';
export const every = v => Number.isFinite(v) ? '1 из ' + (v >= 100 ? Math.round(v).toLocaleString('ru-RU') : v.toFixed(1)) : '—';

/* ---------- параллельный прогон ---------- */
import { Worker } from 'node:worker_threads';
import os from 'node:os';
export function simParallel(tune, mode, rounds, seed, threads = Math.max(1, Math.min(os.cpus().length, 8))) {
  const per = Math.ceil(rounds / threads), jobs = [];
  for (let i = 0; i < threads; i++) {
    const n = Math.min(per, rounds - i * per); if (n <= 0) break;
    jobs.push(new Promise((res, rej) => {
      const w = new Worker(new URL('./math_worker.mjs', import.meta.url), { workerData: { tune, mode, rounds: n, seed: (seed * 7919 + i * 104729 + 13) >>> 0 } });
      w.once('message', res); w.once('error', rej);
    }));
  }
  return Promise.all(jobs).then(parts => parts.reduce((a, b) => merge(a, b)));
}
