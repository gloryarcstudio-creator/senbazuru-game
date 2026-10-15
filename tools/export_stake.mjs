#!/usr/bin/env node
/* Выгрузка математики для Stake Engine (статические файлы RGS).
 *
 *   node tools/export_stake.mjs [--out math/stake] [--size 1] [--scan 1] [--level 19] [--jobs 2]
 *   node tools/export_stake.mjs --reweight     пересчитать только веса (таблицы .csv и отчёт) по готовым книгам
 *
 * На выходе — папка для загрузки в Stake Engine:
 *   index.json                    список режимов: name, cost, events, weights
 *   lookUpTable_<mode>_0.csv      id,вес,выплата  (uint64; выплата в сотых долях ставки, кратна 10)
 *   books_<mode>.jsonl.zst        строка на раунд: {"id","payoutMultiplier","events"}
 * и рядом отчёт math/stake_report.md / .json.
 *
 * Как это устроено. RGS не крутит математику, а выбирает готовый раунд («книгу») по весу из таблицы. Поэтому:
 *   1. Скан: десятки миллионов раундов движка assets/js/math.js без записи событий — считаем, как часто встречается каждый
 *      класс раундов (страта: размер выигрыша, число скаттеров, потолок), и запоминаем сиды для книг.
 *   2. Книги: для выбранных сидов раунд проигрывается ещё раз с записью событий. Редких крупных выигрышей берём больше,
 *      чем их доля, — чтобы в файле были разные большие раунды, а вес страты равен её настоящей вероятности.
 *   3. Веса: вероятность страты делится между её книгами. Вход в бонус — по точной формуле (скаттеры независимы по барабанам),
 *      линии вращений без бонуса — по точному перебору, остальное — по скану. Затем веса внутри страт слегка наклоняются,
 *      чтобы RTP таблицы был ровно 96.00% цены режима (вероятности самих страт при этом не меняются).
 *
 * Раунды с бонусом для base, ante2, ante4 и bonus берутся из одного генератора (режим BONUS движка): при заданном числе скаттеров
 * раунд распределён одинаково во всех трёх режимах, различается только вероятность 3 / 4 / 5 скаттеров. Сиды у режимов разные.
 * --size 0.02 --scan 0.02 --level 3 — быстрый пробный прогон.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const M = require(path.join(ROOT, 'assets/js/math.js'));
const { CONFIG, TUNE } = M;
const REELS = CONFIG.reels, ROWS = CONFIG.rows, UNIT = CONFIG.unit, CAP = CONFIG.maxWin * UNIT;
const RTP = 0.96;                       // целевой RTP таблиц
const SCALE = 1e13;                     // сумма весов режима: даже сумма «вес × выплата» (до 2.9e17) помещается в int64

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

/* ---------- режимы и квоты книг ---------- */
// Границы выигрыша (× ставки) для страт. Раунды без бонуса: 0 | (0;2) | [2;10) | [10;50) | [50;200) | [200;1000) | [1000;…)
const NB_EDGES = [0.005, 2, 10, 50, 200, 1000];
const NB_QUOTA = [250000, 90000, 40000, 15000, 4000, 800, 200];
// Раунды с бонусом: пять корзин по итогу раунда + отдельная страта «потолок»
const T_EDGES = { BONUS: [20, 100, 500, 2000], SUPER: [50, 200, 1000, 4000], LANTERN: [20, 75, 300, 1500], FOLD: [30, 150, 600, 3000] };
const T_SHARE = { BONUS: [0.30, 0.33, 0.25, 0.08, 0.04], SUPER: [0.20, 0.35, 0.30, 0.10, 0.05], LANTERN: [0.25, 0.33, 0.27, 0.10, 0.05], FOLD: [0.25, 0.33, 0.27, 0.10, 0.05] };
const MODES = {
  base:  { engine: 'BASE',  profile: 'base', forced: 'BONUS', pool: 0, nbScan: 200e6, t: { 3: 51000, 4: 7500, 5: 1000, cap: 500 } },
  ante2: { engine: 'ANTE2', profile: 'ante2', forced: 'BONUS', pool: 1, nbScan: 200e6, t: { 3: 51000, 4: 7500, 5: 1000, cap: 500 } },
  ante4: { engine: 'ANTE4', profile: 'ante4', forced: 'BONUS', pool: 2, nbScan: 200e6, t: { 3: 51000, 4: 7500, 5: 1000, cap: 500 } },
  bonus: { engine: 'BONUS', profile: 'base', forced: 'BONUS', pool: 3, t: { 3: 86000, 4: 12000, 5: 1500, cap: 500 } },
  super: { engine: 'SUPER', profile: 'base', forced: 'SUPER', pool: 0, t: { 3: 77000, 4: 11000, 5: 1500, cap: 500 } },
  lantern: { engine: 'LANTERN', profile: 'base', forced: 'LANTERN', pool: 0, t: { 3: 50000, 4: 8000, 5: 1200, cap: 500 } },
  fold:  { engine: 'FOLD',  profile: 'base', forced: 'FOLD',  pool: 0, t: { 3: 55000, 4: 8500, 5: 1200, cap: 400 } }
};
const FORCED_SCAN = { BONUS: 56e6, SUPER: 16e6, LANTERN: 20e6, FOLD: 24e6 };   // сколько раундов с гарантированным входом сканируем
const POOLS = { BONUS: 4, SUPER: 1, LANTERN: 1, FOLD: 1 };               // сиды BONUS делятся на четыре набора: base, ante2, ante4, bonus

