// V7-B 共享依赖门:统一 node: 内置模块导入,保持编排模块零第三方运行时依赖(thin 侧)。
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';

export { crypto, fsp as fs };
