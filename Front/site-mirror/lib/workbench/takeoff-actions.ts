// TAKEOFF 页面命令与只读模型观察；不产生正式融资/敞口。
export interface AdmissionRequest {
  productType: 'sale_leaseback';
  requestedAmountMinor: number | null;
  currency: string;
  requestedTermMonths: number | null;
  purpose: string | null;
  equipmentScope: string[];
  note: string | null;
}

export interface AdmissionAssessment {
  assessmentId: string; customerId: string; version: number; status: string;
  request: (AdmissionRequest & { revision?: number; declaredAt?: string; updatedAt?: string }) | null;
}

export type ModelAssistant = 'business' | 'policy' | 'credit' | 'commerce' | 'asset' | 'jianwei';
export interface AssistantObservation {
  ok: boolean; authority: 'none'; scope: 'preassessment_only'; customerId: string; assistant: ModelAssistant;
  model: {
    status: 'succeeded' | 'simulated' | 'failed' | 'unknown'; sent: boolean | null;
    requestId: string | null; contextVersion: string | null; replayed: boolean;
    receiptVersion?: number; contextHash?: string; configHash?: string; current?: boolean;
    analysisRunId?: string | null;
    citationChecks?: Array<{ valid: boolean; evidenceRefIds: string[]; reason: string }>;
    source: { mode?: string; model?: string } | null;
    error: { code?: string; message?: string } | null;
  };
  observations: Array<{ text: string; evidenceRefIds?: string[]; citationStatus?: string }>; questions: Array<{ text: string }>; evidenceRefs: unknown[];
}

export interface ObservationEvidence {
  id: string; artifactId: string; hash: string; parserVersion: string; text: string;
  locator: { kind: string; page?: number; start: number; end: number };
}
export function verifiedObservationEvidence(result: AssistantObservation): ObservationEvidence[] {
  if (!result.model.current || !result.model.analysisRunId) return [];
  const ids = new Set((result.model.citationChecks ?? []).filter(c => c.valid).flatMap(c => c.evidenceRefIds));
  return result.evidenceRefs.filter((value): value is ObservationEvidence => {
    const r = value as Partial<ObservationEvidence> | null;
    return !!r && typeof r.id === 'string' && ids.has(r.id) && /^[a-f0-9]{64}$/.test(r.hash ?? '') &&
      typeof r.text === 'string' && typeof r.artifactId === 'string' && typeof r.parserVersion === 'string' &&
      !!r.locator && ['page_text', 'extracted_text'].includes(r.locator.kind) &&
      Number.isInteger(r.locator.start) && Number.isInteger(r.locator.end) && r.locator.end - r.locator.start === r.text.length;
  });
}

/** 元→分，按十进制拆分；拒绝负数、零、超精度及不安全整数，不舍入客户表述。 */
export function admissionAmount(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error('申请金额须为正数，最多两位小数。');
  const [whole, decimal = ''] = value.trim().split('.');
  const minor = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor < 1) throw new Error('申请金额须大于零且不超过可精确登记范围。');
  return minor;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}

// 不依赖只反映材料水位的 inputVersion；需求/候选/状态变化也必须使展示失效。
export function observationAnchor(snapshot: unknown): string {
  const s = snapshot as Record<string, unknown> | null;
  const admission = s?.admission as Record<string, unknown> | undefined;
  const scope = admission?.scope as Record<string, unknown> | undefined;
  const { asOf: _asOf, ...scopeBasis } = scope ?? {};
  return JSON.stringify(stable({ customer: s?.customer, assessments: s?.assessments,
    artifacts: s?.artifacts,
    admission: admission ? { ...admission, ...(scope ? { scope: scopeBasis } : {}) } : admission,
    decisionStatus: s?.decisionStatus }));
}

export function admissionEqual(actual: AdmissionAssessment['request'], expected: AdmissionRequest): boolean {
  if (!actual) return false;
  const fields = Object.keys(expected) as Array<keyof AdmissionRequest>;
  return fields.every((key) => JSON.stringify(actual[key] ?? null) === JSON.stringify(expected[key]));
}

export function takeoffError(error: unknown): { code: string; message: string; unknown: boolean } {
  const e = error as { code?: string; status?: number; message?: string };
  const code = e.code || 'NETWORK_UNKNOWN';
  const messages: Record<string, string> = {
    VERSION_CONFLICT: '版本已变化。草稿仍保留；请读取最新登记，核对后重新填写。',
    NOT_READY: '评估已终结或结论已确认，当前不能修改需求。',
    FORBIDDEN: '当前身份无权限执行此操作。',
    SESSION_REQUIRED: '会话已失效，请重新选择角色。',
    NO_SESSION: '请先选择角色建立会话。',
    NOT_FOUND: '当前客户或评估不可读，请返回客户目录核对权限。',
    MODEL_NOT_CONFIGURED: '模型未配置，本次未发送。规则简报仍可使用。',
    BUDGET_EXCEEDED: '模型预算门已关闭，本次未发送。',
    INVALID_ARGUMENT: '字段未通过服务端校验，请核对填写内容。',
    INVALID_REQUEST: '字段未通过服务端校验，请核对填写内容。',
    INVALID_QUESTION: '观察问题须为 1–2000 字符。',
  };
  const unknown = !e.status || e.status >= 500 || code === 'INVALID_RESPONSE';
  return { code, message: messages[code] || (e.status === 403 ? messages.FORBIDDEN : e.status === 401 ? messages.SESSION_REQUIRED : e.message || '请求未完成'), unknown };
}
