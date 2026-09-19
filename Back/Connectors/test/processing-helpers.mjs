// goal-02 · 处理链测试共享设施：真实 ZIP 字节构造（store 法+CRC32，零依赖）、固定 CSV 夹具、
// compose+startServer 处理 harness（真实 PG + 真实 HTTP 入口；解析一律送原始字节）。
import { compose, FakeWecomTransport } from '../src/compose.mjs';
import { startServer } from '../src/http/server.mjs';
import { createTestDatabase, dropTestDatabase, makeStore, migrate } from '../src/store/pg.mjs';
import { makeFsObjectStore } from '../src/objectstore/fs.mjs';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const TENANT = 'tenant_proc';
export const SIGNING_SECRET = 'proc_test_signing_secret';
// 测试 PG 端口可用 CONNECTORS_TEST_PG_PORT 覆盖（并行轮次各自专用容器，避免共享容器干扰假失败）
export const BASE_PG = {
  host: '127.0.0.1',
  port: Number(process.env.CONNECTORS_TEST_PG_PORT ?? 15443),
  user: process.env.CONNECTORS_TEST_PG_USER ?? 'cnext',
  password: process.env.CONNECTORS_TEST_PG_PASSWORD ?? 'cnext',
  database: process.env.CONNECTORS_TEST_PG_DATABASE ?? 'cnext',
};

// ---------- 固定测试数据（DESIGN §2；全部原始字节） ----------

/** 银行流水 CSV：2026-01/02 两个月，8 行，收入 76000，支出 12500.5。 */
export function bankCsvBytes({ year = 2026 } = {}) {
  const rows = [
    [`${year}-01-05`, '0', '12000.50', '88000', '购料款'],
    [`${year}-01-12`, '36000', '0', '124000.50', '货款'],
    [`${year}-01-20`, '0', '500', '123500.50', '手续费'],
    [`${year}-01-28`, '40000', '0', '163500.50', '货款'],
    [`${year}-02-03`, '0', '2000', '161500.50', '房租'],
    [`${year}-02-10`, '36000', '0', '197500.50', '货款'],
  ];
  const head = '交易日期,收入,支出,余额,摘要';
  return Buffer.from([head, ...rows.map((r) => r.join(','))].join('\n'), 'utf8');
}

/** 声明表 CSV（declared 级；可指定字段）。 */
export function declCsvBytes(fields = { monthly_operating_cash_flow: '46000', monthly_debt_service: '18000' }) {
  const lines = ['key,value,unit,caliber'];
  for (const [k, v] of Object.entries(fields)) lines.push(`${k},${v},元,权责发生`);
  return Buffer.from(lines.join('\n'), 'utf8');
}

/** 文本声明（declared 级）。 */
export function declTxtBytes(fields = { equipment_model: 'LX-105', equipment_ownership_verified: 'yes' }) {
  return Buffer.from(Object.entries(fields).map(([k, v]) => `${k} = ${v}`).join('\n'), 'utf8');
}

/** 不支持格式（PDF 魔数最小字节）。 */
export function fakePdfBytes() {
  return Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8');
}

// ---------- 真实 ZIP 构造（store 法；CRC32；zipguard 可解） ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{name, data:Buffer}] → 真实 ZIP 字节（method=0 store）。 */
export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);  // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdStart = offset;
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

// ---------- 处理 harness ----------

/** 独立 PG 测试库 + compose（含 processing 协调器）+ startServer；返回 HTTP api 助手。 */
export async function makeProcessingHarness({
  port = 48281,
  processing = {},
  aBaseUrl = null,
  aFetchImpl = null,
  aConfig = null,
  fakeTransport = null,
} = {}) {
  const created = await createTestDatabase(BASE_PG);
  const objectRoot = join(ROOT, '.run', `test-objects-${created.dbName}`);
  mkdirSync(objectRoot, { recursive: true });
  const svc = await compose({
    pg: created,
    objectRoot,
    signingSecret: SIGNING_SECRET,
    serviceToken: 'proc_service_token',
    wecomTransport: fakeTransport ?? new FakeWecomTransport(),
    aBaseUrl,
    aCredential: aBaseUrl ? (aConfig?.credentials?.uploadFallback ?? 'tok-connector') : null,
    aFetchImpl,
    a: aBaseUrl ? { defaultTenantId: TENANT, ...(aConfig ?? {}) } : null,
    processing,
  });
  const server = await startServer(svc, {
    port,
    wecomConfig: { token: 'x', aesKey: 'x'.padEnd(32, 'x'), corpid: 'x', defaultTenantId: TENANT },
    trtcCallbackKey: SIGNING_SECRET,
    serviceToken: 'proc_service_token',
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (path, body, { token = 'proc_service_token', expect = 200, method = 'POST' } = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-service-token': token },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status !== expect) {
      throw new Error(`${path} → ${r.status}（期望 ${expect}）: ${JSON.stringify(j).slice(0, 300)}`);
    }
    return j;
  };
  return {
    svc, server, api, dbName: created.dbName,
    store: svc.store,
    async dispose() {
      await server.close();
      await svc.close();
      await dropTestDatabase(BASE_PG, created.dbName);
      rmSync(objectRoot, { recursive: true, force: true });
    },
  };
}

/** 受控邀请+接受+验证绑定（active）：返回 invitationId。 */
export async function setupInvitation(api, { role = 'customer_finance', kinds = ['statement', 'document'], customerId = 'cust-proc-1' } = {}) {
  const inv = await api('/api/connectors/intake/invitations', {
    tenantId: TENANT, customerId, role, allowedEvidenceKinds: kinds, objectRefs: [], ttlSec: 3600, createdBy: 'op-1',
  });
  await api('/api/connectors/intake/accept', { tenantId: TENANT, token: inv.token, provider: 'wecom_kf', providerUserId: `wx-${inv.invitationId}` });
  return inv;
}

/** 上传原始字节走真实入口。 */
export async function uploadBytes(api, inv, { kind = 'statement', bytes, periodFrom = null, periodTo = null, currency = 'CNY', supersedes = null, customerId = 'cust-proc-1' } = {}) {
  return api('/api/connectors/evidence/upload', {
    tenantId: TENANT, customerId, invitationId: inv.invitationId, kind,
    contentBase64: bytes.toString('base64'), contentType: 'application/octet-stream',
    periodFrom, periodTo, currency, caliber: kind === 'statement' ? '收付实现' : '权责发生',
    ...(supersedes ? { supersedesEvidenceId: supersedes } : {}),
  });
}

/** 跑 tick 直到没有可认领任务（有界轮次）。 */
export async function driveToEnd(api, { maxRounds = 12, maxTasks = 4 } = {}) {
  const rounds = [];
  for (let i = 0; i < maxRounds; i++) {
    const r = await api('/api/connectors/processing/tick', { maxTasks });
    rounds.push(r);
    if (r.claimed === 0) break;
  }
  return rounds;
}
