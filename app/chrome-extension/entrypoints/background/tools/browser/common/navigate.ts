import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 720;

interface NavigateToolParams {
  url?: string;
  newWindow?: boolean;
  width?: number;
  height?: number;
  refresh?: boolean;
}

class NavigateTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NAVIGATE;

  async execute(args: NavigateToolParams): Promise<ToolResult> {
    const { newWindow = false, width, height, url, refresh = false } = args;

    console.log(`尝试 ${refresh ? '刷新当前标签页' : `打开 URL: ${url}`}，选项:`, args);

    try {
      if (refresh) {
        console.log('刷新当前活动标签页');
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.id) {
          return createErrorResponse('未找到要刷新的活动标签页');
        }
        await chrome.tabs.reload(activeTab.id);
        console.log(`已刷新标签页 ID: ${activeTab.id}`);
        const updatedTab = await chrome.tabs.get(activeTab.id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: '成功刷新当前标签页',
                tabId: updatedTab.id,
                windowId: updatedTab.windowId,
                url: updatedTab.url,
              }),
            },
          ],
          isError: false,
        };
      }

      if (!url) {
        return createErrorResponse('当 refresh 不为 true 时，URL 参数是必需的');
      }

      const shouldCreateNewWindow = typeof width === 'number' || typeof height === 'number';

      if (!shouldCreateNewWindow) {
        console.log(`检查 URL 是否已经打开: ${url}`);
        const allTabs = await chrome.tabs.query({});
        const tabs = allTabs.filter((tab) => {
          const tabUrl = tab.url?.endsWith('/') ? tab.url.slice(0, -1) : tab.url;
          const targetUrl = url.endsWith('/') ? url.slice(0, -1) : url;
          return tabUrl === targetUrl;
        });
        console.log(`找到 ${tabs.length} 个匹配的标签页`);

        if (tabs && tabs.length > 0) {
          const existingTab = tabs[0];
          console.log(
            `URL 已在标签页中打开 ID: ${existingTab.id}, 窗口 ID: ${existingTab.windowId}`,
          );

          if (existingTab.id !== undefined) {
            await chrome.tabs.update(existingTab.id, { active: true });
            if (existingTab.windowId !== undefined) {
              await chrome.windows.update(existingTab.windowId, { focused: true });
            }
            console.log(`已激活现有标签页 ID: ${existingTab.id}`);
            const updatedTab = await chrome.tabs.get(existingTab.id);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: '已激活现有标签页',
                    tabId: updatedTab.id,
                    windowId: updatedTab.windowId,
                    url: updatedTab.url,
                  }),
                },
              ],
              isError: false,
            };
          }
        }
      } else {
        console.log(`用户指定了窗口尺寸 (width: ${width}, height: ${height})，将创建新窗口`);
      }

      const openInNewWindow = newWindow || typeof width === 'number' || typeof height === 'number';

      if (openInNewWindow) {
        console.log('在新窗口中打开 URL。');
        const newWindow = await chrome.windows.create({
          url: url,
          width: typeof width === 'number' ? width : DEFAULT_WINDOW_WIDTH,
          height: typeof height === 'number' ? height : DEFAULT_WINDOW_HEIGHT,
          focused: true,
        });

        if (newWindow && newWindow.id !== undefined) {
          console.log(`URL 已在新窗口中打开 ID: ${newWindow.id}`);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: '已在新窗口中打开 URL',
                  windowId: newWindow.id,
                  tabs: newWindow.tabs
                    ? newWindow.tabs.map((tab) => ({
                        tabId: tab.id,
                        url: tab.url,
                      }))
                    : [],
                }),
              },
            ],
            isError: false,
          };
        }
      } else {
        console.log('在最后活动的窗口中打开 URL。');
        const lastFocusedWindow = await chrome.windows.getLastFocused({ populate: false });

        if (lastFocusedWindow && lastFocusedWindow.id !== undefined) {
          console.log(`找到最后聚焦的窗口 ID: ${lastFocusedWindow.id}`);

          const newTab = await chrome.tabs.create({
            url: url,
            windowId: lastFocusedWindow.id,
            active: true,
          });

          await chrome.windows.update(lastFocusedWindow.id, { focused: true });

          console.log(
            `URL 已在现有窗口 ID: ${lastFocusedWindow.id} 的新标签页 ID: ${newTab.id} 中打开`,
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: '已在现有窗口的新标签页中打开 URL',
                  tabId: newTab.id,
                  windowId: lastFocusedWindow.id,
                  url: newTab.url,
                }),
              },
            ],
            isError: false,
          };
        } else {
          console.warn('未找到最后聚焦的窗口，回退到创建新窗口。');

          const fallbackWindow = await chrome.windows.create({
            url: url,
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
            focused: true,
          });

          if (fallbackWindow && fallbackWindow.id !== undefined) {
            console.log(`URL 已在回退新窗口 ID: ${fallbackWindow.id} 中打开`);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: '已在新窗口中打开 URL',
                    windowId: fallbackWindow.id,
                    tabs: fallbackWindow.tabs
                      ? fallbackWindow.tabs.map((tab) => ({
                          tabId: tab.id,
                          url: tab.url,
                        }))
                      : [],
                  }),
                },
              ],
              isError: false,
            };
          }
        }
      }

      return createErrorResponse('打开 URL 失败：发生未知错误');
    } catch (error) {
      if (chrome.runtime.lastError) {
        console.error(`Chrome API 错误: ${chrome.runtime.lastError.message}`, error);
        return createErrorResponse(`Chrome API 错误: ${chrome.runtime.lastError.message}`);
      } else {
        console.error('导航错误:', error);
        return createErrorResponse(
          `导航到 URL 时出错: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

export const navigateTool = new NavigateTool();
