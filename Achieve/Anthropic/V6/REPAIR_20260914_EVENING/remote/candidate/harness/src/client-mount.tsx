// harness 客户端挂载：交互检查用（04-ready-live 态）。
// 视图切换/模拟开关/语音说明/转写演示在 harness 内为真实状态切换（经回调驱动），
// 写操作回调记录到页面日志区 #cblog 供断言；组件自身零存储。
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import RemoteInterviewStagePage from '../../../candidate/RemoteInterviewStagePage';
import { baseProps } from './shared-props';

function appendLog(msg: string): void {
  const box = document.getElementById('cblog');
  if (box === null) return;
  const line = document.createElement('div');
  line.textContent = `[cb] ${msg}`;
  box.appendChild(line);
}

const VOICE_NOTE = '语音输入未接入：当前环境无浏览器语音识别接口，产品也未集成 ASR 服务。可先用下方文字输入（语音接口已冻结，接入另行授权）。';

// ?state=error|empty：挂载对应骨架态；重试/创建会话回调在 harness 侧切回 ready
// （页面层职责模拟：phase 属 props，由 page 持有；组件只回调）。
function App() {
  const params = new URLSearchParams(window.location.search);
  const initialState = params.get('state');
  const base = baseProps({ log: appendLog });
  const [phase, setPhase] = useState<'loading' | 'empty' | 'error' | 'ready'>(
    initialState === 'error' || initialState === 'empty' ? initialState : 'ready',
  );
  const [viewMode, setViewMode] = useState<'business' | 'customer'>('business');
  const [simulationOn, setSimulationOn] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [extraTranscript, setExtraTranscript] = useState(0);
  return (
    <RemoteInterviewStagePage
      {...base}
      phase={phase}
      onRetryLoad={() => { setPhase('ready'); appendLog('onRetryLoad'); }}
      onCreateSession={() => { setPhase('ready'); appendLog('onCreateSession'); }}
      viewMode={viewMode}
      onViewModeChange={(m) => { setViewMode(m); appendLog(`onViewModeChange(${m})`); }}
      simulationOn={simulationOn}
      onSimulateToggle={(on) => { setSimulationOn(on); appendLog(`onSimulateToggle(${String(on)})`); }}
      voiceNote={voiceNote}
      onToggleVoiceNote={() => { setVoiceNote((v) => (v === null ? VOICE_NOTE : null)); appendLog('onToggleVoiceNote'); }}
      transcript={[
        ...base.transcript,
        ...Array.from({ length: extraTranscript }, (_, i) => ({ at: `19:0${5 + i}:00`, who: '实控人（合成）', text: `（合成转写事件 ${i + 1}）设备运行正常，共三台。` })),
      ]}
      onAddTranscriptDemo={() => { setExtraTranscript((n) => n + 1); appendLog('onAddTranscriptDemo'); }}
    />
  );
}

const el = document.getElementById('root');
if (el !== null) {
  createRoot(el).render(<App />);
}
