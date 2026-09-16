import type { NextConfig } from 'next';

// D-QA 测试装置配置：仅本 QA 副本使用（R1轮，app-r1）。
const nextConfig: NextConfig = {
  turbopack: {
    root: 'C:/Users/22673/Desktop/Anthropic',
  },
};

export default nextConfig;
