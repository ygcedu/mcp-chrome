/**
 * 离屏文档管理器
 * 确保在整个扩展中只创建一个离屏文档以避免冲突
 */

export class OffscreenManager {
  private static instance: OffscreenManager | null = null;
  private isCreated = false;
  private isCreating = false;
  private createPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): OffscreenManager {
    if (!OffscreenManager.instance) {
      OffscreenManager.instance = new OffscreenManager();
    }
    return OffscreenManager.instance;
  }

  /**
   * 确保离屏文档存在
   */
  public async ensureOffscreenDocument(): Promise<void> {
    if (this.isCreated) {
      return;
    }

    if (this.isCreating && this.createPromise) {
      return this.createPromise;
    }

    this.isCreating = true;
    this.createPromise = this._doCreateOffscreenDocument().finally(() => {
      this.isCreating = false;
    });

    return this.createPromise;
  }

  private async _doCreateOffscreenDocument(): Promise<void> {
    try {
      if (!chrome.offscreen) {
        throw new Error('离屏 API 不可用。需要 Chrome 109+ 版本。');
      }

      const existingContexts = await (chrome.runtime as any).getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
      });

      if (existingContexts && existingContexts.length > 0) {
        console.log('离屏管理器: 离屏文档已存在');
        this.isCreated = true;
        return;
      }

      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: '需要使用workers运行语义相似度引擎',
      });

      this.isCreated = true;
      console.log('离屏管理器: 离屏文档创建成功');
    } catch (error) {
      console.error('离屏管理器: 创建离屏文档失败:', error);
      this.isCreated = false;
      throw error;
    }
  }

  /**
   * 检查离屏文档是否已创建
   */
  public isOffscreenDocumentCreated(): boolean {
    return this.isCreated;
  }

  /**
   * 关闭离屏文档
   */
  public async closeOffscreenDocument(): Promise<void> {
    try {
      if (chrome.offscreen && this.isCreated) {
        await chrome.offscreen.closeDocument();
        this.isCreated = false;
        console.log('离屏管理器: 离屏文档已关闭');
      }
    } catch (error) {
      console.error('离屏管理器: 关闭离屏文档失败:', error);
    }
  }

  /**
   * 重置状态（用于测试）
   */
  public reset(): void {
    this.isCreated = false;
    this.isCreating = false;
    this.createPromise = null;
  }
}

export const offscreenManager = OffscreenManager.getInstance();
