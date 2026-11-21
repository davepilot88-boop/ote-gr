const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function day(date){const start=new Date(date+'T00:00:00+01:00');return {date:date.split('-').reverse().join('.'),source:'OTE',timezone:'Europe/Prague',prices:Array(24).fill(82),intervals:Array.from({length:24},(_,i)=>({start:new Date(+start+i*3600000).toISOString(),end:new Date(+start+(i+1)*3600000).toISOString(),label:`${String(i).padStart(2,'0')}:00–${String(i+1).padStart(2,'0')}:00`}))};}
function harness(fetcher,storage=new Map()){
 let now=Date.parse('2026-11-21T08:00:00+01:00');const timers=new Map(),intervals=[],elements=new Map(),docEvents={},winEvents={};let timerId=0;
 class Element {constructor(){this.children=[];this.events={};this.value='0';this.dataset={};this.style={};this.classList={toggle(){}};}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;}setAttribute(){}addEventListener(k,f){this.events[k]=f;}querySelectorAll(){return this.children.filter(x=>x.className?.startsWith('bar-col'));}}
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('feeInput').value='500';get('fxInput').value='25';
 const panels=[new Element()];const doc={hidden:false,getElementById:get,querySelectorAll:()=>panels,createElement:()=>new Element(),createTextNode:s=>s,addEventListener:(k,f)=>docEvents[k]=f};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const context={document:doc,window:{addEventListener:(k,f)=>winEvents[k]=f},Date:Clock,Intl,AbortController,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetch:fetcher,setTimeout:(f,ms)=>{timers.set(++timerId,{f,ms});return timerId;},clearTimeout:id=>timers.delete(id),setInterval:(f,ms)=>intervals.push({f,ms})};
 vm.runInNewContext(source,context);
 return {get,panels,doc,docEvents,winEvents,timers,storage,advance:ms=>now+=ms,intervals};
}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function response(value){return {ok:true,json:async()=>value};}
function state(state='available',date='21.11.2026'){return {checkedAt:'2026-11-21T07:00:00Z',days:{today:{date,state},tomorrow:{date:'22.11.2026',state}}};}
test('restore on pageshow/online; keep graph when network fails; never use previous day',async()=>{
 let fail=false,calls=0;const h=harness(async url=>{calls++;if(fail)throw Error('offline');return response(url.includes('status')?state():day('2026-11-21'));});await flush();
 assert.equal(h.panels[0].hidden,false);assert.match(h.get('status').textContent,/ověřeno/);
 h.advance(3000);h.winEvents.pageshow();await flush();assert.ok(calls>=4);
 fail=true;h.winEvents.online();await flush();assert.equal(h.panels[0].hidden,false);assert.match(h.get('status').textContent,/uložené ceny/);assert.ok([...h.timers.values()].some(t=>t.ms===15000));
 h.advance(24*3600000);h.winEvents.pageshow();await flush();assert.equal(h.panels[0].hidden,true);assert.equal(h.get('dateBadge').textContent,'22.11.2026');
});
test('repository fallback survives failed Pages deployment',async()=>{
 const h=harness(async url=>response(url.startsWith('data/')?(url.includes('status')?state('available','20.11.2026'):day('2026-11-20')):(url.includes('status')?state():day('2026-11-21'))));await flush();
 assert.equal(h.panels[0].hidden,false);assert.match(h.get('status').textContent,/záložní adresy/);
});
test('fresh unpublished tomorrow hides old data and graph',async()=>{
 const h=harness(async url=>response(url.includes('status')?state('unpublished'):day('2026-11-21')));await flush();h.get('tomorrowTab').events.click();await flush();
 assert.equal(h.panels[0].hidden,true);assert.match(h.get('status').textContent,/zatím nejsou zveřejněny/);
});
test('next day can reuse yesterday published tomorrow file',async()=>{
 const h=harness(async url=>response(url.includes('status')?state('available','20.11.2026'):day(url.includes('tomorrow')?'2026-11-21':'2026-11-20')));await flush();assert.equal(h.panels[0].hidden,false);assert.match(h.get('status').textContent,/Nejnovější kontrolu nelze potvrdit/);
});
test('persisted valid day remains visible offline after reopening',async()=>{
 const storage=new Map([['ote-verified-days',JSON.stringify([day('2026-11-21')])]]);const h=harness(async()=>{throw Error('offline');},storage);await flush();assert.equal(h.panels[0].hidden,false);assert.match(h.get('status').textContent,/Spojení se nezdařilo/);
});

