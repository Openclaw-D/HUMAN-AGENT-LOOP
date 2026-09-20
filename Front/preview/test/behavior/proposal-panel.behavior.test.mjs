// 任务01 行为测试·方案·决定面板（用户行为）：
// 1) 内部引用系统关联：Gate 回执/分析运行/规则版本来自处理通道真实回执，界面显示来源；
//    工件依赖从现行材料清单勾选（业务对象），不再手填 artifactIds/runId/packageId/规则版本。
// 2) 缺真实回执时如实显示并阻断说明，不生成 Gate/运行状态。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, within, fakeSession } from './harness.mjs';

const React = (await import('react')).default;
const { ProposalPanel } = await import('../../../site-mirror/app/workbench/proposal-panel.tsx');

function makePanel({ channelOk = true } = {}) {
  const calls = { freezePackage: [], recordDomainResult: [] };
  const client = {
    read: async (path) => {
      if (path.includes('/artifacts')) {
        return { artifacts: [
          { artifactId: 'art_a', kind: 'bank_statement', current: true, factKey: 'cash_balance', materialMeta: { period: '2026-07' } },
          { artifactId: 'art_b', kind: 'invoice', current: true },
          { artifactId: 'art_old', kind: 'invoice', current: false },
        ] };
      }
      throw Object.assign(new Error('not found'), { status: 404, code: 'NOT_FOUND' });
    },
    listDomainExemptions: async () => ({ exemptions: [] }),
    channelStatus: async () => {
      if (!channelOk) throw Object.assign(new Error('down'), { status: 502, code: 'UPSTREAM_UNKNOWN' });
      return { tasks: [{ task_id: 'task_1' }], rulesetVersion: 'sim-pack@7' };
    },
    channelTask: async (id) => ({ task: { task_id: id, aOps: [
      { entity_type: 'run', local_id: 'cus_1:credit', a_ref: 'run_credit_1', status: 'registered' },
      { entity_type: 'gate', local_id: 'fin_1', a_ref: 'gate_r9', status: 'registered' },
    ] } }),
    freezePackage: async (customerId, body) => { calls.freezePackage.push({ customerId, body }); return { ok: true, packageId: 'pkg_new' }; },
    recordDomainResult: async (packageId, body) => { calls.recordDomainResult.push({ packageId, body }); return { ok: true }; },
    packageDetail: async () => ({ package: { packageId: 'pkg_base', revision: 1 }, domainResults: [] }),
  };
  const wb = {
    client,
    session: fakeSession('biz-1', ['credit', 'business', 'admin']),
    snapshot: {
      decisionStatus: { basis: { packageId: 'pkg_base', revision: 1, status: 'frozen', decisionReadiness: false } },
      assessments: [], facilities: [], financingRequests: [],
    },
    error: null,
    setError: () => {},
    refresh: async () => {},
  };
  return { wb, calls };
}

function creditRow() {
  const rows = screen.getAllByRole('row');
  return rows.find((r) => r.textContent.includes('信审域'));
}

test('技术字段系统关联：不再手填 Gate/工件/运行/包/规则版本；引用显示来源', async (t) => {
  t.after(() => cleanup());
  const { wb } = makePanel();
  render(React.createElement(ProposalPanel, { wb, customerId: 'cus_1' }));

  await waitFor(() => assert.ok(screen.getByText('已关联准入检查记录')), 'Gate 回执从通道回执读取并显示');
  assert.equal(screen.queryByText(/gate_r9|pkg_base|run_credit_1/), null, '前台隐藏后台引用');
  assert.ok(screen.getByText('已关联现行规则'), '规则版本系统关联显示');
  await waitFor(() => assert.ok(within(creditRow()).getByText(/银行流水 · 2026-07/)), '现行材料按业务对象呈现');
  assert.equal(screen.queryByText(/art_old/), null, '已取代材料不进勾选清单');

  // 旧的手填技术输入框不再存在
  assert.equal(screen.queryByPlaceholderText('从处理通道读取或粘贴'), null, 'Gate 回执不再手填');
  assert.equal(screen.queryByPlaceholderText(/run-xxx/), null, '分析运行不再手填');
  assert.equal(screen.queryByPlaceholderText('包绑定提案（BASIS_PACKAGE_REQUIRED 门）'), null, '依据包不再手填');
  assert.equal(screen.queryByPlaceholderText('现行工件 ID'), null, '工件 ID 不再手填（默认视图为勾选）');
  cleanup();
});

