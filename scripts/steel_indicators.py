"""Collect factual observations from public steel reports and NBS releases."""
import argparse
import calendar
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

from commodity_data import ROOT, TZ, write

PATH = ROOT / 'data/steel_indicators.json'
NBS = 'https://www.stats.gov.cn/sj/zxfb/'
INDUSTRY = '黑色金属冶炼和压延加工业'
SEEDS = (
    'https://www.stats.gov.cn/sj/zxfb/202610/t20261027_1965697.html',
    'https://www.stats.gov.cn/sj/zxfb/202609/t20260928_1965425.html',
    'https://www.stats.gov.cn/sj/zxfb/202610/t20261019_1965611.html',
    'https://gc.mysteel.com/a/26112616/791346B86E36364D.html',
    'https://gc.mysteel.com/a/26111917/BE6D86D8F8148A26.html',
    'https://news.mysteel.com/a/26111215/8A2D6B4CD3BC37C2.html',
    'https://tks.mysteel.com/datas/a/26112008/0621394B87D69146.html',
    'https://gc.mysteel.com/a/26091015/5BAEF9F3FE4E8000.html',
    'https://m.mysteel.com/a/26102215/637BC10C5D4376F5_abc.html',
    'https://news.mysteel.com/a/26091717/FFFC0B4F20BAA91B.html',
    'https://news.mysteel.com/a/26092415/E8C44A190EE426A3.html',
    'https://gc.mysteel.com/a/26090315/20FDD7F0634FB85E.html',
    'https://news.mysteel.com/a/26100816/8EA7CECC3C24431F.html',
    'https://news.mysteel.com/a/26093020/5E65C6212387AE6C.html',
    'https://news.mysteel.com/a/26080617/1A2C5F9DB69E00EB.html',
)
BACKFILL_INVENTORY = (
    'https://gc.mysteel.com/a/25123123/0FD75A71554676A6.html',
    'https://gc.mysteel.com/a/26060417/F1501D7BBAE76A2F.html',
    'https://gc.mysteel.com/a/26061117/0DACC052D9E5B08C.html',
    'https://gc.mysteel.com/a/26061815/CCCC4DF83181BA99.html',
    'https://news.mysteel.com/a/26070915/8E981BDB5977E47C.html',
    'https://gc.mysteel.com/a/26071616/655FA0D511A402C4.html',
    'https://gc.mysteel.com/a/26072316/B83CBFA2F9A9888C.html',
)
BACKFILL_NBS = (
    '202403/t20240327_1948176.html',
    '202404/t20240427_1948752.html',
    '202405/t20240527_1954143.html',
    '202406/t20240627_1955196.html',
    '202407/t20240727_1955855.html',
    '202408/t20240827_1956106.html',
    '202409/t20240927_1956742.html',
    '202410/t20241027_1957183.html',
    '202411/t20241127_1957580.html',
    '202412/t20241227_1957913.html',
    '202501/t20250127_1958485.html',
    '202601/t20260127_1962382.html',
    '202404/t20240416_1948583.html',
    '202407/t20240715_1955616.html',
    '202410/t20241018_1957036.html',
    '202501/t20250117_1958324.html',
)
MYSTEEL_LISTS = (
    'https://tks.mysteel.com/datas/',
    'https://tks.mysteel.com/datas/article/pa4262,7073aaaaaa1.html',
    'https://gc.mysteel.com/',
    'https://m.mysteel.com/old/',
    'https://m.mysteel.com/hot/54638.html',
    'https://gc.mysteel.com/a/26110916/BC96C2E5100392DE.html',
)
MONTHLY = re.compile(r'(20\d{2})年\s*1\s*[—–－~至-]\s*(\d{1,2})月份?全国规模以上工业企业利润')
ANNUAL = re.compile(r'(20\d{2})年\s*全国规模以上工业企业利润')
QUARTERLY = re.compile(r'(20\d{2})年([一二三四])季度全国规模以上工业产能利用率')
NUMBER = r'([-−]?\d[\d,]*(?:\.\d+)?)'
WEEKLY = {
    'mill_profit': r'钢厂盈利率\s*(?:为\s*)?' + NUMBER + r'\s*%',
    'blast_furnace': r'高炉炼铁产能利用率\s*(?:为\s*)?' + NUMBER + r'\s*%',
    'hot_metal': r'日均\s*铁水产量\s*(?:为\s*)?' + NUMBER + r'\s*万吨',
}
INVENTORY = re.compile(r'五大(?:钢材(?:品种)?|品种(?:钢材)?)[\s：:]*'
                       r'(?:总库存|库存总量)(?:\s*为)?\s*' + NUMBER + r'\s*万吨')


