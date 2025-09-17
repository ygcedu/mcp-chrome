/**
 * 向量化标签页内容搜索工具
 * 使用向量数据库进行高效的语义搜索
 */

import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { ContentIndexer } from '@/utils/content-indexer';
import { LIMITS, ERROR_MESSAGES } from '@/common/constants';
import type { SearchResult } from '@/utils/vector-database';

interface VectorSearchResult {
  tabId: number;
  url: string;
  title: string;
  semanticScore: number;
  matchedSnippet: string;
  chunkSource: string;
  timestamp: number;
}

/**
 * 使用语义相似性进行标签页内容向量化搜索的工具
 */
class VectorSearchTabsContentTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SEARCH_TABS_CONTENT;
  private contentIndexer: ContentIndexer;
  private isInitialized = false;

  constructor() {
    super();
    this.contentIndexer = new ContentIndexer({
      autoIndex: true,
      maxChunksPerPage: LIMITS.MAX_SEARCH_RESULTS,
      skipDuplicates: true,
    });
  }

  private async initializeIndexer(): Promise<void> {
    try {
      await this.contentIndexer.initialize();
      this.isInitialized = true;
      console.log('向量搜索标签页内容工具: 内容索引器初始化成功');
    } catch (error) {
      console.error('向量搜索标签页内容工具: 初始化内容索引器失败:', error);
      this.isInitialized = false;
    }
  }

  async execute(args: { query: string }): Promise<ToolResult> {
    try {
      const { query } = args;

      if (!query || query.trim().length === 0) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': 查询参数是必需的且不能为空',
        );
      }

      console.log(`向量搜索标签页内容工具: 开始使用查询进行向量搜索: "${query}"`);

      // 检查语义引擎状态
      if (!this.contentIndexer.isSemanticEngineReady()) {
        if (this.contentIndexer.isSemanticEngineInitializing()) {
          return createErrorResponse('向量搜索引擎仍在初始化中（模型下载中）。请稍等片刻再试。');
        } else {
          // 尝试初始化
          console.log('向量搜索标签页内容工具: 初始化内容索引器...');
          await this.initializeIndexer();

          // 再次检查语义引擎状态
          if (!this.contentIndexer.isSemanticEngineReady()) {
            return createErrorResponse('初始化向量搜索引擎失败');
          }
        }
      }

      // 执行向量搜索，获取更多结果用于去重
      const searchResults = await this.contentIndexer.searchContent(query, 50);

      // 转换搜索结果格式
      const vectorSearchResults = this.convertSearchResults(searchResults);

      // 按标签页去重，每个标签页只保留相似度最高的片段
      const deduplicatedResults = this.deduplicateByTab(vectorSearchResults);

      // 按相似度排序并获取前10个结果
      const topResults = deduplicatedResults
        .sort((a, b) => b.semanticScore - a.semanticScore)
        .slice(0, 10);

      // 获取索引统计信息
      const stats = this.contentIndexer.getStats();

      const result = {
        success: true,
        totalTabsSearched: stats.totalTabs,
        matchedTabsCount: topResults.length,
        vectorSearchEnabled: true,
        indexStats: {
          totalDocuments: stats.totalDocuments,
          totalTabs: stats.totalTabs,
          indexedPages: stats.indexedPages,
          semanticEngineReady: stats.semanticEngineReady,
          semanticEngineInitializing: stats.semanticEngineInitializing,
        },
        matchedTabs: topResults.map((result) => ({
          tabId: result.tabId,
          url: result.url,
          title: result.title,
          semanticScore: result.semanticScore,
          matchedSnippets: [result.matchedSnippet],
          chunkSource: result.chunkSource,
          timestamp: result.timestamp,
        })),
      };

      console.log(`向量搜索标签页内容工具: 使用向量搜索找到 ${topResults.length} 个结果`);

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
      console.error('向量搜索标签页内容工具: 搜索失败:', error);
      return createErrorResponse(
        `向量搜索失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 确保所有标签页都被索引
   */
  private async ensureTabsIndexed(tabs: chrome.tabs.Tab[]): Promise<void> {
    const indexPromises = tabs
      .filter((tab) => tab.id)
      .map(async (tab) => {
        try {
          await this.contentIndexer.indexTabContent(tab.id!);
        } catch (error) {
          console.warn(`向量搜索标签页内容工具: 索引标签页 ${tab.id} 失败:`, error);
        }
      });

    await Promise.allSettled(indexPromises);
  }

  /**
   * 转换搜索结果格式
   */
  private convertSearchResults(searchResults: SearchResult[]): VectorSearchResult[] {
    return searchResults.map((result) => ({
      tabId: result.document.tabId,
      url: result.document.url,
      title: result.document.title,
      semanticScore: result.similarity,
      matchedSnippet: this.extractSnippet(result.document.chunk.text),
      chunkSource: result.document.chunk.source,
      timestamp: result.document.timestamp,
    }));
  }

  /**
   * 按标签页去重，每个标签页只保留相似度最高的片段
   */
  private deduplicateByTab(results: VectorSearchResult[]): VectorSearchResult[] {
    const tabMap = new Map<number, VectorSearchResult>();

    for (const result of results) {
      const existingResult = tabMap.get(result.tabId);

      // 如果这个标签页还没有结果，或者当前结果有更高的相似度，则更新它
      if (!existingResult || result.semanticScore > existingResult.semanticScore) {
        tabMap.set(result.tabId, result);
      }
    }

    return Array.from(tabMap.values());
  }

  /**
   * 提取用于显示的文本片段
   */
  private extractSnippet(text: string, maxLength: number = 200): string {
    if (text.length <= maxLength) {
      return text;
    }

    // 尝试在句子边界处截断
    const truncated = text.substring(0, maxLength);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?'),
      truncated.lastIndexOf('。'),
      truncated.lastIndexOf('！'),
      truncated.lastIndexOf('？'),
    );

    if (lastSentenceEnd > maxLength * 0.7) {
      return truncated.substring(0, lastSentenceEnd + 1);
    }

    // 如果没有找到合适的句子边界，在单词边界处截断
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    if (lastSpaceIndex > maxLength * 0.8) {
      return truncated.substring(0, lastSpaceIndex) + '...';
    }

    return truncated + '...';
  }

  /**
   * 获取索引统计信息
   */
  public async getIndexStats() {
    if (!this.isInitialized) {
      // 不自动初始化 - 只返回基本统计信息
      return {
        totalDocuments: 0,
        totalTabs: 0,
        indexSize: 0,
        indexedPages: 0,
        isInitialized: false,
        semanticEngineReady: false,
        semanticEngineInitializing: false,
      };
    }
    return this.contentIndexer.getStats();
  }

  /**
   * 手动重建索引
   */
  public async rebuildIndex(): Promise<void> {
    if (!this.isInitialized) {
      await this.initializeIndexer();
    }

    try {
      // 清除现有索引
      await this.contentIndexer.clearAllIndexes();

      // 获取所有标签页并重新索引
      const windows = await chrome.windows.getAll({ populate: true });
      const allTabs: chrome.tabs.Tab[] = [];

      for (const window of windows) {
        if (window.tabs) {
          allTabs.push(...window.tabs);
        }
      }

      const validTabs = allTabs.filter(
        (tab) =>
          tab.id &&
          tab.url &&
          !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('chrome-extension://') &&
          !tab.url.startsWith('edge://') &&
          !tab.url.startsWith('about:'),
      );

      await this.ensureTabsIndexed(validTabs);

      console.log(`向量搜索标签页内容工具: 为 ${validTabs.length} 个标签页重建了索引`);
    } catch (error) {
      console.error('向量搜索标签页内容工具: 重建索引失败:', error);
      throw error;
    }
  }

  /**
   * 手动索引指定标签页
   */
  public async indexTab(tabId: number): Promise<void> {
    if (!this.isInitialized) {
      await this.initializeIndexer();
    }

    await this.contentIndexer.indexTabContent(tabId);
  }

  /**
   * 移除指定标签页的索引
   */
  public async removeTabIndex(tabId: number): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    await this.contentIndexer.removeTabIndex(tabId);
  }
}

// 导出工具实例
export const vectorSearchTabsContentTool = new VectorSearchTabsContentTool();
