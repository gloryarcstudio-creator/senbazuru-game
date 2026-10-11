#!/usr/bin/env python3
"""Сборка фронтенда: index.html + assets/ -> build/

  python3 tools/build_fe.py            # собрать с текущим номером версии (файл VERSION)
  python3 tools/build_fe.py --bump     # поднять версию на 1 и собрать
  python3 tools/build_fe.py --set 42   # задать версию явно

Что делает:
  * копирует index.html и assets/ в папку сборки (по умолчанию build/);
  * всем относительным ссылкам на png/jpg/webp/webm/mp4/mp3/js проставляет ?v=<версия>
    (в атрибутах, в CSS url(...) и в строках JS — поэтому пути к ассетам в коде
    должны быть записаны целиком, одной строкой);
  * пишет <meta name="build" content="<версия>" data-time="...">;
  * проверяет: все упомянутые ассеты существуют, нет внешних URL, показывает неиспользуемые файлы.
"""
import argparse
import datetime
import os
import re
import shutil
import sys

EXTS = ("png", "jpg", "jpeg", "webp", "webm", "mp4", "mp3", "js")
SKIP_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# ссылка на ассет: сразу после кавычки/скобки, относительный путь, нужное расширение,
# необязательный старый ?v=..., сразу перед кавычкой/скобкой/#
ASSET_RE = re.compile(
    r"""(?P<pre>["'`(])
        (?P<path>(?!(?:[a-zA-Z][a-zA-Z0-9+.-]*:)|//|\#)[^"'`()\s?\#<>]+?\.(?:%s))
        (?:\?v=[^"'`()\s\#<>]*)?
        (?P<post>(?:\#[^"'`()\s<>]*)?["'`)])""" % "|".join(EXTS),
    re.X,
)
META_RE = re.compile(r"""<meta\s+name=["']build["'][^>]*>""", re.I)
EXTERNAL_RE = re.compile(r"""(?:src|href)\s*=\s*["'](https?:)?//[^"']+|url\(\s*["']?(?:https?:)?//[^)]+|@import\s+[^;]+""", re.I)


def read_version(path):
    try:
        with open(path, encoding="utf-8") as f:
            return int(f.read().strip() or 0)
    except FileNotFoundError:
        return 0


def human(n):
    for unit in ("Б", "КБ", "МБ"):
        if n < 1024 or unit == "МБ":
            return ("%.0f %s" if unit == "Б" else "%.1f %s") % (n, unit)
        n /= 1024.0


def main():
    ap = argparse.ArgumentParser(description="Сборка фронтенда слота")
    ap.add_argument("--src", default=os.path.join(ROOT, "index.html"))
    ap.add_argument("--out", default=os.path.join(ROOT, "build"))
    ap.add_argument("--version-file", default=os.path.join(ROOT, "VERSION"))
    ap.add_argument("--bump", action="store_true", help="поднять номер версии на 1")
    ap.add_argument("--set", type=int, dest="set_version", help="задать номер версии")
    args = ap.parse_args()

    src_dir = os.path.dirname(os.path.abspath(args.src))
    version = read_version(args.version_file)
    if args.set_version is not None:
        version = args.set_version
    elif args.bump or version == 0:
        version += 1
    with open(args.version_file, "w", encoding="utf-8") as f:
        f.write("%d\n" % version)

    with open(args.src, encoding="utf-8") as f:
        html = f.read()

    referenced, missing = set(), set()

    def repl(m):
        rel = m.group("path")
        clean = rel[2:] if rel.startswith("./") else rel
        full = os.path.normpath(os.path.join(src_dir, clean))
        if not full.startswith(src_dir + os.sep) or not os.path.isfile(full):
            if clean.startswith("assets/"):
                missing.add(clean)
            return m.group(0)  # не файл проекта (например, строка в коде) — не трогаем
        referenced.add(clean.replace(os.sep, "/"))
        return "%s%s?v=%d%s" % (m.group("pre"), rel, version, m.group("post"))

    out_html, n_links = ASSET_RE.subn(repl, html)
    n_links = len(re.findall(r"\?v=%d(?=[\"'`)#])" % version, out_html))

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    meta = '<meta name="build" content="%d" data-time="%s">' % (version, stamp)
    if META_RE.search(out_html):
        out_html = META_RE.sub(meta, out_html, count=1)
    else:
        m = re.search(r"<meta\s+charset[^>]*>", out_html, re.I) or re.search(r"<head[^>]*>", out_html, re.I)
        pos = m.end() if m else 0
        out_html = out_html[:pos] + "\n" + meta + out_html[pos:]

    # --- запись сборки
    if os.path.isdir(args.out):
        shutil.rmtree(args.out)
    os.makedirs(args.out)
    with open(os.path.join(args.out, "index.html"), "w", encoding="utf-8") as f:
        f.write(out_html)

    assets_src = os.path.join(src_dir, "assets")
    all_assets, total = [], 0
    for base, dirs, files in os.walk(assets_src):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d != "__MACOSX")
        for name in sorted(files):
            if name in SKIP_FILES or name.startswith("."):
                continue
            s = os.path.join(base, name)
            rel = os.path.relpath(s, src_dir).replace(os.sep, "/")
            d = os.path.join(args.out, rel)
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d)
            all_assets.append(rel)
            total += os.path.getsize(s)

    # --- отчёт
    print("build v%d -> %s" % (version, os.path.relpath(args.out, ROOT)))
    print("  index.html: %s, ссылок с ?v=%d: %d" % (human(len(out_html.encode("utf-8"))), version, n_links))
    print("  assets: %d файлов, %s" % (len(all_assets), human(total)))
    groups = {}
    for rel in all_assets:
        parts = rel.split("/")
        key = "/".join(parts[:2]) if len(parts) > 2 else parts[0]
        groups[key] = groups.get(key, 0) + os.path.getsize(os.path.join(src_dir, rel))
    for key in sorted(groups):
        print("    %-18s %s" % (key, human(groups[key])))

    ok = True
    unused = [a for a in all_assets if a not in referenced and a.rsplit(".", 1)[-1].lower() in EXTS]
    if unused:
        print("  ! не упоминаются в index.html (%d): %s" % (len(unused), ", ".join(unused[:12]) + (" ..." if len(unused) > 12 else "")))
    ext = [m.group(0)[:90] for m in EXTERNAL_RE.finditer(html)]
    if ext:
        ok = False
        print("  ОШИБКА: внешние ресурсы запрещены:")
        for e in ext:
            print("     ", e)
    if missing:
        ok = False
        print("  ОШИБКА: нет файлов: " + ", ".join(sorted(missing)))
    if not ok:
        sys.exit(1)
    print("  ok")


if __name__ == "__main__":
    main()
