// Optional integration checks: npm install --no-save playwright; node tests/browser.cjs
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.join(root,decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(body);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.OTE_BROWSER_CHANNEL?{channel:process.env.OTE_BROWSER_CHANNEL}:{})});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    let today=JSON.parse(fs.readFileSync(path.join(root,'data/today.json')));
    const tomorrow=JSON.parse(fs.readFileSync(path.join(root,'data/tomorrow.json')));
    let fixed=new Date(today.intervals[13].start).getTime()+1800000;
    await page.clock.install({time:fixed});
    let mode='valid';
    await page.route('**/data/*.json',async route=>{
      const name=new URL(route.request().url()).pathname.split('/').pop();
      if(mode==='network'){await route.fulfill({status:503,body:'OTE failure'});return;}
      const state={checkedAt:new Date(fixed).toISOString(),days:{today:{date:today.date,state:'available'},tomorrow:{date:tomorrow.date,state:mode==='unpublished'?'unpublished':mode==='error'?'error':'available'}}};
      let payload=name==='status.json'?state:name==='today.json'?structuredClone(today):structuredClone(tomorrow);
      if(mode==='negative' && name==='today.json')payload.prices[0]=-10;
      if(mode==='stale' && name==='tomorrow.json')payload.date=today.date;
      await route.fulfill({json:payload});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('.bar-col').first().waitFor();
    assert.equal(await page.locator('.bar-col').count(),24);
    assert.equal(await page.locator('.current').count(),1);
    await page.locator('.bar-col').first().tap();
    assert.match(await page.locator('#tooltip').innerText(),/EUR\/MWh.*Kč\/MWh/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#tomorrowTab').tap();await page.waitForFunction(()=>document.querySelectorAll('.bar-col').length===24 && !document.querySelector('.current'));
    assert.equal(await page.locator('#nowNetVal').innerText(),'–');
    mode='unpublished';await page.locator('#refresh').tap();await page.getByText('Zítřejší ceny zatím nejsou zveřejněny.',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-results]:visible').count(),0);
    mode='error';await page.locator('#refresh').tap();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Aktualizace OTE selhala'));
    mode='stale';await page.locator('#refresh').tap();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('zastaralé ceny'));
    mode='network';await page.locator('#refresh').tap();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('HTTP 503'));
    mode='negative';await page.locator('#todayTab').tap();await page.locator('[data-results]:visible').first().waitFor();
    await page.locator('.bar-col').first().tap();assert.match(await page.locator('#tooltip').innerText(),/-750/);
    await page.locator('#feeInput').fill('600');await page.locator('#fxInput').fill('20');
    assert.match(await page.locator('#tooltip').innerText(),/-800/);
    await page.locator('#thresholdInput').fill('100');
    assert.equal(await page.locator('.bar-col .bad').count()>0,true);
    await page.locator('#fxInput').fill('0');assert.equal(await page.locator('[data-results]:visible').count(),0);
    await page.locator('#fxInput').fill('25');await page.locator('#feeInput').fill('500');
    mode='valid';await page.locator('#thresholdInput').fill('0');await page.locator('#refresh').tap();await page.locator('[data-results]:visible').first().waitFor();
    await page.locator('.bar-col').nth(13).tap();
    await page.screenshot({path:process.env.OTE_SCREENSHOT || path.join(root,'../ote-iphone.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:900});
    await page.locator('.bar-col').nth(4).hover();assert.match(await page.locator('#tooltip').innerText(),/04:00/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    for(const [file,count] of [['spring.json',23],['autumn.json',25]]){
      today=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',file)));
      fixed=Date.parse(today.intervals[3].start)+1800000;
      await page.clock.setSystemTime(fixed);
      await page.locator('#refresh').click();
      await page.waitForFunction(n=>document.querySelectorAll('.bar-col').length===n,count);
      assert.equal(await page.locator('.current').count(),1);
      assert.equal(await page.locator('.current').getAttribute('aria-label').then(t=>t.includes(today.intervals[3].label)),true);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: today, tomorrow, unpublished, OTE failure, stale date, HTTP failure, negative prices, settings, iPhone touch, desktop hover, no overflow or JS errors');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
