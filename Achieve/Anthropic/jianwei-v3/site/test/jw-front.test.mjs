import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('V4 management root is a multi-case organization overview', async () => {
  const [page, front, css, surfaceNav, workProjection] = await Promise.all([
    read('app/page.tsx'),
    read('app/jw-front.tsx'),
    read('app/jw-front.css'),
    read('app/v4-surface-nav.tsx'),
    read('app/work/demo-work-projection.ts'),
  ]);

  assert.match(page, /<V4SurfaceNav active="manage"/);
  assert.match(page, /<ManagementOverview/);
  assert.doesNotMatch(page, /RelationshipLayer|ModuleLink|MechanismRail|jw-v4-blueprint/);
  assert.match(css, /--jw-orange:#FF8A3D/i);
  assert.match(css, /\.jw-manage-overview/);

  for (const [href, label] of [['/', '管理与治理'], ['/work', '作业执行']]) {
    assert.match(surfaceNav, new RegExp(`href: '${href.replace('/', '\\/')}', label: '${label}'`));
  }
  // 旧「体系改进 / /evolve」入口已退役（/evolve 为兼容性重定向），不得回归
  assert.doesNotMatch(surfaceNav, /体系改进|'\/evolve'/);

  for (const term of ['管辖事项管理总览', '观察范围', '组织', '部门', '团队', '人员', '时间范围']) {
    assert.match(front, new RegExp(term));
  }
  for (const mode of ['直租', '存回', '新回']) assert.match(front, new RegExp(`mode: '${mode}'`));
  for (const state of ['管辖事项', '异常事项', '延误事项', '发生返工', '事项组合状态', '组织负荷']) {
    assert.match(front, new RegExp(state));
  }

  const overview = front.slice(front.indexOf('export function ManagementOverview'));
  const architecture = front.slice(front.indexOf('function ManagementArchitecture'), front.indexOf('export function ManagementOverview'));
  for (const term of ['先懂架构', '管理对象', '多个融资租赁事项', '专业作业主线', '管理观察', '共同支撑', '系统部门', '智能部门', '权威边界']) {
    assert.match(architecture, new RegExp(term));
  }
  for (const stage of ['业务', '政策', '信审', '商务', '资产']) assert.match(front, new RegExp(`stage: '${stage}'`));
  assert.match(architecture, /系统与智能能力不是审批人/);
  assert.match(architecture, /正式动作由具名人员或组织授权规则确认/);
  assert.ok(overview.indexOf('<ManagementArchitecture />') < overview.indexOf('className="jw-scope-panel"'));
  assert.ok(overview.indexOf('<ManagementArchitecture />') < overview.indexOf('className="jw-summary-grid"'));
  assert.doesNotMatch(architecture, /ModuleLink|九模块|自动起租/);
  for (const detail of ['异常与原因', '责任人 / 组织', '延误 / 返工', '影响', '责任人未知']) {
    assert.match(front, new RegExp(detail.replace('/', '\\/')));
  }
  assert.equal((front.match(/workLinked: true/g) ?? []).length, 1);
  assert.equal((front.match(/workLinked: false/g) ?? []).length, 3);
  const workCaseId = workProjection.match(/identity:\s*\{[\s\S]*?caseId: '([^']+)'/)?.[1];
  assert.ok(workCaseId, 'work surface must expose one fixed demo case identity');
  assert.match(front, new RegExp(`caseId: '${workCaseId}'[\\s\\S]*?workLinked: true`));
  assert.match(overview, /item\.workLinked[\s\S]*href=\{`\/work\?caseId=\$\{encodeURIComponent\(item\.caseId\)\}`\}/);
  assert.match(overview, /jw-case-readonly">事项作业未接入/);
  assert.equal((overview.match(/>进入事项<\/VinextSafeAnchor>/g) ?? []).length, 1);
  // 旧 /evolve 深链已随页面退役，不得回归
  assert.doesNotMatch(overview, /href="\/evolve/);

  assert.match(front, /function DemoBadge\(\)[\s\S]*演示数据/);
  assert.match(overview, /本页全部事项、人员与指标均为静态合成示例，不代表真实经营数据/);
  assert.match(overview, /未提供|未知/);
  assert.match(overview, /趋势变好，证据仍不足/);
  assert.match(overview, /样本 7 件 · 继续观察/);

  assert.match(front, /仅信审通过，待商务\/资产/);
  assert.match(overview, /信审通过不等于起租/);
  assert.doesNotMatch(overview, /自动起租|Agent.{0,12}审批人|Case 主线|ENTRY|PROFESSIONAL GATE/);
  for (const decorativeHeading of ['CASE', 'OWNER', 'PORTFOLIO', 'MANAGEMENT', 'OVERVIEW']) {
    assert.doesNotMatch(overview, new RegExp(`<h[1-3][^>]*>[^<]*${decorativeHeading}`, 'i'));
  }
});
