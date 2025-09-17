/**
 * 内容索引管理器
 * 负责自动提取、分块和索引标签页内容
 */

import { TextChunker } from './text-chunker';
import { VectorDatabase, getGlobalVectorDatabase } from './vector-database';
import {
  SemanticSimilarityEngine,
  SemanticSimilarityEngineProxy,
  PREDEFINED_MODELS,
  type ModelPreset,
} from './semantic-similarity-engine';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

export interface IndexingOptions {
  autoIndex?: boolean;
  maxChunksPerPage?: number;
  skipDuplicates?: boolean;
}

export class ContentIndexer {
  private textChunker: TextChunker;
  private vectorDatabase!: VectorDatabase;
  private semanticEngine!: SemanticSimilarityEngine | SemanticSimilarityEngineProxy;
  private isInitialized = false;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;
  private indexedPages = new Set<string>();
  private readonly options: Required<IndexingOptions>;

  constructor(options?: IndexingOptions) {
    this.options = {
      autoIndex: true,
      maxChunksPerPage: 50,
      skipDuplicates: true,
      ...options,
    };

    this.textChunker = new TextChunker();
  }

  /**
   * 获取当前选择的模型配置
   */
  private async getCurrentModelConfig() {
    try {
      const result = await chrome.storage.local.get(['selectedModel', 'selectedVersion']);
      const selectedModel = (result.selectedModel as ModelPreset) || 'multilingual-e5-small';
      const selectedVersion =
        (result.selectedVersion as 'full' | 'quantized' | 'compressed') || 'quantized';

      const modelInfo = PREDEFINED_MODELS[selectedModel];

      return {
        modelPreset: selectedModel,
        modelIdentifier: modelInfo.modelIdentifier,
        dimension: modelInfo.dimension,
        modelVersion: selectedVersion,
        useLocalFiles: false,
        maxLength: 256,
        cacheSize: 1000,
        forceOffscreen: true,
      };
    } catch (error) {
      console.error('ContentIndexer: 获取当前模型配置失败，使用默认配置:', error);
      return {
        modelPreset: 'multilingual-e5-small' as const,
        modelIdentifier: 'Xenova/multilingual-e5-small',
        dimension: 384,
        modelVersion: 'quantized' as const,
        useLocalFiles: false,
        maxLength: 256,
        cacheSize: 1000,
        forceOffscreen: true,
      };
    }
  }

