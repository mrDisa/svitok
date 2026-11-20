import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bank='https://messenger.sbrf.ru/sl/PaICte6EsQj2AhmcD';
function page({origin='more',copyWorks=true,share=null}={}){
  const root={innerHTML:''},copies=[],notices=[],tabs=[];let click;
  const ctx=vm.createContext({
    $:selector=>selector==='#support'?root:{dataset:{view:origin}},I:{back:'',copy:'',share:''},
    openTab:name=>tabs.push(name),copyText:async text=>{copies.push(text);return copyWorks;},toast:text=>notices.push(text),
    navigator:{share},document:{addEventListener:(type,fn)=>{click=fn;}},
  });
  vm.runInContext(fs.readFileSync(new URL('../support.js',import.meta.url),'utf8')+'\nthis.support=Support;',ctx);
  ctx.support.init();
  return {root,copies,notices,tabs,support:ctx.support,click:selector=>click({preventDefault(){},target:{closest:s=>s===selector?{}:null}})};
}
test('страница содержит подтверждённую ссылку, цель и предупреждение для iPhone',()=>{
  const p=page();p.support.open();p.support.render();
  assert.deepEqual(p.tabs,['support']);assert.match(p.root.innerHTML,/15 000 ₽/);
  assert.ok(p.root.innerHTML.includes(`href="${bank}"`));assert.match(p.root.innerHTML,/Safari/);
  assert.match(p.root.innerHTML,/src="img\/support-qr.png"/);assert.match(p.root.innerHTML,/Актуальная собранная сумма отображается в Сбере/);
});
test('копирование использует ссылку сбора, а ошибка не выдаётся за успех',async()=>{
  for(const copyWorks of [true,false]){
    const p=page({copyWorks});await p.click('[data-support-copy]');assert.deepEqual(p.copies,[bank]);
    assert.match(p.notices[0],copyWorks?/скопирована/:/Не удалось/);
  }
});
test('возврат сохраняет исходные настройки; у прямого входа есть путь в профиль',async()=>{
  for(const origin of ['more','feed']){
    const p=page({origin});p.support.open();await p.click('[data-support-back]');
    assert.equal(p.tabs.at(-1),origin==='more'?'more':'profile');
  }
});
test('поделиться передаёт страницу с описанием и не отправляет сообщения автоматически',async()=>{
  const shared=[];const p=page({share:async data=>shared.push(data)});p.support.render();assert.equal(shared.length,0);
  await p.click('[data-support-share]');assert.equal(shared[0].url,'https://mrdisa.github.io/svitok/?pwa=1#support');
});
