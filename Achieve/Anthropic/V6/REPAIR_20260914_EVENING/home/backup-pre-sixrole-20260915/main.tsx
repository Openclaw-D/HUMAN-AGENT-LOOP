// B 候选隔离预览入口：仅演示挂载（本地模拟 A 的回调），不访问任何后端。
// 数据是合成演示；写回调只改本地预览状态，用于人工视觉检查与截图。
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import HomeOverview from '../site-mirror/app/v5-preview/home-overview';
import { demoOverview, demoMessageExtras, demoStoryAt } from './demo-data';
import type { MessageRecoverySlot, NoteRecoverySlot, SubmitOutcome } from '../site-mirror/app/v5-preview/home-contract';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function PreviewApp() {
  const [overview, setOverview] = useState(() => structuredClone(demoOverview));
  const [storyStep, setStoryStep] = useState(0);
  const [storyNotice, setStoryNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const story = useMemo(() => demoStoryAt(storyStep), [storyStep]);

  const withBusy = async (fn: () => void) => {
    setBusy(true);
    await delay(120);
    fn();
    setBusy(false);
  };

  const advance = (fromStepId: string) => {
    void withBusy(() => {
      setStoryStep((v) => Math.min(v + 1, 3));
      setStoryNotice(null);
      void fromStepId;
    });
  };

  const decide = (fromStepId: string, kind: 'confirm' | 'correct' | 'return') => {
    void withBusy(() => {
      setStoryNotice(
        kind === 'confirm'
          ? '已确认：按当前意见继续推进（人工判断已留档）。'
          : kind === 'correct'
            ? '已纠正：人工纠正意见已更新并入档，相关判断按更正后口径继续。'
            : '已退回：等待按退回意见补充材料，补充后重新进入人工判断。',
      );
      setStoryStep((v) => Math.min(v + 1, 3));
      void fromStepId;
    });
  };

  const restart = () => {
    void withBusy(() => {
      setStoryStep(0);
      setStoryNotice(null);
      setOverview((prev) => ({ ...structuredClone(demoOverview), version: prev.version + 1 }));
    });
  };

  const submitNote = async (_todoId: string, text: string): Promise<SubmitOutcome> => {
    await delay(120);
    setOverview((prev) => ({
      ...prev,
      version: prev.version + 1,
      todo: prev.todo === null ? null : { ...prev.todo, status: '待复核' },
      messages: [
        ...prev.messages,
        {
          id: `m-note-${prev.version + 1}`,
          fromKind: 'business',
          fromName: '业务 · 我（演示身份）',
          text,
          at: new Date().toISOString(),
          marks: [],
        },
      ],
    }));
    return { outcome: 'ok', replayed: false, requestId: `preview-${Date.now()}` };
  };

  const sendMessage = async (text: string): Promise<SubmitOutcome> => {
    await delay(120);
    setOverview((prev) => ({
      ...prev,
      version: prev.version + 1,
      messages: [
        ...prev.messages,
        {
          id: `m-msg-${prev.version + 1}`,
          fromKind: 'business',
          fromName: '业务 · 我（演示身份）',
          text,
          at: new Date().toISOString(),
          marks: [],
        },
      ],
    }));
    return { outcome: 'ok', replayed: false, requestId: `preview-${Date.now()}` };
  };

  return (
    <HomeOverview
      overview={overview}
      story={story}
      shared={null}
      storyBusy={busy}
      storyError={null}
      storyNotice={storyNotice}
      onAdvance={advance}
      onDecide={decide}
      onRestart={restart}
      restarting={false}
      onSubmitNote={submitNote}
      pendingNote={null as NoteRecoverySlot}
      onResolvePendingNote={async () => ({ result: 'ok' })}
      onDismissPendingNote={() => {}}
      resolvingPendingNote={false}
      onSendMessage={sendMessage}
      pendingMessage={null as MessageRecoverySlot}
      onResolvePendingMessage={async () => ({ result: 'ok' })}
      onDismissPendingMessage={() => {}}
      resolvingPendingMessage={false}
      recoveryPersistFailed={false}
      banners={[]}
      remoteHref="#remote-session"
      messageExtras={demoMessageExtras}
    />
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