const bucketOf = (edges, x) => { let b = 0; while (b < edges.length && x >= edges[b]) b++; return b; };
function forcedQuotas(forced, size) {   // квоты книг по стратам для каждого набора сидов
  const out = [];
  for (const name of Object.keys(MODES)) {
    const m = MODES[name]; if (m.forced !== forced) continue;
    const q = {};
    for (const k of [3, 4, 5]) T_SHARE[forced].forEach((s, b) => { q['k' + k + 'b' + b] = Math.max(1, Math.round(m.t[k] * s * size)); });
    q.cap = Math.max(1, Math.round(m.t.cap * size));
    out[m.pool] = q;
  }
  return out;
}

/* ---------- точные формулы ---------- */
const C5 = [1, 5, 10, 10, 5, 1];
const scatterDist = q => C5.map((c, k) => c * Math.pow(q, k) * Math.pow(1 - q, REELS - k));   // P(ровно k барабанов со скаттером)
/* Средний выигрыш линий одного вращения при заданном наборе барабанов со скаттером (точный перебор), в сотых долях ставки. */
function exactLinesGivenMask(profile, mask) {
  const per = profile.dist.map((d, r) => (mask >> r & 1)
    ? d.map(o => ({ code: o.code, mult: o.mult, p: o.p * (1 - 1 / ROWS) })).concat([{ code: M.S, mult: 1, p: 1 / ROWS }])
    : d.map(o => ({ code: o.code, mult: o.mult, p: o.p })));
  const lc = new Int8Array(REELS), lm = new Int16Array(REELS); let ev = 0;
  (function rec(r, pr) {
    if (r === REELS) { ev += pr * M.linePay(lc, lm); return; }
    for (const o of per[r]) { lc[r] = o.code; lm[r] = o.mult; rec(r + 1, pr * o.p); }
  })(0, 1);
  return ev * CONFIG.lines.length;
}
function exactNoBonusMean(profile) {   // E[выигрыш | скаттеров меньше трёх]
  const q = profile.scatter; let sum = 0, pr = 0;
  for (let mask = 0; mask < 32; mask++) {
    let k = 0; for (let r = 0; r < REELS; r++) k += mask >> r & 1;
    if (k >= CONFIG.retrigger.scatters) continue;
    const p = Math.pow(q, k) * Math.pow(1 - q, REELS - k); pr += p; sum += p * exactLinesGivenMask(profile, mask);
  }
  return sum / pr;
}

/* =====================================================================================================
 * Рабочий процесс: скан сидов без записи событий
 * ===================================================================================================== */
