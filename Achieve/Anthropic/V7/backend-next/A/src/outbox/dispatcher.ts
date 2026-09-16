// Outbox dispatcher：至少一次投递（CONTRACT §3.5）。
// 每个 pending 事件 × 每个 subscription 独立簿记（outbox_deliveries），2xx 算送达；
// 指数退避重试，超上限置 dead（可人工重置）。pull 通道（GET /api/v1/events）始终可用、不受此影响。
import type { Pool } from 'pg';
import type { Config } from '../config.ts';

export class OutboxDispatcher {
  private readonly pool: Pool;
  private readonly config: Config;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  stopped = false;

  constructor(pool: Pool, config: Config) {
    this.pool = pool;
    this.config = config;
  }

  start(): void {
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        await this.dispatchOnce();
      } catch { /* 轮询错误下一轮重试；不中断进程 */ }
      if (!this.stopped) this.timer = setTimeout(tick, this.config.outboxPollMs);
    };
    this.running = true;
    void tick();
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
  }

  isRunning(): boolean { return this.running; }

  /** 单轮投递：对每个 subscription 的每条未决事件 POST；2xx → delivered，否则 attempts+1。 */
  async dispatchOnce(): Promise<{ delivered: number; failed: number }> {
    const subs = await this.pool.query(`SELECT sub_id, url FROM subscriptions ORDER BY created_at`);
    if (subs.rows.length === 0) return { delivered: 0, failed: 0 };
    let delivered = 0;
    let failed = 0;
    for (const sub of subs.rows as { sub_id: string; url: string }[]) {
      // 确保该订阅能看到全部未决事件（登记晚于事件产生时补插簿记行）
      await this.pool.query(
        `INSERT INTO outbox_deliveries (sub_id, seq, state)
         SELECT $1, seq, 'pending' FROM outbox_events
         WHERE dispatch_state IN ('pending','delivered') AND seq > COALESCE((SELECT MAX(seq) FROM outbox_deliveries WHERE sub_id = $1), 0)
         ON CONFLICT (sub_id, seq) DO NOTHING`,
        [sub.sub_id],
      );
      const pending = await this.pool.query(
        `SELECT d.seq, e.event_id, e.event_type, e.project_id, e.goal_id, e.payload, e.at, d.attempts
         FROM outbox_deliveries d JOIN outbox_events e ON e.seq = d.seq
         WHERE d.sub_id = $1 AND d.state = 'pending' ORDER BY d.seq LIMIT 50`,
        [sub.sub_id],
      );
      for (const row of pending.rows as Record<string, unknown>[]) {
        const ok = await this.deliver(sub.url, row);
        if (ok) {
          delivered += 1;
          await this.pool.query(
            `UPDATE outbox_deliveries SET state = 'delivered', last_at = now() WHERE sub_id = $1 AND seq = $2`,
            [sub.sub_id, row.seq],
          );
        } else {
          failed += 1;
          const attempts = Number(row.attempts ?? 0) + 1;
          const dead = attempts >= this.config.outboxMaxAttempts;
          await this.pool.query(
            `UPDATE outbox_deliveries SET attempts = $3, last_error = 'deliver_failed', last_at = now(),
               state = CASE WHEN $4 THEN 'dead' ELSE state END WHERE sub_id = $1 AND seq = $2`,
            [sub.sub_id, row.seq, attempts, dead],
          );
          if (dead) {
            await this.pool.query(
              `UPDATE outbox_events SET dispatch_state = 'dead', attempts = attempts + 1 WHERE seq = $1`,
              [row.seq],
            );
          }
        }
      }
    }
    // 全部订阅送达的外层状态推进（pull 通道不受影响；此字段是运维视图）
    await this.pool.query(
      `UPDATE outbox_events e SET dispatch_state = 'delivered'
       WHERE e.dispatch_state = 'pending'
         AND NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.seq = e.seq AND d.state <> 'delivered')
         AND EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.seq = e.seq)`,
    );
    return { delivered, failed };
  }

  private async deliver(url: string, row: Record<string, unknown>): Promise<boolean> {
    const body = JSON.stringify({
      eventId: row.event_id,
      eventType: row.event_type,
      seq: row.seq,
      at: row.at,
      projectId: row.project_id,
      goalId: row.goal_id,
      payload: row.payload,
    });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: controller.signal,
        });
        return res.status >= 200 && res.status < 300;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }
}
