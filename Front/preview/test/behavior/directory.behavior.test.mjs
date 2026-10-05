import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, fakeSession } from './harness.mjs';
const React = (await import('react')).default;
const { CustomerDirectory } = await import('../../../site-mirror/app/workbench/customer-directory.tsx');
const { RoleEntry } = await import('../../../site-mirror/app/takeoff/role-entry.tsx');
function makeWb() {
  const calls = { create: [], directory: [] };
  const wb = { session: {...fakeSession('biz-1'), tenantId:'tenant-synthetic'}, error:null, setError(){}, logout(){}, client: {
    // 演示目录未接通（404）→ 诚实回退完整客户目录（验收视图）；本组测试针对完整目录语义。
    async read(){throw Object.assign(new Error('not installed'),{status:404,code:'NOT_FOUND'});},
    async directory(search, cursor) { calls.directory.push({search,cursor}); return {kind:'ok',customers:[{customerId:'cus_1',displayName:'青山机械（合成）'}]}; },
    async createCustomer(body) { calls.create.push(body); return {customerId:'cus_new_1'}; }
  }};
  return {wb,calls};
}

test('客户目录：读取服务端权威列表，点击打开真实客户',async(t)=>{
  t.after(cleanup);const {wb,calls}=makeWb();const opened=[];
  render(React.createElement(CustomerDirectory,{wb,onOpen:id=>opened.push(id)}));
  const row=await screen.findByRole('button',{name:/青山机械（合成）/});
  fireEvent.click(row);assert.deepEqual(opened,['cus_1']);
  assert.deepEqual(calls.directory,[{search:'',cursor:undefined}]);
  assert.ok(screen.getByRole('button',{name:'搜索'}));
});

test('搜索提交以服务端结果为准；旧响应晚到不写回',async(t)=>{
  t.after(cleanup);const {wb,calls}=makeWb();
  let release;
  const gate=new Promise(r=>{release=r;});
  wb.client.directory=async(search)=>{
    calls.directory.push({search});
    if(search==='旧词'){await gate;return {kind:'ok',customers:[{customerId:'old',displayName:'旧词客户'}]};}
    return {kind:'ok',customers:search?[{customerId:'new',displayName:`${search}客户`}]:[{customerId:'all',displayName:'全部客户'}]};
  };
  const {container}=render(React.createElement(CustomerDirectory,{wb,onOpen(){}}));
  await screen.findByRole('button',{name:/全部客户/});
  const form=container.querySelector('form');
  fireEvent.change(screen.getByLabelText('搜索客户'),{target:{value:'旧词'}});
  fireEvent.submit(form); // 慢请求在途（输入框不因加载禁用，用户可继续输入并回车）
  fireEvent.change(screen.getByLabelText('搜索客户'),{target:{value:'新词'}});
  fireEvent.submit(form);
  await screen.findByRole('button',{name:/新词客户/});
  release(); // 晚到的"旧词"响应此刻才返回，必须被丢弃
  await new Promise(r=>setTimeout(r,10));
  assert.ok(screen.getByRole('button',{name:/新词客户/}));
  assert.equal(screen.queryByRole('button',{name:/旧词客户/}),null);
});

test('业务身份可新建客户，创建成功即进入工作台',async(t)=>{
  t.after(cleanup);const {wb,calls}=makeWb();const opened=[];
  render(React.createElement(CustomerDirectory,{wb,onOpen:id=>opened.push(id)}));
  fireEvent.click(await screen.findByRole('button',{name:'＋ 新建客户'}));
  fireEvent.change(screen.getByLabelText('客户全称'),{target:{value:'新客户甲'}});
  fireEvent.change(screen.getByLabelText('统一社会信用代码'),{target:{value:'SYNTHETIC-TEST-0001'}});
  fireEvent.click(screen.getByRole('button',{name:'创建并进入'}));
  await waitFor(()=>assert.deepEqual(opened,['cus_new_1']));
  assert.equal(calls.create.length,1);
  assert.equal(calls.create[0].displayName,'新客户甲');
  assert.equal(calls.create[0].legalEntityRef,'SYNTHETIC-TEST-0001');
  assert.ok(calls.create[0].requestId);
});

test('创建失败如实报错可重试，不冒充成功也不清空输入',async(t)=>{
  t.after(cleanup);const {wb}=makeWb();
  wb.client.createCustomer=async()=>({}); // 无 customerId=失败
  render(React.createElement(CustomerDirectory,{wb,onOpen(){}}));
  fireEvent.click(await screen.findByRole('button',{name:'＋ 新建客户'}));
  fireEvent.change(screen.getByLabelText('客户全称'),{target:{value:'新客户乙'}});
  fireEvent.change(screen.getByLabelText('统一社会信用代码'),{target:{value:'SYNTHETIC-TEST-0002'}});
  fireEvent.click(screen.getByRole('button',{name:'创建并进入'}));
  await screen.findByRole('alert');
  assert.equal(screen.getByLabelText('客户全称').value,'新客户乙');
});

