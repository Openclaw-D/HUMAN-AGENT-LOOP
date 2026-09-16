// V7-B 候选2配套:LangGraph JS 文件 checkpointer(真实落盘;进程重启后可恢复线程)。
// 语义镜像 @langchain/langgraph-checkpoint MemorySaver(0.2.62):
//   put = 存 checkpoint(去 pending_sends)+ metadata + parent 指针;
//   putWrites = 按 (taskId, WRITES_IDX_MAP[channel]||idx) 存写集(interrupt/resume 依赖);
//   getTuple = 按 checkpoint_id 或最新(uuid6 字典序)取,重组 pending_sends(父 checkpoint 的 TASKS 写);
// 序列化经 serde.dumpsTyped/loadsTyped(与框架一致);文件原子写,目录按 thread 隔离。
// 说明:这是 B 对"LangGraph checkpoint 能否落盘"的实验件;业务事实源仍在 A(合同 §6)。

import { BaseCheckpointSaver, copyCheckpoint } from '@langchain/langgraph';
import { TASKS, getCheckpointId } from '@langchain/langgraph-checkpoint';

// WRITES_IDX_MAP 未从包入口导出(源:langgraph-checkpoint dist/base.js,值来自 serde/types.js):
// putWrites 内层键对特殊通道用固定负索引;此处复刻常量并标注来源,升级依赖时须复核。
const CHECKPOINT_CHANNEL_CONSTANTS = Object.freeze({
  ERROR: '__error__',
  SCHEDULED: '__scheduled__',
  INTERRUPT: '__interrupt__',
  RESUME: '__resume__',
});
const WRITES_IDX_MAP = Object.freeze({
  [CHECKPOINT_CHANNEL_CONSTANTS.ERROR]: -1,
  [CHECKPOINT_CHANNEL_CONSTANTS.SCHEDULED]: -2,
  [CHECKPOINT_CHANNEL_CONSTANTS.INTERRUPT]: -3,
  [CHECKPOINT_CHANNEL_CONSTANTS.RESUME]: -4,
});
import { atomicWriteJson } from '../ports.mjs';
import { fs } from '../deps.mjs';

function encodeTyped([type, data]) {
  return { t: type, d: Buffer.from(data).toString('base64') };
}
function decodeTyped(enc) {
  return [enc.t, new Uint8Array(Buffer.from(enc.d, 'base64'))];
}

export class FileCheckpointSaver extends BaseCheckpointSaver {
  constructor(dir) {
    super();
    this.dir = dir;
  }

