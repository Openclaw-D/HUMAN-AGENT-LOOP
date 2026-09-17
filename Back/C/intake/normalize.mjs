// 任务 02 · B1 统一真实输入：商机触发 → 客户主档归集 → 分级邀请 → 批次接收规范化。
// 硬边界（任务书 B1 / 验收 W01–W03）：
// - 商机只负责触发：客户主档归集商机，不把商机字段冒充客户身份；营业执照提取是主档候选，
//   不自动证明操作者授权（授权只来自受控绑定 + 分级邀请）。
// - 文件接收 / 解析 / 事实候选 / 人工核验 / 进入评估 分开：本模块只做"接收与正规化"，
//   不产出事实候选、不做解析推断（解析属感知层 declaredFacts 契约）。
// - 元数据（主体/期间/币种/单位/口径/页或时间段/上传者/来源）不齐 → 待补（pending_supplement），
//   加密/缺页/不可读 → 待补，绝不编数。
// - 同源依赖：扫描/抽帧/转写/生成对象/渲染必须声明 derivedFrom，继承根上传的来源链；
//   文件数量与多域复述不增加独立证明（独立来源按根上传去重计数）。
// - 口径差不是自动欺诈：银行流水口径自动附"入账≠经营收入"注记；相似金额不做设备自动匹配。
// - 恢复不伪装完成：批次无倒计时，待补不产生到期；同输入重跑确定性同 id。
// 本模块为确定性纯结构化编排：零 IO、零外部调用（E1）。

import { stableStringify, stableHash } from '../domains/util.mjs';

export const INTAKE_NORMALIZER_VERSION = 'intake-normalize@1';

export const INVITE_ROLES = Object.freeze(['legal_rep', 'factory_manager', 'finance', 'bookkeeping_agent']);
export const BATCH_STATUSES = Object.freeze(['open', 'supplement_waiting', 'aligned']);

const CALIBER_NOTES = Object.freeze({
  bank_receipts: '银行流水口径：全部入账不直接当经营收入；与申报收入的口径差属待核验差异，不是自动欺诈结论',
  tax_filing: '税报口径：与会计账/流水的口径差须先对齐主体与期间再比对',
  accounting_ledger: '会计账口径：含税/不含税与收付实现/权责发生须逐项声明',
  equipment_contract: '购机合同口径：合同金额与实际支付可冲突，不以金额相似自动匹配设备',
});

function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStrArr(v) { return Array.isArray(v) && v.every(isStr); }

/** 商机绑定：客户主档归集多个商机/场所；绑定是候选，不自动授予内部权限。 */
export function bindOpportunityToCustomer({ customerId, opportunities = [], placeIds = [] }) {
  const problems = [];
  if (!isStr(customerId)) problems.push('customerId 必填（主档归集键）');
  if (!Array.isArray(opportunities) || !opportunities.every(isStr)) problems.push('opportunities 必须为非空字符串数组');
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    binding: {
      customerId,
      opportunityIds: [...new Set(opportunities)],
      placeIds: [...new Set(placeIds.filter(isStr))],
      note: '绑定为主档候选归集；操作者授权由分级邀请与受控绑定独立给出，不因商机/执照提取自动获得',
      internalAccessGranted: false,
    },
  };
}

/**
 * 分级邀请：客户侧角色 × 允许主体 × 允许材料种类。内部角色不可自助邀请（W01）。
 */
export function createInvitation({ inviteId, role, allowedSubjects = [], allowedKinds = [], createdBy }) {
  const problems = [];
  if (!isStr(inviteId)) problems.push('inviteId 必填');
  if (!INVITE_ROLES.includes(role)) problems.push(`role 必须 ${INVITE_ROLES.join('/')}（内部角色不可自助邀请）`);
  if (!isStrArr(allowedSubjects)) problems.push('allowedSubjects 必须为非空字符串数组（主体/期间授予面）');
  if (!isStrArr(allowedKinds)) problems.push('allowedKinds 必须为非空字符串数组（材料种类授予面）');
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    invitation: {
      inviteId, role, allowedSubjects: [...allowedSubjects], allowedKinds: [...allowedKinds],
      createdBy: createdBy ?? null,
      note: '邀请只授予上传范围的分级访问；同一客户内部权限（政策/评分/内部报告）不因邀请产生',
    },
  };
}