function scanJob(job) {
  const E = M.createEngine(TUNE), { kind, mode, from, to } = job;
  const out = { kind, mode, from, to, n: 0, strata: {}, seeds: [], kCount: { 3: 0, 4: 0, 5: 0 }, kCap: { 3: 0, 4: 0, 5: 0 }, kSum: { 3: 0, 4: 0, 5: 0 }, kSq: { 3: 0, 4: 0, 5: 0 }, trig: 0, sum: 0, sumsq: 0 };
  const st = key => out.strata[key] || (out.strata[key] = { n: 0, sum: 0 });
  const pools = job.quotas.length; for (let p = 0; p < pools; p++) out.seeds.push({});
  const take = (pool, key, seed) => { const q = job.quotas[pool][key] || 0, list = out.seeds[pool][key] || (out.seeds[pool][key] = []); if (list.length < q) list.push(seed); };
  for (let seed = from; seed <= to; seed++) {
    const r = E.playRound(mode, M.rng32(seed), null), x = r.payout / UNIT;
    out.n++; out.sum += x; out.sumsq += x * x;
    if (kind === 'nb') {
      if (r.bonus) { out.trig++; out.kCount[Math.min(r.scatters, 5)]++; continue; }
      const key = 'n' + bucketOf(NB_EDGES, x), s = st(key); s.n++; s.sum += r.payout; take(0, key, seed);
    } else {
      const k = Math.min(r.scatters, 5); out.kCount[k]++; out.kSum[k] += r.payout; out.kSq[k] += x * x;
      if (r.capped) { out.kCap[k]++; const s = st('cap'); s.n++; s.sum += r.payout; take(seed % pools, 'cap', seed); continue; }
      const key = 'k' + k + 'b' + bucketOf(T_EDGES[mode], x), s = st(key); s.n++; s.sum += r.payout; take(seed % pools, key, seed);
    }
  }
  return out;
}

/* =====================================================================================================
 * Рабочий процесс: книги и таблица весов одного режима
 * ===================================================================================================== */
async function writeJob(job) {
  const E = M.createEngine(TUNE), { name, strata, outDir, level } = job, cost = CONFIG.modes[MODES[name].engine].cost;
  const booksFile = path.join(outDir, `books_${name}.jsonl.zst`), lutFile = path.join(outDir, `lookUpTable_${name}_0.csv`);
  const Z = zlib.constants, zs = zlib.createZstdCompress({ params: { [Z.ZSTD_c_compressionLevel]: level } });
  const sink = fs.createWriteStream(booksFile); zs.pipe(sink);
  const pays = [], sidx = []; let id = 0, raw = 0, events = 0, chunk = [];
  const flush = async () => { if (!chunk.length) return; const buf = Buffer.from(chunk.join('')); chunk = []; if (!zs.write(buf)) await once(zs, 'drain'); };
  for (let si = 0; si < strata.length; si++) {
    const s = strata[si];
    for (const seed of s.seeds) {
      const ev = [], r = E.playRound(s.engine, M.rng32(seed), ev), p = r.payout;
      // книга обязана попасть в ту же страту, что и при скане, а выплата — пройти проверки RGS
      if (s.check.cap !== !!r.capped || (s.check.bonus !== undefined && s.check.bonus !== !!r.bonus) || (s.check.k && Math.min(r.scatters, 5) !== s.check.k)) throw new Error(`${name}: сид ${seed} не из страты ${s.key}`);
      if (p / UNIT < s.check.lo || p / UNIT >= s.check.hi) throw new Error(`${name}: сид ${seed}, выплата ${p} вне страты ${s.key}`);
      if (!Number.isInteger(p) || p < 0 || p % 10 !== 0 || p > CAP) throw new Error(`${name}: недопустимая выплата ${p} (сид ${seed})`);
      const fin = ev[ev.length - 1]; if (fin.type !== 'finalWin' || fin.amount !== p) throw new Error(`${name}: finalWin не равен выплате (сид ${seed})`);
      const line = JSON.stringify({ id: ++id, payoutMultiplier: p, events: ev }) + '\n';
      chunk.push(line); raw += line.length; events += ev.length; pays.push(p); sidx.push(si);
      if (chunk.length >= 2000) await flush();
    }
  }
  await flush(); zs.end(); await once(sink, 'close');
  const w = await weigh(name, cost, strata, pays, sidx, job.nbTarget, lutFile);
  return Object.assign({ name, cost, books: pays.length, events, rawBytes: raw, zstBytes: fs.statSync(booksFile).size }, w);
}

/* =====================================================================================================
 * Веса: вероятность страты делится между её книгами, затем два шага подгонки. Пишет таблицу .csv.
 *   strata[i]: { group: 'nb' | 't', prob, meanScan }, pays[j] — выплата книги j, sidx[j] — её страта
 * ===================================================================================================== */
