// V7 backend-next B 可信路由:规则限定,不做任何模型自由路由。
// 硬边界:
//   - 路由决策只能来自显式规则表(注入配置);规则按序首中即用;每条决策必须携带
//     ruleId 供审计;无命中规则 = NO_ROUTE → 升级人工,不猜不编。
//   - 规则表本身先过校验:executor kind 合法、role 在允许清单内、stepId 唯一;
//     非法规则配置 = 失败关闭(拒绝路由),不带病运行。
//   - B 不决定"该不该做"(A 的目标/依赖/验收权威),只决定"怎么做"(哪个执行器、
//     什么角色、什么顺序)。
// 本模块纯逻辑无 IO;规则表从 JSON 配置载入(见 config/routes.example.json)。

import { EXECUTOR_KINDS, ERROR_CODES } from './codes.mjs';

/**
 * 校验规则表(启动时调用;非法即抛错失败关闭)。
 * @param config { roles: string[], rules: [{ruleId, when:{taskKind, role?, purpose?}, plan:[step]}] }
 * plan step: { stepId, kind:'model', role, purpose } | { stepId, kind:'tool', toolName }
 */
export function validateRouteConfig(config) {
  if (!config || !Array.isArray(config.roles) || config.roles.length === 0) {
    throw new Error('路由配置非法:roles 必须为非空数组');
  }
  if (!Array.isArray(config.rules) || config.rules.length === 0) {
    throw new Error('路由配置非法:rules 必须为非空数组');
  }
  const roles = new Set(config.roles.map(String));
  const seenRuleIds = new Set();
  config.rules.forEach((rule, i) => {
    if (!rule.ruleId || typeof rule.ruleId !== 'string') throw new Error(`路由配置非法:rules[${i}].ruleId 缺失`);
    if (seenRuleIds.has(rule.ruleId)) throw new Error(`路由配置非法:ruleId ${rule.ruleId} 重复`);
    seenRuleIds.add(rule.ruleId);
    if (!rule.when || typeof rule.when.taskKind !== 'string') throw new Error(`路由配置非法:${rule.ruleId}.when.taskKind 缺失`);
    if (rule.when.role !== undefined && !roles.has(String(rule.when.role))) {
      throw new Error(`路由配置非法:${rule.ruleId}.when.role ${rule.when.role} 不在 roles 清单`);
    }
    if (!Array.isArray(rule.plan) || rule.plan.length === 0) throw new Error(`路由配置非法:${rule.ruleId}.plan 不能为空`);
    const seenStepIds = new Set();
    rule.plan.forEach((step, j) => {
      if (!step.stepId || typeof step.stepId !== 'string') throw new Error(`路由配置非法:${rule.ruleId}.plan[${j}].stepId 缺失`);
      if (seenStepIds.has(step.stepId)) throw new Error(`路由配置非法:${rule.ruleId}.plan 步 ${step.stepId} 重复`);
      seenStepIds.add(step.stepId);
      if (!EXECUTOR_KINDS.includes(step.kind)) throw new Error(`路由配置非法:${rule.ruleId}.plan[${j}].kind ${step.kind} 非法`);
      if (step.kind === 'model') {
        if (!roles.has(String(step.role))) throw new Error(`路由配置非法:${rule.ruleId} 模型步 ${step.stepId} 角色 ${step.role} 不在 roles 清单`);
        if (!step.purpose) throw new Error(`路由配置非法:${rule.ruleId} 模型步 ${step.stepId} 缺 purpose`);
      }
      if (step.kind === 'tool' && !step.toolName) throw new Error(`路由配置非法:${rule.ruleId} 工具步 ${step.stepId} 缺 toolName`);
    });
  });
  return true;
}

/**
 * 创建路由器(规则表已过 validateRouteConfig)。
 * routeTask(task) →
 *   { ok:true, ruleId, plan }        首中规则;plan 为该任务的线性执行计划(前序=数组前项)
 *   { ok:false, code:'NO_ROUTE' }    无命中:升级人工,不猜
 */
export function createRouter(config) {
  validateRouteConfig(config);
  const rules = config.rules;
  return {
    configFingerprint() {
      return { ruleIds: rules.map((r) => r.ruleId), roles: [...config.roles] };
    },
    /**
     * @param task { taskId, taskKind, role?, purpose?, ... } 来自 A TaskAssignment
     */
    routeTask(task) {
      if (!task || typeof task.taskKind !== 'string') {
        return { ok: false, code: ERROR_CODES.NO_ROUTE, messageZh: '任务缺少 taskKind:无法路由,升级人工' };
      }
      for (const rule of rules) {
        const w = rule.when;
        if (w.taskKind !== task.taskKind) continue;
        if (w.role !== undefined && w.role !== task.role) continue;
        if (w.purpose !== undefined && w.purpose !== task.purpose) continue;
        // 首中即用;计划深拷贝,执行期不得改写规则表
        return { ok: true, ruleId: rule.ruleId, plan: rule.plan.map((s) => ({ ...s })) };
      }
      return { ok: false, code: ERROR_CODES.NO_ROUTE, messageZh: `任务种类 ${task.taskKind} 无路由规则:升级人工,不猜` };
    },
  };
}
