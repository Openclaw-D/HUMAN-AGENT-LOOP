import type { NextConfig } from 'next';
import { join } from 'node:path';

// se-preview-20260913 专用：node_modules 以 junction 复用 site/ 的已装依赖，
// Turbopack 要求 symlink 目标位于项目根内，故把根上移到 jianwei-v3（monorepo 式根）。
// 仅本预览副本使用；site/next.config.ts 不变。
const nextConfig: NextConfig = {
  turbopack: {
    root: join(__dirname, '..'),
  },
};

export default nextConfig;
