import json
import re
from datetime import datetime, timedelta
from pathlib import Path

import requests

URL = "https://www.ote-cr.cz/cs/kratkodobe-trhy/elektrina/denni-trh"
ROOT = Path("data")
ROOT.mkdir(exist_ok=True)

def parse_date(s: str) -> datetime:
    return datetime.strptime(s, "%d.%m.%Y")

def fmt_date(d: datetime) -> str:
    return d.strftime("%d.%m.%Y")

html = requests.get(URL, timeout=30).text

m = re.search(r"Výsledky denního trhu ČR\s*-\s*(\d{2}\.\d{2}\.\d{4})", html)
if not m:
    raise SystemExit("Date not found on OTE page")
page_date = parse_date(m.group(1))

lines = [ln.strip() for ln in html.splitlines() if ln.strip()]
quarter_rows = [ln for ln in lines if re.match(r"^\d{2}:\d{2}-\d{2}:\d{2}\s", ln)]

prices = []
if len(quarter_rows) >= 96:
    for i in range(0, 96, 4):
        row = quarter_rows[i]
        nums = re.findall(r"-?\d[\d\s]*,\d+", row)
        if nums:
            prices.append(float(nums[-1].replace(" ", "").replace(",", ".")))

if len(prices) != 24:
    raise SystemExit(f"Expected 24 hourly prices, got {len(prices)}")

payload = {
    "date": fmt_date(page_date),
    "source": "OTE veřejná stránka",
    "prices": prices,
}

today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
tomorrow = today + timedelta(days=1)

target = None
if page_date.date() == today.date():
    target = ROOT / "today.json"
elif page_date.date() == tomorrow.date():
    target = ROOT / "tomorrow.json"
else:
    # keep latest page as tomorrow.json if it's ahead
    target = ROOT / "tomorrow.json"

target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote {target}")
