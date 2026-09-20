import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from './harness.mjs';
const React=(await import('react')).default;
const { MaterialsDesk }=await import('../../../site-mirror/app/takeoff/materials-desk.tsx');
const { WorkTimeline }=await import('../../../site-mirror/app/takeoff/work-timeline.tsx');
const { RoleFlow }=await import('../../../site-mirror/app/takeoff/role-flow.tsx');
const { RoleEntry }=await import('../../../site-mirror/app/takeoff/role-entry.tsx');
const { DesktopFrame }=await import('../../../site-mirror/app/takeoff/desktop-frame.tsx');
const { cellStatus }=await import('../../../site-mirror/app/takeoff/cell-status.ts');
const { deriveTakeoffCells }=await import('../../../site-mirror/lib/workbench/takeoff-projection.ts');
window.PointerEvent=window.MouseEvent;
window.DragEvent=window.MouseEvent;

function fixture() {
  const calls=[];
  const rows=[{artifactId:'a1',kind:'bank_statement',current:true,materialFileMeta:{name:'六月流水.txt'},materialMeta:{period:'2026-06'}},{artifactId:'a2',kind:'invoice',current:false,materialFileMeta:{name:'旧版设备发票.pdf'}}];
  const client={read:async(path)=>{calls.push(['read',path]);return {ok:true,artifacts:rows};},artifactContent:async(cid,id)=>{calls.push(['content',cid,id]);return {ok:true,artifact:{content:{text:'服务端登记的原件摘要'}}};}};
  return { calls,client,wb:{client,customerId:'c1',snapshotVersion:1,session:{sessionId:'s1',roles:['business']}},rows };
}
function desk(f,id='c1') {return React.createElement(MaterialsDesk,{key:id,wb:f.wb,customerId:id,onUpload:()=>f.calls.push(['upload'])});}
function dimensions() {const el=screen.getByLabelText('可缩放的材料画布');Object.defineProperty(el,'clientWidth',{value:1000,configurable:true});Object.defineProperty(el,'clientHeight',{value:650,configurable:true});el.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:650});return el;}

test('状态图标：未开始锁/处理中扳手/完成对勾；同专业前序阻断优先，历史事实不被重写',()=>{
  const input={domain:'credit',row:'input',items:[],running:true,completed:false,needsReview:false,frozen:false};
  const done={...input,row:'closure',running:false,completed:true};
  assert.equal(cellStatus(input).color,'blue');assert.equal(cellStatus(done).color,'green');
  assert.equal(cellStatus({...input,running:false}).color,'gray');
  assert.equal(cellStatus(done,[{...input,items:[{key:'conf',tone:'red'}]}]).color,'gray');
  assert.equal(cellStatus(done,[{...input,domain:'asset',items:[{key:'conf',tone:'red'}]}]).color,'green');
  assert.equal(cellStatus(input).icon,'wrench');
  assert.equal(cellStatus({...input,running:false,items:[{key:'gate',tone:'red'}]}).icon,'cross');
  assert.equal(cellStatus(done).icon,'check');
  assert.equal(cellStatus({...input,running:false}).icon,'lock');
  assert.equal(done.completed,true);
});

test('1080画布：比例不变的窗口变化仍重新居中',async(t)=>{
  const original={width:window.innerWidth,height:window.innerHeight};
  t.after(()=>{cleanup();window.innerWidth=original.width;window.innerHeight=original.height;});
  window.innerWidth=1920;window.innerHeight=1080;
  const view=render(React.createElement(DesktopFrame,null,'工作台'));
  const canvas=view.container.querySelector('[data-design-size]');
  assert.equal(canvas.style.left,'0px');
  window.innerWidth=2200;fireEvent(window,new window.Event('resize'));
  assert.equal(canvas.style.transform,'scale(1)');assert.equal(canvas.style.left,'140px');
  window.innerWidth=960;window.innerHeight=540;fireEvent(window,new window.Event('resize'));
  assert.equal(canvas.style.transform,'scale(0.5)');assert.equal(canvas.style.left,'0px');
});

test('材料：按服务端清单搜索/筛选、空结果清楚、上传入口可达',async(t)=>{
  t.after(cleanup);const f=fixture();render(desk(f));await screen.findByLabelText('材料卡片：六月流水.txt');
  fireEvent.change(screen.getByLabelText('搜索材料'),{target:{value:'流水'}});assert.equal(screen.queryByLabelText('材料卡片：旧版设备发票.pdf'),null);
  fireEvent.change(screen.getByLabelText('搜索材料'),{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'历史',exact:true}));assert.equal(screen.queryByLabelText('材料卡片：六月流水.txt'),null);
  fireEvent.change(screen.getByLabelText('搜索材料'),{target:{value:'不存在'}});assert.ok(screen.getByText('没有符合条件的材料'));
  fireEvent.click(screen.getByRole('button',{name:'上传与补充材料'}));assert.deepEqual(f.calls.at(-1),['upload']);
});

