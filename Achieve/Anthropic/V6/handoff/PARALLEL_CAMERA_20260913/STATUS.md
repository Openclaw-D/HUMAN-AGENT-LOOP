# STATUS｜并行任务B：设备拍照控制器与本地预览

- 日期：2026-09-13
- 任务入口：`V6/ZCODE_PARALLEL_B_CAMERA_20260913.md`（协作边界见 `V6/ZCODE_PARALLEL_20260913.md`）
- 状态：**READY_FOR_REVIEW**
- 接口版本：`0.1.0-candidate`（冻结，见 `INTEGRATION.md`）
- 本批冻结范围：本目录全部文件（见 `MANIFEST.json` 的SHA256清单）；自本文件写入起不再修改，续改须开新批次。

## 复现命令

```bash
cd V6/handoff/PARALLEL_CAMERA_20260913
node --test test/camera-controller.test.mjs test/thumbnail.test.mjs   # 32/32通过
node --check src/camera-controller.mjs                                # 语法门
node tools/serve-standalone.mjs                                        # 可选：127.0.0.1动态端口样例,Ctrl+C停止
```

## 已完成

- 控制器（九态生命周期、可注入依赖、五接口候选+取消/换设备/关流）、浏览器默认解码/缩略图、极小standalone样例。
- 32项自动化测试全绿（假设备轨道+合成Blob；必测清单全覆盖，对照见 REPORT.md §3）；本地样例服务冒烟通过且进程已清理。
- INTEGRATION.md接口冻结、CAMERA_READINESS.md（官方文档对照+五平台待测矩阵，全部如实标注NOT TESTED+真机验收清单）、REPORT.md、evidence/原始日志。

## 边界遵守声明

- 写面仅本目录；未改产品页面/CSS/API/存储、未动3321/3399/3311、无Git写操作、无新增依赖、无模型调用（本轮=0）。
- 未开启物理摄像头/麦克风；无浏览器共享窗口观测（人工验收步骤已留给主任务/用户）。
- 不冒称真机通过：手机原相机等真实设备能力全部NOT TESTED，待测矩阵见 CAMERA_READINESS.md §4。

## 已知限制（摘要）

真机未测；浏览器画布缩略图路径未实测；EXIF不解析→拍摄时间恒未知；缩略图JPEG有损；`provenance` 恒为 `unverified`；上传/入库/隐私处理属下一独立Gate。

## 移交项

主任务：先隔离复验（上方命令），再按 INTEGRATION.md §1/§4/§8 接入产品页面并承担页面侧清理责任；真机清单执行后回填矩阵。
