#!/usr/bin/env python3
"""Независимая проверка выгрузки для Stake: все режимы, все книги.

    python3 tools/verify_books.py [папка выгрузки] [--json out.json]

Без движка math.js: выплаты пересчитываются по доскам из событий книги по правилам игры
(5 линий по рядам, старшая комбинация, вайлды на барабанах 2–4, «Фонари линий», «Сгиб», потолок).
По таблицам весов считает RTP = Σ(w·p/100)/Σw/цена, max win, hit rate, частоту бонуса и потолка, σ.
Нужен пакет zstandard.
"""
import sys, io, json, math, csv
import zstandard

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
D = ARGS[0] if ARGS else 'math/stake'
OUT = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
PAY = {'L1': (20, 60, 250), 'L2': (20, 60, 250), 'L3': (30, 100, 400), 'L4': (30, 100, 400),
       'H4': (60, 200, 800), 'H3': (100, 400, 1500), 'H2': (200, 800, 4000), 'H1': (500, 2500, 15000)}
CAP, ROWS, REELS, WILD_REELS = 1500000, 5, 5, {1, 2, 3}
LANTERN_ADDS, FOLD_MULT = {2, 3, 5, 10}, {2, 3}


def line_pay(cells, use_mult):
    """cells — 5 клеток ряда: (имя, множитель). Возвращает выплату в сотых долях без множителя фонаря."""
    s = next((c[0] for c in cells if c[0] != 'W'), None)
    best = 0
    if s and s != 'S':
        k, m = 0, 1
        while k < REELS and cells[k][0] in (s, 'W'):
            if cells[k][0] == 'W' and use_mult: m *= cells[k][1]
            k += 1
        if k >= 3: best = PAY[s][k - 3] * m
    lead, m2 = 0, 1
    while lead < REELS and cells[lead][0] == 'W':
        if use_mult: m2 *= cells[lead][1]
        lead += 1
    if lead >= 3: best = max(best, PAY['H1'][lead - 3] * m2)
    return best


def check_book(b, cost, problems):
    ev, total, feat, lan, board, fs = b['events'], 0, None, None, None, False
    capped = False
    for e in ev:
        t = e['type']
        if t == 'reveal':
            board = e['board']
            for r, col in enumerate(board):
                if sum(c['name'] == 'S' for c in col) > 1: problems.append((b['id'], 'два скаттера на барабане'))
                for c in col:
                    if c['name'] == 'W' and r not in WILD_REELS: problems.append((b['id'], 'вайлд вне барабанов 2–4'))
                    if c['name'] == 'W' and feat == 'lantern' and c.get('multiplier') not in LANTERN_ADDS: problems.append((b['id'], 'значение вайлда в фонарях'))
                    if c['name'] == 'W' and feat == 'fold' and c.get('multiplier') not in FOLD_MULT: problems.append((b['id'], 'множитель вайлда в сгибе'))
            if feat == 'lantern':   # прибавки к фонарям: из доски, событие lanternUpdate должно совпасть
                adds = [(r, row, c['multiplier']) for r, col in enumerate(board) for row, c in enumerate(col) if c['name'] == 'W']
                for (_, row, a) in adds: lan[row] += a
                b['_adds'] = adds
        elif t == 'freeSpinTrigger':
            fs, feat = True, e.get('feature')
            if feat == 'lantern':
                lan = [1] * ROWS
                if e.get('lanterns') != lan: problems.append((b['id'], 'фонари не с ×1'))
        elif t == 'lanternUpdate':
            if e['lanterns'] != lan or sorted((a['reel'], a['row'], a['add']) for a in e['adds']) != sorted(b.pop('_adds', [])):
                problems.append((b['id'], 'lanternUpdate не совпадает с доской'))
        elif t == 'fold':
            L = e['side'] == 'left'
            nb = [[dict(c) for c in col] for col in board]
            for k in range(2):
                src = k if L else REELS - 1 - k
                dst = REELS - 1 - src
                for row in range(ROWS):
                    c = dict(board[src][row])
                    if c['name'] == 'W': c['multiplier'] *= 2
                    nb[dst][row] = c
            if any(c['name'] == 'S' for col in nb for c in col): problems.append((b['id'], 'скаттер в сгибе'))
            if [[(c['name'], c.get('multiplier')) for c in col] for col in nb] != [[(c['name'], c.get('multiplier')) for c in col] for col in e['board']]:
                problems.append((b['id'], 'доска после сгиба не зеркальна'))
            board = e['board']
        elif t == 'retrigger' and feat == 'lantern':
            lan = [v * 2 for v in lan]
            if e.get('lanterns') != lan: problems.append((b['id'], 'ретриггер не удвоил фонари'))
        elif t == 'winInfo':
            want = 0
            for row in range(ROWS):
                cells = [(board[r][row]['name'], board[r][row].get('multiplier', 1)) for r in range(REELS)]
                p = line_pay(cells, feat != 'lantern')
                if feat == 'lantern': p *= lan[row]
                want += p
            got = sum(w['win'] for w in e['wins'])
            if got != want: problems.append((b['id'], f'линии: в книге {got}, пересчёт {want}'))
            if e['totalWin'] != min(want, CAP - total): problems.append((b['id'], 'totalWin не равен пересчёту с потолком'))
        elif t == 'setTotalWin':
            if e['amount'] < total: problems.append((b['id'], 'итог уменьшился'))
            total = e['amount']
        elif t == 'wincap':
            capped = True
    if total != b['payoutMultiplier']: problems.append((b['id'], f'итог {total} ≠ payoutMultiplier {b["payoutMultiplier"]}'))
    if ev[-1]['type'] != 'finalWin' or ev[-1]['amount'] != total: problems.append((b['id'], 'finalWin'))
    if total > CAP or total % 10: problems.append((b['id'], 'недопустимая выплата'))
    return fs, capped


