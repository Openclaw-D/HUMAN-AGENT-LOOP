// V4-LIFE 文件持久化事件账本适配器（Lane L1）
// 契约：docs/v4/CONTRACT.md §9。实现 lib/v4life/event-log.ts 的 V4LifeEventLog port。
// 存储：<dir>/<caseId>.jsonl，每行一个 JSON.stringify(event)，UTF-8；demo 规模全同步实现。
// 语义（与 event-log.ts 内存实现同源，差异均为文件持久化所必需）：
//   - caseId 安全校验：仅允许 [A-Za-z0-9._-]，且不得为 "." 或 ".."（防路径穿越），违规 INVALID_ENGINE_INPUT；
//   - append：先做事件批形状校验与批内 seq 连续性校验（违规 INVALID_ENGINE_INPUT，绝不写文件），
//     再用“内存计数 + 文件实际行数”双重核对 expectedLastSeq；不一致返回 SEQ_CONFLICT
//     （lastSeq 以文件实际值为准）且绝不写文件；命中则以单次 appendFileSync 整批落盘（每事件一行，无部分写入）；
//   - 内存计数与文件行数分歧（外部进程改动文件）时以文件为权威并回写内存计数；
//   - loadAll/exportSnapshot：逐行 JSON.parse + 形状校验 + “seq === 行号”连续校验，
//     任何一行损坏即 INVALID_ENGINE_INPUT（失败关闭，detail 带行号）；返回值全部深克隆；
//   - clear 删除持久化文件（不存在时静默）；importSnapshot 整文件覆写（校验先行，不留半写）；
//     listCaseIds 扫描目录下 .jsonl 文件名（去扩展名、排序）。

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { V4LifeError } from './engine.ts';
import type { V4LifeEventLog } from './event-log.ts';
import type { V4LifeEvent } from './types.ts';

