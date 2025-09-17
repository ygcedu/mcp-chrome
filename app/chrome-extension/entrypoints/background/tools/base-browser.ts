import { ToolExecutor } from '@/common/tool-handler';
import type { ToolResult } from '@/common/tool-handler';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';

const PING_TIMEOUT_MS = 300;

/**
 * 浏览器工具执行器的基类
 */
export abstract class BaseBrowserToolExecutor implements ToolExecutor {
  abstract name: string;
  abstract execute(args: any): Promise<ToolResult>;

  /**
   * 向标签页注入内容脚本
   */
  protected async injectContentScript(
    tabId: number,
    files: string[],
    injectImmediately = false,
    world: 'MAIN' | 'ISOLATED' = 'ISOLATED',
  ): Promise<void> {
    console.log(`向标签页 ${tabId} 注入 ${files.join(', ')}`);

    // 检查脚本是否已经注入
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tabId, { action: `${this.name}_ping` }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`${this.name} 对标签页 ${tabId} 的Ping操作超时`)),
            PING_TIMEOUT_MS,
          ),
        ),
      ]);

      if (response && response.status === 'pong') {
        console.log(`在标签页 ${tabId} 中收到操作 '${this.name}' 的pong。假设脚本已激活。`);
        return;
      } else {
        console.warn(`标签页 ${tabId} 中的意外ping响应:`, response);
      }
    } catch (error) {
      console.error(`ping内容脚本失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files,
        injectImmediately,
        world,
      });
      console.log(`'${files.join(', ')}' 在标签页 ${tabId} 中注入成功`);
    } catch (injectionError) {
      const errorMessage =
        injectionError instanceof Error ? injectionError.message : String(injectionError);
      console.error(`内容脚本 '${files.join(', ')}' 在标签页 ${tabId} 中注入失败: ${errorMessage}`);
      throw new Error(
        `${ERROR_MESSAGES.TOOL_EXECUTION_FAILED}: 在标签页 ${tabId} 中注入内容脚本失败: ${errorMessage}`,
      );
    }
  }

  /**
   * 向标签页发送消息
   */
  protected async sendMessageToTab(tabId: number, message: any): Promise<any> {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);

      if (response && response.error) {
        throw new Error(String(response.error));
      }

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `向标签页 ${tabId} 发送操作 ${message?.action || '未知'} 的消息时出错: ${errorMessage}`,
      );

      if (error instanceof Error) {
        throw error;
      }
      throw new Error(errorMessage);
    }
  }
}
