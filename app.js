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
  let active=null, retryTimer=null, failures=0, lastAttempt=0;
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
    const low=Math.min(0,min)*1.08,high=Math.max(0,max)*1.08||1,span=high-low,zero=high/span*100;
    [high,(high+low)/2,low].forEach(value=>{
      const line=document.createElement('span');line.className='grid-line';line.style.top=`${(high-value)/span*100}%`;
      const label=document.createElement('span');label.textContent=czk(value);line.append(label);chart.append(line);
    });
    const line=document.createElement('span');line.className='zero-line';line.style.top=`${zero}%`;chart.append(line);
    const detail=i=>{
      selectedBar=i;
      chart.querySelectorAll('.bar-col').forEach((col,j)=>{col.classList.toggle('chosen',j===i);col.setAttribute('aria-pressed',String(j===i));});
      const box=$('tooltip');box.replaceChildren();box.dataset.sign=net[i]<0?'negative':net[i]>0?'positive':'zero';
      const add=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;el.textContent=text;box.append(el);};
      add('div','detail-time',`${data.date} · ${data.intervals[i].label}${i===now?' · NYNÍ':''}`);
      add('div','detail-state',net[i]<0?'PRODEJ VE ZTRÁTĚ':net[i]>0?'PRODEJ V PLUSU':'NA NULE');
      add('div','detail-net',`${net[i]>0?'+':''}${czk(net[i])} Kč/MWh`);
      add('div','detail-caption','Čistý výsledek po poplatku za výkup');
      add('div','detail-spot',`OTE · hodinová cena (60 min): ${eur(data.prices[i])} EUR/MWh`);
      add('div','detail-formula',`${eur(data.prices[i])} × ${eur(s.fx)} − ${czk(s.fee)} = ${czk(net[i])} Kč/MWh`);
    };
    net.forEach((value,i)=>{
      const col=document.createElement('button');col.type='button';col.className='bar-col'+(i===now?' current':'');
      col.setAttribute('aria-label',`${data.intervals[i].label}: OTE ${eur(data.prices[i])} EUR/MWh, čistý výsledek ${czk(value)} Kč/MWh${i===now?', aktuální hodina':''}`);
      const bar=document.createElement('span');bar.className='bar '+color(value,s.threshold);
      bar.style.top=`${(high-Math.max(0,value))/span*100}%`;bar.style.height=`${Math.max(0.8,Math.abs(value)/span*100)}%`;
      const label=document.createElement('span');label.className='bar-label';label.textContent=i%3===0 || i===net.length-1?data.intervals[i].label.split(':')[0]:'';
      col.append(bar,label);chart.append(col);
      col.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')detail(i);});
      ['focus','click'].forEach(event=>col.addEventListener(event,()=>detail(i)));
      col.addEventListener('keydown',event=>{
        let next=i;
        if(event.key==='ArrowRight')next=Math.min(net.length-1,i+1);
        else if(event.key==='ArrowLeft')next=Math.max(0,i-1);
        else return;
        event.preventDefault();chart.querySelectorAll('.bar-col')[next].focus();detail(next);
      });
    });
    const selectAt=x=>{
      const cols=chart.querySelectorAll('.bar-col');
      let index=0,distance=Infinity;
      cols.forEach((col,i)=>{const r=col.getBoundingClientRect();const d=Math.abs(x-r.left-r.width/2);if(d<distance){distance=d;index=i;}});
      detail(index);
    };
    let activePointer=null;
    chart.onpointerdown=event=>{if(event.isPrimary===false || event.button!==0)return;activePointer=event.pointerId;chart.setPointerCapture(event.pointerId);selectAt(event.clientX);};
    chart.onpointermove=event=>{if(event.pointerId===activePointer)selectAt(event.clientX);};
    chart.onpointerup=chart.onpointercancel=event=>{if(event.pointerId===activePointer){activePointer=null;if(chart.hasPointerCapture(event.pointerId))chart.releasePointerCapture(event.pointerId);}};
    chart.onlostpointercapture=()=>{activePointer=null;};
    // Capture retargets the click to the chart; the chosen hour remains selected.
    detail(selectedBar!==null && selectedBar<net.length?selectedBar:now>=0?now:0);
    $('nowSelection').hidden=now<0;
    $('nowSelection').onclick=()=>detail(now);
    $('nowSelection').onpointerup=()=>detail(now);
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
  async function readJSON(path, signal) {
    const request=new AbortController();
    const abort=()=>request.abort();
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)request.abort();
    const timer=setTimeout(abort,8000);
    try {
      const response=await fetch(path+(path.includes('?')?'&':'?')+'_='+Date.now(),{cache:'no-store',signal:request.signal});
      if(!response.ok) throw Error(`Data nejsou dostupná (HTTP ${response.status}).`);
      return await response.json();
    } finally {clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }
  function cached(expected) {
    if(data?.date===expected) return data;
    try {
      const records=JSON.parse(localStorage.getItem('ote-verified-days')||'[]');
      return validateData(records.find(p=>p.date===expected),expected);
    } catch { return null; }
  }
  function remember(payload) {
    try {
      const records=JSON.parse(localStorage.getItem('ote-verified-days')||'[]');
      localStorage.setItem('ote-verified-days',JSON.stringify([payload,...records.filter(p=>p.date!==payload.date)].slice(0,3)));
    } catch {}
  }
  async function load() {
    clearTimeout(retryTimer);
    active?.abort();
    const controller=new AbortController();active=controller;
    const token=++sequence,key=selected,expected=dateKey(new Date(),key==='tomorrow'?1:0);
    const oldDate=data?.date;
    data=cached(expected);
    if(oldDate!==expected) selectedBar=null;
    loadedDate=dateKey();lastAttempt=Date.now();$('dateBadge').textContent=expected;
    render();
    $('status').textContent=data?'Obnovuji data · zobrazuji uložené ceny pro tento den.':'Načítám ceny OTE…';
    // AbortController also works on older iPhones without AbortSignal.timeout.
    const timeout=setTimeout(()=>controller.abort(),25000);
    let lastError;
    try {
      // The repository is a second route to the same validated publisher output,
      // independent of a failed GitHub Pages deployment.
      for(const base of ['data/','https://raw.githubusercontent.com/davepilot88-boop/ote-gr/main/data/']) {
        try {
          const [stateResult,payloadResult]=await Promise.allSettled([
            readJSON(base+'status.json',controller.signal),
            readJSON(base+key+'.json',controller.signal)
          ]);
          if(token!==sequence)return;
          const state=stateResult.status==='fulfilled'?stateResult.value:null;
          const day=state?.days?.[key],age=Date.now()-Date.parse(state?.checkedAt);
          const fresh=day?.date===expected&&Number.isFinite(age)&&age>=-300000&&age<=2*3600000;
          if(fresh&&day.state==='unpublished'&&key==='tomorrow') {
            data=null;showResults(false);failures=0;
            $('status').textContent='Zítřejší ceny zatím nejsou zveřejněny.';return;
          }
          let payload=payloadResult.status==='fulfilled'?payloadResult.value:null;
          // At midnight the last published tomorrow file can already contain today.
          if(payload?.date!==expected&&key==='today') payload=await readJSON(base+'tomorrow.json',controller.signal);
          data=validateData(payload,expected);
          remember(data);render();failures=0;
          const confirmed=fresh&&day.state==='available';
          $('status').textContent=confirmed
            ? `OTE · ověřeno ${new Date(state.checkedAt).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'})}`
            : 'OTE · poslední uložené ceny pro tento den. Nejnovější kontrolu nelze potvrdit.';
          if(base!=='data/') $('status').textContent+=' · Načteno ze záložní adresy.';
          if(data.prices.length!==24) $('status').textContent+=` · Změna času: ${data.prices.length} hodin.`;
          return;
        } catch(error) {lastError=error;if(controller.signal.aborted)break;}
      }
      throw lastError||Error('Data nejsou dostupná.');
    } catch(error) {
      if(token!==sequence)return;
      data=cached(expected);render();
      $('status').textContent=data
        ? 'Spojení se nezdařilo. Zobrazuji uložené ceny pro tento den; aktualizaci automaticky zopakuji.'
        : 'Ceny pro tento den se nepodařilo načíst. Aktualizaci automaticky zopakuji po obnovení spojení.';
      failures++;
      if(!document.hidden) retryTimer=setTimeout(load,Math.min(300000,15000*2**Math.min(failures-1,4)));
    } finally {
      clearTimeout(timeout);
      if(token===sequence)active=null;
    }
  }
  ['today','tomorrow'].forEach(key=>$(key+'Tab').addEventListener('click',()=>{
    selected=key;['today','tomorrow'].forEach(k=>$(k+'Tab').setAttribute('aria-pressed',String(k===key)));load();
  }));
  Object.values(fields).forEach(id=>$(id).addEventListener('input',render));
  $('refresh').addEventListener('click',load);
  function resume() {
    if(document.hidden)return;
    // Coalesce pageshow/focus/visibility events but replace a suspended request.
    if(active||Date.now()-lastAttempt>2000||loadedDate!==dateKey())load();
  }
  setInterval(()=>{
    if(document.hidden)return;
    if(loadedDate!==dateKey()||Date.now()-lastAttempt>=5*60000)load();
    else if(data)render();
  },30000);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){active?.abort();clearTimeout(retryTimer);}else resume();
  });
  window.addEventListener('pageshow',resume);
  window.addEventListener('focus',resume);
  window.addEventListener('online',()=>{if(!document.hidden)load();});
  load();
}
