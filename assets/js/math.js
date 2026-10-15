/* Senbazuru 5×5 — математика раунда (один источник правды для симулятора, выгрузки и демо-режима).
 *
 * Правила:
 *   5×5, 5 линий (по ряду), слева направо с первого барабана; на линии платится только старшая комбинация, линии суммируются.
 *   WILD (барабаны 2–4) заменяет платящие символы и несёт множитель (×2/×3/×5, во фриспинах до ×10); множители вайлдов в комбинации перемножаются.
 *   SCATTER — не больше одного на барабан; 3/4/5 скаттеров дают 8/10/12 фриспинов.
 *   Фриспины: каждый выпавший вайлд остаётся на месте до конца бонуса вместе со своим множителем.
 *   Ретриггер: 3+ скаттера во фриспинах добавляют 5 вращений (всего не больше maxFs).
 *   Режимы: BASE 1×, ANTE2 2× и ANTE4 4× (чаще скаттеры), BONUS 100× (гарантированный вход), SUPER 300× (вход + три стартовых липких вайлда).
 *   Все суммы — целые, в сотых долях базовой ставки. Выигрыш раунда обрезается на maxWin×, раунд на этом заканчивается.
 *
 * Раунд = список событий; презентация только воспроизводит их:
 *   reveal, winInfo, setTotalWin, freeSpinTrigger, updateFreeSpin, retrigger, wincap, bonusEnd, finalWin
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SenbazuruMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const REELS = 5, ROWS = 5, CELLS = REELS * ROWS, UNIT = 100;
const SYMS = ['L1', 'L2', 'L3', 'L4', 'H4', 'H3', 'H2', 'H1', 'W', 'S'];
const NPAY = 8, W = 8, S = 9, TOP = 7;

const CONFIG = {
  game: 'senbazuru', mathVersion: 3,
  reels: REELS, rows: ROWS, unit: UNIT, maxWin: 15000,
  lines: [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4]],
  // выплаты за 3 / 4 / 5 символов на линии, в сотых долях ставки
  paytable: {
    L1: [20, 60, 250], L2: [20, 60, 250], L3: [30, 100, 400], L4: [30, 100, 400],
    H4: [60, 200, 800], H3: [100, 400, 1500], H2: [200, 800, 4000], H1: [500, 2500, 15000]
  },
  wildReels: [1, 2, 3],
  fsAward: { 3: 8, 4: 10, 5: 12 },
  retrigger: { scatters: 3, add: 5 },
  maxFs: 40,
  superStartWilds: 3,
  modes: {
    BASE:  { cost: 1,    profile: 'base' },
    ANTE2: { cost: 2,    profile: 'ante2' },
    ANTE4: { cost: 4,    profile: 'ante4' },
    BONUS: { cost: 100,  profile: 'base', force: true },
    SUPER: { cost: 300,  profile: 'base', force: true, super: true },
    LANTERN: { cost: 75, profile: 'base', force: true, feature: 'lantern' },
    FOLD:  { cost: 150,  profile: 'base', force: true, feature: 'fold' }
  }
};

/* Подгоняемые параметры. Блок между метками переписывает tools/math_tune.mjs. */
/*TUNE-BEGIN*/
const TUNE = {
  "base": { "sym": [300, 260, 190, 160, 110, 80, 55, 30], "wild": 129.581, "wildMult": [[2, 70], [3, 25], [5, 5]], "scatter": 0.065131 },
  "ante2": { "scatter": 0.114395 },
  "ante4": { "scatter": 0.159553 },
  "fs": { "sym": [300, 260, 190, 160, 110, 80, 55, 30], "wild": 73.797, "wildMult": [[2, 50], [3, 30], [5, 15], [10, 5]], "scatter": 0.08 },
  "lantern": { "wild": 247.6, "scatter": 0.16, "wildMult": [[2, 40], [3, 30], [5, 20], [10, 10]] },
  "fold": { "wild": 133.2, "wildMult": [[2, 70], [3, 30]] },
  "super": { "wild": 79.532, "wildMult": [[2, 50], [3, 30], [5, 15], [10, 5]], "startMult": [[2, 50], [3, 30], [5, 15], [10, 5]] }
};
/*TUNE-END*/

