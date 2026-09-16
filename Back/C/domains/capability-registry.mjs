// 任务 03 · S1 模型能力注册表：provider/model 对输入模态（text/image/audio/video）的
// 支持能力必须是显式注册的事实，不是假设。感知编排据此决定某材料能否被处理；
// 未注册/能力不足 → 返回 not-registered / unsupported（确定不可处理），
// 不假设现有文本 transport 天然支持完整视频流（任务书 §3）。
// 本轮零真实 provider：注册表只登记合成/离线能力；真实模型登记须另行批准（E2 门）。

import { stableStringify } from './util.mjs';

export const MODALITIES = Object.freeze(['text', 'image', 'audio', 'video']);

/** 材料种类 → 处理所需最低模态。 */
export const MATERIAL_MODALITY = Object.freeze({
  document: 'text',
  transcript: 'text',
  message: 'text',
  device_observation: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
});

let seq = 0;

/**
 * 创建能力注册表。entries: [{providerMode, modelVersion, input:[modality...],
 *   maxMediaBytes?: {image?, video?, audio?}, notes?, registeredBy, registeredAt}]
 * 校验失败抛错（失败关闭）：模态未知、重复注册项、字段缺失。
 */
export function createCapabilityRegistry(entries = []) {
  const byKey = new Map();
  for (const e of entries) {
    if (!e || typeof e !== 'object') throw new Error('能力注册项必须为对象');
    if (!['simulation', 'real_http'].includes(e.providerMode)) {
      throw new Error(`能力注册 providerMode 非法: ${String(e.providerMode)}`);
    }
    if (typeof e.modelVersion !== 'string' || e.modelVersion.trim() === '') {
      throw new Error('能力注册 modelVersion 必填');
    }
    if (!Array.isArray(e.input) || e.input.length === 0 || e.input.some((m) => !MODALITIES.includes(m))) {
      throw new Error(`能力注册 input 必须为非空模态数组(${MODALITIES.join('/')})`);
    }
    const key = `${e.providerMode}@${e.modelVersion}`;
    if (byKey.has(key)) throw new Error(`能力注册重复: ${key}`);
    byKey.set(key, Object.freeze({
      providerMode: e.providerMode,
      modelVersion: e.modelVersion,
      input: Object.freeze([...e.input]),
      maxMediaBytes: e.maxMediaBytes ? Object.freeze({ ...e.maxMediaBytes }) : null,
      notes: e.notes ?? null,
      registeredBy: e.registeredBy ?? 'task-03',
      registeredAt: e.registeredAt ?? null,
      fingerprint: stableStringify({ providerMode: e.providerMode, modelVersion: e.modelVersion, input: e.input }),
    }));
  }
  return {
    /** 查询：确定已注册 → 条目；未登记 → null（调用方按 unknown 处理，不得假设支持）。 */
    get(providerMode, modelVersion) {
      return byKey.get(`${providerMode}@${modelVersion}`) ?? null;
    },
    /** 材料可处理性判定（确定性）。 */
    checkMaterial({ providerMode, modelVersion, material }) {
      const entry = this.get(providerMode, modelVersion);
      if (!entry) {
        return { ok: false, code: 'PROVIDER_NOT_REGISTERED', messageZh: `provider ${providerMode}@${modelVersion} 未在能力注册表登记：按不可处理，不假设能力` };
      }
      const need = MATERIAL_MODALITY[material?.kind] ?? null;
      if (!need) {
        return { ok: false, code: 'UNKNOWN_MATERIAL_KIND', messageZh: `材料种类 ${String(material?.kind)} 未知：不猜` };
      }
      if (!entry.input.includes(need)) {
        return { ok: false, code: 'MODALITY_UNSUPPORTED', messageZh: `材料种类 ${material.kind} 需要 ${need} 模态，${entry.providerMode}@${entry.modelVersion} 仅支持 ${entry.input.join('/')}` };
      }
      if (entry.maxMediaBytes && material.bytes != null && typeof entry.maxMediaBytes[need] === 'number'
        && material.bytes > entry.maxMediaBytes[need]) {
        return { ok: false, code: 'MEDIA_TOO_LARGE', messageZh: `材料 ${material.materialId} 大小 ${material.bytes} 超过 ${need} 上限 ${entry.maxMediaBytes[need]}` };
      }
      return { ok: true, entry };
    },
    list() { return [...byKey.values()]; },
    fingerprint() { return stableStringify([...byKey.values()].map((e) => e.fingerprint)); },
  };
}

/** 本轮缺省注册表：仅合成文本能力（零真实模型；image/audio/video 未登记 = 不可处理）。 */
export function defaultSimulationRegistry() {
  return createCapabilityRegistry([
    {
      providerMode: 'simulation',
      modelVersion: 'deterministic-extractor@0.3',
      input: ['text'],
      notes: '任务 03 合成抽取编排：仅结构化文本材料；图像/音频/视频抽取器属任务 02/provider 范围，未登记即不可处理',
      registeredAt: '2026-09-16',
    },
  ]);
}
