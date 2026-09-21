// V0.4 任务04 · 前端消费示例（文档用途，未接入 Front；Front 由 Codex 保留，接线由串行集成安排）。
// 契约：docs/v0.4/results/04-activity/CONTRACT.md
// 要点：同一 activityId 去重；游标续读可重试；请求/回执/业务事件分列展示；未知不伪装成功。
//
// 拉取循环（历史追平 + 刷新重读）：
//
//   const base = ''; // 同源部署（Edge --serve-front）；跨端口部署需 --allowed-origin
//
//   async function fetchActivityPage({ customerId, sessionId, cursor = null, sources, audience, limit = 50 }) {
//     const q = new URLSearchParams();
//     if (cursor) q.set('cursor', cursor);
//     if (sources) q.set('sources', sources.join(','));
//     if (audience) q.set('audience', audience);
//     q.set('limit', String(limit));
//     const res = await fetch(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/activity?${q}`, {
//       headers: { 'x-jw-session': sessionId }, // 不透明会话；凭据永不进前端
//     });
//     if (res.status === 401) throw { code: 'SESSION_REQUIRED', retryAfterLogin: true };
//     if (res.status === 403) throw { code: (await res.json()).error, fatal: true }; // 撤权/受众越权：停止轮询
//     if (!res.ok) throw { code: (await res.json()).error ?? 'ACTIVITY_UNAVAILABLE' };
//     return res.json(); // { ok, customerId, items, perSourceCursors, nextCursor, exhausted, sources, incomplete, ordering }
//   }
//
//   // 历史追平：跨源无全局总序——只保证每源升序前缀不漏不重；页内顺序仅是展示提示。
//   export async function syncActivity(state, { customerId, sessionId }) {
//     let cursor = state.cursorByCustomer.get(customerId) ?? null; // 每客户独立游标（切客户必须换游标）
//     for (let guard = 0; guard < 50; guard += 1) {
//       const page = await fetchActivityPage({ customerId, sessionId, cursor, sources: state.sources });
//       for (const item of page.items) {
//         if (state.seen.has(item.activityId)) continue;   // 去重键 = 来源命名空间 + 源内记录 ID
//         state.seen.add(item.activityId);
//         state.feed.push(item);
//       }
//       state.incomplete = page.incomplete;                 // 单源失败如实展示，不清空其他源
//       state.sourceStates = page.sources;
//       if (page.nextCursor === null) { state.cursorByCustomer.delete(customerId); break; }
//       cursor = page.nextCursor;
//       state.cursorByCustomer.set(customerId, cursor);
//     }
//     state.feed.sort(byPresentationHint);                  // 仅展示排序：时间→来源→记录ID，不得当业务总序用
//   }
//
//   // 刷新（页面切换/重连）：游标已尽后从零重读也可——activityId 去重保证幂等；
//   // 服务端对同一事件恒定返回同一 activityId/occurredAt/actor（回归已断言刷新一致）。
//
// 渲染规则（对应 V0.4_KANBAN 验收）：
//
//   function renderItem(item) {
//     switch (item.source) {
//       case 'thread':        // 聊天气泡：服务端时间 + 可信操作者
//         return {
//           time: item.occurredAt,                       // 缺失显示"时间未知"，不用本地时间补
//           who: item.actor.trusted ? item.actor.principalId : '操作者未知',
//           text: item.text,
//           delivery: item.delivery.state,               // 'sent_local_sink' | 'unknown'：未知不标已读
//         };
//       case 'kernel':       // 业务事件行：事件类型 + A 原始时间；actor 未知如实显示
//         return { time: item.occurredAt, what: item.eventType, who: '系统事件（无操作者记录）', ref: item.refs.payload };
//       case 'model_receipt': // 模型回执行：与提问分列，绝不合并成"已回答"
//         return {
//           time: item.occurredAt,
//           state: item.state,   // completed | failed | unknown —— unknown 显示"结果未知，待核对"，禁自动重试
//           who: '模型辅助观察（无个人署名）',
//         };
//     }
//   }
//
// 纪律：
//   - customer-only 会话：服务端已强制 customer 受众并排除 model_receipt（显式请求 403）；
//     前端不要自己按 audience 猜过滤，以响应 sources[] 的 excludedByAudience/reason 提示为准。
//   - incomplete 非空：显示"部分来源暂不可读（错误码）"，不得把该页当作完整快照。
//   - ordering 字段：页序只是展示提示；禁止据此向用户宣称"严格按时间排序的全量流水"。
//   - 收到未知/失败回执项不得触发自动重发；重发只能由用户显式动作走既有写接口。
//   - 会话过期（401）：停止轮询并回登录；不得带旧游标静默重试。
//   - 切客户：seen/feed/cursor 全部按 customerId 分桶清理（防串记录）。
