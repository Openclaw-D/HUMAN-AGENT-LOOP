// board-round-02 任务01 行为测试·内部材料统一上传链（方案R，用户行为级）：
// 1) 提交入口唯一：A 直传表单已移除（不再要求用户选 A/Connectors），统一链卡可见。
// 2) 未绑定诚实阻断：上传按钮禁用+说明，不降级、不冒充。
// 3) 绑定→上传→同号对账：发起邀请/接受绑定后一次提交进通道；502 结果未知后确认框保留、
//    重试仍用同一 requestId；上传后 A 材料清单自动刷新（回写结果同页可见）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, unknownResultError } from './harness.mjs';

const React = (await import('react')).default;
const { OriginalsPanel } = await import('../../../site-mirror/app/workbench/originals-panel.tsx');

function makePanel({ uploadImpl, tasks = [] } = {}) {
  const calls = { reads: [], upload: [], accept: [], invite: [], refresh: 0 };
  const client = {
    read: async (path) => {
      calls.reads.push(path);
      if (path.endsWith('/artifacts')) {
        return { artifacts: [{ artifactId: 'art_1', kind: 'invoice', current: true, materialFileMeta: { name: '发票.pdf' }, createdAt: '2026-09-19T01:00:00Z' }] };
      }
      return {};
    },
    channelStatus: async () => ({ tasks, rulesetVersion: 'sim-pack@7', pause: { paused: false } }),
    channelTask: async () => ({ task: { stages: [], aOps: [] } }),
    channelAction: async (path, body) => {
      if (path === 'intake/invitations') { calls.invite.push(body); return { invitationId: 'inv_9', token: 'tok_9' }; }
      if (path === 'intake/accept') { calls.accept.push(body); return { invitationId: 'inv_9', bindingId: 'bnd_9' }; }
      if (path === 'evidence/upload') { calls.upload.push(body); return uploadImpl ? uploadImpl(calls.upload.length) : { ok: true, evidenceId: 'ev_9' }; }
      throw new Error(`unexpected path: ${path}`);
    },
    artifactProcessing: async () => ({ current: null, history: [] }),
    artifactContent: async () => ({ artifact: null }),
  };
  const wb = {
    client,
    phase: 'live',
    session: { sessionId: 's1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3600_000 },
    customerId: 'cus_1',
    snapshot: null,
    snapshotVersion: 0,
    error: null,
    setError: () => {},
    refresh: () => { calls.refresh += 1; return Promise.resolve(); },
  };
  return { wb, calls };
}

test('提交入口唯一：A 直传表单移除；统一链卡可见；未绑定时上传诚实阻断（不降级）', async (t) => {
  t.after(() => cleanup());
  const { wb } = makePanel();
  render(React.createElement(OriginalsPanel, { wb, customerId: 'cus_1', onChanged: () => {} }));

  await waitFor(() => assert.ok(screen.getByText(/已收到的材料/)));
  assert.equal(screen.queryByText('上传登记'), null, '旧 A 直传「上传登记」入口已移除');
  assert.ok(screen.getByText(/^上传材料$/), '统一提交链卡可见');
  const uploadBtn = screen.getByText('上传材料（≤512KB）', { selector: 'button' });
  assert.equal(uploadBtn.disabled, true, '未绑定：上传禁用（诚实阻断）');
  assert.ok(screen.getByText(/上传服务尚未连接/), '阻断原因如实说明');
  cleanup();
});

test('绑定→一次上传进通道：载荷带 invitationId；上传后 A 清单刷新（回写结果同页可见）', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makePanel();
  render(React.createElement(OriginalsPanel, { wb, customerId: 'cus_1', onChanged: () => {} }));
  await waitFor(() => assert.ok(screen.getByText(/已收到的材料/)));
  const readsBefore = calls.reads.length;

  // 绑定（演示快捷路径：发起邀请→填入→接受）
  fireEvent.click(screen.getByText('发起通道邀请', { selector: 'button' }));
  fireEvent.click(await waitFor(() => screen.getByText('确认提交')));
  await waitFor(() => assert.equal(calls.invite.length, 1));
  fireEvent.click(await waitFor(() => screen.getByText('填入下方')));
  fireEvent.click(screen.getByText('接受绑定', { selector: 'button' }));
  fireEvent.click(await waitFor(() => screen.getAllByText('确认提交')[0]));
  await waitFor(() => assert.equal(calls.accept.length, 1));

  const uploadBtn = await waitFor(() => {
    const b = screen.getByText('上传材料（≤512KB）', { selector: 'button' });
    assert.equal(b.disabled, false, '绑定后上传就绪');
    return b;
  });
  const file = new File([new Uint8Array([7, 7, 7])], '流水.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('选择上传的材料'), { target: { files: [file] } });
  fireEvent.click(uploadBtn);
  const dialog = await waitFor(() => screen.getByRole('dialog'));
  assert.ok(dialog.textContent.includes('一次提交'), '确认框说明一次提交语义');
  assert.ok(dialog.textContent.includes('自动回写'), '确认框说明 A 档案自动回写');
  fireEvent.click(screen.getByText('确认提交'));

  await waitFor(() => assert.equal(calls.upload.length, 1));
  const body = calls.upload[0];
  assert.equal(body.invitationId, 'inv_9', '绑定 invitationId 随载荷（不要求复制内部 ID）');
  assert.equal(body.kind, 'bank_statement');
  assert.ok(body.contentBase64.length > 0);
  await waitFor(() => assert.ok(calls.reads.length > readsBefore), '上传后 A 材料清单重新拉取（自动回写结果可见）');
  cleanup();
});

test('结果未知不换号：502 后确认框保留，重试仍用同一 requestId', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makePanel({ uploadImpl: (n) => (n === 1 ? (() => { throw unknownResultError(); })() : { ok: true, evidenceId: 'ev_9' }) });
  render(React.createElement(OriginalsPanel, { wb, customerId: 'cus_1', onChanged: () => {} }));
  await waitFor(() => assert.ok(screen.getByText(/已收到的材料/)));

  fireEvent.click(screen.getByText('发起通道邀请', { selector: 'button' }));
  fireEvent.click(await waitFor(() => screen.getByText('确认提交')));
  await waitFor(() => assert.equal(calls.invite.length, 1));
  fireEvent.click(await waitFor(() => screen.getByText('填入下方')));
  fireEvent.click(screen.getByText('接受绑定', { selector: 'button' }));
  fireEvent.click(await waitFor(() => screen.getAllByText('确认提交')[0]));
  await waitFor(() => assert.equal(calls.accept.length, 1));

  const file = new File([new Uint8Array([1])], 'a.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('选择上传的材料'), { target: { files: [file] } });
  fireEvent.click(screen.getByText('上传材料（≤512KB）', { selector: 'button' }));
  fireEvent.click(await waitFor(() => screen.getByText('确认提交')));
  await waitFor(() => assert.equal(calls.upload.length, 1));
  const firstId = calls.upload[0].requestId;

  await waitFor(() => assert.ok(screen.getByText(/提交结果还未确认/)));
  assert.ok(screen.getByRole('dialog'), '确认框保留');
  fireEvent.click(screen.getByText('重试本次提交'));
  await waitFor(() => assert.equal(calls.upload.length, 2));
  assert.equal(calls.upload[1].requestId, firstId, '同号重试（服务端幂等吸收）');
  cleanup();
});
