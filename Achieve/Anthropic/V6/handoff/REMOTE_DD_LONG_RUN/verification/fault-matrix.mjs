// V6 REMOTE_DD_LONG_RUN · 故障矩阵（HTTP 层，3321 隔离实例 + 隔离数据）。
// 运行：node fault-matrix.mjs phase1 && （归属校验重启）&& node fault-matrix.mjs phase2
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3321';
const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`); };

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
let n = 0;
const rid = () => `fm-${Date.now().toString(36)}-${(n++).toString(36)}`;

const action = process.argv[2] ?? 'phase1';
let state = (await get('/api/v5-preview/remote-session')).json;
let V = state.remoteVersion;

// 会话 + 证据 + 标注（每轮独立 requestId，避免污染其它轮）
const created = await post('/api/v5-preview/remote-session', { requestId: rid(), expectedVersion: V, title: '故障矩阵（合成）' });
V = created.json.remoteVersion;
const sessionId = created.json.session.sessionId;
const ev = await post('/api/v5-preview/remote-session/evidence', { requestId: rid(), expectedVersion: V, sessionId, fixtureId: 'fixture-equipment' });
V = ev.json.remoteVersion;
const evidenceId = ev.json.evidence.evidenceId;

if (action === 'phase1') {
  // F1 重复提交幂等：同 requestId 同载荷两次 → 同一标注、不重复
  const body = { expectedVersion: V, sessionId, evidenceId, evidenceVersion: 1, question: '故障矩阵标注（合成）', rect: { x: 0.2, y: 0.2, w: 0.3, h: 0.25 } };
  const reqId = rid();
  const a1 = await post('/api/v5-preview/remote-session/annotations', { ...body, requestId: reqId });
  const a2 = await post('/api/v5-preview/remote-session/annotations', { ...body, requestId: reqId });
  V = a1.json.remoteVersion;
  record('重复提交幂等（同 requestId 不重复创建）', a1.json.annotation.annotationId === a2.json.annotation.annotationId && a2.json.remoteVersion === a1.json.remoteVersion, `id=${a1.json.annotation.annotationId.slice(-8)}`);

  // F2 非法圈选（越界/过小/非数字）→ 400
  const bad1 = await post('/api/v5-preview/remote-session/annotations', { requestId: rid(), expectedVersion: V, sessionId, evidenceId, evidenceVersion: 1, question: '越界', rect: { x: 0.95, y: 0.2, w: 0.3, h: 0.2 } });
  const bad2 = await post('/api/v5-preview/remote-session/annotations', { requestId: rid(), expectedVersion: V, sessionId, evidenceId, evidenceVersion: 1, question: '非数字', rect: { x: 'abc', y: 0.2, w: 0.1, h: 0.1 } });
  record('非法圈选拒绝（400 INVALID_INPUT）', bad1.status === 400 && bad2.status === 400, `bad1=${bad1.status} bad2=${bad2.status}`);

  // F3 模型格式错误：非法 kind → 400；模型回复不写已核实状态
  const detail = (await get(`/api/v5-preview/remote-session/detail?sessionId=${sessionId}`)).json;
  const annotationId = detail.annotations[0].annotationId;
  const badKind = await post('/api/v5-preview/remote-session/annotations/replies', { requestId: rid(), expectedVersion: V, sessionId, annotationId, kind: 'auto_approve', text: '试图自动批准（合成）' });
  record('模型/回复非法 kind 拒绝（400）', badKind.status === 400, `status=${badKind.status}`);

  // F4 陈旧回执不污染：旧版本回执（延迟到来的 409）后，最新状态不被回退
  const stale = await post('/api/v5-preview/remote-session/annotations', { requestId: rid(), expectedVersion: V - 2, sessionId, evidenceId, evidenceVersion: 1, question: '旧版本写入（合成）', rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } });
  const after = (await get(`/api/v5-preview/remote-session/detail?sessionId=${sessionId}`)).json;
  record('旧版本写入被拒且状态不回退', stale.status === 409 && after.annotations.length === 1 && after.remoteVersion === V, `stale=${stale.status} annotations=${after.annotations.length}`);

  // F5 跨项目拒绝：伪造 projectId 不同的会话创建 → 失败关闭（服务端固定冻结项目，body 传 project 不生效）
  const cross = await post('/api/v5-preview/remote-session', { requestId: rid(), expectedVersion: V, title: '跨项目尝试', projectId: 'OTHER-999' });
  record('会话归属服务端决定（伪造 projectId 不生效）', cross.json.session.projectId === 'JW-2026-018', `projectId=${cross.json.session.projectId}`);
}

if (action === 'phase2') {
  // 重启后：phase1 的会话/证据/标注仍在（扫描所有会话找含标注者），状态跨重启恢复
  let detail = null;
  for (const s of state.sessions) {
    const d = (await get(`/api/v5-preview/remote-session/detail?sessionId=${s.sessionId}`)).json;
    if (d.annotations.length > 0) { detail = d; break; }
  }
  if (detail === null) { record('重启后状态恢复', false, '未找到含标注的会话'); process.exit(1); }
  const annotation = detail.annotations[0];
  record('重启后状态恢复（会话/证据/标注存活）', detail.session.sessionId === detail.session.sessionId && detail.evidence.length >= 1 && detail.annotations.length >= 1, `v${detail.remoteVersion} evidence=${detail.evidence.length} annotations=${detail.annotations.length}`);
}

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ action, total: results.length, failed: failed.length }));
process.exit(failed.length > 0 ? 1 : 0);
