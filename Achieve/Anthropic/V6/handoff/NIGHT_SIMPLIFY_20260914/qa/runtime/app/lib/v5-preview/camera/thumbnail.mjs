// 图片元数据读取与缩略图生成的浏览器默认实现。
// 仅使用浏览器原生API（createImageBitmap / OffscreenCanvas / DOM canvas），
// 无第三方依赖；在非浏览器环境（Node测试）下优雅返回 null，
// 由控制器把结果记录为“元数据/缩略图不可用”，绝不伪造尺寸或缩略图。

const THUMBNAIL_MAX_DIM = 640;
const THUMBNAIL_TYPE = 'image/jpeg';
const THUMBNAIL_QUALITY = 0.85;

function hasCreateImageBitmap() {
  return typeof globalThis.createImageBitmap === 'function';
}

async function decodeViaImageElement(blob) {
  const doc = globalThis.document;
  const urlImpl = globalThis.URL;
  if (!doc || typeof doc.createElement !== 'function' || !urlImpl?.createObjectURL) return null;
  // 此处URL自建自撤销，不经控制器登记（生命周期限于本函数内）。
  const url = urlImpl.createObjectURL(blob);
  try {
    return await new Promise((resolve) => {
      const img = doc.createElement('img');
      const done = (value) => {
        img.onload = null;
        img.onerror = null;
        resolve(value);
      };
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done(null);
      img.src = url;
    });
  } finally {
    urlImpl.revokeObjectURL(url);
  }
}

// 读取图片宽高；读不到时返回 null（宽高保持未知），不以任何推测值代替。
export async function decodeImageMetadataDefault(blob) {
  if (!blob) return null;
  if (hasCreateImageBitmap()) {
    try {
      const bitmap = await globalThis.createImageBitmap(blob);
      try {
        return { width: bitmap.width, height: bitmap.height };
      } finally {
        bitmap.close?.();
      }
    } catch {
      // 解码失败时落到 Image 元素回退，再失败则保持未知。
    }
  }
  return decodeViaImageElement(blob);
}

async function bitmapToThumbnailBlob(bitmap, width, height) {
  if (typeof globalThis.OffscreenCanvas === 'function') {
    const canvas = new globalThis.OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: THUMBNAIL_TYPE, quality: THUMBNAIL_QUALITY });
  }
  const doc = globalThis.document;
  if (doc && typeof doc.createElement === 'function') {
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob(resolve, THUMBNAIL_TYPE, THUMBNAIL_QUALITY));
  }
  return null;
}

// 生成独立缩略图（最长边不超过 maxDim，JPEG有损）；不支持时返回 null，不做截帧伪装。
export async function createThumbnailDefault(blob, options = {}) {
  if (!blob || !hasCreateImageBitmap()) return null;
  const maxDim = Number(options.maxDim) > 0 ? Number(options.maxDim) : THUMBNAIL_MAX_DIM;
  let bitmap;
  try {
    bitmap = await globalThis.createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const out = await bitmapToThumbnailBlob(bitmap, width, height);
    if (!out) return null;
    return { blob: out, width, height, maxDim, type: THUMBNAIL_TYPE };
  } finally {
    bitmap.close?.();
  }
}
