#!/usr/bin/env python3
"""Independent verifier for Stake books. Usage: verify.py <mode> [limit]"""
import sys, io, json, hashlib, time, pickle
from collections import Counter, defaultdict
import zstandard

D = '/home/claude/origami-slot/math/stake/'
OUT = '/home/claude/origami-slot/.work/audit/'
mode = sys.argv[1]
limit = int(sys.argv[2]) if len(sys.argv) > 2 else None

PAY = {
    'L1': (20, 60, 250), 'L2': (20, 60, 250), 'L3': (30, 100, 400), 'L4': (30, 100, 400),
    'H4': (60, 200, 800), 'H3': (100, 400, 1500), 'H2': (200, 800, 4000), 'H1': (500, 2500, 15000),
}
NAMES = set(PAY) | {'W', 'S'}
CAP = 1500000
FS_AWARD = {3: 8, 4: 10, 5: 12}
BASE_M = {2, 3, 5}
FREE_M = {2, 3, 5, 10}
EV_KEYS = {
    'reveal': {'type', 'index', 'gameType', 'board'},
    'winInfo': {'type', 'index', 'totalWin', 'wins'},
    'setTotalWin': {'type', 'index', 'amount'},
    'updateFreeSpin': {'type', 'index', 'amount', 'total'},
    'retrigger': {'type', 'index', 'added', 'total', 'positions'},
    'wincap': {'type', 'index', 'amount'},
    'bonusEnd': {'type', 'index', 'amount', 'spins'},
    'finalWin': {'type', 'index', 'amount'},
}

# ---- csv
csv_w = []
csv_p = []
import os
CSVP = os.environ.get('AUD_CSV', D + f'lookUpTable_{mode}_0.csv')
BOOKP = os.environ.get('AUD_BOOKS', D + f'books_{mode}.jsonl.zst')
TAG = os.environ.get('AUD_TAG', '')
with open(CSVP) as f:
    for i, l in enumerate(f):
        a, w, p = l.rstrip('\n').split(',')
        assert int(a) == i + 1
        csv_w.append(int(w)); csv_p.append(int(p))
N = len(csv_w)

errs = Counter()
ex = defaultdict(list)


def err(cat, rid):
    errs[cat] += 1
    e = ex[cat]
    if len(e) < 6:
        e.append(rid)


notes = Counter()
note_ex = defaultdict(list)


def note(cat, rid):
    notes[cat] += 1
    e = note_ex[cat]
    if len(e) < 6:
        e.append(rid)


def isint(x):
    return type(x) is int


def parse_board(board, rid, free):
    """returns names[reel][row], wilds {(reel,row):mult}, scatters [(reel,row)]"""
    ok = True
    if type(board) is not list or len(board) != 5:
        err('board_shape', rid); return None
    names = []
    wilds = {}
    scat = []
    for r in range(5):
        col = board[r]
        if type(col) is not list or len(col) != 5:
            err('board_shape', rid); return None
        cn = []
        ns = 0
        for row in range(5):
            c = col[row]
            if type(c) is not dict or 'name' not in c:
                err('cell_shape', rid); return None
            nm = c['name']
            if nm not in NAMES:
                err('cell_unknown_symbol', rid); return None
            if nm == 'W':
                m = c.get('multiplier')
                if not isint(m):
                    err('wild_no_int_multiplier', rid); m = 1
                if r == 0 or r == 4:
                    err('wild_on_reel_0_or_4', rid)
                if m not in (FREE_M if free else BASE_M):
                    err('wild_bad_multiplier_' + ('free' if free else 'base'), rid)
                ks = set(c.keys())
                if free:
                    if c.get('sticky') is not True:
                        err('free_wild_without_sticky_true', rid)
                    if ks != {'name', 'multiplier', 'sticky'}:
                        err('wild_cell_keys', rid)
                else:
                    if 'sticky' in c:
                        err('base_wild_has_sticky', rid)
                    if ks != {'name', 'multiplier'}:
                        err('wild_cell_keys', rid)
                wilds[(r, row)] = m
            else:
                if len(c) != 1:
                    err('nonwild_cell_extra_keys', rid)
                if nm == 'S':
                    ns += 1
                    scat.append((r, row))
            cn.append(nm)
        if ns > 1:
            err('multiple_scatters_on_reel', rid)
        names.append(cn)
    return names, wilds, scat