/** 单上传元数据校验（B1.2）。返回问题清单；空清单=元数据齐全。 */
export function validateUploadMetadata(u) {
  const problems = [];
  if (u === null || typeof u !== 'object') return ['上传必须为对象'];
  if (!isStr(u.uploadId)) problems.push('uploadId 必填');
  if (!isStr(u.subjectId)) problems.push('subjectId（主体）必填：材料须按主体归集后才能跨源比对');
  if (!isStr(u.period)) problems.push('period（期间）必填：月度/期间口径须显式声明');
  if (!isStr(u.kind)) problems.push('kind（材料种类）必填');
  if (u.currency !== undefined && !isStr(u.currency)) problems.push('currency 非法');
  if (u.unit !== undefined && !isStr(u.unit)) problems.push('unit 非法');
  if (!isStr(u.caliber)) problems.push('caliber（收付/会计/含税口径）必填：口径缺失不得默认');
  if (!isStr(u.uploaderInviteId)) problems.push('uploaderInviteId 必填：上传须挂到已验证邀请');
  if (!isStr(u.sourceChannel)) problems.push('sourceChannel（来源渠道）必填');
  if (!isStr(u.content)) problems.push('content 必填（原件受控对象引用或合成文本）；内容哈希在接收时计算');
  if (u.pageOrTimespan !== undefined && !isStr(u.pageOrTimespan)) problems.push('pageOrTimespan 非法');
  return problems;
}

/**
 * 批次规范化（B1 全部接收侧判据的确定性汇聚点）。
 * @param p.batch {batchId, customerId, uploads:[]}
 * @param p.invitations createInvitation 产物数组（分级邀请；授权唯一来源）
 * @param p.bindings bindOpportunityToCustomer 产物数组（主档归集；至少一条覆盖 batch.customerId）
 * @returns {ok, intake} | {ok:false, problems}
 */
