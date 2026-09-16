# RelayOS P2 accepted snapshot

- Snapshot root: `work/checkpoints/P2-accepted/snapshot/`
- Source manifest: `work/checkpoints/P2-accepted/manifest.sha256`（保持原样，未修改）
- Snapshot verification manifest: `work/checkpoints/P2-accepted/snapshot-manifest.sha256`
- Generated at: `2026-08-26T04:40:59.9968918+08:00`
- Verification result: **34/34 SHA-256 matched，0 missing，0 extra**

其中 29 个仍与 P2 manifest 一致的文件按字节从当前项目复制。以下 5 个已经被后续 P3 修改的 live 文件，根据 P2 accepted 时的精确内容只在 snapshot 中重建：

- `README.md`
- `package.json`
- `src/http/server.js`
- `test/helpers.js`
- `test/http-contract.test.js`

Snapshot 只包含原 P2 manifest 的 34 个 accepted 文件，不包含 `.env`、secret、runtime database、WAL/SHM、日志、`node_modules` 或 P3 文件。生成 snapshot 的过程没有修改任何 live README/package/src/test/scenarios/scripts、四份 P1 文档、原 P2 manifest 或 P3 manifest。

本目录是回滚证据，不授权自动覆盖当前 live P3。任何实际回滚仍需单独决定并再次验证。
