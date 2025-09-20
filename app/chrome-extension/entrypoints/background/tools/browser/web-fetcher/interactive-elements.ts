import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

interface GetInteractiveElementsToolParams {
  tabId?: number;
  textQuery?: string;
  selector?: string;
  includeCoordinates?: boolean;
  types?: string[];
}

class GetInteractiveElementsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS;

  async execute(args: GetInteractiveElementsToolParams): Promise<ToolResult> {
    const { tabId, textQuery, selector, includeCoordinates = true, types } = args;

    console.log(`使用选项启动获取交互元素:`, args);

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
          return createErrorResponse('未找到活动标签页');
        }
        tab = tabs[0];
      }

      if (!tab.id) {
        return createErrorResponse('标签页没有ID');
      }

      await this.injectContentScript(tab.id, ['inject-scripts/interactive-elements-helper.js']);

      const result = await this.sendMessageToTab(tab.id, {
        action: TOOL_MESSAGE_TYPES.GET_INTERACTIVE_ELEMENTS,
        textQuery,
        selector,
        includeCoordinates,
        types,
      });

      if (!result.success) {
        return createErrorResponse(result.error || '获取交互元素失败');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              elements: result.elements,
              count: result.elements.length,
              query: {
                textQuery,
                selector,
                types: types || '所有',
              },
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('获取交互元素操作中出错:', error);
      return createErrorResponse(
        `获取交互元素时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const getInteractiveElementsTool = new GetInteractiveElementsTool();
