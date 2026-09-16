import type { NextConfig } from 'next';

// D-QA 测试装置配置：仅本 QA 副本使用。turbopack.root 显式提升文件系统根，
// 使 node_modules junction（→ jianwei-v3/site/node_modules）位于根内；
// 与产品/预览副本的 next.config.ts（空配置）不同。验收以产品实际配置为准。
const nextConfig: NextConfig = {
  turbopack: {
    root: 'C:/Users/22673/Desktop/Anthropic',
  },
};

export default nextConfig;
