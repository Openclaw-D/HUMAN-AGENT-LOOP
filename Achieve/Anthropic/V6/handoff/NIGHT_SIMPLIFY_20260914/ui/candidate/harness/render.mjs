// harness 渲染脚本（node render.mjs）：
// - 使用 site 现有 esbuild/react/react-dom（只读依赖，不安装任何包）；
// - 服务端渲染与 react-dom 同 bundle（单一 React 实例）；
// - 产出 out/*.html（各状态静态渲染 + 可交互页），供浏览器截图与键盘检查；
// - CSS 以身份映射方式注入（class 名与 .module.css 源码一致）。
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../../../../../jianwei-v3/site');
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

// site 现有依赖（只读使用，不安装）
const requireFromSite = createRequire(join(SITE, 'package.json'));
const { build } = requireFromSite('esbuild');

const cssSource = readFileSync(join(HERE, '../remote-interview.module.css'), 'utf8');

// .module.css → 身份映射对象（esbuild 插件）
const cssStubPlugin = {
  name: 'riv-css-stub',
  setup(b) {
    b.onLoad({ filter: /remote-interview\.module\.css$/ }, () => ({
      contents: `export default new Proxy({}, { get: (_t, p) => String(p) });`,
      loader: 'js',
    }));
  },
};

const common = {
  absWorkingDir: HERE,
  nodePaths: [join(SITE, 'node_modules')],
  alias: { 'next/link': join(HERE, 'src/link-stub.tsx') },
  jsx: 'automatic',
  bundle: true,
  logLevel: 'silent',
  plugins: [cssStubPlugin],
};

// 1) 服务端渲染：entry 内同时 import react-dom/server 与组件 → 单一 React 实例
const tmp = mkdtempSync(join(tmpdir(), 'riv-harness-'));
const serverBundle = join(tmp, 'server-render.cjs');
await build({
  ...common,
  entryPoints: [join(HERE, 'src/server-render.ts')],
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: serverBundle,
});

const { renderAll } = await import(pathToFileURL(serverBundle).href);
const rendered = renderAll();

const HEAD = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>riv-harness</title><style>
html,body{margin:0;padding:0}
${cssSource}
</style></head><body>`;

let index = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>候选状态索引</title>
<style>body{font-family:system-ui;margin:24px;line-height:1.6}li{margin:4px 0}</style></head><body>
<h1>远程尽调候选 · 状态索引（合成演示）</h1><ol>`;
for (const s of rendered) {
  writeFileSync(join(OUT, `${s.name}.html`), `${HEAD}${s.html}</body></html>`);
  index += `<li><a href="./${s.name}.html">${s.name} — ${s.label}</a></li>`;
}
index += `</ol><p>交互检查页：<a href="./interactive.html">interactive.html</a>（回调写入页面日志区）</p></body></html>`;
writeFileSync(join(OUT, 'index.html'), index);

// 2) 客户端可交互页（ready-live + 日志桩；浏览器内自含 React，无双实例问题）
await build({
  ...common,
  entryPoints: [join(HERE, 'src/client-mount.tsx')],
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: join(OUT, 'interactive.bundle.js'),
});

const interactive = `${HEAD}<div id="root"></div>
<div id="cblog" aria-live="polite" style="position:fixed;right:8px;bottom:8px;max-width:340px;max-height:40vh;overflow:auto;background:#fff;border:1px solid #ccc;border-radius:8px;padding:8px;font:12px/1.5 system-ui;z-index:99"></div>
<script src="./interactive.bundle.js"></script></body></html>`;
writeFileSync(join(OUT, 'interactive.html'), interactive);

// 内联版（供 about:blank/blob 场景使用，无外部资源引用）
const bundleSource = readFileSync(join(OUT, 'interactive.bundle.js'), 'utf8');
const interactiveInline = `${HEAD}<div id="root"></div>
<div id="cblog" aria-live="polite" style="position:fixed;right:8px;bottom:8px;max-width:340px;max-height:40vh;overflow:auto;background:#fff;border:1px solid #ccc;border-radius:8px;padding:8px;font:12px/1.5 system-ui;z-index:99"></div>
<script>${bundleSource}</script></body></html>`;
writeFileSync(join(OUT, 'interactive-inline.html'), interactiveInline);

rmSync(tmp, { recursive: true, force: true });
console.log(`OK: ${rendered.length} states + interactive -> ${OUT}`);
