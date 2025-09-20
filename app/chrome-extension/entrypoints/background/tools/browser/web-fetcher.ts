import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

interface WebFetcherToolParams {
  tabId?: number; // 可选的标签页ID
  htmlContent?: boolean; // 获取当前页面的可见HTML内容。默认: false
  textContent?: boolean; // 获取当前页面的可见文本内容。默认: true
  url?: string; // 可选的URL来获取内容（如果未提供，使用活动标签页）
  selector?: string; // 可选的CSS选择器来从特定元素获取内容
}

class WebFetcherTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.WEB_FETCHER;

  /**
   * 执行网页获取器操作
   */
  async execute(args: WebFetcherToolParams): Promise<ToolResult> {
    // 处理互斥参数：如果htmlContent为true，textContent强制为false
    const htmlContent = args.htmlContent === true;
    const textContent = htmlContent ? false : args.textContent !== false; // 默认为true，除非htmlContent为true或textContent明确设置为false
    const { tabId, url, selector } = args;

    console.log(`使用选项启动网页获取器:`, {
      tabId,
      htmlContent,
      textContent,
      url,
      selector,
    });

    try {
      // 获取要获取内容的标签页
      let tab;

      if (tabId) {
        // 如果提供了tabId，使用指定的标签页
        try {
          tab = await chrome.tabs.get(tabId);
          console.log(`使用指定的标签页 ID: ${tabId}`);
        } catch (error) {
          return createErrorResponse(`Tab with ID ${tabId} not found`);
        }
      } else if (url) {
        // 如果提供了URL，检查它是否已经打开
        console.log(`检查URL是否已经打开: ${url}`);
        const allTabs = await chrome.tabs.query({});

        // 查找匹配URL的标签页
        const matchingTabs = allTabs.filter((t) => {
          // 规范化URL以进行比较（移除尾随斜杠）
          const tabUrl = t.url?.endsWith('/') ? t.url.slice(0, -1) : t.url;
          const targetUrl = url.endsWith('/') ? url.slice(0, -1) : url;
          return tabUrl === targetUrl;
        });

        if (matchingTabs.length > 0) {
          // 使用现有标签页
          tab = matchingTabs[0];
          console.log(`找到现有标签页，URL: ${url}，标签页ID: ${tab.id}`);
        } else {
          // 使用URL创建新标签页
          console.log(`未找到URL的现有标签页: ${url}，创建新标签页`);
          tab = await chrome.tabs.create({ url, active: true });

          // 等待页面加载
          console.log('等待页面加载...');
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } else {
        // 使用活动标签页
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) {
          return createErrorResponse('未找到活动标签页');
        }
        tab = tabs[0];
      }

      if (!tab.id) {
        return createErrorResponse('标签页没有ID');
      }

      // 确保标签页是活动的
      await chrome.tabs.update(tab.id, { active: true });

      // 准备结果对象
      const result: any = {
        success: true,
        url: tab.url,
        title: tab.title,
      };

      await this.injectContentScript(tab.id, ['inject-scripts/web-fetcher-helper.js']);

      // 如果请求获取HTML内容
      if (htmlContent) {
        const htmlResponse = await this.sendMessageToTab(tab.id, {
          action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_HTML_CONTENT,
          selector: selector,
        });

        if (htmlResponse.success) {
          result.htmlContent = htmlResponse.htmlContent;
        } else {
          console.error('获取HTML内容失败:', htmlResponse.error);
          result.htmlContentError = htmlResponse.error;
        }
      }

      // 如果请求获取文本内容（且htmlContent不为true）
      if (textContent) {
        const textResponse = await this.sendMessageToTab(tab.id, {
          action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_TEXT_CONTENT,
          selector: selector,
        });

        if (textResponse.success) {
          result.textContent = textResponse.textContent;

          // 如果可用，包含文章元数据
          if (textResponse.article) {
            result.article = {
              title: textResponse.article.title,
              byline: textResponse.article.byline,
              siteName: textResponse.article.siteName,
              excerpt: textResponse.article.excerpt,
              lang: textResponse.article.lang,
            };
          }

          // 如果可用，包含页面元数据
          if (textResponse.metadata) {
            result.metadata = textResponse.metadata;
          }
        } else {
          console.error('获取文本内容失败:', textResponse.error);
          result.textContentError = textResponse.error;
        }
      }

      // 交互元素功能已被移除

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
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

interface GetInteractiveElementsToolParams {
  tabId?: number; // 可选的标签页ID
  textQuery?: string; // 在交互元素中搜索的文本（模糊搜索）
  selector?: string; // 用于过滤交互元素的CSS选择器
  includeCoordinates?: boolean; // 在响应中包含元素坐标（默认: true）
  types?: string[]; // 要包含的交互元素类型（默认: 所有类型）
}

class GetInteractiveElementsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS;

  /**
   * 执行获取交互元素操作
   */
  async execute(args: GetInteractiveElementsToolParams): Promise<ToolResult> {
    const { tabId, textQuery, selector, includeCoordinates = true, types } = args;

    console.log(`使用选项启动获取交互元素:`, args);

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
          return createErrorResponse('未找到活动标签页');
        }
        tab = tabs[0];
      }

      if (!tab.id) {
        return createErrorResponse('标签页没有ID');
      }

      // 确保内容脚本被注入
      await this.injectContentScript(tab.id, ['inject-scripts/interactive-elements-helper.js']);

      // 发送消息到内容脚本
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
