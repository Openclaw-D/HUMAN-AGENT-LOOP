// R2-04 恢复验收·自有 Edge 子进程引导（不修改任何业务源码，只装配真实模块）：
// 由父测试进程 fork 启动，监听随机端口（--port 0），持久化文件由启动方传入：
//   --port 0                 随机端口；实际端口写入 --ready-file
//   --messages-file <path>   message-store sqlite 文件（同一路径跨重启复用即恢复）
//   --receipts-dir <path>    模型回执落盘目录（activity 只读扫描）
//   --upstream <url>         替身 A 地址（kernel-store baseUrl；A 在父进程存活，跨子进程重启不变）
//   --ready-file <path>      listen 成功后写 {pid,port}，父进程据此得知连接地址
//   --max-per-customer <n>   可选：线程保留窗口（裁剪披露场景用）
// 装配形态与既有 v04-activity-http.test.mjs 的 buildEdge 完全一致（真实 server/kernel-store/
// message-store/messages/session/audit），唯一替身是替身 A；不装配 assistantModel/上传/审批面
// → 读面零模型调用是结构性的。
// 关停协议：父进程经 IPC 发 {cmd:'shutdown'} → close sqlite → exit 0（优雅重启场景）；
// 硬杀场景由父进程直接 kill（Windows=TerminateProcess，模拟崩溃）。
import { writeFileSync } from 'node:fs';
import { startEdgeServer } from '../../src/server.mjs';
import { createKernelStore } from '../../src/kernel-store.mjs';
import { createMessageStore } from '../../src/message-store.mjs';
import { createMessageRouter } from '../../src/messages.mjs';
import { createSessionStore } from '../../src/session.mjs';
import { createAuditSink } from '../../src/audit.mjs';
import { IDENTITY } from './back-a-standin.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) {
    args[process.argv[i].slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--'))
      ? process.argv[++i] : true;
  }
}

const sessionStore = createSessionStore();
const verifyCredential = async ({ credential }) => IDENTITY[credential] ?? { ok: false, reason: 'PRINCIPAL_UNTRUSTED' };
const auditSink = createAuditSink();
const store = createKernelStore({ baseUrl: args.upstream });
const messageStore = createMessageStore({
  file: args['messages-file'],
  ...(args['max-per-customer'] ? { maxPerCustomer: Number(args['max-per-customer']) } : {}),
});
const messages = createMessageRouter({
  deliver: async (msg) => ({ messageId: `fx-${msg.requestId}`, state: 'sent_local_sink' }),
  auditSink,
  threadStore: messageStore,
  receiptStore: messageStore,
});

const started = await startEdgeServer({
  port: Number(args.port || 0),
  seal: { buildId: 'test-v04-recovery', capabilities: { note: 'recovery-harness' } },
  probes: [],
  store,
  auth: async ({ session }) => (session ? { ok: true, principalId: session.principalId } : { ok: false, reason: 'SESSION_REQUIRED' }),
  sessionStore,
  verifyCredential,
  messages,
  messageStore,
  modelReceiptsDir: args['receipts-dir'],
  auditSink,
});

writeFileSync(args['ready-file'], JSON.stringify({ pid: process.pid, port: started.port }));
process.send?.({ ready: true, port: started.port });

process.on('message', (m) => {
  if (m && m.cmd === 'shutdown') {
    try { messageStore.close(); } catch { /* 幂等 */ }
    process.exit(0);
  }
});