  /**
   * 初始化内容索引器
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.isInitializing && this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = this._doInitialize().finally(() => {
      this.isInitializing = false;
    });

    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      // 获取当前选择的模型配置
      const engineConfig = await this.getCurrentModelConfig();

      // 使用代理类在离屏中重用引擎实例
      this.semanticEngine = new SemanticSimilarityEngineProxy(engineConfig);
      await this.semanticEngine.initialize();

      this.vectorDatabase = await getGlobalVectorDatabase({
        dimension: engineConfig.dimension,
        efSearch: 50,
      });
      await this.vectorDatabase.initialize();

      this.setupTabEventListeners();

      this.isInitialized = true;
    } catch (error) {
      console.error('ContentIndexer: 初始化失败:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * 索引指定标签页的内容
   */
  public async indexTabContent(tabId: number): Promise<void> {
    // 在尝试索引之前检查语义引擎是否就绪
    if (!this.isSemanticEngineReady() && !this.isSemanticEngineInitializing()) {
      console.log(`ContentIndexer: Skipping tab ${tabId} - 语义引擎未就绪且未初始化`);
      return;
    }

    if (!this.isInitialized) {
      // 只有在语义引擎已经就绪时才初始化
      if (!this.isSemanticEngineReady()) {
        console.log(
          `ContentIndexer: Skipping tab ${tabId} - ContentIndexer 未初始化 and 语义引擎未就绪`,
        );
        return;
      }
      await this.initialize();
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || !this.shouldIndexUrl(tab.url)) {
        console.log(`ContentIndexer: Skipping tab ${tabId} - URL 不可索引`);
        return;
      }

      const pageKey = `${tab.url}_${tab.title}`;
      if (this.options.skipDuplicates && this.indexedPages.has(pageKey)) {
        console.log(`ContentIndexer: Skipping tab ${tabId} - 已索引`);
        return;
      }

      console.log(`ContentIndexer: 开始索引标签页 ${tabId}: ${tab.title}`);

      const content = await this.extractTabContent(tabId);
      if (!content) {
        console.log(`ContentIndexer: 未从标签页 ${tabId} 提取到内容`);
        return;
      }

      const chunks = this.textChunker.chunkText(content.textContent, content.title);
      console.log(`ContentIndexer: Generated ${chunks.length} 个块用于标签页 ${tabId}`);

      const chunksToIndex = chunks.slice(0, this.options.maxChunksPerPage);
      if (chunks.length > this.options.maxChunksPerPage) {
        console.log(
          `ContentIndexer: 将块数限制从 ${chunks.length} 降至 ${this.options.maxChunksPerPage}`,
        );
      }

      for (const chunk of chunksToIndex) {
        try {
          const embedding = await this.semanticEngine.getEmbedding(chunk.text);
          const label = await this.vectorDatabase.addDocument(
            tabId,
            tab.url!,
            tab.title || '',
            chunk,
            embedding,
          );
          console.log(`ContentIndexer: Indexed chunk ${chunk.index} ，标签为 ${label}`);
        } catch (error) {
          console.error(`ContentIndexer: 索引块 ${chunk.index} 失败:`, error);
        }
      }

      this.indexedPages.add(pageKey);

      console.log(`ContentIndexer: 成功索引 ${chunksToIndex.length} 个块用于标签页 ${tabId}`);
    } catch (error) {
      console.error(`ContentIndexer: 索引标签页 ${tabId} 失败:`, error);
    }
  }

  /**
   * 搜索内容
   */
  public async searchContent(query: string, topK: number = 10) {
    // 在尝试搜索之前检查语义引擎是否就绪
    if (!this.isSemanticEngineReady() && !this.isSemanticEngineInitializing()) {
      throw new Error('语义引擎尚未就绪。请先初始化语义引擎。');
    }

    if (!this.isInitialized) {
      // 只有在语义引擎已经就绪时才初始化
      if (!this.isSemanticEngineReady()) {
        throw new Error('ContentIndexer 未初始化且语义引擎未就绪。请先初始化语义引擎。');
      }
      await this.initialize();
    }

    try {
      const queryEmbedding = await this.semanticEngine.getEmbedding(query);
      const results = await this.vectorDatabase.search(queryEmbedding, topK);

      console.log(`ContentIndexer: Found ${results.length} 个查询结果： "${query}"`);
      return results;
    } catch (error) {
      console.error('ContentIndexer: 搜索失败:', error);

      if (error instanceof Error && error.message.includes('未初始化')) {
        console.log('ContentIndexer: 尝试重新初始化语义引擎并重试搜索...');
        try {
          await this.semanticEngine.initialize();
          const queryEmbedding = await this.semanticEngine.getEmbedding(query);
          const results = await this.vectorDatabase.search(queryEmbedding, topK);

          console.log(`ContentIndexer: 重试成功，找到 ${results.length} 个查询结果： "${query}"`);
          return results;
        } catch (retryError) {
          console.error('ContentIndexer: 重新初始化后重试仍然失败:', retryError);
          throw retryError;
        }
      }

      throw error;
    }
  }

  /**
   * 移除标签页索引
   */
  public async removeTabIndex(tabId: number): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.vectorDatabase.removeTabDocuments(tabId);

      for (const pageKey of this.indexedPages) {
        if (pageKey.includes(`tab_${tabId}_`)) {
          this.indexedPages.delete(pageKey);
        }
      }

      console.log(`ContentIndexer: 已移除标签页 ${tabId} 的索引`);
    } catch (error) {
      console.error(`ContentIndexer: 移除标签页 ${tabId} 的索引失败:`, error);
    }
  }

  /**
   * 检查语义引擎是否就绪（检查本地和全局状态）
   */
  public isSemanticEngineReady(): boolean {
    return this.semanticEngine && this.semanticEngine.isInitialized;
  }

  /**
   * 检查全局语义引擎是否就绪（在后台/离屏中）
   */
  public async isGlobalSemanticEngineReady(): Promise<boolean> {
    try {
      // 由于 ContentIndexer 在后台脚本中运行，直接调用函数而不是发送消息
      const { handleGetModelStatus } = await import('@/entrypoints/background/semantic-similarity');
      const response = await handleGetModelStatus();
      return (
        response &&
        response.success &&
        response.status &&
        response.status.initializationStatus === 'ready'
      );
    } catch (error) {
      console.error('ContentIndexer: 检查全局语义引擎状态失败:', error);
      return false;
    }
  }

  /**
   * 检查语义引擎是否正在初始化
   */
  public isSemanticEngineInitializing(): boolean {
    return (
      this.isInitializing || (this.semanticEngine && (this.semanticEngine as any).isInitializing)
    );
  }

  /**
   * 重新初始化内容索引器（用于模型切换）
   */
  public async reinitialize(): Promise<void> {
    console.log('ContentIndexer: 为模型切换重新初始化...');

    this.isInitialized = false;
    this.isInitializing = false;
    this.initPromise = null;

    await this.performCompleteDataCleanupForModelSwitch();

    this.indexedPages.clear();
    console.log('ContentIndexer: 已清空已索引页面缓存');

    try {
      console.log('ContentIndexer: 正在创建新的语义引擎代理...');
      const newEngineConfig = await this.getCurrentModelConfig();
      console.log('ContentIndexer: 新的引擎配置:', newEngineConfig);

      this.semanticEngine = new SemanticSimilarityEngineProxy(newEngineConfig);
      console.log('ContentIndexer: 已创建新的语义引擎代理');

      await this.semanticEngine.initialize();
      console.log('ContentIndexer: 语义引擎代理初始化完成');
    } catch (error) {
      console.error('ContentIndexer: 创建新的语义引擎代理失败:', error);
      throw error;
    }

    console.log('ContentIndexer: 新���语义引擎代理已就绪，继续进行初始化');

    await this.initialize();

    console.log('ContentIndexer: 重新初始化成功完成');
  }

  /**
   * 执行模型切换的完整数据清理
   */
  private async performCompleteDataCleanupForModelSwitch(): Promise<void> {
    console.log('ContentIndexer: 开始执行模型切换的完整数据清理...');

    try {
      // 清除现有向量数据库实例
      if (this.vectorDatabase) {
        try {
          console.log('ContentIndexer: 正在清理现有的向量数据库实例...');
          await this.vectorDatabase.clear();
          console.log('ContentIndexer: 向量数据库实例清理成功');
        } catch (error) {
          console.warn('ContentIndexer: 清理向量数据库实例失败:', error);
        }
      }

      try {
        const { clearAllVectorData } = await import('./vector-database');
        await clearAllVectorData();
        console.log('ContentIndexer: 已清理模型切换的所有向量数据');
      } catch (error) {
        console.warn('ContentIndexer: 清理向量数据失败:', error);
      }

      try {
        const keysToRemove = [
          'hnswlib_document_mappings_tab_content_index.dat',
          'hnswlib_document_mappings_content_index.dat',
          'hnswlib_document_mappings_vector_index.dat',
          'vectorDatabaseStats',
          'lastCleanupTime',
        ];
        await chrome.storage.local.remove(keysToRemove);
        console.log('ContentIndexer: 已清理 chrome.storage 中与模型相关的数据');
      } catch (error) {
        console.warn('ContentIndexer: 清理 chrome.storage 数据失败:', error);
      }

      try {
        const deleteVectorDB = indexedDB.deleteDatabase('VectorDatabaseStorage');
        await new Promise<void>((resolve) => {
          deleteVectorDB.onsuccess = () => {
            console.log('ContentIndexer: 已删除 VectorDatabaseStorage 数据库');
            resolve();
          };
          deleteVectorDB.onerror = () => {
            console.warn('ContentIndexer: 删除 VectorDatabaseStorage 数据库失败');
            resolve(); // 不要阻塞进程
          };
          deleteVectorDB.onblocked = () => {
            console.warn('ContentIndexer: 删除 VectorDatabaseStorage 数据库被阻止');
            resolve(); // 不要阻塞进程
          };
        });

        // 清理 hnswlib-index 数据库
        const deleteHnswDB = indexedDB.deleteDatabase('/hnswlib-index');
        await new Promise<void>((resolve) => {
          deleteHnswDB.onsuccess = () => {
            console.log('ContentIndexer: 已删除 /hnswlib-index 数据库');
            resolve();
          };
          deleteHnswDB.onerror = () => {
            console.warn('ContentIndexer: 删除 /hnswlib-index 数据库失败');
            resolve(); // 不要阻塞进程
          };
          deleteHnswDB.onblocked = () => {
            console.warn('ContentIndexer: 删除 /hnswlib-index 数据库被阻止');
            resolve(); // 不要阻塞进程
          };
        });

        console.log('ContentIndexer: 已清理与模型切换相关的所有 IndexedDB 数据库');
      } catch (error) {
        console.warn('ContentIndexer: 清理 IndexedDB 数据库失败:', error);
      }

      console.log('ContentIndexer: 模型切换的完整数据清理已成功完成');
    } catch (error) {
      console.error('ContentIndexer: 模型切换的完整数据清理失败:', error);
      throw error;
    }
  }

  /**
   * 手动触发语义引擎初始化（异步，不等待完成）
   * 注意：这应该只在语义引擎已经初始化后调用
   */
  public startSemanticEngineInitialization(): void {
    if (!this.isInitialized && !this.isInitializing) {
      console.log('ContentIndexer: 正在检查语义引擎是否就绪...');

      // 在初始化 ContentIndexer 之前检查全局语义引擎是否就绪
      this.isGlobalSemanticEngineReady()
        .then((isReady) => {
          if (isReady) {
            console.log('ContentIndexer: 开始初始化（语义引擎已就绪）...');
            this.initialize().catch((error) => {
              console.error('ContentIndexer: 后台初始化失败:', error);
            });
          } else {
            console.log('ContentIndexer: 语义引擎未就绪，跳过初始化');
          }
        })
        .catch((error) => {
          console.error('ContentIndexer: 检查语义引擎状态失败:', error);
        });
    }
  }

  /**
   * 获取索引统计信息
   */
  public getStats() {
    const vectorStats = this.vectorDatabase
      ? this.vectorDatabase.getStats()
      : {
          totalDocuments: 0,
          totalTabs: 0,
          indexSize: 0,
        };

    return {
      ...vectorStats,
      indexedPages: this.indexedPages.size,
      isInitialized: this.isInitialized,
      semanticEngineReady: this.isSemanticEngineReady(),
      semanticEngineInitializing: this.isSemanticEngineInitializing(),
    };
  }

  /**
   * 清除所有索引
   */
  public async clearAllIndexes(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.vectorDatabase.clear();
      this.indexedPages.clear();
      console.log('ContentIndexer: 已清空所有索引');
    } catch (error) {
      console.error('ContentIndexer: 清空索引失败:', error);
    }
  }
  private setupTabEventListeners(): void {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (this.options.autoIndex && changeInfo.status === 'complete' && tab.url) {
        setTimeout(() => {
          if (!this.isSemanticEngineReady() && !this.isSemanticEngineInitializing()) {
            console.log(`ContentIndexer: Skipping auto-index for tab ${tabId} - 语义引擎未就绪`);
            return;
          }

          this.indexTabContent(tabId).catch((error) => {
            console.error(`ContentIndexer: Auto-indexing failed for tab ${tabId}:`, error);
          });
        }, 2000);
      }
    });

    chrome.tabs.onRemoved.addListener(async (tabId) => {
      await this.removeTabIndex(tabId);
    });

    if (chrome.webNavigation) {
      chrome.webNavigation.onCommitted.addListener(async (details) => {
        if (details.frameId === 0) {
          await this.removeTabIndex(details.tabId);
        }
      });
    }
  }

  private shouldIndexUrl(url: string): boolean {
    const excludePatterns = [
      /^chrome:\/\//,
      /^chrome-extension:\/\//,
      /^edge:\/\//,
      /^about:/,
      /^moz-extension:\/\//,
      /^file:\/\//,
    ];

    return !excludePatterns.some((pattern) => pattern.test(url));
  }

  private async extractTabContent(
    tabId: number,
  ): Promise<{ textContent: string; title: string } | null> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['inject-scripts/web-fetcher-helper.js'],
      });

      const response = await chrome.tabs.sendMessage(tabId, {
        action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_TEXT_CONTENT,
      });

      if (response.success && response.textContent) {
        return {
          textContent: response.textContent,
          title: response.title || '',
        };
      } else {
        console.error(`ContentIndexer: 从标签页 ${tabId} 提取内容失败:`, response.error);
        return null;
      }
    } catch (error) {
      console.error(`ContentIndexer: 提取标签页 ${tabId} 内容时出错:`, error);
      return null;
    }
  }
}

let globalContentIndexer: ContentIndexer | null = null;

/**
 * 获取全局 ContentIndexer 实例
 */
export function getGlobalContentIndexer(): ContentIndexer {
  if (!globalContentIndexer) {
    globalContentIndexer = new ContentIndexer();
  }
  return globalContentIndexer;
}