test('无建档权限的角色不显示新建入口',async(t)=>{
  t.after(cleanup);const {wb}=makeWb();
  wb.session={...fakeSession('policy-1'),roles:['policy'],tenantId:'tenant-synthetic'};
  render(React.createElement(CustomerDirectory,{wb,onOpen(){}}));
  await screen.findByRole('button',{name:/青山机械（合成）/});
  assert.equal(screen.queryByText('＋ 新建客户'),null);
});

test('目录读取失败不冒充空客户；重试重新读取',async(t)=>{
  t.after(cleanup);const {wb,calls}=makeWb();
  sessionStorage.setItem('jw-wb-recent:biz-1',JSON.stringify(['cus_private']));
  wb.client.directory=async()=>({kind:'unknown',code:'UNAVAILABLE'});
  render(React.createElement(CustomerDirectory,{wb,onOpen(){}}));
  await screen.findByRole('alert'); assert.equal(screen.queryByText('cus_private'),null);
  assert.equal(screen.queryByText('还没有客户'),null);
  wb.client.directory=async()=>{calls.directory.push({search:'retry'});return {kind:'ok',customers:[{customerId:'cus_ok',displayName:'恢复客户'}]};};
  fireEvent.click(screen.getByRole('button',{name:'重试'}));
  await screen.findByRole('button',{name:/恢复客户/});
  sessionStorage.clear();
});


// ---- LONG-02：默认演示目录同屏展示"授权客户"（服务端按身份/租户/grant 过滤；不硬编码评测ID）----
function demoOkWb(directoryImpl) {
  const calls = { directory: [] };
  const wb = { session: {...fakeSession('biz-1'), tenantId:'t1'}, error:null, setError(){}, logout(){}, client: {
    // 演示目录可用（arrow-cases 形状）→ 默认演示视图；advance.history 缺省=进度读取跳过。
    async read(path){ if(path==='/api/jw/v2/arrow-cases') return { ok:true, manifestVersion:'m1', cases:[{caseId:'case-01',customerId:'cus_demo_1',displayName:'演示案例甲',scenarioLabel:'差',displayOrder:1}] }; throw Object.assign(new Error('404'),{status:404}); },
    async directory(search, cursor){ calls.directory.push({search,cursor}); return directoryImpl(search, cursor); },
  }};
  return {wb,calls};
}

test('LONG-02 默认目录同屏列出授权客户：服务端权威过滤结果直接可达，点击进入工作台',async(t)=>{
  t.after(cleanup);const {wb,calls}=demoOkWb(()=>({kind:'ok',customers:[{customerId:'cus_real_9f2a',displayName:'评测合成客户甲'}],nextCursor:null}));
  const opened=[];
  render(React.createElement(CustomerDirectory,{wb,onOpen:id=>opened.push(id)}));
  await screen.findByRole('button',{name:/演示案例甲/});          // 演示案例仍在
  const row=await screen.findByRole('button',{name:/评测合成客户甲/}); // 授权客户同屏可见（无需 acceptance=1）
  fireEvent.click(row); assert.deepEqual(opened,['cus_real_9f2a']);
  assert.deepEqual(calls.directory,[{search:'',cursor:undefined}]);  // 仅一次首屏读取
  assert.ok(screen.getByRole('region',{name:'授权客户'}));
  assert.ok(screen.getByText(/仅列出当前身份有权办理的客户/),'授权口径如实说明');
});

test('LONG-02 授权客户空态如实：暂无授权≠没有客户，演示案例仍可进',async(t)=>{
  t.after(cleanup);const {wb}=demoOkWb(()=>({kind:'ok',customers:[],nextCursor:null}));
  render(React.createElement(CustomerDirectory,{wb,onOpen(){}}));
  await screen.findByRole('button',{name:/演示案例甲/});
  await screen.findByText('当前身份暂无授权客户');
  assert.ok(screen.getByText(/新建客户或获得授权后/));
});

test('LONG-02 客户联系人身份（403）如实说明走客户门户，不冒充网络错误',async(t)=>{
  t.after(cleanup);const {wb}=demoOkWb(()=>{throw Object.assign(new Error('forbidden'),{status:403});});
  render(React.createElement(CustomerDirectory,{wb,onOpen(){}}));
  await screen.findByText(/客户联系人身份不使用内部客户目录/);
  assert.ok(screen.getByRole('button',{name:'重试'}));
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
