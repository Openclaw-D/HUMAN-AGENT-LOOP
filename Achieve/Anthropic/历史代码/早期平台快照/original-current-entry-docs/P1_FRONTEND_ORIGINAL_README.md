# 见微人机协同前端工作台

这是十场景前端第二版的独立预览。页面基线为 `1920×1080`，并使用同一份协同状态投影驱动关系、进度、矩阵和右侧聊天与接续台。

## 运行模式

产品模式是默认值：

```powershell
node serve.mjs
```

产品模式只请求兼容的真实状态投影；当前没有后端第二版时会显示“状态待核验”，不会因接口失败改用示例。

前端验收可显式开启受控演示模式：

```powershell
$env:P1_FRONTEND_MODE = 'demo'
node serve.mjs
```

服务地址是 `http://127.0.0.1:4178/`。演示模式通过服务端的 `/api/v2/frontend-config` 显式返回，页面常显“演示状态”；十个确定性场景状态来自 `demo-state.mjs`，仅作为后端第二版状态结构的候选输入，不能当作真实客户或后端联调证据。

## 验证

```powershell
node --check app.js
node --check serve.mjs
node --check demo-state.mjs
node verify.mjs
node --test test/*.test.mjs
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4178/
```

`verify.mjs` 检查十场景顺序、默认视图、同源版本约束、演示模式失败关闭边界、模型运行分离、关系/进度/矩阵交互语义和灰阶样式。浏览器检查与截图记录见 `evidence/v2/CHECKS.md`。

## 后端边界

本目录不实现或修改后端、数据库、端口 `4177` / `4179`。生产接入需要后端第二版提供同一权威投影、版本一致性、人工关口、动作/回执和可审计模型运行；在此之前，产品模式必须保持失败关闭。
