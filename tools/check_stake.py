#!/usr/bin/env python3
"""Проверка папки с математикой перед загрузкой в Stake Engine.

    python3 tools/check_stake.py [math/stake] [--json math/stake_stats.json]

Повторяет проверки формата из официального math-sdk (utils/rgs_verification.py):
  index.json строгого вида; таблица: uint64, выплаты кратны 10, ненулевая выплата не меньше 10, сумма весов помещается в uint64;
  книги: в каждой строке id, events, payoutMultiplier; выплаты книг совпадают с таблицей строка в строку.
И считает ту же сводку статистики (RTP, отклонение, hit rate, частота максимума, prob5k / prob10k / etl / cvar).
Движок игры и экспортёр не используются: читаются только готовые файлы. Нужен модуль zstandard (pip install zstandard).
Код выхода 1 — ошибка формата; превышение лимитов волатильности — предупреждение, как и в SDK.
"""
import io
import json
import math
import os
import sys

import zstandard

UINT64_MAX = 2 ** 64 - 1
# лимиты из math-sdk (verify_mode_volatility): выше них режим «не проходит 3-star volatility limits»
LIMITS = {"prob5k": 1e-2, "prob10k": 0.5e-2, "etl40b": 0.9, "etl10k": 0.8, "cvar": 800, "rtp": 0.967}

errors, warnings_ = [], []


def bad(msg):
    errors.append(msg)


def prob_scale(cost):
    return 0.2 if cost >= 1000 else 0.5 if cost >= 500 else 0.8 if cost >= 200 else 1.0


def read_lut(path, name):
    ids, weights, payouts = [], [], []
    with open(path, "r", encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            parts = line.rstrip("\n").split(",")
            if len(parts) != 3 or not all(p.isdigit() for p in parts):
                bad(f"{name}: таблица, строка {ln}: нужны три целых без знака, получено «{line.strip()[:60]}»")
                continue
            i, w, p = (int(v) for v in parts)
            if i != ln:
                bad(f"{name}: таблица, строка {ln}: id {i} идёт не по порядку")
            if p % 10:
                bad(f"{name}: таблица, id {i}: выплата {p} не кратна 10")
            if 0 < p < 10:
                bad(f"{name}: таблица, id {i}: ненулевая выплата {p} меньше 10")
            if w > UINT64_MAX or p > UINT64_MAX:
                bad(f"{name}: таблица, id {i}: значение не помещается в uint64")
            if w == 0:
                warnings_.append(f"{name}: id {i} имеет нулевой вес")
            ids.append(i); weights.append(w); payouts.append(p)
    if sum(weights) > UINT64_MAX:
        bad(f"{name}: сумма весов не помещается в uint64")
    return ids, weights, payouts


def read_books(path, name, payouts):
    n = events = 0
    types = {}
    with open(path, "rb") as f:
        reader = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(f), encoding="utf-8")
        for line in reader:
            line = line.strip()
            if not line:
                continue
            n += 1
            try:
                b = json.loads(line)
            except json.JSONDecodeError:
                bad(f"{name}: книги, строка {n}: не JSON"); continue
            for key in ("id", "events", "payoutMultiplier"):
                if key not in b:
                    bad(f"{name}: книги, строка {n}: нет ключа {key}")
            if b.get("id") != n:
                bad(f"{name}: книги, строка {n}: id {b.get('id')} идёт не по порядку")
            ev, pm = b.get("events"), b.get("payoutMultiplier")
            if not isinstance(pm, int) or isinstance(pm, bool) or pm < 0:
                bad(f"{name}: книга {n}: payoutMultiplier должен быть целым без знака")
            if not isinstance(ev, list) or not ev or not all(isinstance(e, dict) for e in ev):
                bad(f"{name}: книга {n}: events должен быть непустым списком объектов"); continue
            if n > len(payouts) or payouts[n - 1] != pm:
                bad(f"{name}: книга {n}: выплата {pm} не совпадает с таблицей ({payouts[n - 1] if n <= len(payouts) else 'нет строки'})")
            if ev[-1].get("type") != "finalWin" or ev[-1].get("amount") != pm:
                bad(f"{name}: книга {n}: последнее событие не finalWin с суммой выплаты")
            events += len(ev)
            for e in ev:
                types[e.get("type")] = types.get(e.get("type"), 0) + 1
            if len(errors) > 50:
                return n, events, types
    if n != len(payouts):
        bad(f"{name}: книг {n}, строк таблицы {len(payouts)}")
    return n, events, types


