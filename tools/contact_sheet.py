#!/usr/bin/env python3
"""Склеивает скриншоты одной стадии (shots/*_<stage>.png) в один лист для быстрого просмотра.
   python3 tools/contact_sheet.py 1_idle [shots] [out.png]"""
import sys, os, glob
from PIL import Image
stage = sys.argv[1]; d = sys.argv[2] if len(sys.argv) > 2 else 'shots'
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(d, '_sheet_%s.png' % stage)
order = ['1920x1080', '1280x720', '1024x768', '844x390', '600x900', '390x844', '375x667']
ims = [(n, Image.open(os.path.join(d, '%s_%s.png' % (n, stage)))) for n in order if os.path.exists(os.path.join(d, '%s_%s.png' % (n, stage)))]
land = [(n, i) for n, i in ims if i.width >= i.height]; port = [(n, i) for n, i in ims if i.width < i.height]
H1 = 430
def row(items, h):
    scaled = [i.resize((round(i.width * h / i.height), h), Image.LANCZOS) for _, i in items]
    w = sum(s.width for s in scaled) + 8 * (len(scaled) - 1)
    r = Image.new('RGB', (w, h), (30, 30, 30)); x = 0
    for s in scaled: r.paste(s, (x, 0)); x += s.width + 8
    return r
rows = [row(land[:2], H1), row(land[2:], H1)] if len(land) > 2 else [row(land, H1)]
if port: rows.append(row(port, 620))
W = max(r.width for r in rows); Ht = sum(r.height for r in rows) + 8 * (len(rows) - 1)
sheet = Image.new('RGB', (W, Ht), (30, 30, 30)); y = 0
for r in rows: sheet.paste(r, (0, y)); y += r.height + 8
sheet.save(out); print(out, sheet.size)
