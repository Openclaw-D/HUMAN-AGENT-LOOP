const PRODUCT_MODEL_URL = 'https://api.z.ai/api/paas/v4/chat/completions';
const DEFAULT_PRODUCT_MODEL = 'glm-5';
const PRODUCT_MODEL_TIMEOUT_MS = 25_000;
const PRODUCT_MODEL_MAX_RESPONSE_BYTES = 256 * 1024;

export type ProductModelContext = {
  caseId: string;
  caseTitle: string;
  contextVersion: string;
  evidenceEventId: string;
  stageId: string;
  stageLabel: string;
  flowId: string;
  flowLabel: string;
  from: string;
  previousResult: string;
  ruleVersion: string;
  confirmedFacts: string[];
  evidenceGaps: string[];
  automatedWork: string[];
  humanDecision: string;
  handoffTo: string;
};

export type ProductModelResult = {
  answer: string;
  model: string;
};

type ChatCompletionPayload = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

function adapterFailure(message: string): Error & { code: 'ADAPTER_FAILURE' } {
  return Object.assign(new Error(message), { code: 'ADAPTER_FAILURE' as const });
}

function cancelReaderBestEffort(reader: { cancel: () => Promise<unknown> }): void {
  try {
    void reader.cancel().catch(() => {});
  } catch {
    // Response cleanup is best effort; the adapter error is the authoritative result.
  }
}

async function readBoundedResponseJson(response: Response): Promise<ChatCompletionPayload> {
  const declaredLength = response.headers?.get('content-length');
  if (declaredLength !== null && declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength >= 0
      && parsedLength > PRODUCT_MODEL_MAX_RESPONSE_BYTES) {
      throw adapterFailure('产品模型响应超过允许大小');
    }
  }

  if (!response.body) return JSON.parse('');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > PRODUCT_MODEL_MAX_RESPONSE_BYTES) {
        cancelReaderBestEffort(reader);
        throw adapterFailure('产品模型响应超过允许大小');
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelReaderBestEffort(reader);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as ChatCompletionPayload;
}

export function isProductModelConfigured(): boolean {
  return typeof process.env.JIANWEI_MODEL_API_KEY === 'string'
    && process.env.JIANWEI_MODEL_API_KEY.trim().length > 0;
}

export async function completeProductCandidate(input: {
  message: string;
  context: ProductModelContext;
}): Promise<ProductModelResult> {
  const apiKey = process.env.JIANWEI_MODEL_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error('产品模型未配置'), { code: 'MODEL_NOT_CONFIGURED' });
  }

  const model = process.env.JIANWEI_MODEL_NAME?.trim() || DEFAULT_PRODUCT_MODEL;
  let response: Response | undefined;
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      if (response) void releaseResponseBody(response);
      reject(Object.assign(new Error('产品模型请求超时'), { code: 'ADAPTER_TIMEOUT' }));
    }, PRODUCT_MODEL_TIMEOUT_MS);
  });

  const request = async (): Promise<ProductModelResult> => {
    try {
      response = await fetch(PRODUCT_MODEL_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept-language': 'zh-CN,zh',
        },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0.2,
          max_tokens: 900,
          messages: [
            {
              role: 'system',
              content: [
                '你是见微融资租赁协同助手。',
                '模型没有业务权威，只能给出候选解释、证据缺口和下一步建议。',
                '不得替人否决、提交、确认事实或声称外部动作已经成功。',
                '优先复用给定上下文，回答简洁，并明确哪些工作已自动完成、哪些必须由人决定。',
              ].join(''),
            },
            {
              role: 'user',
              content: JSON.stringify({ contextPacket: input.context, question: input.message }),
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const errorName = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
      if (errorName === 'TimeoutError' || errorName === 'AbortError') {
        throw Object.assign(new Error('产品模型请求超时'), { code: 'ADAPTER_TIMEOUT' });
      }
      throw Object.assign(new Error('产品模型请求失败'), { code: 'ADAPTER_FAILURE' });
    }

    if (!response.ok) {
      await releaseResponseBody(response);
      throw Object.assign(new Error(`产品模型返回 ${response.status}`), {
        code: response.status === 408 || response.status === 504 ? 'ADAPTER_TIMEOUT' : 'ADAPTER_FAILURE',
      });
    }

    let payload: ChatCompletionPayload;
    try {
      payload = await readBoundedResponseJson(response);
    } catch {
      await releaseResponseBody(response);
      throw Object.assign(new Error('产品模型返回无效 JSON'), { code: 'ADAPTER_FAILURE' });
    }
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw Object.assign(new Error('产品模型没有返回有效文本'), { code: 'ADAPTER_FAILURE' });
    }

    return { answer: content.trim(), model };
  };

  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

async function releaseResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response cleanup is best effort; the adapter error is the authoritative result.
  }
}
