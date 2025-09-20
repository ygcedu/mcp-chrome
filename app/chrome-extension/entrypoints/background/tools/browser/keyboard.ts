import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';

interface KeyboardToolParams {
  tabId?: number; // 可选的标签页ID
  keys: string; // 必需：表示要模拟的键或组合键的字符串（例如，"Enter"、"Ctrl+C"）
  selector?: string; // 可选：用于发送键盘事件的目标元素的 CSS 选择器
  delay?: number; // 可选：键盘按键之间的延迟（毫秒）
}

/**
 * 用于在网页上模拟键盘输入的工具
 */
class KeyboardTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.KEYBOARD;

  /**
   * 执行键盘操作
   */
  async execute(args: KeyboardToolParams): Promise<ToolResult> {
    const { tabId, keys, selector, delay = TIMEOUTS.KEYBOARD_DELAY } = args;

    console.log(`开始键盘操作，选项:`, args);

    if (!keys) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': 必须提供键参数');
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

      await this.injectContentScript(tab.id, ['inject-scripts/keyboard-helper.js']);

      // 向内容脚本发送键盘模拟消息
      const result = await this.sendMessageToTab(tab.id, {
        action: TOOL_MESSAGE_TYPES.SIMULATE_KEYBOARD,
        keys,
        selector,
        delay,
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
              message: result.message || '键盘操作成功',
              targetElement: result.targetElement,
              results: result.results,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('键盘操作中出错:', error);
      return createErrorResponse(
        `模拟键盘事件时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const keyboardTool = new KeyboardTool();
