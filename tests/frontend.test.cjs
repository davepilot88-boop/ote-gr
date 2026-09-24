const {test}=require('node:test');
const assert=require('node:assert/strict');
const {dateKey,validateData,calculate,color,currentIndex,settingsValid}=require('../app.js');
const fs=require('node:fs');
test('Prague day boundaries independent of device timezone',()=>{
  assert.equal(dateKey(new Date('2026-03-29T22:01:00Z')),'30.03.2026');
  assert.equal(dateKey(new Date('2026-12-31T23:01:00Z'),1),'02.01.2027');
});
test('negative spot, fee and exchange changes',()=>{
  assert.deepEqual(calculate([-10,0,39.56],500,25),[-750,-500,489]);
  assert.deepEqual(calculate([-10,0,39.56],600,20),[-800,-600,191.20000000000005]);
  assert.equal(color(-1,0),'bad');assert.equal(color(0,0),'warn');assert.equal(color(500,0),'good');
  assert.equal(settingsValid({fee:500,fx:0,threshold:0}),false);
});
test('real normal, spring and autumn payloads',()=>{
  for(const file of ['normal.json','spring.json','autumn.json']) {
    const p=JSON.parse(fs.readFileSync(`${__dirname}/fixtures/${file}`));
    assert.equal(validateData(p,p.date),p);
    p.intervals.forEach((t,i)=>assert.equal(currentIndex(p,Date.parse(t.start)+1),i));
    assert.equal(currentIndex(p,Date.parse(p.intervals.at(-1).end)),-1);
    assert.throws(()=>validateData(p,'01.01.2000'));
    assert.throws(()=>validateData({...p,prices:p.prices.map(()=>null)},p.date));
    assert.throws(()=>validateData({...p,intervals:p.intervals.slice(1)},p.date));
  }
});
