// E0 fixture 事件存储：只为证明任务04 §4 的 SSE 传输语义（至少一次、Last-Event-ID 补取、
// 游标过期必须 resync、scope/权限边界）。真实内核对接（A outbox → SSE）待任务01冻结契约后
// 替换此 seam，语义不变。事件信封字段按任务04：eventId、scope、aggregateVersion、
// schemaVersion、occurredAt、payloadRef。
import { randomUUID } from 'node:crypto';

export const EVENT_SCHEMA_VERSION = 'jw.event.v1';

export function createFixtureStore() {
  const customers = new Map(); // id -> { snapshot, snapshotVersion, events: [envelope], evicted: Set<eventId>, subscribers: Set<cb> }

  const bucket = (customerId) => {
    let b = customers.get(customerId);
    if (!b) {
      b = { snapshot: null, snapshotVersion: 0, events: [], evicted: new Set(), subscribers: new Set() };
      customers.set(customerId, b);
    }
    return b;
  };

  return {
    // 建档/更新快照（fixture 专用；真实实现来自任务01内核投影）。
    upsertCustomer(customerId, snapshot) {
      const b = bucket(customerId);
      b.snapshot = snapshot;
      return this.getWorkspace(customerId);
    },

    // 追加业务事件：aggregateVersion 单调 +1，与 snapshotVersion 同源。
    appendEvent(customerId, { type, payload, scope }) {
      const b = bucket(customerId);
      b.snapshotVersion += 1;
      const envelope = {
        eventId: randomUUID(),
        scope: { tenant: 'local', customer: customerId, ...(scope || {}) },
        aggregateVersion: b.snapshotVersion,
        schemaVersion: EVENT_SCHEMA_VERSION,
        occurredAt: new Date().toISOString(),
        payloadRef: { type },
        payload,
      };
      b.events.push(envelope);
      for (const cb of b.subscribers) {
        try { cb(envelope); } catch { /* 订阅者回调异常不影响存储 */ }
      }
      return envelope;
    },

    // 快照与游标同源：workspace 携带的 eventCursor 之后的订阅不漏不重推进（任务04 D03 语义）。
    getWorkspace(customerId) {
      const b = customers.get(customerId);
      if (!b || !b.snapshot) return null;
      const last = b.events[b.events.length - 1];
      return {
        customerId,
        snapshot: structuredClone(b.snapshot),
        snapshotVersion: b.snapshotVersion,
        eventCursor: last ? last.eventId : null,
      };
    },

    // afterEventId 严格之后的补取。游标不在保留窗口（已被裁剪或完全未知）→ expired，
    // 调用方必须要求客户端重取快照，不允许从当前时点静默续播。
    replayFrom(customerId, afterEventId) {
      const b = customers.get(customerId);
      if (!b) return { events: [] };
      if (afterEventId == null) return { events: [] }; // 无游标=只从现在开始（服务器先发 cursor 基线事件）
      if (b.evicted.has(afterEventId)) return { expired: true, reason: 'cursor_expired' };
      const idx = b.events.findIndex((e) => e.eventId === afterEventId);
      if (idx === -1) return { expired: true, reason: 'cursor_unknown' };
      return { events: b.events.slice(idx + 1).map((e) => structuredClone(e)) };
    },

    // 模拟保留窗口淘汰：把 index 之前（不含）的事件挤出窗口，其 eventId 记为已淘汰。
    forgetBefore(customerId, keepFromIndex) {
      const b = bucket(customerId);
      const removed = b.events.splice(0, keepFromIndex);
      for (const e of removed) b.evicted.add(e.eventId);
      return removed.length;
    },

    subscribe(customerId, cb) {
      const b = bucket(customerId);
      b.subscribers.add(cb);
      return () => b.subscribers.delete(cb);
    },
  };
}
