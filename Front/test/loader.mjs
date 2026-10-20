import { readFile } from 'node:fs/promises';
import ts from 'typescript';
export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format:'module', source:'export {};', shortCircuit:true };
  if (/\.(tsx|ts)$/.test(url)) {
    const source = await readFile(new URL(url),'utf8');
    return { format:'module', shortCircuit:true, source:ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText };
  }
  return next(url,context);
}
