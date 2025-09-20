import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

interface WebFetcherToolParams {
  tabId?: number;
  htmlContent?: boolean;
  textContent?: boolean;
  url?: string;
  selector?: string;
}

class WebFetcherTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.WEB_FETCHER;

  async execute(args: WebFetcherToolParams): Promise<ToolResult> {
    const htmlContent = args.htmlContent === true;
    const textContent = htmlContent ? false : args.textContent !== false;
    const { tabId, url, selector } = args;

    console.log(`使用选项启动网页获取器:`, { tabId, htmlContent, textContent, url, selector });

    try {
      let tab: chrome.tabs.Tab;

      if (tabId) {
        try {
          tab = await chrome.tabs.get(tabId);
          console.log(`使用指定的标签页 ID: ${tabId}`);
        } catch (error) {
          return createErrorResponse(`Tab with ID ${tabId} not found`);
        }
      } else if (url) {
        console.log(`检查URL是否已经打开: ${url}`);
        const allTabs = await chrome.tabs.query({});
        const matchingTabs = allTabs.filter((t) => {
          const tabUrl = t.url?.endsWith('/') ? t.url.slice(0, -1) : t.url;
          const targetUrl = url.endsWith('/') ? url.slice(0, -1) : url;
          return tabUrl === targetUrl;
        });

        if (matchingTabs.length > 0) {
          tab = matchingTabs[0];
          console.log(`找到现有标签页，URL: ${url}，标签页ID: ${tab.id}`);
        } else {
          console.log(`未找到URL的现有标签页: ${url}，创建新标签页`);
          tab = await chrome.tabs.create({ url, active: true });
          console.log('等待页面加载...');
          await new Promise((resolve) => setTimeout(resolve, 3000));
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

      await chrome.tabs.update(tab.id, { active: true });

      const result: any = { success: true, url: tab.url, title: tab.title };

      await this.injectContentScript(tab.id, ['inject-scripts/web-fetcher-helper.js']);

      if (htmlContent) {
        const htmlResponse = await this.sendMessageToTab(tab.id, {
          action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_HTML_CONTENT,
          selector,
        });
        if (htmlResponse.success) {
          result.htmlContent = htmlResponse.htmlContent;
        } else {
          console.error('获取HTML内容失败:', htmlResponse.error);
          result.htmlContentError = htmlResponse.error;
        }
      }

      if (textContent) {
        const textResponse = await this.sendMessageToTab(tab.id, {
          action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_TEXT_CONTENT,
          selector,
        });
        if (textResponse.success) {
          result.textContent = textResponse.textContent;
          if (textResponse.article) {
            result.article = {
              title: textResponse.article.title,
              byline: textResponse.article.byline,
              siteName: textResponse.article.siteName,
              excerpt: textResponse.article.excerpt,
              lang: textResponse.article.lang,
            };
          }
          if (textResponse.metadata) {
            result.metadata = textResponse.metadata;
          }
        } else {
          console.error('获取文本内容失败:', textResponse.error);
          result.textContentError = textResponse.error;
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false,
      };
    } catch (error) {
      console.error('网页获取器中出错:', error);
      return createErrorResponse(
        `获取网页内容时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const webFetcherTool = new WebFetcherTool();
