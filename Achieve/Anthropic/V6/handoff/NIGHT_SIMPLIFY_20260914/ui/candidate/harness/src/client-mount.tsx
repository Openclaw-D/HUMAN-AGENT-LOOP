// harness 客户端挂载：交互/键盘检查用（ready-live 态 + 桩回调记录到页面日志区）。
import { createRoot } from 'react-dom/client';
import RemoteInterviewPage from '../../../candidate/RemoteInterviewPage';
import { baseProps } from './shared-props';

function log(msg: string): void {
  const box = document.getElementById('cblog');
  if (box === null) return;
  const line = document.createElement('div');
  line.textContent = `[cb] ${msg}`;
  box.appendChild(line);
}

const el = document.getElementById('root');
if (el !== null) {
  createRoot(el).render(<RemoteInterviewPage {...baseProps({ log })} />);
}
