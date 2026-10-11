#!/usr/bin/env node
/* Временная оригами-графика (плейсхолдеры), пока нет финального арта.
 * Рисует SVG в headless Chromium и сохраняет webp:
 *   assets/symbols/<id>.webp      – статичные символы 320×320
 *   assets/anim/<id>_win.webp     – ленты победной анимации (20 кадров × 256 px)
 *   assets/bg/bg_land.webp, bg_port.webp – фоны
 *   assets/ui/paper.webp          – бумажная текстура поля
 *   assets/lines/cord|knot|tip.webp – линии выплат: шнур, узел, наконечник
 * Запуск: node tools/gen_placeholder_art.mjs [--only symbols|anim|bg|ui|extra|lines|plaques] [--ids S,W]
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
function req(name) {
  try { return require(name); } catch { return require('/opt/npm-tools/node_modules/' + name); }
}
const { chromium } = req('playwright');
const sharp = req('sharp');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const onlyIds = process.argv.includes('--ids') ? process.argv[process.argv.indexOf('--ids') + 1].split(',') : null;

/* ---------- цвет ---------- */
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => rgb2hex(hex2rgb(a).map((v, i) => v + (hex2rgb(b)[i] - v) * t));
const shade = (base, s) => s >= 0 ? mix(base, '#fff6e6', 0.15 * s) : mix(base, '#1b1436', 0.14 * -s);

/* ---------- геометрия ---------- */
const C = [100, 100];
const pol = (r, deg, c = C) => [c[0] + r * Math.cos(deg * Math.PI / 180), c[1] + r * Math.sin(deg * Math.PI / 180)];
const mirror = pts => pts.map(([x, y]) => [200 - x, y]);

