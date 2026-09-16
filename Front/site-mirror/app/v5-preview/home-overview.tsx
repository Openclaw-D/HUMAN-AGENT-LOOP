// F 轮 · 六角色商租案例预览组合根（V7/SIX_ROLE_COMMERCIAL_LEASING_20260915.md 授权）。
// 布局沿用 R1：根固定上下各 50%（无拖拽/resize）；上半=标题（编号左移连名）+ 案例入口 +
// 六角色图标 + 生命周期示意 + 完整四域矩阵；下半=项目沟通/当前待办 底部页签。
// 状态机：案例之间消息/事实/任务隔离（切换互不清空）；角色只是演示视角（切换零副作用，
// 不重开项目、不清消息）；所有角色共享同一案例事实；模拟对话经 role-mock-adapter（输入敏感、
// 证据版本化、未识别输入=待澄清，不假装真实模型理解）。
// 本地模拟闭环：不接 V7 真实后端、不调真实 LLM、无付费调用；倾向=模拟候选，非正式审批。
// 任务三 C2：新增"连接/模式提示 + 会话操作条"（用户显式连接真实后台才激活；默认仍为本地合成演示）。
import { useCallback, useState } from 'react';
import type { DomainRow as DomainRowData, SegmentState } from '../../lib/v5-preview/shared-types';
import { HomeHeader } from './home-header';
import { HomeRoleBar } from './home-role-bar';
import { HomeRoleView } from './home-role-view';
import { LifecycleStrip } from './lifecycle-strip';
import { DomainGrid } from './domain-grid';
import { HomeChat } from './home-chat';
import { SEED_SCENARIOS, findSeedScenario } from './role-cases';
import { initialCaseState, submitCaseTurn, type CaseState } from './role-mock-adapter';
import { ROLE_LABEL, type CaseMessage, type RoleId } from './role-contract';
import { useEdgeLive } from '../../lib/v5-preview/edge/use-edge-live';
import { EdgeSessionBar, EdgeStatusBar } from './edge-panels';
import styles from './home-overview.module.css';

type BottomTab = 'chat' | 'todo';

/** 案例消息 → 首页消息形状（复用 HomeChat 的来源徽章/原文展开/折叠）。 */
function toChatMessage(m: CaseMessage): {
  id: string;
  fromKind: 'business' | 'domain' | 'system';
  fromName: string;
  text: string;
  at: string;
  marks: string[];
  origin: 'human' | 'preset' | 'model';
} {
  return {
    id: m.id,
    fromKind: m.roleId === 'system' ? 'system' : m.origin === 'human' && m.roleId === 'business' ? 'business' : 'domain',
    fromName: m.fromName,
    text: m.text,
    at: m.at,
    marks: m.marks,
    origin: m.origin,
  };
}

