import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, fakeSession } from './harness.mjs';
const React = (await import('react')).default;
const { CustomerDirectory } = await import('../../../site-mirror/app/workbench/customer-directory.tsx');
const { RoleEntry } = await import('../../../site-mirror/app/takeoff/role-entry.tsx');
function makeWb() {
  const calls = { create: [], directory: [] };
  const wb = { session: {...fakeSession('biz-1'), tenantId:'tenant-synthetic'}, error:null, setError(){}, logout(){}, client: {
    async read(){throw Object.assign(new Error('not installed'),{status:404});},
    async directory(search, cursor) { calls.directory.push({search,cursor}); return {kind:'ok',customers:[{customerId:'cus_1',displayName:'青山机械（合成）'}]}; },
    async createCustomer(body) { calls.create.push(body); return {customerId:'cus_new_1'}; }
  }};
  return {wb,calls};
}
test('客户页只保留三个色板与角色图标，读取获准案例且不创建客户',async(t)=>{
  t.after(cleanup);const {wb,calls}=makeWb();const opened=[];let logouts=0;wb.logout=()=>logouts++;
  wb.client.directory=async(search)=>{calls.directory.push({search});return {kind:'ok',customers:[{customerId:search,displayName:search}]};};
  render(React.createElement(CustomerDirectory,{wb,onOpen:id=>opened.push(id)}));
  const good=await screen.findByRole('button',{name:'好客户：喀什示例塑料制品有限公司'});
  await waitFor(()=>assert.equal(good.getAttribute('aria-disabled'),'false'));fireEvent.click(good);
  assert.deepEqual(opened,['喀什示例塑料制品有限公司']);assert.equal(calls.directory.length,3);assert.deepEqual(calls.create,[]);
  assert.equal(document.querySelectorAll('.tk-picker-card').length,3);
  assert.deepEqual([...document.querySelectorAll('.tk-picker-card')].map(el=>el.className),['tk-picker-card good','tk-picker-card middle','tk-picker-card poor']);
  assert.equal(document.querySelectorAll('.tk-picker-board').length,3);
  assert.equal(screen.queryByRole('textbox'),null);assert.equal(screen.queryByText('其他客户'),null);assert.equal(screen.queryByText('＋ 新建客户'),null);
  const role=screen.getByRole('button',{name:'切换角色'});assert.equal(role.textContent,'');fireEvent.click(role);assert.equal(logouts,1);
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
  const good=await screen.findByRole('button',{name:/好客户：喀什示例塑料制品有限公司/});
  fireEvent.click(good);assert.deepEqual(opened,['actual-good']);
  assert.equal(screen.getByRole('button',{name:/中.*客户记录需核对/}).getAttribute('aria-disabled'),'true');
  assert.equal(screen.getByRole('button',{name:/差.*尚未接入/}).getAttribute('aria-disabled'),'true');
  assert.equal(screen.queryByText('其他客户'),null);
});
test('三案例可匹配现行合成目录名，激光近名记录不被误选',async(t)=>{
  t.after(cleanup);const {wb}=makeWb();const opened=[];
  wb.client.directory=async(search)=>({kind:'ok',customers:search.includes('金属加工')
    ? [{customerId:'old-laser',displayName:'喀什示例金属加工有限公司（激光·合成·冒烟）'},
       {customerId:'laser',displayName:'喀什示例金属加工有限公司（激光场景·合成）'}]
    : [{customerId:search.includes('塑料')?'injection':'textile',displayName:search.includes('塑料')
      ? '喀什示例塑料制品有限公司（注塑场景·合成）':'喀什示例棉纺有限公司（棉纺场景·合成）'}]});
  render(React.createElement(CustomerDirectory,{wb,onOpen:id=>opened.push(id)}));
  const laser=await screen.findByRole('button',{name:'中客户：喀什示例金属加工有限公司'});
  await waitFor(()=>assert.equal(laser.getAttribute('aria-disabled'),'false'));
  fireEvent.click(laser);assert.deepEqual(opened,['laser']);
});
test('角色首屏只交换服务端提供的身份，无账号密码与登录前置页',async(t)=>{
  t.after(cleanup); const ids=[]; const wb={identities:[{principalId:'credit-real',label:'信审',roles:['credit']}],loginWithIdentity:async(id)=>ids.push(id)};
  render(React.createElement(RoleEntry,{wb}));
  fireEvent.click(screen.getByRole('button',{name:/信审：识别风险/}));
  await waitFor(()=>assert.deepEqual(ids,['credit-real']));
  assert.equal(screen.queryByRole('textbox'),null);
  assert.equal(screen.getByRole('button',{name:/政策：厘清准入/}).disabled,true);
});
test('服务与管理员身份不伪装成业务角色；多身份必须明确选择',async(t)=>{
  t.after(cleanup); const ids=[]; const wb={identities:[
    {principalId:'admin',label:'管理员',roles:['admin','business']},
    {principalId:'service',label:'机器',roles:['service','credit']},
    {principalId:'a',label:'业务甲',roles:['business']}, {principalId:'b',label:'业务乙',roles:['business']}],loginWithIdentity:async(id)=>ids.push(id)};
  render(React.createElement(RoleEntry,{wb}));
  assert.equal(screen.getByRole('button',{name:/信审：识别风险/}).disabled,true);
  fireEvent.click(screen.getByRole('button',{name:/业务：精准识客/})); assert.deepEqual(ids,[]);
  fireEvent.click(screen.getByRole('button',{name:'业务乙'}));
  await waitFor(()=>assert.deepEqual(ids,['b']));
});
test('角色进入失败可重试，不伪装为已进入',async(t)=>{
  t.after(cleanup); let tries=0;
  const wb={identities:[{principalId:'b',label:'业务',roles:['business']}],loginWithIdentity:async()=>{tries++;throw Error('offline');}};
  render(React.createElement(RoleEntry,{wb}));
  fireEvent.click(screen.getByRole('button',{name:/业务：精准识客/}));
  await screen.findByRole('alert'); assert.equal(tries,1);
  assert.equal(screen.getByRole('button',{name:/业务：精准识客/}).disabled,false);
});

