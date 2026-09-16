#!/usr/bin/env node
// C24 子进程:Windows 原子写 EPERM 注入。对 fs/promises.rename 注入 EPERM 失败,
// 验证 atomicWriteJson:①有界重试后成功且无 .tmp 残留;②永久 EPERM → 结构化失败、
// 旧内容不损坏、临时文件被清理。结果 JSON 打到 stdout 末行。
// 用法: node test/atomic-write-eperm-child.mjs <targetPath> <failTimes>
import fsp from 'node:fs/promises';

const [, , targetPath, failTimesArg] = process.argv;
const failTimes = Number(failTimesArg ?? 2);
const realRename = fsp.rename.bind(fsp);
let failLeft = failTimes;
fsp.rename = async (a, b) => {
  if (failLeft > 0) { failLeft -= 1; const e = new Error('injected EPERM'); e.code = 'EPERM'; throw e; }
  return realRename(a, b);
};

const { atomicWriteJson } = await import('../src/ports.mjs');

const out = { failTimes };
try {
  await atomicWriteJson(targetPath, { v: 1, note: 'seed' });
  await atomicWriteJson(targetPath, { v: 2, note: 'written-under-injection' });
  out.afterInjection = JSON.parse(await fsp.readFile(targetPath, 'utf8'));
} catch (e) {
  out.afterInjectionError = { code: e.code, message: String(e.message) };
}
const base = targetPath.replace(/^.*[/\\]/, '');
const dir = targetPath.slice(0, targetPath.length - base.length - 1) || '.';
try {
  const names = await fsp.readdir(dir);
  out.tmpResidue = names.filter((n) => n.startsWith(`${base}.`) && n.endsWith('.tmp')).length;
} catch { out.tmpResidue = -1; }

// 永久 EPERM:独立目标文件,旧内容(预置)必须保持原样
const permPath = `${targetPath}.perm`;
try {
  await fsp.writeFile(permPath, JSON.stringify({ v: 'old' }), 'utf8');
  failLeft = Number.MAX_SAFE_INTEGER;
  try {
    await atomicWriteJson(permPath, { v: 'new' });
    out.permanentError = null; // 不应发生
  } catch (e) {
    out.permanentError = { code: e.code, oldIntact: JSON.parse(await fsp.readFile(permPath, 'utf8')).v === 'old' };
  }
  const names2 = await fsp.readdir(dir);
  out.permanentTmpResidue = names2.filter((n) => n.startsWith(`${base}.perm.`) && n.endsWith('.tmp')).length;
  await fsp.rm(permPath, { force: true });
} catch (e) {
  out.permanentSetupError = String(e.message);
}
console.log(JSON.stringify(out));
