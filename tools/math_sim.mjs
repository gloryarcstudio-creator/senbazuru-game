#!/usr/bin/env node
/* Симулятор: RTP ± 95% ДИ, hit rate, частота бонуса, распределение выигрышей по режимам.
 *   node tools/math_sim.mjs [--rounds 3000000] [--modes BASE,ANTE,BONUS,SUPER] [--seed 2026] [--no-save]
 * Сохраняет math/report.json и math/report.md; прошлый отчёт уходит в math/report_prev.json,
 * в конце печатается таблица «до / после».
 */
import fs from 'node:fs';
import path from 'node:path';
import { M, CONFIG, ROOT, simParallel, summary, pct, every, exactLines, scatterDist } from './math_lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const rounds = Number(arg('rounds', 3000000)), seed = Number(arg('seed', 2026));
const modes = arg('modes', Object.keys(CONFIG.modes).join(',')).split(',');
const save = !process.argv.includes('--no-save');
const dir = path.join(ROOT, 'math'); fs.mkdirSync(dir, { recursive: true });

const out = { mathVersion: CONFIG.mathVersion, rounds, seed, date: new Date().toISOString(), tune: M.TUNE, modes: {} };
const lines = [];
const P = (s = '') => { console.log(s); lines.push(s); };

P(`# ${CONFIG.game} — математика v${CONFIG.mathVersion}: симуляция ${rounds.toLocaleString('ru-RU')} раундов на режим (seed ${seed})`);
P();
P('| Режим | Цена | RTP ± 95% ДИ | σ, × цены | Hit rate | Бонус | Ср. бонус, × ставки | Ср. вращений | Потолок 15000× | Макс. в прогоне |');
P('|---|---|---|---|---|---|---|---|---|---|');
for (const [i, mode] of modes.entries()) {
  const t0 = Date.now();
  const s = summary(await simParallel(M.TUNE, mode, rounds, seed + i * 1000), mode);
  s.seconds = (Date.now() - t0) / 1000; out.modes[mode] = s;
  P(`| ${mode} | ${s.cost}× | **${pct(s.rtp)}** ± ${pct(s.ci95)} | ${s.sd.toFixed(1)} | ${pct(s.hitRate, 1)} | ${s.bonusRate >= 0.999 ? 'каждый раунд' : every(s.bonusEvery)} | ${s.fsMean.toFixed(1)} ± ${s.fsCi95.toFixed(1)} | ${s.fsSpinsAvg.toFixed(2)} | ${every(s.cappedEvery)} | ${s.max.toLocaleString('ru-RU')}× |`);
}
P();
P('Hit rate — доля раундов с выигрышем больше нуля. ДИ — нормальное приближение по выборочной дисперсии.');

// точная часть базовой игры и разложение RTP
const eng = M.createEngine(M.TUNE);
P(); P('## Разложение RTP (линии — точный перебор, бонус — из прогона BONUS)'); P();
P('| Режим | Линии базового вращения | Вход в бонус | Вклад бонуса | Итого (оценка) |'); P('|---|---|---|---|---|');
const bon = out.modes.BONUS;
if (bon) for (const mode of ['BASE', 'ANTE']) {
  const prof = eng.profiles[CONFIG.modes[mode].profile], L = exactLines(prof), d = scatterDist(prof.scatter), cost = CONFIG.modes[mode].cost;
  let f = 0; for (const k of [3, 4, 5]) f += d[k] * (bon.byK[k].n ? bon.byK[k].mean : bon.fsMean);
  const ptrig = d[3] + d[4] + d[5];
  out.modes[mode] && (out.modes[mode].exact = { lines: L.rtp / cost, trigger: ptrig, bonus: f / cost, total: (L.rtp + f) / cost });
  P(`| ${mode} | ${pct(L.rtp / cost)} | ${every(1 / ptrig)} | ${pct(f / cost)} | **${pct((L.rtp + f) / cost)}** |`);
}

P(); P('## Распределение выигрышей (доля раундов / вклад в RTP)'); P();
P('| Выигрыш, × ставки | ' + modes.join(' | ') + ' |'); P('|---|' + modes.map(() => '---|').join(''));
const nb = out.modes[modes[0]].dist.length;
for (let b = 0; b < nb; b++) {
  if (modes.every(m => out.modes[m].dist[b].share === 0)) continue;
  P(`| ${out.modes[modes[0]].dist[b].range} | ` + modes.map(m => { const x = out.modes[m].dist[b]; return x.share ? `${pct(x.share, x.share < 0.001 ? 4 : 2)} / ${pct(x.rtpShare)}` : '—'; }).join(' | ') + ' |');
}

const cur = path.join(dir, 'report.json'), prev = path.join(dir, 'report_prev.json');
const before = arg('compare') ? JSON.parse(fs.readFileSync(arg('compare'), 'utf8')) : (fs.existsSync(cur) ? JSON.parse(fs.readFileSync(cur, 'utf8')) : null);
if (before) {
  P(); P('## RTP до / после'); P();
  P('| Режим | До | После | Изменение | Бонус до | Бонус после | Hit до | Hit после |'); P('|---|---|---|---|---|---|---|---|');
  for (const m of modes) {
    const a = before.modes[m], b = out.modes[m]; if (!a) { P(`| ${m} | — | ${pct(b.rtp)} ± ${pct(b.ci95)} | — | — | ${every(b.bonusEvery)} | — | ${pct(b.hitRate, 1)} |`); continue; }
    P(`| ${m} | ${pct(a.rtp)} ± ${pct(a.ci95)} | ${pct(b.rtp)} ± ${pct(b.ci95)} | ${(b.rtp - a.rtp >= 0 ? '+' : '') + pct(b.rtp - a.rtp)} | ${a.bonusRate >= 0.999 ? 'каждый раунд' : every(a.bonusEvery)} | ${b.bonusRate >= 0.999 ? 'каждый раунд' : every(b.bonusEvery)} | ${pct(a.hitRate, 1)} | ${pct(b.hitRate, 1)} |`);
  }
}
if (save) {
  if (fs.existsSync(cur) && !arg('compare')) fs.copyFileSync(cur, prev);
  fs.writeFileSync(cur, JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n') + '\n');
}
