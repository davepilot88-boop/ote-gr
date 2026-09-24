/* Plain browser JS; exported pure functions also support the node regression tests. */
function dateKey(now = new Date(), offset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get = key => parts.find(p=>p.type===key).value;
  const day = new Date(Date.UTC(+get('year'), +get('month')-1, +get('day')+offset));
  return `${String(day.getUTCDate()).padStart(2,'0')}.${String(day.getUTCMonth()+1).padStart(2,'0')}.${day.getUTCFullYear()}`;
}
function validateData(data, expected) {
  if (!data || data.date !== expected || data.source !== 'OTE' || data.timezone !== 'Europe/Prague' ||
      !Array.isArray(data.prices) || ![23,24,25].includes(data.prices.length) ||
      !data.prices.every(p=>typeof p==='number' && Number.isFinite(p)) ||
      !Array.isArray(data.intervals) || data.intervals.length !== data.prices.length) throw Error('Neplatné nebo zastaralé ceny OTE.');
  let last;
  const clock = t => new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t));
  data.intervals.forEach((period,i)=>{
    const start=Date.parse(period.start), end=Date.parse(period.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end-start!==3600000 ||
        (i>0 && start!==last) || dateKey(new Date(start))!==expected ||
        !/^\d{2}[ab]?:00–\d{2}[ab]?:00$/.test(period.label) ||
        (i===0 && clock(start)!=='00:00')) throw Error('Neplatné hodinové intervaly.');
    last=end;
  });
  if (clock(last)!=='00:00' || dateKey(new Date(last))===expected) throw Error('Neúplný den.');
  return data;
}
function calculate(prices, fee, fx) { return prices.map(p=>p*fx-fee); }
function color(value, threshold) { return value<threshold?'bad':value<threshold+500?'warn':'good'; }
function currentIndex(data, now=Date.now()) { return data.intervals.findIndex(p=>Date.parse(p.start)<=now && now<Date.parse(p.end)); }
function settingsValid(s) { return Object.values(s).every(Number.isFinite) && s.fee>=0 && s.fx>0; }
if (typeof module !== 'undefined') module.exports={dateKey,validateData,calculate,color,currentIndex,settingsValid};

