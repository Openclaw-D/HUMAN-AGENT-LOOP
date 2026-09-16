// 材料核验未决命令存储适配（ENG01-R1，2026-09-04）——纯 TS、无 JSX、零 window 顶层访问。
// 契约 R1（Ctrl 中途审查修订）：仅 sessionStorage 语义（实现由调用方注入，WorkShell 注入
// window.sessionStorage）；版本封装 1；唯一 key jw:v4:verification:pending:v1；
// 不读不清理其他 key；无 TTL。
// 严格形状（save/load/clear 共用同一校验）：envelope 恰为 {version, command} 两键，
// command 恰为七字段（任何额外/缺失键 → invalid_shape）；字符串与 HTTP 边界一致：
// commandId/caseId/evidenceId/actorId/reason 一律 trim() 后非空（全空格非法），
// reason 长度按原始 value.length ≤ 2000（首尾空白计入；trim 仅用于非空判断；
// 对齐 asNonEmptyString(value, 2000) / MAX_SUMMARY_LENGTH）；
// verificationStatus 恰四枚举；expectedRev 非负整数。
// 失败关闭：不可访问 / 写入、读取、清除失败 / JSON 损坏 / 版本不符 / 形状非法 / 命令编号不匹配，
// 一律返回失败原因、不产出命令、不静默丢记录、不自动修复或覆盖损坏记录、不删除非目标记录。
// 存储经参数注入：本模块可在 Node/TEST 环境直接 import 执行（不触任何全局对象）。

import type { V4LifeVerificationTarget } from '../../lib/v4life/types.ts';

/** 唯一存储 key（版本封装 1；类型恰为字面量 'jw:v4:verification:pending:v1'）。 */
export const VERIFICATION_PENDING_STORAGE_KEY = 'jw:v4:verification:pending:v1' as const;

/** 与 HTTP 边界 asNonEmptyString(reason, 2000) / engine MAX_SUMMARY_LENGTH 对齐。 */
const MAX_REASON_LENGTH = 2000;

/** envelope 恰为两键。 */
const ENVELOPE_KEYS: readonly string[] = ['version', 'command'];

/** command 恰为七字段。 */
const PENDING_COMMAND_KEYS: readonly string[] = [
  'commandId',
  'caseId',
  'evidenceId',
  'actorId',
  'verificationStatus',
  'reason',
  'expectedRev',
];

/** 最小存储端口（sessionStorage 的结构子集；由调用方注入，禁止本模块自取全局）。 */
export type VerificationPendingStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** 未决命令七字段冻结形状（与面板 VerificationCommand 结构一致）。 */
export type VerificationPendingCommand = {
  commandId: string;
  caseId: string;
  evidenceId: string;
  actorId: string;
  verificationStatus: V4LifeVerificationTarget;
  reason: string;
  expectedRev: number;
};

/** 存储记录（版本封装 1；envelope 恰为两键）。 */
export type VerificationPendingRecord = {
  version: 1;
  command: VerificationPendingCommand;
};

export type VerificationPendingFailureReason =
  | 'unavailable'
  | 'empty'
  | 'read_failure'
  | 'write_failure'
  | 'clear_failure'
  | 'corrupt'
  | 'unsupported_version'
  | 'invalid_shape'
  | 'id_mismatch';

export type VerificationPendingSaveResult =
  | { ok: true }
  | { ok: false; reason: VerificationPendingFailureReason };

export type VerificationPendingLoadResult =
  | { ok: true; command: VerificationPendingCommand }
  | { ok: false; reason: VerificationPendingFailureReason };

export type VerificationPendingClearResult =
  | { ok: true }
  | { ok: false; reason: VerificationPendingFailureReason };

export type VerificationPendingStore = {
  save(command: VerificationPendingCommand): VerificationPendingSaveResult;
  load(): VerificationPendingLoadResult;
  clear(expectedCommandId: string): VerificationPendingClearResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PENDING_TARGET_STATUSES: readonly string[] = [
  'verified',
  'unverified',
  'contradicted',
  'stale',
];

/** 自有键恰为给定键集（无多余、无缺失）。 */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) {
    return false;
  }
  const expected = new Set(keys);
  for (const key of actual) {
    if (!expected.has(key)) {
      return false;
    }
  }
  return true;
}

