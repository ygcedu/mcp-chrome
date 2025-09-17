/**
 * 向量数据库管理器
 * 使用 hnswlib-wasm 进行高性能向量相似度搜索
 * 实现单例模式以避免重复的 WASM 模块初始化
 */

import { loadHnswlib } from 'hnswlib-wasm-static';
import type { TextChunk } from './text-chunker';

export interface VectorDocument {
  id: string;
  tabId: number;
  url: string;
  title: string;
  chunk: TextChunk;
  embedding: Float32Array;
  timestamp: number;
}

export interface SearchResult {
  document: VectorDocument;
  similarity: number;
  distance: number;
}

export interface VectorDatabaseConfig {
  dimension: number;
  maxElements: number;
  efConstruction: number;
  M: number;
  efSearch: number;
  indexFileName: string;
  enableAutoCleanup?: boolean;
  maxRetentionDays?: number;
}

let globalHnswlib: any = null;
let globalHnswlibInitPromise: Promise<any> | null = null;
let globalHnswlibInitialized = false;

let syncInProgress = false;
let pendingSyncPromise: Promise<void> | null = null;

const DB_NAME = 'VectorDatabaseStorage';
const DB_VERSION = 1;
const STORE_NAME = 'documentMappings';

/**
 * IndexedDB 辅助函数
 */
class IndexedDBHelper {
  private static dbPromise: Promise<IDBDatabase> | null = null;

