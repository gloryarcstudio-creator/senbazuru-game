#!/usr/bin/env python3
"""Импорт присланных звуков: music/*.mp3|wav и sfx/*.wav -> assets/music/*.mp3 и assets/sfx/*.mp3.

  python3 tools/import_sound.py <папка с music/ и sfx/>

Эффекты: обрезка тишины по краям (порог −50 dB), громкость к −16 LUFS (короткие, где LUFS не считается, — по пику −6 dB), mp3 128 kbps.
Петли (reel_spin_loop, count_loop, вся музыка): конец перекрёстно сводится с началом (кроссфейд 0.6 с для эффектов,
2 с для музыки), первый и последний семпл совпадают — шва нет. Музыка к −14 LUFS, mp3 160 kbps, стерео.
Рядом с каждым mp3 пишет webm/opus (для артефакта claude.ai, который не принимает аудио). Печатает таблицу: длительность до/после, LUFS.
"""
import os
import subprocess
import sys

import numpy as np

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOOPS = {"reel_spin_loop": 0.6, "count_loop": 0.6}
MUSIC_XFADE = 2.0


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def decode(path, rate=44100, ch=1):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", str(ch), "-ar", str(rate), "-"], capture_output=True, check=True)
    a = np.frombuffer(r.stdout, dtype=np.float32)
    return a.reshape(-1, ch) if ch > 1 else a


def encode(a, path, rate, ch, kbps):
    raw = a.astype(np.float32).tobytes()
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ac", str(ch), "-ar", str(rate), "-i", "-", "-c:a", "libmp3lame", "-b:a", "%dk" % kbps, path], input=raw, check=True)


def trim(a, thr_db=-50.0, pad=0.004, rate=44100):
    mono = a if a.ndim == 1 else a.mean(axis=1)
    thr = 10 ** (thr_db / 20)
    idx = np.where(np.abs(mono) > thr)[0]
    if not len(idx):
        return a
    p = int(pad * rate)
    return a[max(0, idx[0] - p): min(len(mono), idx[-1] + p)]


def lufs(path):
    r = run(["ffmpeg", "-i", path, "-af", "loudnorm=print_format=summary", "-f", "null", "-"])
    for line in r.stderr.splitlines():
        if "Input Integrated" in line:
            return float(line.split()[2])
    return float("nan")


def normalize(a, target_lufs, tmp, rate, ch):
    encode(a, tmp, rate, ch, 320)
    cur = lufs(tmp)
    if cur == float("-inf") or cur != cur:          # слишком коротко для LUFS: по пику
        peak = float(np.abs(a).max()) or 1.0
        return a * (10 ** (-6.0 / 20) / peak), "peak"   # короткие щелчки тише, чем −1 dB
    g = 10 ** ((target_lufs - cur) / 20)
    out = a * g
    peak = float(np.abs(out).max())
    lim = 10 ** (-1.0 / 20)
    if peak > lim:
        out *= lim / peak
    return out, "%.1f" % cur


def make_loop(a, xfade, rate):
    n = int(xfade * rate)
    if len(a) <= 3 * n:
        return a
    head, tail = a[:n].copy(), a[-n:].copy()
    w = np.linspace(0, 1, n, dtype=np.float32)
    if a.ndim > 1:
        w = w[:, None]
    mixed = tail * (1 - w) + head * w
    return np.concatenate([mixed, a[n:-n]])          # петля начинается там, где был сведён конец с началом


def main():
    os.makedirs(os.path.join(ROOT, "assets", "sfx"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "assets", "music"), exist_ok=True)
    tmp = "/tmp/claude-0/-home-claude/3892d624-994c-5c33-9c45-693b95fdabf1/scratchpad/_snd_tmp.mp3"
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    rows = []
    for folder in ["sfx", "music"]:
        d = os.path.join(SRC, folder)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            name, ext = os.path.splitext(f)
            if ext.lower() not in (".wav", ".mp3", ".flac", ".ogg", ".m4a"):
                continue
            music = folder == "music"
            ch = 2 if music else 1
            a = decode(os.path.join(d, f), 44100, ch)
            d0 = len(a) / 44100
            a = trim(a)
            if music:
                a = make_loop(a, MUSIC_XFADE, 44100)
            elif name in LOOPS:
                a = make_loop(a, LOOPS[name], 44100)
            a, was = normalize(a, -14.0 if music else -16.0, tmp, 44100, ch)
            out = os.path.join(ROOT, "assets", folder, name + ".mp3")
            encode(a, out, 44100, ch, 160 if music else 128)
            # запасной формат webm/opus: артефакт claude.ai не принимает audio/*, а video/webm принимает; Chrome декодирует его в decodeAudioData
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", out, "-c:a", "libopus", "-b:a", "96k" if music else "64k", out[:-4] + ".webm"], check=True)
            rows.append((folder + "/" + name, d0, len(a) / 44100, was, lufs(out), os.path.getsize(out) // 1024))
    print("%-24s %7s %7s %8s %8s %6s" % ("файл", "было, с", "стало", "LUFS до", "после", "КБ"))
    for r in rows:
        print("%-24s %7.2f %7.2f %8s %8.1f %6d" % r)
    print("ok:", len(rows), "файлов")


if __name__ == "__main__":
    main()