async function weigh(name, cost, strata, pays, sidx, nbTarget, lutFile) {
  const n = pays.length, lx = new Float64Array(n); for (let i = 0; i < n; i++) lx[i] = Math.log1p(pays[i] / UNIT);
  const groupOf = strata.map(s => s.group);              // 'nb' — без бонуса, 't' — с бонусом
  const theta = { nb: 0, t: 0 }, own = new Float64Array(strata.length), wts = new Float64Array(n);
  const fill = () => {                                   // вес книги = вероятность страты × доля книги внутри страты
    const norm = new Float64Array(strata.length);
    for (let i = 0; i < n; i++) { const si = sidx[i], t = Math.exp((own[si] + theta[groupOf[si]]) * lx[i]); wts[i] = t; norm[si] += t; }
    for (let i = 0; i < n; i++) wts[i] *= strata[sidx[i]].prob / norm[sidx[i]];
  };
  const mean = group => { let s = 0; for (let i = 0; i < n; i++) if (!group || groupOf[sidx[i]] === group) s += wts[i] * pays[i]; return s; };   // вклад в средний выигрыш, сотые доли
  const solve = (group, target) => {                     // наклон весов внутри страт: средний выигрыш группы → target
    let lo = -4, hi = 4;
    theta[group] = lo; fill(); if (mean(group) > target) throw new Error(`${name}: цель ${target} ниже достижимого для ${group}`);
    theta[group] = hi; fill(); if (mean(group) < target) throw new Error(`${name}: цель ${target} выше достижимого для ${group}`);
    for (let it = 0; it < 80; it++) { const mid = (lo + hi) / 2; theta[group] = mid; fill(); if (mean(group) < target) lo = mid; else hi = mid; }
    theta[group] = (lo + hi) / 2; fill();
  };
  fill(); const natural = { rtp: mean() / UNIT / cost, nb: mean('nb') / UNIT, t: mean('t') / UNIT };
  /* шаг 1: в каждой страте средний выигрыш книг приводим к среднему этой страты в скане (он посчитан на всех раундах скана) */
  const members = strata.map(() => []); for (let i = 0; i < n; i++) members[sidx[i]].push(i);
  let unmatched = 0;
  strata.forEach((s, si) => {
    const ix = members[si], want = s.meanScan * UNIT; let mn = Infinity, mx = -Infinity;
    for (const i of ix) { if (pays[i] < mn) mn = pays[i]; if (pays[i] > mx) mx = pays[i]; }
    if (mn === mx) return;                               // все книги страты платят одинаково
    const at = th => { let a = 0, b = 0; for (const i of ix) { const t = Math.exp(th * lx[i]); a += t * pays[i]; b += t; } return a / b; };
    let lo = -40, hi = 40; if (!(want > mn && want < mx) || at(lo) > want || at(hi) < want) { unmatched++; return; }
    for (let it = 0; it < 70; it++) { const mid = (lo + hi) / 2; if (at(mid) < want) lo = mid; else hi = mid; }
    own[si] = (lo + hi) / 2;
  });
  fill(); const matched = { rtp: mean() / UNIT / cost, nb: mean('nb') / UNIT, t: mean('t') / UNIT };
  /* шаг 2: общий небольшой наклон по группам — до точных значений */
  const target = RTP * cost * UNIT;
  if (nbTarget != null) solve('nb', nbTarget);        // линии без бонуса — к точному значению
  solve('t', target - mean('nb'));                       // раунды с бонусом добирают до 96.00%
  /* целые веса: сумма около SCALE, ошибка округления в RTP — порядка 1e-8 */
  const W = new Array(n); let total = 0n, wsum = 0n;
  for (let i = 0; i < n; i++) { const w = BigInt(Math.max(1, Math.round(wts[i] * SCALE))); W[i] = w; total += w; wsum += w * BigInt(pays[i]); }
  const lut = fs.createWriteStream(lutFile); let buf = [];
  for (let i = 0; i < n; i++) { buf.push((i + 1) + ',' + W[i] + ',' + pays[i] + '\n'); if (buf.length >= 20000) { if (!lut.write(buf.join(''))) await once(lut, 'drain'); buf = []; } }
  lut.end(buf.join('')); await once(lut, 'close');

  const per = strata.map(() => ({ books: 0, w: 0n, ws: 0n }));
  for (let i = 0; i < n; i++) { const o = per[sidx[i]]; o.books++; o.w += W[i]; o.ws += W[i] * BigInt(pays[i]); }
  const num = (a, b) => Number(a * 1000000000000n / b) / 1e12;
  return {
    lutBytes: fs.statSync(lutFile).size,
    totalWeight: total.toString(), rtp: num(wsum, total) / UNIT / cost, rtpNatural: natural.rtp, rtpMatched: matched.rtp, unmatched, theta, thetaOwn: Array.from(own),
    nbMean: { natural: natural.nb, matched: matched.nb, final: mean('nb') / UNIT }, tMean: { natural: natural.t, matched: matched.t, final: mean('t') / UNIT },
    strata: strata.map((s, i) => ({ key: s.key, label: s.label, group: s.group, prob: s.prob, books: per[i].books, share: num(per[i].w, total), rtpShare: num(per[i].ws, total) / UNIT / cost,
      meanScan: s.meanScan, meanBooks: per[i].w ? num(per[i].ws, per[i].w) / UNIT : 0 }))
  };
}

