#!/usr/bin/env node
// goal-client.mjs — 目标协作内核 CLI 测试客户端（人工以 API/CLI 介入的正式通道；不模拟前端点击）。
// 用法：node scripts/goal-client.mjs --base http://127.0.0.1:48080 --token <credential> <command> [args]
// 命令：
//   template-create --file <tpl.json>          项目建模板（admin）
//   project-create --template <id> --name <n>
//   evidence --project <id> --kind <k> --content '<json>'
//   supersede --project <id> --evidence <id> --expectedVersion <n> --content '<json>'
//   goal-create --project <id> --goal-key <key>
//   show --project <id> | goal --id <goalId> | events --after <seq> | health
//   claim --goal <id> | complete --goal <id> --fencing <n> --provider simulation --output '<json>' [--refs ev1,ev2]
//          | fail --goal <id> --fencing <n> --note <s>
//   accept --goal <id> | decide --goal <id> --decision approved|rejected|withdrawn [--note <s>]
//   pause --goal <id> | resume --goal <id> | takeover --goal <id>
//   hr-create --project <id> [--goal <id>] --kind missing_evidence --question <s> --role <roleKey> [--kinds k1,k2]
//   hr-respond --id <hrequestId> --text <s> [--refs ev1@1,ev2@1] | hr-cancel --id <hrequestId>
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else rest.push(argv[i]);
  }
  return { opts, rest };
}

const { opts, rest } = parseArgs(process.argv.slice(2));
const base = opts.base ?? 'http://127.0.0.1:48080';
const token = opts.token ?? '';
const command = rest[0];
if (command === undefined) {
  console.error('缺少 command（见文件头注释）');
  process.exit(2);
}

let seq = Math.floor(Math.random() * 1e9);
const requestId = () => `cli-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const j = (s) => (s === undefined ? undefined : JSON.parse(s));

async function call(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-principal-credential'] = token;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const expect = (r, label) => {
  const ok = r.status >= 200 && r.status < 300;
  console.log(`[${ok ? 'OK' : 'ERR'}] ${label} → ${r.status} ${JSON.stringify(r.json)}`);
  if (!ok) process.exit(1);
  return r.json;
};

(async () => {
  const rid = requestId();
  switch (command) {
    case 'health': expect(await call('GET', '/healthz'), 'health'); break;
    case 'template-create': expect(await call('POST', '/api/v1/templates', { requestId: rid, ...j(readFileSync(opts.file, 'utf8')) }), 'template-create'); break;
    case 'project-create': expect(await call('POST', '/api/v1/projects', { requestId: rid, templateId: opts.template, name: opts.name }), 'project-create'); break;
    case 'evidence': expect(await call('POST', `/api/v1/projects/${opts.project}/evidence`, { requestId: rid, expectedVersion: Number(opts.expectedVersion), kind: opts.kind, content: j(opts.content) }), 'evidence'); break;
    case 'supersede': expect(await call('POST', `/api/v1/projects/${opts.project}/evidence/${opts.evidence}/supersede`, { requestId: rid, expectedVersion: Number(opts.expectedVersion), content: j(opts.content) }), 'supersede'); break;
    case 'goal-create': expect(await call('POST', `/api/v1/projects/${opts.project}/goals`, { requestId: rid, goalKey: opts.goalKey }), 'goal-create'); break;
    case 'show': expect(await call('GET', `/api/v1/projects/${opts.project}`), 'show'); break;
    case 'goal': expect(await call('GET', `/api/v1/goals/${opts.id}`), 'goal'); break;
    case 'events': expect(await call('GET', `/api/v1/events?after=${opts.after ?? 0}&limit=${opts.limit ?? 100}`), 'events'); break;
    case 'claim': expect(await call('POST', `/api/v1/goals/${opts.goal}/claim`, { requestId: rid, expectedVersion: Number(opts.expectedVersion) }), 'claim'); break;
    case 'complete': {
      const refs = opts.refs ? String(opts.refs).split(',') : [];
      expect(await call('POST', `/api/v1/goals/${opts.goal}/complete`, {
        requestId: rid, expectedVersion: Number(opts.expectedVersion), fencingToken: Number(opts.fencing),
        result: { provider: opts.provider ?? 'simulation', output: j(opts.output) ?? {}, evidenceRefs: refs, notes: opts.notes ?? '' },
      }), 'complete');
      break;
    }
    case 'fail': expect(await call('POST', `/api/v1/goals/${opts.goal}/fail`, { requestId: rid, expectedVersion: Number(opts.expectedVersion), fencingToken: Number(opts.fencing), note: opts.note ?? '' }), 'fail'); break;
    case 'accept': expect(await call('POST', `/api/v1/goals/${opts.goal}/accept`, { requestId: rid, expectedVersion: Number(opts.expectedVersion), ...(opts.ack ? { staleReviewAck: { note: String(opts.ack) } } : {}) }), 'accept'); break;
    case 'decide': expect(await call('POST', `/api/v1/goals/${opts.goal}/decide`, { requestId: rid, expectedVersion: Number(opts.expectedVersion), decision: opts.decision, note: opts.note ?? '', ...(opts.ack ? { staleReviewAck: { note: String(opts.ack) } } : {}) }), 'decide'); break;
    case 'pause': expect(await call('POST', `/api/v1/goals/${opts.goal}/pause`, { requestId: rid, expectedVersion: Number(opts.expectedVersion) }), 'pause'); break;
    case 'resume': expect(await call('POST', `/api/v1/goals/${opts.goal}/resume`, { requestId: rid, expectedVersion: Number(opts.expectedVersion) }), 'resume'); break;
    case 'takeover': expect(await call('POST', `/api/v1/goals/${opts.goal}/takeover`, { requestId: rid, expectedVersion: Number(opts.expectedVersion) }), 'takeover'); break;
    case 'hr-create': expect(await call('POST', `/api/v1/projects/${opts.project}/human-requests`, {
      requestId: rid, goalId: opts.goal ?? null, kind: opts.kind, question: opts.question,
      requestedRole: opts.role, requiredEvidenceKinds: opts.kinds ? String(opts.kinds).split(',') : [],
    }), 'hr-create'); break;
    case 'hr-respond': {
      const refs = opts.refs ? String(opts.refs).split(',').map((s) => { const [evidenceId, version] = s.split('@'); return { evidenceId, version: Number(version ?? 1) }; }) : [];
      expect(await call('POST', `/api/v1/human-requests/${opts.id}/respond`, { requestId: rid, answer: { text: opts.text ?? '', evidenceRefs: refs } }), 'hr-respond');
      break;
    }
    case 'hr-cancel': expect(await call('POST', `/api/v1/human-requests/${opts.id}/cancel`, { requestId: rid }), 'hr-cancel'); break;
    default:
      console.error(`未知命令 ${command}`);
      process.exit(2);
  }
})().catch((e) => { console.error('client error:', e.message); process.exit(1); });
