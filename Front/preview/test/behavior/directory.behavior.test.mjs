// 任务01 行为测试·客户目录（用户行为，非实现同构辅助函数）：
// 1) 新建客户只触发一次打开（修复：原实现建档后 wb.openCustomer + onOpen 二次打开）；
// 2) 搜索提示与任务03目录口径一致（名称/标识匹配由服务端裁决），持有标识者也可走"以标识打开"统一入口；
// 3) 最近访问按登录身份分区：换身份看不到上一个人的客户 ID。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, fakeSession } from './harness.mjs';

const React = (await import('react')).default;
const { CustomerDirectory } = await import('../../../site-mirror/app/workbench/customer-directory.tsx');

function makeWb(overrides = {}) {
  const calls = { openCustomer: [], createCustomer: [], directory: [] };
  const client = {
    directory: async (search, cursor) => {
      calls.directory.push({ search, cursor });
      return { kind: 'ok', customers: [{ customerId: 'cus_1', displayName: '青山机械（合成）', status: 'active' }], nextCursor: null };
    },
    createCustomer: async (body) => { calls.createCustomer.push(body); return { ok: true, customerId: 'cus_new_1' }; },
  };
  const wb = {
    client,
    session: fakeSession('biz-1'),
    error: null,
    setError: () => {},
    logout: () => {},
    openCustomer: async (cid) => { calls.openCustomer.push(cid); return true; },
    ...overrides,
  };
  return { wb, calls };
}

test('新建客户只打开一次：建档后 openCustomer 恰好一次，onOpen 不再触发第二次', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makeWb();
  const onOpenCalls = [];
  render(React.createElement(CustomerDirectory, { wb, onOpen: (id) => onOpenCalls.push(id) }));
  await waitFor(() => assert.ok(screen.getByText('青山机械（合成）')));

  fireEvent.change(screen.getByPlaceholderText('如 演示·青山机械制造（合成）'), { target: { value: '演示·测试客户' } });
  fireEvent.change(screen.getByPlaceholderText('如 USCC-DEMO-0001'), { target: { value: 'USCC-DEMO-9001' } });
  fireEvent.click(screen.getByText('建档并进入'));

  await waitFor(() => assert.equal(calls.openCustomer.length, 1));
  assert.equal(calls.createCustomer.length, 1);
  assert.deepEqual(calls.openCustomer, ['cus_new_1'], '建档后只经统一入口打开一次');
  assert.deepEqual(onOpenCalls, [], 'onOpen 不应再触发第二次打开');
});

test('搜索能力与任务03目录口径一致（名称/标识服务端裁决）；持有标识者可用"以标识打开"统一入口', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makeWb();
  const onOpenCalls = [];
  render(React.createElement(CustomerDirectory, { wb, onOpen: (id) => onOpenCalls.push(id) }));
  await waitFor(() => assert.ok(screen.getByText('青山机械（合成）')));

  assert.ok(screen.getByPlaceholderText('按客户名称/标识搜索（回车）'), '搜索提示与任务03目录口径一致（名称+标识，服务端裁决）');
  assert.ok(screen.getByText(/匹配口径由服务端目录决定/), '如实标注匹配口径由服务端决定');

  fireEvent.change(screen.getByLabelText('客户标识直接打开'), { target: { value: 'cus_direct_9' } });
  fireEvent.click(screen.getByText('以标识打开'));
  await waitFor(() => assert.deepEqual(onOpenCalls, ['cus_direct_9']), '标识直开与目录行同走 onOpen 统一入口');
  cleanup();

  // 换一个标识再试：入口不因标识内容变化；授权与否由 openCustomer 的服务端裁决结果呈现
  const wb2 = makeWb({ openCustomer: async () => false });
  const onOpenCalls2 = [];
  render(React.createElement(CustomerDirectory, { wb: wb2.wb, onOpen: (id) => onOpenCalls2.push(id) }));
  await waitFor(() => assert.ok(screen.getByText('青山机械（合成）')));
  fireEvent.change(screen.getByLabelText('客户标识直接打开'), { target: { value: 'cus_secret' } });
  fireEvent.click(screen.getByText('以标识打开'));
  await waitFor(() => assert.deepEqual(onOpenCalls2, ['cus_secret']));
});

test('最近访问按身份分区：身份 A 的最近客户不出现在身份 B 的目录页', async (t) => {
  t.after(() => cleanup());
  sessionStorage.clear();
  sessionStorage.setItem('jw-wb-recent:alice', JSON.stringify(['cus_a1']));

  const wbA = makeWb();
  wbA.wb.session = fakeSession('alice');
  render(React.createElement(CustomerDirectory, { wb: wbA.wb, onOpen: () => {} }));
  await waitFor(() => assert.ok(screen.getByText('cus_a1', { selector: 'button' })), '身份 A 能看到自己的最近访问');
  cleanup();

  const wbB = makeWb();
  wbB.wb.session = fakeSession('bob');
  render(React.createElement(CustomerDirectory, { wb: wbB.wb, onOpen: () => {} }));
  await waitFor(() => assert.ok(screen.getByText('青山机械（合成）')));
  assert.equal(screen.queryByText('cus_a1'), null, '身份 B 看不到 alice 的最近客户');
  cleanup();

  // 身份 A 打开目录行 → 记入 alice 桶（不串到别的桶）
  sessionStorage.clear();
  const wbA2 = makeWb();
  wbA2.wb.session = fakeSession('alice');
  const onOpenCalls = [];
  render(React.createElement(CustomerDirectory, { wb: wbA2.wb, onOpen: (id) => onOpenCalls.push(id) }));
  await waitFor(() => assert.ok(screen.getByText('青山机械（合成）')));
  fireEvent.click(screen.getByText('打开工作本'));
  await waitFor(() => assert.deepEqual(onOpenCalls, ['cus_1']));
  const aliceBucket = JSON.parse(sessionStorage.getItem('jw-wb-recent:alice'));
  assert.ok(aliceBucket.includes('cus_1'), '打开的客户记入当前身份的最近访问');
  assert.equal(sessionStorage.getItem('jw-wb-recent:bob'), null, '不产生其他身份的桶');
});