/* =====================================================================================================
 * Главный процесс
 * ===================================================================================================== */
if (process.argv[2] === '--job') {
  const job = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const res = job.type === 'scan' ? scanJob(job) : await writeJob(job);
  fs.writeFileSync(process.argv[3] + '.out', JSON.stringify(res));
  process.exit(0);
}

const OUT = path.resolve(arg('out', path.join(ROOT, 'math/stake')));
const SIZE = Number(arg('size', 1)), SCAN = Number(arg('scan', 1)), LEVEL = Number(arg('level', 19)), JOBS = Number(arg('jobs', Math.min(os.cpus().length, 8)));
const REPORT = path.join(path.dirname(OUT), 'stake_report');
const t0 = Date.now(), log = s => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)} c] ${s}`);
const pct = (v, d = 2) => (v * 100).toFixed(d) + '%', every = p => (p > 0 ? '1 из ' + Math.round(1 / p).toLocaleString('ru-RU') : '—'), mb = b => (b / 1048576).toFixed(1) + ' МБ';

function renderReport(report) {
  fs.writeFileSync(REPORT + '.json', JSON.stringify(report, null, 1));
  const modes = Object.values(report.modes);
  let md = `# ${report.game} — файлы математики для Stake Engine\n\nПапка \`${path.relative(ROOT, OUT)}/\`: \`index.json\`, таблицы весов и книги раундов. Цель таблиц — RTP ${pct(report.targetRtp)} цены режима.\n\n`;
  md += '| Режим | Цена | Книг | RTP модели (оценка) | RTP таблицы: веса поровну | по средним скана | итог | Вход в бонус | Потолок 15000× | Книги .zst | Таблица .csv |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const w of modes) md += `| ${w.name} | ${w.cost}× | ${w.books.toLocaleString('ru-RU')} | ${pct(w.model.rtp, 3)} ± ${pct(w.model.ci95, 3)} | ${pct(w.rtpNatural, 3)} | ${pct(w.rtpMatched, 3)} | **${pct(w.rtp, 4)}** | ${w.triggerProb < 1 ? every(w.triggerProb) : 'каждый раунд'} | ${every(w.capProb)} | ${mb(w.zstBytes)} | ${mb(w.lutBytes)} |\n`;
  md += '\n«RTP модели» — оценка для движка `assets/js/math.js`: вход в бонус и линии без бонуса посчитаны точно, раунды с бонусом — по скану.\n«Веса поровну» — RTP таблицы, если внутри каждой страты все книги равновероятны; «по средним скана» — после того, как средний выигрыш каждой страты приведён к среднему в скане; «итог» — после общего наклона до 96.00%.\n\n## Скан движка (без записи событий)\n\n| Скан | Раундов | Средний выигрыш, × ставки | 95% ДИ |\n|---|---|---|---|\n';
  for (const [k, s] of Object.entries(report.scans)) md += `| ${k} | ${s.rounds.toLocaleString('ru-RU')} | ${s.mean.toFixed(4)} | ± ${s.ci95.toFixed(4)} |\n`;
  md += '\n## Страты\n';
  for (const w of modes) {
    md += `\n### ${w.name}\n\n| Страта | Вероятность | Книг | Вклад в RTP | Средний выигрыш в скане, × | в книгах, × |\n|---|---|---|---|---|---|\n`;
    for (const s of w.strata) md += `| ${s.label} | ${s.prob >= 0.001 ? pct(s.prob, 3) : s.prob.toExponential(3)} | ${s.books.toLocaleString('ru-RU')} | ${pct(s.rtpShare, 3)} | ${s.meanScan.toFixed(3)} | ${s.meanBooks.toFixed(3)} |\n`;
    md += `\nОбщий наклон весов внутри страт: без бонуса ${w.theta.nb.toFixed(4)}, с бонусом ${w.theta.t.toFixed(4)} (вес книги умножен на (1 + выигрыш)^наклон; вероятности страт не меняются). Сумма весов ${Number(w.totalWeight).toExponential(2)}.${w.unmatched ? ' Страт, где среднее скана вне диапазона книг: ' + w.unmatched + '.' : ''}\n`;
  }
  if (report.notes.length) md += '\n## Примечания\n\n' + report.notes.map(n => '- ' + n).join('\n') + '\n';
  fs.writeFileSync(REPORT + '.md', md);
  for (const w of modes) log(`${w.name}: книг ${w.books.toLocaleString('ru-RU')}, RTP модели ${pct(w.model.rtp, 3)} ± ${pct(w.model.ci95, 3)}; таблица: поровну ${pct(w.rtpNatural, 3)} → по скану ${pct(w.rtpMatched, 3)} → итог ${pct(w.rtp, 6)}; наклон ${w.theta.nb.toFixed(4)} / ${w.theta.t.toFixed(4)}; книги ${mb(w.zstBytes)}, таблица ${mb(w.lutBytes)}`);
  for (const n of report.notes) log(n);
}