def line_wins(names, wilds):
    """returns dict lineIndex -> (symbol, kind, win, mult, base)"""
    out = {}
    for row in range(5):
        k = 0
        while k < 5 and names[k][row] == 'W':
            k += 1
        best = None
        if k >= 3:  # leading wilds pay as H1
            m = 1
            for r in range(k):
                m *= wilds[(r, row)]
            b = PAY['H1'][k - 3]
            best = ('H1', k, b * m, m, b)
        if k < 5:
            sym = names[k][row]
            if sym != 'S':
                cnt = k
                while cnt < 5 and (names[cnt][row] == sym or names[cnt][row] == 'W'):
                    cnt += 1
                if cnt >= 3:
                    m = 1
                    for r in range(cnt):
                        if names[r][row] == 'W':
                            m *= wilds[(r, row)]
                    b = PAY[sym][cnt - 3]
                    cand = (sym, cnt, b * m, m, b)
                    if best is None or cand[2] > best[2]:
                        best = cand
        if best:
            out[row] = best
    return out


def pos_list(positions):
    try:
        return [(p['reel'], p['row']) for p in positions]
    except Exception:
        return None


def check_wininfo(ev, exp, rid, total_before):
    """exp: dict line->(sym,kind,win,mult,base)."""
    if set(ev.keys()) != EV_KEYS['winInfo']:
        err('event_keys_winInfo', rid)
    wins = ev.get('wins')
    if type(wins) is not list:
        err('winInfo_wins_not_list', rid); return
    seen = set()
    lines_order = []
    for w in wins:
        if set(w.keys()) != {'symbol', 'kind', 'win', 'positions', 'meta'} or \
                set(w['meta'].keys()) != {'lineIndex', 'multiplier', 'winWithoutMult'}:
            err('winInfo_win_keys', rid); continue
        li = w['meta']['lineIndex']
        lines_order.append(li)
        if li in seen:
            err('winInfo_duplicate_line', rid); continue
        seen.add(li)
        e = exp.get(li)
        if e is None:
            err('winInfo_extra_win_not_in_recompute', rid); continue
        sym, kind, win, mult, base = e
        if w['symbol'] != sym:
            err('winInfo_symbol_mismatch', rid)
        if w['kind'] != kind:
            err('winInfo_kind_mismatch', rid)
        if w['win'] != win or not isint(w['win']):
            err('winInfo_win_mismatch', rid)
        if w['meta']['multiplier'] != mult:
            err('winInfo_multiplier_mismatch', rid)
        if w['meta']['winWithoutMult'] != base:
            err('winInfo_winWithoutMult_mismatch', rid)
        if pos_list(w['positions']) != [(r, li) for r in range(kind)]:
            err('winInfo_positions_mismatch', rid)
    if seen != set(exp.keys()):
        if set(exp.keys()) - seen:
            err('winInfo_missing_win', rid)
    if lines_order != sorted(lines_order):
        note('winInfo_wins_not_sorted_by_line', rid)
    raw = sum(e[2] for e in exp.values())
    expect_total = min(raw, CAP - total_before)
    if ev.get('totalWin') != expect_total or not isint(ev.get('totalWin')):
        err('winInfo_totalWin_mismatch', rid)
    if expect_total != raw:
        note('winInfo_totalWin_truncated_by_cap', rid)


# ---- statistics accumulators
base_sym_w = Counter()      # (reel, name) -> weight sum   (base spin)
base_sym_n = Counter()
base_wild_mult_w = Counter()  # mult -> weight
fs_new_w = Counter()        # (reel, name) weighted over non-previously-sticky cells
fs_new_n = Counter()
fs_wild_mult_w = Counter()
fs_wild_mult_n = Counter()
fs_scat_cnt_w = Counter()   # scatter count on a free spin -> weight
fs_scat_cnt_n = Counter()
base_scat_cnt_w = Counter()
base_scat_cnt_n = Counter()
patterns = Counter()
start_wild_mults = Counter()
start_wild_reels = Counter()
records = []
n_spins = 0
n_free_spins = 0
t0 = time.time()

