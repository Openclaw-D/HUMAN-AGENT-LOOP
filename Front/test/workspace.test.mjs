import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { createApp } from '../../Back/src/server.mjs';
import { App } from '../preview/app.tsx';

const nativeFetch = globalThis.fetch;
let app;
afterEach(async () => { cleanup(); globalThis.fetch = nativeFetch; if (app) { await app.close(); app = null; } });
async function workspace(role = '协调者') {
  app = createApp({ dbPath: ':memory:' });
  await new Promise(r => app.server.listen(0,'127.0.0.1',r));
  const base = `http://127.0.0.1:${app.server.address().port}`; let cookie='';
  globalThis.fetch = async (url, options = {}) => {
    const res = await nativeFetch(new URL(url,base),{...options,headers:{...options.headers,Origin:base,...(cookie?{Cookie:cookie}:{})}});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return res;
  };
  render(React.createElement(App));
  const enter = await screen.findByRole('button',{name:new RegExp(role)});
  await waitFor(()=>assert.equal(enter.disabled,false)); fireEvent.click(enter);
  await screen.findByRole('heading',{name:'一起选择活动方案'});
}
async function compare() { fireEvent.click(screen.getByRole('button',{name:/比较模拟方案/})); await screen.findByLabelText('选择方案：轻量探索'); }
test('real API-backed comparison requires an explicit human reason and preserves hard boundaries',async()=>{
  await workspace(); await compare();
  assert.equal(screen.getByLabelText('选择方案：全面铺开').disabled,true);
  fireEvent.click(screen.getByLabelText('选择方案：均衡推进'));
  const confirm=screen.getByRole('button',{name:'确认模拟选择'}); assert.equal(confirm.disabled,true);
  fireEvent.change(screen.getByLabelText('人工决定依据'),{target:{value:'我们共同接受这个方案的取舍。'}});
  assert.equal(confirm.disabled,false); fireEvent.click(confirm);
  await screen.findByText(/^已选择：/);
  assert.equal(screen.getByLabelText('选择方案：均衡推进').checked,true);
  assert.equal(app.store.get('shared-choice').decisions[0].candidateId,'balanced');
  assert.equal(app.store.get('shared-choice').decisions.length,1);
});
test('people can discuss and ask a transparently simulated assistant without creating a decision',async()=>{
  await workspace('参与者');
  fireEvent.change(screen.getByLabelText('讨论内容'),{target:{value:'我更关注可调整性。'}});
  fireEvent.click(screen.getByRole('button',{name:'发送给大家'}));
  await within(screen.getByRole('log')).findByText('我更关注可调整性。');
  fireEvent.change(screen.getByLabelText('讨论对象'),{target:{value:'planner'}});
  fireEvent.change(screen.getByLabelText('讨论内容'),{target:{value:'请解释方案取舍。'}});
  fireEvent.click(screen.getByRole('button',{name:'提问模拟助手'}));
  await within(screen.getByRole('log')).findByText('规划助手');
  assert.ok(within(screen.getByRole('log')).getByText(/规则生成的模拟回复/));
  const state=app.store.get('shared-choice'); assert.equal(state.discussion.length,3); assert.equal(state.decisions.length,0);
  assert.equal(screen.queryByRole('button',{name:'确认模拟选择'}),null);
});
test('observer role has no writing controls',async()=>{
  await workspace('观察者');
  assert.equal(screen.getByRole('button',{name:/比较模拟方案/}).disabled,true);
  assert.equal(screen.queryByRole('button',{name:'发送给大家'}),null);
  assert.equal(screen.queryByLabelText('修订值'),null);
});
test('invalid numeric text does not silently turn a known assumption into an unknown value',async()=>{
  await workspace(); const before=app.store.get('shared-choice').revision;
  fireEvent.change(screen.getByLabelText('修订值'),{target:{value:'not-a-number'}});
  fireEvent.change(screen.getByLabelText('修订依据'),{target:{value:'输入格式检查。'}});
  fireEvent.click(screen.getByRole('button',{name:'保存模拟修订'}));
  await screen.findByText(/请输入 0–100 的数值/);
  assert.equal(app.store.get('shared-choice').revision,before);
});
test('information changes invalidate comparison and flag the preserved human decision',async()=>{
  await workspace(); await compare();
  fireEvent.change(screen.getByLabelText('人工决定依据'),{target:{value:'按当前共同假设选择。'}});
  fireEvent.click(screen.getByRole('button',{name:'确认模拟选择'})); await screen.findByText(/^已选择：/);
  fireEvent.change(screen.getByLabelText('修订值'),{target:{value:'99'}});
  fireEvent.change(screen.getByLabelText('修订依据'),{target:{value:'模拟投入条件发生改变。'}});
  fireEvent.click(screen.getByRole('button',{name:'保存模拟修订'}));
  await screen.findByText('原决定需复核');
  assert.ok(screen.getByText(/之前的比较已过期/));
  assert.equal(screen.getByRole('button',{name:'确认模拟选择'}).disabled,true);
  assert.equal(app.store.get('shared-choice').decisions.length,1);
});
