// V7 backend-next B 端口定义:编排器/worker 只依赖注入端口,不持有业务事实源。
// ⚠️ A 的 backend-next CONTRACT.md 未发布:下列端口签名是 B 本地假设,以
// src/contract/ 的适配点与 A 对账;B 不创建第二套共享合同。
// 默认实现均为 B 目录内隔离文件存储,仅供本 lane 实验与测试,不是产品事实源。

import { fs } from './deps.mjs';
import crypto from 'node:crypto';

/** 稳定哈希(sha256 hex),用于输入指纹与证据对账。 */
export function sha256hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 事实版本端口(A 负责;B 只读投影)。
 * 接口: currentVersions(projectId) → { factVersion: string, ruleVersion: string }
 * 语义:目标输入版本变化 = 已执行结果可能 stale(陈旧结果丢弃的判据之一)。
 */
export class FactVersionsPort {
  constructor(impl) { this.impl = impl; }
  async currentVersions(projectId) { return this.impl.currentVersions(projectId); }
}

/**
 * 请求回执端口(幂等权威;对 A ExecutionReceipt 的 B 本地镜像,语义对账项)。
 * 接口:
 *   get(requestId) → receipt | null
 *   put(receipt)   → void   receipt = { requestId, runId, stepId, attempt,
 *                                    phase: 'intent'|'terminal',
 *                                    sent: boolean|null,          // null=不可判定
 *                                    status, payloadHash, outcome?, at }
 * 语义(三分发送的落点):
 *   - 同 requestId 的 terminal 回执已存在 → 不得再次发起外部调用(重放直接复用)。
 *   - 仅 intent 无 terminal → 发送状态不可判定(可能已送达):恢复时判 unknown,
 *     不自动重发;只有显式人工重试(attempt+1,新 requestId)才允许再次调用。
 *   - lease 过期 ≠ API 未执行:是否执行过以回执为准,不以 lease 状态推断。
 */
export class ReceiptsPort {
  constructor(impl) { this.impl = impl; }
  async get(requestId) { return this.impl.get(requestId); }
  async put(receipt) { return this.impl.put(receipt); }
  /** 终态回执查询:恢复时节点重入先查业务回执再决定行为。 */
  async getTerminal(requestId) {
    const r = await this.impl.get(requestId);
    return r?.phase === 'terminal' ? r : null;
  }
}

/** B 本地默认回执存储:每 requestId 一个 JSON 文件(原子写)+ 内存读缓存。 */
export class LocalFileReceipts {
  constructor(dir) { this.dir = dir; this.mem = new Map(); }
  #path(requestId) { return `${this.dir}/receipts/${encodeURIComponent(requestId)}.json`; }
  async get(requestId) {
    if (this.mem.has(requestId)) return this.mem.get(requestId);
    try {
      const parsed = JSON.parse(await fs.readFile(this.#path(requestId), 'utf8'));
      this.mem.set(requestId, parsed);
      return parsed;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  async put(receipt) {
    await fs.mkdir(`${this.dir}/receipts`, { recursive: true });
    await atomicWriteJson(this.#path(receipt.requestId), receipt);
    this.mem.set(receipt.requestId, receipt);
  }
}

/** 内存回执(纯单测用;崩溃恢复测试必须用 LocalFileReceipts)。 */
export class MemoryReceipts {
  constructor() { this.mem = new Map(); }
  async get(requestId) { return this.mem.get(requestId) ?? null; }
  async put(receipt) { this.mem.set(requestId, receipt); }
}

/**
 * 计算工具端口(C 路交付对接点)。
 * 预期接口(C calculation-tool,签名以 C 交付为准):
 *   calculate({ toolName, inputs }) → { ok:true, toolVersion, inputHash, output, assumptions }
 *     | { ok:false, code:'MISSING_INPUT'|'INVALID_INPUT'|'UNKNOWN_TOOL', messageZh }
 * B 不实现业务计算;LocalStubCalculation 仅为编排测试桩(合成确定性,无行业含义),
 * C 交付后整体替换,不得保留双实现。
 */
export class ToolsPort {
  constructor(impl) { this.impl = impl; }
  async calculate(call) { return this.impl.calculate(call); }
}

export class LocalStubCalculation {
  constructor() { this.toolVersion = 'stub-calc-coverage@0.1.0'; }
  async calculate({ toolName, inputs }) {
    if (toolName !== 'calc:cash-flow-coverage') {
      return { ok: false, code: 'UNKNOWN_TOOL', messageZh: `未知工具 ${toolName}` };
    }
    const { monthlyOperatingCashFlow, monthlyDebtService, currency } = inputs ?? {};
    if (monthlyOperatingCashFlow === undefined || monthlyDebtService === undefined || currency === undefined) {
      return { ok: false, code: 'MISSING_INPUT', messageZh: '缺少计算输入(经营现金流/月还本付息/币种),不得补造数值' };
    }
    if (!(Number(monthlyDebtService) > 0)) {
      return { ok: false, code: 'INVALID_INPUT', messageZh: '月还本付息必须为正数' };
    }
    if (currency !== 'CNY') {
      return { ok: false, code: 'UNSUPPORTED_CURRENCY', messageZh: `暂不支持币种 ${currency}` };
    }
    const ratio = Number(monthlyOperatingCashFlow) / Number(monthlyDebtService);
    return {
      ok: true,
      toolVersion: this.toolVersion,
      inputHash: sha256hex(JSON.stringify({ monthlyOperatingCashFlow, monthlyDebtService, currency })),
      output: { coverageRatio: Number(ratio.toFixed(6)), unit: '倍(x)', formulaVersion: 'coverage-ratio@v0(合成演示公式,无审批含义)' },
      assumptions: ['输入均为同一期间月度口径', '未考虑税费与季节性(合成假设)'],
    };
  }
}

/** 原子 JSON 写:随机临时文件 + rename,并发写同一路径不互相踩临时名。 */
export async function atomicWriteJson(filePath, obj) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}