export function normalizeIntakeBatch({ batch, invitations = [], bindings = [], now = () => new Date().toISOString() }) {
  const problems = [];
  if (!batch || typeof batch !== 'object') return { ok: false, problems: ['batch 必须为对象'] };
  if (!isStr(batch.batchId)) problems.push('batchId 必填');
  if (!isStr(batch.customerId)) problems.push('batch.customerId 必填');
  if (!Array.isArray(batch.uploads)) problems.push('batch.uploads 必须为数组');
  const binding = (bindings ?? []).find((b) => b?.binding?.customerId === batch.customerId);
  if (!binding) problems.push(`客户 ${batch.customerId} 无主档归集绑定：商机必须先经 bindOpportunityToCustomer 归集`);
  const inviteById = new Map((invitations ?? []).map((i) => {
    const inv = i?.invitation ?? i; // 兼容 createInvitation 结果包装或裸 invitation
    return [inv.inviteId, inv];
  }));
  if (problems.length > 0) return { ok: false, problems };

  const accepted = [];
  const pendingSupplement = [];
  for (const u of batch.uploads) {
    const metaProblems = validateUploadMetadata(u);
    if (metaProblems.length > 0) {
      pendingSupplement.push({ uploadId: u?.uploadId ?? '(缺id)', reasonCode: 'METADATA_INCOMPLETE', problems: metaProblems, messageZh: '元数据不齐：待补，不编数' });
      continue;
    }
    const inv = inviteById.get(u.uploaderInviteId);
    if (!inv) {
      pendingSupplement.push({ uploadId: u.uploadId, reasonCode: 'UNKNOWN_INVITE', problems: [`邀请 ${u.uploaderInviteId} 不存在`], messageZh: '上传未挂到已验证邀请：拒绝归集，不默认授权' });
      continue;
    }
    // W01 分级访问：主体与种类必须在邀请授予面内；越权=待补，不静默收下
    if (!inv.allowedSubjects.includes(u.subjectId) || !inv.allowedKinds.includes(u.kind)) {
      pendingSupplement.push({
        uploadId: u.uploadId, reasonCode: 'OUTSIDE_INVITE_SCOPE',
        problems: [`主体 ${u.subjectId} 或种类 ${u.kind} 超出邀请 ${inv.inviteId}（${inv.role}）授予面`],
        messageZh: '超出该邀请的分级上传范围：待补合法授权或改由有权邀请上传',
      });
      continue;
    }
    // 加密/不可读占位（接收侧只认显式声明；真实解析在感知层）
    if (u.readability && !['readable', 'encrypted', 'unreadable', 'missing_pages'].includes(u.readability)) {
      pendingSupplement.push({ uploadId: u.uploadId, reasonCode: 'READABILITY_INVALID', problems: ['readability 非法'], messageZh: '可读性声明非法：待补' });
      continue;
    }
    if (u.readability && u.readability !== 'readable') {
      pendingSupplement.push({
        uploadId: u.uploadId, reasonCode: 'SUPPLEMENT_REQUIRED',
        problems: [u.readability], messageZh: '加密/缺页/不可读：返回待补，不推断内容',
      });
      continue;
    }
    accepted.push({
      uploadId: u.uploadId,
      subjectId: u.subjectId,
      period: u.period,
      kind: u.kind,
      caliber: u.caliber,
      currency: u.currency ?? null,
      unit: u.unit ?? null,
      pageOrTimespan: u.pageOrTimespan ?? null,
      uploaderInviteId: u.uploaderInviteId,
      uploaderRole: inv.role,
      sourceChannel: u.sourceChannel,
      derivedFrom: u.derivedFrom ?? null,
      contentHash: stableHash({ kind: u.kind, content: u.content }),
      receivedAt: now(),
      caliberNote: CALIBER_NOTES[u.caliber] ?? null,
    });
  }

  // 同源依赖：每个已收上传回溯完整祖先链；任一祖先待补/缺失/成环 → 派生件级联待补，
  // 不接受断链归集（派生件不能独立成为来源证明）
  const acceptedById = new Map(accepted.map((a) => [a.uploadId, a]));
  const pendingIds = new Set(pendingSupplement.map((p) => p.uploadId));
  for (const a of [...accepted]) {
    const seen = new Set();
    let cur = a;
    let chainOk = true;
    while (cur.derivedFrom) {
      if (seen.has(cur.uploadId)) { chainOk = false; break; } // 环
      seen.add(cur.uploadId);
      const parent = batch.uploads.find((u) => u?.uploadId === cur.derivedFrom);
      if (!parent || pendingIds.has(parent.uploadId) || !acceptedById.has(parent.uploadId)) {
        pendingSupplement.push({
          uploadId: a.uploadId, reasonCode: 'SOURCE_CHAIN_INCOMPLETE',
          problems: [`祖先件 ${cur.derivedFrom} 缺失/待补`],
          messageZh: '同源父件缺失/待补：派生件不能独立归集',
        });
        chainOk = false;
        break;
      }
      cur = parent;
    }
    if (!chainOk) {
      acceptedById.delete(a.uploadId);
      pendingIds.add(a.uploadId);
    }
  }
  const finalAccepted = accepted.filter((a) => acceptedById.has(a.uploadId));
  accepted.length = 0;
  accepted.push(...finalAccepted);

  const sourceRegistry = {};
  for (const a of accepted) {
    const roots = [];
    let cur = a;
    const seen = new Set();
    while (cur.derivedFrom && !seen.has(cur.uploadId)) {
      seen.add(cur.uploadId);
      roots.push(cur.derivedFrom);
      cur = acceptedById.get(cur.derivedFrom);
    }
    sourceRegistry[a.uploadId] = { derivedFrom: a.derivedFrom, rootUploadId: cur.uploadId, ancestry: roots };
  }

  // 主体/期间对齐表（B1.3）：先对齐再比对；对齐结果只定位差异，不产出结论
  const alignment = {};
  for (const a of accepted) {
    const key = `${a.subjectId}|${a.period}`;
    alignment[key] = [...(alignment[key] ?? []), { uploadId: a.uploadId, kind: a.kind, caliber: a.caliber, unit: a.unit }];
  }
  // 独立来源计数按根上传去重：同源扫描/转写/渲染不叠加证明（W03）
  const independentSourceCount = new Set(accepted.map((a) => sourceRegistry[a.uploadId].rootUploadId)).size;

  const status = accepted.length === 0 ? 'supplement_waiting' : (pendingSupplement.length > 0 ? 'open' : 'aligned');
  const intake = {
    intakeBatchId: `ibatch-${stableHash(stableStringify({ customerId: batch.customerId, uploads: batch.uploads })).slice(0, 16)}`,
    normalizerVersion: INTAKE_NORMALIZER_VERSION,
    customerId: batch.customerId,
    masterBinding: binding.binding,
    status,
    accepted,
    pendingSupplement,
    sourceRegistry,
    independentSourceCount,
    alignment,
    notes: [
      '文件接收/解析/事实候选/人工核验/进入评估分层：本批次只完成接收与正规化',
      '相似金额不做设备自动匹配；口径差只定位与注记，不产出诚信结论',
      '批次无到期倒计时：待补不产生过期，恢复以本登记表为准',
    ],
    pendingUploadIds: [...pendingIds],
    generatedAt: now(),
  };
  if (problems.length > 0) return { ok: false, problems, intake };
  return { ok: true, intake };
}