export function createFileEventLog(options: { dir: string }): V4LifeEventLog & {
  clear(caseId: string): void;
  listCaseIds(): string[];
  exportSnapshot(caseId: string): V4LifeEvent[] | null;
  importSnapshot(caseId: string, events: V4LifeEvent[]): void;
} {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    invalidInput('options 必须是对象');
  }
  if (typeof options.dir !== 'string' || options.dir.length === 0) {
    invalidInput('options.dir 必须是非空 string');
  }
  const dir = options.dir;
  mkdirSync(dir, { recursive: true });

  // 内存计数（caseId → lastSeq）：append 的快速路径。权威始终是文件本身：
  // 每次 append 仍会重读文件并完整校验以取得实际行数做双重核对，分歧时以文件为准回写。
  const memoLastSeq = new Map<string, number>();

  function invalidInput(detail: string): never {
    const error = new V4LifeError('INVALID_ENGINE_INPUT');
    (error as Error & { detail?: string }).detail = `v4life file-event-log: ${detail}`;
    throw error;
  }

  function filePath(caseId: string): string {
    return join(dir, `${caseId}.jsonl`);
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

  function validateEventShape(candidate: unknown, where: string): V4LifeEvent {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      invalidInput(`${where} 必须是事件对象`);
    }
    const event = candidate as Record<string, unknown>;
    if (typeof event.seq !== 'number' || !Number.isInteger(event.seq) || event.seq < 1) {
      invalidInput(`${where}.seq 必须是从 1 起的整数`);
    }
    if (typeof event.at !== 'string' || event.at.length === 0) {
      invalidInput(`${where}.at 必须是非空 string`);
    }
    if (typeof event.actor !== 'string' || event.actor.length === 0) {
      invalidInput(`${where}.actor 必须是非空 string`);
    }
    if (typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload)) {
      invalidInput(`${where}.payload 必须是载荷对象`);
    }
    return candidate as V4LifeEvent;
  }

  function validateEventBatch(events: unknown, detail: string): V4LifeEvent[] {
    if (!Array.isArray(events)) {
      invalidInput(`${detail} 必须是数组`);
    }
    return (events as unknown[]).map((event, index) => validateEventShape(event, `${detail}[${index}]`));
  }

  // 权威读取路径：读取并完整校验一个 case 的文件；文件不存在（或为空）返回 []。
  // “seq === 行号”等价于“从 1 开始连续单调”，文件被手改出现跳号同样失败关闭。
  function readEvents(id: string): V4LifeEvent[] {
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
      rawLines.pop(); // 每个事件行都以 \n 结尾，末尾空串是换行符产物
    }
    const events: V4LifeEvent[] = [];
    for (let index = 0; index < rawLines.length; index += 1) {
      const lineNumber = index + 1;
      const where = `第 ${lineNumber} 行`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawLines[index]);
      } catch {
        invalidInput(`loadAll: ${where}不是合法 JSON`);
      }
      const event = validateEventShape(parsed, where);
      if (event.seq !== lineNumber) {
        invalidInput(`loadAll: ${where} seq=${event.seq} 违反“从 1 开始连续单调”`);
      }
      events.push(event);
    }
    return events;
  }

  function serializeEvents(events: readonly V4LifeEvent[]): string {
    return events.map((event) => `${JSON.stringify(event)}\n`).join('');
  }

  function cloneEvents(events: readonly V4LifeEvent[]): V4LifeEvent[] {
    return events.map((event) => structuredClone(event));
  }

  return {
    append(caseId, expectedLastSeq, events) {
      const id = requireCaseId(caseId);
      if (typeof expectedLastSeq !== 'number' || !Number.isInteger(expectedLastSeq) || expectedLastSeq < 0) {
        invalidInput('expectedLastSeq 必须是 >= 0 的整数');
      }
      const batch = validateEventBatch(events, 'events');
      for (let index = 1; index < batch.length; index += 1) {
        if (batch[index].seq !== batch[index - 1].seq + 1) {
          invalidInput(`append: events[${index}].seq=${batch[index].seq} 与 events[${index - 1}].seq=${batch[index - 1].seq} 不连续`);
        }
      }

      const fileLastSeq = readEvents(id).length; // 文件实际行数（权威）
      const memoValue = memoLastSeq.get(id);
      if (memoValue !== undefined && memoValue !== fileLastSeq) {
        memoLastSeq.set(id, fileLastSeq); // 内存计数与文件分歧 → 以文件为准回写
      }
      if (expectedLastSeq !== fileLastSeq) {
        return { ok: false, reason: 'SEQ_CONFLICT', lastSeq: fileLastSeq };
      }
      if (batch.length === 0) {
        memoLastSeq.set(id, fileLastSeq);
        return { ok: true };
      }
      if (batch[0].seq !== fileLastSeq + 1) {
        return { ok: false, reason: 'SEQ_CONFLICT', lastSeq: fileLastSeq };
      }
      // 单次 appendFileSync 整批落盘（每事件一行）：进程内视角不存在部分写入
      appendFileSync(filePath(id), serializeEvents(batch), 'utf8');
      memoLastSeq.set(id, fileLastSeq + batch.length);
      return { ok: true };
    },

    loadAll(caseId) {
      const id = requireCaseId(caseId);
      return cloneEvents(readEvents(id));
    },

    clear(caseId) {
      const id = requireCaseId(caseId);
      memoLastSeq.delete(id);
      try {
        unlinkSync(filePath(id));
      } catch (error) {
        if ((error as { code?: string })?.code !== 'ENOENT') {
          throw error;
        }
      }
    },

    listCaseIds() {
      try {
        return readdirSync(dir)
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) => name.slice(0, -'.jsonl'.length))
          .sort();
      } catch {
        return [];
      }
    },

    exportSnapshot(caseId) {
      const id = requireCaseId(caseId);
      if (!existsSync(filePath(id))) {
        return null;
      }
      return cloneEvents(readEvents(id));
    },

    importSnapshot(caseId, events) {
      const id = requireCaseId(caseId);
      const batch = validateEventBatch(events, 'events');
      for (let index = 0; index < batch.length; index += 1) {
        if (batch[index].seq !== index + 1) {
          invalidInput(`importSnapshot: events[${index}].seq=${batch[index].seq} 违反“从 1 开始连续单调”`);
        }
      }
      writeFileSync(filePath(id), serializeEvents(batch), 'utf8'); // 整文件覆写
      memoLastSeq.set(id, batch.length);
    },
  };
}
