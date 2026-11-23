"""Publish and append the official Shenwan index analysis series."""
import argparse
import json
import math
import re
import sqlite3
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

DATA = Path(__file__).resolve().parents[1] / 'data'
URL = 'https://www.swsresearch.com/institute-sw/api/index_analysis/index_analysis_report/'
CATEGORIES = {1: '一级行业', 2: '二级行业'}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    content = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    if isinstance(value, list):
        content = content.replace('],[', '],\n[')
    content += '\n'
    if not path.exists() or path.read_text(encoding='utf-8') != content:
        path.write_text(content, encoding='utf-8')


def row(day, *values):
    day = date.fromisoformat(str(day)[:10]).isoformat()
    output = [day]
    for value in values:
        try:
            number = float(value)
            output.append(number if math.isfinite(number) else None)
        except (ValueError, TypeError):
            output.append(None)
    return output


def path_for(level, code):
    if not re.fullmatch(r'\d{6}', code):
        raise ValueError('Invalid index code')
    return DATA / f'shenwan_{level}_{code}.json'


def publish(catalog, points, names, status=None):
    entries = {(x['level'], x['code']): x for x in catalog['items']}
    for (level, code), records in points.items():
        path = path_for(level, code)
        series = {r[0]: r for r in read(path)} if path.exists() else {}
        series.update(records)
        rows = [series[day] for day in sorted(series)]
        write(path, rows)
        key = (level, code)
        old = entries.get(key, {})
        name = names[key][1] if not old or names[key][0] >= old['last'] else old['name']
        entries[key] = dict(level=level, code=code, name=name, first=rows[0][0], last=rows[-1][0], count=len(rows))
    catalog['items'] = sorted(entries.values(), key=lambda x: (x['level'], x['code']))
    if status is not None:
        catalog['update'] = status
    write(DATA / 'shenwan.json', catalog)


def import_db(db, catalog):
    points, names = defaultdict(dict), {}
    with sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True) as conn:
        for level, category in CATEGORIES.items():
            sql = 'SELECT code, day, raw_json FROM daily WHERE category=? ORDER BY day'
            for code, day, payload in conn.execute(sql, (category,)):
                x = json.loads(payload)
                points[level, code][day] = row(day, x['收盘指数'], x['市盈率'], x['市净率'])
                names[level, code] = (day, x['指数名称'])
    publish(catalog, points, names)


def fetch(session, level, start, end):
    params = dict(page=1, page_size=500, index_type=CATEGORIES[level],
                  start_date=start.isoformat(), end_date=end.isoformat(), type='DAY', swindexcode='all')
    seen = set()
    total = None
    while True:
        # The public read-only endpoint has historically served an incomplete certificate chain.
        response = session.get(URL, params=params, timeout=(8, 15), verify=False)
        time.sleep(1)
        response.raise_for_status()
        data = response.json()['data']
        count, records = int(data['count']), data['results']
        if total is not None and total != count:
            raise ValueError('Source count changed during pagination')
        if count < 0 or count > 10000 or not isinstance(records, list):
            raise ValueError('Invalid source pagination')
        total = count
        for x in records:
            code = str(x['swindexcode'])
            path_for(level, code)
            point = row(x['bargaindate'], x['closeindex'], x['pe'], x['pb'])
            key = (code, point[0])
            if key in seen or not params['start_date'] <= point[0] <= params['end_date'] or not point[1] or point[1] < 0:
                raise ValueError('Duplicate or invalid index observation')
            seen.add(key)
            yield code, x['swindexname'], point
        if len(seen) == total:
            return
        if not records or len(seen) > total:
            raise ValueError('Incomplete source pagination')
        params['page'] += 1


def refresh(catalog):
    today = datetime.now(timezone(timedelta(hours=8))).date()
    status = dict(catalog.get('update', {}))
    with requests.Session() as session:
        session.headers['User-Agent'] = 'Mozilla/5.0'
        for level in CATEGORIES:
            latest = max(date.fromisoformat(x['last']) for x in catalog['items'] if x['level'] == level)
            start = latest - timedelta(days=7)
            points, names = defaultdict(dict), {}
            try:
                while start <= today:
                    end = min(start + timedelta(days=13), today)
                    for code, name, point in fetch(session, level, start, end):
                        points[level, code][point[0]] = point
                        if (level, code) not in names or point[0] >= names[level, code][0]:
                            names[level, code] = (point[0], name)
                    start = end + timedelta(days=1)
                if not points:
                    raise ValueError('No recent reports returned')
                status[str(level)] = {'checked': today.isoformat(), 'ok': True}
                publish(catalog, points, names, status)
                print(f'Shenwan L{level}: validated {sum(map(len, points.values()))} rows', flush=True)
            except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
                status[str(level)] = {'checked': today.isoformat(), 'ok': False}
                print(f'::warning::Shenwan L{level} update failed, retained history: {exc}', flush=True)
                publish(catalog, {}, {}, status)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--import-db', type=Path)
    args = parser.parse_args()
    index = DATA / 'shenwan.json'
    catalog = read(index) if index.exists() else {'items': []}
    if args.import_db:
        import_db(args.import_db, catalog)
    else:
        refresh(catalog)
