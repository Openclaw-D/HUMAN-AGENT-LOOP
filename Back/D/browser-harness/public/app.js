'use strict';
// browser-harness 逻辑（E0）：无框架。演示并验证：
//   - 会话换取后凭据不再出现；请求只带 X-JW-Session
//   - SSE：Last-Event-ID 断线重连、eventId 去重、resync 处理（D03/D04/D05）
//   - 面板开合不重建媒体会话与订阅（D08 结构面）
//   - 动作带 requestId、同 ID 重试（D13）；消息受众守卫（D09）
// 全部失败如实显示——上游未运行/未授权时按钮结果就是失败，不用假成功。

const $ = (id) => document.getElementById(id);
const state = {
  sessionId: null,
  customer: null,
  cursor: null,
  seen: new Set(),
  dup: 0,
  unique: 0,
  lastReqId: null,
  mediaTicks: 0,
  mediaRebuilds: 0,
  es: null,
  mediaTimer: null,
};

function set(el, text) { $(el).textContent = text; }

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  if (state.sessionId) headers['x-jw-session'] = state.sessionId;
  const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let body = null;
  try { body = await res.json(); } catch { /* SSE/非JSON */ }
  return { status: res.status, body };
}

// —— 0 会话 ——
$('btn-login').onclick = async () => {
  const r = await api('/api/jw/v2/session', { method: 'POST', body: { credential: $('cred').value } });
  if (r.status === 200 && r.body.ok) {
    state.sessionId = r.body.session.sessionId;
    $('session-state').textContent = `已登录 ${r.body.session.principalId}（会话不透明，凭据已弃用）`;
  } else {
    $('session-state').textContent = `登录失败 ${r.status} ${r.body && r.body.error}`;
  }
};
$('btn-logout').onclick = () => { state.sessionId = null; $('session-state').textContent = '已注销'; };

// —— 1 客户/快照/订阅 ——
$('btn-load').onclick = async () => {
  const cid = $('customer').value;
  if (!cid) return;
  // 客户切换 = 显式离开当前会话语境：停订阅、清流状态，防错绑（D06 结构面）
  unsubscribe();
  state.customer = cid; state.cursor = null; state.seen.clear(); state.dup = 0; state.unique = 0;
  set('ev-unique', '0'); set('ev-dup', '0'); set('cursor', '—'); set('events', '（无事件）');
  const r = await api(`/api/jw/v2/customers/${cid}/workspace`);
  if (r.status !== 200) { set('workspace', `加载失败 ${r.status} ${JSON.stringify(r.body)}`); return; }
  state.cursor = r.body.eventCursor;
  const s = r.body.snapshot;
  set('workspace', JSON.stringify({ snapshotVersion: r.body.snapshotVersion, eventCursor: r.body.eventCursor, snapshot: s }, null, 2));
  if (s && s.domains) set('domains', JSON.stringify(s.domains, null, 2));
  if (s && s.missing) set('missing', JSON.stringify(s.missing, null, 2));
};

function unsubscribe() {
  if (state.es) { state.es.close(); state.es = null; }
  $('stream-state').textContent = '未订阅';
}

$('btn-subscribe').onclick = () => {
  if (!state.customer) return;
  unsubscribe();
  // 断线重连：EventSource 自动带 Last-Event-ID；游标过期时服务端发 resync —— 重新拉快照再订阅。
  const es = new EventSource(`/api/jw/v2/customers/${state.customer}/events${state.cursor ? `?cursor=${encodeURIComponent(state.cursor)}` : ''}`);
  state.es = es;
  $('stream-state').textContent = '订阅中';
  es.addEventListener('cursor', (e) => {
    const d = JSON.parse(e.data);
    state.cursor = d.eventCursor;
    set('cursor', d.eventCursor || '—');
  });
  es.addEventListener('business', (e) => {
    const env = JSON.parse(e.data);
    if (state.seen.has(env.eventId)) { state.dup += 1; set('ev-dup', String(state.dup)); return; }
    state.seen.add(env.eventId);
    state.unique += 1;
    state.cursor = env.eventId; // 客户端游标前进（重连时作为 Last-Event-ID）
    set('ev-unique', String(state.unique));
    set('cursor', env.eventId);
    const line = `[${env.payloadRef.type}] v${env.aggregateVersion} ${env.eventId.slice(0, 8)}…`;
    set('events', line + '\n' + $('events').textContent.split('\n').slice(0, 19).join('\n'));
  });
  es.addEventListener('resync', (e) => {
    $('resync-flag').classList.remove('hidden');
    es.close(); state.es = null;
    state.cursor = null; // 只重置游标；重新点击"加载快照"后再订阅
    $('stream-state').textContent = '已要求 resync（重新加载快照后重新订阅）';
    console.warn('resync', JSON.parse(e.data));
  });
  es.onerror = () => { $('stream-state').textContent = '断线（浏览器自动重连，Last-Event-ID 续传）'; };
};
$('btn-unsubscribe').onclick = unsubscribe;

// —— 2 媒体占位：常驻；面板开合不重建 ——
function startMedia() {
  if (state.mediaTimer) return;
  state.mediaTimer = setInterval(() => { state.mediaTicks += 1; set('media-tick', String(state.mediaTicks)); }, 1000);
}
// 演示"重建"按钮不存在——结构上不提供卸载路径；仅记录重建次数恒 0。
set('media-rebuilds', '0');
startMedia();

// —— 3 面板开合（只切换可见性，不触达媒体/订阅） ——
$('btn-panel').onclick = () => { $('panel').classList.toggle('hidden'); };

$('btn-gen-id').onclick = () => { $('req-id').value = crypto.randomUUID(); };
async function sendClaim() {
  const goalId = 'demo-goal-1';
  const requestId = $('req-id').value;
  if (!requestId) { set('action-out', '需先填 requestId（Edge 不代生成，防止重复业务动作）'); return; }
  state.lastReqId = requestId;
  const r = await api(`/api/jw/v2/actions/goals/${goalId}/claim`, { method: 'POST', body: { requestId, expectedVersion: 1 } });
  set('action-out', `HTTP ${r.status}\n${JSON.stringify(r.body, null, 2)}\n（上游内核未运行时为 502 UPSTREAM_UNKNOWN：同 requestId 重试安全）`);
}
$('btn-claim').onclick = sendClaim;
$('btn-retry').onclick = () => { if (state.lastReqId) { $('req-id').value = state.lastReqId; sendClaim(); } };

// —— 消息（D09） ——
$('btn-send').onclick = async () => {
  const r = await api(`/api/jw/v2/customers/${state.customer || 'cust-1001'}/messages`, {
    method: 'POST',
    body: {
      requestId: crypto.randomUUID(),
      audience: $('audience').value,
      text: $('msg-text').value,
      internalContent: $('internal-content').checked,
      confirmExternalSend: $('confirm-external').checked,
    },
  });
  set('msg-out', `HTTP ${r.status}\n${JSON.stringify(r.body, null, 2)}`);
};

// —— 5 审计 ——
$('btn-audit').onclick = async () => {
  const r = await api('/api/jw/v2/audit?limit=20');
  set('audit', r.status === 200 ? JSON.stringify(r.body.entries, null, 2) : `HTTP ${r.status} ${JSON.stringify(r.body)}`);
};
