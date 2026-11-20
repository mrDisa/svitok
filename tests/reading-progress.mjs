import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function goalSession(data = new Map()) {
  const source = fs.readFileSync(new URL('../onboarding.js',import.meta.url),'utf8');
  const ctx = vm.createContext({store:{get:(k,d)=>data.get(k)??d,set:(k,v)=>data.set(k,v)},$:()=>null,toast(){}});
  vm.runInContext(source.slice(0,source.indexOf('const PushOnboarding'))+'\nthis.goal=Goal;',ctx);
  return ctx.goal;
}
test('один стих учитывается один раз за сессию, даже после перечитывания прогресса', () => {
  const goal=goalSession();goal.count('verse-a');goal.count('verse-a');
  assert.equal(goal.stats().n,1);
  goal.reload();goal.count('verse-a');goal.count('verse-b');
  assert.equal(goal.stats().n,2);
});
test('новый запуск допускает повторное чтение; стих без ID не засчитывается', () => {
  const data=new Map();const a=goalSession(data);a.count('verse-a');a.count();
  assert.equal(a.stats().n,1);
  const b=goalSession(data);b.count('verse-a');assert.equal(b.stats().n,2);
});
test('карточка активного плана открывает обзор, чтение запускается отдельной кнопкой', () => {
  const source=fs.readFileSync(new URL('../plans.js',import.meta.url),'utf8');
  const data=new Map([['plans',{john21:{started:Date.now(),done:[0]}}]]);
  const root={innerHTML:'',scrollTop:0};const opened=[];
  const books=JSON.parse(fs.readFileSync(new URL('../data/books.json',import.meta.url),'utf8'));
  const ctx=vm.createContext({
    store:{get:(k,d)=>data.get(k)??d,set:(k,v)=>data.set(k,v)}, BOOKS:books,
    bibleEl:()=>root,bibleRoute:{},esc:String,plural:()=>'',I:{back:'',next:''},$:()=>null,
    openChapter:(...args)=>opened.push(args),chLabel:()=>'',
  });
  vm.runInContext(source+'\nthis.plans=Plans;',ctx);
  function click(selector, dataset){return ctx.plans.onClick({target:{closest:s=>s===selector?{dataset}:null}});}
  click('[data-plan-read]',{planRead:'john21'});
  assert.match(root.innerHTML,/Евангелие от Иоанна/);assert.match(root.innerHTML,/data-plan-day="1"/);
  assert.equal(opened.length,0);assert.equal(ctx.bibleRoute.view,'plan');
  click('[data-plan-day]',{planId:'john21',planDay:'1'});
  assert.deepEqual(opened,[[42,2]]);
});

test('возврат к уже просмотренной карточке ленты не увеличивает счётчик второй раз', () => {
  const goal=goalSession();let clock=0;
  const card=key=>({dataset:{key},classList:{add(){},remove(){}}});
  const a=card('a'),b=card('b');const cards=[a,b,...Array.from({length:6},(_,i)=>card('extra'+i))];
  const ctx=vm.createContext({
    activeCard:null,activeSince:0,performance:{now:()=>clock},Goal:goal,currentTopic:'hope',
    cardItems:new Map([['a',{id:'verse-a'}],['b',{id:'verse-b'}]]),
    S:{hinted:true},feedEl:()=>({}),$$:()=>cards,syncScenes(){},
  });
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  vm.runInContext(source.slice(source.indexOf('function onCardActive('),source.indexOf('function toggleLike(')),ctx);
  ctx.onCardActive(a);clock=3000;ctx.onCardActive(b);assert.equal(goal.stats().n,1);
  clock=6000;ctx.onCardActive(a);clock=9000;ctx.onCardActive(b);
  assert.equal(goal.stats().n,2);
});
