// board-round-02 任务01 行为测试·客户门户统一上传链（方案R/任务02 冻结，用户行为级）：
// 1) 材料状态如实：A 白名单投影按服务端真实阶段显示；不承诺"处理进度将可见"。
// 2) 无通道绑定时诚实阻断：提交按钮禁用+引导一次性绑定，不降级走档案直传。
// 3) 绑定流程：通道令牌 → intake/accept（一次有效），此后提交入口唯一。
// 4) requestId 纪律：结果未知（502）后确认框保留，重试用同一编号（服务端幂等吸收），不换号盲重。
// 5) 载荷稳定：一次确认动作的 kind/invitationId/文件字节随动作固定，customerId 正确。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, fakeSession, unknownResultError } from './harness.mjs';

const React = (await import('react')).default;
const { CustomerPortal } = await import('../../../site-mirror/app/workbench/customer-portal.tsx');

function makePortal({ uploadImpl } = {}) {
  const calls = { upload: [], accept: [], loadMyMaterials: 0 };
  const client = {
    myMaterials: async () => {
      calls.loadMyMaterials += 1;
      return { materials: [{ artifactId: 'art_9', kind: 'invoice', stage: 'registered', createdAt: '2026-09-19T01:00:00Z' }] };
    },
    listMessages: async () => ({ messages: [], cursor: null }),
    sendMessage: async () => ({}),
    channelAction: async (path, body) => {
      if (path === 'intake/accept') {
        calls.accept.push(body);
        return { invitationId: 'inv_bind_1', bindingId: 'bnd_1' };
      }
      if (path === 'evidence/upload') {
        calls.upload.push(body);
        return uploadImpl ? uploadImpl(calls.upload.length) : { ok: true, evidenceId: 'ev_new' };
      }
      throw new Error(`unexpected channelAction path: ${path}`);
    },
  };
  const wb = {
    client,
    session: fakeSession('cit-1', ['customer']),
    error: null,
    setError: () => {},
    logout: () => {},
    snapshotVersion: 0,
  };
  return { wb, calls };
}

/** 走完一次性绑定：填令牌 → 关联通道 → 确认。 */
async function bindChannel() {
  fireEvent.change(screen.getByLabelText('通道令牌'), { target: { value: 'tok-portal-1' } });
  fireEvent.click(screen.getByText('关联通道', { selector: 'button' }));
  fireEvent.click(await waitFor(() => screen.getByText('确认绑定')));
  await waitFor(() => assert.ok(screen.getByText(/处理通道已关联/)), '绑定成功后显示就绪徽标');
}

test('客户门户：材料按服务端真实阶段显示"已登记（待处理）"；不再承诺"处理进度将可见"', async (t) => {
  t.after(() => cleanup());
  const { wb } = makePortal();
  render(React.createElement(CustomerPortal, { wb, customerId: 'cus_1', onLogout: () => {} }));

  await waitFor(() => assert.ok(screen.getByText('invoice')));
  assert.ok(screen.getByText(/已登记（待处理）/), '材料按服务端真实状态显示为待处理');
  assert.equal(screen.queryByText(/处理进度将在/), null, '不再承诺"处理进度将可见"');
  cleanup();
});

test('无通道绑定时诚实阻断：提交禁用+一次性绑定引导，不降级档案直传', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makePortal();
  render(React.createElement(CustomerPortal, { wb, customerId: 'cus_1', onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByText('invoice')));

  const submit = screen.getByText('提交', { selector: 'button' });
  assert.equal(submit.disabled, true, '未绑定时提交按钮禁用');
  assert.ok(screen.getByText(/提交按钮暂不可用：先完成上方一次性通道绑定/), '如实显示阻断与引导');
  assert.ok(screen.getByText(/第一步：关联处理通道/), '绑定区可见');
  assert.equal(calls.upload.length, 0, '无任何上传调用（不降级）');
  cleanup();
});

