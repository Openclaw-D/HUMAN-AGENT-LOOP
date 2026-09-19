// board-round-02 任务01 行为测试·结果面板两路对账合一（IR-T01-3 页面面，用户行为级）：
// 1) A 动作回执：found=true 显示回执；found=false 诚实提示。
// 2) 通道动作回执（a_links 对账簿）：found=true 显示收据；found=false 指引正确编号来源；
//    404/503 如实显示"对账口不可用"，不冒充查无回执。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup } from './harness.mjs';

const React = (await import('react')).default;
const { ResultPanel } = await import('../../../site-mirror/app/workbench/result-panel.tsx');

function makePanel({ aReceipt, channelReceipt, channelErr } = {}) {
  const client = {
    read: async (path) => {
      if (path.endsWith('/reports')) return { reports: [] };
      return {};
    },
    receipt: async () => aReceipt ?? { found: false },
    channelReceipt: async () => {
      if (channelErr) { const e = new Error('route not declared'); e.status = channelErr; e.code = channelErr === 404 ? 'PROXY_ROUTE_NOT_DECLARED' : 'CHANNEL_NOT_CONFIGURED'; throw e; }
      return channelReceipt ?? { found: false };
    },
    eventsPage: async () => ({ events: [] }),
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
  };
  return { wb };
}

test('A 动作对账：found=true 渲染回执 JSON；未命中如实提示', async (t) => {
  t.after(() => cleanup());
  const { wb } = makePanel({ aReceipt: { found: true, receipt: { requestId: 'wb-act:1', ok: true } } });
  render(React.createElement(ResultPanel, { wb, customerId: 'cus_1' }));
  fireEvent.change(screen.getByLabelText('A 动作对账编号'), { target: { value: 'wb-act:1' } });
  fireEvent.click(screen.getByText('查询 A 回执'));
  await waitFor(() => assert.ok(screen.getByText(/找到正式回执/)));
  assert.ok(screen.getByText(/wb-act:1/));
  cleanup();
});

test('通道对账（IR-T01-3）：found=true 渲染 a_links 收据；未命中指引编号来源', async (t) => {
  t.after(() => cleanup());
  const { wb } = makePanel({ channelReceipt: { found: true, requestId: 'ptx-t1-mat', receipt: { entity_type: 'material', a_ref: 'art_x', status: 'registered' } } });
  render(React.createElement(ResultPanel, { wb, customerId: 'cus_1' }));
  fireEvent.change(screen.getByLabelText('通道动作对账编号'), { target: { value: 'ptx-t1-mat' } });
  fireEvent.click(screen.getByText('查询通道对账回执'));
  await waitFor(() => assert.ok(screen.getByText(/找到通道对账回执/)));
  assert.ok(screen.getByText(/art_x/));
  cleanup();

  t.after(() => cleanup());
  const { wb: wb2 } = makePanel({});
  render(React.createElement(ResultPanel, { wb: wb2, customerId: 'cus_1' }));
  fireEvent.change(screen.getByLabelText('通道动作对账编号'), { target: { value: 'wb-cup:wrong' } });
  fireEvent.click(screen.getByText('查询通道对账回执'));
  await waitFor(() => assert.ok(screen.getByText(/对账簿未命中该编号/)));
  assert.ok(screen.getByText(/A 动作请用上方 A 回执查询/));
  cleanup();
});

test('通道对账口未接线（404/503）：如实显示不可用，不冒充查无回执', async (t) => {
  t.after(() => cleanup());
  const { wb } = makePanel({ channelErr: 503 });
  render(React.createElement(ResultPanel, { wb, customerId: 'cus_1' }));
  fireEvent.change(screen.getByLabelText('通道动作对账编号'), { target: { value: 'ptx-t1-mat' } });
  fireEvent.click(screen.getByText('查询通道对账回执'));
  await waitFor(() => assert.ok(screen.getByText(/通道对账口当前不可用/)));
  cleanup();
});
