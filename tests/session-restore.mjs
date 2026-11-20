import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../social.js',import.meta.url),'utf8');
function account({session={user:{id:'alice'}},cached={id:'alice',display_name:'Алиса'},authError=null,profileError=null}={}){
  const rendered=[],connections=[];const saved=new Map([['profileCache',cached]]);
  const sb={auth:{getSession:()=>new Promise(()=>{}),getUser:async()=>({data:{user:{id:'alice'}},error:authError})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:cached,error:profileError})})};
  const ctx=vm.createContext({
    localStorage:{getItem:()=>typeof session==='string'?session:JSON.stringify(session)},
    store:{get:(k,d)=>saved.get(k)??d,set:(k,v)=>saved.set(k,v)},
    enabled:true,CFG:{},window:{supabase:{createClient:()=>sb}},location:{search:''},URLSearchParams,
    el:()=>({addEventListener(){}}),hookStore(){},onClick(){},
    render:()=>rendered.push(ctx.state().me?.id),Chats:{connect:()=>connections.push(ctx.state().me?.id)},
  });
  vm.runInContext('let sb,user=null,me=null,friends=[],incoming=[],outgoing=[],pendingAdd=null;\n'+
    source.slice(source.indexOf('  function restoreCachedIdentity()'),source.indexOf('  async function loadAll()'))+
    source.slice(source.indexOf('  async function init()'),source.indexOf('  async function accessToken()'))+
    '\nthis.state=()=>({user,me});this.restore=restoreCachedIdentity;this.boot=init;this.load=loadMe;',ctx);
  return {ctx,rendered,connections,saved};
}
test('профиль и подключение чатов восстанавливаются до завершения сетевого getSession',()=>{
  const a=account();a.ctx.boot();assert.equal(a.ctx.state().me.id,'alice');
  assert.deepEqual(a.rendered,['alice']);assert.deepEqual(a.connections,['alice']);
});
test('кэш другого аккаунта и повреждённая сессия не показывают чужой профиль',()=>{
  for(const options of [{session:{user:{id:'bob'}}},{session:'broken-json'},{session:null}]){
    const a=account(options);a.ctx.boot();assert.equal(a.ctx.state().me,null);assert.equal(a.rendered.length,0);
  }
});
test('недоступная сеть и ошибка чтения профиля сохраняют локальный профиль',async()=>{
  for(const options of [{authError:{status:0}},{profileError:{message:'offline'}}]){
    const a=account(options);a.ctx.boot();await assert.rejects(a.ctx.load());
    assert.equal(a.ctx.state().me.id,'alice');assert.equal(a.saved.get('profileCache').id,'alice');
  }
});
test('отклонённая сервером авторизация очищает показанный аккаунт',async()=>{
  const a=account({authError:{status:401}});a.ctx.boot();await assert.rejects(a.ctx.load());
  assert.equal(a.ctx.state().me,null);assert.equal(a.saved.get('profileCache'),null);
  assert.equal(a.connections.at(-1),undefined);
});
