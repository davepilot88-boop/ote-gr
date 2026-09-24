"""Read the verified OTE report schema, never guess numeric columns."""
import argparse
import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from openpyxl import load_workbook

PAGE = 'https://www.ote-cr.cz/cs/kratkodobe-trhy/elektrina/denni-trh'
ZONE = ZoneInfo('Europe/Prague')
ROOT = Path(__file__).resolve().parents[2]
SHEET = 'Výsledky denního trhu ČR'
HEADERS = ['Perioda', 'Časový interval', '15 min cena (EUR/MWh)', 'Množství (MWh)',
           'Nákup 15min produkty (MWh)', 'Nákup 60min produkty (MWh)',
           'Prodej 15min produkty (MWh)', 'Prodej 60min produkty (MWh)',
           'Saldo DT (MWh)', 'Export (MWh)', 'Import (MWh)', '60 min cena (EUR/MWh)']


class DataError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise DataError(message)


def norm(value):
    return ' '.join(str(value or '').split())


def periods(day):
    start = datetime.combine(day, datetime.min.time(), ZONE).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), ZONE).astimezone(timezone.utc)
    count = int((end-start).total_seconds() / 900)
    stamps = [(start + timedelta(minutes=15*i)).astimezone(ZONE) for i in range(count+1)]
    def label(t):
        if t.date() != day:
            return '24:00'
        suffix = ('b' if t.fold else 'a') if count == 100 and t.hour == 2 else ''
        return f'{t.hour:02}{suffix}:{t.minute:02}'
    return stamps, [f'{label(a)}-{label(b)}' for a,b in zip(stamps, stamps[1:])]


def number(value, address):
    require(type(value) in (int, float) and math.isfinite(value), f'Neplatná cena {address}: {value!r}')
    return float(value)


def parse_export(blob, day):
    book = load_workbook(BytesIO(blob), data_only=True, read_only=True)
    try:
        require(book.sheetnames == [SHEET], f'Neočekávané listy: {book.sheetnames}')
        ws = book[SHEET]
        rows = list(ws.values)
        stamp = day.strftime('%d.%m.%Y')
        require(rows[2][0] == f'SPOT MARKET INDEX - {stamp}', f'Datum A3 nesouhlasí: {rows[2][0]}')
        require(rows[19][0] == f'{SHEET} - {stamp}', f'Datum A20 nesouhlasí: {rows[19][0]}')
        require([norm(v) for v in rows[21]] == HEADERS, f'Změna hlaviček: {rows[21]}')
        require(all(v is None for v in rows[22]), 'Neočekávaný řádek 23')
        stamps, labels = periods(day)
        count = len(labels)
        require(len(rows) == 24+count, f'Počet řádků {len(rows)}, očekáváno {24+count}')
        require(rows[23+count][0] == 'Celkem', 'Chybí závěrečný řádek Celkem')
        data = rows[23:23+count]
        for i, row in enumerate(data):
            require(type(row[0]) in (int,float) and row[0] == i+1, f'Chybná perioda na řádku {24+i}')
            require(row[1] == labels[i], f'Chybný interval B{24+i}: {row[1]!r}, očekáváno {labels[i]}')
            number(row[2], f'C{24+i}')
            number(row[11], f'L{24+i}')
        prices, intervals = [], []
        for i in range(0,count,4):
            values = [number(r[11], f'L{24+i+j}') for j,r in enumerate(data[i:i+4])]
            require(len(set(values)) == 1, f'Neshodné 60min ceny v periodách {i+1}–{i+4}')
            mean = sum(Decimal(str(r[2])) for r in data[i:i+4])/4
            require(abs(mean-Decimal(str(values[0]))) <= Decimal('0.005'),
                    f'60min cena neodpovídá průměru 15min cen v periodách {i+1}–{i+4}: {values[0]} vs {mean}')
            prices.append(values[0])
            intervals.append({'start': stamps[i].isoformat(), 'end': stamps[i+4].isoformat(),
                              'label': labels[i].split('-')[0]+'–'+labels[i+3].split('-')[1]})
        if day == date(2026,3,29):
            for hour, expected in [(13,39.56),(14,18.10),(15,19.23)]:
                matches = [p for p,t in zip(prices,intervals) if datetime.fromisoformat(t['start']).hour == hour]
                require(matches == [expected], f'Sanity check {hour}:00: {matches} != {expected}')
        print(f'Datum={stamp}; list={SHEET}; sloupec=L [60 min cena (EUR/MWh)]; '
              f'čtvrthodiny={count}; ceny={len(prices)}; první={prices[0]}; poslední={prices[-1]}')
        return {'date': stamp, 'source': 'OTE', 'timezone': 'Europe/Prague',
                'prices': prices, 'intervals': intervals}
    finally:
        book.close()


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.text = [], []
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.append(dict(attrs).get('href',''))
    def handle_data(self, data):
        self.text.append(data)


