// harness 渲染脚本（node render.mjs）：
// - 使用 site 现有 esbuild/react/react-dom（只读依赖，不安装任何包）；
// - 服务端渲染与 react-dom 同 bundle（单一 React 实例）；
// - 产出 out/*.html（各状态静态渲染 + 可交互页），供浏览器截图与断言；
// - CSS 以身份映射方式注入（class 名与 .module.css 源码一致）。
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../../../../jianwei-v3/site');
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
const tmp = mkdtempSync(join(tmpdir(), 'riv3-harness-'));
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
<title>riv3</title>
<style>html,body{margin:0;padding:0}${cssSource}</style></head><body>`;

for (const s of rendered) {
  writeFileSync(join(OUT, `${s.name}.html`), `${HEAD}${s.html}</body></html>`);
}

// 2) 交互页（外链 bundle 版）：挂载 04-ready-live 态，回调记录到 #cblog
const clientBundle = join(OUT, 'interactive.js');
await build({
  ...common,
  entryPoints: [join(HERE, 'src/client-mount.tsx')],
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: clientBundle,
});

writeFileSync(join(OUT, 'interactive.html'), `${HEAD}<div id="root"></div><hr style="border:0;border-top:1px solid #ddd"><div id="cblog" style="font:12px/1.6 monospace;padding:8px;color:#333"></div><script src="./interactive.js"></script></body></html>`);

console.log(`rendered ${rendered.length} states + interactive.html -> ${OUT}`);
