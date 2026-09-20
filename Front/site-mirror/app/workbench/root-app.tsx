// TAKEOFF-FA-1.0.0（02路）根入口：唯一默认业务入口=新客户首次回租准入与授信预评估
// （登录 → 客户目录 → TAKEOFF 主屏：二十格看板+六助手）。旧 v5-preview 六角色训练分支、
// 全生命周期默认展示、正式额度/融资操作入口已按 01_TAKEOFF_CORE_AUTHORITY §5 从默认路径移除
// （训练/复用文件清理见 docs/takeoff/first-admission-v1/implementation/02/CLEANUP.md）。
import { useState } from 'react';
import { useWorkbench } from '../../lib/workbench/use-workbench';
import { LoginPage } from './login-page';
import { CustomerDirectory } from './customer-directory';
import { TakeoffScreen } from '../takeoff/takeoff-screen';

type Mode = 'landing' | 'workbench';

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

  if (mode === 'workbench') {
    if (!wb.session) return <LoginPage wb={wb} onLoggedIn={() => { /* 登录成功停留：目录由 session 出现后渲染 */ }} />;
    if (!wb.customerId) return <CustomerDirectory wb={wb} onOpen={(id) => void wb.openCustomer(id)} />;
    return <TakeoffScreen wb={wb} onBackToDirectory={() => wb.closeCustomer()} onLogout={() => wb.logout()} />;
  }

  return (
    <div className="wb-root">
      <div className="wb-login">
        <div className="wb-panel">
          <h1 style={{ fontSize: 20, marginTop: 0 }}>JW · 首次回租准入与授信预评估</h1>
          <p className="wb-note">本轮只办理：新客户首次售后回租需求的准入与客户授信预评估，终点为有权人员确认预评估结论。</p>
          <p className="wb-note">预评估确认 ≠ 正式授信批准 ≠ 额度激活 ≠ 可提款。人的正式判断与责任：AI 仅辅助，模型意见 authority=none。</p>
          <div className="wb-card">
            <strong>进入办理（TAKEOFF 主屏）</strong>
            <p className="wb-note">受控登录 → 客户目录 → 二十格看板与六助手：一次上传、五领域协作、同版候选方案、受控结论确认（连接真实后台）。</p>
            <div className="wb-row">
              <button className="wb-btn" onClick={() => setMode('workbench')}>进入办理</button>
              <input className="wb-input" style={{ width: 220 }} value={edgeOverride} onChange={(e) => setEdgeOverride(e.target.value)} placeholder={`Edge 地址（默认 ${defaultEdgeBase() || '同源'}）`} aria-label="Edge 服务地址" />
            </div>
          </div>
          <p className="wb-note">受限能力如实标注：预评估确认须服务端目录 credit 角色与当前版本/硬门（服务端裁决，页面不提权）；语音/表情/字体/聊天记录/Skill/MCP/compact/ToDo/Goals 等扩展能力未接入（助手工具栏明确禁用，不伪装成功）；视频/三维未接入；真实模型/收费 API 未获本轮授权不调用。</p>
        </div>
      </div>
    </div>
  );
}
