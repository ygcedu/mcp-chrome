import { AutoTokenizer, env as TransformersEnv } from '@xenova/transformers';
import type { Tensor as TransformersTensor, PreTrainedTokenizer } from '@xenova/transformers';
import LRUCache from './lru-cache';
import { SIMDMathEngine } from './simd-math-engine';
import { OffscreenManager } from './offscreen-manager';
import { STORAGE_KEYS } from '@/common/constants';
import { OFFSCREEN_MESSAGE_TYPES } from '@/common/message-types';

import { ModelCacheManager } from './model-cache-manager';

/**
 * 获取缓存的模型数据，优先读取缓存并处理重定向 URL。
 * @param {string} modelUrl 模型的稳定、永久 URL
 * @returns {Promise<ArrayBuffer>} 作为 ArrayBuffer 的模型数据
 */
async function getCachedModelData(modelUrl: string): Promise<ArrayBuffer> {
  const cacheManager = ModelCacheManager.getInstance();

  // 1. 尝试从缓存获取数据
  const cachedData = await cacheManager.getCachedModelData(modelUrl);
  if (cachedData) {
    return cachedData;
  }

  console.log('模型在缓存中未找到或已过期。从网络获取...');

  try {
    // 2. 从网络获取数据
    const response = await fetch(modelUrl);

    if (!response.ok) {
      throw new Error(`获取模型失败: ${response.status} ${response.statusText}`);
    }

    // 3. 获取数据并存储到缓存
    const arrayBuffer = await response.arrayBuffer();
    await cacheManager.storeModelData(modelUrl, arrayBuffer);

    console.log(
      `模型已从网络获取并成功缓存 (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB)。`,
    );

    return arrayBuffer;
  } catch (error) {
    console.error(`获取或缓存模型时出错:`, error);
    // 如果获取失败，清理可能不完整的缓存条目
    await cacheManager.deleteCacheEntry(modelUrl);
    throw error;
  }
}

/**
 * 清除所有模型缓存条目
 */
