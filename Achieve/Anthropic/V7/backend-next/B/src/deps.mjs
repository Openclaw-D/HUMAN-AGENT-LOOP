// V7 backend-next B:统一 node: 内置模块导入。编排核心保持零第三方运行时依赖
// (唯一例外 @langchain/langgraph 及其 checkpoint 接口包)。
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';

export { crypto, fsp as fs };
