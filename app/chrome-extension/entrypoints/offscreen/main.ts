import { SemanticSimilarityEngine } from '@/utils/semantic-similarity-engine';
import {
  MessageTarget,
  SendMessageType,
  OFFSCREEN_MESSAGE_TYPES,
  BACKGROUND_MESSAGE_TYPES,
} from '@/common/message-types';

// 全局语义相似度引擎实例
let similarityEngine: SemanticSimilarityEngine | null = null;
interface OffscreenMessage {
  target: MessageTarget | string;
  type: SendMessageType | string;
}

interface SimilarityEngineInitMessage extends OffscreenMessage {
  type: SendMessageType.SimilarityEngineInit;
  config: any;
}

interface SimilarityEngineComputeBatchMessage extends OffscreenMessage {
  type: SendMessageType.SimilarityEngineComputeBatch;
  pairs: { text1: string; text2: string }[];
  options?: Record<string, any>;
}

interface SimilarityEngineGetEmbeddingMessage extends OffscreenMessage {
  type: 'similarityEngineCompute';
  text: string;
  options?: Record<string, any>;
}

interface SimilarityEngineGetEmbeddingsBatchMessage extends OffscreenMessage {
  type: 'similarityEngineBatchCompute';
  texts: string[];
  options?: Record<string, any>;
}

interface SimilarityEngineStatusMessage extends OffscreenMessage {
  type: 'similarityEngineStatus';
}

type MessageResponse = {
  result?: string;
  error?: string;
  success?: boolean;
  similarities?: number[];
  embedding?: number[];
  embeddings?: number[][];
  isInitialized?: boolean;
  currentConfig?: any;
};