f = open(BOOKP, 'rb')
rd = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(f), encoding='utf-8', newline='\n')
nlines = 0
raw_bytes = 0
for line in rd:
    nlines += 1
    if limit and nlines > limit:
        nlines -= 1
        break
    rid = nlines
    raw_bytes += len(line)
    if not line.endswith('\n'):
        note('line_without_trailing_newline', rid)
    try:
        obj = json.loads(line)
    except Exception:
        err('json_parse', rid); continue
    if type(obj) is not dict or set(obj.keys()) != {'id', 'events', 'payoutMultiplier'}:
        err('round_keys', rid); continue
    if obj['id'] != rid or not isint(obj['id']):
        err('id_not_sequential', rid)
    pm = obj['payoutMultiplier']
    if not isint(pm):
        err('payoutMultiplier_not_int', rid)
    if rid > N:
        err('more_books_than_csv_rows', rid); continue
    if pm != csv_p[rid - 1]:
        err('payout_books_vs_csv', rid)
    wgt = csv_w[rid - 1]
    events = obj['events']
    if type(events) is not list or not events:
        err('events_not_list', rid); continue
    # raw events bytes for duplicate detection
    prefix = '{"id":%d,"payoutMultiplier":%d,"events":' % (obj['id'], pm) if isint(pm) else None
    if prefix and line.startswith(prefix) and line.rstrip('\n').endswith('}'):
        evraw = line.rstrip('\n')[len(prefix):-1]
    else:
        note('line_prefix_layout_differs', rid)
        evraw = json.dumps(events, separators=(',', ':'))
    h_ev = hashlib.blake2b(evraw.encode(), digest_size=12).digest()

    total = 0
    base_win = None
    base_scat = None
    triggered = False
    is_super = False
    start_wilds = None
    fs_total = 0
    fs_played = 0
    n_retrig = 0
    sticky = {}
    cur = None            # current spin dict
    pending_update = False
    capped = False        # recomputed cap reached
    wincap_ev = False
    bonus_end = None
    final_ev = None
    seq = []
    fs_boards = []
    base_board_json = None
    ended = False
    bad_struct = False

    for i, ev in enumerate(events):
        if type(ev) is not dict:
            err('event_not_object', rid); bad_struct = True; break
        if ev.get('index') != i:
            err('event_index_not_sequential', rid)
        t = ev.get('type')
        seq.append(t)
        if final_ev is not None:
            err('event_after_finalWin', rid)
        if t in EV_KEYS and t != 'winInfo' and set(ev.keys()) != EV_KEYS[t]:
            err('event_keys_' + t, rid)
        if t == 'reveal':
            if cur is not None and not cur['closed']:
                err('spin_without_setTotalWin', rid)
            if capped or wincap_ev:
                err('spin_after_wincap', rid)
            first = (cur is None)
            if first:
                if i != 0:
                    err('first_reveal_not_event0', rid)
                if ev.get('gameType') != 'basegame':
                    err('first_reveal_not_basegame', rid)
            else:
                if ev.get('gameType') != 'freegame':
                    err('later_reveal_not_freegame', rid)
                if not triggered:
                    err('free_spin_without_trigger', rid)
                if not pending_update:
                    err('free_spin_without_updateFreeSpin', rid)
                pending_update = False
            pb = parse_board(ev.get('board'), rid, free=not first)
            if pb is None:
                bad_struct = True; break
            names, wilds, scat = pb
            n_spins += 1
            if first:
                base_board_json = json.dumps(ev['board'], separators=(',', ':'))
                for r in range(5):
                    for nm in names[r]:
                        base_sym_w[(r, nm)] += wgt
                        base_sym_n[(r, nm)] += 1
                for m in wilds.values():
                    base_wild_mult_w[m] += wgt
                base_scat = len(scat)
                base_scat_cnt_w[base_scat] += wgt
                base_scat_cnt_n[base_scat] += 1
            else:
                n_free_spins += 1
                fs_played += 1
                fs_boards.append(ev['board'])
                # sticky persistence
                for pos, m in sticky.items():
                    wm = wilds.get(pos)
                    if wm is None:
                        err('sticky_wild_disappeared', rid)
                    elif wm != m:
                        err('sticky_wild_multiplier_changed', rid)
                if fs_played == 1 and start_wilds:
                    for pos, m in start_wilds.items():
                        if wilds.get(pos) != m:
                            err('start_wild_missing_on_first_free_spin', rid)
                # stats over cells that were not sticky before this spin
                prev = sticky if fs_played > 1 else (start_wilds or {})
                for r in range(5):
                    cn = names[r]
                    for row in range(5):
                        if (r, row) in prev:
                            continue
                        nm = cn[row]
                        fs_new_w[(r, nm)] += wgt
                        fs_new_n[(r, nm)] += 1
                        if nm == 'W':
                            m = wilds[(r, row)]
                            fs_wild_mult_w[m] += wgt
                            fs_wild_mult_n[m] += 1
                fs_scat_cnt_w[len(scat)] += wgt
                fs_scat_cnt_n[len(scat)] += 1
                sticky = wilds
            exp = line_wins(names, wilds)
            cur = {'first': first, 'exp': exp, 'raw': sum(e[2] for e in exp.values()), 'scat': scat,
                   'wininfo': False, 'closed': False, 'retrig': False, 'total_before': total,
                   'fs_total_before': fs_total}
        elif t == 'winInfo':
            if cur is None or cur['wininfo'] or cur['closed'] or seq[-2] != 'reveal':
                err('winInfo_misplaced', rid)
            else:
                cur['wininfo'] = True
                if cur['raw'] == 0:
                    err('winInfo_present_but_no_win', rid)
                check_wininfo(ev, cur['exp'], rid, total)
        elif t == 'setTotalWin':
            if cur is None or cur['closed']:
                err('setTotalWin_misplaced', rid)
            else:
                if cur['raw'] > 0 and not cur['wininfo']:
                    err('winInfo_missing_for_winning_spin', rid)
                nt = total + cur['raw']
                if nt >= CAP:
                    nt = CAP
                    capped = True
                total = nt
                if ev.get('amount') != total or not isint(ev.get('amount')):
                    err('setTotalWin_amount_mismatch', rid)
                cur['closed'] = True
                if cur['first']:
                    base_win = total
        elif t == 'freeSpinTrigger':
            if cur is None or not cur['first'] or not cur['closed'] or triggered:
                err('freeSpinTrigger_misplaced', rid)
            triggered = True
            ks = set(ev.keys())
            ns = base_scat or 0
            if ns < 3:
                err('freeSpinTrigger_with_lt3_scatters', rid)
            if ev.get('totalFs') != FS_AWARD.get(ns):
                err('freeSpinTrigger_totalFs_mismatch', rid)
            fs_total = ev.get('totalFs') if isint(ev.get('totalFs')) else 0
            if pos_list(ev.get('positions')) != (cur['scat'] if cur else None):
                if cur and sorted(pos_list(ev.get('positions')) or []) == sorted(cur['scat']):
                    note('freeSpinTrigger_positions_other_order', rid)
                else:
                    err('freeSpinTrigger_positions_mismatch', rid)
            sup = ev.get('super')
            if type(sup) is not bool:
                err('freeSpinTrigger_super_not_bool', rid)
            is_super = bool(sup)
            if mode == 'super':
                if sup is not True:
                    err('super_mode_trigger_not_super', rid)
                if ks != {'type', 'index', 'totalFs', 'positions', 'super', 'startWilds'}:
                    err('event_keys_freeSpinTrigger', rid)
                sw = ev.get('startWilds')
                if type(sw) is not list or len(sw) != 3:
                    err('startWilds_not_3', rid)
                start_wilds = {}
                try:
                    for s in sw or []:
                        if set(s.keys()) != {'reel', 'row', 'multiplier'}:
                            err('startWilds_keys', rid)
                        if s['reel'] not in (1, 2, 3) or s['row'] not in (0, 1, 2, 3, 4):
                            err('startWilds_bad_cell', rid)
                        if s['multiplier'] not in FREE_M:
                            err('startWilds_bad_multiplier', rid)
                        if (s['reel'], s['row']) in start_wilds:
                            err('startWilds_duplicate_cell', rid)
                        start_wilds[(s['reel'], s['row'])] = s['multiplier']
                        start_wild_mults[s['multiplier']] += 1
                    start_wild_reels[tuple(sorted(s['reel'] for s in sw))] += 1
                except Exception:
                    err('startWilds_malformed', rid)
            else:
                if sup is not False:
                    err('nonsuper_mode_trigger_is_super', rid)
                if ks != {'type', 'index', 'totalFs', 'positions', 'super'}:
                    err('event_keys_freeSpinTrigger', rid)
        elif t == 'updateFreeSpin':
            if not triggered or cur is None or not cur['closed'] or pending_update:
                err('updateFreeSpin_misplaced', rid)
            pending_update = True
            if ev.get('amount') != fs_played + 1:
                err('updateFreeSpin_amount_mismatch', rid)
            if ev.get('total') != fs_total:
                err('updateFreeSpin_total_mismatch', rid)
            if fs_played + 1 > fs_total:
                err('free_spin_beyond_awarded', rid)
            if fs_total > 40:
                err('free_spins_total_above_40', rid)
        elif t == 'retrigger':
            if cur is None or cur['first'] or cur['retrig']:
                err('retrigger_misplaced', rid)
            else:
                if not cur['closed']:
                    note('retrigger_before_setTotalWin', rid)
                cur['retrig'] = True
                n_retrig += 1
                if len(cur['scat']) < 3:
                    err('retrigger_with_lt3_scatters', rid)
                add = min(5, 40 - fs_total)
                if ev.get('added') != add:
                    err('retrigger_added_mismatch', rid)
                if add < 5:
                    note('retrigger_added_lt5_due_to_40_cap', rid)
                fs_total += ev.get('added') if isint(ev.get('added')) else 0
                if ev.get('total') != fs_total:
                    err('retrigger_total_mismatch', rid)
                if fs_total > 40:
                    err('free_spins_total_above_40', rid)
                pl = pos_list(ev.get('positions'))
                if pl != cur['scat']:
                    if pl is not None and sorted(pl) == sorted(cur['scat']):
                        note('retrigger_positions_other_order', rid)
                    else:
                        err('retrigger_positions_mismatch', rid)
        elif t == 'wincap':
            wincap_ev = True
            if ev.get('amount') != CAP:
                err('wincap_amount_mismatch', rid)
            if not capped:
                err('wincap_event_but_recomputed_total_below_cap', rid)
            if cur is None or not cur['closed']:
                err('wincap_misplaced', rid)
        elif t == 'bonusEnd':
            if bonus_end is not None or not triggered:
                err('bonusEnd_misplaced', rid)
            bonus_end = ev
            if cur is None or not cur['closed'] or pending_update:
                err('bonusEnd_misplaced', rid)
            if ev.get('amount') != total - (base_win or 0):
                err('bonusEnd_amount_mismatch', rid)
            if ev.get('spins') != fs_played:
                err('bonusEnd_spins_mismatch', rid)
        elif t == 'finalWin':
            final_ev = ev
            if ev.get('amount') != total:
                err('finalWin_vs_recomputed_total', rid)
            if ev.get('amount') != pm:
                err('finalWin_vs_payoutMultiplier', rid)
        else:
            err('unknown_event_type', rid)
        # retrigger bookkeeping when a later event closes a free spin without retrigger
        if t in ('updateFreeSpin', 'bonusEnd', 'wincap', 'finalWin') and cur is not None and not cur['first'] \
                and not cur.get('rt_checked'):
            cur['rt_checked'] = True
            if len(cur['scat']) >= 3 and not cur['retrig']:
                if capped:
                    note('no_retrigger_on_capped_spin_with_3plus_scatters', rid)
                elif cur['fs_total_before'] >= 40:
                    note('no_retrigger_event_at_40_cap', rid)
                else:
                    err('retrigger_missing', rid)
    if bad_struct:
        continue
    # ---- end of round checks
    if final_ev is None or seq[-1] != 'finalWin':
        err('finalWin_not_last', rid)
    if cur is None:
        err('no_reveal', rid); continue
    if not cur['closed']:
        err('spin_without_setTotalWin', rid)
    if pending_update:
        err('dangling_updateFreeSpin', rid)
    if total != pm:
        err('recomputed_total_vs_payoutMultiplier', rid)
    if capped != wincap_ev:
        err('cap_reached_but_no_wincap_event' if capped else 'wincap_event_without_cap', rid)
    if (pm == CAP) != wincap_ev:
        err('payout_cap_vs_wincap_event', rid)
    base_capped = capped and fs_played == 0
    if base_scat is not None and base_scat >= 3 and not triggered:
        if base_capped:
            note('base_spin_capped_no_trigger', rid)
        else:
            err('3plus_scatters_but_no_freeSpinTrigger', rid)
    if triggered:
        if bonus_end is None:
            err('bonusEnd_missing', rid)
        if not capped and fs_played != fs_total:
            err('free_spins_played_vs_awarded', rid)
        if capped and fs_played > fs_total:
            err('free_spins_played_vs_awarded', rid)
        if fs_total > 40:
            err('free_spins_total_above_40', rid)
        exp_total = FS_AWARD.get(base_scat, 0)
    else:
        if fs_played:
            err('free_spins_without_trigger', rid)
        if bonus_end is not None:
            err('bonusEnd_without_trigger', rid)
    if mode in ('bonus', 'super') and not triggered:
        err('buy_mode_round_without_trigger', rid)
    if mode in ('bonus', 'super') and (base_scat or 0) < 3:
        err('buy_mode_base_lt3_scatters', rid)
    # event sequence pattern (collapsed)
    pat = []
    for s in seq:
        pat.append(s)
    # collapse the free spin body repetition for pattern statistics
    spin_pats = []
    curp = []
    for s in seq:
        if s == 'updateFreeSpin':
            spin_pats.append(tuple(curp)); curp = [s]
        else:
            curp.append(s)
    spin_pats.append(tuple(curp))
    patterns[('HEAD',) + spin_pats[0]] += 1
    for sp in spin_pats[1:-1]:
        patterns[('MID',) + sp] += 1
    if len(spin_pats) > 1:
        patterns[('LAST',) + spin_pats[-1]] += 1
    h_base = hashlib.blake2b(base_board_json.encode(), digest_size=12).digest()
    if fs_boards:
        h_fs = hashlib.blake2b(json.dumps([sorted(start_wilds.items()) if start_wilds else None, fs_boards],
                                          separators=(',', ':')).encode(), digest_size=12).digest()
    else:
        h_fs = b''
    n_sticky_end = len(sticky)
    records.append((rid, pm, wgt, base_scat, int(triggered), base_win if base_win is not None else -1,
                    total - (base_win or 0), fs_total, fs_played, n_retrig, int(capped), n_sticky_end,
                    h_ev, h_base, h_fs))
    if nlines % 20000 == 0:
        print(mode, nlines, 'rounds', n_spins, 'spins', round(time.time() - t0, 1), 's', dict(errs), flush=True)