export default function HomeOverview() {
  const [activeCaseId, setActiveCaseId] = useState(SEED_SCENARIOS[0].id);
  const [activeRole, setActiveRole] = useState<RoleId>('jianwei');
  const [tab, setTab] = useState<BottomTab>('chat');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [caseStates, setCaseStates] = useState<Record<string, CaseState>>(() =>
    Object.fromEntries(SEED_SCENARIOS.map((s) => [s.id, initialCaseState(s)])),
  );

  const scenario = findSeedScenario(activeCaseId) ?? SEED_SCENARIOS[0];
  const state = caseStates[scenario.id];

  const handleSend = useCallback(
    async (text: string) => {
      setBusy(true);
      setSendError(null);
      try {
        const outcome = await submitCaseTurn({ scenario, state, roleId: activeRole, text });
        setCaseStates((prev) => ({ ...prev, [scenario.id]: outcome.state }));
        // ok = 输入已提交并产生回显（含待澄清情形——回显即结果，不假装成功也不静默失败）。
        return { outcome: 'ok', replayed: false, requestId: `case-${Date.now()}` } as const;
      } catch {
        setSendError('本地模拟处理失败：输入未产生任何变化，可重试（合成演示）。');
        return { outcome: 'error', code: 'MOCK_FAILED', message: '本地模拟处理失败' } as const;
      } finally {
        setBusy(false);
      }
    },
    [scenario, state, activeRole],
  );

  const caseList = SEED_SCENARIOS.map((s) => ({ id: s.id, title: s.title, code: s.code }));
  const chatMessages = state.messages.map(toChatMessage);
  const chatExtras = Object.fromEntries(
    state.messages.map((m) => [m.id, { origin: m.origin } as { origin: 'human' | 'preset' | 'model' }]),
  );
  const domainRows = scenario.domains.map(
    (d): DomainRowData => ({
      domainId: d.domainId,
      name: d.name,
      segmentLabels: ['接收', '处理', '协同', '核验'],
      segments: d.segments as [SegmentState, SegmentState, SegmentState, SegmentState],
      judgmentStatus: d.judgmentStatus,
      judgmentText: d.judgmentText,
      summary: d.summary,
    }),
  );
  const stageIndex = Math.min(state.completedTurns.length, 4);
  const allDone = state.completedTurns.length >= scenario.turns.length;
  const edge = useEdgeLive();

  return (
    <div className={styles.root}>
      <EdgeStatusBar edge={edge} />
      <div className={styles.topArea}>
        <section className={styles.panel} aria-label="六角色案例预览（合成演示）">
          <div className={styles.headerRow}>
            <HomeHeader title={scenario.title} code={scenario.code} />
            <HomeRoleBar
              cases={caseList}
              activeCaseId={activeCaseId}
              activeRole={activeRole}
              onSelectCase={(id) => {
                // 切换案例：只切换显示的项目，其他案例的消息/待办原样保留（不清理）。
                setActiveCaseId(id);
              }}
              onSelectRole={(role) => {
                // 切换角色：纯 UI 视角，零副作用（不动任何案例状态）。
                setActiveRole(role);
              }}
            />
          </div>
          <div className={styles.band} aria-hidden="true" />
          <LifecycleStrip
            overview={{ scenario: 'approval' } as Parameters<typeof LifecycleStrip>[0]['overview']}
            storyStage={{ stageIndex, settled: allDone }}
          />
          <div className={styles.band} aria-hidden="true" />
          <DomainGrid domains={domainRows} relatedTodo={null} />
        </section>
      </div>

      <div className={styles.bottomArea}>
        <EdgeSessionBar edge={edge} />
        <div className={styles.tabPanel}>
          {tab === 'chat' ? (
            <HomeChat
              messages={chatMessages}
              messageExtras={chatExtras}
              onSendMessage={handleSend}
              pendingMessage={null}
              onResolvePendingMessage={async () => ({ result: 'ok' })}
              onDismissPendingMessage={() => {}}
              resolvingPending={false}
              recoveryPersistFailed={false}
              inputPlaceholder={`以${ROLE_LABEL[activeRole]}视角补充证据或留言（本地模拟；未识别内容将标待澄清）`}
            />
          ) : (
            <HomeRoleView scenario={scenario} state={state} roleId={activeRole} edge={edge} />
          )}
        </div>
        <div className={styles.tabBar} role="tablist" aria-label="下半内容切换">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={styles.tabBtn}
            data-active={tab === 'chat' ? 'true' : 'false'}
            onClick={() => setTab('chat')}
          >
            项目沟通
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'todo'}
            className={styles.tabBtn}
            data-active={tab === 'todo' ? 'true' : 'false'}
            onClick={() => setTab('todo')}
          >
            当前待办
          </button>
        </div>
      </div>

      {sendError !== null ? (
        <p className={styles.rootError} role="alert">{sendError}</p>
      ) : null}
      {busy ? (
        <p className={styles.srOnly} role="status">本地模拟处理中…</p>
      ) : null}
    </div>
  );
}
