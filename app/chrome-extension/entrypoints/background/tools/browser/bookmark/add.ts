import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface BookmarkAddToolParams {
  url?: string;
  title?: string;
  parentId?: string;
  createFolder?: boolean;
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

  let currentParentId: string = parentId || '';
  if (!currentParentId) {
    const rootChildren = await chrome.bookmarks.getChildren('0');
    const bookmarkBarFolder = rootChildren.find(
      (node) =>
        !node.url &&
        (node.title === '书签栏' ||
          node.title === 'Bookmarks bar' ||
          node.title === 'Bookmarks Bar'),
    );
    currentParentId = bookmarkBarFolder?.id || '1';
  }

  let currentFolder: chrome.bookmarks.BookmarkTreeNode | null = null;

  for (const folderName of pathParts) {
    const children: chrome.bookmarks.BookmarkTreeNode[] =
      await chrome.bookmarks.getChildren(currentParentId);

    const existingFolder: chrome.bookmarks.BookmarkTreeNode | undefined = children.find(
      (child: chrome.bookmarks.BookmarkTreeNode) =>
        !child.url && child.title.toLowerCase() === folderName.toLowerCase(),
    );

    if (existingFolder) {
      currentFolder = existingFolder;
      currentParentId = existingFolder.id;
    } else {
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

class BookmarkAddTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.BOOKMARK_ADD;

  async execute(args: BookmarkAddToolParams): Promise<ToolResult> {
    const { url, title, parentId, createFolder = false } = args;

    console.log(`书签添加工具: 添加书签，选项:`, args);

    try {
      let bookmarkUrl = url;
      let bookmarkTitle = title;

      if (!bookmarkUrl) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0] || !tabs[0].url) {
          return createErrorResponse('未找到有效URL的活动标签页，且未提供URL');
        }

        bookmarkUrl = tabs[0].url;
        if (!bookmarkTitle) {
          bookmarkTitle = tabs[0].title || bookmarkUrl;
        }
      }

      if (!bookmarkUrl) {
        return createErrorResponse('创建书签需要URL');
      }

      let actualParentId: string | undefined = undefined;
      if (parentId) {
        let folderNode = await findFolderByPathOrId(parentId);

        if (!folderNode && createFolder) {
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
        const rootChildren = await chrome.bookmarks.getChildren('0');
        const bookmarkBarFolder = rootChildren.find(
          (node) =>
            !node.url &&
            (node.title === '书签栏' ||
              node.title === 'Bookmarks bar' ||
              node.title === 'Bookmarks Bar'),
        );
        actualParentId = bookmarkBarFolder?.id || '1';
      }

      const newBookmark = await chrome.bookmarks.create({
        parentId: actualParentId,
        title: bookmarkTitle || bookmarkUrl,
        url: bookmarkUrl,
      });

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

      if (errorMessage.includes("Can't bookmark URLs of type")) {
        return createErrorResponse(
          `添加书签时出错: 无法收藏此类型的URL（例如，chrome://系统页面）。${errorMessage}`,
        );
      }

      return createErrorResponse(`添加书签时出错: ${errorMessage}`);
    }
  }
}

export const bookmarkAddTool = new BookmarkAddTool();