  #threadDir(threadId) { return `${this.dir}/${encodeURIComponent(threadId)}`; }
  #ckptFile(threadId, ns, ckptId) {
    return `${this.#threadDir(threadId)}/ckpt_${encodeURIComponent(ns || '_root_')}_${ckptId}.json`;
  }
  // 每 task 一个写集文件:并发节点写各自文件,读侧合并(避免并发读改写丢失)
  #writesPrefix(threadId, ns, ckptId) {
    return `${this.#threadDir(threadId)}/writes_${encodeURIComponent(ns || '_root_')}_${ckptId}_`;
  }

  async #readJson(file) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async #latestCheckpointId(threadId, ns) {
    let names;
    try {
      names = await fs.readdir(this.#threadDir(threadId));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
    const prefix = `ckpt_${encodeURIComponent(ns || '_root_')}_`;
    const ids = names.filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
      .map((n) => n.slice(prefix.length, -'.json'.length));
    ids.sort((a, b) => b.localeCompare(a)); // uuid6 字典序=时间序,取最新
    return ids[0] ?? null;
  }

  /** 读某 checkpoint 的全部写集文件并合并(结构 {taskId, channel, value, innerKey})。 */
  async #readWrites(threadId, ns, ckptId) {
    let names;
    try {
      names = await fs.readdir(this.#threadDir(threadId));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const prefix = `writes_${encodeURIComponent(ns || '_root_')}_${ckptId}_`;
    const merged = [];
    for (const name of names.filter((n) => n.startsWith(prefix) && n.endsWith('.json'))) {
      const rec = await this.#readJson(`${this.#threadDir(threadId)}/${name}`);
      if (rec?.entries) merged.push(...rec.entries);
    }
    return merged;
  }

  async #loadTuple(threadId, ns, ckptId) {
    const rec = await this.#readJson(this.#ckptFile(threadId, ns, ckptId));
    if (!rec?.checkpoint || rec.metadata === undefined) return null;
    const parentCheckpointId = rec.parent ?? undefined;
    const [ctype, cdata] = decodeTyped(rec.checkpoint);
    const checkpoint = await this.serde.loadsTyped(ctype, cdata);
    const [mtype, mdata] = decodeTyped(rec.metadata);
    const metadata = await this.serde.loadsTyped(mtype, mdata);

    // pending_sends 重组:父 checkpoint 写集中的 TASKS 通道(与 MemorySaver 一致)
    const pendingSends = [];
    if (parentCheckpointId !== undefined) {
      const parentWrites = await this.#readWrites(threadId, ns, parentCheckpointId);
      for (const w of parentWrites) {
        if (w.channel === TASKS) {
          const [wt, wd] = decodeTyped(w.value);
          pendingSends.push(await this.serde.loadsTyped(wt, wd));
        }
      }
    }
    const tupleCheckpoint = { ...checkpoint, pending_sends: pendingSends };

    const writesRec = await this.#readWrites(threadId, ns, ckptId);
    const pendingWrites = await Promise.all(writesRec.map(async (w) => {
      const [wt, wd] = decodeTyped(w.value);
      return [w.taskId, w.channel, await this.serde.loadsTyped(wt, wd)];
    }));

    const config = { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: ckptId } };
    const tuple = { config, checkpoint: tupleCheckpoint, metadata, pendingWrites };
    if (parentCheckpointId !== undefined) {
      tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: parentCheckpointId } };
    }
    return tuple;
  }

  async getTuple(config) {
    const threadId = config.configurable?.thread_id;
    const ns = config.configurable?.checkpoint_ns ?? '';
    // 注意 getCheckpointId 无 id 时返回 ""(非 undefined):无显式 id 必须回退"取最新"
    const explicitId = getCheckpointId(config);
    const ckptId = explicitId || (await this.#latestCheckpointId(threadId, ns));
    if (!ckptId) return undefined;
    return (await this.#loadTuple(threadId, ns, ckptId)) ?? undefined;
  }

  async *list(config, options = {}) {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;
    const ns = config.configurable?.checkpoint_ns ?? '';
    let names;
    try {
      names = await fs.readdir(this.#threadDir(threadId));
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    const prefix = `ckpt_${encodeURIComponent(ns || '_root_')}_`;
    const ids = names.filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
      .map((n) => n.slice(prefix.length, -'.json'.length))
      .sort((a, b) => b.localeCompare(a));
    let limit = options?.limit;
    for (const id of ids) {
      if (options?.before?.configurable?.checkpoint_id && id >= options.before.configurable.checkpoint_id) continue;
      const tuple = await this.#loadTuple(threadId, ns, id);
      if (!tuple) continue;
      if (options?.filter && !Object.entries(options.filter).every(([k, v]) => tuple.metadata?.[k] === v)) continue;
      if (limit !== undefined) {
        if (limit <= 0) break;
        limit -= 1;
      }
      yield tuple;
    }
  }

  async put(config, checkpoint, metadata) {
    const threadId = config.configurable?.thread_id;
    if (threadId === undefined) throw new Error('FileCheckpointSaver.put: 缺少 thread_id');
    const ns = config.configurable?.checkpoint_ns ?? '';
    const prepared = copyCheckpoint(checkpoint);
    delete prepared.pending_sends;
    await fs.mkdir(this.#threadDir(threadId), { recursive: true });
    await atomicWriteJson(this.#ckptFile(threadId, ns, checkpoint.id), {
      checkpoint: encodeTyped(this.serde.dumpsTyped(prepared)),
      metadata: encodeTyped(this.serde.dumpsTyped(metadata)),
      parent: config.configurable?.checkpoint_id ?? null,
    });
    return { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config, writes, taskId) {
    const threadId = config.configurable?.thread_id;
    const ns = config.configurable?.checkpoint_ns ?? '';
    const ckptId = config.configurable?.checkpoint_id;
    if (threadId === undefined || ckptId === undefined) {
      throw new Error('FileCheckpointSaver.putWrites: 缺少 thread_id/checkpoint_id');
    }
    const file = `${this.#writesPrefix(threadId, ns, ckptId)}${encodeURIComponent(taskId)}.json`;
    const existing = (await this.#readJson(file)) ?? { taskId, entries: [] };
    const have = new Set(existing.entries.map((e) => e.innerKey));
    writes.forEach(([channel, value], idx) => {
      const innerKey = `${taskId},${WRITES_IDX_MAP[channel] ?? idx}`;
      if (have.has(innerKey)) return; // 与 MemorySaver 一致:先到先得
      existing.entries.push({ taskId, channel, innerKey, value: encodeTyped(this.serde.dumpsTyped(value)) });
    });
    await fs.mkdir(this.#threadDir(threadId), { recursive: true });
    await atomicWriteJson(file, existing);
  }

  async deleteThread(config) {
    const threadId = config?.configurable?.thread_id;
    if (!threadId) throw new Error('FileCheckpointSaver.deleteThread: 缺少 thread_id');
    await fs.rm(this.#threadDir(threadId), { recursive: true, force: true });
  }
}