if not limit and nlines != N:
    err('book_count_vs_csv_rows', nlines)

res = dict(mode=mode, nlines=nlines, csv_rows=N, n_spins=n_spins, n_free_spins=n_free_spins, raw_bytes=raw_bytes,
           errs=dict(errs), ex=dict(ex), notes=dict(notes), note_ex=dict(note_ex), patterns=dict(patterns),
           base_sym_w=dict(base_sym_w), base_sym_n=dict(base_sym_n), base_wild_mult_w=dict(base_wild_mult_w),
           fs_new_w=dict(fs_new_w), fs_new_n=dict(fs_new_n), fs_wild_mult_w=dict(fs_wild_mult_w),
           fs_wild_mult_n=dict(fs_wild_mult_n), fs_scat_cnt_w=dict(fs_scat_cnt_w), fs_scat_cnt_n=dict(fs_scat_cnt_n),
           base_scat_cnt_w=dict(base_scat_cnt_w), base_scat_cnt_n=dict(base_scat_cnt_n),
           start_wild_mults=dict(start_wild_mults), start_wild_reels=dict(start_wild_reels),
           records=records, elapsed=time.time() - t0)
suffix = ('' if not limit else f'_lim{limit}') + TAG
with open(OUT + f'res_{mode}{suffix}.pkl', 'wb') as fo:
    pickle.dump(res, fo, protocol=4)
print('DONE', mode, 'rounds', nlines, 'spins', n_spins, 'free spins', n_free_spins, 'bytes', raw_bytes,
      'elapsed', round(time.time() - t0, 1))
print('ERRORS', dict(errs))
for k, v in ex.items():
    print('  ', k, errs[k], v)
print('NOTES', dict(notes))
for k, v in note_ex.items():
    print('  ', k, notes[k], v)
print('PATTERNS')
for k, v in sorted(patterns.items(), key=lambda kv: -kv[1]):
    print('  ', v, k)
