import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function screen({reduced=false,swiping=false}={}) {
  const animations=[],ghosts=[];
  class Node {
    constructor(){this.classes=new Set();this.scrollTop=80;this.scrollLeft=0;this.clientWidth=390;this.childElementCount=1;this.style={};this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x)};}
    removeAttribute(){} setAttribute(){}
    before(n){ghosts.push(n);}
    remove(){const i=ghosts.indexOf(this);if(i>=0)ghosts.splice(i,1);}
    animate(keyframes){let resolve;const finished=new Promise(r=>resolve=r);const a={keyframes,finished,cancelled:false,cancel(){this.cancelled=true;resolve();},finish:resolve};animations.push(a);return a;}
  }
  const view=new Node();view.classes.add('on');if(swiping)view.classes.add('edge-back-restored');
  const el=new Node();el.closest=()=>view;
  const ctx=vm.createContext({
    bibleRoute:{view:'books'},bibleEl:()=>el,matchMedia:()=>({matches:reduced}),$$:()=>[],
    edgeSnapshot:()=>({copy:new Node(),scroll:[[80,0]]}),
  });
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  vm.runInContext(source.slice(source.indexOf('let bibleTransition ='),source.indexOf('function renderBooks()')),ctx);
  return {ctx,el,view,animations,ghosts,
    open(route){ctx.animateBibleRoute(route);ctx.bibleRoute=route;},
    async finish(){animations.forEach(a=>a.finish());for(let i=0;i<8;i++)await Promise.resolve();},
  };
}
test('план открывается справа поверх сохранённого экрана и очищает слои после анимации',async()=>{
  const s=screen();s.open({view:'plan',id:'john21'});
  assert.equal(s.animations[0].keyframes[0].translate,'390px 0');
  assert.equal(s.ghosts[0].scrollTop,80);assert.ok(s.view.classes.has('bible-transitioning'));
  await s.finish();assert.equal(s.ghosts.length,0);assert.equal(s.el.classes.has('bible-opening'),false);
});
test('возврат к книгам движется в обратную сторону; повторный рендер не анимируется',async()=>{
  const s=screen();s.ctx.bibleRoute={view:'chapters',b:0};s.open({view:'books'});
  assert.ok(s.animations[0].keyframes[0].translate.startsWith('-'));
  assert.ok(s.ghosts[0].classes.has('bible-previous-front'));
  await s.finish();const count=s.animations.length;s.open({view:'books'});assert.equal(s.animations.length,count);
});
test('быстрое открытие другой главы удаляет предыдущий переход без лишних слоёв',async()=>{
  const s=screen();s.open({view:'chapters',b:0});s.open({view:'chapter',b:0,c:1});
  assert.equal(s.ghosts.length,1);assert.equal(s.animations[0].cancelled,true);
  await s.finish();assert.equal(s.ghosts.length,0);
});
test('уменьшение движения и завершение свайпа не запускают дополнительный переход',()=>{
  for(const options of [{reduced:true},{swiping:true}]){
    const s=screen(options);s.open({view:'plan',id:'john21'});assert.equal(s.animations.length,0);assert.equal(s.ghosts.length,0);
  }
});
