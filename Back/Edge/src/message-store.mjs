// 页内消息线程存储（任务04 §四·消息与恢复重写；goal-03e DEF-G04N-05 语义保留并持久化）：
// 持久化技术：Node 22 内建 node:sqlite（零新增运行时依赖；WAL；文件由启动方传入，Git 排除的
// 运行态目录）。只存两件事——"投递成功后的线程留档"与"发送 requestId 幂等回执"，不另造聊天平台。
//
// 读取语义（本轮冻结；修复"after=0、limit=2 返回 4,5、cursor=5 后 1..3 永久丢失"的分页缺陷）：
//   - 首次历史读取（不带 after）：返回保留窗口内最新一页（升序）；cursor=本页最后一条 seq
//     （空页=当前最大 seq）——客户端以 ?after=<cursor> 续拉，先追平历史再转实时。
//   - 增量读取（after=N）：返回 seq>N 的最早一页（升序、连续可续读）；cursor=本页最后一条
//     seq（空页=N 本身）——游标绝不越过未返回区段，逐页拉取不漏不重。
//   - 受众过滤只作用于返回集；游标按"最后一条返回记录"推进，被过滤区段在后续页重扫（无害）。
//   - 保留窗口：每客户 maxPerCustomer 条，超出物理裁剪最旧（thread base 前进）；base>0 时
//     响应携带 truncated:true + retentionBase——历史裁剪显式提示，绝不静默漏消息。
//   - 游标失效：after<base → 从 base 起读并标注 truncated（HTTP 拉取可续读，缺失区段明确告知；
//     需要完整历史的客户端应整窗重取快照）。
//   - 幂等回执（R2-01）：requestId → {fingerprint, response} 持久化，绑定可信作用域
//     customer/principal/tenant；进程重启后重放仍返回原回执，同 ID 异载荷/异作用域仍 409，
//     旧无作用域回执失败关闭。发送前原子 claim（pending intent，owner_token 校验），
//     发送后异常落持久 unknown；pending 与 unknown 不参与 maxReceipts 裁剪。
// 隔离：所有读写按 customerId 分桶；不跨客户返回任何记录。送达未知不标已读；只追加不撤回。
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  customer_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  audience TEXT NOT NULL,
  text TEXT NOT NULL,
  request_id TEXT NOT NULL,
  sender_principal_id TEXT NOT NULL,
  sender_roles TEXT NOT NULL,
  thread_id TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (customer_id, seq)
);
CREATE TABLE IF NOT EXISTS thread_state (
  customer_id TEXT PRIMARY KEY,
  base INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS message_receipts (
  request_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  principal_id TEXT NOT NULL DEFAULT '',
  tenant_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'terminal',
  deliver_state TEXT,
  owner_token TEXT,
  claimed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_created ON message_receipts (created_at);
`;

// R2-01 兼容增量（仅限本 store）：旧库缺列时逐列补齐；旧行默认 terminal+无作用域
// （principal_id=''）→ 路由侧按"旧无作用域回执"失败关闭。不删行、不清账、不重构存储。
const RECEIPT_MIGRATIONS = [
  ['principal_id', `ALTER TABLE message_receipts ADD COLUMN principal_id TEXT NOT NULL DEFAULT ''`],
  ['tenant_id', `ALTER TABLE message_receipts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''`],
  ['status', `ALTER TABLE message_receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'terminal'`],
  ['deliver_state', `ALTER TABLE message_receipts ADD COLUMN deliver_state TEXT`],
  ['owner_token', `ALTER TABLE message_receipts ADD COLUMN owner_token TEXT`],
  ['claimed_at', `ALTER TABLE message_receipts ADD COLUMN claimed_at TEXT`],
];

export function createMessageStore({ file = null, maxPerCustomer = 500, maxReceipts = 4096 } = {}) {
  // file=null → :memory:（E0 语义自检兼容）；file 路径 → 重启可恢复。
  if (file) mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file ?? ':memory:');
  db.exec('PRAGMA journal_mode = WAL;');
  // 跨进程写锁忙等上限：多进程共享同库文件时 BEGIN IMMEDIATE 须等待他人短写事务而非立即
  // SQLITE_BUSY 抛错（soak F1：无此项时 160 笔并发写 77 例 "database is locked"→500）。
  // 超时后仍如实抛错，不做全局串行化、不吞异常。
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = FULL;');
  db.exec(SCHEMA);
  {
    const have = new Set(db.prepare('PRAGMA table_info(message_receipts)').all().map((c) => c.name));
    for (const [name, ddl] of RECEIPT_MIGRATIONS) {
      if (!have.has(name)) db.exec(ddl);
    }
  }

  const insertMsg = db.prepare(
    `INSERT INTO messages (customer_id, seq, message_id, audience, text, request_id, sender_principal_id, sender_roles, thread_id, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const nextSeq = db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE customer_id = ?`);
  const getState = db.prepare(`SELECT base FROM thread_state WHERE customer_id = ?`);
  const upsertState = db.prepare(
    `INSERT INTO thread_state (customer_id, base, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (customer_id) DO UPDATE SET base = MAX(base, excluded.base), updated_at = excluded.updated_at`,
  );
  const trimMsgs = db.prepare(`DELETE FROM messages WHERE customer_id = ? AND seq <= ?`);
  const maxSeqQ = db.prepare(`SELECT MAX(seq) AS m FROM messages WHERE customer_id = ?`);

  // seq 分配与裁剪原子（单写者 + BEGIN IMMEDIATE 串行；node:sqlite 无 .transaction 助手，显式开）。
  const appendOne = (customerId, rec, cap) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const seq = nextSeq.get(customerId).next;
      insertMsg.run(customerId, seq, rec.messageId, rec.audience, rec.text, rec.requestId,
        rec.senderPrincipalId, JSON.stringify(rec.senderRoles ?? []), rec.threadId, rec.at);
      if (cap > 0) {
        const m = maxSeqQ.get(customerId).m ?? seq;
        const cut = m - cap;
        if (cut > 0) {
          trimMsgs.run(customerId, cut);
          upsertState.run(customerId, cut, new Date().toISOString());
        }
      }
      db.exec('COMMIT');
      return seq;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const insertReceipt = db.prepare(
    `INSERT INTO message_receipts (request_id, fingerprint, response_json, customer_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (request_id) DO NOTHING`,
  );
  const getReceiptQ = db.prepare(`SELECT fingerprint, response_json, status FROM message_receipts WHERE request_id = ?`);
  const receiptCountQ = db.prepare(`SELECT COUNT(*) AS c FROM message_receipts`);
  // 裁剪只针对已 terminal 且非 unknown 的回执：pending intent 与 unknown（结果未决/不明）
  // 永不裁剪——不能因裁剪忘记"可能已发送"的请求（R2-01）。
  const oldestTrimmableReceiptsQ = db.prepare(
    `SELECT request_id FROM message_receipts
     WHERE status = 'terminal' AND (deliver_state IS NULL OR deliver_state <> 'unknown')
     ORDER BY created_at ASC, request_id ASC LIMIT ?`,
  );
  const delReceipt = db.prepare(`DELETE FROM message_receipts WHERE request_id = ?`);

  // R2-01 幂等回执协议：原子 claim / owner 校验 finalize / 租约回收 pending→unknown。
  const claimInsert = db.prepare(
    `INSERT INTO message_receipts (request_id, fingerprint, response_json, customer_id, principal_id, tenant_id, status, owner_token, claimed_at, created_at)
     VALUES (?, ?, '', ?, ?, ?, 'pending', ?, ?, ?)
     ON CONFLICT (request_id) DO NOTHING`,
  );
  const getReceiptRecordQ = db.prepare(
    `SELECT fingerprint, response_json, customer_id, principal_id, tenant_id, status, deliver_state, claimed_at
     FROM message_receipts WHERE request_id = ?`,
  );
  const finalizeStmt = db.prepare(
    `UPDATE message_receipts SET status = 'terminal', response_json = ?, deliver_state = ?, owner_token = NULL, claimed_at = NULL
     WHERE request_id = ? AND owner_token = ? AND status = 'pending'`,
  );
  const expirePendingStmt = db.prepare(
    `UPDATE message_receipts SET status = 'terminal', response_json = ?, deliver_state = 'unknown', owner_token = NULL, claimed_at = NULL
     WHERE request_id = ? AND status = 'pending' AND claimed_at <= ?`,
  );

  const rowToReceiptRecord = (r) => ({
    fingerprint: r.fingerprint,
    status: r.status === 'pending' ? 'pending' : 'terminal',
    scope: { customerId: r.customer_id ?? '', principalId: r.principal_id ?? '', tenantId: r.tenant_id ?? '' },
    legacy: r.status !== 'pending' && (r.principal_id ?? '') === '',
    result: r.status === 'pending' || !r.response_json ? null : JSON.parse(r.response_json),
    state: r.deliver_state ?? null,
    claimedAt: r.claimed_at ?? null,
  });

  const trimReceipts = () => {
    const c = receiptCountQ.get().c;
    if (c <= maxReceipts) return;
    for (const row of oldestTrimmableReceiptsQ.all(c - maxReceipts)) delReceipt.run(row.request_id);
  };

  const rowToMsg = (r) => ({
    seq: Number(r.seq),
    messageId: r.message_id,
    audience: r.audience,
    text: r.text,
    requestId: r.request_id,
    senderPrincipalId: r.sender_principal_id,
    senderRoles: JSON.parse(r.sender_roles || '[]'),
    threadId: r.thread_id ?? null,
    at: r.at,
  });

  return {
    /** 投递成功后入栈（由消息路由调用）；返回带 seq/messageId/at 的完整记录。 */
    append({ customerId, audience, text, requestId, senderPrincipalId, senderRoles = [], threadId = null, deliverMessageId = null }) {
      const rec = {
        seq: 0,
        messageId: typeof deliverMessageId === 'string' && deliverMessageId ? deliverMessageId : `msg-${randomUUID()}`,
        audience: audience === 'internal' ? 'internal' : 'customer',
        text: String(text),
        requestId: String(requestId ?? ''),
        senderPrincipalId: String(senderPrincipalId ?? 'unknown'),
        senderRoles: [...senderRoles],
        threadId,
        at: new Date().toISOString(),
      };
      rec.seq = appendOne(String(customerId), rec, maxPerCustomer);
      return rec;
    },

    /**
     * 线程读取（语义见文件头）：audience 过滤（customer|internal|null=全部）；
     * afterSeq=null → 最新一页（升序）；afterSeq=N → seq>N 的最早一页（升序）。
     * 返回 { messages, cursor, truncated?, retentionBase? }——cursor=本页最后一条 seq
     * （空页：tail 模式=当前最大 seq，增量模式=afterSeq 本身），客户端以 ?after=<cursor> 续拉。
     */
    list(customerId, { audience = null, afterSeq = null, limit = 200 } = {}) {
      const cid = String(customerId);
      const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
      const base = getState.get(cid)?.base ?? 0;
      const maxSeq = Number(maxSeqQ.get(cid).m ?? 0);
      const incremental = afterSeq !== null && afterSeq !== undefined;
      const after = incremental ? Math.max(Number(afterSeq) || 0, 0) : null;
      const truncated = base > 0 && (incremental ? after < base : true);

      const cond = ['customer_id = ?'];
      const params = [cid];
      if (incremental) { cond.push('seq > ?'); params.push(after); }
      if (audience === 'customer' || audience === 'internal') { cond.push('audience = ?'); params.push(audience); }
      const orderDesc = !incremental; // tail：先取最新 lim 条再反转；增量：最早 lim 条正序
      const rows = db.prepare(
        `SELECT seq, message_id, audience, text, request_id, sender_principal_id, sender_roles, thread_id, at
         FROM messages WHERE ${cond.join(' AND ')}
         ORDER BY seq ${orderDesc ? 'DESC' : 'ASC'} LIMIT ${lim}`,
      ).all(...params);
      const window = orderDesc ? rows.reverse() : rows;
      const messages = window.map(rowToMsg);
      const out = {
        messages,
        cursor: String(messages.length > 0 ? messages[messages.length - 1].seq : (incremental ? after : maxSeq)),
      };
      if (truncated) {
        out.truncated = true;
        out.retentionBase = base;
        out.note = '历史超出保留窗口已被裁剪：缺失区段显式提示（不静默漏消息）；需要完整历史请整窗重取';
      }
      return out;
    },

    /** 幂等回执（持久，兼容只读面）：仅 terminal 行返回 {fingerprint, result}；pending 在途返回 null。 */
    getReceipt(requestId) {
      const r = getReceiptQ.get(String(requestId));
      if (!r || r.status === 'pending') return null;
      return { fingerprint: r.fingerprint, result: JSON.parse(r.response_json) };
    },
    /** 兼容直写 terminal 回执（测试/既有调用）：无作用域（principal_id=''），路由侧按旧回执失败关闭。 */
    putReceipt(requestId, fingerprint, result, { customerId = '' } = {}) {
      insertReceipt.run(String(requestId), fingerprint, JSON.stringify(result), String(customerId ?? ''), new Date().toISOString());
      trimReceipts();
    },

    /**
     * R2-01 原子认领：BEGIN IMMEDIATE 事务内插入 pending intent（owner_token），
     * changes=1 即胜者；否则返回既有记录（pending/terminal 均可能），调用方绝不进入发送。
     * scope = { customerId, principalId, tenantId }（服务端可信来源）。
     */
    claimReceipt(requestId, fingerprint, scope, { ownerToken } = {}) {
      const rid = String(requestId);
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const ins = claimInsert.run(rid, String(fingerprint), String(scope?.customerId ?? ''),
          String(scope?.principalId ?? ''), String(scope?.tenantId ?? ''), String(ownerToken ?? ''), now, now);
        if (ins.changes === 1) {
          db.exec('COMMIT');
          return { claimed: true };
        }
        const existing = rowToReceiptRecord(getReceiptRecordQ.get(rid));
        db.exec('COMMIT');
        return { claimed: false, existing };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    /** intent→terminal 仅 owner 可为：owner 不匹配或已被租约回收 → 不覆盖，返回 false。 */
    finalizeReceipt(requestId, ownerToken, result, { state = 'sent' } = {}) {
      const upd = finalizeStmt.run(JSON.stringify(result), String(state ?? 'sent'), String(requestId), String(ownerToken ?? ''));
      if (upd.changes !== 1) return false;
      trimReceipts();
      return true;
    },

    /**
     * 租约回收：仅 status='pending' 且 claimed_at 早于 now-maxAgeMs 的行原子转 terminal unknown
     * （响应体由调用方给定）。跨进程崩溃遗留的 intent 由此收敛；永不变为可重发。
     */
    expirePendingReceipt(requestId, maxAgeMs, unknownResult) {
      const cutoff = new Date(Date.now() - Math.max(Number(maxAgeMs) || 0, 0)).toISOString();
      const upd = expirePendingStmt.run(JSON.stringify(unknownResult), String(requestId), cutoff);
      return upd.changes === 1;
    },

    /** 回执完整记录（路由协议面）：{fingerprint, status, scope, legacy, result, state, claimedAt} | null。 */
    getReceiptRecord(requestId) {
      const r = getReceiptRecordQ.get(String(requestId));
      return r ? rowToReceiptRecord(r) : null;
    },

    /** 部署/测试探针：线程数与总条数（不回传内容）；持久化模式与文件路径（仅路径形态）。 */
    stats() {
      const threads = db.prepare(`SELECT COUNT(DISTINCT customer_id) AS t FROM messages`).get().t;
      const messages = db.prepare(`SELECT COUNT(*) AS c FROM messages`).get().c;
      const receipts = receiptCountQ.get().c;
      return {
        threads, messages, receipts,
        persistence: file ? 'sqlite' : 'memory',
        file: file ? path.basename(file) : null,
      };
    },

    /** 测试/受控停止用：释放 SQLite 句柄（WAL 下安全）。 */
    close() {
      try { db.close(); } catch { /* 幂等 */ }
    },
  };
}