def stats(weights, payouts, cost):
    total = sum(weights)
    dist = {}
    for w, p in zip(weights, payouts):
        dist[p] = dist.get(p, 0) + w
    wins = sorted(dist)                                   # выплаты в сотых долях ставки
    rtp_exact = sum(p * w for p, w in dist.items())       # точное целое: сумма вес × выплата
    mean = rtp_exact / total / 100                        # × ставки
    var = sum(((p / 100 - mean) ** 2) * (w / total) for p, w in dist.items())
    p0 = dist.get(0, 0) / total
    pmax = dist[wins[-1]] / total
    less = sum(w for p, w in dist.items() if p / 100 < cost) / total
    p5k = sum(w for p, w in dist.items() if p / 100 >= 5000) / total
    p10k = sum(w for p, w in dist.items() if p / 100 >= 10000) / total
    etl10k = sum(p / 100 * w for p, w in dist.items() if p / 100 >= 10000) / total
    etl40 = sum(p / 100 * w for p, w in dist.items() if p / 100 >= 40 * cost) / total
    # CVaR(0.999): средний выигрыш в верхнем хвосте, начиная с выплаты, на которой накопленная вероятность достигает 0.999
    cum, tail_start = 0.0, wins[0]
    for p in wins:
        cum += dist[p] / total
        if cum >= 0.999:
            tail_start = p
            break
    tp = sum(dist[p] for p in wins if p >= tail_start) / total
    tv = sum(p / 100 * dist[p] for p in wins if p >= tail_start) / total
    cum, median = 0, 0
    for p in wins:
        cum += dist[p]
        if cum >= total / 2:
            median = p / 100
            break
    return {
        "rtp": mean / cost, "rtp_numerator": rtp_exact, "total_weight": total, "average_win": mean, "std": math.sqrt(var) / cost, "median": median,
        "min_win": wins[0] / 100, "max_win": wins[-1] / 100, "unique_payouts": len(wins), "num_non_zero_payouts": sum(1 for p in payouts if p > 0),
        "prob_nil": p0, "non_zero_hr": (1 / (1 - p0)) if p0 < 1 else float("inf"), "hr_max": 1 / pmax, "prob_less_bet": less,
        "prob5k": p5k * prob_scale(cost), "prob10k": p10k * prob_scale(cost), "etl10k": etl10k, "etl40b": etl40, "cvar": (tv / tp if tp else 0) / cost,
        "weight_min": min(weights), "weight_max": max(weights),
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    folder = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "math", "stake")
    json_out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
    with open(os.path.join(folder, "index.json"), "r", encoding="utf-8") as f:
        index = json.load(f)
    if list(index.keys()) != ["modes"] or not isinstance(index["modes"], list) or not index["modes"]:
        bad("index.json: нужен единственный ключ modes со списком режимов")
    out = {}
    for m in index.get("modes", []):
        if sorted(m.keys()) != ["cost", "events", "name", "weights"]:
            bad(f"index.json: у режима должны быть ровно name, cost, events, weights — получено {sorted(m.keys())}"); continue
        name, cost = m["name"], m["cost"]
        if not isinstance(name, str) or not isinstance(cost, (int, float)) or cost <= 0:
            bad(f"index.json: неверные name или cost у режима {name!r}")
        if not m["events"].endswith(".jsonl.zst") or not m["weights"].endswith(".csv"):
            bad(f"index.json: {name}: events должен оканчиваться на .jsonl.zst, weights — на .csv")
        for key in ("events", "weights"):
            if not os.path.isfile(os.path.join(folder, m[key])):
                bad(f"index.json: {name}: нет файла {m[key]}")
        if errors:
            continue
        ids, weights, payouts = read_lut(os.path.join(folder, m["weights"]), name)
        n, events, types = read_books(os.path.join(folder, m["events"]), name, payouts)
        s = stats(weights, payouts, float(cost))
        s.update({"cost": cost, "books": n, "events": events, "event_types": types,
                  "books_bytes": os.path.getsize(os.path.join(folder, m["events"])), "lut_bytes": os.path.getsize(os.path.join(folder, m["weights"]))})
        s["violated"] = {k: s[k] for k, lim in LIMITS.items() if s[k] > lim and not math.isclose(s[k], lim, rel_tol=1e-9)}
        out[name] = s
    names = list(out)
    if len(set(m.get("name") for m in index.get("modes", []))) != len(index.get("modes", [])):
        bad("index.json: имена режимов повторяются")

    def row(label, fn):
        print(f"{label:<34}" + "".join(f"{fn(out[n]):>18}" for n in names))

    if names:
        print(f"{'':<34}" + "".join(f"{n:>18}" for n in names))
        row("цена, × ставки", lambda s: f"{s['cost']:g}")
        row("книг", lambda s: f"{s['books']:,}")
        row("событий", lambda s: f"{s['events']:,}")
        row("RTP", lambda s: f"{s['rtp'] * 100:.6f}%")
        row("ст. отклонение, × цены", lambda s: f"{s['std']:.2f}")
        row("доля раундов без выигрыша", lambda s: f"{s['prob_nil'] * 100:.2f}%")
        row("выигрыш раз в (non_zero_hr)", lambda s: f"{s['non_zero_hr']:.3f}")
        row("доля раундов с выигрышем < цены", lambda s: f"{s['prob_less_bet'] * 100:.2f}%")
        row("медиана, × ставки", lambda s: f"{s['median']:g}")
        row("макс. выплата, × ставки", lambda s: f"{s['max_win']:,.0f}")
        row("максимум раз в (hr_max)", lambda s: f"{s['hr_max']:,.0f}")
        row("разных выплат", lambda s: f"{s['unique_payouts']:,}")
        row("prob5k   (лимит 0.01)", lambda s: f"{s['prob5k']:.3e}")
        row("prob10k  (лимит 0.005)", lambda s: f"{s['prob10k']:.3e}")
        row("etl40b   (лимит 0.9)", lambda s: f"{s['etl40b']:.4f}")
        row("etl10k   (лимит 0.8)", lambda s: f"{s['etl10k']:.4f}")
        row("cvar     (лимит 800)", lambda s: f"{s['cvar']:.2f}")
        row("вес: мин / макс", lambda s: f"{s['weight_min']:.1e}/{s['weight_max']:.1e}")
        row("книги, МБ", lambda s: f"{s['books_bytes'] / 1048576:.1f}")
        rtps = [out[n]["rtp"] for n in names]
        diff = max(rtps) - min(rtps)
        print(f"\nразброс RTP между режимами: {diff * 100:.6f} п.п. (SDK предупреждает при разнице больше 0.05 в долях)")
        for n in names:
            if out[n]["violated"]:
                warnings_.append(f"{n}: выше лимитов «3-star volatility» из math-sdk — " + ", ".join(f"{k} = {v:.4g} (лимит {LIMITS[k]:g})" for k, v in out[n]["violated"].items()))
    for w in warnings_[:40]:
        print("ПРЕДУПРЕЖДЕНИЕ: " + w)
    if json_out:
        with open(json_out, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1, ensure_ascii=False)
    if errors:
        print("\nОШИБКИ (" + str(len(errors)) + "):\n" + "\n".join(errors[:60]))
        sys.exit(1)
    print("\nok: формат файлов соответствует требованиям Stake Engine; выплаты книг и таблиц совпадают")


if __name__ == "__main__":
    main()
