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

html = requests.get(URL, timeout=30).text

m = re.search(r"Výsledky denního trhu ČR\s*-\s*(\d{2}\.\d{2}\.\d{4})", html)
if not m:
    raise SystemExit("Na stránce OTE jsem nenašel datum.")
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
    raise SystemExit(f"Nepodařilo se získat 24 hodinových cen. Našel jsem jen {len(prices)}.")

payload = {
    "date": page_date.strftime("%d.%m.%Y"),
    "source": "OTE veřejná stránka",
    "prices": prices,
}

today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
tomorrow = today + timedelta(days=1)

if page_date.date() == today.date():
    (ROOT / "today.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
elif page_date.date() == tomorrow.date():
    (ROOT / "tomorrow.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
else:
    (ROOT / "tomorrow.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

print("Hotovo.")
