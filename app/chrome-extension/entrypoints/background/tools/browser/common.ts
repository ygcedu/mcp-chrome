import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

// 默认窗口尺寸
const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 720;

interface NavigateToolParams {
  url?: string;
  newWindow?: boolean;
  width?: number;
  height?: number;
  refresh?: boolean;
}

/**
 * 用于在浏览器标签页或窗口中导航到 URL 的工具
 */
class NavigateTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NAVIGATE;

  async execute(args: NavigateToolParams): Promise<ToolResult> {
    const { newWindow = false, width, height, url, refresh = false } = args;

    console.log(`尝试 ${refresh ? '刷新当前标签页' : `打开 URL: ${url}`}，选项:`, args);

    try {
      // 首先处理刷新选项
      if (refresh) {
        console.log('刷新当前活动标签页');

        // 获取当前活动标签页
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!activeTab || !activeTab.id) {
          return createErrorResponse('未找到要刷新的活动标签页');
        }

        // 重新加载标签页
        await chrome.tabs.reload(activeTab.id);

        console.log(`已刷新标签页 ID: ${activeTab.id}`);

        // 获取更新的标签页信息
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

      // 在不刷新时验证是否提供了 url
      if (!url) {
        return createErrorResponse('当 refresh 不为 true 时，URL 参数是必需的');
      }

      // 1. 检查 URL 是否已经打开
      // 如果用户明确指定了 width 或 height，则跳过现有标签页检查，直接创建新窗口
      const shouldCreateNewWindow = typeof width === 'number' || typeof height === 'number';

      if (!shouldCreateNewWindow) {
        // 只有在没有指定尺寸的情况下才检查现有标签页
        console.log(`检查 URL 是否已经打开: ${url}`);
        // 获取所有标签页
        const allTabs = await chrome.tabs.query({});
        // 手动过滤匹配的标签页
        const tabs = allTabs.filter((tab) => {
          // 规范化 URL 以进行比较（移除末尾斜杠）
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
            // 激活标签页
            await chrome.tabs.update(existingTab.id, { active: true });

            if (existingTab.windowId !== undefined) {
              // 将包含此标签页的窗口置于前台并聚焦
              await chrome.windows.update(existingTab.windowId, { focused: true });
            }

            console.log(`已激活现有标签页 ID: ${existingTab.id}`);
            // 获取更新的标签页信息并返回
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

      // 2. 如果 URL 尚未打开，根据选项决定如何打开
      const openInNewWindow = newWindow || typeof width === 'number' || typeof height === 'number';

      if (openInNewWindow) {
        console.log('在新窗口中打开 URL。');

        // 创建新窗口
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
        // 尝试在最近活动的窗口中打开新标签页
        const lastFocusedWindow = await chrome.windows.getLastFocused({ populate: false });

        if (lastFocusedWindow && lastFocusedWindow.id !== undefined) {
          console.log(`找到最后聚焦的窗口 ID: ${lastFocusedWindow.id}`);

          const newTab = await chrome.tabs.create({
            url: url,
            windowId: lastFocusedWindow.id,
            active: true,
          });

          // 确保窗口也获得焦点
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
          // 在罕见情况下，如果没有最近活动的窗口（例如，浏览器刚启动且没有窗口）
          // 回退到在新窗口中打开
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

      // 如果所有尝试都失败，返回通用错误
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

interface CloseTabsToolParams {
  tabIds?: number[];
  url?: string;
}

/**
 * 用于关闭浏览器标签页的工具
 */
class CloseTabsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CLOSE_TABS;

  async execute(args: CloseTabsToolParams): Promise<ToolResult> {
    const { tabIds, url } = args;
    let urlPattern = url;
    console.log(`尝试关闭标签页，选项:`, args);

    try {
      // 如果提供了 URL，关闭所有匹配该 URL 的标签页
      if (urlPattern) {
        console.log(`搜索 URL 为 ${url} 的标签页`);
        if (!urlPattern.endsWith('/')) {
          urlPattern += '/*';
        }
        const tabs = await chrome.tabs.query({ url });

        if (!tabs || tabs.length === 0) {
          console.log(`未找到 URL 为 ${url} 的标签页`);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `未找到 URL 为 ${url} 的标签页`,
                  closedCount: 0,
                }),
              },
            ],
            isError: false,
          };
        }

        console.log(`找到 ${tabs.length} 个 URL 为 ${url} 的标签页`);
        const tabIdsToClose = tabs
          .map((tab) => tab.id)
          .filter((id): id is number => id !== undefined);

        if (tabIdsToClose.length === 0) {
          return createErrorResponse('找到标签页但无法获取其 ID');
        }

        await chrome.tabs.remove(tabIdsToClose);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `已关闭 ${tabIdsToClose.length} 个 URL 为 ${url} 的标签页`,
                closedCount: tabIdsToClose.length,
                closedTabIds: tabIdsToClose,
              }),
            },
          ],
          isError: false,
        };
      }

      // 如果提供了 tabIds，关闭这些标签页
      if (tabIds && tabIds.length > 0) {
        console.log(`关闭 ID 为 ${tabIds.join(', ')} 的标签页`);

        // 验证所有 tabIds 是否存在
        const existingTabs = await Promise.all(
          tabIds.map(async (tabId) => {
            try {
              return await chrome.tabs.get(tabId);
            } catch (error) {
              console.warn(`未找到 ID 为 ${tabId} 的标签页`);
              return null;
            }
          }),
        );

        const validTabIds = existingTabs
          .filter((tab): tab is chrome.tabs.Tab => tab !== null)
          .map((tab) => tab.id)
          .filter((id): id is number => id !== undefined);

        if (validTabIds.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: '提供的标签页 ID 都不存在',
                  closedCount: 0,
                }),
              },
            ],
            isError: false,
          };
        }

        await chrome.tabs.remove(validTabIds);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `已关闭 ${validTabIds.length} 个标签页`,
                closedCount: validTabIds.length,
                closedTabIds: validTabIds,
                invalidTabIds: tabIds.filter((id) => !validTabIds.includes(id)),
              }),
            },
          ],
          isError: false,
        };
      }

      // 如果没有提供 tabIds 或 URL，关闭当前活动标签页
      console.log('未提供 tabIds 或 URL，关闭活动标签页');
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!activeTab || !activeTab.id) {
        return createErrorResponse('未找到活动标签页');
      }

      await chrome.tabs.remove(activeTab.id);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: '已关闭活动标签页',
              closedCount: 1,
              closedTabIds: [activeTab.id],
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('CloseTabsTool.execute 错误:', error);
      return createErrorResponse(
        `关闭标签页时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const closeTabsTool = new CloseTabsTool();

interface GoBackOrForwardToolParams {
  isForward?: boolean;
}

/**
 * 用于在浏览器历史中向后或向前导航的工具
 */
class GoBackOrForwardTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GO_BACK_OR_FORWARD;

  async execute(args: GoBackOrForwardToolParams): Promise<ToolResult> {
    const { isForward = false } = args;

    console.log(`尝试在浏览器历史中${isForward ? '前进' : '后退'}`);

    try {
      // 获取当前活动标签页
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!activeTab || !activeTab.id) {
        return createErrorResponse('未找到活动标签页');
      }

      // 根据 isForward 参数向后或向前导航
      if (isForward) {
        await chrome.tabs.goForward(activeTab.id);
        console.log(`在标签页 ID: ${activeTab.id} 中前进`);
      } else {
        await chrome.tabs.goBack(activeTab.id);
        console.log(`在标签页 ID: ${activeTab.id} 中后退`);
      }

      // 获取更新的标签页信息
      const updatedTab = await chrome.tabs.get(activeTab.id);

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