/* Грань: {p: точки, s: тон (-2..2), c: цвет}. Доп. элементы: {circle}, {line}, {text}. */
function symbols() {
  const S = {};

  // --- L1 кораблик (индиго)
  {
    const c = '#3a66c4';
    S.L1 = [
      { p: [[100, 38], [100, 118], [62, 118]], s: 2, c },
      { p: [[100, 38], [138, 118], [100, 118]], s: 0.6, c },
      { p: [[14, 100], [70, 118], [100, 118], [100, 156], [54, 156]], s: 0, c },
      { p: [[186, 100], [130, 118], [100, 118], [100, 156], [146, 156]], s: -1.4, c },
      { p: [[14, 100], [70, 118], [54, 156]], s: 0.9, c },
    ];
  }
  // --- L2 вертушка (зелёный)
  {
    const c = '#2fa57a';
    const f = [];
    for (let k = 0; k < 4; k++) {
      const a = -90 + 90 * k;
      f.push({ p: [C, pol(34, a + 96), pol(60, a + 50)], s: -1.6, c });
      f.push({ p: [C, pol(84, a), pol(60, a + 50)], s: k % 2 ? 1.2 : 0.2, c });
    }
    f.push({ circle: [100, 100, 8], fill: '#f1c453', stroke: '#b8862b' });
    S.L2 = f;
  }
  // --- L3 звезда (жёлтый)
  {
    const c = '#f0b93a';
    const f = [];
    for (let k = 0; k < 5; k++) {
      const a = -90 + 72 * k;
      f.push({ p: [[100, 104], pol(86, a, [100, 104]), pol(37, a + 36, [100, 104])], s: 1.4, c });
      f.push({ p: [[100, 104], pol(37, a + 36, [100, 104]), pol(86, a + 72, [100, 104])], s: -0.9, c });
    }
    S.L3 = f;
  }
  // --- L4 веер (розовый)
  {
    const c = '#ee7da4';
    const pv = [100, 166];
    const f = [];
    const n = 8, a0 = -151, a1 = -29;
    for (let k = 0; k < n; k++) {
      const b0 = a0 + (a1 - a0) * k / n, b1 = a0 + (a1 - a0) * (k + 1) / n;
      f.push({ p: [pol(36, b0, pv), pol(100, b0, pv), pol(100, b1, pv), pol(36, b1, pv)], s: k % 2 ? -0.8 : 1.1, c });
      f.push({ p: [pv, pol(36, b0, pv), pol(36, b1, pv)], s: k % 2 ? -1 : 0, c: '#8a5a3c' });
    }
    f.push({ circle: [100, 164, 6], fill: '#f1c453', stroke: '#b8862b' });
    S.L4 = f;
  }
  // --- H4 бабочка (фиолетовый)
  {
    const c = '#8458c9';
    const ul = [
      { p: [[100, 100], [24, 36], [34, 104]], s: 0, c },
      { p: [[100, 100], [24, 36], [80, 42]], s: 1.5, c },
      { p: [[100, 100], [34, 104], [48, 168], [90, 154]], s: -1, c },
      { p: [[46, 62], [58, 54], [64, 68], [52, 76]], s: 0.4, c: '#f1c453' },
    ];
    const f = [];
    for (const g of ul) f.push(g);
    for (const g of ul) f.push({ p: mirror(g.p), s: g.s - 0.9, c: g.c });
    f.push({ line: [[98, 72], [82, 44]], stroke: '#2d1d52', w: 3 });
    f.push({ line: [[102, 72], [118, 44]], stroke: '#2d1d52', w: 3 });
    f.push({ p: [[95, 70], [105, 70], [109, 140], [100, 160], [91, 140]], s: 0, c: '#2d1d52' });
    S.H4 = f;
  }
  // --- H3 карп кои (оранжевый с белым)
  {
    const o = '#f08a2b', w = '#f6efe2';
    S.H3 = [
      { p: [[152, 100], [188, 54], [176, 100]], s: 0.6, c: o },
      { p: [[152, 100], [176, 100], [188, 146]], s: -1.2, c: o },
      { p: [[98, 62], [126, 36], [132, 80]], s: -1, c: o },
      { p: [[58, 72], [106, 58], [154, 100], [60, 100]], s: 1, c: w },
      { p: [[60, 100], [154, 100], [106, 138], [62, 126]], s: -0.9, c: w },
      { p: [[86, 64], [106, 58], [134, 82], [102, 92]], s: 0.3, c: o },
      { p: [[112, 104], [140, 104], [120, 124]], s: -0.5, c: o },
      { p: [[16, 100], [58, 72], [60, 100]], s: 0.8, c: o },
      { p: [[16, 100], [60, 100], [62, 126]], s: -0.6, c: o },
      { p: [[82, 124], [98, 154], [112, 128]], s: 0, c: o },
      { circle: [44, 94, 4.5], fill: '#2b1a12' },
    ];
  }
  // --- H2 лиса (рыжий)
  {
    const o = '#ec7a22', w = '#f7f0e3', d = '#3a2318';
    S.H2 = [
      { p: [[34, 28], [86, 62], [44, 98]], s: -0.4, c: o },
      { p: [[166, 28], [114, 62], [156, 98]], s: -1.4, c: o },
      { p: [[44, 44], [72, 62], [50, 84]], s: 0, c: d },
      { p: [[156, 44], [128, 62], [150, 84]], s: -0.6, c: d },
      { p: [[44, 98], [86, 62], [100, 72], [100, 132]], s: 1.2, c: o },
      { p: [[156, 98], [114, 62], [100, 72], [100, 132]], s: 0, c: o },
      { p: [[22, 108], [44, 98], [100, 132], [100, 180]], s: 0.6, c: w },
      { p: [[178, 108], [156, 98], [100, 132], [100, 180]], s: -1, c: w },
      { p: [[60, 106], [84, 116], [66, 119]], s: 0, c: d },
      { p: [[140, 106], [116, 116], [134, 119]], s: 0, c: d },
      { p: [[89, 166], [111, 166], [100, 180]], s: 0, c: d },
    ];
  }
  // --- H1 журавль (алый)
  {
    const c = '#e0392f';
    S.H1 = [
      { p: [[98, 106], [150, 26], [132, 100]], s: -1.5, c },
      { p: [[126, 114], [186, 50], [144, 124]], s: -0.7, c },
      { p: [[64, 122], [32, 46], [45, 44], [88, 112]], s: 0.2, c },
      { p: [[32, 46], [10, 62], [42, 60]], s: 1.6, c },
      { p: [[64, 122], [102, 98], [144, 124]], s: 0.9, c },
      { p: [[64, 122], [144, 124], [102, 156]], s: -1, c },
      { p: [[84, 112], [70, 20], [126, 106]], s: 1.8, c },
      { p: [[84, 112], [126, 106], [104, 130]], s: 0.3, c },
    ];
  }
  // --- W вайлд: золотой лотос на индиго-медальоне
  {
    const g = '#e9b63c', n = '#253a7d', r = '#d8402f';
    const f = [];
    for (let k = 0; k < 8; k++) {
      const a = -112.5 + 45 * k;
      f.push({ p: [[100, 96], pol(88, a, [100, 96]), pol(88, a + 45, [100, 96])], s: [0.8, 0.2, -0.4, -1, -0.5, 0, 0.5, 1.1][k], c: n });
    }
    const petL = [
      { p: [[62, 104], [26, 84], [56, 124], [100, 116]], s: -0.6, c: g },
      { p: [[82, 92], [48, 50], [62, 104], [100, 116]], s: 0.6, c: g },
    ];
    for (const q of petL) f.push(q);
    for (const q of petL) f.push({ p: mirror(q.p), s: q.s - 0.8, c: g });
    f.push({ p: [[100, 28], [82, 92], [100, 116]], s: 1.8, c: g });
    f.push({ p: [[100, 28], [118, 92], [100, 116]], s: 0.4, c: g });
    f.push({ p: [[30, 122], [170, 122], [182, 142], [170, 162], [30, 162], [18, 142]], s: 0, c: r });
    f.push({ p: [[30, 122], [170, 122], [176, 132], [24, 132]], s: 1, c: r });
    f.push({ text: 'WILD', x: 100, y: 155, size: 30, fill: '#fff6e0' });
    S.W = f;
  }
  // --- S скаттер: бумажный фонарь на бирюзовой розетке
  {
    const cy = '#1fa6c2', cr = '#f6efe2', ink = '#1d2540', red = '#d8402f';
    const f = [], c0 = [100, 100];
    for (let k = 0; k < 12; k++) {
      const a = -90 + 30 * k;
      f.push({ p: [c0, pol(92, a, c0), pol(66, a + 15, c0)], s: 0.9, c: cy });
      f.push({ p: [c0, pol(66, a + 15, c0), pol(92, a + 30, c0)], s: -0.7, c: cy });
    }
    const xs = [64, 79, 93, 107, 121, 136], sh = [1.3, 0.5, 1.0, 0.0, -0.9];
    const dy = x => 11 * Math.pow(Math.abs(x - 100) / 36, 2);
    for (let i = 0; i < 5; i++) f.push({ p: [[xs[i], 62 + dy(xs[i])], [xs[i + 1], 62 + dy(xs[i + 1])], [xs[i + 1], 144 - dy(xs[i + 1])], [xs[i], 144 - dy(xs[i])]], s: sh[i], c: cr });
    f.push({ circle: [100, 103, 18], fill: red });
    f.push({ p: [[84, 96], [100, 85], [116, 96], [100, 103]], s: 1.2, c: red });
    f.push({ line: [[86, 54], [100, 38]], stroke: ink, w: 3 });
    f.push({ line: [[114, 54], [100, 38]], stroke: ink, w: 3 });
    f.push({ p: [[76, 52], [124, 52], [128, 66], [72, 66]], s: 0.4, c: ink });
    f.push({ p: [[72, 140], [128, 140], [124, 154], [76, 154]], s: -0.3, c: ink });
    f.push({ p: [[95, 154], [105, 154], [103, 178], [97, 178]], s: 0, c: red });
    S.S = f;
  }
  return S;
}