test('材料：指针拖动、缩放坐标、撤销、键盘摆放、客户隔离；不发业务写命令',async(t)=>{
  t.after(cleanup);const f=fixture();const view=render(desk(f));let card=await screen.findByLabelText('材料卡片：六月流水.txt');dimensions();
  fireEvent.pointerDown(card,{button:0,clientX:100,clientY:100,pointerId:1});fireEvent.pointerMove(card,{clientX:200,clientY:150,pointerId:1});fireEvent.pointerUp(card,{pointerId:1});
  assert.equal(card.dataset.x,'172');assert.equal(card.dataset.y,'122');
  fireEvent.click(screen.getByRole('button',{name:'撤销',exact:true}));assert.equal(card.dataset.x,'72');
  fireEvent.click(screen.getByRole('button',{name:'放大材料'}));assert.match(screen.getByLabelText('材料缩放比例').textContent,/110/);
  fireEvent.pointerDown(card,{button:0,clientX:100,clientY:100,pointerId:1});fireEvent.pointerMove(card,{clientX:210,clientY:155,pointerId:1});fireEvent.pointerUp(card,{pointerId:1});
  assert.equal(Math.round(Number(card.dataset.x)),172);assert.equal(Math.round(Number(card.dataset.y)),122);
  fireEvent.keyDown(card,{key:'ArrowRight'});assert.equal(Math.round(Number(card.dataset.x)),192);
  view.rerender(desk(f,'c2'));card=await screen.findByLabelText('材料卡片：六月流水.txt');assert.equal(card.dataset.x,'72');
  view.rerender(desk(f,'c1'));card=await screen.findByLabelText('材料卡片：六月流水.txt');assert.equal(Math.round(Number(card.dataset.x)),192);
  assert.ok(f.calls.every(([kind])=>kind==='read'));
});

test('材料：清单拖入画布只接受当前授权清单内的ID',async(t)=>{
  t.after(cleanup);const f=fixture();render(desk(f));const card=await screen.findByLabelText('材料卡片：六月流水.txt');const viewport=dimensions();
  fireEvent.drop(viewport,{clientX:500,clientY:300,dataTransfer:{getData:()=> 'unauthorized'}});assert.equal(card.dataset.x,'72');
  fireEvent.drop(viewport,{clientX:500,clientY:300,dataTransfer:{getData:()=> 'a1'}});assert.equal(card.dataset.x,'360');assert.equal(card.dataset.y,'260');
  assert.equal(f.calls.length,1);
});

test('材料：原件读取/未知格式/关闭恢复焦点；读取失败不冒充空清单',async(t)=>{
  t.after(cleanup);const f=fixture();const view=render(desk(f));const card=await screen.findByLabelText('材料卡片：六月流水.txt');
  const open=within(card).getByRole('button',{name:'查看原件'});open.focus();fireEvent.click(open);
  await screen.findByText(/服务端登记的原件摘要/);assert.deepEqual(f.calls.at(-1),['content','c1','a1']);
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});assert.equal(screen.queryByRole('dialog'),null);assert.equal(document.activeElement,open);
  f.client.read=async()=>{throw new Error('forbidden');};f.wb={...f.wb,snapshotVersion:2};view.rerender(desk(f));
  await screen.findByText(/暂时无法读取材料/);assert.equal(screen.queryByLabelText('材料卡片：六月流水.txt'),null);
});

test('材料原件：连接上传文件、客户隔离和关闭释放文件地址',async(t)=>{
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;const revoked=[];
  URL.createObjectURL=()=> 'blob:original';URL.revokeObjectURL=(url)=>revoked.push(url);
  t.after(()=>{cleanup();URL.createObjectURL=create;URL.revokeObjectURL=revoke;});
  const f=fixture();let owner='c1';
  f.client.artifactContent=async()=>({artifact:{content:{connectorRef:{customerId:owner,evidenceId:'ev1'}}}});
  f.client.channelPreview=async(eid,cid)=>{f.calls.push(['preview',eid,cid]);return {downloadUrl:'/objects/signed',format:'txt'};};
  f.client.fetchChannelObject=async(path)=>{f.calls.push(['object',path]);return {status:200,contentType:'application/octet-stream',bytes:new TextEncoder().encode('实际上传的文件内容')};};
  render(desk(f));const card=await screen.findByLabelText('材料卡片：六月流水.txt');
  fireEvent.click(within(card).getByRole('button',{name:'查看原件'}));await screen.findByText('实际上传的文件内容');
  assert.deepEqual(f.calls.slice(-2),[['preview','ev1','c1'],['object','/api/jw/v2/connectors/objects/signed']]);
  fireEvent.click(screen.getByRole('button',{name:'关闭原件预览'}));assert.deepEqual(revoked,['blob:original']);
  owner='other-customer';const before=f.calls.length;
  fireEvent.click(within(card).getByRole('button',{name:'查看原件'}));await screen.findByText(/原件暂时不可读/);
  assert.equal(f.calls.length,before,'不请求其他客户的原件');
});

