#!/usr/bin/env python3
"""Импорт графики «часть 2» (Senbazuru_Part2): PNG → webp под имена, которые ждёт index.html.

    python3 -I tools/import_part2.py "<папка Senbazuru_Part2>" [--force]

Берёт вырезанные PNG из transparent/ (фоны и обложки — из assets/), чистит зелёную кайму по краю,
кадрирует по общему bbox состояний, уменьшает в premultiplied-альфе (без тёмной/зелёной каймы) и пишет webp.
Уже существующие файлы пропускаются (повторный запуск продолжает), --force перезаписывает.
"""
import sys, os
from PIL import Image, ImageFilter
import numpy as np

SRC = sys.argv[1]
FORCE = '--force' in sys.argv
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
A = lambda *p: os.path.join(ROOT, 'assets', *p)

def load(name, opaque=False):
    p = os.path.join(SRC, 'assets' if opaque else 'transparent', name)
    im = Image.open(p)
    return im.convert('RGB') if opaque else despill(im.convert('RGBA'))

def despill(im):
    """Зелёный и пурпурный отсвет — только у края (в 3 px от прозрачного), внутри объекта цвета не трогаем."""
    a = np.array(im).astype(np.int16)
    al = a[..., 3]
    near = np.array(Image.fromarray((al < 250).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(7))) > 0
    near &= al > 0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    gs = near & (g > np.maximum(r, b)); a[..., 1][gs] = np.maximum(r, b)[gs]          # зелёный
    ms = near & (np.minimum(r, b) > g + 40); m = np.maximum(g, (r + b) // 2 - 40)
    a[..., 0][ms] = np.minimum(r, m + 40)[ms]; a[..., 2][ms] = np.minimum(b, m + 40)[ms]  # пурпурный
    a[..., 3][al < 12] = 0
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')

def resize(im, w, h=None):
    if h is None: h = round(im.height * w / im.width)
    if (w, h) == im.size: return im
    assert w <= im.width and h <= im.height, 'не увеличиваем'
    if im.mode == 'RGBA':
        return im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    return im.resize((w, h), Image.LANCZOS)

def save(im, path, q=88):
    if os.path.exists(path) and not FORCE: print('  есть', os.path.relpath(path, ROOT)); return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=q, method=4, exact=False)
    print(f'  {os.path.relpath(path, ROOT)}  {im.width}×{im.height}  {os.path.getsize(path) // 1024} КБ')

def bbox(*ims):
    bs = [im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox() for im in ims]
    return (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))

# рамки поля: окно (184,184)–(1864,1864) из 2048; уменьшаем целиком, геометрия в долях холста
for m in ('base', 'fs', 'super'):
    save(resize(load(f'frame_{m}.png'), 1280), A('ui', f'frame_{m}.webp'), 86)

# линии выплат: шнур — плитка 1024×128 (ось по центру), узел по bbox, кисточка 512×288 (крепление слева по центру)
save(resize(load('cord.png'), 1024, 128), A('lines', 'cord.webp'))
k = load('knot.png'); b = bbox(k); c = ((b[0] + b[2]) // 2, (b[1] + b[3]) // 2); s = max(b[2] - b[0], b[3] - b[1]) // 2 + 4
save(resize(k.crop((c[0] - s, c[1] - s, c[0] + s, c[1] + s)), 256, 256), A('lines', 'knot.webp'))
save(resize(load('tip.png'), 512, 192 * 3 // 2), A('lines', 'tip.webp'))

# таблички выигрышей 1024×384 (кадр как в ASSETS.plaques)
for n in ('nice', 'big', 'mega', 'epic', 'max', 'total'):
    save(resize(load(f'{n}.png'), 1024, 384), A('plaques', f'{n}.webp'))

# кнопки: все состояния в одном кадре (112..912) → normal и _down совпадают пиксель в пиксель
for n, w in (('spin', 384), ('round', 256), ('menu', 256), ('bonus', 256), ('ante_on', 256)):
    for st in ('', '_down'):
        save(resize(load(f'btn_{n}{st}.png').crop((112, 112, 912, 912)), w, w), A('ui', f'btn_{n}{st}.webp'))
save(resize(load('btn_close.png').crop((104, 104, 920, 920)), 192, 192), A('ui', 'btn_close.webp'))

# пиктограммы: лист 4×2 по 512 → 4×2 по 128 (порядок: spin turbo autoplay menu / bonus sound info settings)
save(resize(load('icons.png'), 512, 256), A('ui', 'icons.webp'), 92)

# таблички и панели — по bbox содержимого
for n, w in (('tag_value', 800), ('tag_win', 800), ('tag_fs', 640), ('hud_mult', 384), ('plank', 768),
             ('splash_plank', 600), ('toggle_on', 256), ('toggle_off', 256), ('logo', 1200),
             ('cloud_1', 640), ('cloud_2', 640), ('cloud_3', 640), ('sun', 512), ('sticky_cell', 256)):
    im = load(f'{n}.png'); b = bbox(im)
    if n == 'hud_mult': b = (112, 0, 912, 912)          # шнурок сверху входит в кадр
    if n.startswith('toggle'): b = bbox(load('toggle_on.png'), load('toggle_off.png'))
    save(resize(im.crop(b), w), A('ui', f'{n}.webp'))
for n in ('coin', 'coin_edge'):
    im = load(f'{n}.png'); save(resize(im.crop((60, 60, 452, 452)), 128, 128), A('ui', f'{n}.webp'))

# фоны режимов и заставки: полный + облегчённый (_s) для телефонов
for n in ('bg_fs', 'bg_super', 'splash_bg'):
    for o in ('land', 'port'):
        im = load(f'{n}_{o}.png', True)
        save(im, A('bg', f'{n}_{o}.webp'), 84)
        save(resize(im, im.width // 2), A('bg', f'{n}_{o}_s.webp'), 80)

# доска окон без шнурков (для 9-slice): тело начинается с синей кромки на y=120
p = Image.open(A('ui', 'plank.webp')).convert('RGBA')
save(p.crop((0, 120, p.width, p.height)), A('ui', 'plank_body.webp'))

# включённая круглая кнопка (турбо): btn_round, перекрашенная из индиго в золото — синие пиксели по оттенку
def gold(im):
    rgb = im.convert('RGB').convert('HSV'); h, s, v = [np.array(c).astype(np.int16) for c in rgb.split()]
    blue = (h > 135) & (h < 190) & (s > 60)
    h[blue] = 28; s[blue] = np.clip(s[blue] * 1.05, 0, 255); v[blue] = np.clip(v[blue] * 1.45 + 20, 0, 255)
    out = Image.merge('HSV', [Image.fromarray(c.astype(np.uint8)) for c in (h, s, v)]).convert('RGB')
    out.putalpha(im.getchannel('A')); return out
for st in ('', '_down'):
    src = Image.open(A('ui', f'btn_round{st}.webp')).convert('RGBA')
    save(gold(src), A('ui', f'btn_round_on{st}.webp'))

# обложки для лобби — в пакет подачи, не в сборку
import shutil
os.makedirs(os.path.join(ROOT, 'submission'), exist_ok=True)
for n in ('keyart_wide', 'keyart_square'):
    d = os.path.join(ROOT, 'submission', n + '.png')
    if FORCE or not os.path.exists(d): shutil.copyfile(os.path.join(SRC, 'assets', n + '.png'), d); print('  submission/' + n + '.png')
