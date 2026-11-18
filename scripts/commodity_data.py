"""Persistent commodity history. Add instruments in commodities-config.json."""
import calendar
import csv
import io
import json
import math
import time
import zipfile
from bisect import bisect_right
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
TZ = timezone(timedelta(hours=8))


def write(path, data):
    content = json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'
    if 'rows' in data:
        # One observation per line lets Git store small daily changes efficiently.
        content = content.replace('],[' , '],\n[')
    if path.exists() and path.read_text(encoding='utf-8') == content:
        return
    tmp = path.with_suffix('.tmp')
    tmp.write_text(content, encoding='utf-8')
    tmp.replace(path)


def request(url, **kwargs):
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=(10, 40), **kwargs)
            r.raise_for_status()
            return r
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


def fetch(item):
    if item['source'] == 'umicore':
        today = datetime.now(TZ).date()
        url = f"https://pmm.umicore.com/api/chart/export/csv/{item['symbol']}/2006-01-02/{today.isoformat()}/DGVV/"
        r = request(url)
        # The CSV is UTF-8, but its application/csv response has no charset.
        # requests' platform-dependent guessing can corrupt the euro unit symbol.
        try:
            return umicore_rows(r.content.decode('utf-8-sig'))
        except ValueError:
            print('Umicore export retry:', item['symbol'], repr(r.content[:180]), flush=True)
            # Retry a malformed/empty public export without reusing an edge cache.
            r = request(url, params={'refresh': str(int(time.time()))}, headers={'Referer': item.get('source_url', 'https://pmm.umicore.com/en/prices/'), 'Accept': 'text/csv,*/*', 'User-Agent': 'Mozilla/5.0'})
            return umicore_rows(r.content.decode('utf-8-sig'))
    if item['source'] == 'sina_global':
        r = request('https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_commodity=/GlobalFuturesService.getGlobalFuturesDailyKLine', params={'symbol': item['symbol'], 'source': 'web'})
        raw = json.loads(r.text[r.text.index('['):r.text.rindex(']') + 1])
        return global_rows(raw, datetime.now(TZ).date())
    if item['source'] == 'sina':
        r = request('https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_commodity=/InnerFuturesNewService.getDailyKLine', params={'symbol': item['symbol']})
        raw = json.loads(r.text[r.text.index('(') + 1:r.text.rindex(')')])
        rows = [[x['d'], float(x['c']), *[float(x[k]) if x.get(k) is not None else None for k in ('o', 'h', 'l', 'v', 'p', 's')]] for x in raw]
        for row in rows:
            if row[7] == 0:
                row[7] = None
        return rows
    if item['source'] == 'nxin':
        raw = request('https://hqb.nxin.com/pigindex/getPigIndexChart.shtml', params={'regionId': '0'}).json()['data']
        return [[datetime.fromtimestamp(x[0] / 1000, TZ).date().isoformat(), float(x[6])] for x in raw]
    raise ValueError('Unknown source')


def umicore_rows(text):
    reader = csv.reader(io.StringIO(text.lstrip('\ufeff')), delimiter=';')
    header = next(reader, [])
    if header != ['Date', '€ / kg']:
        raise ValueError('Unexpected Umicore currency/unit or response schema: ' + repr(header)[:100])
    rows = []
    for row in reader:
        if not row or not any(row):
            continue
        if len(row) != 2:
            raise ValueError('Invalid Umicore observation')
        day = date.fromisoformat(row[0]).isoformat()
        price = float(row[1].replace(',', '')) / 1000
        rows.append([day, round(price, 6)])
    return rows


def fetch_usd_rates(today):
    response = request('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip')
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        name = next(n for n in archive.namelist() if n.endswith('.csv'))
        reader = csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig')))
        rows = []
        for raw in reader:
            row = {k.strip(): v.strip() for k, v in raw.items() if k}
            day = date.fromisoformat(row['Date'])
            rate = float(row['USD'])
            if not math.isfinite(rate) or rate <= 0:
                raise ValueError('Invalid ECB USD rate')
            if day <= today:
                rows.append([day.isoformat(), rate])
    rows.sort()
    if not rows or (today - date.fromisoformat(rows[-1][0])).days > 7:
        raise ValueError('ECB exchange-rate feed is stale')
    path = ROOT / 'data/commodity_fx_eurusd_archive.json'
    old = json.loads(path.read_text(encoding='utf-8'))['rows'] if path.exists() else []
    rows = merge(old, rows, today)
    write(path, {'source': 'ECB', 'fields': ['date', 'USD_per_EUR'], 'rows': rows})
    return rows


def convert_usd(euro_rows, rates):
    dates = [r[0] for r in rates]
    converted = []
    last_fx = None
    for day, price in euro_rows:
        index = bisect_right(dates, day) - 1
        if index < 0:
            raise ValueError('Missing historical FX rate')
        fx_day, rate = rates[index]
        if (date.fromisoformat(day) - date.fromisoformat(fx_day)).days > 7:
            raise ValueError('Historical FX gap exceeds 7 days')
        converted.append([day, round(price * rate, 8)])
        last_fx = {'date': fx_day, 'usd_per_eur': rate}
    return converted, last_fx


def global_rows(raw, today):
    # The foreign feed also returns an unfinished current-day candle.
    # At the 18:00 Beijing update, only previous calendar dates are completed.
    rows = []
    for x in raw:
        if date.fromisoformat(x['date']) >= today:
            continue
        row = [x['date'], float(x['close'])]
        row.extend(float(x[k]) if x.get(k) not in (None, '') else None for k in ('open', 'high', 'low', 'volume', 'position', 'settlement'))
        if row[7] == 0:
            row[7] = None
        rows.append(row)
    return rows