  static async getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('indexFileName', 'indexFileName', { unique: false });
          }
        };
      });
    }
    return this.dbPromise;
  }

  static async saveData(indexFileName: string, data: any): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        id: indexFileName,
        indexFileName,
        data,
        timestamp: Date.now(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  static async loadData(indexFileName: string): Promise<any | null> {
    const db = await this.getDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise<any | null>((resolve, reject) => {
      const request = store.get(indexFileName);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async deleteData(indexFileName: string): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(indexFileName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 清除所有 IndexedDB 数据（用于模型切换时的完全清理）
   */
  static async clearAllData(): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => {
          console.log('IndexedDB助手: 已从IndexedDB清除所有数据');
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('IndexedDB助手: 清除所有数据失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有存储的键（用于调试）
   */
  static async getAllKeys(): Promise<string[]> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise<string[]>((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('IndexedDB助手: 获取所有键失败:', error);
      return [];
    }
  }
}

/**
 * 全局 hnswlib-wasm 初始化函数
 * 确保在整个应用程序中只初始化一次
 */
async function initializeGlobalHnswlib(): Promise<any> {
  if (globalHnswlibInitialized && globalHnswlib) {
    return globalHnswlib;
  }

  if (globalHnswlibInitPromise) {
    return globalHnswlibInitPromise;
  }

  globalHnswlibInitPromise = (async () => {
    try {
      console.log('向量数据库: 正在初始化全局hnswlib-wasm实例...');
      globalHnswlib = await loadHnswlib();
      globalHnswlibInitialized = true;
      console.log('向量数据库: 全局hnswlib-wasm实例初始化成功');
      return globalHnswlib;
    } catch (error) {
      console.error('向量数据库: 初始化全局hnswlib-wasm失败:', error);
      globalHnswlibInitPromise = null;
      throw error;
    }
  })();

  return globalHnswlibInitPromise;
}

export class VectorDatabase {
  private index: any = null;
  private isInitialized = false;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  private documents = new Map<number, VectorDocument>();
  private tabDocuments = new Map<number, Set<number>>();
  private nextLabel = 0;

  private readonly config: VectorDatabaseConfig;

  constructor(config?: Partial<VectorDatabaseConfig>) {
    this.config = {
      dimension: 384,
      maxElements: 100000,
      efConstruction: 200,
      M: 48,
      efSearch: 50,
      indexFileName: 'tab_content_index.dat',
      enableAutoCleanup: true,
      maxRetentionDays: 30,
      ...config,
    };

    console.log('向量数据库: 使用配置初始化:', {
      dimension: this.config.dimension,
      efSearch: this.config.efSearch,
      M: this.config.M,
      efConstruction: this.config.efConstruction,
      enableAutoCleanup: this.config.enableAutoCleanup,
      maxRetentionDays: this.config.maxRetentionDays,
    });
  }

  /**
   * 初始化向量数据库
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
      console.log('向量数据库: 正在初始化...');

      const hnswlib = await initializeGlobalHnswlib();

      hnswlib.EmscriptenFileSystemManager.setDebugLogs(true);

      this.index = new hnswlib.HierarchicalNSW(
        'cosine',
        this.config.dimension,
        this.config.indexFileName,
      );

      await this.syncFileSystem('read');

      const indexExists = hnswlib.EmscriptenFileSystemManager.checkFileExists(
        this.config.indexFileName,
      );

      if (indexExists) {
        console.log('向量数据库: 正在加载现有索引...');
        try {
          await this.index.readIndex(this.config.indexFileName, this.config.maxElements);
          this.index.setEfSearch(this.config.efSearch);

          await this.loadDocumentMappings();

          if (this.documents.size > 0) {
            const maxLabel = Math.max(...Array.from(this.documents.keys()));
            this.nextLabel = maxLabel + 1;
            console.log(
              `向量数据库: 已加载现有索引，包含 ${this.documents.size} 个文档，下一个标签: ${this.nextLabel}`,
            );
          } else {
            const indexCount = this.index.getCurrentCount();
            if (indexCount > 0) {
              console.warn(
                `向量数据库: 索引包含 ${indexCount} 个向量但未找到文档映射。这可能导致标签不匹配。`,
              );
              this.nextLabel = indexCount;
            } else {
              this.nextLabel = 0;
            }
            console.log(`向量数据库: 未找到文档映射，从下一个标签开始: ${this.nextLabel}`);
          }
        } catch (loadError) {
          console.warn('向量数据库: 加载现有索引失败，正在创建新索引:', loadError);

          this.index.initIndex(
            this.config.maxElements,
            this.config.M,
            this.config.efConstruction,
            200,
          );
          this.index.setEfSearch(this.config.efSearch);
          this.nextLabel = 0;
        }
      } else {
        console.log('向量数据库: 正在创建新索引...');
        this.index.initIndex(
          this.config.maxElements,
          this.config.M,
          this.config.efConstruction,
          200,
        );
        this.index.setEfSearch(this.config.efSearch);
        this.nextLabel = 0;
      }

      this.isInitialized = true;
      console.log('向量数据库: 初始化成功完成');
    } catch (error) {
      console.error('向量数据库: 初始化失败:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * 向向量数据库添加文档
   */
  public async addDocument(
    tabId: number,
    url: string,
    title: string,
    chunk: TextChunk,
    embedding: Float32Array,
  ): Promise<number> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const documentId = this.generateDocumentId(tabId, chunk.index);
    const document: VectorDocument = {
      id: documentId,
      tabId,
      url,
      title,
      chunk,
      embedding,
      timestamp: Date.now(),
    };

    try {
      // 验证向量数据
      if (!embedding || embedding.length !== this.config.dimension) {
        const errorMsg = `Invalid embedding dimension: expected ${this.config.dimension}, got ${embedding?.length || 0}`;
        console.error('向量数据库: 检测到维度不匹配!', {
          expectedDimension: this.config.dimension,
          actualDimension: embedding?.length || 0,
          documentId,
          tabId,
          url,
          title: title.substring(0, 50) + '...',
        });

        // 这可能是由模型切换引起的，建议重新初始化
        console.warn(
          '向量数据库: 这可能是由模型切换引起的。考虑使用正确的维度重新初始化向量数据库。',
        );

        throw new Error(errorMsg);
      }

      // 检查向量数据是否包含无效值
      for (let i = 0; i < embedding.length; i++) {
        if (!isFinite(embedding[i])) {
          throw new Error(`Invalid embedding value at index ${i}: ${embedding[i]}`);
        }
      }

      // 确保我们有一个干净的 Float32Array
      let cleanEmbedding: Float32Array;
      if (embedding instanceof Float32Array) {
        cleanEmbedding = embedding;
      } else {
        cleanEmbedding = new Float32Array(embedding);
      }

      // 使用当前的 nextLabel 作为标签
      const label = this.nextLabel++;

      console.log(`向量数据库: 正在添加文档，标签为 ${label}，嵌入维度: ${embedding.length}`);

      // 向索引添加向量
      // 根据 hnswlib-wasm-static emscripten 绑定要求，需要创建 VectorFloat 类型
      console.log(`向量数据库: 🔧 调试 - 即将调用addPoint，参数:`, {
        embeddingType: typeof cleanEmbedding,
        isFloat32Array: cleanEmbedding instanceof Float32Array,
        length: cleanEmbedding.length,
        firstFewValues: Array.from(cleanEmbedding.slice(0, 3)),
        label: label,
        replaceDeleted: false,
      });

      // 方法1：尝试使用 VectorFloat 构造函数（如果可用）
      let vectorToAdd;
      try {
        // 检查 VectorFloat 构造函数是否存在
        if (globalHnswlib && globalHnswlib.VectorFloat) {
          console.log('向量数据库: 使用VectorFloat构造函数');
          vectorToAdd = new globalHnswlib.VectorFloat();
          // 逐个向 VectorFloat 添加元素
          for (let i = 0; i < cleanEmbedding.length; i++) {
            vectorToAdd.push_back(cleanEmbedding[i]);
          }
        } else {
          // 方法2：使用纯 JS 数组（回退）
          console.log('向量数据库: 使用纯JS数组作为回退');
          vectorToAdd = Array.from(cleanEmbedding);
        }

        // 使用构造的向量调用 addPoint
        this.index.addPoint(vectorToAdd, label, false);

        // 清理 VectorFloat 对象（如果手动创建）
        if (vectorToAdd && typeof vectorToAdd.delete === 'function') {
          vectorToAdd.delete();
        }
      } catch (vectorError) {
        console.error('向量数据库: VectorFloat方法失败，尝试替代方案:', vectorError);

        // 方法3：尝试直接传递 Float32Array
        try {
          console.log('向量数据库: 直接尝试Float32Array');
          this.index.addPoint(cleanEmbedding, label, false);
        } catch (float32Error) {
          console.error('向量数据库: Float32Array方法失败:', float32Error);

          // 方法4：最后手段 - 使用展开运算符
          console.log('向量数据库: 最后尝试展开运算符');
          this.index.addPoint([...cleanEmbedding], label, false);
        }
      }
      console.log(`向量数据库: ✅ 成功添加文档，标签为 ${label}`);

      // 存储文档映射
      this.documents.set(label, document);

      // 更新标签页文档映射
      if (!this.tabDocuments.has(tabId)) {
        this.tabDocuments.set(tabId, new Set());
      }
      this.tabDocuments.get(tabId)!.add(label);

      // 保存索引和映射
      await this.saveIndex();
      await this.saveDocumentMappings();

      // 检查是否需要自动清理
      if (this.config.enableAutoCleanup) {
        await this.checkAndPerformAutoCleanup();
      }

      console.log(`向量数据库: 成功添加文档 ${documentId}，标签为 ${label}`);
      return label;
    } catch (error) {
      console.error('向量数据库: 添加文档失败:', error);
      console.error('向量数据库: 嵌入信息:', {
        type: typeof embedding,
        constructor: embedding?.constructor?.name,
        length: embedding?.length,
        isFloat32Array: embedding instanceof Float32Array,
        firstFewValues: embedding ? Array.from(embedding.slice(0, 5)) : null,
      });
      throw error;
    }
  }

  /**
   * 搜索相似文档
   */
  public async search(queryEmbedding: Float32Array, topK: number = 10): Promise<SearchResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // 验证查询向量
      if (!queryEmbedding || queryEmbedding.length !== this.config.dimension) {
        throw new Error(
          `Invalid query embedding dimension: expected ${this.config.dimension}, got ${queryEmbedding?.length || 0}`,
        );
      }

      // 检查查询向量是否包含无效值
      for (let i = 0; i < queryEmbedding.length; i++) {
        if (!isFinite(queryEmbedding[i])) {
          throw new Error(`Invalid query embedding value at index ${i}: ${queryEmbedding[i]}`);
        }
      }

      console.log(`向量数据库: 使用查询嵌入搜索，维度: ${queryEmbedding.length}，topK: ${topK}`);

      // 检查索引是否为空
      const currentCount = this.index.getCurrentCount();
      if (currentCount === 0) {
        console.log('向量数据库: 索引为空，返回无结果');
        return [];
      }

      console.log(`向量数据库: 索引包含 ${currentCount} 个向量`);

      // 检查文档映射和索引是否同步
      const mappingCount = this.documents.size;
      if (mappingCount === 0 && currentCount > 0) {
        console.warn(
          `向量数据库: 索引包含 ${currentCount} 个向量但文档映射为空。尝试重新加载映射...`,
        );
        await this.loadDocumentMappings();

        if (this.documents.size === 0) {
          console.error('向量数据库: 加载文档映射失败。索引和映射不同步。');
          return [];
        }
        console.log(`向量数据库: 成功重新加载 ${this.documents.size} 个文档映射`);
      }

      // 根据 hnswlib-wasm-static emscripten 绑定要求处理查询向量
      let queryVector;
      let searchResult;

      try {
        // 方法1：尝试使用 VectorFloat 构造函数（如果可用）
        if (globalHnswlib && globalHnswlib.VectorFloat) {
          console.log('向量数据库: 使用VectorFloat进行搜索查询');
          queryVector = new globalHnswlib.VectorFloat();
          // 逐个向 VectorFloat 添加元素
          for (let i = 0; i < queryEmbedding.length; i++) {
            queryVector.push_back(queryEmbedding[i]);
          }
          searchResult = this.index.searchKnn(queryVector, topK, undefined);

          // 清理 VectorFloat 对象
          if (queryVector && typeof queryVector.delete === 'function') {
            queryVector.delete();
          }
        } else {
          // 方法2：使用纯 JS 数组（回退）
          console.log('向量数据库: 使用纯JS数组进行搜索查询');
          const queryArray = Array.from(queryEmbedding);
          searchResult = this.index.searchKnn(queryArray, topK, undefined);
        }
      } catch (vectorError) {
        console.error('向量数据库: VectorFloat搜索失败，尝试替代方案:', vectorError);

        // 方法3：尝试直接传递 Float32Array
        try {
          console.log('向量数据库: 直接尝试Float32Array进行搜索');
          searchResult = this.index.searchKnn(queryEmbedding, topK, undefined);
        } catch (float32Error) {
          console.error('向量数据库: Float32Array搜索失败:', float32Error);

          // 方法4：最后手段 - 使用展开运算符
          console.log('向量数据库: 最后尝试展开运算符进行搜索');
          searchResult = this.index.searchKnn([...queryEmbedding], topK, undefined);
        }
      }

      const results: SearchResult[] = [];

      console.log(`向量数据库: 处理 ${searchResult.neighbors.length} 个搜索邻居`);
      console.log(`向量数据库: 映射中可用文档数: ${this.documents.size}`);
      console.log(`向量数据库: 索引当前计数: ${this.index.getCurrentCount()}`);

      for (let i = 0; i < searchResult.neighbors.length; i++) {
        const label = searchResult.neighbors[i];
        const distance = searchResult.distances[i];
        const similarity = 1 - distance; // 将余弦距离转换为相似度

        console.log(
          `向量数据库: 处理邻居 ${i}: 标签=${label}，距离=${distance}，相似度=${similarity}`,
        );

        // 根据标签查找对应文档
        const document = this.findDocumentByLabel(label);
        if (document) {
          console.log(`向量数据库: 找到标签 ${label} 的文档: ${document.id}`);
          results.push({
            document,
            similarity,
            distance,
          });
        } else {
          console.warn(`向量数据库: 未找到标签 ${label} 的文档`);

          // 详细调试信息
          if (i < 5) {
            // 只为前5个邻居显示详细信息以避免日志垃圾
            console.warn(
              `向量数据库: 可用标签（前20个）: ${Array.from(this.documents.keys()).slice(0, 20).join(', ')}`,
            );
            console.warn(`向量数据库: 总可用标签数: ${this.documents.size}`);
            console.warn(
              `向量数据库: 标签类型: ${typeof label}，可用标签类型: ${Array.from(
                this.documents.keys(),
              )
                .slice(0, 3)
                .map((k) => typeof k)
                .join(', ')}`,
            );
          }
        }
      }

      console.log(
        `向量数据库: 在 ${searchResult.neighbors.length} 个邻居中找到 ${results.length} 个搜索结果`,
      );

      // 如果未找到结果但索引有数据，表示标签不匹配
      if (results.length === 0 && searchResult.neighbors.length > 0) {
        console.error('向量数据库: 检测到标签不匹配！索引有向量但未找到匹配的文档。');
        console.error('向量数据库: 这通常表示索引和文档映射不同步。');
        console.error('向量数据库: 考虑重建索引来修复此问题。');

        // 提供一些诊断信息
        const sampleLabels = searchResult.neighbors.slice(0, 5);
        const availableLabels = Array.from(this.documents.keys()).slice(0, 5);
        console.error('向量数据库: 示例搜索标签:', sampleLabels);
        console.error('向量数据库: 示例可用标签:', availableLabels);
      }

      return results.sort((a, b) => b.similarity - a.similarity);
    } catch (error) {
      console.error('向量数据库: 搜索失败:', error);
      console.error('向量数据库: 查询嵌入信息:', {
        type: typeof queryEmbedding,
        constructor: queryEmbedding?.constructor?.name,
        length: queryEmbedding?.length,
        isFloat32Array: queryEmbedding instanceof Float32Array,
        firstFewValues: queryEmbedding ? Array.from(queryEmbedding.slice(0, 5)) : null,
      });
      throw error;
    }
  }

  /**
   * 移除标签页的所有文档
   */
  public async removeTabDocuments(tabId: number): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const documentLabels = this.tabDocuments.get(tabId);
    if (!documentLabels) {
      return;
    }

    try {
      // 从映射中移除文档（hnswlib-wasm 不支持直接删除，只能标记为已删除）
      for (const label of documentLabels) {
        this.documents.delete(label);
      }

      // 清理标签页映射
      this.tabDocuments.delete(tabId);

      // 保存更改
      await this.saveDocumentMappings();

      console.log(`向量数据库: 已移除标签页 ${tabId} 的 ${documentLabels.size} 个文档`);
    } catch (error) {
      console.error('向量数据库: 移除标签页文档失败:', error);
      throw error;
    }
  }

  /**
   * 获取数据库统计信息
   */
  public getStats(): {
    totalDocuments: number;
    totalTabs: number;
    indexSize: number;
    isInitialized: boolean;
  } {
    return {
      totalDocuments: this.documents.size,
      totalTabs: this.tabDocuments.size,
      indexSize: this.calculateStorageSize(),
      isInitialized: this.isInitialized,
    };
  }

  /**
   * 计算实际存储大小（字节）
   */
  private calculateStorageSize(): number {
    let totalSize = 0;

    try {
      // 1. 计算文档映射的大小
      const documentsSize = this.calculateDocumentMappingsSize();
      totalSize += documentsSize;

      // 2. 计算向量数据的大小
      const vectorsSize = this.calculateVectorsSize();
      totalSize += vectorsSize;

      // 3. 估算索引结构的大小
      const indexStructureSize = this.calculateIndexStructureSize();
      totalSize += indexStructureSize;

      console.log(
        `向量数据库: 存储大小分解 - 文档: ${documentsSize}，向量: ${vectorsSize}，索引: ${indexStructureSize}，总计: ${totalSize} 字节`,
      );
    } catch (error) {
      console.warn('向量数据库: 计算存储大小失败:', error);
      // 返回一个基于文档数量的估算值
      totalSize = this.documents.size * 1024; // 每个文档估算1KB
    }

    return totalSize;
  }

  /**
   * 计算文档映射大小
   */
  private calculateDocumentMappingsSize(): number {
    let size = 0;

    // 计算文档 Map 大小
    for (const [label, document] of this.documents.entries()) {
      // 标签（数字）：8 字节
      size += 8;

      // 文档对象
      size += this.calculateObjectSize(document);
    }

    // 计算 tabDocuments Map 大小
    for (const [tabId, labels] of this.tabDocuments.entries()) {
      // tabId（数字）：8 字节
      size += 8;

      // 标签集合：每个标签 8 字节 + Set 开销
      size += labels.size * 8 + 32; // 32 字节 Set 开销
    }

    return size;
  }

  /**
   * 计算向量数据大小
   */
  private calculateVectorsSize(): number {
    const documentCount = this.documents.size;
    const dimension = this.config.dimension;

    // 每个向量：维度 * 4 字节（Float32）
    const vectorSize = dimension * 4;

    return documentCount * vectorSize;
  }

  /**
   * 估算索引结构大小
   */
  private calculateIndexStructureSize(): number {
    const documentCount = this.documents.size;

    if (documentCount === 0) return 0;

    // HNSW 索引大小估算
    // 根据论文和实际测试，HNSW 索引大小约为向量数据的 20-40%
    const vectorsSize = this.calculateVectorsSize();
    const indexOverhead = Math.floor(vectorsSize * 0.3); // 30% 开销

    // 额外的图结构开销
    const graphOverhead = documentCount * 64; // 每个节点约 64 字节图结构开销

    return indexOverhead + graphOverhead;
  }

  /**
   * 计算对象大小（粗略估算）
   */
  private calculateObjectSize(obj: any): number {
    let size = 0;

    try {
      const jsonString = JSON.stringify(obj);
      // UTF-8 编码，大多数字符 1 字节，中文等 3 字节，平均 2 字节
      size = jsonString.length * 2;
    } catch (error) {
      // 如果 JSON 序列化失败，使用默认估算
      size = 512; // 默认 512 字节
    }

    return size;
  }

  /**
   * 清空整个数据库
   */
  public async clear(): Promise<void> {
    console.log('向量数据库: 开始完整数据库清理...');

    try {
      // 清理内存数据结构
      this.documents.clear();
      this.tabDocuments.clear();
      this.nextLabel = 0;

      // 清理 HNSW 索引文件（在 hnswlib-index 数据库中）
      if (this.isInitialized && this.index) {
        try {
          console.log('向量数据库: 正在从IndexedDB清理HNSW索引文件...');

          // 1. 首先尝试物理删除索引文件（使用 EmscriptenFileSystemManager）
          try {
            if (
              globalHnswlib &&
              globalHnswlib.EmscriptenFileSystemManager.checkFileExists(this.config.indexFileName)
            ) {
              console.log(`向量数据库: 正在删除物理索引文件: ${this.config.indexFileName}`);
              globalHnswlib.EmscriptenFileSystemManager.deleteFile(this.config.indexFileName);
              await this.syncFileSystem('write'); // 确保删除同步到持久存储
              console.log(`向量数据库: 物理索引文件 ${this.config.indexFileName} 删除成功`);
            } else {
              console.log(`向量数据库: 物理索引文件 ${this.config.indexFileName} 不存在或已删除`);
            }
          } catch (fileError) {
            console.warn(
              `向量数据库: 删除物理索引文件 ${this.config.indexFileName} 失败:`,
              fileError,
            );
            // 继续其他清理操作，不要阻塞进程
          }

          // 2. 从 IndexedDB 删除索引文件
          await this.index.deleteIndex(this.config.indexFileName);
          console.log('向量数据库: HNSW索引文件已从IndexedDB清除');

          // 3. 重新初始化空索引
          console.log('向量数据库: 重新初始化空HNSW索引...');
          this.index.initIndex(
            this.config.maxElements,
            this.config.M,
            this.config.efConstruction,
            200,
          );
          this.index.setEfSearch(this.config.efSearch);

          // 4. 强制保存空索引
          await this.forceSaveIndex();
        } catch (indexError) {
          console.warn('向量数据库: 清除HNSW索引文件失败:', indexError);
          // 继续其他清理操作
        }
      }

      // 从 IndexedDB 清理文档映射（在 VectorDatabaseStorage 数据库中）
      try {
        console.log('向量数据库: 正在从IndexedDB清理文档映射...');
        await IndexedDBHelper.deleteData(this.config.indexFileName);
        console.log('向量数据库: 文档映射已从IndexedDB清除');
      } catch (idbError) {
        console.warn('向量数据库: 从IndexedDB清除文档映射失败，尝试chrome.storage回退:', idbError);

        // 从 chrome.storage 清理备份数据
        try {
          const storageKey = `hnswlib_document_mappings_${this.config.indexFileName}`;
          await chrome.storage.local.remove([storageKey]);
          console.log('向量数据库: Chrome存储回退已清除');
        } catch (storageError) {
          console.warn('向量数据库: 清除chrome.storage回退失败:', storageError);
        }
      }

      // 保存空文档映射以确保一致性
      await this.saveDocumentMappings();

      console.log('向量数据库: 完整数据库清理成功完成');
    } catch (error) {
      console.error('向量数据库: 清除数据库失败:', error);
      throw error;
    }
  }

  /**
   * 强制保存索引并同步文件系统
   */
  private async forceSaveIndex(): Promise<void> {
    try {
      await this.index.writeIndex(this.config.indexFileName);
      await this.syncFileSystem('write'); // 强制同步
    } catch (error) {
      console.error('向量数据库: 强制保存索引失败:', error);
    }
  }

  /**
   * 检查并执行自动清理
   */
  private async checkAndPerformAutoCleanup(): Promise<void> {
    try {
      const currentCount = this.documents.size;
      const maxElements = this.config.maxElements;

      console.log(`向量数据库: 自动清理检查 - 当前: ${currentCount}，最大: ${maxElements}`);

      // 检查是否超过最大元素数量
      if (currentCount >= maxElements) {
        console.log('向量数据库: 文档数量达到限制，执行清理...');
        await this.performLRUCleanup(Math.floor(maxElements * 0.2)); // 清理 20% 的数据
      }

      // 检查是否有过期数据
      if (this.config.maxRetentionDays && this.config.maxRetentionDays > 0) {
        await this.performTimeBasedCleanup();
      }
    } catch (error) {
      console.error('向量数据库: 自动清理失败:', error);
    }
  }

  /**
   * 执行基于 LRU 的清理（删除最旧文档）
   */
  private async performLRUCleanup(cleanupCount: number): Promise<void> {
    try {
      console.log(`向量数据库: 开始LRU清理，移除 ${cleanupCount} 个最旧文档`);

      // 获取所有文档并按时间戳排序
      const allDocuments = Array.from(this.documents.entries());
      allDocuments.sort((a, b) => a[1].timestamp - b[1].timestamp);

      // 选择要删除的文档
      const documentsToDelete = allDocuments.slice(0, cleanupCount);

      for (const [label, _document] of documentsToDelete) {
        await this.removeDocumentByLabel(label);
      }

      // 保存更新的索引和映射
      await this.saveIndex();
      await this.saveDocumentMappings();

      console.log(`向量数据库: LRU清理完成，移除了 ${documentsToDelete.length} 个文档`);
    } catch (error) {
      console.error('向量数据库: LRU清理失败:', error);
    }
  }

  /**
   * 执行基于时间的清理（删除过期文档）
   */
  private async performTimeBasedCleanup(): Promise<void> {
    try {
      const maxRetentionMs = this.config.maxRetentionDays! * 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - maxRetentionMs;

      console.log(
        `向量数据库: 开始基于时间的清理，移除超过 ${this.config.maxRetentionDays} 天的文档`,
      );

      const documentsToDelete: number[] = [];

      for (const [label, document] of this.documents.entries()) {
        if (document.timestamp < cutoffTime) {
          documentsToDelete.push(label);
        }
      }

      for (const label of documentsToDelete) {
        await this.removeDocumentByLabel(label);
      }

      // 保存更新的索引和映射
      if (documentsToDelete.length > 0) {
        await this.saveIndex();
        await this.saveDocumentMappings();
      }

      console.log(`向量数据库: 基于时间的清理完成，移除了 ${documentsToDelete.length} 个过期文档`);
    } catch (error) {
      console.error('向量数据库: 基于时间的清理失败:', error);
    }
  }

  /**
   * 根据标签移除单个文档
   */
  private async removeDocumentByLabel(label: number): Promise<void> {
    try {
      const document = this.documents.get(label);
      if (!document) {
        console.warn(`向量数据库: 未找到标签为 ${label} 的文档`);
        return;
      }

      // 从 HNSW 索引中移除向量
      if (this.index) {
        try {
          this.index.markDelete(label);
        } catch (indexError) {
          console.warn(`向量数据库: 在索引中标记删除标签 ${label} 失败:`, indexError);
        }
      }

      // 从内存映射中移除
      this.documents.delete(label);

      // 从标签页映射中移除
      const tabId = document.tabId;
      if (this.tabDocuments.has(tabId)) {
        this.tabDocuments.get(tabId)!.delete(label);
        // 如果标签页没有其他文档，删除整个标签页映射
        if (this.tabDocuments.get(tabId)!.size === 0) {
          this.tabDocuments.delete(tabId);
        }
      }

      console.log(`向量数据库: 已从标签页 ${tabId} 移除标签为 ${label} 的文档`);
    } catch (error) {
      console.error(`向量数据库: 移除标签为 ${label} 的文档失败:`, error);
    }
  }

  // 私有辅助方法

  private generateDocumentId(tabId: number, chunkIndex: number): string {
    return `tab_${tabId}_chunk_${chunkIndex}_${Date.now()}`;
  }

  private findDocumentByLabel(label: number): VectorDocument | null {
    return this.documents.get(label) || null;
  }

  private async syncFileSystem(direction: 'read' | 'write'): Promise<void> {
    try {
      if (!globalHnswlib) {
        return;
      }

      // 如果同步操作已在进行中，等待其完成
      if (syncInProgress && pendingSyncPromise) {
        console.log(`向量数据库: 同步已在进行中，等待...`);
        await pendingSyncPromise;
        return;
      }

      // 标记同步开始
      syncInProgress = true;

      // 创建带有超时机制的同步 Promise
      pendingSyncPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.warn(`向量数据库: 文件系统同步 (${direction}) 超时`);
          syncInProgress = false;
          pendingSyncPromise = null;
          reject(new Error('同步超时'));
        }, 5000); // 5 秒超时

        try {
          globalHnswlib.EmscriptenFileSystemManager.syncFS(direction === 'read', () => {
            clearTimeout(timeout);
            console.log(`向量数据库: 文件系统同步 (${direction}) 完成`);
            syncInProgress = false;
            pendingSyncPromise = null;
            resolve();
          });
        } catch (error) {
          clearTimeout(timeout);
          console.warn(`向量数据库: 文件系统同步 (${direction}) 失败:`, error);
          syncInProgress = false;
          pendingSyncPromise = null;
          reject(error);
        }
      });

      await pendingSyncPromise;
    } catch (error) {
      console.warn(`向量数据库: 文件系统同步 (${direction}) 失败:`, error);
      syncInProgress = false;
      pendingSyncPromise = null;
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      await this.index.writeIndex(this.config.indexFileName);
      // 减少同步频率，只在必要时同步
      if (this.documents.size % 10 === 0) {
        // 每 10 个文档同步一次
        await this.syncFileSystem('write');
      }
    } catch (error) {
      console.error('向量数据库: 保存索引失败:', error);
    }
  }

  private async saveDocumentMappings(): Promise<void> {
    try {
      // 将文档映射保存到 IndexedDB
      const mappingData = {
        documents: Array.from(this.documents.entries()),
        tabDocuments: Array.from(this.tabDocuments.entries()).map(([tabId, labels]) => [
          tabId,
          Array.from(labels),
        ]),
        nextLabel: this.nextLabel,
      };

      try {
        // 使用 IndexedDB 保存数据，支持更大的存储容量
        await IndexedDBHelper.saveData(this.config.indexFileName, mappingData);
        console.log('向量数据库: 文档映射已保存到IndexedDB');
      } catch (idbError) {
        console.warn('向量数据库: 保存到IndexedDB失败，回退到chrome.storage:', idbError);

        // 回退到 chrome.storage.local
        try {
          const storageKey = `hnswlib_document_mappings_${this.config.indexFileName}`;
          await chrome.storage.local.set({ [storageKey]: mappingData });
          console.log('向量数据库: 文档映射已保存到chrome.storage.local（回退）');
        } catch (storageError) {
          console.error('向量数据库: 保存到IndexedDB和chrome.storage都失败:', storageError);
        }
      }
    } catch (error) {
      console.error('向量数据库: 保存文档映射失败:', error);
    }
  }

  public async loadDocumentMappings(): Promise<void> {
    try {
      // 从 IndexedDB 加载文档映射
      if (!globalHnswlib) {
        return;
      }

      let mappingData = null;

      try {
        // 首先尝试从 IndexedDB 读取
        mappingData = await IndexedDBHelper.loadData(this.config.indexFileName);
        if (mappingData) {
          console.log(`向量数据库: 已从IndexedDB加载文档映射`);
        }
      } catch (idbError) {
        console.warn('向量数据库: 从IndexedDB读取失败，尝试chrome.storage:', idbError);
      }

      // 如果 IndexedDB 没有数据，尝试从 chrome.storage.local 读取（向后兼容）
      if (!mappingData) {
        try {
          const storageKey = `hnswlib_document_mappings_${this.config.indexFileName}`;
          const result = await chrome.storage.local.get([storageKey]);
          mappingData = result[storageKey];
          if (mappingData) {
            console.log(`向量数据库: 已从chrome.storage.local加载文档映射（回退）`);

            // 迁移到 IndexedDB
            try {
              await IndexedDBHelper.saveData(this.config.indexFileName, mappingData);
              console.log('向量数据库: 已将数据从chrome.storage迁移到IndexedDB');
            } catch (migrationError) {
              console.warn('向量数据库: 迁移数据到IndexedDB失败:', migrationError);
            }
          }
        } catch (storageError) {
          console.warn('向量数据库: 从chrome.storage.local读取失败:', storageError);
        }
      }

      if (mappingData) {
        // 恢复文档映射
        this.documents.clear();
        for (const [label, doc] of mappingData.documents) {
          this.documents.set(label, doc);
        }

        // 恢复标签页映射
        this.tabDocuments.clear();
        for (const [tabId, labels] of mappingData.tabDocuments) {
          this.tabDocuments.set(tabId, new Set(labels));
        }

        // 恢复 nextLabel - 使用保存的值或计算最大标签 + 1
        if (mappingData.nextLabel !== undefined) {
          this.nextLabel = mappingData.nextLabel;
        } else if (this.documents.size > 0) {
          // 如果没有保存的 nextLabel，计算最大标签 + 1
          const maxLabel = Math.max(...Array.from(this.documents.keys()));
          this.nextLabel = maxLabel + 1;
        } else {
          this.nextLabel = 0;
        }

        console.log(
          `向量数据库: 已加载 ${this.documents.size} 个文档映射，下一个标签: ${this.nextLabel}`,
        );
      } else {
        console.log('向量数据库: 未找到现有文档映射');
      }
    } catch (error) {
      console.error('向量数据库: 加载文档映射失败:', error);
    }
  }
}

