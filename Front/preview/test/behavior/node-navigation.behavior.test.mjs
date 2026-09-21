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
test('unified root: direct role entry and same four-page column context without backend calls',async t=>{
 t.after(cleanup);localStorage.clear();const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('Virtual entry must not call backend')};t.after(()=>{globalThis.fetch=original});
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
