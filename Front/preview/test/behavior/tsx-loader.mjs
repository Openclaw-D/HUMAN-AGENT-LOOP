// 行为测试 TSX loader：node:test 直跑 site-mirror 的 .ts/.tsx 源（typescript.transpileModule，
// JSX → react/jsx-runtime），.css 原样空模块。仅测试进程使用；构建仍走 vite。
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TS_RE = /\.tsx?$/;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) {
    return { url: 'data:text/javascript,export default {};', shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    // 源码为 bundler 风格无扩展名导入（../../lib/workbench/wb-logic）：补探 .tsx/.ts。
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
      for (const ext of ['.tsx', '.ts']) {
        try { return await nextResolve(specifier + ext, context); } catch { /* 试下一扩展名 */ }
      }
    }
    throw e;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('data:')) return nextLoad(url, context);
  if (TS_RE.test(url)) {
    const file = fileURLToPath(url);
    const src = await readFile(file, 'utf8');
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        useDefineForClassFields: true,
      },
      fileName: file,
    }).outputText;
    return { format: 'module', source: out, shortCircuit: true };
  }
  return nextLoad(url, context);
}
