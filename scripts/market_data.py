"""Public quarter-end snapshots and incremental daily updates."""
import bisect
import calendar
from datetime import date, datetime, timedelta, timezone
import json
import math
from pathlib import Path
import sys
import time
import requests

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
NOTE = ('PE为TTM市盈率，PB为市净率，市值为总市值（亿元）。季度点取季度内最后可用交易记录，另列最新记录；实际观测日期见表。'
        '分红率按股息率估算：截至观测日近365天已实施税前现金分红估算总额÷当日总市值；'
        '分红额按每10股派现÷10×分红记录总股本估算，不含回购。来源可能漏记，分红基数及A/H差异未核验；'
        '无可用分红记录不填零。非股利支付率。PE/PB原值保留负数；零值或缺失不作有效估值。')


def finite(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def quarter(day):
    d = date.fromisoformat(day[:10])
    month = (d.month - 1) // 3 * 3 + 3
    return date(d.year, month, calendar.monthrange(d.year, month)[1]).isoformat()


def dividend_event(raw):
    day, report = str(raw.get('EX_DIVIDEND_DATE') or '')[:10], str(raw.get('REPORT_DATE') or '')[:10]
    if len(day) != 10 or len(report) != 10:
        return None
    cash, shares = finite(raw.get('PRETAX_BONUS_RMB')), finite(raw.get('TOTAL_SHARES'))
    amount = 0.0 if cash == 0 else cash / 10 * shares if cash is not None and cash > 0 and shares is not None and shares > 0 else None
    return [str(raw['SECURITY_CODE']).zfill(6), report, day, amount, raw.get('ASSIGN_PROGRESS')]


def dividend_index(events):
    groups = {}
    for code, report, day, amount, progress in events:
        if progress == '实施分配':
            groups.setdefault(code, []).append((day, amount))
    result = {}
    for code, rows in groups.items():
        rows.sort(key=lambda row: row[0])
        days, sums, missing = [], [0.0], [0]
        for day, amount in rows:
            days.append(day)
            sums.append(sums[-1] + (amount or 0))
            missing.append(missing[-1] + (amount is None))
        result[code] = days, sums, missing
    return result


def yield_at(index, code, day, cap_yi):
    if code not in index or cap_yi is None or cap_yi <= 0:
        return None
    days, sums, missing = index[code]
    start = (date.fromisoformat(day) - timedelta(days=365)).isoformat()
    a, b = bisect.bisect_right(days, start), bisect.bisect_right(days, day)
    if a == b or missing[b] != missing[a]:
        return None
    return (sums[b] - sums[a]) / (cap_yi * 1e8) * 100


def build_rows(observations, events, as_of):
    index = dividend_index(events)
    stocks = {}
    for code, values in observations.items():
        # Each observation: actual date, PE, PB, total market cap in yi yuan.
        by_quarter, latest = {}, None
        for row in sorted(values, key=lambda row: row[0]):
            if row[0] > as_of:
                continue
            latest = row
            q = quarter(row[0])
            if q <= as_of:
                by_quarter[q] = row
        rows = [[q, *row[:3], yield_at(index, code, row[0], row[3]), row[3]] for q, row in sorted(by_quarter.items())]
        if latest:
            latest_row = ['最新', *latest[:3], yield_at(index, code, latest[0], latest[3]), latest[3]]
            if not rows or rows[-1][1] != latest[0]:
                rows.append(latest_row)
        stocks[code] = rows
    return stocks


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')


def checkpoint_payload(data):
    """A checkpoint contains completed quarters only, never the latest daily row."""
    stocks = {code: [row for row in rows if row[0] != '最新'] for code, rows in data['stocks'].items()}
    periods = [row[0] for rows in stocks.values() for row in rows]
    if not periods:
        return None
    return dict(stocks=stocks, as_of=max(row[1] for rows in stocks.values() for row in rows),
                archived_through=max(periods), note=data['note'], updated_at=data['updated_at'])


def save_checkpoint(root=ROOT):
    path = root/'data/market_archive.json'
    data = json.loads((root/'data/market_quarterly.json').read_text(encoding='utf-8'))
    checkpoint = checkpoint_payload(data)
    old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    if checkpoint is None or checkpoint['archived_through'] <= old.get('archived_through', ''):
        print('No new completed quarter; no Git data checkpoint', flush=True)
        return False
    events = json.loads((root/'data/market_dividends.json').read_text(encoding='utf-8'))
    events = [e for e in events if e[2] <= checkpoint['archived_through']]
    write(path, checkpoint)
    write(root/'data/market_dividends_archive.json', events)
    print('Saved quarter checkpoint through '+checkpoint['archived_through'], flush=True)
    return True


def restore_live(root=ROOT):
    """Reuse the deployed mutable snapshot, including on code-only pushes.

    Fail closed on network errors: deploying a stale Git seed could otherwise
    replace newer daily data or lose a not-yet-checkpointed quarter boundary.
    """
    base = 'https://liuguo-m.github.io/financial-explorer/data/'
    payloads = {}
    for name in ('market_quarterly.json', 'market_dividends.json'):
        response = requests.get(base+name, params={'refresh': time.time_ns()}, timeout=90)
        response.raise_for_status()
        payloads[name] = response.json()
    live = payloads['market_quarterly.json']
    events = payloads['market_dividends.json']
    if not isinstance(live.get('stocks'), dict) or not live['stocks'] or not isinstance(events, list):
        raise ValueError('Invalid deployed snapshot; refusing to overwrite')
    archive = json.loads((root/'data/market_archive.json').read_text(encoding='utf-8'))
    # A lagging CDN must not erase a committed quarter; refuse and retry later.
    if live['as_of'] < archive['as_of']:
        raise ValueError('Published snapshot is older than the archive; retry later')
    for code, rows in archive['stocks'].items():
        existing = {r[0]: r for r in live['stocks'].get(code, [])}
        for row in rows:
            existing.setdefault(row[0], row)
        live['stocks'][code] = sorted(existing.values(), key=lambda r: (r[0] == '最新', r[0]))
    for name, payload in payloads.items():
        write(root/'data'/name, payload)
    print('Restored published daily snapshot: '+live['as_of'], flush=True)


def report(name, filters, page_size=5000):
    rows, page, pages = [], 1, 1
    while page <= pages:
        params = dict(reportName=name, columns='ALL', filter=filters, pageSize=page_size,
                      pageNumber=page,
                      sortColumns='TRADE_DATE,SECURITY_CODE' if name == 'RPT_VALUEANALYSIS_DET' else 'EX_DIVIDEND_DATE,SECURITY_CODE,REPORT_DATE',
                      sortTypes='-1,1' if name == 'RPT_VALUEANALYSIS_DET' else '-1,1,-1')
        error = None
        for attempt in range(3):
            try:
                response = requests.get(URL, params=params, timeout=60)
                response.raise_for_status()
                data = response.json()
                if not data.get('success') or not isinstance(data.get('result'), dict):
                    raise RuntimeError('Source returned no validated result: ' + str(data.get('message'))[:160])
                result = data['result']
                rows.extend(result.get('data') or [])
                pages = int(result.get('pages') or 1)
                break
            except Exception as exc:
                error = exc
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        print(f'{name}: page {page}/{pages}', flush=True)
        page += 1
        time.sleep(1)
    return rows


def refresh():
    path = ROOT / 'data/market_quarterly.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    codes = {s['code'] for s in json.loads((ROOT / 'data/catalog.json').read_text(encoding='utf-8'))['stocks']}
    last = date.fromisoformat(data['as_of'])
    # Backfill since the last success so missed quarter ends are not lost.
    market = report('RPT_VALUEANALYSIS_DET', f"(TRADE_DATE>='{(last-timedelta(days=7)).isoformat()}')")
    today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    observations = {code: {r[1]: [r[1], r[2], r[3], r[5]] for r in rows} for code, rows in data['stocks'].items()}
    updated_codes, new_date = set(), data['as_of']
    for raw in market:
        code, day = str(raw.get('SECURITY_CODE', '')).zfill(6), str(raw.get('TRADE_DATE', ''))[:10]
        cap = finite(raw.get('TOTAL_MARKET_CAP'))
        if code not in codes or len(day) != 10 or day > today or cap is None or cap <= 0:
            continue
        pe, pb = finite(raw.get('PE_TTM')), finite(raw.get('PB_MRQ'))
        observations.setdefault(code, {})[day] = [day, pe if pe else None, pb if pb else None, cap / 1e8]
        updated_codes.add(code)
        new_date = max(new_date, day)
    if len(updated_codes) < len(codes) * .8:
        raise RuntimeError(f'Incomplete market response: {len(updated_codes)}/{len(codes)}; preserving previous files')
    raw_events = report('RPT_SHAREBONUS_DET', f"(EX_DIVIDEND_DATE>='{(last-timedelta(days=370)).isoformat()}')(EX_DIVIDEND_DATE<='{today}')", 1000)
    event_path = ROOT / 'data/market_dividends.json'
    events = {tuple(e[:3]): e for e in json.loads(event_path.read_text(encoding='utf-8'))}
    for raw in raw_events:
        event = dividend_event(raw)
        if event and event[0] in codes:
            events[tuple(event[:3])] = event
    all_events = list(events.values())
    stocks = build_rows({c: list(rows.values()) for c, rows in observations.items()}, all_events, new_date)
    data.update(stocks=stocks, as_of=new_date, note=NOTE,
                updated_at=datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds'))
    write(event_path, all_events)
    write(path, data)
    print(f'Updated {len(updated_codes)} companies; latest trading date {new_date}', flush=True)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'refresh'
    if mode == 'restore':
        restore_live()
    elif mode == 'checkpoint':
        save_checkpoint()
    elif mode == 'refresh':
        refresh()
    else:
        raise SystemExit('Unknown mode')
