// harness 服务端渲染入口：react-dom/server 与组件同 bundle（单一 React 实例）。
import { renderToStaticMarkup } from 'react-dom/server';
import { STATES } from './states';

export function renderAll(): { name: string; label: string; html: string }[] {
  return STATES.map((s) => ({ name: s.name, label: s.label, html: renderToStaticMarkup(s.element) }));
}
