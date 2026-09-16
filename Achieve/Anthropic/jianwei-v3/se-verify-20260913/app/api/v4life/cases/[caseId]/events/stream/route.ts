// GET /api/v4life/cases/:caseId/events/stream —— 事件账本 SSE 实时流（大屏 live 镜像用）。
//
// 流协议：
//   - 连接建立即把 afterSeq 之后的既有事件逐条回放（`id: <seq>` + `data: <JSON>`，空行分帧）；
//   - 随后进入推送循环：每 500ms 轮询 engine.getEvents(cursor)，新事件逐条推帧并推进 cursor；
//   - 每 15s 发一条 SSE 注释心跳（`: ping`），防止代理/中间层按空闲断连；
//   - 客户端断开经 request.signal abort 与 ReadableStream cancel 双路径清理定时器并关闭流；
//     引擎读数抛错时发一帧 `event: error` 后关闭（失败关闭，不伪造后续数据）。
//
// 关键陷阱：响应必须携带 `cache-control: no-store` —— vinext 生产模式 ISR 会对 GET 响应做
// clone 缓冲，缺少该头时 SSE 帧会被缓冲到流结束才下发；`export const dynamic = 'force-dynamic'`
// 为第二重保险。
//
// 边界（契约 §13）：本端点直接轮询进程内引擎的事件账本内存，仅适用于单进程演示部署；
// 多实例/生产部署需先把事件账本持久化，并改为订阅持久层而非进程内轮询。

import type { V4LifeEvent } from '../../../../../../../lib/v4life/types.ts';
import {
  resolveV4LifeCaseEngine,
  v4LifeErrorResponse,
  v4LifeJsonResponse,
} from '../../../../../../../lib/v4life/http.ts';

// ISR 双保险：显式声明本路由不做静态化/缓存（见文件头注释）。
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ caseId: string }> };

const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 15_000;
// 与 events 分页路由一致的单页上限；引擎内部还会按 MAX_EVENT_PAGE_LIMIT 夹紧。
const STREAM_PAGE_LIMIT = 500;

/** afterSeq 仅接受十进制非负整数字面量；缺省 0；非法返回 null（与 events 路由同一口径）。 */
function parseAfterSeqParam(raw: string | null): number | null {
  if (raw === null) {
    return 0;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const { caseId } = await params;
    const engine = resolveV4LifeCaseEngine(caseId);
    if (engine === undefined) {
      return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
    }
    const parsedAfterSeq = parseAfterSeqParam(new URL(request.url).searchParams.get('afterSeq'));
    if (parsedAfterSeq === null) {
      return v4LifeJsonResponse({ error: 'INVALID_ENGINE_INPUT' }, 400);
    }

    const encoder = new TextEncoder();
    let cursor = parsedAfterSeq;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closed = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    /** 唯一清理出口：清空两个定时器并 close 流；幂等（closed 门闩 + close 容错）。 */
    const closeStream = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      if (heartbeatTimer !== undefined) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      if (streamController !== undefined) {
        try {
          streamController.close();
        } catch {
          // 流已被取消/关闭（cancel 路径已触发），忽略。
        }
      }
    };

    /** enqueue 安全封装：流已关闭（cancel/abort）时静默丢弃，不让轮询定时器抛未捕获异常。 */
    const enqueueFrame = (text: string): boolean => {
      if (closed || streamController === undefined) {
        return false;
      }
      try {
        streamController.enqueue(encoder.encode(text));
        return true;
      } catch {
        return false;
      }
    };

    const frameOf = (event: V4LifeEvent): string => `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;

    /** 读取一页新事件逐条推帧并推进 cursor；返回是否仍有积压（hasMore）。
     *  引擎读数抛错时发 `event: error` 帧后关闭流（异常安全，失败关闭）。 */
    const pumpOnce = (): boolean => {
      try {
        const page = engine.getEvents(cursor, STREAM_PAGE_LIMIT);
        for (const event of page.events) {
          if (!enqueueFrame(frameOf(event))) {
            return false;
          }
        }
        cursor += page.events.length;
        return page.hasMore;
      } catch {
        enqueueFrame('event: error\ndata: {"error":"INTERNAL_ERROR"}\n\n');
        closeStream();
        return false;
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        // 初始回放：同步排空 afterSeq 之后的全部既有事件（分页循环直到 hasMore=false）。
        let hasMore = true;
        while (hasMore && !closed) {
          hasMore = pumpOnce();
        }
        if (closed) {
          return;
        }
        // 推送循环 + 心跳。
        pollTimer = setInterval(() => {
          pumpOnce();
        }, POLL_INTERVAL_MS);
        heartbeatTimer = setInterval(() => {
          enqueueFrame(': ping\n\n');
        }, HEARTBEAT_INTERVAL_MS);
        // 客户端断开路径一：请求 signal abort → 清理。注册前先核对已 aborted 的竞态。
        if (request.signal.aborted) {
          closeStream();
          return;
        }
        request.signal.addEventListener('abort', closeStream, { once: true });
      },
      cancel() {
        // 客户端断开路径二：下游 cancel（reader.cancel / 网关断连）→ 同一清理出口。
        closeStream();
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        // no-store 是规避 vinext 生产 ISR 对 GET 响应 clone 缓冲的关键（见文件头注释）。
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    // 流开始之前的错误（params 解析失败等）：统一错误 envelope，不进入 SSE。
    return v4LifeErrorResponse(error);
  }
}
