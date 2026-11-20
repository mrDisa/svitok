import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function worker({cached=new Map(),fetcher=async()=>new Response('new'),put=async()=>{}}={}) {
  const handlers={},fetched=[],writes=[];let activated=false;
  const ctx=vm.createContext({
    self:{registration:{scope:'https://example.com/svitok/'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{activated=true;}},
    location:{origin:'https://example.com'},URL,AbortController,setTimeout,clearTimeout,
    Request:class {constructor(url,options){this.url=url;this.signal=options?.signal;}},
    caches:{open:async()=>({match:async key=>cached.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,res)=>{writes.push(key);await put(key,res);}})},
    fetch:async(req,options)=>{fetched.push(req);return fetcher(req,options);},
  });
  vm.runInContext(source,ctx);
  return {handlers,fetched,writes,get activated(){return activated;},
    request(path,mode='cors'){let result;handlers.fetch({request:{url:'https://example.com/svitok/'+path,method:'GET',mode},respondWith:p=>result=p});return result;},
    install(){let result;handlers.install({waitUntil:p=>result=p});return result;},
  };
}
test('документ, скрипты и стартовые данные открываются из текущего кэша без ожидания сети', async () => {
  const paths=['index.html','styles.css','app.js','chats.js','social.js','vendor/supabase-2.45.4.js','data/feed.json','data/books.json','data/paintings.json'];
  const cached=new Map(paths.map(path=>[path,new Response(path)]));
  const w=worker({cached,fetcher:()=>new Promise(()=>{})});
  assert.equal(await (await w.request('?pwa=1','navigate')).text(),'index.html');
  for(const path of paths) assert.equal(await (await w.request(path+(path.endsWith('.js')?'?v=77':''))).text(),path);
  assert.equal(w.fetched.length,0);
});
test('отсутствующий файл загружается и попадает в кэш версии', async () => {
  const w=worker();assert.equal(await (await w.request('app.js?v=77')).text(),'new');
  assert.equal(w.fetched.length,1);assert.deepEqual(w.writes,['app.js']);
});
test('обновление не ждёт шрифты и иконки и скачивает документ один раз', async () => {
  const w=worker({fetcher:async req=>{
    assert.ok(!req.url.startsWith('fonts/')&&!req.url.startsWith('icons/'));
    return new Response('shell');
  }});
  await w.install();assert.equal(w.activated,true);
  assert.equal(w.fetched.filter(req=>req.url==='index.html'||req.url==='./').length,1);
});
test('неполная загрузка кода не активирует обновление с пустым кэшем', async () => {
  const w=worker({fetcher:async req=>{if(req.url==='app.js')throw new Error('offline');return new Response('shell');}});
  await assert.rejects(w.install(),/offline/);assert.equal(w.activated,false);
});
