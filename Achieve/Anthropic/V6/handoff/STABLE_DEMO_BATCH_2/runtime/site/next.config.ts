import type { NextConfig } from 'next';

// V6 BATCH_2 隔离运行副本专用配置（非生产配置；生产 site/next.config.ts 未改动）。
// next 包经 runtime/site/node_modules 联接（junction）解析到真实 site 依赖；
// distDir 独立，避免与现场 3311 实例共享任何构建缓存。
const nextConfig: NextConfig = {
  distDir: '.next-isolated',
  turbopack: {
    root: 'C:/Users/22673/Desktop/Anthropic/V6/handoff/STABLE_DEMO_BATCH_2/runtime/site',
  },
};

export default nextConfig;
