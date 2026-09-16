// thumbnail.mjs 默认实现的Node环境行为测试：
// Node无createImageBitmap/DOM canvas，两个默认实现必须优雅返回null而非抛错。
// 浏览器内真实画布路径属于浏览器专属代码，本测试不做（见CAMERA_READINESS.md待测矩阵）。
// 运行：node --test test/thumbnail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeImageMetadataDefault, createThumbnailDefault } from '../src/thumbnail.mjs';

test('Node环境：decodeImageMetadataDefault优雅返回null', async () => {
  const meta = await decodeImageMetadataDefault(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  assert.equal(meta, null);
});

test('Node环境：decodeImageMetadataDefault对空入参返回null', async () => {
  assert.equal(await decodeImageMetadataDefault(null), null);
});

test('Node环境：createThumbnailDefault优雅返回null', async () => {
  const thumb = await createThumbnailDefault(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  assert.equal(thumb, null);
});

test('Node环境：createThumbnailDefault对空入参返回null', async () => {
  assert.equal(await createThumbnailDefault(null), null);
});
