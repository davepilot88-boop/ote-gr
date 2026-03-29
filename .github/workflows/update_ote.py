import json
import re
from datetime import datetime, timedelta
import requests
from pathlib import Path

URL = "https://www.ote-cr.cz/cs/kratkodobe-trhy/elektrina/denni-trh"

html = requests.get(URL).text

date_match = re.search(r"(\d{2}\.\d{2}\.\d{4})", html)
date = date_match.group(1)

lines = html.split("\n")
rows = [l for l in lines if re.match(r"\d{2}:\d{2}-\d{2}:\d{2}", l)]

prices = []
for i in range(0, len(rows), 4):
    nums = re.findall(r"-?\d+,\d+", rows[i])
    if nums:
        prices.append(float(nums[-1].replace(",", ".")))

data = {
    "date": date,
    "source": "OTE",
    "prices": prices[:24]
}

today = datetime.now().date()
tomorrow = today + timedelta(days=1)

page_date = datetime.strptime(date, "%d.%m.%Y").date()

path = Path("data")
path.mkdir(exist_ok=True)

if page_date == today:
    (path / "today.json").write_text(json.dumps(data))
else:
    (path / "tomorrow.json").write_text(json.dumps(data))
