import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const file = fs.readFileSync(new URL('../onboarding.js', import.meta.url),'utf8');
const source = file.slice(file.indexOf('const PushOnboarding ='),file.indexOf('/* ---------------- слово дня:'));
function fixture({ saved = new Map(), connected = false, ok = true, install = false, result = true } = {}) {
  const events = {}; const attrs = {};
  const classes = { add(){}, remove(){} };
  const root = { hidden:true, dataset:{}, innerHTML:'', classList:classes,
    addEventListener: (name,fn) => { (events[name] ||= []).push(fn); },
    setAttribute: (name,value) => {attrs[name]=value;}, removeAttribute: name => {delete attrs[name];},
    querySelector: () => ({focus(){},classList:classes}),
  };
  let calls=0;
  const state = { connected, ok, install, why:'Установите приложение',hint:'Не удалось подключиться. Повторите.' };
  const location={href:''};
  const ctx = vm.createContext({
    $: () => root, store:{get:(k,d)=>saved.get(k)??d,set:(k,v)=>saved.set(k,v)},
    Reminders:{onboardingState:()=>({...state}),activate:async()=>{calls++;return result;}},
    svg:()=>'<svg></svg>',esc:String,location,
    Goal:{goal:10,setGoal(){}},DailyWord:{key:()=> '2026-11-18'},I:{},TOPICS:[],S:{weights:{}},persist:{weights(){}},
    setTimeout:fn=>fn(),
  });
  vm.runInContext(source+'\nthis.push = PushOnboarding; this.intro = Onboarding;',ctx);
  return {root,saved,state,location,get calls(){return calls;},
    start:()=>ctx.intro.init(),show:()=>ctx.push.maybeShow(),reconcile:()=>ctx.push.reconcile(),
    async click(action){const button={dataset:{pushOnboarding:action}};const event={target:{closest:s=>s==='button[data-push-onboarding]'?button:null}};for(const fn of events.click||[]) await fn(event);},
    async skipIntro(){for(const fn of events.click||[]) await fn({target:{closest:s=>s==='[data-skip]'?{}:null}});},
  };
}
test('новый пользователь видит сначала знакомство, затем уведомления даже после пропуска',async()=>{
  const f=fixture(); f.start();
  assert.match(f.root.innerHTML,/Добро пожаловать/);
  assert.equal(f.saved.has('pushOnboardingRevision'),false);
  assert.equal(f.calls,0);
  await f.skipIntro();
  assert.match(f.root.innerHTML,/Оставайтесь на связи/);
  assert.equal(f.saved.get('onboarded'),true);
  assert.equal(f.calls,0);
});
test('существующий пользователь видит предложение ровно один раз после обновления',async()=>{
  const saved=new Map([['onboarded',true]]);
  const f=fixture({saved}); f.start();
  assert.equal(f.root.dataset.pushOnboarding,'1');
  await f.click('close'); assert.equal(f.root.hidden,true);
  const again=fixture({saved}); again.start();
  assert.equal(again.root.hidden,true); assert.equal(again.calls,0);
});
test('уже подключённому устройству предложение не показывается',()=>{
  const f=fixture({connected:true,saved:new Map([['onboarded',true]])}); f.start();
  assert.equal(f.root.hidden,true); assert.equal(f.calls,0);
});
test('разрешение запрашивается только по кнопке; успех закрывает экран',async()=>{
  const f=fixture({saved:new Map([['onboarded',true]])}); f.start();
  assert.equal(f.calls,0);
  await f.click('enable'); assert.equal(f.calls,1); assert.equal(f.root.hidden,true);
});
test('ошибка подключения оставляет возможность повторить или пропустить',async()=>{
  const f=fixture({result:false,saved:new Map([['onboarded',true]])}); f.start();
  await f.click('enable');
  assert.equal(f.root.hidden,false); assert.match(f.root.innerHTML,/Не удалось подключиться/);
  assert.match(f.root.innerHTML,/Не сейчас/);
});
test('инструкция установки в Safari не скрывает предложение после установки PWA',()=>{
  const f=fixture({ok:false,install:true,saved:new Map([['onboarded',true]])}); f.start();
  assert.match(f.root.innerHTML,/Как установить на iPhone/);
  assert.equal(f.saved.has('pushOnboardingRevision'),false);
  f.state.install=false; f.state.ok=true;
  assert.equal(f.show(),true); assert.match(f.root.innerHTML,/Включить уведомления/);
});
test('запрет браузера показывает инструкцию без повторного запроса разрешения',async()=>{
  const f=fixture({ok:false,saved:new Map([['onboarded',true]])}); f.start();
  assert.match(f.root.innerHTML,/Установите приложение/);
  assert.doesNotMatch(f.root.innerHTML,/data-push-onboarding="enable"/);
  await f.click('close'); assert.equal(f.calls,0); assert.equal(f.root.hidden,true);
});
test('автоматическое восстановление уже выданного разрешения закрывает предложение',()=>{
  const f=fixture({saved:new Map([['onboarded',true]])}); f.start();
  f.state.connected=true; f.reconcile(); assert.equal(f.root.hidden,true);
});