export async function clearModelCache(): Promise<void> {
  try {
    const cacheManager = ModelCacheManager.getInstance();
    await cacheManager.clearAllCache();
  } catch (error) {
    console.error('清除模型缓存失败:', error);
    throw error;
  }
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<{
  totalSize: number;
  totalSizeMB: number;
  entryCount: number;
  entries: Array<{
    url: string;
    size: number;
    sizeMB: number;
    timestamp: number;
    age: string;
    expired: boolean;
  }>;
}> {
  try {
    const cacheManager = ModelCacheManager.getInstance();
    return await cacheManager.getCacheStats();
  } catch (error) {
    console.error('获取缓存统计信息失败:', error);
    throw error;
  }
}

/**
 * 手动触发缓存清理
 */
export async function cleanupModelCache(): Promise<void> {
  try {
    const cacheManager = ModelCacheManager.getInstance();
    await cacheManager.manualCleanup();
  } catch (error) {
    console.error('清理缓存失败:', error);
    throw error;
  }
}

/**
 * 检查默认模型是否已缓存并可用
 * @returns Promise<boolean> 如果默认模型已缓存并有效则为 true
 */
export async function isDefaultModelCached(): Promise<boolean> {
  try {
    // 获取默认模型配置
    const result = await chrome.storage.local.get([STORAGE_KEYS.SEMANTIC_MODEL]);
    const defaultModel =
      (result[STORAGE_KEYS.SEMANTIC_MODEL] as ModelPreset) || 'multilingual-e5-small';

    // 构建模型 URL
    const modelInfo = PREDEFINED_MODELS[defaultModel];
    const modelIdentifier = modelInfo.modelIdentifier;
    const onnxModelFile = 'model.onnx'; // 默认 ONNX 文件名

    const modelIdParts = modelIdentifier.split('/');
    const modelNameForUrl = modelIdParts.length > 1 ? modelIdentifier : `Xenova/${modelIdentifier}`;
    const onnxModelUrl = `https://huggingface.co/${modelNameForUrl}/resolve/main/onnx/${onnxModelFile}`;

    // 检查此模型是否已缓存
    const cacheManager = ModelCacheManager.getInstance();
    return await cacheManager.isModelCached(onnxModelUrl);
  } catch (error) {
    console.error('检查默认模型是否已缓存时出错:', error);
    return false;
  }
}

/**
 * 检查是否存在任何模型缓存（用于条件初始化）
 * @returns Promise<boolean> 如果存在任何有效的模型缓存则为 true
 */
export async function hasAnyModelCache(): Promise<boolean> {
  try {
    const cacheManager = ModelCacheManager.getInstance();
    return await cacheManager.hasAnyValidCache();
  } catch (error) {
    console.error('检查任何模型缓存时出错:', error);
    return false;
  }
}

// 预定义模型配置 - 2025 年精选推荐模型，使用量化版本以减小文件大小
export const PREDEFINED_MODELS = {
  // 多语言模型 - 默认推荐
  'multilingual-e5-small': {
    modelIdentifier: 'Xenova/multilingual-e5-small',
    dimension: 384,
    description: 'Multilingual E5 Small - Lightweight multilingual model supporting 100+ languages',
    language: 'multilingual',
    performance: 'excellent',
    size: '116MB', // Quantized version
    latency: '20ms',
    multilingualFeatures: {
      languageSupport: '100+',
      crossLanguageRetrieval: 'good',
      chineseEnglishMixed: 'good',
    },
    modelSpecificConfig: {
      requiresTokenTypeIds: false, // E5 model doesn't require token_type_ids
    },
  },
  'multilingual-e5-base': {
    modelIdentifier: 'Xenova/multilingual-e5-base',
    dimension: 768,
    description: 'Multilingual E5 base - Medium-scale multilingual model supporting 100+ languages',
    language: 'multilingual',
    performance: 'excellent',
    size: '279MB', // Quantized version
    latency: '30ms',
    multilingualFeatures: {
      languageSupport: '100+',
      crossLanguageRetrieval: 'excellent',
      chineseEnglishMixed: 'excellent',
    },
    modelSpecificConfig: {
      requiresTokenTypeIds: false, // E5 model doesn't require token_type_ids
    },
  },
} as const;

export type ModelPreset = keyof typeof PREDEFINED_MODELS;

/**
 * Get model information
 */
export function getModelInfo(preset: ModelPreset) {
  return PREDEFINED_MODELS[preset];
}

/**
 * List all available models
 */
export function listAvailableModels() {
  return Object.entries(PREDEFINED_MODELS).map(([key, value]) => ({
    preset: key as ModelPreset,
    ...value,
  }));
}

/**
 * Recommend model based on language - only uses multilingual-e5 series models
 */
export function recommendModelForLanguage(
  _language: 'en' | 'zh' | 'multilingual' = 'multilingual',
  scenario: 'speed' | 'balanced' | 'quality' = 'balanced',
): ModelPreset {
  // All languages use multilingual models
  if (scenario === 'quality') {
    return 'multilingual-e5-base'; // High quality choice
  }
  return 'multilingual-e5-small'; // Default lightweight choice
}

/**
 * Intelligently recommend model based on device performance and usage scenario - only uses multilingual-e5 series models
 */
export function recommendModelForDevice(
  _language: 'en' | 'zh' | 'multilingual' = 'multilingual',
  deviceMemory: number = 4, // GB
  networkSpeed: 'slow' | 'fast' = 'fast',
  prioritizeSpeed: boolean = false,
): ModelPreset {
  // Low memory devices or slow network, prioritize small models
  if (deviceMemory < 4 || networkSpeed === 'slow' || prioritizeSpeed) {
    return 'multilingual-e5-small'; // Lightweight choice
  }

  // High performance devices can use better models
  if (deviceMemory >= 8 && !prioritizeSpeed) {
    return 'multilingual-e5-base'; // High performance choice
  }

  // Default balanced choice
  return 'multilingual-e5-small';
}

/**
 * Get model size information (only supports quantized version)
 */
export function getModelSizeInfo(
  preset: ModelPreset,
  _version: 'full' | 'quantized' | 'compressed' = 'quantized',
) {
  const model = PREDEFINED_MODELS[preset];

  return {
    size: model.size,
    recommended: 'quantized',
    description: `${model.description} (Size: ${model.size})`,
  };
}

/**
 * Compare performance and size of multiple models
 */
export function compareModels(presets: ModelPreset[]) {
  return presets.map((preset) => {
    const model = PREDEFINED_MODELS[preset];

    return {
      preset,
      name: model.description.split(' - ')[0],
      language: model.language,
      performance: model.performance,
      dimension: model.dimension,
      latency: model.latency,
      size: model.size,
      features: (model as any).multilingualFeatures || {},
      maxLength: (model as any).maxLength || 512,
      recommendedFor: getRecommendationContext(preset),
    };
  });
}

/**
 * Get recommended use cases for model
 */
function getRecommendationContext(preset: ModelPreset): string[] {
  const contexts: string[] = [];
  const model = PREDEFINED_MODELS[preset];

  // All models are multilingual
  contexts.push('Multilingual document processing');

  if (model.performance === 'excellent') contexts.push('High accuracy requirements');
  if (model.latency.includes('20ms')) contexts.push('Fast response');

  // Add scenarios based on model size
  const sizeInMB = parseInt(model.size.replace('MB', ''));
  if (sizeInMB < 300) {
    contexts.push('Mobile devices');
    contexts.push('Lightweight deployment');
  }

  if (preset === 'multilingual-e5-small') {
    contexts.push('Lightweight deployment');
  } else if (preset === 'multilingual-e5-base') {
    contexts.push('High accuracy requirements');
  }

  return contexts;
}

/**
 * Get ONNX model filename (only supports quantized version)
 */
export function getOnnxFileNameForVersion(
  _version: 'full' | 'quantized' | 'compressed' = 'quantized',
): string {
  // Only return quantized version filename
  return 'model_quantized.onnx';
}

/**
 * Get model identifier (only supports quantized version)
 */
export function getModelIdentifierWithVersion(
  preset: ModelPreset,
  _version: 'full' | 'quantized' | 'compressed' = 'quantized',
): string {
  const model = PREDEFINED_MODELS[preset];
  return model.modelIdentifier;
}

/**
 * Get size comparison of all available models
 */
export function getAllModelSizes() {
  const models = Object.entries(PREDEFINED_MODELS).map(([preset, config]) => {
    return {
      preset: preset as ModelPreset,
      name: config.description.split(' - ')[0],
      language: config.language,
      size: config.size,
      performance: config.performance,
      latency: config.latency,
    };
  });

  // Sort by size
  return models.sort((a, b) => {
    const sizeA = parseInt(a.size.replace('MB', ''));
    const sizeB = parseInt(b.size.replace('MB', ''));
    return sizeA - sizeB;
  });
}

// Define necessary types
interface ModelConfig {
  modelIdentifier: string;
  localModelPathPrefix?: string; // Base path for local models (relative to public)
  onnxModelFile?: string; // ONNX model filename
  maxLength?: number;
  cacheSize?: number;
  numThreads?: number;
  executionProviders?: string[];
  useLocalFiles?: boolean;
  workerPath?: string; // Worker script path (relative to extension root)
  concurrentLimit?: number; // Worker task concurrency limit
  forceOffscreen?: boolean; // Force offscreen mode (for testing)
  modelPreset?: ModelPreset; // Predefined model selection
  dimension?: number; // Vector dimension (auto-obtained from preset model)
  modelVersion?: 'full' | 'quantized' | 'compressed'; // Model version selection
  requiresTokenTypeIds?: boolean; // Whether model requires token_type_ids input
}

interface WorkerMessagePayload {
  modelPath?: string;
  modelData?: ArrayBuffer;
  numThreads?: number;
  executionProviders?: string[];
  input_ids?: number[];
  attention_mask?: number[];
  token_type_ids?: number[];
  dims?: {
    input_ids: number[];
    attention_mask: number[];
    token_type_ids?: number[];
  };
}

interface WorkerResponsePayload {
  data?: Float32Array | number[]; // Tensor data as Float32Array or number array
  dims?: number[]; // Tensor dimensions
  message?: string; // For error or status messages
}

interface WorkerStats {
  inferenceTime?: number;
  totalInferences?: number;
  averageInferenceTime?: number;
  memoryAllocations?: number;
  batchSize?: number;
}

// Memory pool manager
class EmbeddingMemoryPool {
  private pools: Map<number, Float32Array[]> = new Map();
  private maxPoolSize: number = 10;
  private stats = { allocated: 0, reused: 0, released: 0 };

  getEmbedding(size: number): Float32Array {
    const pool = this.pools.get(size);
    if (pool && pool.length > 0) {
      this.stats.reused++;
      return pool.pop()!;
    }

    this.stats.allocated++;
    return new Float32Array(size);
  }

  releaseEmbedding(embedding: Float32Array): void {
    const size = embedding.length;
    if (!this.pools.has(size)) {
      this.pools.set(size, []);
    }

    const pool = this.pools.get(size)!;
    if (pool.length < this.maxPoolSize) {
      // Clear array for reuse
      embedding.fill(0);
      pool.push(embedding);
      this.stats.released++;
    }
  }

  getStats() {
    return { ...this.stats };
  }

  clear(): void {
    this.pools.clear();
    this.stats = { allocated: 0, reused: 0, released: 0 };
  }
}

interface PendingMessage {
  resolve: (value: WorkerResponsePayload | PromiseLike<WorkerResponsePayload>) => void;
  reject: (reason?: any) => void;
  type: string;
}

interface TokenizedOutput {
  // Simulates part of transformers.js tokenizer output
  input_ids: TransformersTensor;
  attention_mask: TransformersTensor;
  token_type_ids?: TransformersTensor;
}

/**
 * SemanticSimilarityEngine proxy class
 * Used by ContentIndexer and other components to reuse engine instance in offscreen, avoiding duplicate model downloads
 */
export class SemanticSimilarityEngineProxy {
  private _isInitialized = false;
  private config: Partial<ModelConfig>;
  private offscreenManager: OffscreenManager;
  private _isEnsuring = false; // Flag to prevent concurrent ensureOffscreenEngineInitialized calls

  constructor(config: Partial<ModelConfig> = {}) {
    this.config = config;
    this.offscreenManager = OffscreenManager.getInstance();
    console.log('语义相似度引擎代理: 代理已创建，配置:', {
      modelPreset: config.modelPreset,
      modelVersion: config.modelVersion,
      dimension: config.dimension,
    });
  }

  async initialize(): Promise<void> {
    try {
      console.log('语义相似度引擎代理: 开始代理初始化...');

      // Ensure offscreen document exists
      console.log('语义相似度引擎代理: 确保离屏文档存在...');
      await this.offscreenManager.ensureOffscreenDocument();
      console.log('语义相似度引擎代理: 离屏文档就绪');

      // Ensure engine in offscreen is initialized
      console.log('语义相似度引擎代理: 确保离屏引擎已初始化...');
      await this.ensureOffscreenEngineInitialized();

      this._isInitialized = true;
      console.log('语义相似度引擎代理: 代理已初始化，委托给离屏引擎');
    } catch (error) {
      console.error('语义相似度引擎代理: 初始化失败:', error);
      throw new Error(`初始化代理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * Check engine status in offscreen
   */
  private async checkOffscreenEngineStatus(): Promise<{
    isInitialized: boolean;
    currentConfig: any;
  }> {
    try {
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_STATUS,
      });

      if (response && response.success) {
        return {
          isInitialized: response.isInitialized || false,
          currentConfig: response.currentConfig || null,
        };
      }
    } catch (error) {
      console.warn('语义相似度引擎代理: 检查引擎状态失败:', error);
    }

    return { isInitialized: false, currentConfig: null };
  }

  /**
   * Ensure engine in offscreen is initialized (with concurrency protection)
   */
  private async ensureOffscreenEngineInitialized(): Promise<void> {
    // Prevent concurrent initialization attempts
    if (this._isEnsuring) {
      console.log('语义相似度引擎代理: 已在确保初始化，等待中...');
      // Wait a bit and check again
      await new Promise((resolve) => setTimeout(resolve, 100));
      return;
    }

    try {
      this._isEnsuring = true;
      const status = await this.checkOffscreenEngineStatus();

      if (!status.isInitialized) {
        console.log('语义相似度引擎代理: 离屏中的引擎未初始化，正在初始化...');

        // Reinitialize engine
        const response = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_INIT,
          config: this.config,
        });

        if (!response || !response.success) {
          throw new Error(response?.error || '在离屏文档中初始化引擎失败');
        }

        console.log('语义相似度引擎代理: 引擎重新初始化成功');
      }
    } finally {
      this._isEnsuring = false;
    }
  }

  /**
   * Send message to offscreen document with retry mechanism and auto-reinitialization
   */
  private async sendMessageToOffscreen(message: any, maxRetries: number = 3): Promise<any> {
    // 确保offscreen document存在
    await this.offscreenManager.ensureOffscreenDocument();

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`语义相似度引擎代理: 发送消息 (尝试 ${attempt}/${maxRetries}):`, message.type);

        const response = await chrome.runtime.sendMessage(message);

        if (!response) {
          throw new Error('No response received from offscreen document');
        }

        // If engine 未初始化 error received, try to reinitialize
        if (!response.success && response.error && response.error.includes('未初始化')) {
          console.log('语义相似度引擎代理: 引擎未初始化，尝试重新初始化...');
          await this.ensureOffscreenEngineInitialized();

          // Resend original message
          const retryResponse = await chrome.runtime.sendMessage(message);
          if (retryResponse && retryResponse.success) {
            return retryResponse;
          }
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        console.warn(`语义相似度引擎代理: 消息失败 (尝试 ${attempt}/${maxRetries}):`, error);

        // If engine 未初始化 error, try to reinitialize
        if (error instanceof Error && error.message.includes('未初始化')) {
          try {
            console.log('语义相似度引擎代理: 由于错误尝试重新初始化引擎...');
            await this.ensureOffscreenEngineInitialized();

            // Resend original message
            const retryResponse = await chrome.runtime.sendMessage(message);
            if (retryResponse && retryResponse.success) {
              return retryResponse;
            }
          } catch (reinitError) {
            console.warn('语义相似度引擎代理: 重新初始化引擎失败:', reinitError);
          }
        }

        if (attempt < maxRetries) {
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));

          // Re-ensure offscreen document exists
          try {
            await this.offscreenManager.ensureOffscreenDocument();
          } catch (offscreenError) {
            console.warn('语义相似度引擎代理: 确保离屏文档失败:', offscreenError);
          }
        }
      }
    }

    throw new Error(
      `在 ${maxRetries} 次尝试后与离屏文档通信失败。最后一个错误: ${lastError?.message}`,
    );
  }

  async getEmbedding(text: string, options: Record<string, any> = {}): Promise<Float32Array> {
    if (!this._isInitialized) {
      await this.initialize();
    }

    // Check and ensure engine is initialized before each call
    await this.ensureOffscreenEngineInitialized();

    const response = await this.sendMessageToOffscreen({
      target: 'offscreen',
      type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_COMPUTE,
      text: text,
      options: options,
    });

    if (!response || !response.success) {
      throw new Error(response?.error || '从离屏文档获取嵌入向量失败');
    }

    if (!response.embedding || !Array.isArray(response.embedding)) {
      throw new Error('Invalid embedding data received from offscreen document');
    }

    return new Float32Array(response.embedding);
  }

  async getEmbeddingsBatch(
    texts: string[],
    options: Record<string, any> = {},
  ): Promise<Float32Array[]> {
    if (!this._isInitialized) {
      await this.initialize();
    }

    if (!texts || texts.length === 0) return [];

    // Check and ensure engine is initialized before each call
    await this.ensureOffscreenEngineInitialized();

    const response = await this.sendMessageToOffscreen({
      target: 'offscreen',
      type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_BATCH_COMPUTE,
      texts: texts,
      options: options,
    });

    if (!response || !response.success) {
      throw new Error(response?.error || '从离屏文档获取批量嵌入向量失败');
    }

    return response.embeddings.map((emb: number[]) => new Float32Array(emb));
  }

  async computeSimilarity(
    text1: string,
    text2: string,
    options: Record<string, any> = {},
  ): Promise<number> {
    const [embedding1, embedding2] = await this.getEmbeddingsBatch([text1, text2], options);
    return this.cosineSimilarity(embedding1, embedding2);
  }

  async computeSimilarityBatch(
    pairs: { text1: string; text2: string }[],
    options: Record<string, any> = {},
  ): Promise<number[]> {
    if (!this._isInitialized) {
      await this.initialize();
    }

    // Check and ensure engine is initialized before each call
    await this.ensureOffscreenEngineInitialized();

    const response = await this.sendMessageToOffscreen({
      target: 'offscreen',
      type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_BATCH_COMPUTE,
      pairs: pairs,
      options: options,
    });

    if (!response || !response.success) {
      throw new Error(response?.error || '从离屏文档计算批量相似度失败');
    }

    return response.similarities;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimensions don't match: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  async dispose(): Promise<void> {
    // Proxy class doesn't need to clean up resources, actual resources are managed by offscreen
    this._isInitialized = false;
    console.log('语义相似度引擎代理: 代理已释放');
  }
}

export class SemanticSimilarityEngine {
  private worker: Worker | null = null;
  private tokenizer: PreTrainedTokenizer | null = null;
  public isInitialized = false;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;
  private nextTokenId = 0;
  private pendingMessages = new Map<number, PendingMessage>();
  private useOffscreen = false; // Whether to use offscreen mode

  public readonly config: Required<ModelConfig>;

  private embeddingCache: LRUCache<string, Float32Array>;
  // Added: tokenization cache
  private tokenizationCache: LRUCache<string, TokenizedOutput>;
  // Added: memory pool manager
  private memoryPool: EmbeddingMemoryPool;
  // Added: SIMD math engine
  private simdMath: SIMDMathEngine | null = null;
  private useSIMD = false;

  public cacheStats = {
    embedding: { hits: 0, misses: 0, size: 0 },
    tokenization: { hits: 0, misses: 0, size: 0 },
  };

  public performanceStats = {
    totalEmbeddingComputations: 0,
    totalEmbeddingTime: 0,
    averageEmbeddingTime: 0,
    totalTokenizationTime: 0,
    averageTokenizationTime: 0,
    totalSimilarityComputations: 0,
    totalSimilarityTime: 0,
    averageSimilarityTime: 0,
    workerStats: null as WorkerStats | null,
  };

  private runningWorkerTasks = 0;
  private workerTaskQueue: (() => void)[] = [];

  /**
   * Detect if current runtime environment supports Worker
   */
  private isWorkerSupported(): boolean {
    try {
      // Check if in Service Worker environment (background script)
      if (typeof importScripts === 'function') {
        return false;
      }

      // Check if Worker constructor is available
      return typeof Worker !== 'undefined';
    } catch {
      return false;
    }
  }

  /**
   * Detect if in offscreen document environment
   */
  private isInOffscreenDocument(): boolean {
    try {
      // In offscreen document, window.location.pathname is usually '/offscreen.html'
      return (
        typeof window !== 'undefined' &&
        window.location &&
        window.location.pathname.includes('offscreen')
      );
    } catch {
      return false;
    }
  }

  /**
   * Ensure offscreen document exists
   */
  private async ensureOffscreenDocument(): Promise<void> {
    return OffscreenManager.getInstance().ensureOffscreenDocument();
  }

  // Helper function to safely convert tensor data to number array
  private convertTensorDataToNumbers(data: any): number[] {
    if (data instanceof BigInt64Array) {
      return Array.from(data, (val: bigint) => Number(val));
    } else if (data instanceof Int32Array) {
      return Array.from(data);
    } else {
      return Array.from(data);
    }
  }

  constructor(options: Partial<ModelConfig> = {}) {
    console.log('语义相似度引擎: 构造函数调用，选项:', {
      useLocalFiles: options.useLocalFiles,
      modelIdentifier: options.modelIdentifier,
      forceOffscreen: options.forceOffscreen,
      modelPreset: options.modelPreset,
      modelVersion: options.modelVersion,
    });

    // Handle model presets
    let modelConfig = { ...options };
    if (options.modelPreset && PREDEFINED_MODELS[options.modelPreset]) {
      const preset = PREDEFINED_MODELS[options.modelPreset];
      const modelVersion = options.modelVersion || 'quantized'; // Default to quantized version
      const baseModelIdentifier = preset.modelIdentifier; // Use base identifier without version suffix
      const onnxFileName = getOnnxFileNameForVersion(modelVersion); // Get ONNX filename based on version

      // Get model-specific configuration
      const modelSpecificConfig = (preset as any).modelSpecificConfig || {};

      modelConfig = {
        ...options,
        modelIdentifier: baseModelIdentifier, // Use base identifier
        onnxModelFile: onnxFileName, // Set corresponding version ONNX filename
        dimension: preset.dimension,
        modelVersion: modelVersion,
        requiresTokenTypeIds: modelSpecificConfig.requiresTokenTypeIds !== false, // Default to true unless explicitly set to false
      };
      console.log(
        `语义相似度引擎: 使用模型预设 "${options.modelPreset}" 版本 "${modelVersion}":`,
        preset,
      );
      console.log(`语义相似度引擎: 基础模型标识符: ${baseModelIdentifier}`);
      console.log(`语义相似度引擎: 版本对应的ONNX文件: ${onnxFileName}`);
      console.log(
        `SemanticSimilarityEngine: Requires token_type_ids: ${modelConfig.requiresTokenTypeIds}`,
      );
    }

    // Set default configuration - using 2025 recommended default model
    this.config = {
      ...modelConfig,
      modelIdentifier: modelConfig.modelIdentifier || 'Xenova/bge-small-en-v1.5',
      localModelPathPrefix: modelConfig.localModelPathPrefix || 'models/',
      onnxModelFile: modelConfig.onnxModelFile || 'model.onnx',
      maxLength: modelConfig.maxLength || 256,
      cacheSize: modelConfig.cacheSize || 500,
      numThreads:
        modelConfig.numThreads ||
        (typeof navigator !== 'undefined' && navigator.hardwareConcurrency
          ? Math.max(1, Math.floor(navigator.hardwareConcurrency / 2))
          : 2),
      executionProviders:
        modelConfig.executionProviders ||
        (typeof WebAssembly === 'object' &&
        WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
          ? ['wasm']
          : ['webgl']),
      useLocalFiles: (() => {
        console.log(
          'SemanticSimilarityEngine: DEBUG - modelConfig.useLocalFiles:',
          modelConfig.useLocalFiles,
        );
        console.log(
          'SemanticSimilarityEngine: DEBUG - modelConfig.useLocalFiles !== undefined:',
          modelConfig.useLocalFiles !== undefined,
        );
        const result = modelConfig.useLocalFiles !== undefined ? modelConfig.useLocalFiles : true;
        console.log('语义相似度引擎: 调试 - 最终useLocalFiles值:', result);
        return result;
      })(),
      workerPath: modelConfig.workerPath || 'js/similarity.worker.js', // Will be overridden by WXT's `new URL`
      concurrentLimit:
        modelConfig.concurrentLimit ||
        Math.max(
          1,
          modelConfig.numThreads ||
            (typeof navigator !== 'undefined' && navigator.hardwareConcurrency
              ? Math.max(1, Math.floor(navigator.hardwareConcurrency / 2))
              : 2),
        ),
      forceOffscreen: modelConfig.forceOffscreen || false,
      modelPreset: modelConfig.modelPreset || 'bge-small-en-v1.5',
      dimension: modelConfig.dimension || 384,
      modelVersion: modelConfig.modelVersion || 'quantized',
      requiresTokenTypeIds: modelConfig.requiresTokenTypeIds !== false, // Default to true
    } as Required<ModelConfig>;

    console.log('语义相似度引擎: 最终配置:', {
      useLocalFiles: this.config.useLocalFiles,
      modelIdentifier: this.config.modelIdentifier,
      forceOffscreen: this.config.forceOffscreen,
    });

    this.embeddingCache = new LRUCache<string, Float32Array>(this.config.cacheSize);
    this.tokenizationCache = new LRUCache<string, TokenizedOutput>(
      Math.min(this.config.cacheSize, 200),
    );
    this.memoryPool = new EmbeddingMemoryPool();
    this.simdMath = new SIMDMathEngine();
  }

  private _sendMessageToWorker(
    type: string,
    payload?: WorkerMessagePayload,
    transferList?: Transferable[],
  ): Promise<WorkerResponsePayload> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker is 未初始化.'));
        return;
      }
      const id = this.nextTokenId++;
      this.pendingMessages.set(id, { resolve, reject, type });

      // Use transferable objects if provided for zero-copy transfer
      if (transferList && transferList.length > 0) {
        this.worker.postMessage({ id, type, payload }, transferList);
      } else {
        this.worker.postMessage({ id, type, payload });
      }
    });
  }

  private _setupWorker(): void {
    console.log('语义相似度引擎: 设置工作线程...');

    // 方式1: Chrome extension URL (推荐，生产环境最可靠)
    try {
      const workerUrl = chrome.runtime.getURL('workers/similarity.worker.js');
      console.log(`语义相似度引擎: 尝试chrome.runtime.getURL ${workerUrl}`);
      this.worker = new Worker(workerUrl);
      console.log(`语义相似度引擎: 方法1成功，路径已获取`);
    } catch (error) {
      console.warn('方法 (chrome.runtime.getURL) 失败:', error);
    }

    if (!this.worker) {
      throw new Error('工作线程创建失败');
    }

    this.worker.onmessage = (
      event: MessageEvent<{
        id: number;
        type: string;
        status: string;
        payload: WorkerResponsePayload;
        stats?: WorkerStats;
      }>,
    ) => {
      const { id, status, payload, stats } = event.data;
      const promiseCallbacks = this.pendingMessages.get(id);
      if (!promiseCallbacks) return;

      this.pendingMessages.delete(id);

      // 更新 Worker 统计信息
      if (stats) {
        this.performanceStats.workerStats = stats;
      }

      if (status === 'success') {
        promiseCallbacks.resolve(payload);
      } else {
        const error = new Error(
          payload?.message || `Worker error for task ${promiseCallbacks.type}`,
        );
        (error as any).name = (payload as any)?.name || 'WorkerError';
        (error as any).stack = (payload as any)?.stack || undefined;
        console.error(
          `Error from worker (task ${id}, type ${promiseCallbacks.type}):`,
          error,
          event.data,
        );
        promiseCallbacks.reject(error);
      }
    };

    this.worker.onerror = (error: ErrorEvent) => {
      console.error('==== Unhandled error in SemanticSimilarityEngine Worker ====');
      console.error('Event Message:', error.message);
      console.error('Event Filename:', error.filename);
      console.error('Event Lineno:', error.lineno);
      console.error('Event Colno:', error.colno);
      if (error.error) {
        // 检查 event.error 是否存在
        console.error('Actual Error Name:', error.error.name);
        console.error('Actual Error Message:', error.error.message);
        console.error('Actual Error Stack:', error.error.stack);
      } else {
        console.error('Actual Error object (event.error) is not available. Error details:', {
          message: error.message,
          filename: error.filename,
          lineno: error.lineno,
          colno: error.colno,
        });
      }
      console.error('==========================================================');
      this.pendingMessages.forEach((callbacks) => {
        callbacks.reject(new Error(`Worker terminated or unhandled error: ${error.message}`));
      });
      this.pendingMessages.clear();
      this.isInitialized = false;
      this.isInitializing = false;
    };
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return Promise.resolve();
    if (this.isInitializing && this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = this._doInitialize().finally(() => {
      this.isInitializing = false;
      // this.warmupModel();
    });
    return this.initPromise;
  }

  /**
   * 带进度回调的初始化方法
   */
  public async initializeWithProgress(
    onProgress?: (progress: { status: string; progress: number; message?: string }) => void,
  ): Promise<void> {
    if (this.isInitialized) return Promise.resolve();
    if (this.isInitializing && this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = this._doInitializeWithProgress(onProgress).finally(() => {
      this.isInitializing = false;
      // this.warmupModel();
    });
    return this.initPromise;
  }

  /**
   * 带进度回调的内部初始化方法
   */
  private async _doInitializeWithProgress(
    onProgress?: (progress: { status: string; progress: number; message?: string }) => void,
  ): Promise<void> {
    console.log('语义相似度引擎: 带进度跟踪的初始化...');
    const startTime = performance.now();

    // 进度报告辅助函数
    const reportProgress = (status: string, progress: number, message?: string) => {
      if (onProgress) {
        onProgress({ status, progress, message });
      }
    };

    try {
      reportProgress('initializing', 5, 'Starting initialization...');

      // 检测环境并决定使用哪种模式
      const workerSupported = this.isWorkerSupported();
      const inOffscreenDocument = this.isInOffscreenDocument();

      // 🛠️ 防止死循环：如果已经在 offscreen document 中，强制使用直接 Worker 模式
      if (inOffscreenDocument) {
        this.useOffscreen = false;
        console.log(
          'SemanticSimilarityEngine: Running in offscreen document, using direct Worker mode to prevent recursion',
        );
      } else {
        this.useOffscreen = this.config.forceOffscreen || !workerSupported;
      }

      console.log(
        `SemanticSimilarityEngine: Worker supported: ${workerSupported}, In offscreen: ${inOffscreenDocument}, Using offscreen: ${this.useOffscreen}`,
      );

      reportProgress('initializing', 10, 'Environment detection complete');

      if (this.useOffscreen) {
        // 使用offscreen模式 - 委托给offscreen document，它会处理自己的进度
        reportProgress('initializing', 15, 'Setting up offscreen document...');
        await this.ensureOffscreenDocument();

        // 发送初始化消息到offscreen document
        console.log('语义相似度引擎: 发送配置到离屏:', {
          useLocalFiles: this.config.useLocalFiles,
          modelIdentifier: this.config.modelIdentifier,
          localModelPathPrefix: this.config.localModelPathPrefix,
        });

        // 确保配置对象被正确序列化，显式设置所有属性
        const configToSend = {
          modelIdentifier: this.config.modelIdentifier,
          localModelPathPrefix: this.config.localModelPathPrefix,
          onnxModelFile: this.config.onnxModelFile,
          maxLength: this.config.maxLength,
          cacheSize: this.config.cacheSize,
          numThreads: this.config.numThreads,
          executionProviders: this.config.executionProviders,
          useLocalFiles: Boolean(this.config.useLocalFiles), // 强制转换为布尔值
          workerPath: this.config.workerPath,
          concurrentLimit: this.config.concurrentLimit,
          forceOffscreen: this.config.forceOffscreen,
          modelPreset: this.config.modelPreset,
          modelVersion: this.config.modelVersion,
          dimension: this.config.dimension,
        };

        // 使用 JSON 序列化确保数据完整性
        const serializedConfig = JSON.parse(JSON.stringify(configToSend));

        reportProgress('initializing', 20, 'Delegating to offscreen document...');

        const response = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_INIT,
          config: serializedConfig,
        });

        if (!response || !response.success) {
          throw new Error(response?.error || '在离屏文档中初始化引擎失败');
        }

        reportProgress('ready', 100, 'Initialized via offscreen document');
        console.log('语义相似度引擎: 通过离屏文档初始化完成');
      } else {
        // 使用直接Worker模式 - 这里我们可以提供真实的进度跟踪
        await this._initializeDirectWorkerWithProgress(reportProgress);
      }

      this.isInitialized = true;
      console.log(
        `SemanticSimilarityEngine: Initialization complete in ${(performance.now() - startTime).toFixed(2)}ms`,
      );
    } catch (error) {
      console.error('SemanticSimilarityEngine: 初始化失败.', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      reportProgress('error', 0, `初始化失败: ${errorMessage}`);
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      this.isInitializing = false;
      this.initPromise = null;

      // 创建一个更详细的错误对象
      const enhancedError = new Error(errorMessage);
      enhancedError.name = 'ModelInitializationError';
      throw enhancedError;
    }
  }

  private async _doInitialize(): Promise<void> {
    console.log('语义相似度引擎: 正在初始化...');
    const startTime = performance.now();
    try {
      // 检测环境并决定使用哪种模式
      const workerSupported = this.isWorkerSupported();
      const inOffscreenDocument = this.isInOffscreenDocument();

      // 🛠️ 防止死循环：如果已经在 offscreen document 中，强制使用直接 Worker 模式
      if (inOffscreenDocument) {
        this.useOffscreen = false;
        console.log(
          'SemanticSimilarityEngine: Running in offscreen document, using direct Worker mode to prevent recursion',
        );
      } else {
        this.useOffscreen = this.config.forceOffscreen || !workerSupported;
      }

      console.log(
        `SemanticSimilarityEngine: Worker supported: ${workerSupported}, In offscreen: ${inOffscreenDocument}, Using offscreen: ${this.useOffscreen}`,
      );

      if (this.useOffscreen) {
        // 使用offscreen模式
        await this.ensureOffscreenDocument();

        // 发送初始化消息到offscreen document
        console.log('语义相似度引擎: 发送配置到离屏:', {
          useLocalFiles: this.config.useLocalFiles,
          modelIdentifier: this.config.modelIdentifier,
          localModelPathPrefix: this.config.localModelPathPrefix,
        });

        // 确保配置对象被正确序列化，显式设置所有属性
        const configToSend = {
          modelIdentifier: this.config.modelIdentifier,
          localModelPathPrefix: this.config.localModelPathPrefix,
          onnxModelFile: this.config.onnxModelFile,
          maxLength: this.config.maxLength,
          cacheSize: this.config.cacheSize,
          numThreads: this.config.numThreads,
          executionProviders: this.config.executionProviders,
          useLocalFiles: Boolean(this.config.useLocalFiles), // 强制转换为布尔值
          workerPath: this.config.workerPath,
          concurrentLimit: this.config.concurrentLimit,
          forceOffscreen: this.config.forceOffscreen,
          modelPreset: this.config.modelPreset,
          modelVersion: this.config.modelVersion,
          dimension: this.config.dimension,
        };

        console.log(
          'SemanticSimilarityEngine: DEBUG - configToSend.useLocalFiles:',
          configToSend.useLocalFiles,
        );
        console.log(
          'SemanticSimilarityEngine: DEBUG - typeof configToSend.useLocalFiles:',
          typeof configToSend.useLocalFiles,
        );

        console.log('语义相似度引擎: 明确发送的配置:', configToSend);
        console.log(
          'SemanticSimilarityEngine: DEBUG - this.config.useLocalFiles value:',
          this.config.useLocalFiles,
        );
        console.log(
          'SemanticSimilarityEngine: DEBUG - typeof this.config.useLocalFiles:',
          typeof this.config.useLocalFiles,
        );

        // 使用 JSON 序列化确保数据完整性
        const serializedConfig = JSON.parse(JSON.stringify(configToSend));
        console.log(
          'SemanticSimilarityEngine: DEBUG - serializedConfig.useLocalFiles:',
          serializedConfig.useLocalFiles,
        );

        const response = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_INIT,
          config: serializedConfig, // 使用原始配置，不强制修改 useLocalFiles
        });

        if (!response || !response.success) {
          throw new Error(response?.error || 'Failed to initialize engine in offscreen document');
        }

        console.log('语义相似度引擎: 通过离屏文档初始化完成');
      } else {
        // 使用直接Worker模式
        this._setupWorker();

        TransformersEnv.allowRemoteModels = !this.config.useLocalFiles;
        TransformersEnv.allowLocalModels = this.config.useLocalFiles;

        console.log(`语义相似度引擎: TransformersEnv配置:`, {
          allowRemoteModels: TransformersEnv.allowRemoteModels,
          allowLocalModels: TransformersEnv.allowLocalModels,
          useLocalFiles: this.config.useLocalFiles,
        });
        if (TransformersEnv.backends?.onnx?.wasm) {
          // 检查路径是否存在
          TransformersEnv.backends.onnx.wasm.numThreads = this.config.numThreads;
        }

        let tokenizerIdentifier = this.config.modelIdentifier;
        if (this.config.useLocalFiles) {
          // 对于WXT，public目录下的资源在运行时位于根路径
          // 直接使用模型标识符，transformers.js 会自动添加 /models/ 前缀
          tokenizerIdentifier = this.config.modelIdentifier;
        }
        console.log(
          `SemanticSimilarityEngine: Loading tokenizer from ${tokenizerIdentifier} (local_files_only: ${this.config.useLocalFiles})`,
        );
        const tokenizerConfig: any = {
          quantized: false,
          local_files_only: this.config.useLocalFiles,
        };

        // 对于不需要token_type_ids的模型，在tokenizer配置中明确设置
        if (!this.config.requiresTokenTypeIds) {
          tokenizerConfig.return_token_type_ids = false;
        }

        console.log(`语义相似度引擎: 完整的分词器配置:`, {
          tokenizerIdentifier,
          localModelPathPrefix: this.config.localModelPathPrefix,
          modelIdentifier: this.config.modelIdentifier,
          useLocalFiles: this.config.useLocalFiles,
          local_files_only: this.config.useLocalFiles,
          requiresTokenTypeIds: this.config.requiresTokenTypeIds,
          tokenizerConfig,
        });
        this.tokenizer = await AutoTokenizer.from_pretrained(tokenizerIdentifier, tokenizerConfig);
        console.log('语义相似度引擎: 分词器已加载。');

        if (this.config.useLocalFiles) {
          // Local files mode - use URL path as before
          const onnxModelPathForWorker = chrome.runtime.getURL(
            `models/${this.config.modelIdentifier}/${this.config.onnxModelFile}`,
          );
          console.log(
            `SemanticSimilarityEngine: Instructing worker to load local ONNX model from ${onnxModelPathForWorker}`,
          );
          await this._sendMessageToWorker('init', {
            modelPath: onnxModelPathForWorker,
            numThreads: this.config.numThreads,
            executionProviders: this.config.executionProviders,
          });
        } else {
          // Remote files mode - use cached model data
          const modelIdParts = this.config.modelIdentifier.split('/');
          const modelNameForUrl =
            modelIdParts.length > 1
              ? this.config.modelIdentifier
              : `Xenova/${this.config.modelIdentifier}`;
          const onnxModelUrl = `https://huggingface.co/${modelNameForUrl}/resolve/main/onnx/${this.config.onnxModelFile}`;

          if (!this.config.modelIdentifier.includes('/')) {
            console.warn(
              `Warning: modelIdentifier "${this.config.modelIdentifier}" might not be a full HuggingFace path. Assuming Xenova prefix for remote URL.`,
            );
          }

          console.log(`语义相似度引擎: 从缓存获取模型数据 ${onnxModelUrl}`);

          // Get model data from cache (may download if not cached)
          const modelData = await getCachedModelData(onnxModelUrl);

          console.log(
            `SemanticSimilarityEngine: Sending cached model data to worker (${modelData.byteLength} bytes)`,
          );

          // Send ArrayBuffer to worker with transferable objects for zero-copy
          await this._sendMessageToWorker(
            'init',
            {
              modelData: modelData,
              numThreads: this.config.numThreads,
              executionProviders: this.config.executionProviders,
            },
            [modelData],
          );
        }
        console.log('语义相似度引擎: 工作线程报告模型已初始化。');

        // 尝试初始化 SIMD 加速
        try {
          console.log('语义相似度引擎: 检查SIMD支持...');
          const simdSupported = await SIMDMathEngine.checkSIMDSupport();

          if (simdSupported) {
            console.log('语义相似度引擎: 支持SIMD，正在初始化...');
            await this.simdMath!.initialize();
            this.useSIMD = true;
            console.log('语义相似度引擎: ✅ SIMD加速已启用');
          } else {
            console.log(
              'SemanticSimilarityEngine: ❌ SIMD not supported, using JavaScript fallback',
            );
            console.log('语义相似度引擎: 要启用SIMD，请使用:');
            console.log('  - Chrome 91+ (2021年5月)');
            console.log('  - Firefox 89+ (2021年6月)');
            console.log('  - Safari 16.4+ (2023年3月)');
            console.log('  - Edge 91+ (2021年5月)');
            this.useSIMD = false;
          }
        } catch (simdError) {
          console.warn(
            'SemanticSimilarityEngine: SIMD initialization failed, using JavaScript fallback:',
            simdError,
          );
          this.useSIMD = false;
        }
      }

      this.isInitialized = true;
      console.log(
        `SemanticSimilarityEngine: Initialization complete in ${(performance.now() - startTime).toFixed(2)}ms`,
      );
    } catch (error) {
      console.error('SemanticSimilarityEngine: 初始化失败.', error);
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      this.isInitializing = false;
      this.initPromise = null;

      // 创建一个更详细的错误对象
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const enhancedError = new Error(errorMessage);
      enhancedError.name = 'ModelInitializationError';
      throw enhancedError;
    }
  }

  /**
   * 直接Worker模式的初始化，支持进度回调
   */
  private async _initializeDirectWorkerWithProgress(
    reportProgress: (status: string, progress: number, message?: string) => void,
  ): Promise<void> {
    // 使用直接Worker模式
    reportProgress('initializing', 25, 'Setting up worker...');
    this._setupWorker();

    TransformersEnv.allowRemoteModels = !this.config.useLocalFiles;
    TransformersEnv.allowLocalModels = this.config.useLocalFiles;

    console.log(`SemanticSimilarityEngine: TransformersEnv config:`, {
      allowRemoteModels: TransformersEnv.allowRemoteModels,
      allowLocalModels: TransformersEnv.allowLocalModels,
      useLocalFiles: this.config.useLocalFiles,
    });
    if (TransformersEnv.backends?.onnx?.wasm) {
      TransformersEnv.backends.onnx.wasm.numThreads = this.config.numThreads;
    }

    let tokenizerIdentifier = this.config.modelIdentifier;
    if (this.config.useLocalFiles) {
      tokenizerIdentifier = this.config.modelIdentifier;
    }

    reportProgress('downloading', 40, 'Loading tokenizer...');
    console.log(
      `SemanticSimilarityEngine: Loading tokenizer from ${tokenizerIdentifier} (local_files_only: ${this.config.useLocalFiles})`,
    );

    // 使用 transformers.js 2.17+ 的进度回调功能
    const tokenizerProgressCallback = (progress: any) => {
      if (progress.status === 'downloading') {
        const progressPercent = Math.min(40 + (progress.progress || 0) * 0.3, 70);
        reportProgress(
          'downloading',
          progressPercent,
          `Downloading tokenizer: ${progress.file || ''}`,
        );
      }
    };

    const tokenizerConfig: any = {
      quantized: false,
      local_files_only: this.config.useLocalFiles,
    };

    // 对于不需要token_type_ids的模型，在tokenizer配置中明确设置
    if (!this.config.requiresTokenTypeIds) {
      tokenizerConfig.return_token_type_ids = false;
    }

    try {
      if (!this.config.useLocalFiles) {
        tokenizerConfig.progress_callback = tokenizerProgressCallback;
      }
      this.tokenizer = await AutoTokenizer.from_pretrained(tokenizerIdentifier, tokenizerConfig);
    } catch (error) {
      // 如果进度回调不支持，回退到标准方式
      console.log(
        'SemanticSimilarityEngine: Progress callback not supported, using standard loading',
      );
      delete tokenizerConfig.progress_callback;
      this.tokenizer = await AutoTokenizer.from_pretrained(tokenizerIdentifier, tokenizerConfig);
    }

    reportProgress('downloading', 70, 'Tokenizer loaded, setting up ONNX model...');
    console.log('SemanticSimilarityEngine: Tokenizer loaded.');

    if (this.config.useLocalFiles) {
      // Local files mode - use URL path as before
      const onnxModelPathForWorker = chrome.runtime.getURL(
        `models/${this.config.modelIdentifier}/${this.config.onnxModelFile}`,
      );
      reportProgress('downloading', 80, 'Loading local ONNX model...');
      console.log(
        `SemanticSimilarityEngine: Instructing worker to load local ONNX model from ${onnxModelPathForWorker}`,
      );
      await this._sendMessageToWorker('init', {
        modelPath: onnxModelPathForWorker,
        numThreads: this.config.numThreads,
        executionProviders: this.config.executionProviders,
      });
    } else {
      // Remote files mode - use cached model data
      const modelIdParts = this.config.modelIdentifier.split('/');
      const modelNameForUrl =
        modelIdParts.length > 1
          ? this.config.modelIdentifier
          : `Xenova/${this.config.modelIdentifier}`;
      const onnxModelUrl = `https://huggingface.co/${modelNameForUrl}/resolve/main/onnx/${this.config.onnxModelFile}`;

      if (!this.config.modelIdentifier.includes('/')) {
        console.warn(
          `Warning: modelIdentifier "${this.config.modelIdentifier}" might not be a full HuggingFace path. Assuming Xenova prefix for remote URL.`,
        );
      }

      reportProgress('downloading', 80, 'Loading cached ONNX model...');
      console.log(`SemanticSimilarityEngine: Getting cached model data from ${onnxModelUrl}`);

      // Get model data from cache (may download if not cached)
      const modelData = await getCachedModelData(onnxModelUrl);

      console.log(
        `SemanticSimilarityEngine: Sending cached model data to worker (${modelData.byteLength} bytes)`,
      );

      // Send ArrayBuffer to worker with transferable objects for zero-copy
      await this._sendMessageToWorker(
        'init',
        {
          modelData: modelData,
          numThreads: this.config.numThreads,
          executionProviders: this.config.executionProviders,
        },
        [modelData],
      );
    }
    console.log('SemanticSimilarityEngine: Worker reported model initialized.');

    reportProgress('initializing', 90, 'Setting up SIMD acceleration...');
    // 尝试初始化 SIMD 加速
    try {
      console.log('SemanticSimilarityEngine: Checking SIMD support...');
      const simdSupported = await SIMDMathEngine.checkSIMDSupport();

      if (simdSupported) {
        console.log('SemanticSimilarityEngine: SIMD supported, initializing...');
        await this.simdMath!.initialize();
        this.useSIMD = true;
        console.log('SemanticSimilarityEngine: ✅ SIMD acceleration enabled');
      } else {
        console.log('SemanticSimilarityEngine: ❌ SIMD not supported, using JavaScript fallback');
        this.useSIMD = false;
      }
    } catch (simdError) {
      console.warn(
        'SemanticSimilarityEngine: SIMD initialization failed, using JavaScript fallback:',
        simdError,
      );
      this.useSIMD = false;
    }

    reportProgress('ready', 100, 'Initialization complete');
  }

  public async warmupModel(): Promise<void> {
    if (!this.isInitialized && !this.isInitializing) {
      await this.initialize();
    } else if (this.isInitializing && this.initPromise) {
      await this.initPromise;
    }
    if (!this.isInitialized) throw new Error('Engine 未初始化 after warmup attempt.');
    console.log('SemanticSimilarityEngine: Warming up model...');

    // 更有代表性的预热文本，包含不同长度和语言
    const warmupTexts = [
      // 短文本
      'Hello',
      '你好',
      'Test',
      // 中等长度文本
      'Hello world, this is a test.',
      '你好世界，这是一个测试。',
      'The quick brown fox jumps over the lazy dog.',
      // 长文本
      'This is a longer text that contains multiple sentences. It helps warm up the model for various text lengths.',
      '这是一个包含多个句子的较长文本。它有助于为各种文本长度预热模型。',
    ];

    try {
      // 渐进式预热：先单个，再批量
      console.log('SemanticSimilarityEngine: Phase 1 - Individual warmup...');
      for (const text of warmupTexts.slice(0, 4)) {
        await this.getEmbedding(text);
      }

      console.log('SemanticSimilarityEngine: Phase 2 - Batch warmup...');
      await this.getEmbeddingsBatch(warmupTexts.slice(4));

      // 保留预热结果，不清空缓存
      console.log('SemanticSimilarityEngine: Model warmup complete. Cache preserved.');
      console.log(`Embedding cache: ${this.cacheStats.embedding.size} items`);
      console.log(`Tokenization cache: ${this.cacheStats.tokenization.size} items`);
    } catch (error) {
      console.warn('SemanticSimilarityEngine: Warmup failed. This might not be critical.', error);
    }
  }

  private async _tokenizeText(text: string | string[]): Promise<TokenizedOutput> {
    if (!this.tokenizer) throw new Error('Tokenizer 未初始化.');

    // 对于单个文本，尝试使用缓存
    if (typeof text === 'string') {
      const cacheKey = `tokenize:${text}`;
      const cached = this.tokenizationCache.get(cacheKey);
      if (cached) {
        this.cacheStats.tokenization.hits++;
        this.cacheStats.tokenization.size = this.tokenizationCache.size;
        return cached;
      }
      this.cacheStats.tokenization.misses++;

      const startTime = performance.now();
      const tokenizerOptions: any = {
        padding: true,
        truncation: true,
        max_length: this.config.maxLength,
        return_tensors: 'np',
      };

      // 对于不需要token_type_ids的模型，明确设置return_token_type_ids为false
      if (!this.config.requiresTokenTypeIds) {
        tokenizerOptions.return_token_type_ids = false;
      }

      const result = (await this.tokenizer(text, tokenizerOptions)) as TokenizedOutput;

      // 更新性能统计
      this.performanceStats.totalTokenizationTime += performance.now() - startTime;
      this.performanceStats.averageTokenizationTime =
        this.performanceStats.totalTokenizationTime /
        (this.cacheStats.tokenization.hits + this.cacheStats.tokenization.misses);

      // 缓存结果
      this.tokenizationCache.set(cacheKey, result);
      this.cacheStats.tokenization.size = this.tokenizationCache.size;

      return result;
    }

    // 对于批量文本，直接处理（批量处理通常不重复）
    const startTime = performance.now();
    const tokenizerOptions: any = {
      padding: true,
      truncation: true,
      max_length: this.config.maxLength,
      return_tensors: 'np',
    };

    // 对于不需要token_type_ids的模型，明确设置return_token_type_ids为false
    if (!this.config.requiresTokenTypeIds) {
      tokenizerOptions.return_token_type_ids = false;
    }

    const result = (await this.tokenizer(text, tokenizerOptions)) as TokenizedOutput;

    this.performanceStats.totalTokenizationTime += performance.now() - startTime;
    return result;
  }

  private _extractEmbeddingFromWorkerOutput(
    workerOutput: WorkerResponsePayload,
    attentionMaskArray: number[],
  ): Float32Array {
    if (!workerOutput.data || !workerOutput.dims)
      throw new Error('Invalid worker output for embedding extraction.');

    // 优化：直接使用 Float32Array，避免不必要的转换
    const lastHiddenStateData =
      workerOutput.data instanceof Float32Array
        ? workerOutput.data
        : new Float32Array(workerOutput.data);

    const dims = workerOutput.dims;
    const seqLength = dims[1];
    const hiddenSize = dims[2];

    // 使用内存池获取 embedding 数组
    const embedding = this.memoryPool.getEmbedding(hiddenSize);
    let validTokens = 0;

    for (let i = 0; i < seqLength; i++) {
      if (attentionMaskArray[i] === 1) {
        const offset = i * hiddenSize;
        for (let j = 0; j < hiddenSize; j++) {
          embedding[j] += lastHiddenStateData[offset + j];
        }
        validTokens++;
      }
    }
    if (validTokens > 0) {
      for (let i = 0; i < hiddenSize; i++) {
        embedding[i] /= validTokens;
      }
    }
    return this.normalizeVector(embedding);
  }

  private _extractBatchEmbeddingsFromWorkerOutput(
    workerOutput: WorkerResponsePayload,
    attentionMasksBatch: number[][],
  ): Float32Array[] {
    if (!workerOutput.data || !workerOutput.dims)
      throw new Error('Invalid worker output for batch embedding extraction.');

    // 优化：直接使用 Float32Array，避免不必要的转换
    const lastHiddenStateData =
      workerOutput.data instanceof Float32Array
        ? workerOutput.data
        : new Float32Array(workerOutput.data);

    const dims = workerOutput.dims;
    const batchSize = dims[0];
    const seqLength = dims[1];
    const hiddenSize = dims[2];
    const embeddings: Float32Array[] = [];

    for (let b = 0; b < batchSize; b++) {
      // 使用内存池获取 embedding 数组
      const embedding = this.memoryPool.getEmbedding(hiddenSize);
      let validTokens = 0;
      const currentAttentionMask = attentionMasksBatch[b];
      for (let i = 0; i < seqLength; i++) {
        if (currentAttentionMask[i] === 1) {
          const offset = (b * seqLength + i) * hiddenSize;
          for (let j = 0; j < hiddenSize; j++) {
            embedding[j] += lastHiddenStateData[offset + j];
          }
          validTokens++;
        }
      }
      if (validTokens > 0) {
        for (let i = 0; i < hiddenSize; i++) {
          embedding[i] /= validTokens;
        }
      }
      embeddings.push(this.normalizeVector(embedding));
    }
    return embeddings;
  }

  public async getEmbedding(
    text: string,
    options: Record<string, any> = {},
  ): Promise<Float32Array> {
    if (!this.isInitialized) await this.initialize();

    const cacheKey = this.getCacheKey(text, options);
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      this.cacheStats.embedding.hits++;
      this.cacheStats.embedding.size = this.embeddingCache.size;
      return cached;
    }
    this.cacheStats.embedding.misses++;

    // 如果使用offscreen模式，委托给offscreen document
    if (this.useOffscreen) {
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_COMPUTE,
        text: text,
        options: options,
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to get embedding from offscreen document');
      }

      // 验证响应数据
      if (!response.embedding || !Array.isArray(response.embedding)) {
        throw new Error('Invalid embedding data received from offscreen document');
      }

      console.log('SemanticSimilarityEngine: Received embedding from offscreen:', {
        length: response.embedding.length,
        type: typeof response.embedding,
        isArray: Array.isArray(response.embedding),
        firstFewValues: response.embedding.slice(0, 5),
      });

      const embedding = new Float32Array(response.embedding);

      // 验证转换后的数据
      console.log('SemanticSimilarityEngine: Converted embedding:', {
        length: embedding.length,
        type: typeof embedding,
        constructor: embedding.constructor.name,
        isFloat32Array: embedding instanceof Float32Array,
        firstFewValues: Array.from(embedding.slice(0, 5)),
      });

      this.embeddingCache.set(cacheKey, embedding);
      this.cacheStats.embedding.size = this.embeddingCache.size;

      // 更新性能统计
      this.performanceStats.totalEmbeddingComputations++;

      return embedding;
    }

    if (this.runningWorkerTasks >= this.config.concurrentLimit) {
      await this.waitForWorkerSlot();
    }
    this.runningWorkerTasks++;

    const startTime = performance.now();
    try {
      const tokenized = await this._tokenizeText(text);

      const inputIdsData = this.convertTensorDataToNumbers(tokenized.input_ids.data);
      const attentionMaskData = this.convertTensorDataToNumbers(tokenized.attention_mask.data);
      const tokenTypeIdsData = tokenized.token_type_ids
        ? this.convertTensorDataToNumbers(tokenized.token_type_ids.data)
        : undefined;

      const workerPayload: WorkerMessagePayload = {
        input_ids: inputIdsData,
        attention_mask: attentionMaskData,
        token_type_ids: tokenTypeIdsData,
        dims: {
          input_ids: tokenized.input_ids.dims,
          attention_mask: tokenized.attention_mask.dims,
          token_type_ids: tokenized.token_type_ids?.dims,
        },
      };

      const workerOutput = await this._sendMessageToWorker('infer', workerPayload);
      const embedding = this._extractEmbeddingFromWorkerOutput(workerOutput, attentionMaskData);
      this.embeddingCache.set(cacheKey, embedding);
      this.cacheStats.embedding.size = this.embeddingCache.size;

      this.performanceStats.totalEmbeddingComputations++;
      this.performanceStats.totalEmbeddingTime += performance.now() - startTime;
      this.performanceStats.averageEmbeddingTime =
        this.performanceStats.totalEmbeddingTime / this.performanceStats.totalEmbeddingComputations;
      return embedding;
    } finally {
      this.runningWorkerTasks--;
      this.processWorkerQueue();
    }
  }

  public async getEmbeddingsBatch(
    texts: string[],
    options: Record<string, any> = {},
  ): Promise<Float32Array[]> {
    if (!this.isInitialized) await this.initialize();
    if (!texts || texts.length === 0) return [];

    // 如果使用offscreen模式，委托给offscreen document
    if (this.useOffscreen) {
      // 先检查缓存
      const results: (Float32Array | undefined)[] = new Array(texts.length).fill(undefined);
      const uncachedTexts: string[] = [];
      const uncachedIndices: number[] = [];

      texts.forEach((text, index) => {
        const cacheKey = this.getCacheKey(text, options);
        const cached = this.embeddingCache.get(cacheKey);
        if (cached) {
          results[index] = cached;
          this.cacheStats.embedding.hits++;
        } else {
          uncachedTexts.push(text);
          uncachedIndices.push(index);
          this.cacheStats.embedding.misses++;
        }
      });

      // 如果所有都在缓存中，直接返回
      if (uncachedTexts.length === 0) {
        return results as Float32Array[];
      }

      // 只请求未缓存的文本
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_BATCH_COMPUTE,
        texts: uncachedTexts,
        options: options,
      });

      if (!response || !response.success) {
        throw new Error(
          response?.error || 'Failed to get embeddings batch from offscreen document',
        );
      }

      // 将结果放回对应位置并缓存
      response.embeddings.forEach((embeddingArray: number[], batchIndex: number) => {
        const embedding = new Float32Array(embeddingArray);
        const originalIndex = uncachedIndices[batchIndex];
        const originalText = uncachedTexts[batchIndex];

        results[originalIndex] = embedding;

        // 缓存结果
        const cacheKey = this.getCacheKey(originalText, options);
        this.embeddingCache.set(cacheKey, embedding);
      });

      this.cacheStats.embedding.size = this.embeddingCache.size;
      this.performanceStats.totalEmbeddingComputations += uncachedTexts.length;

      return results as Float32Array[];
    }

    const results: (Float32Array | undefined)[] = new Array(texts.length).fill(undefined);
    const uncachedTextsMap = new Map<string, number[]>();
    const textsToTokenize: string[] = [];

    texts.forEach((text, index) => {
      const cacheKey = this.getCacheKey(text, options);
      const cached = this.embeddingCache.get(cacheKey);
      if (cached) {
        results[index] = cached;
        this.cacheStats.embedding.hits++;
      } else {
        if (!uncachedTextsMap.has(text)) {
          uncachedTextsMap.set(text, []);
          textsToTokenize.push(text);
        }
        uncachedTextsMap.get(text)!.push(index);
        this.cacheStats.embedding.misses++;
      }
    });
    this.cacheStats.embedding.size = this.embeddingCache.size;

    if (textsToTokenize.length === 0) return results as Float32Array[];

    if (this.runningWorkerTasks >= this.config.concurrentLimit) {
      await this.waitForWorkerSlot();
    }
    this.runningWorkerTasks++;

    const startTime = performance.now();
    try {
      const tokenizedBatch = await this._tokenizeText(textsToTokenize);
      const workerPayload: WorkerMessagePayload = {
        input_ids: this.convertTensorDataToNumbers(tokenizedBatch.input_ids.data),
        attention_mask: this.convertTensorDataToNumbers(tokenizedBatch.attention_mask.data),
        token_type_ids: tokenizedBatch.token_type_ids
          ? this.convertTensorDataToNumbers(tokenizedBatch.token_type_ids.data)
          : undefined,
        dims: {
          input_ids: tokenizedBatch.input_ids.dims,
          attention_mask: tokenizedBatch.attention_mask.dims,
          token_type_ids: tokenizedBatch.token_type_ids?.dims,
        },
      };

      // 使用真正的批处理推理
      const workerOutput = await this._sendMessageToWorker('batchInfer', workerPayload);
      const attentionMasksForBatch: number[][] = [];
      const batchSize = tokenizedBatch.input_ids.dims[0];
      const seqLength = tokenizedBatch.input_ids.dims[1];
      const rawAttentionMaskData = this.convertTensorDataToNumbers(
        tokenizedBatch.attention_mask.data,
      );

      for (let i = 0; i < batchSize; ++i) {
        attentionMasksForBatch.push(rawAttentionMaskData.slice(i * seqLength, (i + 1) * seqLength));
      }

      const batchEmbeddings = this._extractBatchEmbeddingsFromWorkerOutput(
        workerOutput,
        attentionMasksForBatch,
      );
      batchEmbeddings.forEach((embedding, batchIdx) => {
        const originalText = textsToTokenize[batchIdx];
        const cacheKey = this.getCacheKey(originalText, options);
        this.embeddingCache.set(cacheKey, embedding);
        const originalResultIndices = uncachedTextsMap.get(originalText)!;
        originalResultIndices.forEach((idx) => {
          results[idx] = embedding;
        });
      });
      this.cacheStats.embedding.size = this.embeddingCache.size;

      this.performanceStats.totalEmbeddingComputations += textsToTokenize.length;
      this.performanceStats.totalEmbeddingTime += performance.now() - startTime;
      this.performanceStats.averageEmbeddingTime =
        this.performanceStats.totalEmbeddingTime / this.performanceStats.totalEmbeddingComputations;
      return results as Float32Array[];
    } finally {
      this.runningWorkerTasks--;
      this.processWorkerQueue();
    }
  }

  public async computeSimilarity(
    text1: string,
    text2: string,
    options: Record<string, any> = {},
  ): Promise<number> {
    if (!this.isInitialized) await this.initialize();
    this.validateInput(text1, text2);

    const simStartTime = performance.now();
    const [embedding1, embedding2] = await Promise.all([
      this.getEmbedding(text1, options),
      this.getEmbedding(text2, options),
    ]);
    const similarity = this.cosineSimilarity(embedding1, embedding2);
    console.log('computeSimilarity:', similarity);
    this.performanceStats.totalSimilarityComputations++;
    this.performanceStats.totalSimilarityTime += performance.now() - simStartTime;
    this.performanceStats.averageSimilarityTime =
      this.performanceStats.totalSimilarityTime / this.performanceStats.totalSimilarityComputations;
    return similarity;
  }

  public async computeSimilarityBatch(
    pairs: { text1: string; text2: string }[],
    options: Record<string, any> = {},
  ): Promise<number[]> {
    if (!this.isInitialized) await this.initialize();
    if (!pairs || pairs.length === 0) return [];

    // 如果使用offscreen模式，委托给offscreen document
    if (this.useOffscreen) {
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_BATCH_COMPUTE,
        pairs: pairs,
        options: options,
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to compute similarities in offscreen document');
      }

      return response.similarities;
    }

    // 直接模式的原有逻辑
    const simStartTime = performance.now();
    const uniqueTextsSet = new Set<string>();
    pairs.forEach((pair) => {
      this.validateInput(pair.text1, pair.text2);
      uniqueTextsSet.add(pair.text1);
      uniqueTextsSet.add(pair.text2);
    });

    const uniqueTextsArray = Array.from(uniqueTextsSet);
    const embeddingsArray = await this.getEmbeddingsBatch(uniqueTextsArray, options);
    const embeddingMap = new Map<string, Float32Array>();
    uniqueTextsArray.forEach((text, index) => {
      embeddingMap.set(text, embeddingsArray[index]);
    });

    const similarities = pairs.map((pair) => {
      const emb1 = embeddingMap.get(pair.text1);
      const emb2 = embeddingMap.get(pair.text2);
      if (!emb1 || !emb2) {
        console.warn('Embeddings not found for pair:', pair);
        return 0;
      }
      return this.cosineSimilarity(emb1, emb2);
    });
    this.performanceStats.totalSimilarityComputations += pairs.length;
    this.performanceStats.totalSimilarityTime += performance.now() - simStartTime;
    this.performanceStats.averageSimilarityTime =
      this.performanceStats.totalSimilarityTime / this.performanceStats.totalSimilarityComputations;
    return similarities;
  }

  public async computeSimilarityMatrix(
    texts1: string[],
    texts2: string[],
    options: Record<string, any> = {},
  ): Promise<number[][]> {
    if (!this.isInitialized) await this.initialize();
    if (!texts1 || !texts2 || texts1.length === 0 || texts2.length === 0) return [];

    const simStartTime = performance.now();
    const allTextsSet = new Set<string>([...texts1, ...texts2]);
    texts1.forEach((t) => this.validateInput(t, 'valid_dummy'));
    texts2.forEach((t) => this.validateInput(t, 'valid_dummy'));

    const allTextsArray = Array.from(allTextsSet);
    const embeddingsArray = await this.getEmbeddingsBatch(allTextsArray, options);
    const embeddingMap = new Map<string, Float32Array>();
    allTextsArray.forEach((text, index) => {
      embeddingMap.set(text, embeddingsArray[index]);
    });

    // 使用 SIMD 优化的矩阵计算（如果可用）
    if (this.useSIMD && this.simdMath) {
      try {
        const embeddings1 = texts1.map((text) => embeddingMap.get(text)!).filter(Boolean);
        const embeddings2 = texts2.map((text) => embeddingMap.get(text)!).filter(Boolean);

        if (embeddings1.length === texts1.length && embeddings2.length === texts2.length) {
          const matrix = await this.simdMath.similarityMatrix(embeddings1, embeddings2);

          this.performanceStats.totalSimilarityComputations += texts1.length * texts2.length;
          this.performanceStats.totalSimilarityTime += performance.now() - simStartTime;
          this.performanceStats.averageSimilarityTime =
            this.performanceStats.totalSimilarityTime /
            this.performanceStats.totalSimilarityComputations;

          return matrix;
        }
      } catch (error) {
        console.warn('SIMD matrix computation failed, falling back to JavaScript:', error);
      }
    }

    // JavaScript 回退版本
    const matrix: number[][] = [];
    for (const textA of texts1) {
      const row: number[] = [];
      const embA = embeddingMap.get(textA);
      if (!embA) {
        console.warn(`Embedding not found for text1: "${textA}"`);
        texts2.forEach(() => row.push(0));
        matrix.push(row);
        continue;
      }
      for (const textB of texts2) {
        const embB = embeddingMap.get(textB);
        if (!embB) {
          console.warn(`Embedding not found for text2: "${textB}"`);
          row.push(0);
          continue;
        }
        row.push(this.cosineSimilarity(embA, embB));
      }
      matrix.push(row);
    }
    this.performanceStats.totalSimilarityComputations += texts1.length * texts2.length;
    this.performanceStats.totalSimilarityTime += performance.now() - simStartTime;
    this.performanceStats.averageSimilarityTime =
      this.performanceStats.totalSimilarityTime / this.performanceStats.totalSimilarityComputations;
    return matrix;
  }

  public cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      console.warn('Cosine similarity: Invalid vectors provided.', vecA, vecB);
      return 0;
    }

    // 使用 SIMD 优化版本（如果可用）
    if (this.useSIMD && this.simdMath) {
      try {
        // SIMD 版本是异步的，但为了保持接口兼容性，我们需要同步版本
        // 这里我们回退到 JavaScript 版本，或者可以考虑重构为异步
        return this.cosineSimilarityJS(vecA, vecB);
      } catch (error) {
        console.warn('SIMD cosine similarity failed, falling back to JavaScript:', error);
        return this.cosineSimilarityJS(vecA, vecB);
      }
    }

    return this.cosineSimilarityJS(vecA, vecB);
  }

  private cosineSimilarityJS(vecA: Float32Array, vecB: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  // 新增：异步 SIMD 优化的余弦相似度
  public async cosineSimilaritySIMD(vecA: Float32Array, vecB: Float32Array): Promise<number> {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      console.warn('Cosine similarity: Invalid vectors provided.', vecA, vecB);
      return 0;
    }

    if (this.useSIMD && this.simdMath) {
      try {
        return await this.simdMath.cosineSimilarity(vecA, vecB);
      } catch (error) {
        console.warn('SIMD cosine similarity failed, falling back to JavaScript:', error);
      }
    }

    return this.cosineSimilarityJS(vecA, vecB);
  }

  public normalizeVector(vector: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
    norm = Math.sqrt(norm);
    if (norm === 0) return vector;
    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) normalized[i] = vector[i] / norm;
    return normalized;
  }

  public validateInput(text1: string, text2: string | 'valid_dummy'): void {
    if (typeof text1 !== 'string' || (text2 !== 'valid_dummy' && typeof text2 !== 'string')) {
      throw new Error('输入必须是字符串');
    }
    if (text1.trim().length === 0 || (text2 !== 'valid_dummy' && text2.trim().length === 0)) {
      throw new Error('输入文本不能为空');
    }
    const roughCharLimit = this.config.maxLength * 5;
    if (
      text1.length > roughCharLimit ||
      (text2 !== 'valid_dummy' && text2.length > roughCharLimit)
    ) {
      console.warn('输入文本可能过长，将由分词器截断。');
    }
  }

  private getCacheKey(text: string, _options: Record<string, any> = {}): string {
    return text; // Options currently not used to vary embedding, simplify key
  }

  public getPerformanceStats(): Record<string, any> {
    return {
      ...this.performanceStats,
      cacheStats: {
        ...this.cacheStats,
        embedding: {
          ...this.cacheStats.embedding,
          hitRate:
            this.cacheStats.embedding.hits + this.cacheStats.embedding.misses > 0
              ? this.cacheStats.embedding.hits /
                (this.cacheStats.embedding.hits + this.cacheStats.embedding.misses)
              : 0,
        },
        tokenization: {
          ...this.cacheStats.tokenization,
          hitRate:
            this.cacheStats.tokenization.hits + this.cacheStats.tokenization.misses > 0
              ? this.cacheStats.tokenization.hits /
                (this.cacheStats.tokenization.hits + this.cacheStats.tokenization.misses)
              : 0,
        },
      },
      memoryPool: this.memoryPool.getStats(),
      memoryUsage: this.getMemoryUsage(),
      isInitialized: this.isInitialized,
      isInitializing: this.isInitializing,
      config: this.config,
      pendingWorkerTasks: this.workerTaskQueue.length,
      runningWorkerTasks: this.runningWorkerTasks,
    };
  }

  private async waitForWorkerSlot(): Promise<void> {
    return new Promise((resolve) => {
      this.workerTaskQueue.push(resolve);
    });
  }

  private processWorkerQueue(): void {
    if (this.workerTaskQueue.length > 0 && this.runningWorkerTasks < this.config.concurrentLimit) {
      const resolve = this.workerTaskQueue.shift();
      if (resolve) resolve();
    }
  }

  // 新增：获取 Worker 统计信息
  public async getWorkerStats(): Promise<WorkerStats | null> {
    if (!this.worker || !this.isInitialized) return null;

    try {
      const response = await this._sendMessageToWorker('getStats');
      return response as WorkerStats;
    } catch (error) {
      console.warn('Failed to get worker stats:', error);
      return null;
    }
  }

  // 新增：清理 Worker 缓冲区
  public async clearWorkerBuffers(): Promise<void> {
    if (!this.worker || !this.isInitialized) return;

    try {
      await this._sendMessageToWorker('clearBuffers');
      console.log('SemanticSimilarityEngine: Worker buffers cleared.');
    } catch (error) {
      console.warn('Failed to clear worker buffers:', error);
    }
  }

  // 新增：清理所有缓存
  public clearAllCaches(): void {
    this.embeddingCache.clear();
    this.tokenizationCache.clear();
    this.cacheStats = {
      embedding: { hits: 0, misses: 0, size: 0 },
      tokenization: { hits: 0, misses: 0, size: 0 },
    };
    console.log('语义相似度引擎: 所有缓存已清除。');
  }

  // 新增：获取内存使用情况
  public getMemoryUsage(): {
    embeddingCacheUsage: number;
    tokenizationCacheUsage: number;
    totalCacheUsage: number;
  } {
    const embeddingStats = this.embeddingCache.getStats();
    const tokenizationStats = this.tokenizationCache.getStats();

    return {
      embeddingCacheUsage: embeddingStats.usage,
      tokenizationCacheUsage: tokenizationStats.usage,
      totalCacheUsage: (embeddingStats.usage + tokenizationStats.usage) / 2,
    };
  }

  public async dispose(): Promise<void> {
    console.log('语义相似度引擎: 正在释放...');

    // 清理 Worker 缓冲区
    await this.clearWorkerBuffers();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    // 清理 SIMD 引擎
    if (this.simdMath) {
      this.simdMath.dispose();
      this.simdMath = null;
    }

    this.tokenizer = null;
    this.embeddingCache.clear();
    this.tokenizationCache.clear();
    this.memoryPool.clear();
    this.pendingMessages.clear();
    this.workerTaskQueue = [];
    this.isInitialized = false;
    this.isInitializing = false;
    this.initPromise = null;
    this.useSIMD = false;
    console.log('语义相似度引擎: 已释放。');
  }
}