/* ---- только веса: книги и страты уже есть, таблицы пересчитываются по сохранённому отчёту ---- */
if (process.argv.includes('--reweight')) {
  const report = JSON.parse(fs.readFileSync(REPORT + '.json', 'utf8')), profiles = M.createEngine(TUNE).profiles;
  for (const name of Object.keys(report.modes)) {
    const old = report.modes[name], lutFile = path.join(OUT, `lookUpTable_${name}_0.csv`), m = MODES[name];
    const pays = fs.readFileSync(lutFile, 'utf8').trim().split('\n').map(l => Number(l.split(',')[2])), sidx = [];
    old.strata.forEach((st, si) => { for (let i = 0; i < st.books; i++) sidx.push(si); });
    if (sidx.length !== pays.length) throw new Error(`${name}: в отчёте ${sidx.length} книг, в таблице ${pays.length}`);
    let nbTarget = null; if (m.nbScan) { const prof = profiles[m.profile], sd = scatterDist(prof.scatter); nbTarget = (1 - sd[3] - sd[4] - sd[5]) * exactNoBonusMean(prof); }
    Object.assign(old, await weigh(name, old.cost, old.strata, pays, sidx, nbTarget, lutFile));
  }
  report.reweighted = new Date().toISOString(); renderReport(report); log('веса пересчитаны: ' + path.relative(ROOT, OUT));
  process.exit(0);
}

const TMP = path.join(OUT, '.tmp'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });

let jobSeq = 0;
function runJob(job) {
  const file = path.join(TMP, `job${++jobSeq}.json`); fs.writeFileSync(file, JSON.stringify(job));
  return new Promise((res, rej) => {
    const ch = spawn(process.execPath, [SELF, '--job', file], { stdio: ['ignore', 'inherit', 'inherit'] });
    ch.on('exit', code => { if (code) rej(new Error(`задача ${job.type} ${job.mode || job.name} завершилась с кодом ${code}`)); else { const r = JSON.parse(fs.readFileSync(file + '.out', 'utf8')); fs.rmSync(file); fs.rmSync(file + '.out'); res(r); } });
  });
}
async function pool(jobs, width) {   // не больше width задач одновременно, результаты — в исходном порядке
  const res = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; res[i] = await runJob(jobs[i]); } }));
  return res;
}

