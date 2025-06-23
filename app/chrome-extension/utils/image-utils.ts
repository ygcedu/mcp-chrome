/**
 * Image processing utility functions
 */

// Image compression configuration
const COMPRESSION_CONFIG = {
  DEFAULT_QUALITY: 0.8, // Default JPEG quality (0-1)
  HIGH_QUALITY: 0.9, // High quality setting
  MEDIUM_QUALITY: 0.7, // Medium quality setting
  LOW_QUALITY: 0.5, // Low quality setting
  DEFAULT_FORMAT: 'image/jpeg' as const, // Default compression format
  SUPPORTED_FORMATS: ['image/jpeg', 'image/webp', 'image/png'] as const,
  MAX_FILE_SIZE_KB: 2048, // Default maximum file size in KB (2MB)
  COMPRESSION_RETRY_STEPS: [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3], // Quality steps for size optimization
  BASE64_OVERHEAD_FACTOR: 1.37, // Base64 encoding increases size by ~37%
} as const;

// Compression options interface
export interface CompressionOptions {
  enabled?: boolean; // Enable compression (default: true)
  quality?: number; // Compression quality 0-1 (default: 0.8)
  format?: 'image/jpeg' | 'image/webp' | 'image/png'; // Output format (default: 'image/jpeg')
  maxFileSizeKB?: number; // Maximum file size in KB (default: 2048)
}

// Compression result interface
export interface CompressionResult {
  dataUrl: string; // Compressed image data URL
  originalSizeKB: number; // Original size in KB
  compressedSizeKB: number; // Compressed size in KB
  compressionRatio: number; // Compression ratio (0-1, lower is better compression)
  format: string; // Final format used
  quality: number; // Final quality used
}

/**
 * Create ImageBitmap from data URL (for OffscreenCanvas)
 * @param dataUrl Image data URL
 * @returns Created ImageBitmap object
 */
export async function createImageBitmapFromUrl(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return await createImageBitmap(blob);
}

/**
 * Stitch multiple image parts (dataURL) onto a single canvas
 * @param parts Array of image parts, each containing dataUrl and y coordinate
 * @param totalWidthPx Total width (pixels)
 * @param totalHeightPx Total height (pixels)
 * @returns Stitched canvas
 */
export async function stitchImages(
  parts: { dataUrl: string; y: number }[],
  totalWidthPx: number,
  totalHeightPx: number,
): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(totalWidthPx, totalHeightPx);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Unable to get canvas context');
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
      console.error('Error stitching image part:', error, part);
    }
  }
  return canvas;
}

/**
 * Crop image (from dataURL) to specified rectangle and resize
 * @param originalDataUrl Original image data URL
 * @param cropRectPx Crop rectangle (physical pixels)
 * @param dpr Device pixel ratio
 * @param targetWidthOpt Optional target output width (CSS pixels)
 * @param targetHeightOpt Optional target output height (CSS pixels)
 * @returns Cropped canvas
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

  // Ensure crop area is within image boundaries
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
    throw new Error(
      'Invalid calculated crop size (<=0). Element may not be visible or fully captured.',
    );
  }

  const finalCanvasWidthPx = targetWidthOpt ? targetWidthOpt * dpr : sWidth;
  const finalCanvasHeightPx = targetHeightOpt ? targetHeightOpt * dpr : sHeight;

  const canvas = new OffscreenCanvas(finalCanvasWidthPx, finalCanvasHeightPx);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Unable to get canvas context');
  }

  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, finalCanvasWidthPx, finalCanvasHeightPx);

  return canvas;
}

/**
 * Convert canvas to data URL
 * @param canvas Canvas
 * @param format Image format
 * @param quality JPEG quality (0-1)
 * @returns Data URL
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
 * Estimate base64 data size in KB
 * @param dataUrl Base64 data URL
 * @returns Size in KB
 */
function estimateBase64SizeKB(dataUrl: string): number {
  // Remove data URL prefix and calculate size
  const base64Data = dataUrl.split(',')[1] || dataUrl;
  const sizeBytes = (base64Data.length * 3) / 4; // Base64 to bytes conversion
  return sizeBytes / 1024; // Convert to KB
}

/**
 * Compress image with automatic quality adjustment to meet size target
 * @param canvas Source canvas
 * @param options Compression options
 * @returns Compression result with statistics
 */