// 全局 VectorDatabase 单例
let globalVectorDatabase: VectorDatabase | null = null;
let currentDimension: number | null = null;

/**
 * 获取全局 VectorDatabase 单例实例
 * 如果维度发生变化，将重新创建实例以确保兼容性
 */
export async function getGlobalVectorDatabase(
  config?: Partial<VectorDatabaseConfig>,
): Promise<VectorDatabase> {
  const newDimension = config?.dimension || 384;

  // 如果维度发生变化，需要重新创建向量数据库
  if (globalVectorDatabase && currentDimension !== null && currentDimension !== newDimension) {
    console.log(`向量数据库: 维度从 ${currentDimension} 更改为 ${newDimension}，重新创建实例`);

    // 清理旧实例 - 这将清理索引文件和文档映射
    try {
      await globalVectorDatabase.clear();
      console.log('向量数据库: 成功清理旧实例以进行维度更改');
    } catch (error) {
      console.warn('向量数据库: 清理期间出错:', error);
    }

    globalVectorDatabase = null;
    currentDimension = null;
  }

  if (!globalVectorDatabase) {
    globalVectorDatabase = new VectorDatabase(config);
    currentDimension = newDimension;
    console.log(`向量数据库: 已创建维度为 ${currentDimension} 的全局单例实例`);
  }

  return globalVectorDatabase;
}

