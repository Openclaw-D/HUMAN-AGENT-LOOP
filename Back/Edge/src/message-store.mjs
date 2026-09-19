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
//   - 幂等回执：requestId → {fingerprint, response} 持久化；进程重启后重放仍返回原回执，
//     同 ID 异载荷仍 409。有界（maxReceipts，超出按 created_at 裁最旧）。
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_created ON message_receipts (created_at);
`;

export function createMessageStore({ file = null, maxPerCustomer = 500, maxReceipts = 4096 } = {}) {
  // file=null → :memory:（E0 语义自检兼容）；file 路径 → 重启可恢复。
  if (file) mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file ?? ':memory:');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = FULL;');
  db.exec(SCHEMA);

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
  const getReceiptQ = db.prepare(`SELECT fingerprint, response_json FROM message_receipts WHERE request_id = ?`);
  const receiptCountQ = db.prepare(`SELECT COUNT(*) AS c FROM message_receipts`);
  const oldestReceiptsQ = db.prepare(
    `SELECT request_id FROM message_receipts ORDER BY created_at ASC, request_id ASC LIMIT ?`,
  );
  const delReceipt = db.prepare(`DELETE FROM message_receipts WHERE request_id = ?`);

  const trimReceipts = () => {
    const c = receiptCountQ.get().c;
    if (c <= maxReceipts) return;
    for (const row of oldestReceiptsQ.all(c - maxReceipts)) delReceipt.run(row.request_id);
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

    /** 幂等回执（持久）：同 ID 同载荷重放由消息路由返回原响应；重启后仍有效。 */
    getReceipt(requestId) {
      const r = getReceiptQ.get(String(requestId));
      if (!r) return null;
      return { fingerprint: r.fingerprint, result: JSON.parse(r.response_json) };
    },
    putReceipt(requestId, fingerprint, result, { customerId = '' } = {}) {
      insertReceipt.run(String(requestId), fingerprint, JSON.stringify(result), String(customerId ?? ''), new Date().toISOString());
      trimReceipts();
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
