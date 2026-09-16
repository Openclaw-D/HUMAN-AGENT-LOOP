// F 轮 · 六角色模拟对话 adapter（纯逻辑、可独立测试；异步接口、非固定顺序播放）。
// 输入输出契约（F4）：
//   submitCaseTurn({ state, scenario, roleId, text }) → Promise<TurnOutcome>
//   - 命中未完成脚本关键词 → accepted=true：事实证据版本+1（旧值留档消息流）、相关域任务
//     状态更新、追加域角色回复与见微汇总回复（origin=preset/model，不冒充真人/真实模型）。
//   - 已完成脚本重复提交 → accepted=false + 已登记提示（不重复记账）。
//   - 其余非空文本 → clarification（待澄清）：本地模拟不假装理解自由文本。
//   - 空文本 → 拒绝（不产生状态变化）。
// 角色切换不在本 adapter 内——切换是纯 UI 状态，零副作用（F3/F4）。
// 纯逻辑纪律（对齐 site rows-logic 模式）：本文件被 node --experimental-strip-types 直载测试，
// 不得有运行时值导入；类型经 import type 擦除。ROLE_LABEL 内联同步自 ./role-contract.ts（勿单边改）。
import type { CaseFact, CaseMessage, CaseScenario, CaseState, RoleId } from './role-contract';

export type { CaseState };

const ROLE_LABEL: Record<RoleId, string> = {
  jianwei: '见微',
  business: '业务',
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
};

export interface CaseTurnRequest {
  scenario: CaseScenario;
  state: CaseState;
  /** 当前所选演示视角（用户输入的发言归属）。 */
  roleId: RoleId;
  text: string;
  /** 可注入时钟（测试确定性；缺省取当前时间）。 */
  now?: () => Date;
}

export interface TurnOutcome {
  state: CaseState;
  accepted: boolean;
  clarification: string | null;
  /** 本次追加的消息（含用户输入回显；state.messages 已含）。 */
  appended: CaseMessage[];
}

