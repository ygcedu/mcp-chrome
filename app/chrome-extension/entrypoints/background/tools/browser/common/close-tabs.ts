import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface CloseTabsToolParams {
  tabIds?: number[];
  url?: string;
}

class CloseTabsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CLOSE_TABS;

  async execute(args: CloseTabsToolParams): Promise<ToolResult> {
    const { tabIds, url } = args;
    let urlPattern = url;
    console.log(`尝试关闭标签页，选项:`, args);

    try {
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

      if (tabIds && tabIds.length > 0) {
        console.log(`关闭 ID 为 ${tabIds.join(', ')} 的标签页`);

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
