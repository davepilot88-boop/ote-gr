# OTE Cena

Malá statická aplikace pro čistou hodinovou cenu výkupu:
`spot EUR/MWh × ručně nastavený kurz EUR/CZK − poplatek Kč/MWh`.
Výchozí poplatek je 500 Kč/MWh, kurz 25 CZK/EUR. Nejde o celkový zisk FVE.
Nastavení se ukládá do localStorage. Červená je pod zvoleným limitem, oranžová
od limitu do limitu + 500 Kč/MWh, zelená od limitu + 500 Kč/MWh.
Počet skutečně ztrátových hodin se vždy počítá samostatně proti nule.

## Nasazení na existující GitHub Pages

1. Nahrajte změny do výchozí větve `main` (včetně skryté složky `.github`).
2. V **Settings → Pages → Build and deployment → Source** vyberte **GitHub Actions**.
3. Spusťte **Actions → Update OTE data → Run workflow**. Workflow také běží
   při změně `main` a každou hodinu v minutách 7 a 37, pokud jej GitHub nepozdrží.
4. Workflow uloží ověřené ceny a stav do repozitáře a explicitně nasadí Pages.
   Push pomocí `GITHUB_TOKEN` sám další Pages build nespouští, proto je součástí
   stejného workflow krok `deploy-pages`.

Token workflow potřebuje `contents: write`, `pages: write`, `id-token: write`.
Ochrana větve musí umožnit zápis dat tomuto workflow. Nasazení používá prostředí
`github-pages`; případná pravidla jeho schvalování zůstávají platná.

## Ověřený zdroj a schéma

Odkaz na konkrétní XLSX se čte ze stránky
`https://www.ote-cr.cz/cs/kratkodobe-trhy/elektrina/denni-trh?date=YYYY-MM-DD`.
Nesmí se zaměnit s exportem kurzů ČNB.

Skutečné soubory mají jediný list `Výsledky denního trhu ČR`, titulky s datem
v A3 a A20, hlavičky na řádku 22 (sloučené přes 23), data od řádku 24.
Sloupec A je perioda, B časový interval, C `15 min cena (EUR/MWh)`,
L `60 min cena (EUR/MWh)`. D–K jsou množství, produkty a toky, nikoliv ceny.
Parser ověřuje všech 12 hlaviček včetně jednotek. Při změně formátu selže.

Čte se publikovaná cena L, která musí být stejná na čtyřech po sobě jdoucích
čtvrthodinách. Nevybírají se libovolná čísla ani unikátní ceny a nepočítá se
množstevně vážený průměr. Není implementován tichý fallback na sloupec C.
Jako další kontrola musí publikovaná L souhlasit s prostým průměrem čtyř C
s tolerancí 0,005 EUR/MWh kvůli zaokrouhlení na dvě desetinná místa.
Ověřuje se datum HTML, přesná URL, oba titulky XLSX, počet řádků, navazující
periody, každý interval a konečné číselné ceny. Záporné ceny i nula jsou validní.

`prices` má obvykle 24 hodnot. Při změně času obsahuje skutečných 23/25,
`intervals` obsahuje stejně dlouhé pole `start`, `end`, `label`. Start/end jsou
ISO časy s UTC offsetem, časové pásmo je Europe/Prague. Podzimní 02a/02b jsou
dvě odlišné hodiny. Aktuální interval se hledá porovnáním skutečných časů,
nikoliv indexem pole ani místním časovým pásmem zařízení.

## Stav a zachování dat

`data/status.json` nese čas kontroly a stav každého požadovaného dne:
`available`, `unpublished` nebo `error`. `unpublished` se přijímá pouze pro
zítřek, pokud souhlasí datum HTML, chybí export a OTE výslovně uvádí
`Pro zvolený filtr nejsou dostupná data`. Výpadek HTTP nebo změna struktury
nejsou nezveřejněná data.

Při selhání jednoho dne zůstane jeho poslední validní JSON beze změny, druhý
ověřený den se může aktualizovat. Zápisy souborů jsou atomické. Na Pages se
nasadí i chybový stav a workflow poté skončí neúspěšně. Frontend nevydává
starý soubor za nové datum a odmítá stav starší než dvě hodiny. Při chybě
ukáže zprávu a skryje graf i statistiky, aby nepůsobily jako aktuální data.
Při nezveřejněném zítřku se původní soubor může zachovat se svým původním datem;
rozhodující pro zobrazení je aktuální stav a shoda data. Prázdné ceny se nepíší.

Log uvádí datum, URL exportu, list, sloupec, počet period a cen, první/poslední
cenu i cíl zápisu. Opakované síťové chyby se zkoušejí třikrát s timeoutem.

## Lokální kontrola

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
node --test tests/frontend.test.cjs
python .github/workflows/update_ote.py
python -m http.server 8000
```

Volitelné integrační testy skutečného prohlížeče:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser.cjs
```

`OTE_BROWSER_CHANNEL=msedge` dovoluje použít nainstalovaný Edge.
Integrační test používá lokální HTTP server a simulované odpovědi pro
nezveřejnění, chybu, staré datum, zápornou cenu a změny nastavení.
Produkční JSON soubory těmito simulacemi nepřepisuje.

Regresní XLSX ve `tests/fixtures` jsou skutečné soubory OTE:

- [29.03.2026, 23 hodin](https://www.ote-cr.cz/pubweb/attachments/01/2026/month03/day29/DT_15MIN_29_03_2026_CZ.xlsx):
  L72:L75 = 39,56; L76:L79 = 18,10; L80:L83 = 19,23 EUR/MWh.
- [30.03.2026, 24 hodin](https://www.ote-cr.cz/pubweb/attachments/01/2026/month03/day30/DT_15MIN_30_03_2026_CZ.xlsx).
- [26.10.2025, 25 hodin](https://www.ote-cr.cz/pubweb/attachments/01/2025/month10/day26/DT_15MIN_26_10_2025_CZ.xlsx).

Kontrolní ceny 29.03.2026 jsou také přímo v parseru jako kontrola tohoto data.
Testy mění datum, hlavičky, čísla a intervaly a ověřují odmítnutí dat i zachování
předchozích souborů při chybě. Výchozí vzhled a původní `graf.png` jsou zachovány.

iPhone: otevřete HTTPS adresu Pages v Safari a zvolte Přidat na plochu.
Aplikace má manifest, viewport a Apple metadata. Neobsahuje service worker;
offline data tedy nezobrazuje jako aktuální. Automatické kontroly mobilního
viewportu nenahrazují zkoušku instalace na fyzickém iPhonu.
