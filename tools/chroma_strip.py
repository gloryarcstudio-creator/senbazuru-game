#!/usr/bin/env python3
"""Хромакей по зелёному (#00FF00) и сборка спрайт-ленты webp.

Вход (один или несколько): zip с кадрами, папка с кадрами, отдельные картинки, видео (webm/mp4/mov/gif).
Выход: один webp — лента кадров слева направо. Если лента не помещается в 16383 px,
кадры переносятся на следующие ряды (сетка), ни одна сторона файла не превышает 16383 px.

  python3 tools/chroma_strip.py frames.zip -o assets/anim/H1_win.webp --size 256 --trim
  python3 tools/chroma_strip.py crane.png  -o assets/symbols/H1.webp --size 320 --trim
  python3 tools/chroma_strip.py --selftest

Как работает ключ:
  d = G - max(R, B), нормированное на цвет фона (берётся с краёв кадра).
  * внутри объекта порог мягкий: белое/светлое с лёгким зелёным оттенком остаётся НЕПРОЗРАЧНЫМ;
  * в узкой полосе у границы с фоном порог строгий — сглаженный край получает честную
    полупрозрачность, а зелёная примесь вычитается (цвет восстанавливается, каймы нет).
В конце печатает строку для манифеста ASSETS в index.html.
"""
import argparse
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import zipfile

import numpy as np
from PIL import Image, ImageFilter

MAX_SIDE = 16383
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tga", ".tif", ".tiff")
VID_EXT = (".webm", ".mp4", ".mov", ".mkv", ".gif", ".avi")


def natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def load_frames(inputs, fps=None):
    """-> список (имя, PIL.Image RGB/RGBA)"""
    frames = []
    for src in inputs:
        low = src.lower()
        if os.path.isdir(src):
            names = sorted((n for n in os.listdir(src) if n.lower().endswith(IMG_EXT) and not n.startswith(".")), key=natural_key)
            for n in names:
                frames.append((n, Image.open(os.path.join(src, n)).copy()))
        elif low.endswith(".zip"):
            # читаем кадры прямо из архива, на диск ничего не распаковываем
            with zipfile.ZipFile(src) as zf:
                names = [n for n in zf.namelist()
                         if n.lower().endswith(IMG_EXT) and "__MACOSX" not in n and not os.path.basename(n).startswith(".")]
                for n in sorted(names, key=natural_key):
                    with zf.open(n) as f:
                        frames.append((n, Image.open(io.BytesIO(f.read())).copy()))
        elif low.endswith(VID_EXT):
            with tempfile.TemporaryDirectory() as td:
                cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src]
                if fps:
                    cmd += ["-vf", "fps=%s" % fps]
                cmd += ["-vsync", "0", os.path.join(td, "f_%05d.png")]
                subprocess.run(cmd, check=True)
                for n in sorted(os.listdir(td), key=natural_key):
                    frames.append((n, Image.open(os.path.join(td, n)).copy()))
        elif low.endswith(IMG_EXT):
            frames.append((os.path.basename(src), Image.open(src).copy()))
        else:
            sys.exit("Не понимаю вход: %s" % src)
    if not frames:
        sys.exit("Кадров не найдено")
    return frames


def estimate_key(rgb):
    """Цвет фона по рамке кадра (медиана зелёных пикселей); запасной вариант — чистый #00FF00."""
    h, w, _ = rgb.shape
    b = max(2, min(h, w) // 50)
    border = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3), rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    d = border[:, 1] - np.maximum(border[:, 0], border[:, 2])
    green = border[d > 90]
    if len(green) < 0.2 * len(border):
        return np.array([0.0, 255.0, 0.0], dtype=np.float32)
    return np.median(green, axis=0).astype(np.float32)