def fetch(url):
    try:
        response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=(6, 12))
        response.raise_for_status()
        return BeautifulSoup(response.content, 'html.parser')
    except requests.RequestException as exc:
        print(f'Unable to read {url}: {exc}', flush=True)
        return None


def title_matches(title):
    return MONTHLY.search(title) or ANNUAL.search(title) or QUARTERLY.search(title) or any(
        phrase in title for phrase in ('钢厂高炉检修调查统计', '聚焦钢铁产业数据')
    )


def discover(url, soup):
    for anchor in soup.select('a[href]'):
        title = re.sub(r'^\s*\[\d{2}-\d{2}\]\s*', '', anchor.get_text(' ', strip=True))
        if not title_matches(title):
            continue
        target = urljoin(url, anchor['href'])
        parts = urlsplit(target)
        host = parts.hostname or ''
        if parts.scheme in ('http', 'https') and (
            host == 'www.stats.gov.cn' or (host.endswith('.mysteel.com') and re.search(r'/a/\d{8}/', parts.path))
        ):
            yield parts._replace(scheme='https', query='', fragment='').geturl()


def number(text):
    return float(text.replace(',', '').replace('−', '-').strip())


def month_end(year, month):
    return date(year, month, calendar.monthrange(year, month)[1]).isoformat()


def parse(url, soup):
    if not soup.title:
        return []
    title = soup.title.get_text(' ', strip=True)
    host = urlsplit(url).hostname or ''
    if host == 'www.stats.gov.cn':
        titles = [title, *(h.get_text(' ', strip=True) for h in soup.select('h1,h2,.title'))]
        headline = next((t for t in titles if MONTHLY.search(t) or QUARTERLY.search(t) or ANNUAL.search(t)), '')
        match = MONTHLY.search(headline) or QUARTERLY.search(headline)
        annual = ANNUAL.search(headline)
        if not match and not annual:
            return []
        year, period = match.groups() if match else (annual[1], '12')
        year = int(year)
        for tr in soup.select('tr'):
            cells = [td.get_text(' ', strip=True) for td in tr.find_all(['th', 'td'], recursive=False)]
            if cells and cells[0].strip() == INDUSTRY:
                if period.isdecimal() and len(cells) >= 7:
                    month = int(period)
                    return [('cumulative', month_end(year, month),
                             {'revenue': number(cells[1]), 'profit': number(cells[5]), 'url': url})]
                if period in '一二三四' and len(cells) >= 3:
                    month = ('一二三四'.index(period) + 1) * 3
                    utilization = number(cells[1])
                    if 0 <= utilization <= 100:
                        return [('capacity', month_end(year, month), {'value': utilization, 'url': url})]
        return []
    match = re.search(r'/a/(\d{6})\d{2}/', url)
    body = soup.select_one('.content-text')
    if not match or not body or not host.endswith('.mysteel.com'):
        return []
    day = datetime.strptime('20' + match[1], '%Y%m%d').date().isoformat()
    for element in body.select('.ai-summary'):
        element.decompose()
    text = body.get_text(' ', strip=True)
    if '钢厂高炉检修调查统计' in title:
        verified = re.search(r'247\s*家钢厂', text)
        if not verified:
            return []
        excerpt = text[verified.start():verified.start() + 420]
        values = {key: re.search(pattern, excerpt) for key, pattern in WEEKLY.items()}
        if all(values.values()):
            extracted = {key: number(found[1]) for key, found in values.items()}
            if all(0 <= extracted[key] <= 100 for key in ('mill_profit', 'blast_furnace')) and 100 < extracted['hot_metal'] < 400:
                return [(key, day, {'value': v, 'url': url}) for key, v in extracted.items()]
    if '聚焦钢铁产业数据' in title:
        match = INVENTORY.search(text)
        if match and 100 < number(match[1]) < 10000:
            return [('inventory', day, {'value': number(match[1]), 'url': url})]
    return []