let gid = 0;
function facetSvg(f) {
  if (f.circle) return `<circle cx="${f.circle[0]}" cy="${f.circle[1]}" r="${f.circle[2]}" fill="${f.fill}" ${f.stroke ? `stroke="${f.stroke}" stroke-width="1.5"` : ''}/>`;
  if (f.line) return `<line x1="${f.line[0][0]}" y1="${f.line[0][1]}" x2="${f.line[1][0]}" y2="${f.line[1][1]}" stroke="${f.stroke}" stroke-width="${f.w}" stroke-linecap="round"/>`;
  if (f.text) return `<text x="${f.x}" y="${f.y}" font-family="Dela" font-size="${f.size}" text-anchor="middle" fill="${f.fill}" letter-spacing="2">${f.text}</text>`;
  const col = shade(f.c, f.s), col2 = shade(f.c, f.s - 0.7);
  const xs = f.p.map(p => p[0]), ys = f.p.map(p => p[1]);
  const id = 'g' + (gid++);
  const pts = f.p.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${Math.min(...xs)}" y1="${Math.min(...ys)}" x2="${Math.max(...xs)}" y2="${Math.max(...ys)}"><stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="${col2}"/></linearGradient>` +
    `<polygon points="${pts}" fill="url(#${id})" stroke="${mix(col, '#ffffff', 0.38)}" stroke-width="1.1" stroke-linejoin="round"/>`;
}
function maskSvg(f) {
  if (f.circle) return `<circle cx="${f.circle[0]}" cy="${f.circle[1]}" r="${f.circle[2]}" fill="#fff"/>`;
  if (!f.p) return '';
  return `<polygon points="${f.p.map(p => p.join(',')).join(' ')}" fill="#fff"/>`;
}