def merge(old, incoming, today, allow_nonpositive=False):
    if not incoming:
        raise ValueError('Empty response')
    values = {}
    for row in incoming:
        day = date.fromisoformat(row[0])
        if day > today or not math.isfinite(row[1]) or (row[1] <= 0 and not allow_nonpositive):
            raise ValueError('Invalid date or price')
        if any(v is not None and not math.isfinite(v) for v in row[1:]):
            raise ValueError('Non-finite value')
        values[row[0]] = row
    if old and max(values) < old[-1][0]:
        raise ValueError('Source moved backwards')
    # A truncated response must never delete earlier observations.
    return sorted({**{r[0]: r for r in old}, **values}.values(), key=lambda r: r[0])


def years_before(day, years):
    year = day.year - years
    return day.replace(year=year, day=min(day.day, calendar.monthrange(year, day.month)[1]))


def statistics(rows, item, today):
    latest = date.fromisoformat(rows[-1][0])
    current = rows[-1][1]
    stale = (today - latest).days > item['stale_days']
    result = {}
    for years in (1, 5, 10):
        cutoff = years_before(latest, years).isoformat()
        window = [r for r in rows if r[0] >= cutoff]
        prices = [r[1] for r in window]
        # Require chronological coverage, sample density and no large interior hole.
        dates = [date.fromisoformat(r[0]) for r in window]
        max_gap = max(((b - a).days for a, b in zip(dates, dates[1:])), default=0)
        complete = rows[0][0] <= cutoff and len(prices) >= years * item['min_samples_year'] and max_gap <= item['max_gap_days']
        lo, hi = min(prices), max(prices)
        rank = 100 * (sum(p < current for p in prices) + .5 * sum(p == current for p in prices)) / len(prices)
        result[str(years)] = {'percentile': rank if complete else None, 'complete': complete,
                              'samples': len(prices), 'from': window[0][0], 'min': lo, 'max': hi,
                              'position': 100 * (current - lo) / (hi - lo) if complete and hi > lo else None}
    return {'latest_date': rows[-1][0], 'price': current, 'first_date': rows[0][0], 'count': len(rows),
            'stale': stale, 'windows': result,
            'attention': not stale and all(x['complete'] and x['percentile'] <= 10 for x in result.values())}


def main():
    config = json.loads((ROOT / 'commodities-config.json').read_text(encoding='utf-8'))
    today = datetime.now(TZ).date()
    summaries = []
    rates, fx_error = None, None
    if any(x.get('currency') == 'USD' and x['source'] == 'umicore' for x in config['items']):
        try:
            rates = fetch_usd_rates(today)
        except Exception as exc:
            fx_error = str(exc)
    for item in config['items']:
        path = ROOT / 'data' / ('commodity_' + item['id'] + '.json')
        existing = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'rows': []}
        error = None
        try:
            if existing.get('source', item['source']) != item['source']:
                raise ValueError('Source change requires a new instrument id')
            metadata = {}
            if item['source'] == 'umicore' and item.get('currency') == 'USD':
                if fx_error:
                    raise ValueError('ECB FX unavailable: ' + fx_error)
                raw_path = ROOT / 'data' / ('commodity_' + item['id'] + '_eur_archive.json')
                if raw_path.exists():
                    old_raw = json.loads(raw_path.read_text(encoding='utf-8'))['rows']
                elif existing.get('currency', 'EUR') == 'EUR':
                    old_raw = existing['rows']
                else:
                    raise ValueError('Missing original EUR archive; refusing to mix currencies')
                euro_rows = merge(old_raw, fetch(item), today)
                rows, last_fx = convert_usd(euro_rows, rates)
                write(raw_path, {'currency': 'EUR', 'unit': 'EUR/g', 'rows': euro_rows})
                metadata = {'currency': 'USD', 'fx': last_fx}
            else:
                rows = merge(existing['rows'], fetch(item), today, item.get('allow_nonpositive', False))
            existing = {'id': item['id'], 'source': item['source'], 'fields': ['date', 'price', 'open', 'high', 'low', 'volume', 'open_interest', 'settlement'] if item['source'] in ('sina', 'sina_global') else ['date', 'price'], 'rows': rows, **metadata}
            write(path, existing)
        except Exception as exc:
            error = type(exc).__name__ + ': ' + str(exc)[:180]
            print(item['id'], 'retaining history:', error, flush=True)
            if item.get('currency') == 'USD' and item['source'] == 'umicore' and existing.get('currency') != 'USD':
                existing = {'rows': []}  # Never label unconverted EUR as USD.
        if existing['rows']:
            summary = {**item, **statistics(existing['rows'], item, today), 'error': error}
            if existing.get('fx'):
                summary['fx'] = existing['fx']
            if error:
                summary['attention'] = False
            summaries.append(summary)
            print(item['id'], summary['count'], summary['latest_date'], 'attention=', summary['attention'], flush=True)
        else:
            summaries.append({**item, 'error': error, 'count': 0, 'attention': False})
        time.sleep(1)
    write(ROOT / 'data/commodities.json', {'checked_at': datetime.now(TZ).isoformat(timespec='seconds'), 'items': summaries})
    if any(not x['count'] for x in summaries):
        raise SystemExit('One or more instruments have no history')


if __name__ == '__main__':
    main()