index = json.load(open(f'{D}/index.json'))
report, all_problems = {}, []
for m in index['modes']:
    name, cost = m['name'], m['cost']
    lut = {}
    with open(f"{D}/{m['weights']}") as f:
        for i, w, p in csv.reader(f): lut[int(i)] = (int(w), int(p))
    W = sum(w for w, _ in lut.values())
    stats = dict(books=0, bonusW=0, capW=0, problems=0)
    probs = []
    with open(f"{D}/{m['events']}", 'rb') as f:
        for line in io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(f), encoding='utf-8'):
            if not line.strip(): continue
            b = json.loads(line); stats['books'] += 1
            w, p = lut[b['id']]
            if p != b['payoutMultiplier']: probs.append((b['id'], 'выплата в таблице ≠ книге'))
            fs, capped = check_book(b, cost, probs)
            if fs: stats['bonusW'] += w
            if capped: stats['capW'] += w
    ex = sum(w * p for w, p in lut.values()) / W / 100
    ex2 = sum(w * (p / 100) ** 2 for w, p in lut.values()) / W
    hit = sum(w for w, p in lut.values() if p > 0) / W
    profit = sum(w for w, p in lut.values() if p / 100 >= cost) / W
    r = dict(cost=cost, books=stats['books'], rtp=ex / cost, maxWin=max(p for _, p in lut.values()) / 100, hitRate=hit, profitRate=profit,
             bonusRate=stats['bonusW'] / W, capRate=stats['capW'] / W, sdPerCost=math.sqrt(max(0, ex2 - ex * ex)) / cost, problems=len(probs))
    report[name] = r
    all_problems += [(name,) + p for p in probs[:20]]
    print(f"{name:8} {cost:>6}× книг {r['books']:>7} RTP {r['rtp']*100:.4f}%  max {r['maxWin']:,.0f}×  hit {r['hitRate']*100:.2f}%  "
          f"бонус {('1 из %.1f' % (1 / r['bonusRate'])) if r['bonusRate'] else '—'}  потолок {('1 из %.0f' % (1 / r['capRate'])) if r['capRate'] else '—'}  σ/цена {r['sdPerCost']:.2f}  ошибок {len(probs)}")
if OUT: json.dump(report, open(OUT, 'w'), ensure_ascii=False, indent=1)
for p in all_problems: print('ПРОБЛЕМА', *p)
sys.exit(1 if all_problems else 0)
