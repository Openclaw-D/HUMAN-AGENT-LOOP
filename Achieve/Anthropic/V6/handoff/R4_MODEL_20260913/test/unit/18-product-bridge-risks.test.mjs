// R4 反例测试:验证产品桥(remote-model-adapter-bridge.ts,MAIN 侧)四个点名风险。
// 原则:先复现——能复现的给红绿证据,不能复现的如实标注"未复现/风险"而非伪称缺陷;
// 涉及正式放行的场景一律失败关闭断言(绝不以 ok 放行过期/越权结果)。
// 被测对象是**产品树内真实 .ts 桥**(Node 22 strip-types 直接驱动),隔离 store 经
// V5_PREVIEW_DATA_DIR 指向 runtime/isolated-store;测试只写 runtime/。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..'); // R4_MODEL_20260913
const SITE = path.resolve(root, '..', '..', '..', 'jianwei-v3', 'site');
const DATA_DIR = path.join(root, 'runtime', 'isolated-store');
mkdirSync(DATA_DIR, { recursive: true });
process.env.V5_PREVIEW_DATA_DIR = DATA_DIR;
const STORE_FILE = path.join(DATA_DIR, 'remote-store.json');

const sha = (seed) => createHash('sha256').update(`synthetic-r4:${seed}`).digest('hex');
const SESSION = 'sess-r4-001';
const EVIDENCE_ID = 'EV-R4-001';

function baseSession(overrides = {}) {
  return {
    sessionId: SESSION,
    projectId: '2026PA21001',
    title: '【合成】实控人远程访谈',
    status: 'live',
    generation: 0,
    participants: [],
    video: { provider: 'none', state: 'not_configured', message: '视频服务未接入' },
    createdAt: '2026-09-13T10:00:00+08:00',
    updatedAt: '2026-09-13T10:00:00+08:00',
    ...overrides,
  };
}

function baseEvidence(overrides = {}) {
  return {
    evidenceId: EVIDENCE_ID,
    projectId: '2026PA21001',
    sessionId: SESSION,
    fixtureId: 'fixture-r4-001',
    title: '【合成】现场照片',
    sourceType: 'simulation_fixture',
    capturedAt: '2026-09-13T09:00:00+08:00',
    receivedAt: '2026-09-13T09:01:00+08:00',
    mime: 'image/svg+xml',
    width: 800,
    height: 600,
    sha256: sha('ev1'),
    version: 1,
    supersededBy: null,
    supersedes: null,
    digestOf: 'fixture_bytes',
    ...overrides,
  };
}

function baseAnnotation(overrides = {}) {
  return {
    annotationId: 'AN-R4-001',
    sessionId: SESSION,
    evidenceId: EVIDENCE_ID,
    evidenceVersion: 1,
    rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
    question: '【合成】回款周期为何拉长?',
    author: 'credit',
    status: 'open',
    version: 1,
    createdAt: '2026-09-13T09:05:00+08:00',
    replies: [],
    ...overrides,
  };
}

