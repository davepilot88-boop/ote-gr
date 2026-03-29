name: Update OTE data

on:
  workflow_dispatch:
  schedule:
    - cron: "*/30 * * * *"

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install deps
        run: pip install requests beautifulsoup4 lxml

      - name: Fetch and save OTE data
        run: python .github/workflows/update_ote.py

      - name: Commit changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/today.json data/tomorrow.json
          git diff --cached --quiet || git commit -m "Update OTE data"
          git push