function rng32(seed) { // mulberry32
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- старшая комбинация на линии ---------- */
const PAY = SYMS.slice(0, NPAY).map(s => CONFIG.paytable[s]);
const LW = { pay: 0, sym: -1, kind: 0, mult: 1, base: 0 };
function linePay(lc, lm) {
  LW.pay = 0; LW.sym = -1; LW.kind = 0; LW.mult = 1; LW.base = 0;
  let s = -1;
  for (let r = 0; r < REELS; r++) if (lc[r] !== W) { s = lc[r]; break; }
  if (s >= 0 && s !== S) {
    let k = 0, m = 1;
    while (k < REELS) { const c = lc[k]; if (c === s) k++; else if (c === W) { m *= lm[k]; k++; } else break; }
    if (k >= 3) { LW.base = PAY[s][k - 3]; LW.pay = LW.base * m; LW.sym = s; LW.kind = k; LW.mult = m; }
  }
  let lead = 0, m2 = 1; // линия начинается с вайлдов: они платят как старший символ, если это выгоднее
  while (lead < REELS && lc[lead] === W) { m2 *= lm[lead]; lead++; }
  if (lead >= 3 && PAY[TOP][lead - 3] * m2 > LW.pay) { LW.base = PAY[TOP][lead - 3]; LW.pay = LW.base * m2; LW.sym = TOP; LW.kind = lead; LW.mult = m2; }
  return LW.pay;
}

/* ---------- профили барабанов ---------- */
function cellDist(sym, wild, wildMult, reel) {
  // -> [{code, mult, p}] для одной ячейки барабана (без скаттера)
  const out = []; let tot = 0;
  for (let i = 0; i < NPAY; i++) { out.push({ code: i, mult: 1, p: sym[i] }); tot += sym[i]; }
  if (CONFIG.wildReels.indexOf(reel) >= 0 && wild > 0) {
    let mt = 0; for (const [, w] of wildMult) mt += w;
    for (const [m, w] of wildMult) out.push({ code: W, mult: m, p: wild * w / mt });
    tot += wild;
  }
  for (const o of out) o.p /= tot;
  return out;
}
function compileProfile(sym, wild, wildMult, scatter) {
  const p = { scatter, cum: [], codes: [], mults: [], dist: [] };
  for (let r = 0; r < REELS; r++) {
    const d = cellDist(sym, wild, wildMult, r); let acc = 0;
    p.dist.push(d);
    p.cum.push(Float64Array.from(d, o => (acc += o.p)));
    p.codes.push(Int8Array.from(d, o => o.code));
    p.mults.push(Int16Array.from(d, o => o.mult));
  }
  return p;
}
function cumDist(pairs) { let t = 0; for (const [, w] of pairs) t += w; let a = 0; return pairs.map(([v, w]) => [v, (a += w / t)]); }

function createEngine(tune) {
  tune = tune || TUNE;
  const B = tune.base, F = tune.fs, X = tune.super;
  const P = {
    base: compileProfile(B.sym, B.wild, B.wildMult, B.scatter),
    ante2: compileProfile(B.sym, B.wild, B.wildMult, tune.ante2.scatter),
    ante4: compileProfile(B.sym, B.wild, B.wildMult, tune.ante4.scatter),
    fs: compileProfile(F.sym, F.wild, F.wildMult, F.scatter),
    super: compileProfile(F.sym, X.wild, X.wildMult, F.scatter),
    lantern: compileProfile(F.sym, tune.lantern.wild, tune.lantern.wildMult, tune.lantern.scatter),
    fold: compileProfile(F.sym, tune.fold.wild, tune.fold.wildMult, 0)
  };
  const startMult = cumDist(X.startMult);
  // вход в бонус при покупке: распределение «на каких барабанах скаттер» при условии ≥3, как в базовой игре
  const patterns = []; { let tot = 0;
    for (let m = 0; m < 32; m++) { let bits = 0, pr = 1; for (let r = 0; r < REELS; r++) { if (m >> r & 1) { bits++; pr *= B.scatter; } else pr *= 1 - B.scatter; } if (bits >= 3) { patterns.push([m, pr]); tot += pr; } }
    let a = 0; for (const p of patterns) p[1] = (a += p[1] / tot);
  }

  const board = new Int8Array(CELLS), mult = new Int16Array(CELLS), sticky = new Uint8Array(CELLS);
  const lc = new Int8Array(REELS), lm = new Int16Array(REELS);
  const LINES = CONFIG.lines, CAP = CONFIG.maxWin * UNIT;
  const res = { payout: 0, baseWin: 0, fsWin: 0, bonus: false, scatters: 0, fsSpins: 0, retriggers: 0, capped: false, events: null };

  function spin(p, rnd, mask, keepSticky) {
    for (let reel = 0; reel < REELS; reel++) {
      let srow = -1;
      if (mask >= 0) { if (mask >> reel & 1) srow = (rnd() * ROWS) | 0; }
      else if (rnd() < p.scatter) srow = (rnd() * ROWS) | 0;
      const cum = p.cum[reel], codes = p.codes[reel], mults = p.mults[reel], n = cum.length - 1;
      for (let row = 0; row < ROWS; row++) {
        const i = reel * ROWS + row;
        if (keepSticky && sticky[i]) continue;             // липкий вайлд остаётся со своим множителем
        if (row === srow) { board[i] = S; mult[i] = 1; continue; }
        const r = rnd(); let k = 0; while (k < n && r >= cum[k]) k++;
        board[i] = codes[k]; mult[i] = mults[k];
      }
    }
  }
  function countScatters() { let k = 0; for (let i = 0; i < CELLS; i++) if (board[i] === S) k++; return k; }
  function scatterPositions() { const out = []; for (let i = 0; i < CELLS; i++) if (board[i] === S) out.push({ reel: (i / ROWS) | 0, row: i % ROWS }); return out; }
  // rowMult — множитель фонаря для каждой линии (режим «Фонари линий»: вайлды там без своего множителя)
  function evalLines(wins, rowMult) {
    let total = 0;
    for (let li = 0; li < LINES.length; li++) {
      const ln = LINES[li];
      for (let r = 0; r < REELS; r++) { const i = r * ROWS + ln[r]; lc[r] = board[i]; lm[r] = rowMult ? 1 : mult[i]; }
      let pay = linePay(lc, lm);
      if (pay > 0) {
        const lan = rowMult ? rowMult[li] : 1; pay *= lan;
        total += pay;
        if (wins) {
          const positions = []; for (let r = 0; r < LW.kind; r++) positions.push({ reel: r, row: ln[r] });
          const meta = { lineIndex: li, multiplier: LW.mult * lan, winWithoutMult: LW.base };
          if (rowMult) meta.lantern = lan;
          wins.push({ symbol: SYMS[LW.sym], kind: LW.kind, win: pay, positions, meta });
        }
      }
    }
    return total;
  }
  function boardEvent() {
    const out = [];
    for (let reel = 0; reel < REELS; reel++) {
      const col = [];
      for (let row = 0; row < ROWS; row++) {
        const i = reel * ROWS + row, c = { name: SYMS[board[i]] };
        if (board[i] === W) { c.multiplier = mult[i]; if (sticky[i]) c.sticky = true; }
        col.push(c);
      }
      out.push(col);
    }
    return out;
  }

  function playRound(mode, rnd, rec) {
    const M = CONFIG.modes[mode];
    if (!M) throw new Error('unknown mode ' + mode);
    sticky.fill(0);
    res.payout = 0; res.baseWin = 0; res.fsWin = 0; res.bonus = false; res.scatters = 0; res.fsSpins = 0; res.retriggers = 0; res.capped = false; res.events = rec;
    const ev = rec ? (o => { o.index = rec.length; rec.push(o); }) : null;

    let mask = -1;
    if (M.force) { const u = rnd(); let k = 0; while (k < patterns.length - 1 && u >= patterns[k][1]) k++; mask = patterns[k][0]; }
    spin(P[M.profile], rnd, mask, false);
    if (ev) ev({ type: 'reveal', gameType: 'basegame', board: boardEvent() });
    let wins = rec ? [] : null;
    let total = evalLines(wins);
    if (total > CAP) total = CAP;
    res.baseWin = total;
    if (ev && total > 0) ev({ type: 'winInfo', totalWin: total, wins });
    if (ev) ev({ type: 'setTotalWin', amount: total });
    const k0 = countScatters(); res.scatters = k0;

    if (total >= CAP) { res.capped = true; if (ev) ev({ type: 'wincap', amount: CAP }); }
    else if (k0 >= CONFIG.retrigger.scatters) {
      res.bonus = true;
      let totalFs = CONFIG.fsAward[Math.min(k0, 5)], i = 0, fsWin = 0;
      const feat = M.feature || null;
      const p = M.super ? P.super : feat ? P[feat] : P.fs;
      const trig = { type: 'freeSpinTrigger', totalFs, positions: rec ? scatterPositions() : null, super: !!M.super };
      if (feat) trig.feature = feat;
      const lan = feat === 'lantern' ? [1, 1, 1, 1, 1] : null;
      if (lan) trig.lanterns = lan.slice();
      if (M.super) {
        const sw = [];
        for (let n = 0; n < CONFIG.superStartWilds; n++) {
          const reel = CONFIG.wildReels[n % CONFIG.wildReels.length], row = (rnd() * ROWS) | 0, idx = reel * ROWS + row;
          const u = rnd(); let q = 0; while (q < startMult.length - 1 && u >= startMult[q][1]) q++;
          sticky[idx] = 1; board[idx] = W; mult[idx] = startMult[q][0];
          sw.push({ reel, row, multiplier: mult[idx] });
        }
        trig.startWilds = sw;
      }
      if (ev) ev(trig);
      while (i < totalFs) {
        i++;
        if (ev) ev({ type: 'updateFreeSpin', amount: i, total: totalFs });
        spin(p, rnd, -1, !feat);
        if (!feat) for (let c = 0; c < CELLS; c++) if (board[c] === W) sticky[c] = 1;
        if (ev) ev({ type: 'reveal', gameType: 'freegame', board: boardEvent() });
        if (lan) {   // каждый вайлд добавляет свой множитель в фонарь своего ряда
          const adds = [];
          for (let c = 0; c < CELLS; c++) if (board[c] === W) { const row = c % ROWS; lan[row] += mult[c]; adds.push({ reel: (c / ROWS) | 0, row, add: mult[c] }); }
          if (ev && adds.length) ev({ type: 'lanternUpdate', adds, lanterns: lan.slice() });
        } else if (feat === 'fold') {   // сгиб по среднему барабану: одна половина зеркально отпечатывается на другую, вайлд-отпечаток ×2
          const left = rnd() < 0.5, prints = [];
          for (let k = 0; k < 2; k++) {
            const from = left ? k : REELS - 1 - k, to = REELS - 1 - from;
            for (let row = 0; row < ROWS; row++) {
              const a = from * ROWS + row, b = to * ROWS + row;
              board[b] = board[a]; mult[b] = board[a] === W ? mult[a] * 2 : 1;
              if (board[a] === W) prints.push({ reel: to, row, multiplier: mult[b] });
            }
          }
          if (ev) ev({ type: 'fold', side: left ? 'left' : 'right', board: boardEvent(), prints });
        }
        wins = rec ? [] : null;
        let w = evalLines(wins, lan);
        if (total + w > CAP) w = CAP - total;
        total += w; fsWin += w;
        if (ev && w > 0) ev({ type: 'winInfo', totalWin: w, wins });
        if (ev) ev({ type: 'setTotalWin', amount: total });
        if (total >= CAP) { res.capped = true; if (ev) ev({ type: 'wincap', amount: CAP }); break; }
        if (countScatters() >= CONFIG.retrigger.scatters && totalFs < CONFIG.maxFs) {
          const add = Math.min(CONFIG.retrigger.add, CONFIG.maxFs - totalFs); totalFs += add; res.retriggers++;
          const re = { type: 'retrigger', added: add, total: totalFs, positions: rec ? scatterPositions() : null };
          if (lan) { for (let r = 0; r < ROWS; r++) lan[r] *= 2; re.lanterns = lan.slice(); }   // «Фонари линий»: ретриггер удваивает все фонари
          if (ev) ev(re);
        }
      }
      res.fsSpins = i; res.fsWin = fsWin;
      if (ev) ev({ type: 'bonusEnd', amount: fsWin, spins: i });
    }
    res.payout = total;
    if (ev) ev({ type: 'finalWin', amount: total });
    return res;
  }

  /* раунд в том виде, в каком его отдаёт RGS */
  function book(mode, seed) {
    const events = [], r = playRound(mode, rng32(seed), events);
    return { mode, seed, payoutMultiplier: r.payout, events };
  }
  return { playRound, book, profiles: P, tune };
}

let _default = null;
return {
  CONFIG, TUNE, SYMS, UNIT, W, S, linePay, LW, rng32, createEngine,
  book(mode, seed) { if (!_default) _default = createEngine(TUNE); return _default.book(mode, seed); }
};
});
