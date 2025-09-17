import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

/**
 * 书签搜索工具参数接口
 */
interface BookmarkSearchToolParams {
  query?: string; // 用于匹配书签标题和URL的搜索关键词
  maxResults?: number; // 返回结果的最大数量
  folderPath?: string; // 可选，指定要搜索的文件夹（可以是ID或路径字符串，如"Work/Projects"）
}

/**
 * 书签添加工具参数接口
 */
interface BookmarkAddToolParams {
  url?: string; // 要添加为书签的URL，如果未提供则使用当前活动标签页的URL
  title?: string; // 书签标题，如果未提供则使用页面标题
  parentId?: string; // 父文件夹ID或路径字符串（如"Work/Projects"），如果未提供则添加到"书签栏"文件夹
  createFolder?: boolean; // 如果父文件夹不存在是否自动创建
}

/**
 * 书签删除工具参数接口
 */
interface BookmarkDeleteToolParams {
  bookmarkId?: string; // 要删除的书签ID
  url?: string; // 要删除的书签URL（如果未提供ID，则按URL搜索）
  title?: string; // 要删除的书签标题（用于辅助匹配，与URL一起使用）
}

// --- 辅助函数 ---

/**
 * 获取书签的完整文件夹路径
 * @param bookmarkNodeId 书签或文件夹的ID
 * @returns 返回文件夹路径字符串（例如，"书签栏 > 文件夹A > 子文件夹B"）
 */
