// 行为测试共用设施：注册 TSX loader → 建 jsdom 全局 → 动态加载 RTL。
// 顺序纪律：loader 先注册；全局在导入 RTL/组件前就绪（react-dom 需要 document）。
import { register } from 'node:module';
register(new URL('./tsx-loader.mjs', import.meta.url));

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const g = globalThis;
g.window = dom.window;
g.document = dom.window.document;
try { Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true, writable: true }); } catch { /* node 自带 navigator 只读时不覆盖 */ }
g.sessionStorage = dom.window.sessionStorage;
g.localStorage = dom.window.localStorage;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.MouseEvent = dom.window.MouseEvent;
g.CustomEvent = dom.window.CustomEvent;
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
if (typeof dom.window.requestAnimationFrame === 'function') g.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
if (typeof dom.window.cancelAnimationFrame === 'function') g.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
g.IS_REACT_ACT_ENVIRONMENT = true;

export const rtl = await import('@testing-library/react');
export const { render, screen, fireEvent, waitFor, cleanup, within, act } = rtl;

/** 测试会话对象（EdgeSessionInfo 形状；无需真实凭据）。 */
export function fakeSession(principalId, roles = ['business']) {
  return { sessionId: `sess-${principalId}`, principalId, roles, expiresAt: Date.now() + 3_600_000 };
}

/** 502 未知结果错误（EdgeHttpError 形状子集）。 */
export function unknownResultError() {
  const e = new Error('upstream unknown');
  e.status = 502;
  e.code = 'UPSTREAM_UNKNOWN';
  return e;
}
