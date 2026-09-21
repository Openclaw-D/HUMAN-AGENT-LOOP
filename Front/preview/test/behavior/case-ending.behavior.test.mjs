import test from 'node:test';
import assert from 'node:assert/strict';
import {render,screen,fireEvent,cleanup} from './harness.mjs';
const React=await import('react');
const {readCaseTerminal,verifiedCaseEnding,CaseEnding}=await import('../../../site-mirror/app/takeoff/case-ending.tsx');
const base={customerId:'c1',kind:'completed',recordId:'evt-1',occurredAt:'2026-09-21T00:00:00Z',archived:true};
test('五六次为演示目标，终态依赖服务端结果而不依赖固定点击次数',()=>{
 assert.ok(verifiedCaseEnding(readCaseTerminal({...base,roundCount:5}),'c1','好'));
 assert.ok(verifiedCaseEnding(readCaseTerminal({...base,roundCount:6}),'c1','中'));
 assert.ok(verifiedCaseEnding(readCaseTerminal({...base,roundCount:7}),'c1','中'));
 assert.equal(readCaseTerminal({...base,kind:'running',roundCount:5}),null);
 assert.equal(readCaseTerminal({...base,kind:'unknown',roundCount:6}),null);
 assert.ok(verifiedCaseEnding(readCaseTerminal({...base,kind:'rejected',roundCount:3}),'c1','差'));
 assert.equal(verifiedCaseEnding(readCaseTerminal({...base,kind:'rejected',roundCount:3}),'other','差'),null);
 assert.equal(readCaseTerminal({...base,roundCount:5,archived:false}),null);
 assert.ok(verifiedCaseEnding(readCaseTerminal({...base,kind:'rejected',roundCount:2}),'c1','好'),'真实拒绝不被预设的好客户成功路径覆盖');
});
test('终态页面可返回、可查看记录，不改变服务端记录',t=>{t.after(cleanup);let views=0;render(React.createElement(CaseEnding,{record:{...base,roundCount:5},onRecords:()=>views++}));assert.ok(screen.getByRole('dialog',{name:'案例本次流程已办结'}));fireEvent.click(screen.getByRole('button',{name:'查看记录'}));assert.equal(views,1);assert.equal(screen.queryByRole('dialog'),null);});
