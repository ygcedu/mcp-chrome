import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { hoverByDebugger } from '@/utils/debugger-mouse';
import { ERROR_MESSAGES } from '@/common/constants';

interface HoverToolParams {
  tabId: number;
  selector: string;
}

class HoverTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HOVER;

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
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (error) {
        return createErrorResponse(`Tab with ID ${tabId} not found`);
      }

      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': 标签页没有 ID');
      }

      try {
        const { elementInfo, hoverPosition } = await hoverByDebugger(tab.id, selector);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: '悬停操作成功',
                elementInfo,
                hoverPosition,
                method: 'debugger.mouseMoved',
              }),
            },
          ],
          isError: false,
        };
      } catch (e: any) {
        return createErrorResponse(e?.message || String(e));
      }
    } catch (error) {
      console.error('悬停操作中出错:', error);
      return createErrorResponse(
        `执行悬停时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const hoverTool = new HoverTool();
