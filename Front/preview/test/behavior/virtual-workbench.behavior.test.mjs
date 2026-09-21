import test from 'node:test';
import assert from 'node:assert/strict';
import {render,screen,fireEvent,waitFor,cleanup,within} from './harness.mjs';
const React=(await import('react')).default;
const {VirtualWorkbench}=await import('../../../site-mirror/app/takeoff/virtual-workbench.tsx');
const open=name=>{render(React.createElement(VirtualWorkbench));fireEvent.click(screen.getByRole('button',{name:'业务',exact:true}));fireEvent.click(screen.getByRole('button',{name:new RegExp(name)}));};
async function right(id,n){fireEvent.click(screen.getByRole('button',{name:'推进下一专业列'}));await waitFor(()=>assert.equal(JSON.parse(localStorage.getItem(`jw:virtual-click-v1:user:${id}`)).events.length,n));}
test('virtual good starts locked, click drives column/chat/three branches, left is read-only, five clicks finish',async t=>{
 t.after(cleanup);localStorage.clear();open('好客户');
 assert.equal(within(screen.getByRole('grid')).getAllByRole('button',{name:/尚未开始/}).length,20);
 await right('good',1);assert.equal(within(screen.getByRole('grid')).getAllByRole('button',{name:/已完成/}).length,5);
 fireEvent.click(screen.getByRole('button',{name:'切换客户'}));
 const goodCard=screen.getByRole('button',{name:/好客户：/});
 assert.equal(within(goodCard).getAllByRole('img',{name:/已完成/}).length,5);
 assert.equal(within(screen.getByRole('button',{name:/中客户：/})).getAllByRole('img',{name:/尚未开始/}).length,20);
 fireEvent.click(goodCard);
 assert.match(screen.getByRole('log').textContent,/88%/);
 fireEvent.click(screen.getByRole('button',{name:'决策',exact:true}));assert.equal(screen.getAllByRole('button',{name:/采用意见并继续|补充材料后复核|拒绝并归档/}).length,12);
 await right('good',2);fireEvent.click(screen.getByRole('button',{name:'上一专业列'}));assert.equal(JSON.parse(localStorage.getItem('jw:virtual-click-v1:user:good')).events.length,2);
 fireEvent.click(screen.getByRole('button',{name:'推进下一专业列'}));assert.equal(JSON.parse(localStorage.getItem('jw:virtual-click-v1:user:good')).events.length,2);
 for(let n=3;n<=5;n++)await right('good',n);assert.ok(screen.getByRole('dialog',{name:'虚拟演示结果'}));
 assert.equal(within(screen.getByRole('dialog')).queryByRole('heading'),null);
 fireEvent.keyDown(window,{key:'Escape'});assert.equal(screen.queryByRole('dialog'),null);
 assert.equal(JSON.parse(localStorage.getItem('jw:virtual-click-v1:user:good')).done,4);
});
test('virtual medium needs one extra supplement click; bad stops at credit',async t=>{
 t.after(cleanup);localStorage.clear();open('补证客户');for(let n=1;n<=3;n++)await right('medium',n);
 assert.equal(JSON.parse(localStorage.getItem('jw:virtual-click-v1:user:medium')).waiting,true);
 for(let n=4;n<=6;n++)await right('medium',n);assert.ok(within(screen.getByRole('dialog')).getByRole('img',{name:'钻石'}));
 cleanup();open('风险客户');for(let n=1;n<=3;n++)await right('bad',n);assert.match(screen.getByRole('dialog').textContent,/信审拒绝/);
 assert.equal(JSON.parse(localStorage.getItem('jw:virtual-click-v1:user:bad')).done,2);
});
