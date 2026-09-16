// B 候选隔离预览 vite 配置：root=home/preview；仅复用 site 现有依赖（经 junction），
// 不安装新包、不触碰 site。候选目录 home/v5-preview 与 site/app/v5-preview 同构，
// site 同款相对 import（../../lib/...、./rows-logic 等）经 home 内桥文件（re-export）
// 直达 site 真文件——候选组件零改动即可拷入 site 编译。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..', 'jianwei-v3', 'site');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3607,
    strictPort: true,
    fs: { allow: [here, siteRoot] },
  },
});
