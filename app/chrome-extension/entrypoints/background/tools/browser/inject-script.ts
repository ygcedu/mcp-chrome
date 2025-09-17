import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { ExecutionWorld } from '@/common/constants';

interface InjectScriptParam {
  url?: string;
}
interface ScriptConfig {
  type: ExecutionWorld;
  jsScript: string;
}

interface SendCommandToInjectScriptToolParam {
  tabId?: number;
  eventName: string;
  payload?: string;
}

const injectedTabs = new Map();
class InjectScriptTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.INJECT_SCRIPT;
  async execute(args: InjectScriptParam & ScriptConfig): Promise<ToolResult> {
    try {
      const { url, type, jsScript } = args;
      let tab;

      if (!type || !jsScript) {
        return createErrorResponse('参数 [type] 和 [jsScript] 是必需的');
      }

      if (url) {
        // 如果提供了URL，检查是否已经打开
        console.log(`检查URL是否已经打开: ${url}`);
        const allTabs = await chrome.tabs.query({});

        // 查找匹配URL的标签页
        const matchingTabs = allTabs.filter((t) => {
          // 规范化URL以进行比较（移除末尾斜杠）
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
          console.log(`未找到URL为 ${url} 的现有标签页，创建新标签页`);
          tab = await chrome.tabs.create({ url, active: true });

          // 等待页面加载
          console.log('等待页面加载...');
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } else {
        // 使用活动标签页
        const tabs = await chrome.tabs.query({ active: true });
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

      const res = await handleInject(tab.id!, { ...args });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(res),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('InjectScriptTool.execute 中出错:', error);
      return createErrorResponse(
        `注入脚本错误: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

class SendCommandToInjectScriptTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT;
  async execute(args: SendCommandToInjectScriptToolParam): Promise<ToolResult> {
    try {
      const { tabId, eventName, payload } = args;

      if (!eventName) {
        return createErrorResponse('参数 [eventName] 是必需的');
      }

      if (tabId) {
        const tabExists = await isTabExists(tabId);
        if (!tabExists) {
          return createErrorResponse('标签页:[tabId] 不存在');
        }
      }

      let finalTabId: number | undefined = tabId;

      if (finalTabId === undefined) {
        // 使用活动标签页
        const tabs = await chrome.tabs.query({ active: true });
        if (!tabs[0]) {
          return createErrorResponse('未找到活动标签页');
        }
        finalTabId = tabs[0].id;
      }

      if (!finalTabId) {
        return createErrorResponse('未找到活动标签页');
      }

      if (!injectedTabs.has(finalTabId)) {
        throw new Error('此标签页中未注入脚本。');
      }
      const result = await chrome.tabs.sendMessage(finalTabId, {
        action: eventName,
        payload,
        targetWorld: injectedTabs.get(finalTabId).type, // 桥接器使用此参数决定是否转发到MAIN世界
      });

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
      console.error('InjectScriptTool.execute 中出错:', error);
      return createErrorResponse(
        `注入脚本错误: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function isTabExists(tabId: number) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (error) {
    // 如果标签页不存在会抛出错误
    return false;
  }
}

/**
 * @description 处理向特定标签页注入用户脚本
 * @param {number} tabId - 目标标签页的ID
 * @param {object} scriptConfig - 脚本的配置对象
 */
async function handleInject(tabId: number, scriptConfig: ScriptConfig) {
  if (injectedTabs.has(tabId)) {
    // 如果已经注入，先运行清理以确保干净状态
    console.log(`标签页 ${tabId} 已有注入。先进行清理。`);
    await handleCleanup(tabId);
  }
  const { type, jsScript } = scriptConfig;
  const hasMain = type === ExecutionWorld.MAIN;

  if (hasMain) {
    // 桥接器对于MAIN世界通信和清理是必需的
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['inject-scripts/inject-bridge.js'],
      world: ExecutionWorld.ISOLATED,
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (code) => new Function(code)(),
      args: [jsScript],
      world: ExecutionWorld.MAIN,
    });
  } else {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (code) => new Function(code)(),
      args: [jsScript],
      world: ExecutionWorld.ISOLATED,
    });
  }
  injectedTabs.set(tabId, scriptConfig);
  console.log(`脚本成功注入到标签页 ${tabId}。`);
  return { injected: true };
}

/**
 * @description 触发特定标签页的清理过程
 * @param {number} tabId - 目标标签页的ID
 */
async function handleCleanup(tabId: number) {
  if (!injectedTabs.has(tabId)) return;
  // 发送清理信号。桥接器会将其转发到MAIN世界
  chrome.tabs
    .sendMessage(tabId, { type: 'chrome-mcp:cleanup' })
    .catch((err) => console.warn(`无法向标签页 ${tabId} 发送清理消息。它可能已被关闭。`));

  injectedTabs.delete(tabId);
  console.log(`清理信号已发送到标签页 ${tabId}。状态已清除。`);
}

export const injectScriptTool = new InjectScriptTool();
export const sendCommandToInjectScriptTool = new SendCommandToInjectScriptTool();

// --- 自动清理监听器 ---
chrome.tabs.onRemoved.addListener((tabId) => {
  if (injectedTabs.has(tabId)) {
    console.log(`标签页 ${tabId} 已关闭。清理状态。`);
    injectedTabs.delete(tabId);
  }
});
