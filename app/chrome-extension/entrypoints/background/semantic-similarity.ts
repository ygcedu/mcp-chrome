import type { ModelPreset } from '@/utils/semantic-similarity-engine';
import { OffscreenManager } from '@/utils/offscreen-manager';
import { BACKGROUND_MESSAGE_TYPES, OFFSCREEN_MESSAGE_TYPES } from '@/common/message-types';
import { STORAGE_KEYS, ERROR_MESSAGES } from '@/common/constants';
import { hasAnyModelCache } from '@/utils/semantic-similarity-engine';

/**
 * 模型配置状态管理接口
 */
interface ModelConfig {
  modelPreset: ModelPreset;
  modelVersion: 'full' | 'quantized' | 'compressed';
  modelDimension: number;
}

let currentBackgroundModelConfig: ModelConfig | null = null;

/**
 * 仅在模型缓存存在时初始化语义引擎
 * 这在插件启动时调用，以避免不必要的模型下载
 */
export async function initializeSemanticEngineIfCached(): Promise<boolean> {
  try {
    console.log('后台：检查是否应从缓存初始化语义引擎...');

    const hasCachedModel = await hasAnyModelCache();
    if (!hasCachedModel) {
      console.log('后台：未找到缓存模型，跳过语义引擎初始化');
      return false;
    }

    console.log('后台：找到缓存模型，初始化语义引擎...');
    await initializeDefaultSemanticEngine();
    return true;
  } catch (error) {
    console.error('后台：有条件语义引擎初始化过程中出错：', error);
    return false;
  }
}

/**
 * 初始化默认语义引擎模型
 */
export async function initializeDefaultSemanticEngine(): Promise<void> {
  try {
    console.log('后台：初始化默认语义引擎...');

    // 更新状态为初始化中
    await updateModelStatus('initializing', 0);

    const result = await chrome.storage.local.get([STORAGE_KEYS.SEMANTIC_MODEL, 'selectedVersion']);
    const defaultModel =
      (result[STORAGE_KEYS.SEMANTIC_MODEL] as ModelPreset) || 'multilingual-e5-small';
    const defaultVersion =
      (result.selectedVersion as 'full' | 'quantized' | 'compressed') || 'quantized';

    const { PREDEFINED_MODELS } = await import('@/utils/semantic-similarity-engine');
    const modelInfo = PREDEFINED_MODELS[defaultModel];

    await OffscreenManager.getInstance().ensureOffscreenDocument();

    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_INIT,
      config: {
        useLocalFiles: false,
        modelPreset: defaultModel,
        modelVersion: defaultVersion,
        modelDimension: modelInfo.dimension,
        forceOffscreen: true,
      },
    });

    if (response && response.success) {
      currentBackgroundModelConfig = {
        modelPreset: defaultModel,
        modelVersion: defaultVersion,
        modelDimension: modelInfo.dimension,
      };
      console.log('语义引擎初始化成功：', currentBackgroundModelConfig);

      // 更新状态为就绪
      await updateModelStatus('ready', 100);

      // 现在语义引擎已就绪，也初始化 ContentIndexer
      try {
        const { getGlobalContentIndexer } = await import('@/utils/content-indexer');
        const contentIndexer = getGlobalContentIndexer();
        contentIndexer.startSemanticEngineInitialization();
        console.log('语义引擎初始化后触发 ContentIndexer 初始化');
      } catch (indexerError) {
        console.warn('语义引擎初始化后初始化 ContentIndexer 失败：', indexerError);
      }
    } else {
      const errorMessage = response?.error || ERROR_MESSAGES.TOOL_EXECUTION_FAILED;
      await updateModelStatus('error', 0, errorMessage, 'unknown');
      throw new Error(errorMessage);
    }
  } catch (error: any) {
    console.error('后台：初始化默认语义引擎失败：', error);
    const errorMessage = error?.message || 'Unknown error during semantic engine initialization';
    await updateModelStatus('error', 0, errorMessage, 'unknown');
    // 不抛出错误，让扩展继续运行
  }
}

/**
 * 检查是否需要模型切换
 */
function needsModelSwitch(
  modelPreset: ModelPreset,
  modelVersion: 'full' | 'quantized' | 'compressed',
  modelDimension?: number,
): boolean {
  if (!currentBackgroundModelConfig) {
    return true;
  }

  const keyFields = ['modelPreset', 'modelVersion', 'modelDimension'];
  for (const field of keyFields) {
    const newValue =
      field === 'modelPreset'
        ? modelPreset
        : field === 'modelVersion'
          ? modelVersion
          : modelDimension;
    if (newValue !== currentBackgroundModelConfig[field as keyof ModelConfig]) {
      return true;
    }
  }

  return false;
}

/**
 * 处理模型切换
 */
