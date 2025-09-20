import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const DEFAULT_MAX_MESSAGES = 100;

interface ConsoleToolParams {
  tabId?: number;
  url?: string;
  includeExceptions?: boolean;
  maxMessages?: number;
}

interface ConsoleMessage {
  timestamp: number;
  level: string;
  text: string;
  args?: any[];
  source?: string;
  url?: string;
  lineNumber?: number;
  stackTrace?: any;
}

interface ConsoleException {
  timestamp: number;
  text: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: any;
}

interface ConsoleResult {
  success: boolean;
  message: string;
  tabId: number;
  tabUrl: string;
  tabTitle: string;
  captureStartTime: number;
  captureEndTime: number;
  totalDurationMs: number;
  messages: ConsoleMessage[];
  exceptions: ConsoleException[];
  messageCount: number;
  exceptionCount: number;
  messageLimitReached: boolean;
}

/**
 * 用于捕获浏览器标签页控制台输出的工具
 */
class ConsoleTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CONSOLE;

  async execute(args: ConsoleToolParams): Promise<ToolResult> {
    const { tabId, url, includeExceptions = true, maxMessages = DEFAULT_MAX_MESSAGES } = args;

    let targetTab: chrome.tabs.Tab;

    try {
      if (tabId) {
        // 如果提供了tabId，使用指定的标签页
        try {
          targetTab = await chrome.tabs.get(tabId);
        } catch (error) {
          return createErrorResponse(`Tab with ID ${tabId} not found`);
        }
      } else if (url) {
        // 导航到指定的 URL
        targetTab = await this.navigateToUrl(url);
      } else {
        // 使用当前活动标签页
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab?.id) {
          return createErrorResponse('未找到活动标签页且未提供 URL。');
        }
        targetTab = activeTab;
      }

      if (!targetTab?.id) {
        return createErrorResponse('无法识别目标标签页。');
      }

      // 捕获控制台消息（一次性捕获）
      const result = await this.captureConsoleMessages(targetTab.id, {
        includeExceptions,
        maxMessages,
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
    } catch (error: any) {
      console.error('ConsoleTool: 执行期间发生严重错误:', error);
      return createErrorResponse(`ConsoleTool 中出错: ${error.message || String(error)}`);
    }
  }

  private async navigateToUrl(url: string): Promise<chrome.tabs.Tab> {
    // 检查 URL 是否已打开
    const existingTabs = await chrome.tabs.query({ url });

    if (existingTabs.length > 0 && existingTabs[0]?.id) {
      const tab = existingTabs[0];
      // 激活现有标签页
      await chrome.tabs.update(tab.id!, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return tab;
    } else {
      // 使用 URL 创建新标签页
      const newTab = await chrome.tabs.create({ url, active: true });
      // 等待标签页准备就绪
      await this.waitForTabReady(newTab.id!);
      return newTab;
    }
  }

  private async waitForTabReady(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      const checkTab = async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.status === 'complete') {
            resolve();
          } else {
            setTimeout(checkTab, 100);
          }
        } catch (error) {
          // 标签页可能已关闭，仍然解决
          resolve();
        }
      };
      checkTab();
    });
  }

  private formatConsoleArgs(args: any[]): string {
    if (!args || args.length === 0) return '';

    return args
      .map((arg) => {
        if (arg.type === 'string') {
          return arg.value || '';
        } else if (arg.type === 'number') {
          return String(arg.value || '');
        } else if (arg.type === 'boolean') {
          return String(arg.value || '');
        } else if (arg.type === 'object') {
          return arg.description || '[Object]';
        } else if (arg.type === 'undefined') {
          return 'undefined';
        } else if (arg.type === 'function') {
          return arg.description || '[Function]';
        } else {
          return arg.description || arg.value || String(arg);
        }
      })
      .join(' ');
  }

  private async captureConsoleMessages(
    tabId: number,
    options: {
      includeExceptions: boolean;
      maxMessages: number;
    },
  ): Promise<ConsoleResult> {
    const { includeExceptions, maxMessages } = options;
    const startTime = Date.now();
    const messages: ConsoleMessage[] = [];
    const exceptions: ConsoleException[] = [];
    let limitReached = false;

    try {
      // 获取标签页信息
      const tab = await chrome.tabs.get(tabId);

      // 检查调试器是否已附加
      const targets = await chrome.debugger.getTargets();
      const existingTarget = targets.find(
        (t) => t.tabId === tabId && t.attached && t.type === 'page',
      );
      if (existingTarget && !existingTarget.extensionId) {
        throw new Error(`调试器已被其他工具（例如 DevTools）附加到标签页 ${tabId}。`);
      }

      // 附加调试器
      try {
        await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
      } catch (error: any) {
        if (error.message?.includes('Cannot attach to the target with an attached client')) {
          throw new Error(`调试器已附加到标签页 ${tabId}。这可能是 DevTools 或其他扩展。`);
        }
        throw error;
      }

      // 设置事件监听器收集消息
      const collectedMessages: any[] = [];
      const collectedExceptions: any[] = [];

      const eventListener = (source: chrome.debugger.Debuggee, method: string, params?: any) => {
        if (source.tabId !== tabId) return;

        if (method === 'Log.entryAdded' && params?.entry) {
          collectedMessages.push(params.entry);
        } else if (method === 'Runtime.consoleAPICalled' && params) {
          // 将 Runtime.consoleAPICalled 转换为 Log.entryAdded 格式
          const logEntry = {
            timestamp: params.timestamp,
            level: params.type || 'log',
            text: this.formatConsoleArgs(params.args || []),
            source: 'console-api',
            url: params.stackTrace?.callFrames?.[0]?.url,
            lineNumber: params.stackTrace?.callFrames?.[0]?.lineNumber,
            stackTrace: params.stackTrace,
            args: params.args,
          };
          collectedMessages.push(logEntry);
        } else if (
          method === 'Runtime.exceptionThrown' &&
          includeExceptions &&
          params?.exceptionDetails
        ) {
          collectedExceptions.push(params.exceptionDetails);
        }
      };

      chrome.debugger.onEvent.addListener(eventListener);

      try {
        // 首先启用 Runtime 域以捕获控制台 API 调用和异常
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');

        // 同时启用 Log 域以捕获其他日志条目
        await chrome.debugger.sendCommand({ tabId }, 'Log.enable');

        // 等待所有消息被刷新
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // 处理收集的消息
        for (const entry of collectedMessages) {
          if (messages.length >= maxMessages) {
            limitReached = true;
            break;
          }

          const message: ConsoleMessage = {
            timestamp: entry.timestamp,
            level: entry.level || 'log',
            text: entry.text || '',
            source: entry.source,
            url: entry.url,
            lineNumber: entry.lineNumber,
          };

          if (entry.stackTrace) {
            message.stackTrace = entry.stackTrace;
          }

          if (entry.args && Array.isArray(entry.args)) {
            message.args = entry.args;
          }

          messages.push(message);
        }

        // 处理收集的异常
        for (const exceptionDetails of collectedExceptions) {
          const exception: ConsoleException = {
            timestamp: Date.now(),
            text:
              exceptionDetails.text ||
              exceptionDetails.exception?.description ||
              'Unknown exception',
            url: exceptionDetails.url,
            lineNumber: exceptionDetails.lineNumber,
            columnNumber: exceptionDetails.columnNumber,
          };

          if (exceptionDetails.stackTrace) {
            exception.stackTrace = exceptionDetails.stackTrace;
          }

          exceptions.push(exception);
        }
      } finally {
        // 清理
        chrome.debugger.onEvent.removeListener(eventListener);

        try {
          await chrome.debugger.sendCommand({ tabId }, 'Runtime.disable');
        } catch (e) {
          console.warn(`ConsoleTool: 禁用标签页 ${tabId} 的 Runtime 时出错:`, e);
        }

        try {
          await chrome.debugger.sendCommand({ tabId }, 'Log.disable');
        } catch (e) {
          console.warn(`ConsoleTool: 禁用标签页 ${tabId} 的 Log 时出错:`, e);
        }

        try {
          await chrome.debugger.detach({ tabId });
        } catch (e) {
          console.warn(`ConsoleTool: 分离标签页 ${tabId} 的调试器时出错:`, e);
        }
      }

      const endTime = Date.now();

      // 按时间戳排序消息
      messages.sort((a, b) => a.timestamp - b.timestamp);
      exceptions.sort((a, b) => a.timestamp - b.timestamp);

      return {
        success: true,
        message: `标签页 ${tabId} 的控制台捕获完成。捕获了 ${messages.length} 条消息和 ${exceptions.length} 个异常。`,
        tabId,
        tabUrl: tab.url || '',
        tabTitle: tab.title || '',
        captureStartTime: startTime,
        captureEndTime: endTime,
        totalDurationMs: endTime - startTime,
        messages,
        exceptions,
        messageCount: messages.length,
        exceptionCount: exceptions.length,
        messageLimitReached: limitReached,
      };
    } catch (error: any) {
      console.error(`ConsoleTool: 捕获标签页 ${tabId} 的控制台消息时出错:`, error);
      throw error;
    }
  }
}

export const consoleTool = new ConsoleTool();