/** 写入完整合法 store(形状=产品 persistRemoteStoreState 的 stored 输出)。 */
function writeStore({ version, sessions, evidence, annotations, extra = {} }) {
  const stored = {
    schema: 'v5-preview-remote-store@1',
    version,
    sessions,
    evidence,
    annotations: annotations || [],
    reviews: [],
    calculations: [],
    ruleConfig: { version: 0, status: 'unconfigured', layers: { technicalQuality: null, evidenceSufficiency: null, businessRisk: null, economics: null } },
    idempotency: [],
    ...extra,
  };
  writeFileSync(STORE_FILE, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
}

function readStoreFile() {
  return JSON.parse(readFileSync(STORE_FILE, 'utf8'));
}

function baseStore() {
  writeStore({ version: 7, sessions: [baseSession()], evidence: [baseEvidence()], annotations: [baseAnnotation()] });
}

const EVIDENCE_REF = { fixtureId: 'fixture-r4-001', sha256: sha('ev1'), version: 1 };
const BRIDGE_REQ = {
  requestId: 'req-r4-001',
  sessionId: SESSION,
  annotationId: 'AN-R4-001',
  evidenceRef: EVIDENCE_REF,
  domainRoles: ['credit', 'policy'],
  purpose: 'follow_up_generation',
};

/** 候选 transport:按角色可控返回。output 引用请求实际携带的证据清单。 */
function roleTransport(handlers) {
  return async (call) => {
    const h = handlers[call.payload.role] ?? handlers.default;
    return h(call);
  };
}

function okSimulated(call) {
  const refs = call.payload.evidenceRefs.map((r) => ({ ...r }));
  return {
    ok: true,
    simulated: true,
    output: {
      findings: [{ id: 'F1', text: `示例发现(${call.payload.role}):回款周期异常,建议核对流水。`, evidenceRefs: refs }],
      questions: [{ id: 'Q1', text: `示例追问(${call.payload.role}):请补充主要欠款方对账单。`, evidenceRefs: [] }],
      evidenceRefs: refs,
    },
    usage: { totalTokens: 11 },
  };
}

async function loadBridge() {
  const mod = await import(pathToFileURL(path.join(SITE, 'lib', 'v5-preview', 'remote-model-adapter-bridge.ts')).href);
  return mod.createBridgedModelAdapter;
}

// ------------------------------------------------------------------

test('接线事实:产品 remote-service 真实引用桥(UI 追问路径),且调用点未传 stateProbe(接线缺口,代码级确认)', () => {
  const svc = readFileSync(path.join(SITE, 'lib', 'v5-preview', 'remote-service.ts'), 'utf8');
  assert.ok(svc.includes("from './remote-model-adapter-bridge.ts'"), 'remote-service 必须 import 产品桥');
  assert.ok(svc.includes('createBridgedModelAdapter()'), 'UI 追问路径必须实例化产品桥(真实接线)');
  // 接线缺口:桥调用带对象实参后直接闭合,无第二参 stateProbe → post-await 状态复核在 UI 链路不生效
  const idx = svc.indexOf('bridge.generateFollowUps(');
  assert.ok(idx !== -1, '必须存在桥调用点');
  const callSite = svc.slice(idx, svc.indexOf('});', idx) + 3);
  assert.ok(!callSite.includes('stateProbe'), '调用点未传 stateProbe(确认:post 复核在 UI 链路缺失;残余风险被候选内部快照兜住,见 R-d)');
  // 桥自身支持 probe(机制在,缺的是接线)
  const bridgeSrc = readFileSync(path.join(SITE, 'lib', 'v5-preview', 'remote-model-adapter-bridge.ts'), 'utf8');
  assert.ok(/generateFollowUps\(req: ModelProviderRequest, stateProbe\?/.test(bridgeSrc), '产品桥自身声明 stateProbe 参数(机制存在)');
});

test('R-c 复现确认(缺陷,形态修正):partial 的 UI 动作未反映 unknown 角色"须先人工核实"——人控语义降级', async () => {
  baseStore();
  const createBridgedModelAdapter = await loadBridge();
  // 成功角色用真实通道形状:succeeded 的动作是"待人工复核"(mustHumanVerify=true);
  // 该保守基线不会掩盖 mustHumanVerify,但会掩盖 unknown 专属语义(先核实外部是否实际发生)。
  const bridge = createBridgedModelAdapter({
    transport: roleTransport({
      credit: async (call) => {
        const o = okSimulated(call);
        const { simulated, ...rest } = o;
        return rest; // ok:true → 候选 succeeded
      },
      policy: async () => ({ ok: 'indeterminate' }),
    }),
  });
  const result = await bridge.generateFollowUps(BRIDGE_REQ);
  // 链路事实
  assert.equal(result.status, 'partial');
  assert.equal(result.candidate.perRole.find((p) => p.role === 'policy').status, 'unknown');
  assert.equal(result.candidate.perRole.find((p) => p.role === 'credit').status, 'succeeded');
  // 缺陷证据(红):
  // 1) 现状 UI 动作按 succeeded 表达("待人工复核确认采信"),unknown 角色的
  //    "先人工核实外部是否实际发生,禁止直接重试"专属语义完全丢失;
  assert.equal(result.productAction.uiAction, 'show_result_pending_review');
  assert.notEqual(result.productAction.uiAction, 'human_verify_before_retry');
  // 2) 结构化数据只在 candidate.perRole 元数据里(UI 不消费),不在 productAction;
  assert.ok(result.candidate.perRole.some((p) => p.status === 'unknown'));
  // 3) 失败说明文字仅在 failed/rejected 时落回复,partial 的 dropped 文字被调用点忽略
  //    (remote-service.ts:bridgeResult.status==='ok'||'partial' 分支不处理 failureReason)。
  assert.ok(result.failureReason.includes('policy=unknown'), 'unknown 仅存在于 failureReason 文字');
});

test('R-a 会话消失:快照回退旧 generation 且 paused=false(脆弱模式),但 store.version 推进兜底——无实际逃逸,结果失败关闭', async () => {
  baseStore();
  const createBridgedModelAdapter = await loadBridge();
  const slow = deferred();
  let inFlightRefs = [];
  const bridge = createBridgedModelAdapter({
    transport: roleTransport({
      credit: async (call) => {
        inFlightRefs = call.payload.evidenceRefs.map((r) => ({ ...r }));
        // resolve 后再组装输出(引用在途捕获的真实请求清单)
        return slow.promise.then(() => ({
          ok: true,
          simulated: true,
          output: {
            findings: [{ id: 'F1', text: '示例发现:会话消失前生成。', evidenceRefs: inFlightRefs.map((r) => ({ ...r })) }],
            questions: [],
            evidenceRefs: inFlightRefs.map((r) => ({ ...r })),
          },
          usage: { totalTokens: 3 },
        }));
      },
    }),
    timeoutMs: 5000,
  });
  const p = bridge.generateFollowUps({ ...BRIDGE_REQ, domainRoles: ['credit'] });
  // 在途期间会话被删除(删除=一次 store 写入,version 7→8)
  const store = readStoreFile();
  store.version = 8;
  store.sessions = [];
  writeStore({ version: store.version, sessions: [], evidence: store.evidence, annotations: store.annotations });
  slow.resolve(true);
  const result = await p;
  // 失败关闭断言:绝不以 ok/partial 放行(会话已消失)
  assert.equal(result.status, 'rejected', '会话消失后结果必须 rejected,不得 ok/partial 放行');
  assert.equal(result.replies.length, 0, '拒绝结果不得携带任何模型回复');
  // 误归类记录:原因被归为上下文版本变化(脆弱点:会话消失语义缺失,当前被 store.version 推进兜底;
  // 若未来 contextVersion 改为会话局部版本,此场景将逃逸——建议快照对缺失会话返回 paused:true,见 CHANGE_REQUEST)
  assert.ok(
    /上下文|context|rv8/i.test(result.failureReason ?? ''),
    `消失被误归类为版本过期(实际原因码:${result.candidate?.errorCode ?? result.failureReason})`,
  );
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('R-d 桥级 probe 对照:传 probe 时 post 复核有效降级 rejected;不传 probe 时内部快照兜住暂停(未复现实际逃逸)', async () => {
  baseStore();
  const createBridgedModelAdapter = await loadBridge();

  // (1) 不传 probe:慢 transport 期间会话暂停(generation 0→1,version 7→8)
  //     → 角色内部快照 fresh 读抓到变化(generation 推进先于 paused 检查)→ stale → rejected。
  //     内部快照兜底,未复现实际逃逸;残余窗口(全部角色完成后)趋零。
  {
    const slow = deferred();
    let inFlightRefs = [];
    const bridge = createBridgedModelAdapter({
      transport: roleTransport({
        credit: async (call) => {
          inFlightRefs = call.payload.evidenceRefs.map((r) => ({ ...r }));
          return slow.promise.then(() => ({
            ok: true,
            simulated: true,
            output: {
              findings: [{ id: 'F1', text: '暂停前生成。', evidenceRefs: inFlightRefs.map((r) => ({ ...r })) }],
              questions: [],
              evidenceRefs: inFlightRefs.map((r) => ({ ...r })),
            },
            usage: { totalTokens: 2 },
          }));
        },
      }),
      timeoutMs: 5000,
    });
    const p = bridge.generateFollowUps({ ...BRIDGE_REQ, domainRoles: ['credit'] });
    const store = readStoreFile();
    store.version = 8;
    store.sessions = [{ ...store.sessions[0], status: 'paused', generation: 1 }];
    writeStore({ version: store.version, sessions: store.sessions, evidence: store.evidence, annotations: store.annotations });
    slow.resolve(true);
    const r = await p;
    assert.equal(r.status, 'rejected', '不传 probe:暂停/推进必须被角色内部快照兜住(降级 rejected),不得放行');
    assert.ok(
      /会话已推进|上下文版本|暂停|paused/i.test(r.failureReason ?? ''),
      `失败原因必须指明状态失效(实际:${r.failureReason})`,
    );
  }

  // (2) 传 probe:transport 立即成功 + probe 报 paused。注意归因:本用例的静态 probe
  //     (恒 paused)实际命中的是 pre-call 状态门(拒绝对象 downgrade 自证"pre-call state gate,
  //     未调用候选");post-await 复核分支(bridge.ts:440-455)的有效性由独立审计的双态 probe
  //     补证(probeCalls=2、downgrade 标注 post-await,见 AUDIT_REPORT_R4.md)。
  //     真实缺口在产品调用点(remote-service.ts:539)未传 probe → 该防线在 UI 链路整体缺失。
  {
    const bridge = createBridgedModelAdapter({
      transport: roleTransport({ credit: okSimulated }),
      timeoutMs: 5000,
    });
    const r = await bridge.generateFollowUps(
      { ...BRIDGE_REQ, domainRoles: ['credit'] },
      () => ({ sessionStatus: 'paused', currentEvidenceVersion: 1 }),
    );
    assert.equal(r.status, 'rejected', '传 probe:状态门必须把成功结果降级 rejected');
    assert.ok(/session paused/.test(r.failureReason ?? ''), `降级原因应指明暂停:${r.failureReason}`);
    assert.equal(r.candidate.downgrade !== undefined, true, '降级必须留痕(downgrade 标注)');
    assert.ok((r.candidate.downgrade ?? '').includes('pre-call'), '静态 paused probe 命中 pre-call 状态门(归因说明,见注释)');
  }
});

test('R-b gate 不可达(接口缺口确认):产品桥无 gate 入口,候选 scope 恒 null;产品层由 reviews/verification 承担等价门', async () => {
  baseStore();
  const bridgeSrc = readFileSync(path.join(SITE, 'lib', 'v5-preview', 'remote-model-adapter-bridge.ts'), 'utf8');
  assert.ok(!bridgeSrc.includes('professionalReviewPassed'), '产品桥不得伪造候选 gate;当前确认:gate 入口缺失(接口缺口)');
  assert.ok(!bridgeSrc.includes("gate:"), '桥 analyze 调用不得传入未实现的 gate 键');

  const createBridgedModelAdapter = await loadBridge();
  const bridge = createBridgedModelAdapter({ transport: roleTransport({ credit: okSimulated }) });
  const result = await bridge.generateFollowUps({ ...BRIDGE_REQ, domainRoles: ['credit'] });
  assert.equal(result.status, 'ok');
  assert.equal(result.candidate.scope, null, 'gate 未传 → 候选 scope 恒 null(预处理人控边界在产品桥不可达;产品层等价门=reviews/human_verified)');
});

test('service 级端到端:simulateFollowUps(UI 入口)→ 桥 → annotation.replies 回写 + 幂等重放(requestId 全链)', async () => {
  baseStore();
  const svc = await import(pathToFileURL(path.join(SITE, 'lib', 'v5-preview', 'remote-service.ts')).href);
  const body = { sessionId: SESSION, annotationId: 'AN-R4-001', requestId: 'req-svc-r4-001', expectedVersion: 7 };
  const out = await svc.simulateFollowUps(body);
  // 桥接入事实:replies 出现模型通道内容(模拟声明/模型发现,authority=none 标注)
  const store = readStoreFile();
  const annotation = store.annotations.find((a) => a.annotationId === 'AN-R4-001');
  assert.ok(annotation, '标注必须仍指向同一会话');
  const sim = annotation.replies.filter((r) => r.kind === 'model_simulation');
  assert.ok(sim.length >= 2, `桥接入必须回写多条模型通道回复(声明+发现/追问),实际 ${sim.length}`);
  assert.ok(sim.some((r) => r.text.includes('SIMULATED') || (r.author ?? '').includes('模拟')), '模拟声明必须显著(不得隐藏)');
  assert.ok(sim.some((r) => (r.author ?? '').includes('authority=none')), '模型回复必须标注 authority=none');
  // 四角色接线证据:replies 覆盖 credit/policy/commerce/asset 中的至少两个角色标注
  const roles = new Set(sim.map((r) => r.author).join('|').match(/credit|policy|commerce|asset/g));
  assert.ok(roles.size >= 2, `多角色经桥调用(实际覆盖:${[...roles].join(',')})`);
  // 幂等重放:同 requestId 同载荷 → 重放响应,不追加回复
  const before = store.annotations.find((a) => a.annotationId === 'AN-R4-001').replies.length;
  const out2 = await svc.simulateFollowUps(body);
  const after = readStoreFile().annotations.find((a) => a.annotationId === 'AN-R4-001').replies.length;
  assert.equal(before, after, '幂等重放不得追加回复');
  assert.ok(out2 !== undefined);
  // 清理问题不得吞观点:replies 是追加式(首条为模拟声明,后续发现/追问并列存在,不被清空或互相顶替)
  assert.ok(sim[0].text.includes('SIMULATED') || sim[0].author.includes('模拟'), '首条回复必须是模拟声明');
  assert.ok(sim.length >= 1 && annotation.replies.length === sim.length, '回复数组完整保留,无覆盖清空');
});