export async function handleModelSwitch(
  modelPreset: ModelPreset,
  modelVersion: 'full' | 'quantized' | 'compressed' = 'quantized',
  modelDimension?: number,
  previousDimension?: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const needsSwitch = needsModelSwitch(modelPreset, modelVersion, modelDimension);
    if (!needsSwitch) {
      await updateModelStatus('ready', 100);
      return { success: true };
    }

    await updateModelStatus('downloading', 0);

    try {
      await OffscreenManager.getInstance().ensureOffscreenDocument();
    } catch (offscreenError) {
      console.error('后台：创建离屏文档失败：', offscreenError);
      const errorMessage = `Failed to create offscreen document: ${offscreenError}`;
      await updateModelStatus('error', 0, errorMessage, 'unknown');
      return { success: false, error: errorMessage };
    }

    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_INIT,
      config: {
        useLocalFiles: false,
        modelPreset: modelPreset,
        modelVersion: modelVersion,
        modelDimension: modelDimension,
        forceOffscreen: true,
      },
    });

    if (response && response.success) {
      currentBackgroundModelConfig = {
        modelPreset: modelPreset,
        modelVersion: modelVersion,
        modelDimension: modelDimension!,
      };

      // 仅在维度变化时重新初始化 ContentIndexer
      try {
        if (modelDimension && previousDimension && modelDimension !== previousDimension) {
          const { getGlobalContentIndexer } = await import('@/utils/content-indexer');
          const contentIndexer = getGlobalContentIndexer();
          await contentIndexer.reinitialize();
        }
      } catch (indexerError) {
        console.warn('后台：重新初始化 ContentIndexer 失败：', indexerError);
      }

      await updateModelStatus('ready', 100);
      return { success: true };
    } else {
      const errorMessage = response?.error || 'Failed to switch model';
      const errorType = analyzeErrorType(errorMessage);
      await updateModelStatus('error', 0, errorMessage, errorType);
      throw new Error(errorMessage);
    }
  } catch (error: any) {
    console.error('模型切换失败：', error);
    const errorMessage = error.message || 'Unknown error';
    const errorType = analyzeErrorType(errorMessage);
    await updateModelStatus('error', 0, errorMessage, errorType);
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取模型状态
 */
export async function handleGetModelStatus(): Promise<{
  success: boolean;
  status?: any;
  error?: string;
}> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      console.error('后台：chrome.storage.local 不可用于状态查询');
      return {
        success: true,
        status: {
          initializationStatus: 'idle',
          downloadProgress: 0,
          isDownloading: false,
          lastUpdated: Date.now(),
        },
      };
    }

    const result = await chrome.storage.local.get(['modelState']);
    const modelState = result.modelState || {
      status: 'idle',
      downloadProgress: 0,
      isDownloading: false,
      lastUpdated: Date.now(),
    };

    return {
      success: true,
      status: {
        initializationStatus: modelState.status,
        downloadProgress: modelState.downloadProgress,
        isDownloading: modelState.isDownloading,
        lastUpdated: modelState.lastUpdated,
        errorMessage: modelState.errorMessage,
        errorType: modelState.errorType,
      },
    };
  } catch (error: any) {
    console.error('获取模型状态失败：', error);
    return { success: false, error: error.message };
  }
}

/**
 * 更新模型状态
 */
export async function updateModelStatus(
  status: string,
  progress: number,
  errorMessage?: string,
  errorType?: string,
): Promise<void> {
  try {
    // 检查 chrome.storage 是否可用
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      console.error('后台：chrome.storage.local 不可用于状态更新');
      return;
    }

    const modelState = {
      status,
      downloadProgress: progress,
      isDownloading: status === 'downloading' || status === 'initializing',
      lastUpdated: Date.now(),
      errorMessage: errorMessage || '',
      errorType: errorType || '',
    };
    await chrome.storage.local.set({ modelState });
  } catch (error) {
    console.error('更新模型状态失败：', error);
  }
}

/**
 * 处理来自离屏文档的模型状态更新
 */
export async function handleUpdateModelStatus(
  modelState: any,
): Promise<{ success: boolean; error?: string }> {
  try {
    // 检查 chrome.storage 是否可用
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      console.error('后台：chrome.storage.local 不可用');
      return { success: false, error: 'chrome.storage.local is not available' };
    }

    await chrome.storage.local.set({ modelState });
    return { success: true };
  } catch (error: any) {
    console.error('后台：更新模型状态失败：', error);
    return { success: false, error: error.message };
  }
}

/**
 * 根据错误消息分析错误类型
 */
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

/**
 * 初始化语义相似度模块消息监听器
 */
export const initSemanticSimilarityListener = () => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === BACKGROUND_MESSAGE_TYPES.SWITCH_SEMANTIC_MODEL) {
      handleModelSwitch(
        message.modelPreset,
        message.modelVersion,
        message.modelDimension,
        message.previousDimension,
      )
        .then((result: { success: boolean; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (message.type === BACKGROUND_MESSAGE_TYPES.GET_MODEL_STATUS) {
      handleGetModelStatus()
        .then((result: { success: boolean; status?: any; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (message.type === BACKGROUND_MESSAGE_TYPES.UPDATE_MODEL_STATUS) {
      handleUpdateModelStatus(message.modelState)
        .then((result: { success: boolean; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (message.type === BACKGROUND_MESSAGE_TYPES.INITIALIZE_SEMANTIC_ENGINE) {
      initializeDefaultSemanticEngine()
        .then(() => sendResponse({ success: true }))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
};