/**
 * 获取全局 VectorDatabase 实例的同步版本（用于向后兼容）
 * 注意：如果需要维度变化，建议使用异步版本
 */
export function getGlobalVectorDatabaseSync(
  config?: Partial<VectorDatabaseConfig>,
): VectorDatabase {
  const newDimension = config?.dimension || 384;

  // 如果维度发生变化，记录警告但不清理（避免竞争条件）
  if (globalVectorDatabase && currentDimension !== null && currentDimension !== newDimension) {
    console.warn(
      `向量数据库: 检测到维度不匹配 (${currentDimension} vs ${newDimension})。考虑使用异步版本进行适当清理。`,
    );
  }

  if (!globalVectorDatabase) {
    globalVectorDatabase = new VectorDatabase(config);
    currentDimension = newDimension;
    console.log(`向量数据库: 已创建维度为 ${currentDimension} 的全局单例实例`);
  }

  return globalVectorDatabase;
}

/**
 * 重置全局 VectorDatabase 实例（主要用于测试或模型切换）
 */
export async function resetGlobalVectorDatabase(): Promise<void> {
  console.log('向量数据库: 开始全局实例重置...');

  if (globalVectorDatabase) {
    try {
      console.log('向量数据库: 正在清理现有全局实例...');
      await globalVectorDatabase.clear();
      console.log('向量数据库: 全局实例清理成功');
    } catch (error) {
      console.warn('向量数据库: 重置期间清理失败:', error);
    }
  }

  // 额外清理：确保清除所有可能的 IndexedDB 数据
  try {
    console.log('向量数据库: 执行全面的IndexedDB清理...');

    // 清除 VectorDatabaseStorage 数据库中的所有数据
    await IndexedDBHelper.clearAllData();

    // 从 hnswlib-index 数据库清除索引文件
    try {
      console.log('向量数据库: 正在从IndexedDB清理HNSW索引文件...');

      // 尝试清理可能存在的索引文件
      const possibleIndexFiles = ['tab_content_index.dat', 'content_index.dat', 'vector_index.dat'];

      // 如果全局 hnswlib 实例存在，尝试删除已知的索引文件
      if (typeof globalHnswlib !== 'undefined' && globalHnswlib) {
        for (const fileName of possibleIndexFiles) {
          try {
            // 1. 首先尝试物理删除索引文件（使用 EmscriptenFileSystemManager）
            try {
              if (globalHnswlib.EmscriptenFileSystemManager.checkFileExists(fileName)) {
                console.log(`向量数据库: 正在删除物理索引文件: ${fileName}`);
                globalHnswlib.EmscriptenFileSystemManager.deleteFile(fileName);
                console.log(`向量数据库: 物理索引文件 ${fileName} 删除成功`);
              }
            } catch (fileError) {
              console.log(`向量数据库: 物理索引文件 ${fileName} 未找到或删除失败:`, fileError);
            }

            // 2. 从 IndexedDB 删除索引文件
            const tempIndex = new globalHnswlib.HierarchicalNSW('cosine', 384);
            await tempIndex.deleteIndex(fileName);
            console.log(`向量数据库: 已删除IndexedDB索引文件: ${fileName}`);
          } catch (deleteError) {
            // 文件可能不存在，这是正常的
            console.log(`向量数据库: 索引文件 ${fileName} 未找到或已删除`);
          }
        }

        // 3. 强制同步文件系统以确保删除生效
        try {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              console.warn('向量数据库: 清理期间文件系统同步超时');
              resolve(); // 不要阻塞进程
            }, 3000);

            globalHnswlib.EmscriptenFileSystemManager.syncFS(false, () => {
              clearTimeout(timeout);
              console.log('向量数据库: 清理期间文件系统同步完成');
              resolve();
            });
          });
        } catch (syncError) {
          console.warn('向量数据库: 清理期间文件系统同步失败:', syncError);
        }
      }
    } catch (hnswError) {
      console.warn('向量数据库: 清理HNSW索引文件失败:', hnswError);
    }

    // 清除可能的 chrome.storage 备份数据（只清除向量数据库相关数据，保留用户首选项）
    const possibleKeys = [
      'hnswlib_document_mappings_tab_content_index.dat',
      'hnswlib_document_mappings_content_index.dat',
      'hnswlib_document_mappings_vector_index.dat',
      // 注意：不要清除 selectedModel 和 selectedVersion，这些是用户首选项设置
      // 注意：不要清除 modelState，这包含模型状态信息，应由模型管理逻辑处理
    ];

    if (possibleKeys.length > 0) {
      try {
        await chrome.storage.local.remove(possibleKeys);
        console.log('向量数据库: Chrome存储备份数据已清除');
      } catch (storageError) {
        console.warn('向量数据库: 清除chrome.storage备份失败:', storageError);
      }
    }

    console.log('向量数据库: 全面清理完成');
  } catch (cleanupError) {
    console.warn('向量数据库: 全面清理失败:', cleanupError);
  }

  globalVectorDatabase = null;
  currentDimension = null;
  console.log('向量数据库: 全局单例实例重置完成');
}