def chroma_key(img, lo=0.33, hi=0.75, edge_lo=0.08, edge_hi=0.92, edge_px=2, key=None, despill_opaque=0.0):
    """PIL RGB(A) на зелёном -> PIL RGBA с вырезанным фоном."""
    src = np.asarray(img.convert("RGBA"), dtype=np.float32)
    rgb, a_in = src[..., :3], src[..., 3] / 255.0
    k = estimate_key(rgb) if key is None else np.asarray(key, dtype=np.float32)
    kd = max(40.0, float(k[1] - max(k[0], k[2])))
    d = np.clip((rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])) / kd, 0.0, 1.0)

    a_soft = np.clip((hi - d) / (hi - lo), 0.0, 1.0)                  # терпимый: светло-зелёное остаётся
    a_edge = np.clip((edge_hi - d) / (edge_hi - edge_lo), 0.0, 1.0)   # строгий: для сглаженных краёв

    # полоса шириной edge_px вокруг уверенного фона
    bg = (a_soft <= 0.0).astype(np.uint8) * 255
    if edge_px > 0:
        near = np.asarray(Image.fromarray(bg).filter(ImageFilter.MaxFilter(2 * edge_px + 1))) > 0
    else:
        near = np.zeros(d.shape, dtype=bool)
    alpha = np.where(near, np.minimum(a_soft, a_edge), a_soft)

    # убрать примесь фона: P = a*F + (1-a)*K  =>  F = (P - (1-a)*K) / a
    out = rgb.copy()
    part = (alpha > 0.0) & (alpha < 1.0)
    a3 = alpha[..., None]
    un = (rgb - (1.0 - a3) * k) / np.maximum(a3, 1e-3)
    out[part] = np.clip(un, 0, 255)[part]
    if despill_opaque > 0:  # по желанию: приглушить зелёный оттенок и на непрозрачных пикселях
        lim = np.maximum(out[..., 0], out[..., 2])
        g = out[..., 1]
        out[..., 1] = np.where(g > lim, g - (g - lim) * despill_opaque, g)

    alpha = alpha * a_in
    out[alpha <= 0.0] = 0
    rgba = np.dstack([out, alpha[..., None] * 255.0]).round().astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def union_bbox(frames, thr=8):
    box = None
    for f in frames:
        b = f.getchannel("A").point(lambda v: 255 if v > thr else 0).getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def fit_frame(f, size):
    """Вписать кадр в квадрат size×size с сохранением пропорций, по центру."""
    w, h = f.size
    s = min(size / w, size / h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    r = f.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(r, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def layout(n, fw, fh, cols=None, max_side=MAX_SIDE):
    if fw > max_side or fh > max_side:
        sys.exit("Кадр %dx%d больше %d px — уменьшите через --size/--scale" % (fw, fh, max_side))
    max_cols = max_side // fw
    cols = min(n, max_cols if not cols else min(cols, max_cols))
    rows = math.ceil(n / cols)
    if rows * fh > max_side:
        sys.exit("Лента %d кадров %dx%d не помещается в %dx%d — уменьшите кадр (--size) или проредите (--every)" % (n, fw, fh, max_side, max_side))
    return cols, rows


def build(args):
    raw = load_frames(args.inputs, args.fps)
    if args.every > 1:
        raw = raw[::args.every]
    if args.max_frames:
        raw = raw[:args.max_frames]
    key = None
    if args.key:
        h = args.key.lstrip("#")
        key = [int(h[i:i + 2], 16) for i in (0, 2, 4)]

    frames = []
    for name, im in raw:
        if args.no_key:
            frames.append(im.convert("RGBA"))
        else:
            frames.append(chroma_key(im, args.lo, args.hi, args.edge_lo, args.edge_hi, args.edge_px, key, args.despill))
    sizes = {f.size for f in frames}
    if len(sizes) > 1:
        sys.exit("Кадры разного размера: %s" % sorted(sizes))

    if args.trim:
        box = union_bbox(frames)
        if box:
            w, h = frames[0].size
            p = args.pad
            box = (max(0, box[0] - p), max(0, box[1] - p), min(w, box[2] + p), min(h, box[3] + p))
            frames = [f.crop(box) for f in frames]
    if args.size:
        frames = [fit_frame(f, args.size) for f in frames]
    elif args.scale and args.scale != 1.0:
        w, h = frames[0].size
        frames = [f.resize((max(1, round(w * args.scale)), max(1, round(h * args.scale))), Image.LANCZOS) for f in frames]

    fw, fh = frames[0].size
    n = len(frames)
    cols, rows = layout(n, fw, fh, args.cols, args.max_side)
    sheet = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, ((i % cols) * fw, (i // cols) * fh))

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    if args.lossless:
        sheet.save(args.output, "WEBP", lossless=True, method=6)
    else:
        sheet.save(args.output, "WEBP", quality=args.quality, alpha_quality=100, method=6)

    rel = os.path.relpath(args.output).replace(os.sep, "/")
    info = {"src": rel, "fw": fw, "fh": fh, "frames": n, "cols": cols, "fps": args.anim_fps}
    print("%s: %d кадр(ов) %dx%d, сетка %dx%d -> %dx%d px, %.1f КБ" % (rel, n, fw, fh, cols, rows, sheet.width, sheet.height, os.path.getsize(args.output) / 1024))
    print("манифест: " + json.dumps(info, ensure_ascii=False))
    return info


def selftest():
    """Синтетическая проверка ключа и раскладки."""
    W = 128
    yy, xx = np.mgrid[0:W, 0:W]
    big = Image.new("RGB", (W * 4, W * 4), (0, 255, 0))
    px = big.load()
    for y in range(W * 4):
        for x in range(W * 4):
            r = math.hypot(x - W * 2, y - W * 2)
            if r < W * 1.2:
                px[x, y] = (232, 255, 232) if x < W * 2 else (255, 255, 255)  # слева — белое с зелёным оттенком
            if r < W * 0.4:
                px[x, y] = (200, 40, 40)
    img = big.resize((W, W), Image.LANCZOS)  # сглаженные края
    out = np.asarray(chroma_key(img)).astype(int)
    a = out[..., 3]
    r = np.hypot(xx - W / 2 + 0.5, yy - W / 2 + 0.5)
    inside, outside = r < W * 0.3 - 4, r > W * 0.3 + 3
    assert a[inside].min() == 255, "внутри объекта есть прозрачность (min alpha %d)" % a[inside].min()
    assert a[outside].max() == 0, "фон вырезан не полностью (max alpha %d)" % a[outside].max()
    tint = inside & (xx < W / 2 - 2) & (r > W * 0.1 + 3)
    assert a[tint].min() == 255, "белое с зелёным оттенком стало прозрачным"
    edge = (a > 40) & (a < 255)
    spill = (out[..., 1] - np.maximum(out[..., 0], out[..., 2]))[edge]
    assert edge.sum() > 0 and spill.max() <= 40, "на краях осталась зелёная кайма (%s)" % spill.max()
    c, rws = layout(100, 256, 256)
    assert (c, rws) == (63, 2) and c * 256 <= MAX_SIDE
    c, rws = layout(20, 256, 256)
    assert (c, rws) == (20, 1)
    print("selftest ok: фон вырезан, светло-зелёное непрозрачно, каймы нет, раскладка ≤ %d px" % MAX_SIDE)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="*", help="zip / папка / картинки / видео")
    ap.add_argument("-o", "--output", help="куда сохранить webp")
    ap.add_argument("--size", type=int, help="вписать каждый кадр в квадрат N×N")
    ap.add_argument("--scale", type=float, help="масштаб кадра (если не задан --size)")
    ap.add_argument("--trim", action="store_true", help="обрезать пустые поля (общая рамка для всех кадров)")
    ap.add_argument("--pad", type=int, default=4, help="отступ после --trim, px")
    ap.add_argument("--every", type=int, default=1, help="брать каждый N-й кадр")
    ap.add_argument("--max-frames", type=int, help="не больше N кадров")
    ap.add_argument("--fps", help="для видео: частота извлечения кадров")
    ap.add_argument("--anim-fps", type=int, default=24, help="скорость проигрывания (идёт в манифест)")
    ap.add_argument("--cols", type=int, help="кадров в ряду (по умолчанию — сколько влезет в 16383 px)")
    ap.add_argument("--max-side", type=int, default=MAX_SIDE)
    ap.add_argument("-q", "--quality", type=int, default=90)
    ap.add_argument("--lossless", action="store_true")
    ap.add_argument("--no-key", action="store_true", help="не вырезать фон (кадры уже с альфой)")
    ap.add_argument("--key", help="цвет фона, например 00FF00 (по умолчанию определяется по краям кадра)")
    ap.add_argument("--lo", type=float, default=0.33, help="зелёность ниже — непрозрачно (внутри объекта)")
    ap.add_argument("--hi", type=float, default=0.75, help="зелёность выше — фон")
    ap.add_argument("--edge-lo", type=float, default=0.08)
    ap.add_argument("--edge-hi", type=float, default=0.92)
    ap.add_argument("--edge-px", type=int, default=2, help="ширина полосы строгого ключа у края")
    ap.add_argument("--despill", type=float, default=0.0, help="0..1: приглушить зелёный оттенок и на непрозрачных пикселях")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    if not args.inputs or not args.output:
        ap.error("нужны входные файлы и -o")
    build(args)


if __name__ == "__main__":
    main()
