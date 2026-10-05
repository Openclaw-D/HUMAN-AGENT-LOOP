// 默认入口＝真实后端驱动的业务工作台（集成轮 2026-09-25 · 03-live-front）：
//   角色选择（服务端身份目录）→ 客户目录（搜索/新建）→ 真实工作台（材料/决策/推进/历史/确认）。
// 合成训练演示（本地虚拟事件）只在显式 ?demo=virtual 查询参数下进入；不在默认路径、
// 不在任何故障回退路径出现——后端不可达时显示真实错误与重试，不降级到演示数据。
// demo 判定先于任何真实 hook：虚拟入口零后端调用，物理隔离两条路径。
import { CustomerDirectory } from './customer-directory';
import { TakeoffScreen } from '../takeoff/takeoff-screen';
import { RoleEntry } from '../takeoff/role-entry';
import { DesktopFrame } from '../takeoff/desktop-frame';
import { VirtualWorkbench } from '../takeoff/virtual-workbench';
import { useWorkbench } from '../../lib/workbench/use-workbench';
import '../takeoff/takeoff.css';
import '../takeoff/glass.css';
import '../takeoff/simple-workspace.css';

export function RootApp() {
  if (new URLSearchParams(window.location.search).get('demo') === 'virtual') {
    return <DesktopFrame><VirtualWorkbench /></DesktopFrame>;
  }
  return <DesktopFrame><RealWorkbenchRoot /></DesktopFrame>;
}

function RealWorkbenchRoot() {
  // vite dev/preview 端口下指向本机 takeoff Edge；生产 dist 由 Edge 同源托管（base=''）。
  // ?edge= 为开发/联调覆盖（03 受控本地接线契约）：仅 dev 端口（3617/3618）且目标为本机回环地址时生效；
  // 生产/其他端口一律忽略，凭据不会发往任意地址。缺省行为不变。
  const devPorts = ['3617', '3618'];
  const isDevPort = devPorts.includes(window.location.port);
  let edgeOverride: string | null = null;
  const overrideRaw = new URLSearchParams(window.location.search).get('edge');
  if (isDevPort && overrideRaw) {
    try { const u = new URL(overrideRaw); if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) edgeOverride = overrideRaw; } catch { /* 非法 URL 忽略 */ }
  }
  const edgeBase = edgeOverride ?? (isDevPort ? 'http://127.0.0.1:48214' : '');
  const wb = useWorkbench(edgeBase);
  return !wb.session
    ? <RoleEntry wb={wb} />
    : !wb.customerId
      ? <CustomerDirectory key={wb.session.principalId} wb={wb} onOpen={(id) => void wb.openCustomer(id)} />
      : <TakeoffScreen wb={wb} onBackToDirectory={() => wb.closeCustomer()} onLogout={() => wb.logout()} />;
}