def monthly_margin(cumulative):
    result = {}
    for day, current in sorted(cumulative.items()):
        year, month = int(day[:4]), int(day[5:7])
        previous = cumulative.get(month_end(year, month - 1)) if month > 2 else None
        if month < 2 or (month > 2 and previous is None):
            continue
        revenue = current['revenue'] - (previous['revenue'] if previous else 0)
        profit = current['profit'] - (previous['profit'] if previous else 0)
        if revenue > 0:
            result[day] = {'value': round(profit / revenue * 100, 4), 'period': f'{year}-01/02' if month == 2 else day[:7],
                           'revenue': round(revenue, 2), 'profit': round(profit, 2), 'url': current['url'],
                           **({'previous_url': previous['url']} if previous else {})}
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backfill', action='store_true')
    args = parser.parse_args()
    data = json.loads(PATH.read_text(encoding='utf-8')) if PATH.exists() else {}
    history = data.setdefault('history', {})
    today = datetime.now(TZ).date().isoformat()
    list_pages = 26 if args.backfill else 6
    lists = [NBS, *(f'{NBS}index_{i}.html' for i in range(1, list_pages)), *MYSTEEL_LISTS]
    if args.backfill:
        lists.extend(f'https://tks.mysteel.com/datas/article/pa4262,7073aaaaaa{i}.html' for i in range(2, 6))
        lists.extend(f'https://tks.mysteel.com/datas/article/pa4262a0311aaaaa{i}.html' for i in range(1, 6))
    with ThreadPoolExecutor(max_workers=6 if args.backfill else 4) as pool:
        links = set(SEEDS)
        if args.backfill:
            links.update(BACKFILL_INVENTORY)
            for path in BACKFILL_NBS:
                links.add(urljoin(NBS, path))
                links.add('https://www.stats.gov.cn/zwfwck/sjfb/' + path)
                links.add('https://www.stats.gov.cn/xxgk/sjfb/zxfb2020/' + path)
        for url, page in zip(lists, pool.map(fetch, lists)):
            if page:
                links.update(discover(url, page))
        previous_urls = {r['url'] for values in history.values() for r in values.values()}
        for depth in range(3 if args.backfill else 1):
            urls = sorted(links - previous_urls)
            if depth:
                urls = urls[:80]
            previous_urls.update(urls)
            for url, page in zip(urls, pool.map(fetch, urls)):
                if not page:
                    continue
                if args.backfill and 'mysteel.com' in urlsplit(url).netloc:
                    links.update(discover(url, page))
                try:
                    for key, day, record in parse(url, page):
                        if day <= today:
                            history.setdefault(key, {})[day] = record
                except (ValueError, IndexError) as exc:
                    print(f'Unexpected release format at {url}: {exc}', flush=True)
    history['margin'] = monthly_margin(history.get('cumulative', {}))
    data['checked'] = datetime.now(TZ).isoformat(timespec='seconds')
    write(PATH, data)
    for key, rows in sorted(history.items()):
        print(key, len(rows), max(rows, default='—'))


if __name__ == '__main__':
    main()