function symbolSvg(id, facets, size) {
  const body = facets.map(facetSvg).join('');
  const mask = facets.map(maskSvg).join('');
  return `<svg id="sym_${id}" class="sym" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 200 200">
  <defs>
    <filter id="paper_${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.06  0 0 0 0 0.16  0 0 0 -0.6 0.36" result="g"/>
      <feComposite in="g" in2="SourceAlpha" operator="in" result="grain"/>
      <feMerge result="m"><feMergeNode in="SourceGraphic"/><feMergeNode in="grain"/></feMerge>
      <feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#1a1238" flood-opacity="0.34"/>
    </filter>
    <mask id="mask_${id}">${mask}</mask>
    <linearGradient id="shine_${id}" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g class="rig" style="transform-origin:100px 104px">
    <g filter="url(#paper_${id})">${body}</g>
    <g mask="url(#mask_${id})"><rect class="shine" x="-90" y="-40" width="56" height="280" fill="url(#shine_${id})" transform="skewX(-20)" opacity="0"/></g>
  </g>
</svg>`;
}

function fontCss() {
  // шрифт берём из index.html (он встроен туда в base64)
  const m = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/font-family:"Dela Gothic One"[^}]*?base64,([A-Za-z0-9+/=]+)/);
  return m ? `@font-face{font-family:Dela;src:url(data:font/woff2;base64,${m[1]}) format('woff2')}` : '';
}