// 监听来自扩展的消息
chrome.runtime.onMessage.addListener(
  (
    message: OffscreenMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    if (message.target !== MessageTarget.Offscreen) {
      return;
    }

    try {
      switch (message.type) {
        case SendMessageType.SimilarityEngineInit:
        case OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_INIT: {
          const initMsg = message as SimilarityEngineInitMessage;
          console.log('离屏文档: 收到语义引擎初始化消息:', message.type);
          handleSimilarityEngineInit(initMsg.config)
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
          break;
        }

        case SendMessageType.SimilarityEngineComputeBatch: {
          const computeMsg = message as SimilarityEngineComputeBatchMessage;
          handleComputeSimilarityBatch(computeMsg.pairs, computeMsg.options)
            .then((similarities) => sendResponse({ success: true, similarities }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
          break;
        }

        case OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_COMPUTE: {
          const embeddingMsg = message as SimilarityEngineGetEmbeddingMessage;
          handleGetEmbedding(embeddingMsg.text, embeddingMsg.options)
            .then((embedding) => {
              console.log('离屏文档: 发送嵌入响应:', {
                length: embedding.length,
                type: typeof embedding,
                constructor: embedding.constructor.name,
                isFloat32Array: embedding instanceof Float32Array,
                firstFewValues: Array.from(embedding.slice(0, 5)),
              });
              const embeddingArray = Array.from(embedding);
              console.log('离屏文档: 转换为数组:', {
                length: embeddingArray.length,
                type: typeof embeddingArray,
                isArray: Array.isArray(embeddingArray),
                firstFewValues: embeddingArray.slice(0, 5),
              });
              sendResponse({ success: true, embedding: embeddingArray });
            })
            .catch((error) => sendResponse({ success: false, error: error.message }));
          break;
        }

        case OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_BATCH_COMPUTE: {
          const batchMsg = message as SimilarityEngineGetEmbeddingsBatchMessage;
          handleGetEmbeddingsBatch(batchMsg.texts, batchMsg.options)
            .then((embeddings) =>
              sendResponse({
                success: true,
                embeddings: embeddings.map((emb) => Array.from(emb)),
              }),
            )
            .catch((error) => sendResponse({ success: false, error: error.message }));
          break;
        }

        case OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_STATUS: {
          handleGetEngineStatus()
            .then((status: any) => sendResponse({ success: true, ...status }))
            .catch((error: any) => sendResponse({ success: false, error: error.message }));
          break;
        }

        default:
          sendResponse({ error: `未知消息类型: ${message.type}` });
      }
    } catch (error) {
      if (error instanceof Error) {
        sendResponse({ error: error.message });
      } else {
        sendResponse({ error: '发生未知错误' });
      }
    }

    // 返回true表示我们将异步响应
    return true;
  },
);

// 跟踪当前模型状态的全局变量
let currentModelConfig: any = null;

/**
 * 检查是否需要重新初始化引擎
 */
function needsReinitialization(newConfig: any): boolean {
  if (!similarityEngine || !currentModelConfig) {
    return true;
  }

  // 检查关键配置是否已更改
  const keyFields = ['modelPreset', 'modelVersion', 'modelIdentifier', 'dimension'];
  for (const field of keyFields) {
    if (newConfig[field] !== currentModelConfig[field]) {
      console.log(`离屏文档: ${field} 从 ${currentModelConfig[field]} 更改为 ${newConfig[field]}`);
      return true;
    }
  }

  return false;
}

/**
 * 进度回调函数类型
 */
type ProgressCallback = (progress: { status: string; progress: number; message?: string }) => void;

/**
 * 初始化语义相似度引擎
 */
async function handleSimilarityEngineInit(config: any): Promise<void> {
  console.log('离屏文档: 使用配置初始化语义相似度引擎:', config);
  console.log('离屏文档: 配置 useLocalFiles:', config.useLocalFiles);
  console.log('离屏文档: 配置 modelPreset:', config.modelPreset);
  console.log('离屏文档: 配置 modelVersion:', config.modelVersion);
  console.log('离屏文档: 配置 modelDimension:', config.modelDimension);
  console.log('离屏文档: 配置 modelIdentifier:', config.modelIdentifier);

  // 检查是否需要重新初始化
  const needsReinit = needsReinitialization(config);
  console.log('离屏文档: 需要重新初始化:', needsReinit);

  if (!needsReinit) {
    console.log('离屏文档: 使用现有引擎（未检测到更改）');
    await updateModelStatus('ready', 100);
    return;
  }

  // 如果引擎已存在，首先清理旧实例（支持模型切换）
  if (similarityEngine) {
    console.log('离屏文档: 为模型切换清理现有引擎...');
    try {
      // 正确调用dispose方法清理所有资源
      await similarityEngine.dispose();
      console.log('离屏文档: 之前的引擎已成功释放');
    } catch (error) {
      console.warn('离屏文档: 释放之前的引擎失败:', error);
    }
    similarityEngine = null;
    currentModelConfig = null;

    // 清除IndexedDB中的向量数据以确保数据一致性
    try {
      console.log('离屏文档: 为模型切换清除IndexedDB向量数据...');
      await clearVectorIndexedDB();
      console.log('离屏文档: IndexedDB向量数据清除成功');
    } catch (error) {
      console.warn('离屏文档: 清除IndexedDB向量数据失败:', error);
    }
  }

  try {
    // 更新状态为初始化中
    await updateModelStatus('initializing', 10);

    // 创建进度回调函数
    const progressCallback: ProgressCallback = async (progress) => {
      console.log('离屏文档: 进度更新:', progress);
      await updateModelStatus(progress.status, progress.progress);
    };

    // 创建引擎实例并传递进度回调
    similarityEngine = new SemanticSimilarityEngine(config);
    console.log('离屏文档: 开始引擎初始化并跟踪进度...');

    // 使用增强的初始化方法（如果支持进度回调）
    if (typeof (similarityEngine as any).initializeWithProgress === 'function') {
      await (similarityEngine as any).initializeWithProgress(progressCallback);
    } else {
      // 回退到标准初始化方法
      console.log('离屏文档: 使用标准初始化（不支持进度回调）');
      await updateModelStatus('downloading', 30);
      await similarityEngine.initialize();
      await updateModelStatus('ready', 100);
    }

    // 保存当前配置
    currentModelConfig = { ...config };

    console.log('离屏文档: 语义相似度引擎初始化成功');
  } catch (error) {
    console.error('离屏文档: 初始化语义相似度引擎失败:', error);
    // 更新状态为错误
    const errorMessage = error instanceof Error ? error.message : '未知初始化错误';
    const errorType = analyzeErrorType(errorMessage);
    await updateModelStatus('error', 0, errorMessage, errorType);
    // 清理失败的实例
    similarityEngine = null;
    currentModelConfig = null;
    throw error;
  }
}

/**
 * 清除IndexedDB中的向量数据
 */
async function clearVectorIndexedDB(): Promise<void> {
  try {
    // 清除向量搜索相关的IndexedDB数据库
    const dbNames = ['VectorSearchDB', 'ContentIndexerDB', 'SemanticSimilarityDB'];

    for (const dbName of dbNames) {
      try {
        // 尝试删除数据库
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        await new Promise<void>((resolve, _reject) => {
          deleteRequest.onsuccess = () => {
            console.log(`离屏文档: 成功删除数据库: ${dbName}`);
            resolve();
          };
          deleteRequest.onerror = () => {
            console.warn(`离屏文档: 删除数据库失败: ${dbName}`, deleteRequest.error);
            resolve(); // 不阻塞其他数据库的清理
          };
          deleteRequest.onblocked = () => {
            console.warn(`离屏文档: 数据库删除被阻塞: ${dbName}`);
            resolve(); // 不阻塞其他数据库的清理
          };
        });
      } catch (error) {
        console.warn(`离屏文档: 删除数据库 ${dbName} 时出错:`, error);
      }
    }
  } catch (error) {
    console.error('离屏文档: 清除向量IndexedDB失败:', error);
    throw error;
  }
}

// 分析错误类型
function analyzeErrorType(errorMessage: string): 'network' | 'file' | 'unknown' {
  const message = errorMessage.toLowerCase();

  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('cors') ||
    message.includes('failed to fetch')
  ) {
    return 'network';
  }

  if (
    message.includes('corrupt') ||
    message.includes('invalid') ||
    message.includes('format') ||
    message.includes('parse') ||
    message.includes('decode') ||
    message.includes('onnx')
  ) {
    return 'file';
  }

  return 'unknown';
}

// 更新模型状态的辅助函数
async function updateModelStatus(
  status: string,
  progress: number,
  errorMessage?: string,
  errorType?: string,
) {
  try {
    const modelState = {
      status,
      downloadProgress: progress,
      isDownloading: status === 'downloading' || status === 'initializing',
      lastUpdated: Date.now(),
      errorMessage: errorMessage || '',
      errorType: errorType || '',
    };

    // 在离屏文档中，通过向后台脚本传递消息来更新存储
    // 因为离屏文档可能没有直接的chrome.storage访问权限
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ modelState });
    } else {
      // 如果chrome.storage不可用，向后台脚本传递消息
      console.log('离屏文档: chrome.storage不可用，向后台发送消息');
      try {
        await chrome.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.UPDATE_MODEL_STATUS,
          modelState: modelState,
        });
      } catch (messageError) {
        console.error('离屏文档: 发送状态更新消息失败:', messageError);
      }
    }
  } catch (error) {
    console.error('离屏文档: 更新模型状态失败:', error);
  }
}

