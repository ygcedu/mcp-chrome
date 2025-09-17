/**
 * 图像处理工具函数
 */

/**
 * 从数据URL创建ImageBitmap（用于OffscreenCanvas）
 * @param dataUrl 图像数据URL
 * @returns 创建的ImageBitmap对象
 */
export async function createImageBitmapFromUrl(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return await createImageBitmap(blob);
}

/**
 * 将多个图像部分（dataURL）拼接到单个画布上
 * @param parts 图像部分数组，每个部分包含dataUrl和y坐标
 * @param totalWidthPx 总宽度（像素）
 * @param totalHeightPx 总高度（像素）
 * @returns 拼接后的画布
 */
export async function stitchImages(
  parts: { dataUrl: string; y: number }[],
  totalWidthPx: number,
  totalHeightPx: number,
): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(totalWidthPx, totalHeightPx);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('无法获取画布上下文');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const part of parts) {
    try {
      const img = await createImageBitmapFromUrl(part.dataUrl);
      const sx = 0;
      const sy = 0;
      const sWidth = img.width;
      let sHeight = img.height;
      const dy = part.y;

      if (dy + sHeight > totalHeightPx) {
        sHeight = totalHeightPx - dy;
      }

      if (sHeight <= 0) continue;

      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, dy, sWidth, sHeight);
    } catch (error) {
      console.error('拼接图像部分时出错:', error, part);
    }
  }
  return canvas;
}

/**
 * 将图像（来臯dataURL）裁剪到指定矩形并重新调整大小
 * @param originalDataUrl 原始图像数据URL
 * @param cropRectPx 裁剪矩形（物理像素）
 * @param dpr 设备像素比
 * @param targetWidthOpt 可选的目标输出宽度（CSS像素）
 * @param targetHeightOpt 可选的目标输出高度（CSS像素）
 * @returns 裁剪后的画布
 */
export async function cropAndResizeImage(
  originalDataUrl: string,
  cropRectPx: { x: number; y: number; width: number; height: number },
  dpr: number = 1,
  targetWidthOpt?: number,
  targetHeightOpt?: number,
): Promise<OffscreenCanvas> {
  const img = await createImageBitmapFromUrl(originalDataUrl);

  let sx = cropRectPx.x;
  let sy = cropRectPx.y;
  let sWidth = cropRectPx.width;
  let sHeight = cropRectPx.height;

  // 确保裁剪区域在图像边界内
  if (sx < 0) {
    sWidth += sx;
    sx = 0;
  }
  if (sy < 0) {
    sHeight += sy;
    sy = 0;
  }
  if (sx + sWidth > img.width) {
    sWidth = img.width - sx;
  }
  if (sy + sHeight > img.height) {
    sHeight = img.height - sy;
  }

  if (sWidth <= 0 || sHeight <= 0) {
    throw new Error('计算的裁剪大小无效（<=0）。元素可能不可见或未完全捕获。');
  }

  const finalCanvasWidthPx = targetWidthOpt ? targetWidthOpt * dpr : sWidth;
  const finalCanvasHeightPx = targetHeightOpt ? targetHeightOpt * dpr : sHeight;

  const canvas = new OffscreenCanvas(finalCanvasWidthPx, finalCanvasHeightPx);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('无法获取画布上下文');
  }

  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, finalCanvasWidthPx, finalCanvasHeightPx);

  return canvas;
}

/**
 * 将画布转换为数据URL
 * @param canvas 画布
 * @param format 图像格式
 * @param quality JPEG质量（0-1）
 * @returns 数据URL
 */
export async function canvasToDataURL(
  canvas: OffscreenCanvas,
  format: string = 'image/png',
  quality?: number,
): Promise<string> {
  const blob = await canvas.convertToBlob({
    type: format,
    quality: format === 'image/jpeg' ? quality : undefined,
  });

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 通过缩放图像并将其转换为指定质量的目标格式来压缩图像。
 * 这是减少图像数据大小以便传输或存储的最有效方法。
 *
 * @param {string} imageDataUrl - 原始图像数据URL（例如，来自captureVisibleTab）。
 * @param {object} options - 压缩选项。
 * @param {number} [options.scale=1.0] - 尺寸的缩放因子（例如，0.7表示70%）。
 * @param {number} [options.quality=0.8] - 有损格式（如JPEG）的质量（0.0到1.0）。
 * @param {string} [options.format='image/jpeg'] - 目标图像格式。
 * @returns {Promise<{dataUrl: string, mimeType: string}>} 返回压缩后的图像数据URL及其MIME类型的Promise。
 */
export async function compressImage(
  imageDataUrl: string,
  options: { scale?: number; quality?: number; format?: 'image/jpeg' | 'image/webp' },
): Promise<{ dataUrl: string; mimeType: string }> {
  const { scale = 1.0, quality = 0.8, format = 'image/jpeg' } = options;

  // 1. 从原始数据URL创建ImageBitmap以实现高效绘制。
  const imageBitmap = await createImageBitmapFromUrl(imageDataUrl);

  // 2. 根据缩放因子计算新尺寸。
  const newWidth = Math.round(imageBitmap.width * scale);
  const newHeight = Math.round(imageBitmap.height * scale);

  // 3. 使用OffscreenCanvas提高性能，因为它不需要在DOM中。
  const canvas = new OffscreenCanvas(newWidth, newHeight);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('从 OffscreenCanvas 获取 2D 上下文失败');
  }

  // 4. 将原始图像绘制到较小的画布上，有效地重新调整其大小。
  ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);

  // 5. 将画布内容以指定质量导出为目标格式。
  // 这是执行数据压缩的步骤。
  const compressedDataUrl = await canvas.convertToBlob({ type: format, quality: quality });

  // 一个将blob转换为数据URL的辅助函数，因为OffscreenCanvas.toDataURL在所有执行上下文（如service workers）中尚未标准化。
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(compressedDataUrl);
  });

  return { dataUrl, mimeType: format };
}
