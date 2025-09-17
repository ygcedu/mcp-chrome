import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

const DEFAULT_NETWORK_REQUEST_TIMEOUT = 30000; // 通过内容脚本发送单个请求的超时时间

interface NetworkRequestToolParams {
  url: string; // URL始终是必需的
  method?: string; // 默认为GET
  headers?: Record<string, string>; // 用户提供的头部
  body?: any; // 用户提供的主体
  timeout?: number; // 网络请求本身的超时时间
}

/**
 * 网络请求工具 - 根据提供的参数发送网络请求
 */
class NetworkRequestTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NETWORK_REQUEST;

  async execute(args: NetworkRequestToolParams): Promise<ToolResult> {
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = DEFAULT_NETWORK_REQUEST_TIMEOUT,
    } = args;

    console.log(`网络请求工具: 使用选项执行:`, args);

    if (!url) {
      return createErrorResponse('URL参数是必需的。');
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]?.id) {
        return createErrorResponse('未找到活动标签页或标签页没有ID。');
      }
      const activeTabId = tabs[0].id;

      // 确保内容脚本在目标标签页中可用
      await this.injectContentScript(activeTabId, ['inject-scripts/network-helper.js']);

      console.log(
        `网络请求工具: 发送到内容脚本: URL=${url}, Method=${method}, Headers=${Object.keys(headers).join(',')}, BodyType=${typeof body}`,
      );

      const resultFromContentScript = await this.sendMessageToTab(activeTabId, {
        action: TOOL_MESSAGE_TYPES.NETWORK_SEND_REQUEST,
        url: url,
        method: method,
        headers: headers,
        body: body,
        timeout: timeout,
      });

      console.log(`网络请求工具: 来自内容脚本的响应:`, resultFromContentScript);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(resultFromContentScript),
          },
        ],
        isError: !resultFromContentScript?.success,
      };
    } catch (error: any) {
      console.error('网络请求工具: 发送网络请求时出错:', error);
      return createErrorResponse(`发送网络请求时出错: ${error.message || String(error)}`);
    }
  }
}

export const networkRequestTool = new NetworkRequestTool();
