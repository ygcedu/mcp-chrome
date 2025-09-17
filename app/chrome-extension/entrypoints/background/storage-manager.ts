import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

/**
 * 获取存储统计信息
 */
export async function handleGetStorageStats(): Promise<{
  success: boolean;
  stats?: any;
  error?: string;
}> {
  try {
    // 获取ContentIndexer统计信息
    const { getGlobalContentIndexer } = await import('@/utils/content-indexer');
    const contentIndexer = getGlobalContentIndexer();

    // 注意：语义引擎初始化现在由用户控制
    // 当用户手动触发语义引擎初始化时，ContentIndexer将被初始化

    // 获取统计信息
    const stats = contentIndexer.getStats();

    return {
      success: true,
      stats: {
        indexedPages: stats.indexedPages || 0,
        totalDocuments: stats.totalDocuments || 0,
        totalTabs: stats.totalTabs || 0,
        indexSize: stats.indexSize || 0,
        isInitialized: stats.isInitialized || false,
        semanticEngineReady: stats.semanticEngineReady || false,
        semanticEngineInitializing: stats.semanticEngineInitializing || false,
      },
    };
  } catch (error: any) {
    console.error('后台：获取存储统计信息失败:', error);
    return {
      success: false,
      error: error.message,
      stats: {
        indexedPages: 0,
        totalDocuments: 0,
        totalTabs: 0,
        indexSize: 0,
        isInitialized: false,
        semanticEngineReady: false,
        semanticEngineInitializing: false,
      },
    };
  }
}

/**
 * 清除所有数据
 */
export async function handleClearAllData(): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. 清除所有ContentIndexer索引
    try {
      const { getGlobalContentIndexer } = await import('@/utils/content-indexer');
      const contentIndexer = getGlobalContentIndexer();

      await contentIndexer.clearAllIndexes();
      console.log('存储：ContentIndexer索引清除成功');
    } catch (indexerError) {
      console.warn('后台：清除ContentIndexer索引失败:', indexerError);
      // 继续其他清理操作
    }

    // 2. 清除所有VectorDatabase数据
    try {
      const { clearAllVectorData } = await import('@/utils/vector-database');
      await clearAllVectorData();
      console.log('存储：向量数据库数据清除成功');
    } catch (vectorError) {
      console.warn('后台：清除向量数据失败:', vectorError);
      // 继续其他清理操作
    }

    // 3. 清除chrome.storage中的相关数据（保留模型首选项）
    try {
      const keysToRemove = ['vectorDatabaseStats', 'lastCleanupTime', 'contentIndexerStats'];
      await chrome.storage.local.remove(keysToRemove);
      console.log('存储：Chrome存储数据清除成功');
    } catch (storageError) {
      console.warn('后台：清除chrome存储数据失败:', storageError);
    }

    return { success: true };
  } catch (error: any) {
    console.error('后台：清除所有数据失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 初始化存储管理器模块消息监听器
 */
export const initStorageManagerListener = () => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === BACKGROUND_MESSAGE_TYPES.GET_STORAGE_STATS) {
      handleGetStorageStats()
        .then((result: { success: boolean; stats?: any; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (message.type === BACKGROUND_MESSAGE_TYPES.CLEAR_ALL_DATA) {
      handleClearAllData()
        .then((result: { success: boolean; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
};