/* ---- 1. скан ---- */
const scanDefs = [];
for (const name of ['base', 'ante2', 'ante4']) scanDefs.push({ id: name, kind: 'nb', mode: MODES[name].engine, total: Math.round(MODES[name].nbScan * SCAN), quotas: [Object.fromEntries(NB_QUOTA.map((q, b) => ['n' + b, Math.max(1, Math.round(q * SIZE))]))] });
for (const forced of Object.keys(FORCED_SCAN)) scanDefs.push({ id: forced, kind: 'forced', mode: forced, total: Math.round(FORCED_SCAN[forced] * SCAN), quotas: forcedQuotas(forced, SIZE) });
const PARTS = Math.max(2, JOBS), scanJobs = [];
for (const d of scanDefs) for (let p = 0; p < PARTS; p++) {
  const from = Math.floor(d.total * p / PARTS) + 1, to = Math.floor(d.total * (p + 1) / PARTS);
  scanJobs.push({ type: 'scan', id: d.id, kind: d.kind, mode: d.mode, from, to, quotas: d.quotas });
}
log(`скан: ${scanDefs.map(d => d.id + ' ' + (d.total / 1e6).toFixed(1) + ' млн').join(', ')}; процессов ${JOBS}`);
const scanParts = await pool(scanJobs, JOBS);
const scans = {};
for (const d of scanDefs) {
  const parts = scanParts.filter((_, i) => scanJobs[i].id === d.id), a = { n: 0, sum: 0, sumsq: 0, trig: 0, strata: {}, seeds: d.quotas.map(() => ({})), kCount: { 3: 0, 4: 0, 5: 0 }, kCap: { 3: 0, 4: 0, 5: 0 }, kSum: { 3: 0, 4: 0, 5: 0 }, kSq: { 3: 0, 4: 0, 5: 0 } };
  for (const p of parts) {
    a.n += p.n; a.sum += p.sum; a.sumsq += p.sumsq; a.trig += p.trig;
    for (const k of [3, 4, 5]) { a.kCount[k] += p.kCount[k]; a.kCap[k] += p.kCap[k]; a.kSum[k] += p.kSum[k]; a.kSq[k] += p.kSq[k]; }
    for (const [key, s] of Object.entries(p.strata)) { const t = a.strata[key] || (a.strata[key] = { n: 0, sum: 0 }); t.n += s.n; t.sum += s.sum; }
    p.seeds.forEach((byKey, pl) => { for (const [key, list] of Object.entries(byKey)) { const q = d.quotas[pl][key], t = a.seeds[pl][key] || (a.seeds[pl][key] = []); for (const s of list) if (t.length < q) t.push(s); } });
  }
  scans[d.id] = a;
  log(`скан ${d.id}: ${a.n.toLocaleString('ru-RU')} раундов, средний выигрыш ${(a.sum / a.n).toFixed(4)}×`);
}

/* ---- 2. страты и их вероятности ---- */
const profiles = M.createEngine(TUNE).profiles, plan = {}, notes = [], BIG = 1e12;
const fmtX = v => (v >= 1000 ? v.toLocaleString('en-US') : String(v));
for (const name of Object.keys(MODES)) {
  const m = MODES[name], prof = profiles[m.profile], sd = scatterDist(prof.scatter), pT = sd[3] + sd[4] + sd[5];
  const hasNb = !!m.nbScan, strata = []; let nbTarget = null;
  if (hasNb) {
    const sc = scans[name], nbN = sc.n - sc.trig;
    nbTarget = (1 - pT) * exactNoBonusMean(prof);   // вклад раундов без бонуса в средний выигрыш, сотые доли ставки
    NB_QUOTA.forEach((_, b) => {
      const key = 'n' + b, s = sc.strata[key]; if (!s) return;
      const lo = b === 0 ? 0 : NB_EDGES[b - 1], hi = b < NB_EDGES.length ? NB_EDGES[b] : BIG;
      strata.push({ key, group: 'nb', engine: m.engine, label: b === 0 ? 'без бонуса, без выигрыша' : `без бонуса, ${b === 1 ? '(0' : '[' + fmtX(lo)}; ${hi === BIG ? '…' : fmtX(hi)})×`,
        prob: (1 - pT) * s.n / nbN, seeds: sc.seeds[0][key] || [], meanScan: s.sum / s.n / UNIT, check: { cap: false, bonus: false, lo, hi } });
    });
    const nbScanMean = Object.values(sc.strata).reduce((acc, s) => acc + s.sum, 0) / nbN / UNIT;
    notes.push(`${name}: вход в бонус по формуле — 1 из ${(1 / pT).toFixed(2)}, в скане — 1 из ${(sc.n / sc.trig).toFixed(2)}; средний выигрыш раунда без бонуса: точный перебор ${(nbTarget / (1 - pT) / UNIT).toFixed(5)}×, скан ${nbScanMean.toFixed(5)}×`);
  }
  const fs_ = scans[m.forced], edges = T_EDGES[m.forced]; let capProb = 0;
  for (const k of [3, 4, 5]) {
    const pk = hasNb ? sd[k] : sd[k] / pT, nk = fs_.kCount[k]; if (!nk) continue;
    capProb += pk * fs_.kCap[k] / nk;
    for (let b = 0; b <= edges.length; b++) {
      const key = 'k' + k + 'b' + b, s = fs_.strata[key]; if (!s) continue;
      const lo = b === 0 ? 0 : edges[b - 1], hi = b < edges.length ? edges[b] : CONFIG.maxWin + 1;
      strata.push({ key, group: 't', engine: m.forced, label: `бонус, ${k} скаттер${k === 3 ? 'а' : k === 4 ? 'а' : 'ов'}, [${fmtX(lo)}; ${b < edges.length ? fmtX(hi) : fmtX(CONFIG.maxWin)})×`,
        prob: pk * s.n / nk, seeds: fs_.seeds[m.pool][key] || [], meanScan: s.sum / s.n / UNIT, check: { cap: false, k, lo, hi } });
    }
  }
  strata.push({ key: 'cap', group: 't', engine: m.forced, label: `потолок ${fmtX(CONFIG.maxWin)}×`, prob: capProb, seeds: fs_.seeds[m.pool].cap || [], meanScan: CONFIG.maxWin, check: { cap: true, lo: CONFIG.maxWin, hi: CONFIG.maxWin + 1 } });
  // страта без книг: её вероятность уходит соседней (ниже по выигрышу) страте той же группы
  for (let i = strata.length - 1; i >= 0; i--) if (!strata[i].seeds.length) {
    let j = i - 1; while (j >= 0 && (strata[j].group !== strata[i].group || !strata[j].seeds.length)) j--;
    if (j < 0) throw new Error(`${name}: в страте ${strata[i].key} нет книг и некуда отдать её вероятность`);
    notes.push(`${name}: для страты «${strata[i].label}» (вероятность ${strata[i].prob.toExponential(2)}) не нашлось раундов — вероятность отдана страте «${strata[j].label}»`);
    strata[j].prob += strata[i].prob; strata.splice(i, 1);
  }
  const tot = strata.reduce((a, s) => a + s.prob, 0); if (Math.abs(tot - 1) > 1e-9) throw new Error(`${name}: вероятности страт дают ${tot}`);
  // RTP модели: вход в бонус и линии без бонуса — точно, раунды с бонусом — по скану
  let mMean = hasNb ? nbTarget / UNIT : 0, mVar = 0;
  for (const k of [3, 4, 5]) { const pk = hasNb ? sd[k] : sd[k] / pT, nk = fs_.kCount[k]; if (!nk) continue; const mk = fs_.kSum[k] / nk / UNIT; mMean += pk * mk; mVar += pk * pk * Math.max(0, fs_.kSq[k] / nk - mk * mk) / nk; }
  const cost = CONFIG.modes[m.engine].cost, model = { rtp: mMean / cost, ci95: 1.96 * Math.sqrt(mVar) / cost };
  plan[name] = { strata, nbTarget, model, pT: hasNb ? pT : 1, capProb, kDist: [3, 4, 5].map(k => hasNb ? sd[k] : sd[k] / pT) };
  log(`${name}: страт ${strata.length}, книг ${strata.reduce((a, s) => a + s.seeds.length, 0).toLocaleString('ru-RU')}`);
}

