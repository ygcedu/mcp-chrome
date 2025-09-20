import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface BookmarkDeleteToolParams {
  bookmarkId?: string;
  url?: string;
  title?: string;
}

async function getBookmarkFolderPath(bookmarkNodeId: string): Promise<string> {
  const pathParts: string[] = [];
  try {
    const initialNodes = await chrome.bookmarks.get(bookmarkNodeId);
    if (initialNodes.length > 0 && initialNodes[0]) {
      const initialNode = initialNodes[0];
      let pathNodeId = initialNode.parentId;
      while (pathNodeId) {
        const parentNodes = await chrome.bookmarks.get(pathNodeId);
        if (parentNodes.length === 0) break;
        const parentNode = parentNodes[0];
        if (parentNode.title) pathParts.unshift(parentNode.title);
        if (!parentNode.parentId) break;
        pathNodeId = parentNode.parentId;
      }
    }
  } catch (error) {
    console.error(`获取节点ID ${bookmarkNodeId} 的书签路径时出错:`, error);
    return pathParts.join(' > ') || '获取路径时出错';
  }
  return pathParts.join(' > ');
}

async function findBookmarksByUrl(
  url: string,
  title?: string,
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  const searchResults = await chrome.bookmarks.search({ url });
  if (!title) return searchResults;
  const titleLower = title.toLowerCase();
  return searchResults.filter(
    (bookmark) => bookmark.title && bookmark.title.toLowerCase().includes(titleLower),
  );
}

class BookmarkDeleteTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.BOOKMARK_DELETE;

  async execute(args: BookmarkDeleteToolParams): Promise<ToolResult> {
    const { bookmarkId, url, title } = args;

    console.log(`书签删除工具: 删除书签，选项:`, args);

    if (!bookmarkId && !url) {
      return createErrorResponse('必须提供书签ID或URL来删除书签');
    }

    try {
      let bookmarksToDelete: chrome.bookmarks.BookmarkTreeNode[] = [];

      if (bookmarkId) {
        try {
          const nodes = await chrome.bookmarks.get(bookmarkId);
          if (nodes && nodes.length > 0 && nodes[0].url) {
            bookmarksToDelete = nodes;
          } else {
            return createErrorResponse(`未找到ID为"${bookmarkId}"的书签，或该ID不对应书签`);
          }
        } catch (error) {
          return createErrorResponse(`无效的书签ID: "${bookmarkId}"`);
        }
      } else if (url) {
        bookmarksToDelete = await findBookmarksByUrl(url, title);
        if (bookmarksToDelete.length === 0) {
          return createErrorResponse(
            `未找到URL为"${url}"的书签${title ? ` (标题包含: "${title}")` : ''}`,
          );
        }
      }

      const deletedBookmarks = [] as Array<{
        id: string;
        title?: string;
        url?: string | null;
        folderPath: string;
      }>;
      const errors = [] as string[];

      for (const bookmark of bookmarksToDelete) {
        try {
          const path = await getBookmarkFolderPath(bookmark.id);
          await chrome.bookmarks.remove(bookmark.id);
          deletedBookmarks.push({
            id: bookmark.id,
            title: bookmark.title,
            url: bookmark.url,
            folderPath: path,
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`删除书签"${bookmark.title}"失败 (ID: ${bookmark.id}): ${errorMsg}`);
        }
      }

      if (deletedBookmarks.length === 0) {
        return createErrorResponse(`删除书签失败: ${errors.join('; ')}`);
      }

      const result: any = {
        success: true,
        message: `成功删除 ${deletedBookmarks.length} 个书签`,
        deletedBookmarks,
      };

      if (errors.length > 0) {
        result.partialSuccess = true;
        result.errors = errors;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('删除书签时出错:', error);
      return createErrorResponse(
        `删除书签时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const bookmarkDeleteTool = new BookmarkDeleteTool();