export async function compressImage(
  canvas: OffscreenCanvas,
  options: CompressionOptions = {},
): Promise<CompressionResult> {
  const {
    enabled = true,
    quality = COMPRESSION_CONFIG.DEFAULT_QUALITY,
    format = COMPRESSION_CONFIG.DEFAULT_FORMAT,
    maxFileSizeKB = COMPRESSION_CONFIG.MAX_FILE_SIZE_KB,
  } = options;

  // If compression is disabled, return original as PNG
  if (!enabled) {
    const originalDataUrl = await canvasToDataURL(canvas, 'image/png');
    const sizeKB = estimateBase64SizeKB(originalDataUrl);
    return {
      dataUrl: originalDataUrl,
      originalSizeKB: sizeKB,
      compressedSizeKB: sizeKB,
      compressionRatio: 1.0,
      format: 'image/png',
      quality: 1.0,
    };
  }

  // Get original size for comparison
  const originalDataUrl = await canvasToDataURL(canvas, 'image/png');
  const originalSizeKB = estimateBase64SizeKB(originalDataUrl);

  let bestDataUrl = originalDataUrl;
  let bestSizeKB = originalSizeKB;
  let bestQuality = 1.0;
  let finalFormat = format;

  // Try compression with specified format and quality
  if (format !== 'image/png') {
    const compressedDataUrl = await canvasToDataURL(canvas, format, quality);
    const compressedSizeKB = estimateBase64SizeKB(compressedDataUrl);

    if (compressedSizeKB <= maxFileSizeKB) {
      // Target size achieved with specified quality
      bestDataUrl = compressedDataUrl;
      bestSizeKB = compressedSizeKB;
      bestQuality = quality;
    } else {
      // Need to reduce quality to meet size target
      for (const testQuality of COMPRESSION_CONFIG.COMPRESSION_RETRY_STEPS) {
        const testDataUrl = await canvasToDataURL(canvas, format, testQuality);
        const testSizeKB = estimateBase64SizeKB(testDataUrl);

        if (testSizeKB <= maxFileSizeKB) {
          bestDataUrl = testDataUrl;
          bestSizeKB = testSizeKB;
          bestQuality = testQuality;
          break;
        }
      }
    }
  }

  // If still too large, try WebP format (if not already using it)
  if (bestSizeKB > maxFileSizeKB && format !== 'image/webp') {
    for (const testQuality of COMPRESSION_CONFIG.COMPRESSION_RETRY_STEPS) {
      const testDataUrl = await canvasToDataURL(canvas, 'image/webp', testQuality);
      const testSizeKB = estimateBase64SizeKB(testDataUrl);

      if (testSizeKB <= maxFileSizeKB) {
        bestDataUrl = testDataUrl;
        bestSizeKB = testSizeKB;
        bestQuality = testQuality;
        finalFormat = 'image/webp';
        break;
      }
    }
  }

  return {
    dataUrl: bestDataUrl,
    originalSizeKB,
    compressedSizeKB: bestSizeKB,
    compressionRatio: bestSizeKB / originalSizeKB,
    format: finalFormat,
    quality: bestQuality,
  };
}

/**
 * Resize image canvas by a scale factor
 * @param canvas Source canvas
 * @param scaleFactor Scale factor (e.g., 0.7 for 70% size)
 * @returns Resized canvas
 */
export function resizeCanvas(canvas: OffscreenCanvas, scaleFactor: number): OffscreenCanvas {
  const newWidth = Math.round(canvas.width * scaleFactor);
  const newHeight = Math.round(canvas.height * scaleFactor);

  const resizedCanvas = new OffscreenCanvas(newWidth, newHeight);
  const ctx = resizedCanvas.getContext('2d');

  if (!ctx) {
    throw new Error('Unable to get canvas context for resizing');
  }

  // Use high-quality scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(canvas, 0, 0, newWidth, newHeight);

  return resizedCanvas;
}

/**
 * Compress image from data URL with optional scaling
 * @param dataUrl Source image data URL
 * @param options Compression options
 * @param scaleFactor Optional scale factor to apply before compression (e.g., 0.7 for 70% size)
 * @returns Compression result with statistics
 */
export async function compressImageFromDataUrl(
  dataUrl: string,
  options: CompressionOptions = {},
  scaleFactor?: number,
): Promise<CompressionResult> {
  // Create canvas from data URL
  const img = await createImageBitmapFromUrl(dataUrl);
  let canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Unable to get canvas context for compression');
  }

  ctx.drawImage(img, 0, 0);

  // Apply scaling if specified
  if (scaleFactor && scaleFactor !== 1.0) {
    canvas = resizeCanvas(canvas, scaleFactor);
  }

  // Compress the canvas
  return compressImage(canvas, options);
}
