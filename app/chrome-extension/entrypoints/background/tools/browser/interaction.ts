import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';

interface Coordinates {
  x: number;
  y: number;
}

interface ClickToolParams {
  tabId?: number; // 可选的标签页ID
  selector?: string; // 要点击元素的 CSS 选择器
  coordinates?: Coordinates; // 要点击的坐标（相对于视口的 x, y）
  waitForNavigation?: boolean; // 是否等待点击后导航完成
  timeout?: number; // 等待元素或导航的超时时间（毫秒）
}

/**
 * 用于点击网页元素的工具
 */
class ClickTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CLICK;

  /**
   * 执行点击操作
   */
  async execute(args: ClickToolParams): Promise<ToolResult> {
    const {
      tabId,
      selector,
      coordinates,
      waitForNavigation = false,
      timeout = TIMEOUTS.DEFAULT_WAIT * 5,
    } = args;

    console.log(`开始点击操作，选项:`, args);

    if (!selector && !coordinates) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': 必须提供选择器或坐标');
    }

    try {
      // 获取目标标签页
      let tab: chrome.tabs.Tab;
      if (tabId) {
        try {
          tab = await chrome.tabs.get(tabId);
        } catch (error) {
          return createErrorResponse(`Tab with ID ${tabId} not found`);
        }
      } else {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) {
          return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND);
        }
        tab = tabs[0];
      }

      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': 标签页没有 ID');
      }

      await this.injectContentScript(tab.id, ['inject-scripts/click-helper.js']);

      // 向内容脚本发送点击消息
      const result = await this.sendMessageToTab(tab.id, {
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        selector,
        coordinates,
        waitForNavigation,
        timeout,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: result.message || '点击操作成功',
              elementInfo: result.elementInfo,
              navigationOccurred: result.navigationOccurred,
              clickMethod: coordinates ? 'coordinates' : 'selector',
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('点击操作中出错:', error);
      return createErrorResponse(
        `执行点击时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const clickTool = new ClickTool();

interface FillToolParams {
  tabId?: number; // 可选的标签页ID
  selector: string;
  value: string;
}

/**
 * 用于填充网页表单元素的工具
 */
class FillTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.FILL;

  /**
   * 执行填充操作
   */
  async execute(args: FillToolParams): Promise<ToolResult> {
    const { tabId, selector, value } = args;

    console.log(`开始填充操作，选项:`, args);

    if (!selector) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': 必须提供选择器');
    }

    if (value === undefined || value === null) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': 必须提供值');
    }

    try {
      // 获取目标标签页
      let tab: chrome.tabs.Tab;
      if (tabId) {
        try {
          tab = await chrome.tabs.get(tabId);
        } catch (error) {
          return createErrorResponse(`Tab with ID ${tabId} not found`);
        }
      } else {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) {
          return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND);
        }
        tab = tabs[0];
      }

      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': 标签页没有 ID');
      }

      await this.injectContentScript(tab.id, ['inject-scripts/fill-helper.js']);

      // 向内容脚本发送填充消息
      const result = await this.sendMessageToTab(tab.id, {
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        selector,
        value,
      });

      if (result.error) {
        return createErrorResponse(result.error);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: result.message || '填充操作成功',
              elementInfo: result.elementInfo,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('填充操作中出错:', error);
      return createErrorResponse(
        `填充元素时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const fillTool = new FillTool();

interface HoverToolParams {
  tabId: number; // 必填的标签页ID
  selector: string; // 必填的CSS选择器
}

/**
 * 用于悬停网页元素的工具
 */
class HoverTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HOVER;

  /**
   * 执行悬停操作
   */
  async execute(args: HoverToolParams): Promise<ToolResult> {
    const { tabId, selector } = args;

    console.log(`开始悬停操作，选项:`, args);

    if (!selector) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': 必须提供选择器');
    }

    if (!tabId) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': 必须提供标签页ID');
    }

    try {
      // 获取目标标签页
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (error) {
        return createErrorResponse(`Tab with ID ${tabId} not found`);
      }

      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': 标签页没有 ID');
      }

      // 使用 Debugger 协议模拟鼠标移动实现 hover
      // 1) 在页面中计算元素中心点（通过一次性脚本获取）
      const { centerX, centerY, elementInfo } = (
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: (sel: string) => {
            const el = document.querySelector(sel);
            if (!el) {
              throw new Error(`未找到选择器为 "${sel}" 的元素`);
            }
            el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const info = {
              tagName: el.tagName,
              id: (el as HTMLElement).id || '',
              className: (el as HTMLElement).className || '',
              text: (el.textContent || '').trim().slice(0, 100),
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left,
              },
            };
            return { centerX: cx, centerY: cy, elementInfo: info };
          },
          args: [selector],
        })
      )[0].result as { centerX: number; centerY: number; elementInfo: any };

      // 2) 附加 Debugger，发送 Input.dispatchMouseEvent (mouseMoved) 实现 hover
      const target = { tabId: tab.id } as chrome.debugger.Debuggee;
      // 如果已被其它客户端（如 DevTools）占用，需要给出错误
      const targets = await chrome.debugger.getTargets();
      const occupied = targets.find((t) => t.tabId === tab.id && t.attached && !t.extensionId);
      if (occupied) {
        return createErrorResponse(
          `调试器已被其它客户端占用，无法在标签页 ${tab.id} 上模拟鼠标移动进行悬停。`,
        );
      }

      let attached = false;
      try {
        await chrome.debugger.attach(target, '1.3');
        attached = true;
      } catch (e: any) {
        return createErrorResponse(`附加调试器失败: ${e?.message || String(e)}`);
      }

      try {
        // 发送一次 mouseMoved 到元素中心
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.max(0, Math.round(centerX)),
          y: Math.max(0, Math.round(centerY)),
          buttons: 0,
          // 可选：设置一个小的移动轨迹（多次调用）以更接近真实鼠标
        });
      } catch (e: any) {
        return createErrorResponse(`发送鼠标移动事件失败: ${e?.message || String(e)}`);
      } finally {
        try {
          // await chrome.debugger.detach(target);
        } catch (e) {
          console.warn('分离调试器失败（可能已分离）:', e);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: '悬停操作成功',
              elementInfo,
              hoverPosition: { x: Math.round(centerX), y: Math.round(centerY) },
              method: 'debugger.mouseMoved',
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('悬停操作中出错:', error);
      return createErrorResponse(
        `执行悬停时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const hoverTool = new HoverTool();