/** 字符串且 trim() 后非空（全空格非法；与 HTTP 边界一致）。 */
function isBoundedToken(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 严格七字段形状校验（恰七键；save/load/clear 共用）。 */
function isPendingCommandShape(value: unknown): value is VerificationPendingCommand {
  if (!isRecord(value)) {
    return false;
  }
  if (!hasExactKeys(value, PENDING_COMMAND_KEYS)) {
    return false;
  }
  if (!isBoundedToken(value.commandId)) {
    return false;
  }
  if (!isBoundedToken(value.caseId)) {
    return false;
  }
  if (!isBoundedToken(value.evidenceId)) {
    return false;
  }
  if (!isBoundedToken(value.actorId)) {
    return false;
  }
  if (typeof value.verificationStatus !== 'string') {
    return false;
  }
  if (!PENDING_TARGET_STATUSES.includes(value.verificationStatus)) {
    return false;
  }
  if (!isBoundedToken(value.reason)) {
    return false;
  }
  // 长度口径与 HTTP asNonEmptyString(value, 2000) 一致：按原始 value.length 限制（首尾空白计入）；
  // trim 仅用于非空判断。
  if ((value.reason as string).length > MAX_REASON_LENGTH) {
    return false;
  }
  if (typeof value.expectedRev !== 'number' || !Number.isInteger(value.expectedRev)) {
    return false;
  }
  if (value.expectedRev < 0) {
    return false;
  }
  return true;
}

/** 读取并严格校验存储记录；empty 表示无记录（正常），失败路径一律不清理现场。 */
function readStoredCommand(
  storage: VerificationPendingStorage,
): { ok: true; command: VerificationPendingCommand } | { ok: false; reason: VerificationPendingFailureReason } {
  let raw: string | null;
  try {
    raw = storage.getItem(VERIFICATION_PENDING_STORAGE_KEY);
  } catch {
    return { ok: false, reason: 'read_failure' };
  }
  if (raw === null) {
    return { ok: false, reason: 'empty' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'corrupt' };
  }
  if (!hasExactKeys(parsed, ENVELOPE_KEYS)) {
    return { ok: false, reason: 'invalid_shape' };
  }
  if (parsed.version !== 1) {
    return { ok: false, reason: 'unsupported_version' };
  }
  if (!isPendingCommandShape(parsed.command)) {
    return { ok: false, reason: 'invalid_shape' };
  }
  return { ok: true, command: parsed.command };
}

/**
 * 创建未决命令存储适配器（纯函数工厂；storage 为 null/undefined 时全部操作失败关闭为
 * 'unavailable'，SSR 安全）。语义：
 *   - save：严格校验七字段形状（非法 → 'invalid_shape' 且不写入、不覆盖既有记录），再同步
 *     setItem 写入 {version:1, command}；setItem 异常 → 'write_failure'。
 *   - load：getItem 异常 → 'read_failure'；无记录 → 'empty'（正常）；JSON.parse 失败或顶层
 *     非对象 → 'corrupt'；envelope 非恰两键 → 'invalid_shape'；version !== 1 →
 *     'unsupported_version'；命令形状非法 → 'invalid_shape'；全部失败路径不产出命令、不清理。
 *   - clear(expectedCommandId)：先读记录——storage 缺失 → 'unavailable'；getItem 异常 →
 *     'read_failure'；无记录 → {ok:true}（幂等）；解析/版本/形状失败 → 对应原因且不删除；
 *     记录 commandId 与 expectedCommandId 不一致 → 'id_mismatch' 且不删除；匹配才 removeItem
 *     （异常 → 'clear_failure'）。
 */
export function createVerificationPendingStore(
  storage: VerificationPendingStorage | null | undefined,
): VerificationPendingStore {
  if (storage === null || storage === undefined) {
    return {
      save: () => ({ ok: false, reason: 'unavailable' }),
      load: () => ({ ok: false, reason: 'unavailable' }),
      clear: () => ({ ok: false, reason: 'unavailable' }),
    };
  }
  return {
    save(command: VerificationPendingCommand): VerificationPendingSaveResult {
      if (!isPendingCommandShape(command)) {
        return { ok: false, reason: 'invalid_shape' };
      }
      const record: VerificationPendingRecord = { version: 1, command };
      try {
        storage.setItem(VERIFICATION_PENDING_STORAGE_KEY, JSON.stringify(record));
        return { ok: true };
      } catch {
        return { ok: false, reason: 'write_failure' };
      }
    },
    load(): VerificationPendingLoadResult {
      return readStoredCommand(storage);
    },
    clear(expectedCommandId: string): VerificationPendingClearResult {
      const read = readStoredCommand(storage);
      if (read.ok) {
        if (read.command.commandId !== expectedCommandId) {
          return { ok: false, reason: 'id_mismatch' };
        }
        try {
          storage.removeItem(VERIFICATION_PENDING_STORAGE_KEY);
          return { ok: true };
        } catch {
          return { ok: false, reason: 'clear_failure' };
        }
      }
      // 无记录视为已清（幂等）；读取/解析/版本/形状失败一律 fail-closed，不删除。
      if (read.reason === 'empty') {
        return { ok: true };
      }
      return read;
    },
  };
}