/**
 * 专门用于模型切换时的数据清理
 * 清除所有 IndexedDB 数据，包括 HNSW 索引文件和文档映射
 */
export async function clearAllVectorData(): Promise<void> {
  console.log('向量数据库: 开始为模型切换进行全面向量数据清理...');

  try {
    // 1. 清理全局实例
    if (globalVectorDatabase) {
      try {
        await globalVectorDatabase.clear();
      } catch (error) {
        console.warn('向量数据库: 清理全局实例失败:', error);
      }
    }

    // 2. 清理 VectorDatabaseStorage 数据库
    try {
      console.log('向量数据库: 正在清理VectorDatabaseStorage数据库...');
      await IndexedDBHelper.clearAllData();
    } catch (error) {
      console.warn('向量数据库: 清理VectorDatabaseStorage失败:', error);
    }

    // 3. 清理 hnswlib-index 数据库和物理文件
    try {
      console.log('向量数据库: 正在清理hnswlib-index数据库和物理文件...');

      // 3.1 首先尝试物理删除索引文件（使用 EmscriptenFileSystemManager）
      if (typeof globalHnswlib !== 'undefined' && globalHnswlib) {
        const possibleIndexFiles = [
          'tab_content_index.dat',
          'content_index.dat',
          'vector_index.dat',
        ];

        for (const fileName of possibleIndexFiles) {
          try {
            if (globalHnswlib.EmscriptenFileSystemManager.checkFileExists(fileName)) {
              console.log(`向量数据库: 正在删除物理索引文件: ${fileName}`);
              globalHnswlib.EmscriptenFileSystemManager.deleteFile(fileName);
              console.log(`向量数据库: 物理索引文件 ${fileName} 删除成功`);
            }
          } catch (fileError) {
            console.log(`向量数据库: 物理索引文件 ${fileName} 未找到或删除失败:`, fileError);
          }
        }

        // 强制同步文件系统
        try {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              console.warn('向量数据库: 模型切换清理期间文件系统同步超时');
              resolve();
            }, 3000);

            globalHnswlib.EmscriptenFileSystemManager.syncFS(false, () => {
              clearTimeout(timeout);
              console.log('向量数据库: 模型切换清理期间文件系统同步完成');
              resolve();
            });
          });
        } catch (syncError) {
          console.warn('向量数据库: 模型切换清理期间文件系统同步失败:', syncError);
        }
      }

      // 3.2 删除整个 hnswlib-index 数据库
      await new Promise<void>((resolve) => {
        const deleteRequest = indexedDB.deleteDatabase('/hnswlib-index');
        deleteRequest.onsuccess = () => {
          console.log('向量数据库: 成功删除/hnswlib-index数据库');
          resolve();
        };
        deleteRequest.onerror = () => {
          console.warn('向量数据库: 删除/hnswlib-index数据库失败:', deleteRequest.error);
          resolve(); // 不要阻塞进程
        };
        deleteRequest.onblocked = () => {
          console.warn('向量数据库: /hnswlib-index数据库删除被阻塞');
          resolve(); // 不要阻塞进程
        };
      });
    } catch (error) {
      console.warn('向量数据库: 清理hnswlib-index数据库和物理文件失败:', error);
    }

    // 4. 从 chrome.storage 清除备份数据
    try {
      const storageKeys = [
        'hnswlib_document_mappings_tab_content_index.dat',
        'hnswlib_document_mappings_content_index.dat',
        'hnswlib_document_mappings_vector_index.dat',
      ];
      await chrome.storage.local.remove(storageKeys);
      console.log('向量数据库: Chrome存储备份数据已清除');
    } catch (error) {
      console.warn('向量数据库: 清除chrome.storage备份失败:', error);
    }

    // 5. 重置全局状态
    globalVectorDatabase = null;
    currentDimension = null;

    console.log('向量数据库: 全面向量数据清理成功完成');
  } catch (error) {
    console.error('向量数据库: 全面向量数据清理失败:', error);
    throw error;
  }
}
