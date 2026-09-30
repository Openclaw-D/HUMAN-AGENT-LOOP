import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, cleanup, act } from './harness.mjs';
const React = (await import('react')).default;
const { RootApp } = await import('../../../site-mirror/app/workbench/root-app.tsx');
const { navigationNodes, navigationKey, nodeId, useNodeNavigation } = await import('../../../site-mirror/app/takeoff/node-navigation.ts');
const cell=(domain,row,completed=false,running=false)=>({domain,row,completed,running,items:[],needsReview:false,frozen:false});
test('navigation: stable frontier, invalid ID, batched clicks, scope and reload', async t=>{
 t.after(cleanup);sessionStorage.clear();
 const nodes=navigationNodes([cell('credit','closure'),cell('credit','analysis'),cell('credit','input',true),cell('policy','input')]);
 assert.deepEqual(nodes.map(nodeId),['policy:input','credit:input','credit:analysis']);
 function Probe({scope,nodes}){const n=useNodeNavigation(scope,nodes);return React.createElement('button',{onClick:()=>n.move(1)},n.selected?nodeId(n.selected):'empty');}
 sessionStorage.setItem(navigationKey('s1:c1'),'removed');
 const v=render(React.createElement(Probe,{scope:'s1:c1',nodes}));
 assert.equal(screen.getByRole('button').textContent,'policy:input');
 act(()=>{for(let i=0;i<20;i++)fireEvent.click(screen.getByRole('button'));});
 assert.equal(screen.getByRole('button').textContent,'credit:analysis');
 v.rerender(React.createElement(Probe,{scope:'s1:c2',nodes}));assert.equal(screen.getByRole('button').textContent,'policy:input');
 v.rerender(React.createElement(Probe,{scope:'s2:c1',nodes}));assert.equal(screen.getByRole('button').textContent,'policy:input');
 v.rerender(React.createElement(Probe,{scope:'s1:c1',nodes}));assert.equal(screen.getByRole('button').textContent,'credit:analysis');
 v.unmount();render(React.createElement(Probe,{scope:'s1:c1',nodes}));assert.equal(screen.getByRole('button').textContent,'credit:analysis');
 cleanup();render(React.createElement(Probe,{scope:'s1:c1',nodes:[]}));assert.equal(screen.getByRole('button').textContent,'empty');
});
test('默认根入口＝真实链：连接服务端身份目录，服务不可达不落入本地虚拟演示',async t=>{
 t.after(cleanup);localStorage.clear();const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('offline')};t.after(()=>{globalThis.fetch=original});
 render(React.createElement(RootApp));
 await screen.findByText(/正在连接工作台/); // 真实身份目录不可达：如实提示，等待重试
 assert.equal(screen.queryByText('虚拟交互演示'),null);
 assert.equal(screen.queryByRole('button',{name:/好客户：/}),null);
 assert.ok(calls>=1);
});
test('显式 ?demo=virtual 才进入隔离虚拟演示；零后端调用',async t=>{
 t.after(cleanup);localStorage.clear();window.history.replaceState(null,'','?demo=virtual');
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('Virtual entry must not call backend')};t.after(()=>{globalThis.fetch=original;window.history.replaceState(null,'','/')});
 render(React.createElement(RootApp));
 fireEvent.click(screen.getByRole('button',{name:'业务',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:/好客户：/}));
 for(const name of ['材料','流程','平台','决策']){
  fireEvent.click(screen.getByRole('button',{name,exact:true}));
  assert.match(screen.getByRole('navigation',{name:'专业列办理'}).textContent,/1\/5 业务/);
 }
 assert.equal(screen.getByRole('button',{name:'上一专业列'}).disabled,true);
 assert.equal(calls,0);
});
