import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from '../src/compose.mjs';
import { startServer } from '../src/http/server.mjs';
import { ConnError } from '../src/errors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** 运行配置仅从受控目录 .run/config.json 读取（git 排除）。样例见 config/connectors.config.example.json。 */
const cfgPath = process.env.CONNECTORS_CONFIG ?? join(ROOT, '.run', 'config.json');
if (!existsSync(cfgPath)) {
  console.error(`[connectors] 缺少运行配置 ${cfgPath}。复制 config/connectors.config.example.json 到 .run/config.json 并填入本地值。`);
  console.error('[connectors] 真实企业微信/TRTC 未授权前保持 BLOCKED；本地链路（PG/对象存储/A 登记）可运行。');
  process.exit(2);
}
const fileCfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const env = process.env;

const config = {
  pg: {
    host: env.PGHOST ?? fileCfg.pg?.host ?? '127.0.0.1',
    port: Number(env.PGPORT ?? fileCfg.pg?.port ?? 15443),
    user: fileCfg.pg?.user ?? 'cnext',
    password: fileCfg.pg?.password ?? 'cnext',
    database: fileCfg.pg?.database ?? 'cnext',
  },
  objectRoot: fileCfg.objectRoot ?? join(ROOT, '.run', 'objects'),
  signingSecret: fileCfg.signingSecret,
  serviceToken: fileCfg.serviceToken,
  wecom: {
    // 真实出站必须 allowRealWecom:true 且凭据齐全；缺任一项 HttpWecomTransport 构造即 BLOCKED_EXTERNAL。
    allowRealWecom: fileCfg.wecom?.allowRealWecom === true,
    corpid: fileCfg.wecom?.corpid, archiveSecret: fileCfg.wecom?.archiveSecret,
    token: fileCfg.wecom?.callbackToken, encodingAESKey: fileCfg.wecom?.encodingAESKey,
  },
  trtcCallbackKey: fileCfg.trtc?.callbackKey,
  aBaseUrl: fileCfg.a?.baseUrl ?? null,
  aCredential: fileCfg.a?.credential ?? null,
  a: fileCfg.a ?? null,
  // IR-03-8⑤：processing 配置（含 aCustomerLinks 客户映射种子）原本被丢弃——现透传进 compose
  // （compose 侧兼容 a.customerLinks 种子形态；a_customer_links 表落库后为权威）
  processing: fileCfg.processing ?? null,
  defaultTenantId: fileCfg.defaultTenantId ?? 'tenant_demo',
  port: Number(fileCfg.port ?? 48100),
};

if (!config.signingSecret || !config.serviceToken) {
  console.error('[connectors] signingSecret/serviceToken 必填（.run/config.json）');
  process.exit(2);
}

let wecomTransport;
try {
  wecomTransport = new (await import('../src/wecom/transport.mjs')).HttpWecomTransport(config.wecom);
  console.log('[connectors] 真实企微传输已构造（allowRealWecom=true）——请确认已获租户授权');
} catch (e) {
  wecomTransport = null;
  console.log(`[connectors] 真实企微传输未启用：${e.message}`);
}
if (!wecomTransport) {
  config.wecomTransport = { kfSendMsg: async () => { throw new ConnError('BLOCKED_EXTERNAL', '发送通道未配置真实凭据：保持 BLOCKED'); }, kfSyncMsg: async () => { throw new ConnError('BLOCKED_EXTERNAL', '客服消息拉取未配置真实凭据：保持 BLOCKED'); } };
}

const callbackToken = config.wecom.token;
const encodingAESKey = config.wecom.encodingAESKey;
if (!callbackToken || !encodingAESKey) {
  console.error('[connectors] 企微回调 token/encodingAESKey 必填（接收回调的本地最小配置）');
  process.exit(2);
}

const svc = await compose(config);
const { aesKeyFromEncodingAESKey } = await import('../src/wecom/crypto.mjs');
const server = await startServer(svc, {
  port: config.port,
  wecomConfig: { token: callbackToken, aesKey: aesKeyFromEncodingAESKey(encodingAESKey), corpid: config.wecom.corpid ?? 'corpid_demo', defaultTenantId: config.defaultTenantId },
  trtcCallbackKey: config.trtcCallbackKey ?? config.signingSecret,
  serviceToken: config.serviceToken,
});
// goal-02：资料处理常驻驱动（解压/解析/分析/提问持久任务；关闭恢复依赖任务表+租约）
if (svc.processing) {
  const intervalMs = Number(fileCfg.processing?.driverIntervalMs ?? 2000);
  svc.processing.startDriver(intervalMs);
  console.log(`[connectors] 处理驱动已启动（interval=${intervalMs}ms, policy=${svc.processing._cfg.outboundPolicy}, 规则包=${svc.processing.rulesetVersion}）；恢复扫描内建于 tick`);
}
console.log(`[connectors] listening http://127.0.0.1:${config.port} ; healthz: /healthz`);
console.log('[connectors] E2 真实链路（企微存档/微信客服/TRTC）= blocked_external_access，不因本服务启动而改变');

process.on('SIGINT', async () => { await server.close(); await svc.close(); process.exit(0); });
