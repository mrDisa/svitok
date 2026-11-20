import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../support.js',import.meta.url),'utf8');
const first=Date.parse('2026-11-20T12:00:00Z');
const day=86400000;
function launch({now=first,data=new Map([['onboarded',true]]),blocked=false,tab='feed',writable=true}={}){
  let shown=0,focused=0;
  const dialog={open:false,showModal(){this.open=true;shown++;},close(){this.open=false;}};
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const nodes={'#support-notice':dialog,'#app':{dataset:{tab}},'#onb':{hidden:!blocked},'#dw':{hidden:true},'#sheet':{hidden:true}};
  const ctx=vm.createContext({Date:Clock,document:{hidden:false},store:{get:(k,d)=>data.get(k)??d,set:(k,v)=>{if(writable)data.set(k,v);}},$:(selector)=>selector==='[data-support-notice-close]'?{focus(){focused++;}}:nodes[selector]});
  vm.runInContext(source.slice(source.indexOf('const SupportPrompt ='))+'\nthis.prompt=SupportPrompt;',ctx);
  ctx.prompt.start();
  return {prompt:ctx.prompt,data,nodes,get shown(){return shown;},get focused(){return focused;}};
}
test('первый день, повторные запуски и следующий день не показывают поддержку',()=>{
  const a=launch();assert.equal(a.prompt.maybeShow(),false);
  const b=launch({now:first+60000,data:a.data});assert.equal(b.prompt.maybeShow(),false);
  const c=launch({now:first+day,data:a.data});assert.equal(c.prompt.maybeShow(),false);
  assert.equal(a.data.get('supportNoticeSeen'),undefined);
});
test('через 48 часов сообщение появляется один раз и больше не возвращается после закрытия и перезапуска',()=>{
  const a=launch();const b=launch({now:first+2*day,data:a.data});
  assert.equal(b.prompt.maybeShow(),true);assert.equal(b.shown,1);assert.equal(b.focused,1);
  assert.equal(b.data.get('supportNoticeSeen'),true);
  b.prompt.close();assert.equal(b.nodes['#support-notice'].open,false);
  assert.equal(b.prompt.maybeShow(),false);
  const c=launch({now:first+3*day,data:a.data});assert.equal(c.prompt.maybeShow(),false);
});
test('срок сам по себе недостаточен без посещений в разные дни',()=>{
  const data=new Map([['onboarded',true],['supportUsage',{firstUsedAt:first,days:[]}]]);
  const a=launch({now:first+2*day,data});assert.equal(a.prompt.maybeShow(),false);
});
test('знакомство, другие вкладки и запрет хранения не создают повторяющийся экран',()=>{
  for(const options of [{blocked:true},{tab:'chats'},{writable:false}]){
    const data=new Map([['onboarded',true],['supportUsage',{firstUsedAt:first,days:['2026-11-20','2026-11-21']}]]);
    const a=launch({now:first+3*day,data,...options});assert.equal(a.prompt.maybeShow(),false);assert.equal(a.shown,0);
    assert.equal(data.get('supportNoticeSeen'),undefined);
  }
});
test('ручное посещение поддержки тоже исключает последующее уведомление',()=>{
  const a=launch();a.prompt.markSeen();
  const b=launch({now:first+3*day,data:a.data});assert.equal(b.prompt.maybeShow(),false);
});
test('отметка из аккаунта объединяется без возможности сбросить её в false',()=>{
  const social=fs.readFileSync(new URL('../social.js',import.meta.url),'utf8');
  const ctx=vm.createContext({});vm.runInContext(social.slice(social.indexOf('  function mergeState('),social.indexOf('  function apply('))+'\nthis.merge=mergeState;',ctx);
  assert.equal(ctx.merge({supportNoticeSeen:false},{supportNoticeSeen:true}).supportNoticeSeen,true);
  assert.equal(ctx.merge({supportNoticeSeen:true},{supportNoticeSeen:false}).supportNoticeSeen,true);
  assert.equal(ctx.merge({},{}).supportNoticeSeen,false);
});
