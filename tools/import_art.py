#!/usr/bin/env python3
"""Импорт присланной графики (PNG на зелёном #00FF00) в assets/.

  python3 tools/import_art.py <папка с png> [--only symbols,anim,bg,decor,badges,paper]

Символы и бейджи: хромакей, обрезка по содержимому, вписывание в квадрат (символ занимает FILL стороны).
Ленты победной анимации: 20 кадров из статичного символа — пульс масштаба, лёгкий наклон и блик.
Фоны: webp для десктопа и половинные для телефонов. Гирлянды: хромакей и 360×1080. Бумага: 512 px.
Ключ хромакея — chroma_strip.chroma_key: белое с лёгким зелёным оттенком остаётся непрозрачным.
"""
import argparse
import math
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chroma_strip import chroma_key  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
SYMBOLS = ["L1", "L2", "L3", "L4", "H4", "H3", "H2", "H1", "W", "S"]
BADGES = ["mode_ante", "mode_bonus", "mode_super"]
STATIC, ANIM, FRAMES, FILL = 320, 256, 20, 0.9


def keyed(path):
    return chroma_key(Image.open(path))


def trimmed(img, thr=8):
    box = img.getchannel("A").point(lambda v: 255 if v > thr else 0).getbbox()
    return img.crop(box)


def fit(img, size, fill=FILL):
    w, h = img.size
    s = size * fill / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    r = img.resize((nw, nh), Image.LANCZOS)
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    c.paste(r, ((size - nw) // 2, (size - nh) // 2))
    return c


def save_webp(img, rel, q=90):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", quality=q, alpha_quality=100, method=6)
    print("  %-28s %dx%d  %d КБ" % (rel, img.width, img.height, os.path.getsize(path) // 1024))


def ribbon_box(img):
    """Красная лента на символе W: полоса строк, где в центральной трети почти всё красное. -> (y0, y1) в долях высоты."""
    a = np.asarray(img.convert("RGBA"), dtype=int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    red = (r > 160) & (g < 120) & (b < 120) & (al > 200)
    w = img.width
    rows = red[:, w // 3: 2 * w // 3].mean(axis=1)
    ys = [y for y in range(img.height) if rows[y] > 0.8]
    if not ys:
        sys.exit("На символе W не нашлась красная лента для надписи")
    return ys[0] / img.height, ys[-1] / img.height


def wild_label(sym):
    """Впечатать WILD в ленту символа (надпись рендерит tools/wild_label.mjs шрифтом игры)."""
    lab = os.path.join(ROOT, "tools", "wild_label.png")
    if not os.path.exists(lab):
        os.system("node %s" % os.path.join(ROOT, "tools", "wild_label.mjs"))
    label = Image.open(lab).convert("RGBA")
    label = label.crop(label.getchannel("A").getbbox())
    y0, y1 = ribbon_box(sym)
    h = (y1 - y0) * sym.height * 0.78
    k = h / label.height
    label = label.resize((round(label.width * k), round(h)), Image.LANCZOS)
    out = sym.copy()
    out.alpha_composite(label, ((sym.width - label.width) // 2, round((y0 + y1) / 2 * sym.height - h / 2)))
    return out


def win_frames(sym):
    """Победная анимация из статичного символа: пульс, наклон, пробегающий блик. Кадры ANIM×ANIM."""
    base = fit(sym, ANIM, FILL * 0.9)   # запас, чтобы увеличенный кадр не вылез за край
    out = []
    for i in range(FRAMES):
        t = i / FRAMES
        sc = 1 + 0.1 * math.sin(math.pi * t) ** 2 * (1 if t < 0.5 else 0.7) + 0.03 * math.sin(2 * math.pi * t)
        rot = 4.5 * math.sin(2 * math.pi * t)
        f = base.resize((round(ANIM * sc), round(ANIM * sc)), Image.LANCZOS).rotate(rot, Image.BICUBIC, expand=False)
        c = Image.new("RGBA", (ANIM, ANIM), (0, 0, 0, 0))
        c.paste(f, ((ANIM - f.width) // 2, (ANIM - f.height) // 2), f)
        # блик: диагональная полоса, идёт слева направо в первой половине цикла
        a = np.asarray(c, dtype=np.float32)
        yy, xx = np.mgrid[0:ANIM, 0:ANIM]
        pos = (xx + yy) / (2 * ANIM)                      # 0..1 по диагонали
        centre = -0.25 + 1.5 * min(1.0, t * 1.6)
        band = np.exp(-((pos - centre) / 0.07) ** 2) * (0.55 if t < 0.65 else 0.0)
        rgb = a[..., :3] + (255 - a[..., :3]) * band[..., None] * 0.9
        a[..., :3] = np.clip(rgb, 0, 255)
        out.append(Image.fromarray(a.round().astype(np.uint8), "RGBA"))
    return out


def strip(frames):
    s = Image.new("RGBA", (ANIM * len(frames), ANIM), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        s.paste(f, (i * ANIM, 0))
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--only", default="symbols,anim,bg,decor,badges,paper")
    a = ap.parse_args()
    only = set(a.only.split(","))
    src = lambda n: os.path.join(a.src, n + ".png")  # noqa: E731

    if only & {"symbols", "anim"}:
        for n in SYMBOLS:
            sym = trimmed(keyed(src(n)))
            if n == "W":
                sym = wild_label(sym)
            if "symbols" in only:
                save_webp(fit(sym, STATIC), "symbols/%s.webp" % n, 92)
            if "anim" in only:
                save_webp(strip(win_frames(sym)), "anim/%s_win.webp" % n, 88)
    if "badges" in only:
        for n in BADGES:
            save_webp(fit(trimmed(keyed(src(n))), 256, 0.92), "ui/%s.webp" % n, 90)
    if "bg" in only:
        for n, lite in [("bg_land", (960, 540)), ("bg_port", (540, 960))]:
            im = Image.open(src(n)).convert("RGB")
            save_webp(im, "bg/%s.webp" % n, 84)
            save_webp(im.resize(lite, Image.LANCZOS), "bg/%s_s.webp" % n, 78)
    if "decor" in only:
        for n in ["decor_left", "decor_right"]:
            im = keyed(src(n)).resize((360, 1080), Image.LANCZOS)
            save_webp(im, "bg/%s.webp" % n, 84)
    if "paper" in only:
        im = Image.open(src("paper")).convert("RGB").resize((512, 512), Image.LANCZOS)
        save_webp(im, "ui/paper.webp", 86)
    print("ok")


if __name__ == "__main__":
    main()