/* ---- 3. книги и веса ---- */
const order = Object.keys(MODES);
const written = await pool(order.map(name => ({ type: 'write', name, strata: plan[name].strata, nbTarget: plan[name].nbTarget, outDir: OUT, level: LEVEL })), JOBS);
const fmtCost = c => (Number.isInteger(c) ? c.toFixed(1) : String(c));
fs.writeFileSync(path.join(OUT, 'index.json'), '{\n    "modes": [\n' + written.map(w =>
  `        {\n            "name": "${w.name}",\n            "cost": ${fmtCost(w.cost)},\n            "events": "books_${w.name}.jsonl.zst",\n            "weights": "lookUpTable_${w.name}_0.csv"\n        }`).join(',\n') + '\n    ]\n}\n');
fs.rmSync(TMP, { recursive: true, force: true });

/* ---- 4. отчёт ---- */
renderReport({ game: CONFIG.game, mathVersion: CONFIG.mathVersion, targetRtp: RTP, generated: new Date().toISOString(), args: { size: SIZE, scan: SCAN, level: LEVEL },
  scans: Object.fromEntries(Object.entries(scans).map(([k, s]) => { const mean = s.sum / s.n, sdv = Math.sqrt(Math.max(0, s.sumsq / s.n - mean * mean)); return [k, { rounds: s.n, mean, ci95: 1.96 * sdv / Math.sqrt(s.n), trigger: s.trig, kCount: s.kCount, kCap: s.kCap, kMean: Object.fromEntries([3, 4, 5].map(q => [q, s.kCount[q] ? s.kSum[q] / s.kCount[q] / UNIT : 0])) }]; })),
  modes: Object.fromEntries(written.map(w => [w.name, Object.assign({}, w, { model: plan[w.name].model, triggerProb: plan[w.name].pT, capProb: plan[w.name].capProb, kDist: plan[w.name].kDist })])), notes });
log('готово: ' + path.relative(ROOT, OUT));
