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
