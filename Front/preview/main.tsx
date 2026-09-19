// JW 前端根入口（goal-03c）：真实办理工作本 + 训练演示（六角色本地合成模拟，纯本地不连后台）。
// 两形态在根入口显式分开；真实办理全部经 Edge BFF（凭据不落浏览器），权威属于人。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RootApp } from '../site-mirror/app/workbench/root-app';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);
