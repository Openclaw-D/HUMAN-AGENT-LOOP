# RESOURCE_AUDIT｜产品相机接线资源边界审计清单

受众:MAIN自查 + B产品验证harness判据。每项给出:要求、常见违例(“挂断不仅退出全屏”即本条)、MAIN自查方法、B harness判据。契约全文见 `V6/handoff/R3_CAMERA_20260913/EVENT_RESOURCE_CONTRACT.md`(仍然有效,本文件是其产品接线审计版)。

## A. 挂断(退出访谈/全屏)必须释放真实资源

- **要求**:产品“挂断/结束访谈/返回总览”的动作路径必须调用 `controller.dispose()`(或先closeStream再dispose),产生收据且 `liveTracksAtEnd===0`。只把视频面板退出全屏/隐藏面板而不触控制器 = **违例**(设备指示灯仍亮、轨道仍活)。
- **常见违例**:挂断按钮只做CSS全屏切换;离开访谈页但组件未卸载未dispose;访谈页在SPA路由切换时仅`visibility:hidden`。
- **自查**:点挂断后,系统摄像头指示灯灭;`getResourceUsage().liveTracks===0`且`state==='disposed'`;收据`reason='hangup'`。
- **harness判据**:S5序列后收据四零(见verify-product输出summary)。

## B. 收缩视图 ≠ 离开会话

- **要求**:面板折叠/抽屉收起/切tab属纯视图操作,**零资源动作**(不dispose、不closeStream、不撤销展示中预览URL);展开后预览与取景状态保持(草稿/选择/位置不丢)。
- **常见违例**:收起面板时“顺手”dispose;收起丢失img.src导致刷新式重建。
- **自查**:收起→展开,预览图仍在、原SHA-256不变;事件日志中无dispose/closeStream条目。
- **harness判据**:S7序列的收据`urlsHeldAtEnd>0 && stateAtEnd==='preview'`(展示中预览未被提前释放);展开收起对照截图。

## C. 作废图片:撤URL、不冒认事实

- **要求**:作废走 `controller.discardPreview()`——撤销该预览全部URL、在途ingest作废;**文案不得写“已删除上传”**(从未上传);provenance恒unverified;摄像头开关状态不因作废改变(流存活则指示条保留)。
- **常见违例**:页面自己revokeObjectURL与控制器登记表脱钩(泄漏或double-revoke);作废后误关流;文案冒认“已同步删除服务器副本”。
- **自查**:作废后`getResourceUsage().urlsHeld`减少到预期;`discardPreview()`二次返回`NO_PREVIEW`。
- **harness判据**:S8序列discard收据`urlsCreated===urlsRevoked`、`danglingUrls===0`。

## D. 摄像头只能由本机用户主动控制

- **要求**:`openFromUserGesture/switchCamera/capture`只能在用户点击/按键handler内调用;组件挂载不得自动开启;不存在任何消息/事件驱动别的设备摄像头的路径(本模块无远控,也不接受远控指令开流)。
- **常见违例**:mount时“预热”摄像头;收到业务事件自动开拍。
- **自查**:刷新页面(无任何点击)系统指示灯不亮;`eventLog`中首个gUM调用前必有用户action条目。
- **harness判据**:S1 idle序列零gUM调用;所有gUM前有action事件。

## E. audio恒0、上传恒0

- **要求**:任何gUM约束`audio===false`;相机路径无图片字节出网(fetch/POST/WebSocket均计)。
- **自查**:探针包裹fetch/XHR(见UPGRADE_DELTA接线4);`micConstraintViolations===0`、`uploadsAttempted===0`。
- **harness判据**:每序列收据`micRequests===0 && uploadsAttempted===0`。

## F. 终结状态统一判据(harness逐序列断言)

| 序列 | 触发 | 终结断言 |
| --- | --- | --- |
| S1 idle | 加载不点击 | 零gUM;state=idle |
| S2 拍照成功 | 开启→拍照 | single模式拍完流关:`liveTracks=0`,预览展示中(`urlsHeld>0`) |
| S3 拍照失败 | 注入失败后拍照 | state=error或预览空,`liveTracks=0`(single失败也关轨) |
| S4 取消 | requesting→取消 | state=idle,零URL零轨 |
| S5 挂断 | dispose | 收据四零+`stateAtEnd='disposed'` |
| S6 离页 | navigate离开 | pagehide dispose生效,回读收据终态全零 |
| S7 选图 | 注入合成PNG | 预览有效且未提前释放;原字节hash=素材hash |
| S8 作废 | discardPreview | URL收支平衡,dangling=0;流状态按契约保持 |

无法注入的序列(S2失败注入、S3等)在页面缺钩子时记`SKIPPED_PAGE_NO_HOOK`,不得伪造PASS。