async function getBookmarkFolderPath(bookmarkNodeId: string): Promise<string> {
  const pathParts: string[] = [];

  try {
    // 首先获取节点本身以检查它是书签还是文件夹
    const initialNodes = await chrome.bookmarks.get(bookmarkNodeId);
    if (initialNodes.length > 0 && initialNodes[0]) {
      const initialNode = initialNodes[0];

      // 从父节点开始构建路径（书签和文件夹都一样）
      let pathNodeId = initialNode.parentId;
      while (pathNodeId) {
        const parentNodes = await chrome.bookmarks.get(pathNodeId);
        if (parentNodes.length === 0) break;

        const parentNode = parentNodes[0];
        if (parentNode.title) {
          pathParts.unshift(parentNode.title);
        }

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

/**
 * 通过ID或路径字符串查找书签文件夹
 * 如果是ID，则验证它
 * 如果是路径字符串，则尝试解析它
 * @param pathOrId 路径字符串（例如，"Work/Projects"）或文件夹ID
 * @returns 返回文件夹节点，如果未找到则返回null
 */
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

/**
 * 创建文件夹路径（如果不存在）
 * @param folderPath 文件夹路径字符串（例如，"Work/Projects/Subproject"）
 * @param parentId 可选的父文件夹ID，默认为"书签栏"
 * @returns 返回创建或找到的最终文件夹节点
 */
async function createFolderPath(
  folderPath: string,
  parentId?: string,
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const pathParts = folderPath
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (pathParts.length === 0) {
    throw new Error('文件夹路径不能为空');
  }

  // 如果未指定父ID，使用"书签栏"文件夹
  let currentParentId: string = parentId || '';
  if (!currentParentId) {
    const rootChildren = await chrome.bookmarks.getChildren('0');
    // 查找"书签栏"文件夹（通常ID是'1'，但为了兼容性按标题搜索）
    const bookmarkBarFolder = rootChildren.find(
      (node) =>
        !node.url &&
        (node.title === '书签栏' ||
          node.title === 'Bookmarks bar' ||
          node.title === 'Bookmarks Bar'),
    );
    currentParentId = bookmarkBarFolder?.id || '1'; // 回退到默认ID
  }

  let currentFolder: chrome.bookmarks.BookmarkTreeNode | null = null;

  // 逐级创建或查找文件夹
  for (const folderName of pathParts) {
    const children: chrome.bookmarks.BookmarkTreeNode[] =
      await chrome.bookmarks.getChildren(currentParentId);

    // 检查是否已存在同名文件夹
    const existingFolder: chrome.bookmarks.BookmarkTreeNode | undefined = children.find(
      (child: chrome.bookmarks.BookmarkTreeNode) =>
        !child.url && child.title.toLowerCase() === folderName.toLowerCase(),
    );

    if (existingFolder) {
      currentFolder = existingFolder;
      currentParentId = existingFolder.id;
    } else {
      // 创建新文件夹
      currentFolder = await chrome.bookmarks.create({
        parentId: currentParentId,
        title: folderName,
      });
      currentParentId = currentFolder.id;
    }
  }

  if (!currentFolder) {
    throw new Error('创建文件夹路径失败');
  }

  return currentFolder;
}

/**
 * 将书签树（或节点数组）扁平化为书签列表（排除文件夹）
 * @param nodes 要扁平化的书签树节点
 * @returns 返回实际的书签节点数组（有URL的节点）
 */
function flattenBookmarkNodesToBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
): chrome.bookmarks.BookmarkTreeNode[] {
  const result: chrome.bookmarks.BookmarkTreeNode[] = [];
  const stack = [...nodes]; // 使用栈进行迭代遍历以避免深度递归问题

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node.url) {
      // 这是一个书签
      result.push(node);
    }

    if (node.children) {
      // 将子节点添加到栈中进行处理
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }

  return result;
}

/**
 * 通过URL和标题查找书签
 * @param url 书签URL
 * @param title 可选的书签标题用于辅助匹配
 * @returns 返回匹配的书签数组
 */
async function findBookmarksByUrl(
  url: string,
  title?: string,
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  // 使用Chrome API按URL搜索
  const searchResults = await chrome.bookmarks.search({ url });

  if (!title) {
    return searchResults;
  }

  // 如果提供了标题，进一步过滤结果
  const titleLower = title.toLowerCase();
  return searchResults.filter(
    (bookmark) => bookmark.title && bookmark.title.toLowerCase().includes(titleLower),
  );
}

/**
 * 书签搜索工具
 * 用于在Chrome浏览器中搜索书签
 */
class BookmarkSearchTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.BOOKMARK_SEARCH;

  /**
   * 执行书签搜索
   */
  async execute(args: BookmarkSearchToolParams): Promise<ToolResult> {
    const { query = '', maxResults = 50, folderPath } = args;

    console.log(`书签搜索工具: 搜索书签，关键词: "${query}"，文件夹路径: "${folderPath}"`);

    try {
      let bookmarksToSearch: chrome.bookmarks.BookmarkTreeNode[] = [];
      let targetFolderNode: chrome.bookmarks.BookmarkTreeNode | null = null;

      // 如果指定了文件夹路径，首先查找该文件夹
      if (folderPath) {
        targetFolderNode = await findFolderByPathOrId(folderPath);
        if (!targetFolderNode) {
          return createErrorResponse(`未找到指定文件夹: "${folderPath}"`);
        }
        // 获取该文件夹及其子文件夹中的所有书签
        const subTree = await chrome.bookmarks.getSubTree(targetFolderNode.id);
        bookmarksToSearch =
          subTree.length > 0 ? flattenBookmarkNodesToBookmarks(subTree[0].children || []) : [];
      }

      let filteredBookmarks: chrome.bookmarks.BookmarkTreeNode[];

      if (query) {
        if (targetFolderNode) {
          // 有查询关键词且指定了文件夹：手动过滤文件夹中的书签
          const lowerCaseQuery = query.toLowerCase();
          filteredBookmarks = bookmarksToSearch.filter(
            (bookmark) =>
              (bookmark.title && bookmark.title.toLowerCase().includes(lowerCaseQuery)) ||
              (bookmark.url && bookmark.url.toLowerCase().includes(lowerCaseQuery)),
          );
        } else {
          // 有查询关键词但未指定文件夹：使用API搜索
          filteredBookmarks = await chrome.bookmarks.search({ query });
          // API搜索可能返回文件夹（如果标题匹配），将它们过滤掉
          filteredBookmarks = filteredBookmarks.filter((item) => !!item.url);
        }
      } else {
        // 没有查询关键词
        if (!targetFolderNode) {
          // 未指定文件夹路径，获取所有书签
          const tree = await chrome.bookmarks.getTree();
          bookmarksToSearch = flattenBookmarkNodesToBookmarks(tree);
        }
        filteredBookmarks = bookmarksToSearch;
      }

      // 限制结果数量
      const limitedResults = filteredBookmarks.slice(0, maxResults);

      // 为每个书签添加文件夹路径信息
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

/**
 * 书签添加工具
 * 用于向Chrome浏览器添加新书签
 */
class BookmarkAddTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.BOOKMARK_ADD;

  /**
   * 执行添加书签操作
   */
  async execute(args: BookmarkAddToolParams): Promise<ToolResult> {
    const { url, title, parentId, createFolder = false } = args;

    console.log(`书签添加工具: 添加书签，选项:`, args);

    try {
      // 如果未提供URL，使用当前活动标签页
      let bookmarkUrl = url;
      let bookmarkTitle = title;

      if (!bookmarkUrl) {
        // 获取当前活动标签页
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0] || !tabs[0].url) {
          // tab.url可能是undefined（例如，chrome://页面）
          return createErrorResponse('未找到有效URL的活动标签页，且未提供URL');
        }

        bookmarkUrl = tabs[0].url;
        if (!bookmarkTitle) {
          bookmarkTitle = tabs[0].title || bookmarkUrl; // 如果标签页标题为空，使用URL作为标题
        }
      }

      if (!bookmarkUrl) {
        // 上面应该已经捕获了，但作为安全措施
        return createErrorResponse('创建书签需要URL');
      }

      // 解析parentId（可能是ID或路径字符串）
      let actualParentId: string | undefined = undefined;
      if (parentId) {
        let folderNode = await findFolderByPathOrId(parentId);

        if (!folderNode && createFolder) {
          // 如果文件夹不存在且允许创建，创建文件夹路径
          try {
            folderNode = await createFolderPath(parentId);
          } catch (createError) {
            return createErrorResponse(
              `创建文件夹路径失败: ${createError instanceof Error ? createError.message : String(createError)}`,
            );
          }
        }

        if (folderNode) {
          actualParentId = folderNode.id;
        } else {
          // 检查parentId是否可能是findFolderByPathOrId遗漏的直接ID（例如，根文件夹'1'）
          try {
            const nodes = await chrome.bookmarks.get(parentId);
            if (nodes && nodes.length > 0 && !nodes[0].url) {
              actualParentId = nodes[0].id;
            } else {
              return createErrorResponse(
                `指定的父文件夹（ID/路径: "${parentId}"）未找到或不是文件夹${createFolder ? '，且创建失败' : '。您可以设置createFolder=true来自动创建文件夹'}`,
              );
            }
          } catch (e) {
            return createErrorResponse(
              `指定的父文件夹（ID/路径: "${parentId}"）未找到或无效${createFolder ? '，且创建失败' : '。您可以设置createFolder=true来自动创建文件夹'}`,
            );
          }
        }
      } else {
        // 如果未指定parentId，默认为"书签栏"
        const rootChildren = await chrome.bookmarks.getChildren('0');
        const bookmarkBarFolder = rootChildren.find(
          (node) =>
            !node.url &&
            (node.title === '书签栏' ||
              node.title === 'Bookmarks bar' ||
              node.title === 'Bookmarks Bar'),
        );
        actualParentId = bookmarkBarFolder?.id || '1'; // 回退到默认ID
      }
      // 如果actualParentId仍然是undefined，chrome.bookmarks.create将使用默认的"其他书签"，但我们已设置为书签栏

      // 创建书签
      const newBookmark = await chrome.bookmarks.create({
        parentId: actualParentId, // 如果是undefined，API使用默认值
        title: bookmarkTitle || bookmarkUrl, // 确保标题永远不为空
        url: bookmarkUrl,
      });

      // 获取书签路径
      const path = await getBookmarkFolderPath(newBookmark.id);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: '书签添加成功',
                bookmark: {
                  id: newBookmark.id,
                  title: newBookmark.title,
                  url: newBookmark.url,
                  dateAdded: newBookmark.dateAdded,
                  folderPath: path,
                },
                folderCreated: createFolder && parentId ? '如有必要已创建文件夹' : false,
              },
              null,
              2,
            ),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('添加书签时出错:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 为常见错误情况提供更具体的错误消息，例如尝试收藏chrome://URL
      if (errorMessage.includes("Can't bookmark URLs of type")) {
        return createErrorResponse(
          `添加书签时出错: 无法收藏此类型的URL（例如，chrome://系统页面）。${errorMessage}`,
        );
      }

      return createErrorResponse(`添加书签时出错: ${errorMessage}`);
    }
  }
}