def export_link(html, day):
    parser = PageParser()
    parser.feed(html)
    text = norm(' '.join(parser.text))
    found = re.findall(r'Výsledky denního trhu ČR\s*-\s*(\d{2}\.\d{2}\.\d{4})', text)
    expected = day.strftime('%d.%m.%Y')
    require(found and set(found) == {expected}, f'Datum HTML: {found}, požadováno {expected}')
    print(f'Datum HTML={expected}')
    links = set(urljoin(PAGE, href) for href in parser.links if 'DT_15MIN_' in href)
    absent = 'Pro zvolený filtr nejsou dostupná data' in text
    if absent and not links:
        return None
    require(not absent and len(links) == 1, f'Nejednoznačný export: {links}; bez dat={absent}')
    url = links.pop()
    exact = f'https://www.ote-cr.cz/pubweb/attachments/01/{day.year}/month{day:%m}/day{day:%d}/DT_15MIN_{day:%d_%m_%Y}_CZ.xlsx'
    require(url == exact, f'Nesprávný export pro datum: {url}')
    return url


def download(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent':'OTE-Cena/1.0'}), timeout=30) as response:
                blob = response.read(5_000_001)
                require(len(blob) <= 5_000_000, 'Export překročil limit 5 MB')
                return blob
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2**attempt)


def fetch_day(day):
    url = export_link(download(f'{PAGE}?date={day.isoformat()}').decode('utf-8'), day)
    if url is None:
        return None
    print(f'Stahuji XLSX: {url}')
    payload = parse_export(download(url), day)
    payload['exportUrl'] = url
    return payload


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)+'\n'
    if path.exists() and path.read_text(encoding='utf-8') == content:
        return
    temp = path.with_suffix('.json.tmp')
    temp.write_text(content, encoding='utf-8')
    os.replace(temp, path)
    print(f'Zápis: {path}')


def update(output, today, fetch=fetch_day):
    status = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'days': {}}
    pending, errors = {}, []
    for key, day in [('today',today), ('tomorrow',today+timedelta(days=1))]:
        state = {'date':day.strftime('%d.%m.%Y')}
        try:
            payload = fetch(day)
            if payload is None:
                require(key == 'tomorrow', 'Dnešní ceny chybí na OTE')
                state['state'] = 'unpublished'
                print(f'{key}: {day} zatím nezveřejněno; poslední JSON zůstává zachován')
            else:
                pending[key] = payload
                state['state'] = 'available'
        except Exception as exc:
            state.update(state='error', message=f'{type(exc).__name__}: {exc}')
            errors.append(f'{key} {day}: {state["message"]}')
            print(f'CHYBA: {errors[-1]}', file=sys.stderr)
        status['days'][key] = state
    # Only verified payloads are written. A failed day keeps its previous file intact.
    for key,payload in pending.items():
        atomic_json(output/f'{key}.json',payload)
    atomic_json(output/'status.json',status)
    return 1 if errors else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'data')
    args = parser.parse_args()
    sys.exit(update(args.output, datetime.now(ZONE).date()))
