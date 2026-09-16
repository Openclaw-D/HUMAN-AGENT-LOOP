// B 候选隔离预览入口（F 轮）：六角色商租案例预览，纯本地模拟。
// 不访问任何后端/真实模型/付费调用；案例与角色状态全部在浏览器内。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import HomeOverview from '../site-mirror/app/v5-preview/home-overview';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <HomeOverview />
  </StrictMode>,
);