function messageId(prefix: string, seed: number): string {
  return `${prefix}-${seed.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function stamp(now: () => Date): string {
  const d = now();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function initialCaseState(scenario: CaseScenario): CaseState {
  return {
    scenarioId: scenario.id,
    facts: scenario.facts.map((f: CaseFact) => ({ ...f })),
    messages: [
      {
        id: messageId('m', Date.now()),
        roleId: 'system',
        fromName: '系统',
        origin: 'preset',
        text: `案例「${scenario.title}」已载入（${scenario.industry}·${scenario.region}·${scenario.leaseMode}，合成假设）。补充证据后相关域将更新；全部为本地模拟，不执行正式审批。`,
        at: stamp(() => new Date()),
        marks: ['演示情景'],
      },
    ],
    completedTurns: [],
    taskStatus: {},
  };
}

export function userMessage(state: CaseState, roleId: RoleId, text: string, now: () => Date): CaseMessage {
  return {
    id: messageId('u', Date.now()),
    roleId,
    fromName: `${ROLE_LABEL[roleId]} · 我（演示视角）`,
    origin: 'human',
    text,
    at: stamp(now),
    marks: [],
  };
}

/** 主入口：处理一条用户输入（异步签名留给真实 adapter 替换；当前同步解析）。 */
export async function submitCaseTurn(req: CaseTurnRequest): Promise<TurnOutcome> {
  const { scenario, roleId, text } = req;
  const now = req.now ?? (() => new Date());
  const trimmed = text.trim();
  const base: CaseState = {
    ...req.state,
    facts: req.state.facts.map((f) => ({ ...f })),
    messages: [...req.state.messages],
    completedTurns: [...req.state.completedTurns],
    taskStatus: { ...req.state.taskStatus },
  };

  if (trimmed === '') {
    return { state: base, accepted: false, clarification: '输入为空：未提交任何内容。', appended: [] };
  }

  const userMsg = userMessage(base, roleId, trimmed, now);
  base.messages.push(userMsg);
  const appended: CaseMessage[] = [userMsg];

  // 已完成脚本重复提交：如实提示已登记（不重复记账、不更新版本）。
  const done = scenario.turns.find(
    (t) => base.completedTurns.includes(t.id) && t.keywords.some((k) => trimmed.includes(k)),
  );
  if (done) {
    const factLabels = done.effects
      .map((e) => {
        const f = base.facts.find((x) => x.id === e.factId);
        return f ? `${f.label}（v${f.evidenceVersion}）` : e.factId;
      })
      .join('、');
    const reply: CaseMessage = {
      id: messageId('r', Date.now()),
      roleId: 'system',
      fromName: '系统',
      origin: 'preset',
      text: `该证据已登记：${factLabels}，无需重复提交（本地模拟不重复记账）。`,
      at: stamp(now),
      marks: ['待澄清'],
    };
    base.messages.push(reply);
    appended.push(reply);
    return { state: base, accepted: false, clarification: null, appended };
  }

  // 命中未完成脚本 → 证据版本 +1、任务更新、域回复 + 见微汇总。
  const hit = scenario.turns.find((t) => !base.completedTurns.includes(t.id) && t.keywords.some((k) => trimmed.includes(k)));
  if (hit !== undefined) {
    base.completedTurns.push(hit.id);
    for (const e of hit.effects) {
      const fact = base.facts.find((x) => x.id === e.factId);
      if (fact !== undefined) {
        base.messages.push({
          id: messageId('v', Date.now()),
          roleId: 'system',
          fromName: '系统',
          origin: 'preset',
          text: `证据版本更新：${fact.label} v${fact.evidenceVersion} → v${e.version}；新值「${e.newValue}」（${e.status === 'confirmed' ? '已确认' : '来源支持'}）。`,
          at: stamp(now),
          marks: ['证据版本'],
        });
        fact.value = e.newValue;
        fact.evidenceVersion = e.version;
        fact.status = e.status;
      }
      for (const role of Object.keys(scenario.roleViews) as RoleId[]) {
        const rt = scenario.roleViews[role].tasks.find((t) => t.evidenceKey === hit.key);
        if (rt !== undefined) base.taskStatus[rt.id] = 'updated';
      }
    }
    for (const r of hit.replies) {
      base.messages.push({
        id: messageId('r', Date.now()),
        roleId: r.roleId,
        fromName: ROLE_LABEL[r.roleId],
        origin: r.origin,
        text: r.text,
        at: stamp(now),
        marks: r.origin === 'model' ? ['模型建议（模拟）'] : ['模拟回复'],
      });
      appended.push(base.messages[base.messages.length - 1]);
    }
    return { state: base, accepted: true, clarification: null, appended };
  }

  // 未命中：待澄清（不假装理解）。
  const pending = scenario.turns.filter((t) => !base.completedTurns.includes(t.id));
  const hint = pending.length > 0 ? `当前待补：${pending.map((t) => t.missingLabel).join('；')}。` : '本案例待补事项已全部登记。';
  const reply: CaseMessage = {
    id: messageId('c', Date.now()),
    roleId: 'system',
    fromName: '系统',
    origin: 'preset',
    text: `未能识别该补充内容（本地模拟仅支持本案例列出的证据类型，不假装真实模型理解）。${hint}`,
    at: stamp(now),
    marks: ['待澄清'],
  };
  base.messages.push(reply);
  appended.push(reply);
  return { state: base, accepted: false, clarification: reply.text, appended };
}

/** 见微跨域缺口汇总（供见微视角面板与输入提示；从运行态实时推导，不另存第二事实）。 */
export function jianweiGaps(scenario: CaseScenario, state: CaseState): string[] {
  const openTurns = scenario.turns.filter((t) => !state.completedTurns.includes(t.id));
  const gaps = openTurns.map((t) => `缺证：${t.missingLabel}`);
  const unknowns = scenario.unknowns.map((u) => `未知：${u}`);
  return [...gaps, ...unknowns];
}