/**
 * 批量计算语义相似度
 */
async function handleComputeSimilarityBatch(
  pairs: { text1: string; text2: string }[],
  options: Record<string, any> = {},
): Promise<number[]> {
  if (!similarityEngine) {
    throw new Error('语义相似度引擎未初始化。请重新初始化引擎。');
  }

  console.log(`离屏文档: 为 ${pairs.length} 对文本计算相似度`);
  const similarities = await similarityEngine.computeSimilarityBatch(pairs, options);
  console.log('离屏文档: 相似度计算完成');

  return similarities;
}

/**
 * 获取单个文本的嵌入向量
 */
async function handleGetEmbedding(
  text: string,
  options: Record<string, any> = {},
): Promise<Float32Array> {
  if (!similarityEngine) {
    throw new Error('语义相似度引擎未初始化。请重新初始化引擎。');
  }

  console.log(`离屏文档: 获取文本嵌入: "${text.substring(0, 50)}..."`);
  const embedding = await similarityEngine.getEmbedding(text, options);
  console.log('离屏文档: 嵌入计算完成');

  return embedding;
}

/**
 * 批量获取文本的嵌入向量
 */
async function handleGetEmbeddingsBatch(
  texts: string[],
  options: Record<string, any> = {},
): Promise<Float32Array[]> {
  if (!similarityEngine) {
    throw new Error('语义相似度引擎未初始化。请重新初始化引擎。');
  }

  console.log(`离屏文档: 获取 ${texts.length} 个文本的嵌入`);
  const embeddings = await similarityEngine.getEmbeddingsBatch(texts, options);
  console.log('离屏文档: 批量嵌入计算完成');

  return embeddings;
}

/**
 * 获取引擎状态
 */
async function handleGetEngineStatus(): Promise<{
  isInitialized: boolean;
  currentConfig: any;
}> {
  return {
    isInitialized: !!similarityEngine,
    currentConfig: currentModelConfig,
  };
}

console.log('离屏文档: 语义相似度引擎处理器已加载');
