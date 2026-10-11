#!/usr/bin/env bash
# Упаковка сборки в ДВА zip-архива, каждый меньше лимита (по умолчанию 30 МБ):
#   part1 — всё, кроме assets/anim и assets/music
#   part2 — assets/anim + assets/music
# Оба архива распаковываются в одну и ту же папку и вместе дают полную сборку.
#
#   tools/pack_fe.sh [папка_сборки=build] [папка_архивов=dist]
#   NAME=origami LIMIT_MB=30 tools/pack_fe.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${1:-$ROOT/build}"
OUT="${2:-$ROOT/dist}"
NAME="${NAME:-origami}"
LIMIT_MB="${LIMIT_MB:-30}"
LIMIT=$((LIMIT_MB * 1024 * 1024))

[ -f "$BUILD/index.html" ] || { echo "Нет сборки в $BUILD — сначала python3 tools/build_fe.py" >&2; exit 1; }
BUILD="$(cd "$BUILD" && pwd)"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"

V="$(sed -n 's/.*<meta name="build" content="\([0-9][0-9]*\)".*/\1/p' "$BUILD/index.html" | head -1)"
[ -n "$V" ] || { echo "В $BUILD/index.html нет <meta name=\"build\">" >&2; exit 1; }

P1="$OUT/${NAME}_v${V}_part1.zip"
P2="$OUT/${NAME}_v${V}_part2.zip"
rm -f "$OUT/${NAME}"_v*_part1.zip "$OUT/${NAME}"_v*_part2.zip

cd "$BUILD"
zip -r -X -q "$P1" . -x 'assets/anim/*' -x 'assets/music/*' -x '*.DS_Store' -x '__MACOSX/*'

HEAVY=()
[ -d assets/anim ] && HEAVY+=(assets/anim)
[ -d assets/music ] && HEAVY+=(assets/music)
if [ "${#HEAVY[@]}" -eq 0 ]; then
  echo "В сборке нет assets/anim и assets/music — part2 не из чего собирать" >&2; exit 1
fi
zip -r -X -q "$P2" "${HEAVY[@]}" -x '*.DS_Store'

# --- проверки: размер и полнота (объединение архивов == сборка, без пересечений)
fail=0
for z in "$P1" "$P2"; do
  size=$(stat -c %s "$z" 2>/dev/null || stat -f %z "$z")
  mb=$(awk -v s="$size" 'BEGIN{printf "%.2f", s/1048576}')
  n=$(unzip -Z1 "$z" | grep -vc '/$' || true)
  if [ "$size" -ge "$LIMIT" ]; then
    echo "ОШИБКА  $(basename "$z"): $mb МБ ≥ $LIMIT_MB МБ"; fail=1
  else
    echo "ok      $(basename "$z"): $mb МБ, файлов: $n"
  fi
done

want=$(find . -type f ! -name '.DS_Store' | sed 's|^\./||' | sort)
got=$( (unzip -Z1 "$P1"; unzip -Z1 "$P2") | grep -v '/$' | sort)
if [ "$want" != "$got" ]; then
  echo "ОШИБКА  содержимое архивов не совпадает со сборкой:"; diff <(echo "$want") <(echo "$got") || true; fail=1
fi
dup=$(echo "$got" | uniq -d)
[ -z "$dup" ] || { echo "ОШИБКА  файлы попали в оба архива: $dup"; fail=1; }

[ "$fail" -eq 0 ] || exit 1
echo "$P1"
echo "$P2"