test('角色流程：五专业并行，20个节点可回真实事项；缩放还原',async(t)=>{
  t.after(cleanup);const calls=[];const cells=deriveTakeoffCells({snapshot:null,packageDetail:null,channelTasks:[],currentMaterials:null,factConflicts:0});
  render(React.createElement(RoleFlow,{cells,top:{changedDomains:[],gateResult:null},onSelect:c=>calls.push(c)}));
  const credit=screen.getByRole('button',{name:/信审 · 收集材料/});fireEvent.click(credit);assert.equal(calls[0].domain,'credit');assert.equal(calls[0].row,'input');
  assert.equal(screen.getAllByRole('button',{name:/ · (收集材料|辅助分析|人工核验|专业收口) · /}).length,20);
  fireEvent.click(screen.getByRole('button',{name:'放大流程图'}));assert.ok(screen.getByText('110%'));fireEvent.click(screen.getByRole('button',{name:'还原视图'}));assert.ok(screen.getByText('100%'));
});

test('时间轴：服务端分页/去重、筛选、未知时间、未取得数据不假造',async(t)=>{
  t.after(cleanup);const cursors=[];const event=(id,type,at)=>({eventId:id,payloadRef:{type},payload:at?{at}:{},aggregateVersion:'1'});
  const wb={client:{eventsPage:async(_id,after)=>{cursors.push(after);return after==='0'?{events:[event('e1','artifact_registered','2026-09-20T01:00:00Z')],hasMore:true,nextAfterSeq:'1'}:{events:[event('e1','artifact_registered','2026-09-20T01:00:00Z'),event('e2','assessment_candidate',null)],hasMore:false,nextAfterSeq:'2'};}}};
  render(React.createElement(WorkTimeline,{wb,customerId:'c1'}));await screen.findByText('收到一份材料');fireEvent.click(screen.getByRole('button',{name:'继续加载记录'}));await screen.findByText('建议方案已更新');
  assert.equal(screen.getAllByText('收到一份材料').length,1);assert.ok(screen.getByText('时间未知'));assert.deepEqual(cursors,['0','1']);
  fireEvent.click(screen.getByRole('button',{name:/材料与证据/}));assert.equal(screen.queryByText('建议方案已更新'),null);
});

test('时间轴：真实Edge信封的occurredAt和大写事件名能正确呈现',async(t)=>{
  t.after(cleanup);const wb={client:{eventsPage:async()=>({events:[{eventId:'live-shaped',occurredAt:'2026-09-20T10:00:00Z',payloadRef:{type:'ASSESSMENT_CANDIDATE_READY'},payload:{},aggregateVersion:'34'}],hasMore:false,nextAfterSeq:'34'})}};
  render(React.createElement(WorkTimeline,{wb,customerId:'c1'}));await screen.findByText('建议方案已生成');
  assert.equal(screen.queryByText('时间未知'),null);assert.ok(screen.getByText(/2026年9月20日/));
});

test('时间轴：切客户后旧响应不能写回；失败支持明确重读',async(t)=>{
  t.after(cleanup);let release;const held=new Promise(resolve=>{release=resolve;});const wb={client:{eventsPage:async(id)=>id==='c1'?held:Promise.reject(new Error('当前记录不可读'))}};
  const view=render(React.createElement(WorkTimeline,{wb,customerId:'c1'}));view.rerender(React.createElement(WorkTimeline,{wb,customerId:'c2'}));await screen.findByText(/当前记录不可读/);
  await act(async()=>release({events:[{eventId:'old',payloadRef:{type:'customer_created'},aggregateVersion:'1'}],hasMore:false,nextAfterSeq:'1'}));assert.equal(screen.queryByText('客户已建档'),null);
});

test('角色入口：图标与角色配对、多身份显式选择，服务不可用不误报个人身份错误',async(t)=>{
  t.after(cleanup);const calls=[];const wb={identities:[{principalId:'b1',roles:['business'],label:'业务甲'},{principalId:'b2',roles:['business'],label:'业务乙'}],loginWithIdentity:async(id)=>{calls.push(id);throw Object.assign(new Error(),{code:'PRINCIPAL_UNTRUSTED'});}};
  render(React.createElement(RoleEntry,{wb}));fireEvent.click(screen.getByRole('button',{name:/业务 了解客户/}));assert.equal(calls.length,0);fireEvent.click(screen.getByRole('button',{name:'业务乙'}));await screen.findByText(/办理服务或角色配置尚未就绪/);assert.deepEqual(calls,['b2']);
  assert.ok(screen.getByRole('button',{name:/政策 核对准入/}).disabled);
  assert.deepEqual([...document.querySelectorAll('.tk-role-card .tk-role-logo img')].map((img)=>img.getAttribute('src')), ['business','policy','credit','commerce','asset'].map((role)=>`/objects/${role}-v1.png`));
});
