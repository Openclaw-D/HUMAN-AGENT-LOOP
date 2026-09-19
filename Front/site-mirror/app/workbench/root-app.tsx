// goal-03c 根入口：入口选择（真实办理 / 训练演示）→ 工作本流程（登录→目录→客户工作本）。
// 训练演示完整保留 v5-preview 六角色本地模拟（不连后台，纯本地）；两形态显式分开、永不混叠。
import { useState } from 'react';
import HomeOverview from '../v5-preview/home-overview';
import { useWorkbench } from '../../lib/workbench/use-workbench';
import { LoginPage } from './login-page';
import { CustomerDirectory } from './customer-directory';
import { CustomerWorkbench } from './customer-workbench';

type Mode = 'landing' | 'training' | 'workbench';

/** 同源优先：经 Edge --serve-front 托管时用同源；vite dev(3617) 下允许指向 Edge 地址。 */
function defaultEdgeBase(): string {
  const h = window.location;
  if (h.port === '3617' || h.port === '3618') return 'http://127.0.0.1:17935';
  return '';
}

export function RootApp() {
  const [mode, setMode] = useState<Mode>('landing');
  const [edgeOverride, setEdgeOverride] = useState('');
  const edgeBase = edgeOverride.trim() || defaultEdgeBase();
  const wb = useWorkbench(edgeBase);

  if (mode === 'training') {
    return (
      <div>
        <TrainingBanner onBack={() => setMode('landing')} />
        <HomeOverview />
      </div>
    );
  }

  if (mode === 'workbench') {
    if (!wb.session) return <LoginPage wb={wb} onLoggedIn={() => { /* 登录成功停留：目录由 session 出现后渲染 */ }} />;
    if (!wb.customerId) return <CustomerDirectoryOrWorkbenchGate wb={wb} />;
    return <CustomerWorkbench wb={wb} onBackToDirectory={() => wb.closeCustomer()} onLogout={() => wb.logout()} />;
  }

  return (
    <div className="wb-root">
      <div className="wb-login">
        <div className="wb-panel">
          <h1 style={{ fontSize: 20, marginTop: 0 }}>JW · 客户授信办理</h1>
          <p className="wb-note">人的正式判断与责任：AI 仅辅助，模型意见 authority=none。候选≠批准≠可用。</p>
          <div className="wb-card">
            <strong>真实办理</strong>
            <p className="wb-note">受控登录 → 客户目录 → 客户工作本：邀请、上传、处理、补证、核验、方案与正式决定（连接真实后台）。</p>
            <div className="wb-row">
              <button className="wb-btn" onClick={() => setMode('workbench')}>进入真实办理</button>
              <input className="wb-input" style={{ width: 220 }} value={edgeOverride} onChange={(e) => setEdgeOverride(e.target.value)} placeholder={`Edge 地址（默认 ${defaultEdgeBase() || '同源'}）`} aria-label="Edge 服务地址" />
            </div>
          </div>
          <div className="wb-card dim">
            <strong>训练演示</strong>
            <p className="wb-note">六角色本地合成模拟（不连任何后台；案例与对话全部为训练数据）。</p>
            <button className="wb-btn ghost" onClick={() => setMode('training')}>进入训练演示</button>
          </div>
          <p className="wb-note">受限能力如实标注：视频/三维未接入；受限邀请与原件预览待后台（IR-03-2/3）；页面内消息可完整办理，不显示"已送达企业微信"。</p>
        </div>
      </div>
    </div>
  );
}

/** 登录后：默认进入客户目录（客户为唯一工作上下文的入口）。 */
function CustomerDirectoryOrWorkbenchGate({ wb }: { wb: ReturnType<typeof useWorkbench> }) {
  return <CustomerDirectory wb={wb} onOpen={(id) => void wb.openCustomer(id)} />;
}

function TrainingBanner({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ background: '#fff4d6', borderBottom: '1px solid #e2c258', padding: '6px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
      <strong>训练演示（本地合成模拟，不连接后台）</strong>
      <span className="wb-spacer" />
      <button className="wb-btn small ghost" onClick={onBack}>返回入口</button>
    </div>
  );
}