test('一次性绑定：通道令牌经 intake/accept 换取上传绑定（requestId 固定）', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makePortal();
  render(React.createElement(CustomerPortal, { wb, customerId: 'cus_1', onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByText('invoice')));

  fireEvent.change(screen.getByLabelText('通道令牌'), { target: { value: 'tok-portal-1' } });
  fireEvent.click(screen.getByText('关联通道', { selector: 'button' }));
  const dialog = await waitFor(() => screen.getByRole('dialog'));
  assert.ok(dialog.textContent.includes('对账编号'), '绑定确认框展示对账编号');
  fireEvent.click(screen.getByText('确认绑定'));

  await waitFor(() => assert.equal(calls.accept.length, 1));
  assert.equal(calls.accept[0].token, 'tok-portal-1', '令牌进入绑定载荷');
  assert.equal(calls.accept[0].tenantId, 't1');
  assert.ok(calls.accept[0].requestId, '绑定带 requestId');
  await waitFor(() => assert.ok(screen.getByText(/处理通道已关联/)));
  assert.equal(screen.getByText('提交', { selector: 'button' }).disabled, false, '绑定后提交可用');
  cleanup();
});

test('上传重试不换号：502 结果未知后确认框保留，再次确认仍用同一 requestId（通道面载荷）', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makePortal({ uploadImpl: (n) => {
    if (n === 1) throw unknownResultError(); // 第一次：后台结果未知
    return { ok: true, evidenceId: 'ev_new' };
  } });
  render(React.createElement(CustomerPortal, { wb, customerId: 'cus_1', onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByText('invoice')));
  await bindChannel();

  const file = new File([new Uint8Array([1, 2, 3, 4])], '发票.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } });
  fireEvent.click(screen.getByText('提交', { selector: 'button' }));

  // 确认框出现：一次提交语义 + 对账编号
  const dialog = await waitFor(() => screen.getByRole('dialog'));
  assert.ok(dialog.textContent.includes('常驻处理链'), '文案说明一次提交进处理链');
  assert.ok(dialog.textContent.includes('对账编号'), '确认框展示对账编号');

  fireEvent.click(screen.getByText('确认提交'));
  await waitFor(() => assert.equal(calls.upload.length, 1));
  const firstId = calls.upload[0].requestId;
  assert.ok(firstId, '第一次提交带 requestId');

  await waitFor(() => assert.ok(screen.getByText(/后台结果未知/)), '结果未知给业务语言提示');
  assert.ok(screen.getByRole('dialog'), '确认框保留（不静默关闭）');
  assert.ok(screen.getByText('用同一编号重试'), '重试按钮明确同一编号语义');

  fireEvent.click(screen.getByText('用同一编号重试'));
  await waitFor(() => assert.equal(calls.upload.length, 2));
  assert.equal(calls.upload[1].requestId, firstId, '重试沿用同一 requestId（不换号盲重）');
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null), '成功后确认框关闭');
  cleanup();
});

test('上传载荷稳定：一次确认动作的 kind/invitationId/文件字节随动作固定，customerId 正确', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makePortal();
  render(React.createElement(CustomerPortal, { wb, customerId: 'cus_1', onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByText('invoice')));
  await bindChannel();

  const file = new File([new Uint8Array([9, 9])], '合同.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } });
  fireEvent.click(screen.getByText('提交', { selector: 'button' }));
  fireEvent.click(await waitFor(() => screen.getByText('确认提交')));
  await waitFor(() => assert.equal(calls.upload.length, 1));
  const body = calls.upload[0];
  assert.equal(body.kind, 'invoice');
  assert.equal(body.invitationId, 'inv_bind_1', '绑定 invitationId 随载荷提交（不要求用户复制内部 ID）');
  assert.equal(body.contentType, 'application/pdf');
  assert.ok(body.contentBase64.length > 0, '文件字节真实进入通道载荷');
  assert.equal(body.tenantId, 't1');
  cleanup();
});