/* ---------- фон ---------- */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function bgSvg(W, H) {
  const r = rng(W * 7 + H);
  const horizon = H * 0.62;
  let layers = '';
  const tints = ['#3c5aa6', '#2f4a92', '#263d7d', '#1d2f66', '#15234f'];
  tints.forEach((col, li) => {
    const base = horizon + li * H * 0.075;
    const amp = H * (0.2 - li * 0.028);
    const n = Math.max(5, Math.round(W / (H * 0.2))) + li;
    const pts = [];
    for (let i = 0; i <= n * 2; i++) {
      const x = (i / (n * 2)) * (W + 200) - 100;
      const peak = i % 2 === 1;
      pts.push([x, base - (peak ? amp * (0.45 + r() * 0.55) : amp * r() * 0.22)]);
    }
    let facets = '';
    for (let i = 1; i < pts.length - 1; i += 2) {
      const [a, p, b] = [pts[i - 1], pts[i], pts[i + 1]];
      const foot = [p[0] + (r() - 0.5) * 30, H + 20];
      facets += `<polygon points="${a} ${p} ${foot} ${a[0]},${H + 20}" fill="${mix(col, '#ffffff', 0.10)}"/>`;
      facets += `<polygon points="${p} ${b} ${b[0]},${H + 20} ${foot}" fill="${mix(col, '#0b1030', 0.16)}"/>`;
      if (li < 2) facets += `<polygon points="${p} ${p[0] - (p[0] - a[0]) * 0.28},${p[1] + (a[1] - p[1]) * 0.28} ${p[0] + 8},${p[1] + (a[1] - p[1]) * 0.36} ${p[0] + (b[0] - p[0]) * 0.26},${p[1] + (b[1] - p[1]) * 0.26}" fill="#f4efe2" opacity="0.9"/>`;
    }
    layers += `<g filter="url(#lsh)">${facets}</g>`;
  });
  // летящие журавлики
  const crane = symbols().H1;
  let birds = '';
  const spots = W > H ? [[0.09, 0.2, 0.5, -8], [0.2, 0.34, 0.32, 6], [0.9, 0.16, 0.42, 10], [0.8, 0.36, 0.26, -6]]
    : [[0.16, 0.1, 0.5, -8], [0.84, 0.07, 0.38, 10], [0.5, 0.045, 0.26, 4]];
  for (const [fx, fy, sc, rot] of spots) {
    const k = sc * Math.min(W, H) / 420;
    const body = crane.map(f => f.p ? `<polygon points="${f.p.map(p => p.join(',')).join(' ')}" fill="${shade('#f3ecdc', f.s * 0.7 - 0.4)}"/>` : '').join('');
    birds += `<g transform="translate(${W * fx},${H * fy}) rotate(${rot}) scale(${k}) translate(-100,-100)" filter="url(#lsh)">${body}</g>`;
  }
  const sunR = Math.min(W, H) * 0.23;
  const sunX = W > H ? W * 0.5 : W * 0.5, sunY = W > H ? H * 0.4 : H * 0.3;
  let rays = '';
  for (let k = 0; k < 24; k++) {
    const a0 = k * 15, a1 = a0 + 7.5, R = Math.max(W, H) * 1.2;
    const p = d => [sunX + R * Math.cos(d * Math.PI / 180), sunY + R * Math.sin(d * Math.PI / 180)];
    rays += `<polygon points="${sunX},${sunY} ${p(a0)} ${p(a1)}" fill="#ffffff" opacity="0.035"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16214f"/><stop offset="0.45" stop-color="#2c478f"/><stop offset="0.72" stop-color="#5f7fbd"/><stop offset="1" stop-color="#1a2a5c"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffd9a0" stop-opacity="0.55"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>
    <filter id="lsh" x="-10%" y="-30%" width="120%" height="160%"><feDropShadow dx="0" dy="-6" stdDeviation="9" flood-color="#070b24" flood-opacity="0.45"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -0.5 0.3"/>
    </filter>
    <radialGradient id="vig" cx="50%" cy="46%" r="75%"><stop offset="0.55" stop-color="#050818" stop-opacity="0"/><stop offset="1" stop-color="#050818" stop-opacity="0.6"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${rays}
  <circle cx="${sunX}" cy="${sunY}" r="${sunR * 2.1}" fill="url(#glow)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="#e8523a"/>
  <path d="M ${sunX - sunR} ${sunY} A ${sunR} ${sunR} 0 0 1 ${sunX + sunR} ${sunY} Z" fill="#f0654a"/>
  <polygon points="${sunX - sunR * 0.9},${sunY - sunR * 0.44} ${sunX + sunR * 0.2},${sunY - sunR * 0.98} ${sunX + sunR},${sunY}" fill="#f47a5c" opacity="0.5"/>
  ${birds}
  ${layers}
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.5"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`;
}

function paperSvg(S) {
  let fibers = '';
  const r = rng(99);
  for (let i = 0; i < 160; i++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI, l = 8 + r() * 26;
    fibers += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(a) * l).toFixed(1)}" y2="${(y + Math.sin(a) * l).toFixed(1)}" stroke="${r() > 0.5 ? '#c9b993' : '#fffaf0'}" stroke-width="${(0.5 + r()).toFixed(2)}" opacity="${(0.25 + r() * 0.35).toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs><filter id="g" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="5" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.36  0 0 0 0 0.2  0 0 0 -0.6 0.42"/>
  </filter></defs>
  <rect width="${S}" height="${S}" fill="#f1ead8"/>
  ${fibers}
  <rect width="${S}" height="${S}" filter="url(#g)"/>
</svg>`;
}

/* ---------- линии выплат (тема — бумажный шнур мидзухики) ----------
 * cord.webp 512×80  — плитка шнура, бесшовная по горизонтали, ось шнура — середина по высоте;
 * knot.webp 256×256 — узел аваджи-мусуби, центр узла — центр картинки (концы и изгибы линии);
 * tip.webp  256×144 — наконечник, смотрит вправо, крепится к линии в точке (0, середина высоты). */
function linesArt() {
  const RED = '#d8402f', GOLD = '#e9b63c', CREAM = '#f6efe0', INK = '#3a1410';
  // плитка шнура: три скрученные пряди, диагональные полосы с периодом 32 px (512 / 32 — целое, шов не виден)
  let stripes = '';
  const cols = [RED, GOLD, RED, CREAM];
  for (let i = -4; i < 20; i++) {
    const x = i * 32;
    stripes += `<polygon points="${x},14 ${x + 32},14 ${x + 56},66 ${x + 24},66" fill="${cols[((i % 4) + 4) % 4]}"/>`;
  }
  const cord = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="80" viewBox="0 0 512 80">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
      <clipPath id="c"><rect x="0" y="14" width="512" height="52"/></clipPath></defs>
    <rect x="0" y="11" width="512" height="58" fill="${INK}" opacity=".85"/>
    <g clip-path="url(#c)">${stripes}
      ${Array.from({ length: 17 }, (_, i) => `<line x1="${i * 32 - 4}" y1="14" x2="${i * 32 + 20}" y2="66" stroke="${INK}" stroke-opacity=".35" stroke-width="2"/>`).join('')}
      <rect x="0" y="14" width="512" height="52" fill="url(#g)"/>
      <line x1="0" y1="31" x2="512" y2="31" stroke="${INK}" stroke-opacity=".18" stroke-width="1.5"/>
      <line x1="0" y1="49" x2="512" y2="49" stroke="${INK}" stroke-opacity=".18" stroke-width="1.5"/></g></svg>`;

  // узел: три петли из двухцветного шнура и бумажная бусина в центре
  const loop = (cx, cy, rx, ry, rot) => {
    const e = `cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="none"`;
    return `<ellipse ${e} stroke="${INK}" stroke-width="30" stroke-opacity=".9"/><ellipse ${e} stroke="${RED}" stroke-width="22"/>` +
      `<ellipse ${e} stroke="${GOLD}" stroke-width="7" stroke-dasharray="14 10"/><ellipse ${e} stroke="#fff" stroke-opacity=".3" stroke-width="4" transform="rotate(${rot} ${cx} ${cy}) translate(0 -5)"/>`;
  };
  const knot = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#0b0f2a" flood-opacity=".45"/></filter></defs>
    <g filter="url(#s)">${loop(86, 146, 50, 32, -35)}${loop(170, 146, 50, 32, 35)}${loop(128, 86, 30, 48, 0)}
      <polygon points="128,98 158,128 128,158 98,128" fill="${GOLD}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
      <polygon points="128,98 158,128 128,128" fill="#fff" fill-opacity=".35"/><polygon points="98,128 128,158 128,128" fill="#000" fill-opacity=".18"/>
      <circle cx="128" cy="128" r="9" fill="${RED}" stroke="${INK}" stroke-width="3"/></g></svg>`;

  // наконечник: сложенная бумажная обёртка (носи) и кисточка из прядей
  let tassel = '';
  for (let i = 0; i < 9; i++) {
    const y = 72 + (i - 4) * 9, c = i % 3 === 1 ? GOLD : i % 3 === 2 ? CREAM : RED;
    tassel += `<path d="M150,72 C185,72 200,${y} 246,${y + (i - 4) * 2}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M150,72 C185,72 200,${y} 246,${y + (i - 4) * 2}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
  }
  const tip = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="144" viewBox="0 0 256 144">
    <defs><filter id="s" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#0b0f2a" flood-opacity=".45"/></filter></defs>
    <g filter="url(#s)">${tassel}
      <polygon points="40,72 96,26 160,48 160,96 96,118" fill="${RED}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <polygon points="40,72 96,26 160,48 110,72" fill="#fff" fill-opacity=".22"/>
      <polygon points="40,72 110,72 160,96 96,118" fill="#000" fill-opacity=".16"/>
      <polygon points="88,72 118,50 150,60 150,84 118,94" fill="${CREAM}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <polygon points="104,72 122,60 140,66 140,78 122,84" fill="${GOLD}"/>
      <rect x="0" y="60" width="46" height="24" rx="6" fill="${GOLD}" stroke="${INK}" stroke-width="4"/>
      <line x1="16" y1="62" x2="16" y2="82" stroke="${INK}" stroke-width="3"/><line x1="30" y1="62" x2="30" y2="82" stroke="${INK}" stroke-width="3"/></g></svg>`;
  return [['cord', 512, 80, cord], ['knot', 256, 256, knot], ['tip', 256, 144, tip]];
}

/* ---------- рендер ---------- */
const ANIM_FRAMES = 20, ANIM_SIZE = 256, STATIC_SIZE = 320;

async function main() {
  const browser = await chromium.launch();
  const S = symbols();
  const ids = Object.keys(S).filter(id => !onlyIds || onlyIds.includes(id));

  if (!only || only === 'symbols' || only === 'anim') {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    for (const size of [STATIC_SIZE, ANIM_SIZE]) {
      if (size === STATIC_SIZE && only === 'anim') continue;
      if (size === ANIM_SIZE && only === 'symbols') continue;
      gid = 0;
      await page.setContent(`<style>${fontCss()} body{margin:0;background:transparent} .sym{display:block;float:left}</style>` +
        ids.map(id => symbolSvg(id, S[id], size)).join(''));
      await page.evaluate(() => document.fonts.ready);
      for (const id of ids) {
        const el = page.locator('#sym_' + id);
        if (size === STATIC_SIZE) {
          const png = await el.screenshot({ omitBackground: true });
          await sharp(png).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(path.join(OUT, 'symbols', id + '.webp'));
        } else {
          const frames = [];
          for (let i = 0; i < ANIM_FRAMES; i++) {
            const t = i / ANIM_FRAMES;
            await page.evaluate(([id, t]) => {
              const svg = document.getElementById('sym_' + id);
              const sc = 1 + 0.1 * Math.sin(Math.PI * t) * (1 + 0.35 * Math.sin(6 * Math.PI * t));
              const rot = 6 * Math.sin(2 * Math.PI * t);
              const sk = 4 * Math.sin(4 * Math.PI * t);
              svg.querySelector('.rig').style.transform = `rotate(${rot}deg) skewX(${sk}deg) scale(${sc})`;
              const sh = svg.querySelector('.shine');
              const u = (t - 0.15) / 0.6;
              sh.setAttribute('opacity', u > 0 && u < 1 ? '1' : '0');
              sh.setAttribute('transform', `translate(${u * 330}) skewX(-20)`);
            }, [id, t]);
            frames.push(await el.screenshot({ omitBackground: true }));
          }
          await sharp({ create: { width: ANIM_SIZE * ANIM_FRAMES, height: ANIM_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite(frames.map((input, i) => ({ input, left: i * ANIM_SIZE, top: 0 })))
            .webp({ quality: 86, alphaQuality: 95, effort: 6 })
            .toFile(path.join(OUT, 'anim', id + '_win.webp'));
        }
        process.stdout.write(id + (size === STATIC_SIZE ? ' ' : '* '));
      }
    }
    await page.close();
  }

  if (!only || only === 'bg') {
    for (const [name, W, H] of [['bg_land', 1920, 1080], ['bg_port', 1080, 1920]]) {
      const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await page.setContent(`<style>body{margin:0}svg{display:block}</style>` + bgSvg(W, H));
      const png = await page.screenshot();
      await sharp(png).webp({ quality: 84, effort: 6 }).toFile(path.join(OUT, 'bg', name + '.webp'));
      await page.close();
      process.stdout.write(name + ' ');
    }
  }

  if (!only || only === 'ui') {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
    await page.setContent(`<style>body{margin:0}svg{display:block}</style>` + paperSvg(512));
    await sharp(await page.screenshot()).webp({ quality: 88, effort: 6 }).toFile(path.join(OUT, 'ui', 'paper.webp'));
    await page.close();
    process.stdout.write('paper ');
  }
  /* ---------- бейджи бонусных режимов, гирлянды для десктопа, облегчённые фоны для телефонов ---------- */
  if (!only || only === 'extra') {
    const tf = (facets, cx, cy, k, rot = 0) => facets.map(f => {
      const r = rot * Math.PI / 180, P = ([x, y]) => { const dx = (x - 100) * k, dy = (y - 100) * k; return [cx + dx * Math.cos(r) - dy * Math.sin(r), cy + dx * Math.sin(r) + dy * Math.cos(r)]; };
      const o = Object.assign({}, f);
      if (f.p) o.p = f.p.map(P);
      if (f.circle) { const [x, y] = P(f.circle); o.circle = [x, y, f.circle[2] * k]; }
      if (f.line) { o.line = f.line.map(P); o.w = f.w * k; }
      if (f.text) { const [x, y] = P([f.x, f.y]); o.x = x; o.y = y; o.size = f.size * k; }
      return o;
    });
    const gold = '#e9b63c';
    const chevron = (x, y, w) => ({ p: [[x - w, y + w * 0.7], [x, y - w * 0.5], [x + w, y + w * 0.7], [x + w * 0.55, y + w * 0.7], [x, y + w * 0.1], [x - w * 0.55, y + w * 0.7]], s: 0.6, c: gold });
    const star = (x, y, r) => { const f = []; for (let i = 0; i < 5; i++) { const a = -90 + 72 * i; f.push({ p: [[x, y], pol(r, a, [x, y]), pol(r * 0.42, a + 36, [x, y])], s: 1.3, c: gold }); f.push({ p: [[x, y], pol(r * 0.42, a + 36, [x, y]), pol(r, a + 72, [x, y])], s: -0.8, c: gold }); } return f; };
    const badges = {
      mode_ante: tf(S.S, 84, 104, 0.86).concat([chevron(162, 62, 22), chevron(162, 102, 22), chevron(162, 142, 22)]),
      mode_bonus: tf(S.S, 58, 136, 0.5, -8).concat(tf(S.S, 142, 136, 0.5, 8), tf(S.S, 100, 66, 0.62)),
      mode_super: tf(S.W, 100, 108, 0.8).concat(star(40, 44, 22), star(100, 24, 22), star(160, 44, 22))
    };
    const page = await browser.newPage({ viewport: { width: 800, height: 300 }, deviceScaleFactor: 1 });
    gid = 0;
    await page.setContent(`<style>${fontCss()} body{margin:0;background:transparent} .sym{display:block;float:left}</style>` + Object.keys(badges).map(id => symbolSvg(id, badges[id], 256)).join(''));
    await page.evaluate(() => document.fonts.ready);
    for (const id of Object.keys(badges)) {
      await sharp(await page.locator('#sym_' + id).screenshot({ omitBackground: true })).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(path.join(OUT, 'ui', id + '.webp'));
      process.stdout.write(id + ' ');
    }
    await page.close();

    // гирлянды журавликов (сэнбадзуру) по краям экрана — только для больших экранов
    const palette = ['#e0392f', '#f0b93a', '#2fa57a', '#3a66c4', '#ee7da4', '#8458c9', '#f3ecdc', '#f08a2b'];
    const garland = (seed, flip) => {
      const r = rng(seed); let g = '';
      for (let k = 0; k < 3; k++) {
        const x = 62 + k * 118 + (r() - 0.5) * 24, n = 3 + (k % 2), y0 = 200 + r() * 90, len = y0 + n * 205 + 30;
        g += `<line x1="${x}" y1="0" x2="${x}" y2="${Math.min(1075, len)}" stroke="#f1ead8" stroke-width="2" opacity="0.55"/>`;
        for (let i = 0; i < n; i++) {
          const y = y0 + i * 205 + (r() - 0.5) * 30, sc = 0.52 + r() * 0.2, rot = (r() - 0.5) * 26, col = palette[(r() * palette.length) | 0];
          const body = S.H1.map(f => f.p ? `<polygon points="${f.p.map(p => p.join(',')).join(' ')}" fill="${shade(col, f.s)}" stroke="${shade(col, f.s + 1.6)}" stroke-width="1" stroke-linejoin="round"/>` : '').join('');
          g += `<g transform="translate(${x},${y}) rotate(${rot}) scale(${sc}) translate(-100,-40)" filter="url(#sh)">${body}</g>`;
        }
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="1080" viewBox="0 0 360 1080"><defs><filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#070b24" flood-opacity="0.45"/></filter></defs><g ${flip ? 'transform="translate(360,0) scale(-1,1)"' : ''}>${g}</g></svg>`;
    };
    for (const [name, seed, flip] of [['decor_left', 21, false], ['decor_right', 58, true]]) {
      const pg = await browser.newPage({ viewport: { width: 360, height: 1080 }, deviceScaleFactor: 1 });
      await pg.setContent(`<style>body{margin:0;background:transparent}svg{display:block}</style>` + garland(seed, flip));
      await sharp(await pg.screenshot({ omitBackground: true })).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(path.join(OUT, 'bg', name + '.webp'));
      await pg.close(); process.stdout.write(name + ' ');
    }
    // фоны половинного размера для телефонов
    for (const [src, w, h] of [['bg_land', 960, 540], ['bg_port', 540, 960]]) {
      await sharp(path.join(OUT, 'bg', src + '.webp')).resize(w, h).webp({ quality: 78, effort: 6 }).toFile(path.join(OUT, 'bg', src + '_s.webp'));
      process.stdout.write(src + '_s ');
    }
  }
  /* ---------- линии выплат: шнур мидзухики, узел аваджи, наконечник ---------- */
  if (!only || only === 'lines') {
    fs.mkdirSync(path.join(OUT, 'lines'), { recursive: true });
    for (const [name, w, h, svg] of linesArt()) {
      const pg = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await pg.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>` + svg);
      await sharp(await pg.screenshot({ omitBackground: true })).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(path.join(OUT, 'lines', name + '.webp'));
      await pg.close(); process.stdout.write(name + ' ');
    }
  }
  /* ---------- таблички выигрышей (временные, по одному кадру; спрайт-листы заказчика кладутся под теми же именами) ---------- */
  if (!only || only === 'plaques') {
    fs.mkdirSync(path.join(OUT, 'plaques'), { recursive: true });
    const P = { nice: ['NICE WIN', '#2fa57a', '#f1ead8'], big: ['BIG WIN', '#3a66c4', '#f7e7b4'], mega: ['MEGA WIN', '#8458c9', '#f7e7b4'],
      epic: ['EPIC WIN', '#d8402f', '#ffe9a8'], max: ['MAX WIN', '#e9b63c', '#17224d'], total: ['TOTAL WIN', '#17224d', '#f7e7b4'] };
    for (const [name, [text, col, ink]] of Object.entries(P)) {
      const W = 1024, H = 384, k = 60, svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <defs><filter id="s" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="12" flood-color="#070b24" flood-opacity=".55"/></filter></defs>
        <g filter="url(#s)"><polygon points="${k},40 ${W - k},40 ${W - 20},${H / 2} ${W - k},${H - 40} ${k},${H - 40} 20,${H / 2}" fill="${col}" stroke="${shade(col, 2)}" stroke-width="8" stroke-linejoin="round"/>
        <polygon points="${k},40 ${W - k},40 ${W - 20},${H / 2} ${k + 40},${H / 2}" fill="#fff" fill-opacity=".14"/>
        <polygon points="${k},40 ${k + 90},40 ${k + 20},110" fill="${shade(col, -2)}"/><polygon points="${W - k},${H - 40} ${W - k - 90},${H - 40} ${W - k - 20},${H - 110}" fill="${shade(col, -2)}"/>
        <text x="${W / 2}" y="${H / 2 + 52}" text-anchor="middle" font-family="Dela" font-size="${Math.min(150, Math.floor(1180 / text.length))}" fill="${ink}" stroke="${shade(col, -2)}" stroke-width="10" paint-order="stroke" letter-spacing="4">${text}</text></g></svg>`;
      const pg = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await pg.setContent(`<style>${fontCss()} html,body{margin:0;background:transparent}svg{display:block}</style>` + svg);
      await pg.evaluate(() => document.fonts.ready);
      await sharp(await pg.screenshot({ omitBackground: true })).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(path.join(OUT, 'plaques', name + '.webp'));
      await pg.close(); process.stdout.write(name + ' ');
    }
  }
  await browser.close();
  console.log('\nok');
}
main().catch(e => { console.error(e); process.exit(1); });
