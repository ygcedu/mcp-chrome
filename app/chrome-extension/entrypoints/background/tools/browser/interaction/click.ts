import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';

interface Coordinates {
  x: number;
  y: number;
}

interface ClickToolParams {
  tabId?: number;
  selector?: string;
  coordinates?: Coordinates;
  waitForNavigation?: boolean;
  timeout?: number;
}

class ClickTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CLICK;

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
