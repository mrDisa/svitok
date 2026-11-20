import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Проверяем реальные обработчики жеста с управляемыми событиями и завершением анимаций.
function navigation() {
  const handlers = {}, animations = [], nodes = [], frames = new Map();
  let frameId = 0, clock = 100, clones = 0;
  class Node {
    constructor(text = '', classes = []) {
      this.text = text; this.style = {}; this.dataset = {}; this.scrollTop = 0; this.scrollLeft = 0;
      this.classes = new Set(classes);
      this.classList = { add: (...xs) => xs.forEach(x => this.classes.add(x)), remove: (...xs) => xs.forEach(x => this.classes.delete(x)), contains: x => this.classes.has(x) };
    }
    cloneNode() { clones++; const n = new Node(this.text, this.classes); n.dataset = {...this.dataset}; return n; }
    matches() { return false; }
    removeAttribute() {}
    setAttribute() {}
    before(n) { nodes.push(n); }
    remove() { nodes.splice(nodes.indexOf(this), 1); }
    getBoundingClientRect() { return {left:0,top:0,width:390,height:844}; }
    animate() { let finish; const finished = new Promise(resolve => {finish = resolve;}); animations.push(finish); return {finished,cancel(){}}; }
  }
  const app = new Node(); app.clientWidth = 390;
  app.addEventListener = (type, fn) => { handlers[type] = fn; };
  app.appendChild = n => nodes.push(n);
  const view = new Node('Список чатов', ['view','on']); view.dataset.view = 'chats';
  let back = null, clicks = 0;
  const sheet = {hidden:true}, hidden = {hidden:true};
  const source = fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const ctx = vm.createContext({
    WeakMap, performance: {now:() => clock}, matchMedia: () => ({matches:false}),
    requestAnimationFrame: fn => { frames.set(++frameId,fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id),
    document: {activeElement:{blur(){}}},
    $: (selector, parent) => selector === '#app' ? app : selector === '#sheet' ? sheet : selector === '#onb' || selector === '#dw' ? hidden : selector === '.view.on' ? view : parent === view ? back : null,
    $$: () => [],
  });
  vm.runInContext(source.slice(source.indexOf('const edgeParents ='),source.indexOf('let appStarted =')) + '\nthis.api={rememberEdgeParent,edgeBackAction,initEdgeBack,edgeParents,clearEdgeParents};',ctx);
  const api = ctx.api; api.initEdgeBack();
  const event = (x, y = 100) => ({touches:[{clientX:x,clientY:y}],changedTouches:[{clientX:x,clientY:y}],target:{closest:()=>null},cancelable:true,preventDefault(){}});
  return {api,view,nodes,
    setBack() {back = {click(){ clicks++; handlers.click({target:{closest:s => s === '.view' ? view : s.includes('data-chat-back') ? back : null}}); view.text='Список чатов';}};},
    get clicks(){return clicks;}, get clones(){return clones;},
    advance(ms){clock += ms;},
    flush(){const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());},
    start(x=5){ handlers.touchstart(event(x)); },
    move(x,y=100){ clock += 16; handlers.touchmove(event(x,y)); },
    end(x){const e=event(x);e.touches=[];handlers.touchend(e);},
    cancel(){handlers.touchcancel();},
    async finish(){animations.splice(0).forEach(fn=>fn()); for(let i=0;i<10;i++){await Promise.resolve();this.flush();}},
  };
}
test('корневой экран не сворачивается даже при наличии предыдущей вкладки', () => {
  const n = navigation();
  assert.equal(n.api.edgeBackAction(),null);
  n.start();n.move(180);n.end(180);
  assert.equal(n.clicks,0);assert.equal(n.nodes.length,0);
});
test('свайп показывает родителя во время движения; отмена сохраняет чат', async () => {
  const n = navigation();n.view.scrollTop=140;n.api.rememberEdgeParent(n.view);
  n.view.text='Открытый чат';n.setBack();n.start();n.move(110);n.flush();
  assert.equal(n.nodes[0].text,'Список чатов');assert.equal(n.nodes[0].scrollTop,140);
  assert.equal(n.nodes[0].classList.contains('view'),false);
  assert.equal(n.view.text,'Открытый чат');assert.equal(n.clicks,0);
  n.cancel();await n.finish();
  assert.equal(n.nodes.length,0);assert.equal(n.view.text,'Открытый чат');
  assert.equal(n.api.edgeParents.get(n.view).length,1);
});
test('завершение жеста возвращает родителя и удаляет снимки анимации', async () => {
  const n=navigation();n.api.rememberEdgeParent(n.view);n.view.text='Открытый чат';n.setBack();
  n.start();n.move(180);n.flush();const clones=n.clones;n.end(180);assert.equal(n.clicks,0);assert.equal(n.clones,clones);
  await n.finish();assert.equal(n.clicks,1);assert.equal(n.view.text,'Список чатов');assert.equal(n.nodes.length,0);
  assert.equal(n.api.edgeParents.get(n.view).length,0);
});

test('движения объединяются в кадр, возврат пальца отменяет переход', async () => {
  const n=navigation();n.api.rememberEdgeParent(n.view);n.view.text='Открытый чат';n.setBack();
  n.start();n.move(200);n.move(170);
  assert.equal(n.view.style.translate,undefined);
  n.flush();assert.equal(n.view.style.translate,'165px 0');
  n.end(170);await n.finish();
  assert.equal(n.clicks,0);assert.equal(n.view.text,'Открытый чат');assert.equal(n.nodes.length,0);
});
test('вертикальное движение не оставляет фон жеста и не меняет экран', () => {
  const n=navigation();n.api.rememberEdgeParent(n.view);n.setBack();n.start();
  n.move(7,150);
  assert.equal(n.nodes.length,0);assert.equal(n.clicks,0);
});

test('чат сохраняет родителя на внешней view, даже если передан внутренний scroller', async () => {
  const n=navigation();const inner={closest:selector=>selector==='.view'?n.view:null};
  n.api.rememberEdgeParent(inner);n.view.text='Открытый чат';n.setBack();
  assert.ok(n.api.edgeBackAction());
  n.start();n.move(180);n.end(180);await n.finish();assert.equal(n.clicks,1);
  n.api.rememberEdgeParent(inner);n.api.clearEdgeParents(inner);
  assert.equal(n.api.edgeBackAction(),null);
});

test('возврат начинается из середины экрана', async () => {
  const n=navigation();n.api.rememberEdgeParent(n.view);n.setBack();
  n.start(160);n.move(340);n.end(340);await n.finish();assert.equal(n.clicks,1);
});
