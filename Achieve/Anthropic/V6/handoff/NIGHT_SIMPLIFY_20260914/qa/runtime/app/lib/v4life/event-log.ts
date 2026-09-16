// V4-LIFE 存储 port 与内存事件账本（Lane B）
// 契约：docs/v4/CONTRACT.md §9。本切片只有进程内内存适配器；不选择、也不声称选择了任何生产数据库。
// 语义：按 case 只追加；seq 从 1 开始、连续单调、不可覆盖；
//       append 以 expectedLastSeq 条件写入，不匹配返回 SEQ_CONFLICT 且绝不部分写入；
//       读写边界全部深克隆，不暴露内部可变引用；未知/非法输入失败关闭（INVALID_ENGINE_INPUT）。

import { V4LifeError } from './engine.ts';
import type { V4LifeEvent } from './types.ts';

export interface V4LifeEventLog {
  append(caseId: string, expectedLastSeq: number, events: V4LifeEvent[]):
    { ok: true } | { ok: false; reason: 'SEQ_CONFLICT'; lastSeq: number };
  loadAll(caseId: string): V4LifeEvent[];
}

export function createInMemoryEventLog(): V4LifeEventLog & {
  exportSnapshot(caseId: string): V4LifeEvent[] | null;
  importSnapshot(caseId: string, events: V4LifeEvent[]): void;
  listCaseIds(): string[];
} {
  const cases = new Map<string, V4LifeEvent[]>();

  function invalidInput(detail: string): never {
    const error = new V4LifeError('INVALID_ENGINE_INPUT');
    (error as Error & { detail?: string }).detail = `v4life event-log: ${detail}`;
    throw error;
  }

  function requireCaseId(caseId: unknown): string {
    if (typeof caseId !== 'string' || caseId.length === 0) {
      invalidInput('caseId 必须是非空 string');
    }
    return caseId;
  }

  function validateEventShape(event: unknown, index: number): V4LifeEvent {
    if (typeof event !== 'object' || event === null || Array.isArray(event)) {
      invalidInput(`events[${index}] 必须是事件对象`);
    }
    const candidate = event as Record<string, unknown>;
    const seq = candidate.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) {
      invalidInput(`events[${index}].seq 必须是从 1 起的整数`);
    }
    if (typeof candidate.at !== 'string' || candidate.at.length === 0) {
      invalidInput(`events[${index}].at 必须是非空 string`);
    }
    if (typeof candidate.actor !== 'string' || candidate.actor.length === 0) {
      invalidInput(`events[${index}].actor 必须是非空 string`);
    }
    if (typeof candidate.payload !== 'object' || candidate.payload === null || Array.isArray(candidate.payload)) {
      invalidInput(`events[${index}].payload 必须是载荷对象`);
    }
    return event as V4LifeEvent;
  }

  function validateEventBatch(events: unknown, detail: string): V4LifeEvent[] {
    if (!Array.isArray(events)) {
      invalidInput(`${detail} 必须是数组`);
    }
    return (events as unknown[]).map((event, index) => validateEventShape(event, index));
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

      const stored = cases.get(id);
      const current = stored ?? [];
      const lastSeq = current.length === 0 ? 0 : current[current.length - 1].seq;

      if (expectedLastSeq !== lastSeq) {
        return { ok: false, reason: 'SEQ_CONFLICT', lastSeq };
      }
      let expected = lastSeq;
      for (const event of batch) {
        if (event.seq !== expected + 1) {
          return { ok: false, reason: 'SEQ_CONFLICT', lastSeq };
        }
        expected = event.seq;
      }
      if (batch.length > 0) {
        cases.set(id, current.concat(cloneEvents(batch)));
      }
      return { ok: true };
    },

    loadAll(caseId) {
      const id = requireCaseId(caseId);
      const stored = cases.get(id);
      return stored === undefined ? [] : cloneEvents(stored);
    },

    exportSnapshot(caseId) {
      const id = requireCaseId(caseId);
      const stored = cases.get(id);
      return stored === undefined ? null : cloneEvents(stored);
    },

    importSnapshot(caseId, events) {
      const id = requireCaseId(caseId);
      const batch = validateEventBatch(events, 'events');
      for (let index = 0; index < batch.length; index += 1) {
        if (batch[index].seq !== index + 1) {
          invalidInput(
            `importSnapshot: events[${index}].seq=${batch[index].seq} 违反“从 1 开始连续单调”`,
          );
        }
      }
      cases.set(id, cloneEvents(batch));
    },

    listCaseIds() {
      return [...cases.keys()];
    },
  };
}