test('冻结依据包：勾选业务材料 → 系统组装 domainDeps/Gate 引用/规则版本提交', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makePanel();
  render(React.createElement(ProposalPanel, { wb, customerId: 'cus_1' }));
  await waitFor(() => assert.ok(screen.getByText('已关联准入检查记录')));

  const row = creditRow();
  const cb = within(row).getByRole('checkbox', { name: /银行流水/ });
  fireEvent.click(cb);

  fireEvent.click(screen.getByText('保存本次材料依据'));
  const dialog = await waitFor(() => screen.getByRole('dialog'));
  assert.ok(dialog.textContent.includes('准入检查结果已关联'), '确认框显示检查已关联而非编号');
  assert.ok(!dialog.textContent.includes('gate_r9'));
  assert.ok(dialog.textContent.includes('信审域×1件'), '确认框显示勾选的材料数');
  fireEvent.click(within(dialog).getByText('确认提交'));

  await waitFor(() => assert.equal(calls.freezePackage.length, 1));
  const body = calls.freezePackage[0].body;
  assert.equal(body.gateReceiptId, 'gate_r9', 'Gate 引用来自真实回执');
  assert.deepEqual(body.domainDeps[0], {
    domain: 'credit', artifactIds: ['art_a'], factKeys: ['cash_balance'], rulePackVersion: 'sim-pack@7',
  }, '工件/事实键/规则版本由系统从清单与回执组装');
  cleanup();
});

test('登记域意见：运行引用下拉取自通道回执；提交携带真实 runId 与当前依据包', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makePanel();
  render(React.createElement(ProposalPanel, { wb, customerId: 'cus_1' }));
  await waitFor(() => assert.ok(screen.getByText('已关联准入检查记录')));

  const runSelect = screen.getByRole('combobox', { name: '分析运行引用' });
  assert.equal(runSelect.value, 'run_credit_1', '提交引用仍来自真实回执');
  assert.ok(!runSelect.textContent.includes('run_credit_1'), '显示业务名称');

  fireEvent.change(screen.getByRole('combobox', { name: '登记域' }), { target: { value: 'credit' } });
  // 与真实办理一致：先勾选该域依赖的现行材料，再登记基于这些材料的域意见
  fireEvent.click(within(creditRow()).getByRole('checkbox', { name: /银行流水/ }));
  fireEvent.change(screen.getByPlaceholderText('该域对当前材料/事实的结论与关注点（正式性仍属人）'), { target: { value: '流水显示经营现金为正，与申报一致' } });
  fireEvent.click(screen.getByText('保存专业意见'));

  const dialog = await waitFor(() => screen.getByRole('dialog'));
  assert.ok(dialog.textContent.includes('已完成的分析'), '确认框显示已关联分析');
  assert.ok(!dialog.textContent.includes('pkg_base'), '内部目标包不显示在业务界面');
  fireEvent.click(within(dialog).getByText('确认提交'));

  await waitFor(() => assert.equal(calls.recordDomainResult.length, 1));
  const { packageId, body } = calls.recordDomainResult[0];
  assert.equal(packageId, 'pkg_base');
  assert.equal(body.analysisRun.runId, 'run_credit_1', 'runId 来自通道回执，非手填');
  assert.equal(body.domain, 'credit');
  assert.equal(body.opinion.authority, 'none');
  assert.deepEqual(body.deps.artifactIds, ['art_a'], 'deps 引用勾选的现行材料');
  cleanup();
});

test('无真实回执时如实显示：Gate 未读到、运行下拉缺失并禁用登记，不生成假状态', async (t) => {
  t.after(() => cleanup());
  const { wb } = makePanel({ channelOk: false });
  render(React.createElement(ProposalPanel, { wb, customerId: 'cus_1' }));

  await waitFor(() => assert.ok(screen.getByText(/材料处理结果暂时无法读取/)), '通道读取失败如实显示');
  assert.ok(screen.getByText(/尚未取得准入检查记录/), 'Gate 缺失如实显示');
  assert.ok(screen.getByText(/本专业分析尚未完成/), '运行缺失如实显示');
  const registerBtn = screen.getByText('保存专业意见');
  assert.equal(registerBtn.disabled, true, '无真实运行回执时登记按钮禁用（不假装可登记）');
  cleanup();
});