if (typeof document !== 'undefined') {
  const $=id=>document.getElementById(id);
  let selected='today', data=null, sequence=0, loadedDate='', selectedBar=null;
  const eur=v=>v.toLocaleString('cs-CZ',{minimumFractionDigits:2,maximumFractionDigits:2});
  const czk=v=>v.toLocaleString('cs-CZ',{maximumFractionDigits:0});
  const fields={fee:'feeInput',fx:'fxInput',threshold:'thresholdInput'};
  try {
    const saved=JSON.parse(localStorage.getItem('ote-settings'));
    if(saved && settingsValid(saved)) Object.entries(fields).forEach(([key,id])=>$(id).value=saved[key]);
  } catch {}
  function inputs() {
    const settings=Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,$(id).value.trim()===''?NaN:Number($(id).value)]));
    const valid=settingsValid(settings);
    $('inputError').textContent=valid?'':'Zadejte platná čísla: kurz musí být kladný a poplatek nezáporný.';
    if(valid) {try{localStorage.setItem('ote-settings',JSON.stringify(settings));}catch{}}
    return valid?settings:null;
  }
  function showResults(show) { document.querySelectorAll('[data-results]').forEach(el=>el.hidden=!show); }
  function render() {
    const s=inputs();
    showResults(Boolean(s && data));
    if(!s || !data) return;
    const net=calculate(data.prices,s.fee,s.fx), min=Math.min(...net),max=Math.max(...net);
    const now=selected==='today' && data.date===dateKey()?currentIndex(data):-1;
    $('minNetVal').textContent=`${czk(min)} Kč/MWh`;
    $('maxNetVal').textContent=`${czk(max)} Kč/MWh`;
    $('avgNetVal').textContent=`${czk(net.reduce((a,b)=>a+b,0)/net.length)} Kč/MWh`;
    $('nowNetVal').textContent=now<0?'–':`${czk(net[now])} Kč/MWh`;
    const chart=$('chart'); chart.replaceChildren();
    const low=Math.min(0,min),high=Math.max(0,max),span=high-low||1,zero=high/span*100;
    const line=document.createElement('span');line.className='zero-line';line.style.top=`calc(12px + ${zero/100*236}px)`;chart.append(line);
    const detail=i=>{
      selectedBar=i;
      $('tooltip').textContent=`${data.intervals[i].label} · OTE ${eur(data.prices[i])} EUR/MWh · Čistý výsledek ${czk(net[i])} Kč/MWh`;
    };
    net.forEach((value,i)=>{
      const col=document.createElement('button');col.type='button';col.className='bar-col'+(i===now?' current':'');
      col.setAttribute('aria-label',`${data.intervals[i].label}: OTE ${eur(data.prices[i])} EUR/MWh, čistý výsledek ${czk(value)} Kč/MWh${i===now?', aktuální hodina':''}`);
      const bar=document.createElement('span');bar.className='bar '+color(value,s.threshold);
      bar.style.top=`${(high-Math.max(0,value))/span*100}%`;bar.style.height=`${Math.max(0.8,Math.abs(value)/span*100)}%`;
      const label=document.createElement('span');label.className='bar-label';label.textContent=data.intervals[i].label.split(':')[0];
      col.append(bar,label);chart.append(col);
      ['pointerenter','focus','click'].forEach(event=>col.addEventListener(event,()=>detail(i)));
    });
    if(selectedBar!==null && selectedBar<net.length) detail(selectedBar);
    else $('tooltip').textContent='Klepněte na sloupec nebo na něj najeďte myší pro detail.';
    const summary=[['Nejhorší hodina',`${data.intervals[net.indexOf(min)].label} (${czk(min)} Kč/MWh)`],
      ['Nejlepší hodina',`${data.intervals[net.indexOf(max)].label} (${czk(max)} Kč/MWh)`],
      ['Hodin pod zvoleným limitem',`${net.filter(v=>v<s.threshold).length} hod. pod ${czk(s.threshold)} Kč/MWh`],
      ['Skutečně ztrátové hodiny',`${net.filter(v=>v<0).length} hod. pod 0 Kč/MWh`]];
    $('summary').replaceChildren(...summary.map(([title,value])=>{
      const item=document.createElement('div');item.className='summary-item';const strong=document.createElement('strong');strong.textContent=title;item.append(strong,document.createTextNode(value));return item;
    }));
    $('priceTable').replaceChildren(...data.prices.map((spot,i)=>{
      const tr=document.createElement('tr');[data.intervals[i].label,eur(spot),czk(net[i])].forEach((v,j)=>{
        const td=document.createElement('td');td.textContent=v;if(j===2)td.className={bad:'red',warn:'orange',good:'green'}[color(net[i],s.threshold)];tr.append(td);
      });return tr;
    }));
  }
  async function readJSON(path) {
    const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw Error(`Data nejsou dostupná (HTTP ${response.status}).`);
    return response.json();
  }
  async function load() {
    const token=++sequence,key=selected,expected=dateKey(new Date(),key==='tomorrow'?1:0);
    data=null;selectedBar=null;showResults(false);loadedDate=dateKey();$('dateBadge').textContent=expected;
    $('status').textContent='Načítám ceny OTE…';
    try {
      const state=await readJSON('data/status.json');
      if(token!==sequence)return;
      const day=state.days?.[key],age=Date.now()-Date.parse(state.checkedAt);
      if(!day || day.date!==expected || !Number.isFinite(age) || age>2*3600000 || age< -300000) throw Error('Aktualizace dat je zastaralá. Dostupnost cen nelze potvrdit.');
      if(day.state==='unpublished' && key==='tomorrow') {$('status').textContent='Zítřejší ceny zatím nejsou zveřejněny.';return;}
      if(day.state!=='available') throw Error('Aktualizace OTE selhala. Poslední validní soubor zůstal zachován.');
      const payload=await readJSON(`data/${key}.json`);
      if(token!==sequence)return;
      data=validateData(payload,expected);
      $('status').textContent=`OTE · ověřeno ${new Date(state.checkedAt).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'})}${data.prices.length!==24?` · Změna času: ${data.prices.length} hodin. Označení a/b rozlišuje opakovanou hodinu.`:''}`;
      render();
    } catch(error) {if(token===sequence){data=null;showResults(false);$('status').textContent=`Ceny nelze zobrazit. ${error.message}`;}}
  }
  ['today','tomorrow'].forEach(key=>$(key+'Tab').addEventListener('click',()=>{
    selected=key;['today','tomorrow'].forEach(k=>$(k+'Tab').setAttribute('aria-pressed',String(k===key)));load();
  }));
  Object.values(fields).forEach(id=>$(id).addEventListener('input',render));
  $('refresh').addEventListener('click',load);
  setInterval(()=>{if(loadedDate!==dateKey())load();else render();},60000);
  setInterval(load,5*60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
  load();
}
