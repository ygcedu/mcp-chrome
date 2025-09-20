import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { ERROR_MESSAGES } from '@/common/constants';

interface FillToolParams {
  tabId?: number;
  selector: string;
  value: string;
}

class FillTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.FILL;

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