/**
 * 书签删除工具
 * 用于删除Chrome浏览器中的书签
 */
class BookmarkDeleteTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.BOOKMARK_DELETE;

  /**
   * 执行删除书签操作
   */
  async execute(args: BookmarkDeleteToolParams): Promise<ToolResult> {
    const { bookmarkId, url, title } = args;

    console.log(`书签删除工具: 删除书签，选项:`, args);

    if (!bookmarkId && !url) {
      return createErrorResponse('必须提供书签ID或URL来删除书签');
    }

    try {
      let bookmarksToDelete: chrome.bookmarks.BookmarkTreeNode[] = [];

      if (bookmarkId) {
        // 按ID删除
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
        // 按URL删除
        bookmarksToDelete = await findBookmarksByUrl(url, title);
        if (bookmarksToDelete.length === 0) {
          return createErrorResponse(
            `未找到URL为"${url}"的书签${title ? ` (标题包含: "${title}")` : ''}`,
          );
        }
      }

      // 删除找到的书签
      const deletedBookmarks = [];
      const errors = [];

      for (const bookmark of bookmarksToDelete) {
        try {
          // 在删除前获取路径信息
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

export const bookmarkSearchTool = new BookmarkSearchTool();
export const bookmarkAddTool = new BookmarkAddTool();
export const bookmarkDeleteTool = new BookmarkDeleteTool();
