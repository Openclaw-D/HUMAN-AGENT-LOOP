import type { NextConfig } from 'next';

// A 路隔离验证装置配置（REPAIR evening）：仅本副本使用。turbopack.root 显式提升文件系统根，
// 使 node_modules junction（→ jianwei-v3/site/node_modules）位于根内；allowedDevOrigins 允许
// ZCode 内置浏览器（IAB）代理 origin 访问 dev 资源（产品/预览副本 3467 无此配置，验收以 3467 为准）。
const nextConfig: NextConfig = {
  turbopack: {
    root: 'C:/Users/22673/Desktop/Anthropic',
  },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