test('首页三个缩略看板使用各自快照与补充读面，失败不伪造状态',async t=>{
 t.after(cleanup);const {wb,calls}=makeWb();
 wb.client.directory=async search=>({kind:'ok',customers:[{customerId:search,displayName:search}]});
 const reads=[];
 wb.client.workspace=async id=>{reads.push(id);if(id.includes('棉纺'))throw Error('offline');return {snapshot:{customer:{customerId:id,displayName:id},assessments:[],facilities:[]}};};
 wb.client.read=async path=>{if(path.endsWith('/arrow-cases'))throw Object.assign(new Error('not installed'),{status:404});return {artifacts:[],factConflicts:[]};};wb.client.channelStatus=async()=>({tasks:[]});
 render(React.createElement(CustomerDirectory,{wb,onOpen(){}}));
 await waitFor(()=>assert.equal(document.querySelectorAll('.tk-picker-board .tk-board').length,2));
 assert.equal(document.querySelectorAll('.tk-picker-board .tk-cell[role=img]').length,40);
 assert.equal(document.querySelectorAll('.tk-picker-board button').length,0);
 assert.ok(screen.getByText('进度暂时不可读'));assert.equal(new Set(reads).size,3);assert.deepEqual(calls.create,[]);
});

test('stable manifest binds IDs despite new names and shuffled case order',async t=>{
 t.after(cleanup);const {wb,calls}=makeWb();const opened=[];
 const cases=[{caseId:'parallel-v1-bad',customerId:'bad-id',displayName:'风险新名称',scenarioLabel:'差',sourceMode:'synthetic'},{caseId:'parallel-v1-good',customerId:'good-id',displayName:'好例新名称',scenarioLabel:'好',sourceMode:'synthetic'},{caseId:'parallel-v1-medium',customerId:'mid-id',displayName:'补证新名称',scenarioLabel:'中',sourceMode:'synthetic'}];
 wb.client.read=async path=>path.endsWith('/arrow-cases')?{cases}:{artifacts:[]};wb.client.workspace=async id=>({snapshot:{customer:{customerId:id}}});wb.client.channelStatus=async()=>({tasks:[]});wb.client.advance={history:async()=>[]};
 render(React.createElement(CustomerDirectory,{wb,onOpen:id=>opened.push(id)}));
 const good=await screen.findByRole('button',{name:'好客户：好例新名称'});fireEvent.click(good);assert.deepEqual(opened,['good-id']);assert.equal(calls.directory.length,0);
});
