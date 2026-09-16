// V4-LIFE durable command journal 文件适配器（Lane L-J）
// 契约：docs/v4/CONTRACT.md §15（“任何持久化部署前必须补 durable command journal”）。
// 实现 lib/v4life/types.ts 的 V4LifeCommandJournal port；与 file-event-log.ts（§9 事件账本）成对使用。
// 存储：<dir>/commands-<caseId>.jsonl，每行一个 JSON.stringify(record)，UTF-8；demo 规模全同步实现。
// commands- 前缀与 file-event-log 的 <caseId>.jsonl 同目录共存不冲突，便于两个适配器共享 V4LIFE_DATA_DIR。
// 语义（与 file-event-log.ts 同源，差异均为 journal 追加语义所必需）：
//   - caseId 安全校验：仅允许 [A-Za-z0-9._-]，且不得为 "." 或 ".."（防路径穿越），违规 INVALID_ENGINE_INPUT；
//   - append：记录形状校验先行（违规 INVALID_ENGINE_INPUT，绝不写文件），命中后单次 appendFileSync
//     落盘（单行，无部分写入）。同 commandId 重复 append 追加为多条、不去重：append-only 免去
//     “读改写”竞态与半写风险；引擎层 loadAll 顺序合并、同 commandId 以最后一条为准（引擎不产生重复，
//     仅理论边界，如外部进程误写）；
//   - loadAll：逐行 JSON.parse + 记录形状校验 + record.caseId 与请求 caseId 一致性校验，
//     任何一行损坏（非法 JSON / 缺字段 / 类型不符 / caseId 错位）即 INVALID_ENGINE_INPUT
//     （失败关闭，detail 带行号）；返回值全部深克隆；
//   - clear 删除持久化文件（不存在时静默）：供与 eventLog.clear 成对清盘（port 之外的适配器扩展，
//     同 file-event-log.ts 的 clear/listCaseIds 先例）。

import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { V4LifeError } from './engine.ts';
import type { V4LifeCommandJournal, V4LifeCommandJournalRecord } from './types.ts';

// P1：command 枚举含 'verification'（Human 核验命令）；P1-BE-01（2026-09-04）追加 'context_batch'
//（收集窗口命令族 open/appendInputEvent/stabilize/seal，此前仅进程内缓存、重启后幂等丢失）。
// 枚举为超集向后兼容：旧 journal 文件不含 'context_batch' 记录，照常可读。
const COMMAND_KINDS: ReadonlySet<string> = new Set([
  'evidence', 'work', 'decision', 'verification', 'context_batch',
]);

export function createCommandJournal(options: { dir: string }): V4LifeCommandJournal & {
  clear(caseId: string): void;
} {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    invalidInput('options 必须是对象');
  }
  if (typeof options.dir !== 'string' || options.dir.length === 0) {
    invalidInput('options.dir 必须是非空 string');
  }
  const dir = options.dir;
  mkdirSync(dir, { recursive: true });

  function invalidInput(detail: string): never {
    const error = new V4LifeError('INVALID_ENGINE_INPUT');
    (error as Error & { detail?: string }).detail = `v4life command-journal: ${detail}`;
    throw error;
  }

  function filePath(caseId: string): string {
    return join(dir, `commands-${caseId}.jsonl`);
  }

  function requireCaseId(caseId: unknown): string {
    if (typeof caseId !== 'string' || caseId.length === 0) {
      invalidInput('caseId 必须是非空 string');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(caseId) || caseId === '.' || caseId === '..') {
      invalidInput(`caseId 只允许 [A-Za-z0-9._-] 且不得为 "." 或 ".."，收到 ${JSON.stringify(caseId)}`);
    }
    return caseId;
  }

  /** 记录形状校验：append（写前）与 loadAll（读后）共用同一套规则，损坏行失败关闭。 */
  function validateRecord(candidate: unknown, caseId: string, where: string): V4LifeCommandJournalRecord {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      invalidInput(`${where} 必须是 journal 记录对象`);
    }
    const record = candidate as Record<string, unknown>;
    if (record.caseId !== caseId) {
      invalidInput(`${where}.caseId=${JSON.stringify(record.caseId)} 与请求 caseId 不一致`);
    }
    if (typeof record.commandId !== 'string' || record.commandId.length === 0) {
      invalidInput(`${where}.commandId 必须是非空 string`);
    }
    if (typeof record.command !== 'string' || !COMMAND_KINDS.has(record.command)) {
      invalidInput(
        `${where}.command 必须是 'evidence' | 'work' | 'decision' | 'verification' | 'context_batch'`,
      );
    }
    if (typeof record.commandKey !== 'string' || record.commandKey.length === 0) {
      invalidInput(`${where}.commandKey 必须是非空 string`);
    }
    if (typeof record.result !== 'object' || record.result === null || Array.isArray(record.result)) {
      invalidInput(`${where}.result 必须是结果对象`);
    }
    const result = record.result as Record<string, unknown>;
    // 引擎只在 accepted 路径写 journal；rev 为命令完成时的事件总数（≥1，CASE_INITIALIZED 恒在）
    if (result.status !== 'accepted') {
      invalidInput(`${where}.result.status 必须是 'accepted'`);
    }
    if (typeof result.rev !== 'number' || !Number.isInteger(result.rev) || result.rev < 1) {
      invalidInput(`${where}.result.rev 必须是 >= 1 的整数`);
    }
    if (typeof record.at !== 'string' || record.at.length === 0) {
      invalidInput(`${where}.at 必须是非空 string`);
    }
    return candidate as V4LifeCommandJournalRecord;
  }

  function readRecords(id: string): V4LifeCommandJournalRecord[] {
    const file = filePath(id);
    if (!existsSync(file)) {
      return [];
    }
    const content = readFileSync(file, 'utf8');
    if (content.length === 0) {
      return [];
    }
    const rawLines = content.split('\n');
    if (rawLines[rawLines.length - 1] === '') {
      rawLines.pop(); // 每条记录行都以 \n 结尾，末尾空串是换行符产物
    }
    const records: V4LifeCommandJournalRecord[] = [];
    for (let index = 0; index < rawLines.length; index += 1) {
      const where = `loadAll: 第 ${index + 1} 行`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawLines[index]);
      } catch {
        invalidInput(`${where}不是合法 JSON`);
      }
      records.push(validateRecord(parsed, id, where));
    }
    return records;
  }

  return {
    append(caseId, record) {
      const id = requireCaseId(caseId);
      const validated = validateRecord(record, id, 'append: record');
      appendFileSync(filePath(id), `${JSON.stringify(validated)}\n`, 'utf8');
    },

    loadAll(caseId) {
      const id = requireCaseId(caseId);
      return readRecords(id).map((record) => structuredClone(record));
    },

    clear(caseId) {
      const id = requireCaseId(caseId);
      try {
        unlinkSync(filePath(id));
      } catch (error) {
        if ((error as { code?: string })?.code !== 'ENOENT') {
          throw error;
        }
      }
    },
  };
}
