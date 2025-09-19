import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { ERROR_MESSAGES } from '@/common/constants';

interface DragPoint {
  x: number;
  y: number;
}
interface DragParams {
  fromSelector?: string;
  toSelector?: string;
  from?: DragPoint;
  to?: DragPoint;
  durationMs?: number;
  steps?: number;
  holdDelayMs?: number;
  releaseDelayMs?: number;
  scrollIntoView?: boolean;
}

class DragTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.DRAG;

  async execute(args: DragParams): Promise<ToolResult> {
    const {
      fromSelector,
      toSelector,
      from,
      to,
      durationMs = 300,
      steps = 20,
      holdDelayMs = 50,
      releaseDelayMs = 30,
      scrollIntoView = true,
    } = args || {};

    const hasSelectorPair = !!(fromSelector && toSelector);
    const hasPointPair = !!(from && to);
    const hasMixedFromSelectorToPoint = !!(fromSelector && to);
    const hasMixedFromPointToSelector = !!(from && toSelector);

    if (
      !hasSelectorPair &&
      !hasPointPair &&
      !hasMixedFromSelectorToPoint &&
      !hasMixedFromPointToSelector
    ) {
      return createErrorResponse(
        ERROR_MESSAGES.INVALID_PARAMETERS +
          ': 必须提供 (fromSelector,toSelector) 或 (from,to) 或 (fromSelector,to) 或 (from,toSelector)',
      );
    }

    // 统一成 drag-helper 期望的字段名(fromSelector/toSelector 或 from/to)，混合模式无需转换，drag-helper 会自行解析

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab || !tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND);
      }

      // 注入桥和拖拽脚本（MAIN 世界）
      await this.injectContentScript(tab.id, ['inject-scripts/drag-helper.js']);

      const result = await this.sendMessageToTab(tab.id, {
        action: 'dragElement',
        options: {
          fromSelector,
          toSelector,
          from,
          to,
          durationMs,
          steps,
          holdDelayMs,
          releaseDelayMs,
          scrollIntoView,
        },
      });

      if (result?.error) {
        return createErrorResponse(result.error);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, detail: result?.data }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('拖拽操作中出错:', error);
      return createErrorResponse(
        `执行拖拽时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const dragTool = new DragTool();
