import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';
import {
  canvasToDataURL,
  createImageBitmapFromUrl,
  cropAndResizeImage,
  stitchImages,
  compressImage,
} from '../../../../utils/image-utils';

// 截图专用常量
const SCREENSHOT_CONSTANTS = {
  SCROLL_DELAY_MS: 350, // 滚动后等待渲染和懒加载的时间
  CAPTURE_STITCH_DELAY_MS: 50, // 滚动序列中捕获之间的小延迟
  MAX_CAPTURE_PARTS: 50, // 最大捕获部分数量（用于无限滚动页面）
  MAX_CAPTURE_HEIGHT_PX: 50000, // 最大捕获高度（像素）
  PIXEL_TOLERANCE: 1,
  SCRIPT_INIT_DELAY: 100, // 脚本初始化延迟
} as const;

interface ScreenshotToolParams {
  name: string;
  selector?: string;
  width?: number;
  height?: number;
  storeBase64?: boolean;
  fullPage?: boolean;
  savePng?: boolean;
  maxHeight?: number; // 最大捕获高度（像素）（用于无限滚动页面）
}

/**
 * 用于捕获网页截图的工具
 */
class ScreenshotTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SCREENSHOT;

  /**
   * 执行截图操作
   */
  async execute(args: ScreenshotToolParams): Promise<ToolResult> {
    const {
      name = 'screenshot',
      selector,
      storeBase64 = false,
      fullPage = false,
      savePng = true,
    } = args;

    console.log(`开始截图，选项:`, args);

    // 获取当前标签页
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) {
      return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND);
    }
    const tab = tabs[0];

    // 检查 URL 限制
    if (
      tab.url?.startsWith('chrome://') ||
      tab.url?.startsWith('edge://') ||
      tab.url?.startsWith('https://chrome.google.com/webstore') ||
      tab.url?.startsWith('https://microsoftedge.microsoft.com/')
    ) {
      return createErrorResponse('由于安全限制，无法捕获特殊浏览器页面或网上应用店页面。');
    }

    let finalImageDataUrl: string | undefined;
    const results: any = { base64: null, fileSaved: false };
    let originalScroll = { x: 0, y: 0 };

    try {
      await this.injectContentScript(tab.id!, ['inject-scripts/screenshot-helper.js']);
      // 等待脚本初始化
      await new Promise((resolve) => setTimeout(resolve, SCREENSHOT_CONSTANTS.SCRIPT_INIT_DELAY));
      // 1. 准备页面（隐藏滚动条，可能的固定元素）
      await this.sendMessageToTab(tab.id!, {
        action: TOOL_MESSAGE_TYPES.SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE,
        options: { fullPage },
      });

      // 获取初始页面详情，包括原始滚动位置
      const pageDetails = await this.sendMessageToTab(tab.id!, {
        action: TOOL_MESSAGE_TYPES.SCREENSHOT_GET_PAGE_DETAILS,
      });
      originalScroll = { x: pageDetails.currentScrollX, y: pageDetails.currentScrollY };

      if (fullPage) {
        this.logInfo('捕获整页...');
        finalImageDataUrl = await this._captureFullPage(tab.id!, args, pageDetails);
      } else if (selector) {
        this.logInfo(`捕获元素: ${selector}`);
        finalImageDataUrl = await this._captureElement(tab.id!, args, pageDetails.devicePixelRatio);
      } else {
        // 仅可见区域
        this.logInfo('捕获可见区域...');
        finalImageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      }

      if (!finalImageDataUrl) {
        throw new Error('捕获图像数据失败');
      }

      // 2. 处理输出
      if (storeBase64 === true) {
        // 压缩图像以减少 base64 输出大小
        const compressed = await compressImage(finalImageDataUrl, {
          scale: 0.7, // 减少 30% 尺寸
          quality: 0.8, // 80% 质量以获得良好平衡
          format: 'image/jpeg', // JPEG 以获得更好的压缩
        });

        // 在响应中包含 base64 数据（不带前缀）
        const base64Data = compressed.dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
        results.base64 = base64Data;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ base64Data, mimeType: compressed.mimeType }),
            },
          ],
          isError: false,
        };
      }

      if (savePng === true) {
        // 保存 PNG 文件到下载
        this.logInfo('保存 PNG...');
        try {
          // 生成文件名
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `${name.replace(/[^a-z0-9_-]/gi, '_') || 'screenshot'}_${timestamp}.png`;

          // 使用 Chrome 的下载 API 保存文件
          const downloadId = await chrome.downloads.download({
            url: finalImageDataUrl,
            filename: filename,
            saveAs: false,
          });

          results.downloadId = downloadId;
          results.filename = filename;
          results.fileSaved = true;

          // 尝试获取完整文件路径
          try {
            // 等待一会儿以确保下载信息已更新
            await new Promise((resolve) => setTimeout(resolve, 100));

            // 搜索下载项以获取完整路径
            const [downloadItem] = await chrome.downloads.search({ id: downloadId });
            if (downloadItem && downloadItem.filename) {
              // 将完整路径添加到响应中
              results.fullPath = downloadItem.filename;
            }
          } catch (pathError) {
            console.warn('无法获取完整文件路径:', pathError);
          }
        } catch (error) {
          console.error('保存 PNG 文件时出错:', error);
          results.saveError = String(error instanceof Error ? error.message : error);
        }
      }
    } catch (error) {
      console.error('截图执行过程中出错:', error);
      return createErrorResponse(
        `截图错误: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      );
    } finally {
      // 3. 重置页面
      try {
        await this.sendMessageToTab(tab.id!, {
          action: TOOL_MESSAGE_TYPES.SCREENSHOT_RESET_PAGE_AFTER_CAPTURE,
          scrollX: originalScroll.x,
          scrollY: originalScroll.y,
        });
      } catch (err) {
        console.warn('重置页面失败，标签页可能已关闭:', err);
      }
    }

    this.logInfo('截图完成!');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `截图 [${name}] 捕获成功`,
            tabId: tab.id,
            url: tab.url,
            name: name,
            ...results,
          }),
        },
      ],
      isError: false,
    };
  }

  /**
   * 记录信息
   */
  private logInfo(message: string) {
    console.log(`[截图工具] ${message}`);
  }

  /**
   * 捕获特定元素
   */
  async _captureElement(
    tabId: number,
    options: ScreenshotToolParams,
    pageDpr: number,
  ): Promise<string> {
    const elementDetails = await this.sendMessageToTab(tabId, {
      action: TOOL_MESSAGE_TYPES.SCREENSHOT_GET_ELEMENT_DETAILS,
      selector: options.selector,
    });

    const dpr = elementDetails.devicePixelRatio || pageDpr || 1;

    // 元素矩形相对于视口，以 CSS 像素为单位
    // captureVisibleTab 以物理像素捕获
    const cropRectPx = {
      x: elementDetails.rect.x * dpr,
      y: elementDetails.rect.y * dpr,
      width: elementDetails.rect.width * dpr,
      height: elementDetails.rect.height * dpr,
    };

    // 小延迟以确保元素在 scrollIntoView 后完全渲染
    await new Promise((resolve) => setTimeout(resolve, SCREENSHOT_CONSTANTS.SCRIPT_INIT_DELAY));

    const visibleCaptureDataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
    if (!visibleCaptureDataUrl) {
      throw new Error('为元素裁剪捕获可见标签页失败');
    }

    const croppedCanvas = await cropAndResizeImage(
      visibleCaptureDataUrl,
      cropRectPx,
      dpr,
      options.width, // 目标输出宽度（CSS 像素）
      options.height, // 目标输出高度（CSS 像素）
    );
    return canvasToDataURL(croppedCanvas);
  }

  /**
   * 捕获整页
   */
  async _captureFullPage(
    tabId: number,
    options: ScreenshotToolParams,
    initialPageDetails: any,
  ): Promise<string> {
    const dpr = initialPageDetails.devicePixelRatio;
    const totalWidthCss = options.width || initialPageDetails.totalWidth; // 如果提供则使用选项宽度
    const totalHeightCss = initialPageDetails.totalHeight; // 整页始终使用实际高度

    // 为无限滚动页面应用最大高度限制
    const maxHeightPx = options.maxHeight || SCREENSHOT_CONSTANTS.MAX_CAPTURE_HEIGHT_PX;
    const limitedHeightCss = Math.min(totalHeightCss, maxHeightPx / dpr);

    const totalWidthPx = totalWidthCss * dpr;
    const totalHeightPx = limitedHeightCss * dpr;

    // 视口尺寸（CSS 像素）- 记录用于调试
    this.logInfo(
      `视口大小: ${initialPageDetails.viewportWidth}x${initialPageDetails.viewportHeight} CSS 像素`,
    );
    this.logInfo(
      `页面尺寸: ${totalWidthCss}x${totalHeightCss} CSS 像素（限制为 ${limitedHeightCss} 高度）`,
    );

    const viewportHeightCss = initialPageDetails.viewportHeight;

    const capturedParts = [];
    let currentScrollYCss = 0;
    let capturedHeightPx = 0;
    let partIndex = 0;

    while (capturedHeightPx < totalHeightPx && partIndex < SCREENSHOT_CONSTANTS.MAX_CAPTURE_PARTS) {
      this.logInfo(
        `捕获第 ${partIndex + 1} 部分... (${Math.round((capturedHeightPx / totalHeightPx) * 100)}%)`,
      );

      if (currentScrollYCss > 0) {
        // 如果已在顶部，则不为第一部分滚动
        const scrollResp = await this.sendMessageToTab(tabId, {
          action: TOOL_MESSAGE_TYPES.SCREENSHOT_SCROLL_PAGE,
          x: 0,
          y: currentScrollYCss,
          scrollDelay: SCREENSHOT_CONSTANTS.SCROLL_DELAY_MS,
        });
        // 根据实际滚动成就更新 currentScrollYCss
        currentScrollYCss = scrollResp.newScrollY;
      }

      // 确保滚动后渲染
      await new Promise((resolve) =>
        setTimeout(resolve, SCREENSHOT_CONSTANTS.CAPTURE_STITCH_DELAY_MS),
      );

      const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
      if (!dataUrl) throw new Error('在整页捕获期间 captureVisibleTab 返回空值');

      const yOffsetPx = currentScrollYCss * dpr;
      capturedParts.push({ dataUrl, y: yOffsetPx });

      const imgForHeight = await createImageBitmapFromUrl(dataUrl); // 获取实际捕获高度
      const lastPartEffectiveHeightPx = Math.min(imgForHeight.height, totalHeightPx - yOffsetPx);

      capturedHeightPx = yOffsetPx + lastPartEffectiveHeightPx;

      if (capturedHeightPx >= totalHeightPx - SCREENSHOT_CONSTANTS.PIXEL_TOLERANCE) break;

      currentScrollYCss += viewportHeightCss;
      // 防止下一个滚动命令过度滚动超过文档高度
      if (
        currentScrollYCss > totalHeightCss - viewportHeightCss &&
        currentScrollYCss < totalHeightCss
      ) {
        currentScrollYCss = totalHeightCss - viewportHeightCss;
      }
      partIndex++;
    }

    // 检查是否达到任何限制
    if (partIndex >= SCREENSHOT_CONSTANTS.MAX_CAPTURE_PARTS) {
      this.logInfo(
        `达到最大捕获部分数量 (${SCREENSHOT_CONSTANTS.MAX_CAPTURE_PARTS})。这可能是无限滚动页面。`,
      );
    }
    if (totalHeightCss > limitedHeightCss) {
      this.logInfo(
        `页面高度 (${totalHeightCss}px) 超过最大捕获高度 (${maxHeightPx / dpr}px)。捕获有限部分。`,
      );
    }

    this.logInfo('拼接图像...');
    const finalCanvas = await stitchImages(capturedParts, totalWidthPx, totalHeightPx);

    // 如果用户指定了宽度但未指定高度（或整页的反之），则调整大小保持纵横比
    let outputCanvas = finalCanvas;
    if (options.width && !options.height) {
      const targetWidthPx = options.width * dpr;
      const aspectRatio = finalCanvas.height / finalCanvas.width;
      const targetHeightPx = targetWidthPx * aspectRatio;
      outputCanvas = new OffscreenCanvas(targetWidthPx, targetHeightPx);
      const ctx = outputCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(finalCanvas, 0, 0, targetWidthPx, targetHeightPx);
      }
    } else if (options.height && !options.width) {
      const targetHeightPx = options.height * dpr;
      const aspectRatio = finalCanvas.width / finalCanvas.height;
      const targetWidthPx = targetHeightPx * aspectRatio;
      outputCanvas = new OffscreenCanvas(targetWidthPx, targetHeightPx);
      const ctx = outputCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(finalCanvas, 0, 0, targetWidthPx, targetHeightPx);
      }
    } else if (options.width && options.height) {
      // 两者都指定，直接调整大小
      const targetWidthPx = options.width * dpr;
      const targetHeightPx = options.height * dpr;
      outputCanvas = new OffscreenCanvas(targetWidthPx, targetHeightPx);
      const ctx = outputCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(finalCanvas, 0, 0, targetWidthPx, targetHeightPx);
      }
    }

    return canvasToDataURL(outputCanvas);
  }
}

export const screenshotTool = new ScreenshotTool();
