import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface GoBackOrForwardToolParams {
  tabId?: number;
  isForward?: boolean;
}

class GoBackOrForwardTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GO_BACK_OR_FORWARD;

  async execute(args: GoBackOrForwardToolParams): Promise<ToolResult> {
    const { tabId, isForward = false } = args;

    console.log(`尝试在浏览器历史中${isForward ? '前进' : '后退'}`);

    try {
      let targetTab: chrome.tabs.Tab;
      if (tabId) {
        try {
          targetTab = await chrome.tabs.get(tabId);
        } catch (error) {
          return createErrorResponse(`Tab with ID ${tabId} not found`);
        }
      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.id) {
          return createErrorResponse('未找到活动标签页');
        }
        targetTab = activeTab;
      }

      if (isForward) {
        await chrome.tabs.goForward(targetTab.id!);
        console.log(`在标签页 ID: ${targetTab.id} 中前进`);
      } else {
        await chrome.tabs.goBack(targetTab.id!);
        console.log(`在标签页 ID: ${targetTab.id} 中后退`);
      }

      const updatedTab = await chrome.tabs.get(targetTab.id!);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `成功在浏览器历史中${isForward ? '前进' : '后退'}`,
              tabId: updatedTab.id,
              windowId: updatedTab.windowId,
              url: updatedTab.url,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      if (chrome.runtime.lastError) {
        console.error(`Chrome API 错误: ${chrome.runtime.lastError.message}`, error);
        return createErrorResponse(`Chrome API 错误: ${chrome.runtime.lastError.message}`);
      } else {
        console.error('GoBackOrForwardTool.execute 错误:', error);
        return createErrorResponse(
          `${isForward ? '前进' : '后退'}导航时出错: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

export const goBackOrForwardTool = new GoBackOrForwardTool();
