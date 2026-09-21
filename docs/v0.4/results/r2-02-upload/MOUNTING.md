# R2-02 · 共享 server 串行挂载最小清单（未应用，供 Codex 串行集成裁决）

本路**未改** `Back/Edge/src/server.mjs`。以下为把装配模块接入真实入口的最小改动与决策点。

## 1｜改动点（共 2 处）

### ① 构造装配（createEdgeServer 内，sessionOf 定义之后；或 boot 层构造后传入）

```js
// server.mjs 现有：const sessionOf = (req) => sessionStore?.resolve(req.headers['x-jw-session']);
// 新增（示例，未应用）：
const { createUploadContextAssembly } = await import('./upload-context-assembly.mjs');
const uploadContextAssembly = await createUploadContextAssembly({
  sessionOf,
  aBaseUrl: process.env.JW_A_BASE_URL ?? 'http://127.0.0.1:48210', // A 内核正式 HTTP 面
  // 形态二选一（CTRL 决策，见 §3）：
  // connectorsStore,                                  // 直连：Edge 进程内持有 Connectors PG 只读连接
  // fetchContext: fetchContextViaConnectorsHttp,      // 分进程：需要 Connectors 新增只读 HTTP 口（现无）
});
```

注意：工厂是 async。若 `createEdgeServer` 保持同步签名，在 boot 层（`server.mjs` 末尾 `const sessionStore = createSessionStore({})` 附近，该处已在 async 上下文）构造后作为新依赖参数传入。

### ② 挂路由（请求分发 if 链内，与其他会话路由并列）

```js
if (req.method === 'GET' && url.pathname === '/api/jw/v2/upload-context') {
  const customerId = url.searchParams.get('customerId');
  const result = await uploadContextAssembly.reader({ req, customerId });
  return sendJson(res, result.status, result.body);
}
```

（路径名按前端契约另定；reader 只要求 `customerId` 非空 string。）

## 2｜必须保持的接线语义（验收要点）

1. 拒绝不是故障：`200+ok:false` 与 A `4xx` → **403 UPLOAD_FORBIDDEN**；仅 A `5xx`/网络错/PG 故障 → **503 UPLOAD_CONTEXT_UNAVAILABLE**（装配层已实现，挂载后抽测确认）。
2. 不缓存授权结果：每请求两次 A 投影调用是既有设计（读中撤权防护），勿加缓存。
3. 响应 allowlist 不扩字段：前端拿到的字段集见契约 §2.4。
4. CSRF：GET 无 CSRF 面；若改 POST 形态须走既有 `csrfCheck`。

## 3｜挂载前 CTRL 决策点（本路不代决）

| # | 决策 | 现状与影响 |
| --- | --- | --- |
| D1 | Connectors 恢复读的部署形态 | 直连（Edge 进程内 `connectorsStore`，本装配已支持，零新增服务面）vs 分进程（Connectors 需新增 upload-context 只读 HTTP 口 + Edge HTTP 适配，工作量更大但服务边界干净） |
| D2 | 路由路径与前端消费 | 前端由 Codex 保留；路径名/响应消费方式以前端契约为准 |
| D3 | 环境变量登记 | `JW_A_BASE_URL` 需进入部署配置（takeoff-runtime/compose 属共享配置，本路只读未动） |
| D4 | readiness probe 登记（可选） | 未装配时探针如实显示不可用；挂载后可加装配探针（非必需） |

## 4｜明确不做

- 不在挂载前向前端暴露任何"恢复可用"入口；不伪造生产入口。
- 不把装配模块接到 Edge 现有 `connectorsProxy`（其为处理通道写面/读面代理，与恢复读无关）。
- 不改 A、Connectors 源码与共享配置。
