// 任务 03 · S3 域结果缓存：按 租户/客户、授权范围、inputHash、规则版本、模型/Prompt 版本
// 隔离（任务书 §5）。不同客户不能因文件 hash 相同共享带敏感上下文的模型结果（C25）。
// 陈旧保护：put 拒绝以更低水位覆盖更高水位（已失效候选不能被旧 worker 回写覆盖，C10）。
// 缓存非权威：读侧坏条目按 miss 处理（不抛错，缓存层损坏不升级为业务失败），写入经
// atomicWriteJson（EPERM 有界重试）。

import { fs } from '../deps.mjs';
import { atomicWriteJson } from '../ports.mjs';
import { stableJson } from '../graph/decision.mjs';
import { sha256hex } from '../ports.mjs';

export function cacheKey({ tenantId, customerId, authScope, inputHash, rulesetVersion, modelVersion, promptHash }) {
  for (const [k, v] of Object.entries({ tenantId, customerId, inputHash, rulesetVersion, modelVersion, promptHash })) {
    if (v === undefined || v === null || String(v).trim() === '') {
      throw Object.assign(new Error(`缓存键缺 ${k}:构造失败关闭(不允许无隔离键的缓存)`), { code: 'CACHE_KEY_INCOMPLETE' });
    }
  }
  return sha256hex(stableJson({ tenantId, customerId, authScope: authScope ?? 'default', inputHash, rulesetVersion, modelVersion, promptHash }));
}

export function createDomainCache({ dir }) {
  const mem = new Map();

  const fileOf = (key) => `${dir}/${encodeURIComponent(key)}.json`;

  async function get(key) {
    if (mem.has(key)) return mem.get(key);
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(fileOf(key), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      // 坏条目=miss（缓存非权威），不抛错升级为业务失败
      return null;
    }
    if (!parsed?.key || !parsed?.value) return null;
    mem.set(key, parsed);
    return parsed;
  }

  /**
   * @param p.key cacheKey 产物
   * @param p.value 缓存值
   * @param p.watermark {generation} 输入水位（单调；旧 worker 低代次回写被拒）
   * @param p.rulesetVersion 规则版本（键已含；再存一份供核对）
   */
  async function put({ key, value, watermark, rulesetVersion }) {
    if (!(Number.isInteger(watermark?.generation) && watermark.generation >= 1)) {
      throw Object.assign(new Error('缓存写入缺有效水位(拒绝无水位缓存)'), { code: 'CACHE_WATERMARK_REQUIRED' });
    }
    const existing = await get(key);
    if (existing && Number(existing.watermark?.generation ?? 0) > Number(watermark.generation)) {
      return { ok: false, code: 'CACHE_STALE_WRITE', messageZh: `拒绝旧 worker 回写:现存代次 ${existing.watermark.generation} > 本次 ${watermark.generation}(C10)` };
    }
    const rec = { key, value, watermark, rulesetVersion: rulesetVersion ?? null, at: new Date().toISOString() };
    await fs.mkdir(dir, { recursive: true });
    await atomicWriteJson(fileOf(key), rec);
    mem.set(key, rec);
    return { ok: true };
  }

  async function invalidate(key) {
    mem.delete(key);
    await fs.rm(fileOf(key), { force: true }).catch(() => {});
  }

  return { get, put, invalidate, _dir: dir };
}
