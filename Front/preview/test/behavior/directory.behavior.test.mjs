import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, fakeSession } from './harness.mjs';
const React = (await import('react')).default;
const { CustomerDirectory } = await import('../../../site-mirror/app/workbench/customer-directory.tsx');
const { RoleEntry } = await import('../../../site-mirror/app/takeoff/role-entry.tsx');
function makeWb() {
  const calls = { create: [], directory: [] };
  const wb = { session: {...fakeSession('biz-1'), tenantId:'tenant-synthetic'}, error:null, setError(){}, logout(){}, client: {
    async directory(search, cursor) { calls.directory.push({search,cursor}); return {kind:'ok',customers:[{customerId:'cus_1',displayName:'青山机械（合成）'}]}; },
    async createCustomer(body) { calls.create.push(body); return {customerId:'cus_new_1'}; }
  }};
  return {wb,calls};
}
test('新建折叠：提交实际租户，只通过统一入口打开一次', async(t)=>{
  t.after(cleanup); const {wb,calls}=makeWb(); const opened=[];
  render(React.createElement(CustomerDirectory,{wb,onOpen:id=>opened.push(id)}));
  await screen.findByText('青山机械（合成）');
  assert.equal(screen.queryByLabelText('客户全称'),null);
  fireEvent.click(screen.getByRole('button',{name:'＋ 新建客户'}));
  fireEvent.change(screen.getByLabelText('客户全称'),{target:{value:'合成新客户'}});
  fireEvent.change(screen.getByLabelText('统一社会信用代码'),{target:{value:'SYNTH-001'}});
  fireEvent.click(screen.getByRole('button',{name:'创建并进入'}));
  await waitFor(()=>assert.deepEqual(opened,['cus_new_1']));
  assert.equal(calls.create.length,1); assert.equal(calls.create[0].tenantId,'tenant-synthetic');
});
test('搜索交给授权目录；点客户只打开一次；不暴露技术配置',async(t)=>{
  t.after(cleanup); const {wb,calls}=makeWb(); const opened=[];
  render(React.createElement(CustomerDirectory,{wb,onOpen:id=>opened.push(id)}));
  await screen.findByText('青山机械（合成）');
  fireEvent.click(screen.getByText('其他客户', { selector: 'summary' }));
  fireEvent.change(screen.getByLabelText('搜索客户'),{target:{value:'青山'}});
  fireEvent.click(screen.getByRole('button',{name:'搜索'}));
  await waitFor(()=>assert.equal(calls.directory.at(-1).search,'青山'));
  fireEvent.click(screen.getByRole('button',{name:/青山机械/}));
  assert.deepEqual(opened,['cus_1']); assert.equal(screen.queryByLabelText('Edge 服务地址'),null);
});
test('旧最近访问不越过服务端目录；读取失败不冒充空客户',async(t)=>{
  t.after(cleanup); sessionStorage.setItem('jw-wb-recent:biz-1',JSON.stringify(['cus_private']));
  const {wb}=makeWb(); wb.client.directory=async()=>({kind:'unknown',code:'UNAVAILABLE'});
  render(React.createElement(CustomerDirectory,{wb,onOpen(){}}));
  await screen.findByRole('alert'); assert.equal(screen.queryByText('cus_private'),null);
  assert.equal(screen.queryByText('还没有客户'),null); sessionStorage.clear();
});

test('三案例只打开授权目录唯一匹配；未建档或同名冲突不预造客户',async(t)=>{
  t.after(cleanup);const {wb}=makeWb();const opened=[];
  wb.client.directory=async(search)=>({kind:'ok',customers:search==='喀什示例塑料制品有限公司' ? [{customerId:'actual-good',displayName:search}] : search==='喀什示例金属加工有限公司' ? [{customerId:'duplicate-a',displayName:search},{customerId:'duplicate-b',displayName:search}] : []});
  render(React.createElement(CustomerDirectory,{wb,onOpen:id=>opened.push(id)}));
  const good=await screen.findByRole('button',{name:/好.*喀什示例塑料制品有限公司.*进入办理/});
  fireEvent.click(good);assert.deepEqual(opened,['actual-good']);
  assert.ok(screen.getByRole('button',{name:/中.*客户记录需核对/}).disabled);
  assert.ok(screen.getByRole('button',{name:/差.*尚未接入/}).disabled);
  assert.equal(screen.getByText('其他客户',{selector:'summary'}).parentElement.open,false);
});
test('角色首屏只交换服务端提供的身份，无账号密码与登录前置页',async(t)=>{
  t.after(cleanup); const ids=[]; const wb={identities:[{principalId:'credit-real',label:'信审',roles:['credit']}],loginWithIdentity:async(id)=>ids.push(id)};
  render(React.createElement(RoleEntry,{wb}));
  fireEvent.click(screen.getByRole('button',{name:/信审 判断风险/}));
  await waitFor(()=>assert.deepEqual(ids,['credit-real']));
  assert.equal(screen.queryByRole('textbox'),null);
  assert.equal(screen.getByRole('button',{name:/政策 核对准入/}).disabled,true);
});
test('服务与管理员身份不伪装成业务角色；多身份必须明确选择',async(t)=>{
  t.after(cleanup); const ids=[]; const wb={identities:[
    {principalId:'admin',label:'管理员',roles:['admin','business']},
    {principalId:'service',label:'机器',roles:['service','credit']},
    {principalId:'a',label:'业务甲',roles:['business']}, {principalId:'b',label:'业务乙',roles:['business']}],loginWithIdentity:async(id)=>ids.push(id)};
  render(React.createElement(RoleEntry,{wb}));
  assert.equal(screen.getByRole('button',{name:/信审 判断风险/}).disabled,true);
  fireEvent.click(screen.getByRole('button',{name:/业务 了解客户/})); assert.deepEqual(ids,[]);
  fireEvent.click(screen.getByRole('button',{name:'业务乙'}));
  await waitFor(()=>assert.deepEqual(ids,['b']));
});
test('角色进入失败可重试，不伪装为已进入',async(t)=>{
  t.after(cleanup); let tries=0;
  const wb={identities:[{principalId:'b',label:'业务',roles:['business']}],loginWithIdentity:async()=>{tries++;throw Error('offline');}};
  render(React.createElement(RoleEntry,{wb}));
  fireEvent.click(screen.getByRole('button',{name:/业务 了解客户/}));
  await screen.findByRole('alert'); assert.equal(tries,1);
  assert.equal(screen.getByRole('button',{name:/业务 了解客户/}).disabled,false);
});
