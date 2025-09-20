import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface BookmarkSearchToolParams {
  query?: string;
  maxResults?: number;
  folderPath?: string;
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

async function findFolderByPathOrId(
  pathOrId: string,
): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
  try {
    const nodes = await chrome.bookmarks.get(pathOrId);
    if (nodes && nodes.length > 0 && !nodes[0].url) {
      return nodes[0];
    }
  } catch (e) {
    // 什么都不做，尝试解析为路径字符串
  }

  const pathParts = pathOrId
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (pathParts.length === 0) return null;

  const rootChildren = await chrome.bookmarks.getChildren('0');

  let currentNodes = rootChildren;
  let foundFolder: chrome.bookmarks.BookmarkTreeNode | null = null;

  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    foundFolder = null;
    let matchedNodeThisLevel: chrome.bookmarks.BookmarkTreeNode | null = null;

    for (const node of currentNodes) {
      if (!node.url && node.title.toLowerCase() === part.toLowerCase()) {
        matchedNodeThisLevel = node;
        break;
      }
    }

    if (matchedNodeThisLevel) {
      if (i === pathParts.length - 1) {
        foundFolder = matchedNodeThisLevel;
      } else {
        currentNodes = await chrome.bookmarks.getChildren(matchedNodeThisLevel.id);
      }
    } else {
      return null;
    }
  }

  return foundFolder;
}

function flattenBookmarkNodesToBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
): chrome.bookmarks.BookmarkTreeNode[] {
  const result: chrome.bookmarks.BookmarkTreeNode[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.url) result.push(node);
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }
  return result;
}

class BookmarkSearchTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.BOOKMARK_SEARCH;

  async execute(args: BookmarkSearchToolParams): Promise<ToolResult> {
    const { query = '', maxResults = 50, folderPath } = args;

    console.log(`书签搜索工具: 搜索书签，关键词: "${query}"，文件夹路径: "${folderPath}"`);

    try {
      let bookmarksToSearch: chrome.bookmarks.BookmarkTreeNode[] = [];
      let targetFolderNode: chrome.bookmarks.BookmarkTreeNode | null = null;

      if (folderPath) {
        targetFolderNode = await findFolderByPathOrId(folderPath);
        if (!targetFolderNode) {
          return createErrorResponse(`未找到指定文件夹: "${folderPath}"`);
        }
        const subTree = await chrome.bookmarks.getSubTree(targetFolderNode.id);
        bookmarksToSearch =
          subTree.length > 0 ? flattenBookmarkNodesToBookmarks(subTree[0].children || []) : [];
      }

      let filteredBookmarks: chrome.bookmarks.BookmarkTreeNode[];

      if (query) {
        if (targetFolderNode) {
          const lowerCaseQuery = query.toLowerCase();
          filteredBookmarks = bookmarksToSearch.filter(
            (bookmark) =>
              (bookmark.title && bookmark.title.toLowerCase().includes(lowerCaseQuery)) ||
              (bookmark.url && bookmark.url.toLowerCase().includes(lowerCaseQuery)),
          );
        } else {
          filteredBookmarks = await chrome.bookmarks.search({ query });
          filteredBookmarks = filteredBookmarks.filter((item) => !!item.url);
        }
      } else {
        if (!targetFolderNode) {
          const tree = await chrome.bookmarks.getTree();
          bookmarksToSearch = flattenBookmarkNodesToBookmarks(tree);
        }
        filteredBookmarks = bookmarksToSearch;
      }

      const limitedResults = filteredBookmarks.slice(0, maxResults);
      const resultsWithPath = await Promise.all(
        limitedResults.map(async (bookmark) => {
          const path = await getBookmarkFolderPath(bookmark.id);
          return {
            id: bookmark.id,
            title: bookmark.title,
            url: bookmark.url,
            dateAdded: bookmark.dateAdded,
            folderPath: path,
          };
        }),
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                totalResults: resultsWithPath.length,
                query: query || null,
                folderSearched: targetFolderNode
                  ? targetFolderNode.title || targetFolderNode.id
                  : '所有书签',
                bookmarks: resultsWithPath,
              },
              null,
              2,
            ),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('搜索书签时出错:', error);
      return createErrorResponse(
        `搜索书签时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const bookmarkSearchTool = new BookmarkSearchTool();
