import test from 'node:test';
import assert from 'node:assert/strict';
import {render,screen,fireEvent,waitFor,cleanup} from './harness.mjs';
const React=await import('react');
const {AssistantObservationPanel}=await import('../../../site-mirror/app/takeoff/assistant-observation.tsx');
function fixture(){const calls=[];const wb={customerId:'demo',session:{sessionId:'test'},snapshot:{},client:{sendMessage:async(...args)=>{calls.push(args);return {delivery:{state:'delivered'}};},observeAssistant:async()=>{throw Error('Unexpected model call');}}};return {wb,calls};}
// FINAL-02 对照现行契约更新（FINAL_ROUND FINAL-02“按钮必要且有反馈”）：工具栏收敛为
// 上传（＋）/引用（❞）/点名（＠）三个必要按钮；表情（👍）与“电话（尚未接通）”占位按钮
// 已在页面收敛轮按产品决定移除——原断言期望二者存在，属功能移除前的陈旧断言，现改为
// 断言其不再存在；两条测试的核心行为断言（内部消息发送不调模型、引用/@ 进草稿、上传走现有入口）保留。
test('普通消息通过内部消息接口发送，不调用模型；引用进入草稿',async t=>{t.after(cleanup);const f=fixture();render(React.createElement(AssistantObservationPanel,{wb:f.wb,assistant:'business',chat:true}));fireEvent.change(screen.getByLabelText('聊天消息'),{target:{value:'测试消息'}});fireEvent.click(screen.getByLabelText('发送消息'));await screen.findByText('消息已送达');assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].audience,'internal');fireEvent.click(screen.getByLabelText('引用最近消息'));assert.match(screen.getByLabelText('聊天消息').value,/测试消息/);assert.equal(screen.queryByLabelText('表情'),null,'表情按钮已随工具栏收敛移除');});
test('点名当前助手写入@；未接通占位按钮不再存在；上传使用现有入口',t=>{t.after(cleanup);const f=fixture();let uploads=0;render(React.createElement(AssistantObservationPanel,{wb:f.wb,assistant:'policy',chat:true,onOpenMaterials:()=>uploads++}));fireEvent.click(screen.getByLabelText('点名当前助手'));assert.equal(screen.getByLabelText('聊天消息').value,'@政策 ');fireEvent.click(screen.getByLabelText('上传文件'));assert.equal(uploads,1);assert.equal(screen.queryByLabelText('电话（尚未接通）'),null,'未接通的电话占位按钮已移除，不以禁用态冒充功能');});
