import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  PREDEFINED_MODELS,
  type ModelPreset,
  getModelInfo,
  getCacheStats,
  clearModelCache,
  cleanupModelCache,
} from '@/utils/semantic-similarity-engine';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

import ConfirmDialog from './components/ConfirmDialog';
import ProgressIndicator from './components/ProgressIndicator';
import ModelCacheManagement from './components/ModelCacheManagement';
import {
  DocumentIcon,
  DatabaseIcon,
  BoltIcon,
  TrashIcon,
  CheckIcon,
  TabIcon,
  VectorIcon,
} from './components/icons';
import './App.css';

interface ServerStatus {
  isRunning: boolean;
  port?: number;
  lastUpdated: number;
}

interface StorageStats {
  indexedPages: number;
  totalDocuments: number;
  totalTabs: number;
  indexSize: number;
  isInitialized: boolean;
}

interface CacheStats {
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
}

const App: React.FC = () => {
  // 连接与服务状态
  const [nativeConnectionStatus, setNativeConnectionStatus] = useState<
    'unknown' | 'connected' | 'disconnected'
  >('unknown');
  const [isConnecting, setIsConnecting] = useState(false);
  const [nativeServerPort, setNativeServerPort] = useState<number>(12306);
  const [serverStatus, setServerStatus] = useState<ServerStatus>({
    isRunning: false,
    lastUpdated: Date.now(),
  });
  const [copyButtonText, setCopyButtonText] = useState('复制配置');

  // 模型状态
  const [currentModel, setCurrentModel] = useState<ModelPreset | null>(null);
  const [isModelSwitching, setIsModelSwitching] = useState(false);
  const [modelSwitchProgress, setModelSwitchProgress] = useState('');
  const [modelDownloadProgress, setModelDownloadProgress] = useState<number>(0);
  const [isModelDownloading, setIsModelDownloading] = useState(false);
  const [modelInitializationStatus, setModelInitializationStatus] = useState<
    'idle' | 'downloading' | 'initializing' | 'ready' | 'error'
  >('idle');
  const [modelErrorMessage, setModelErrorMessage] = useState<string>('');
  const [modelErrorType, setModelErrorType] = useState<'network' | 'file' | 'unknown' | ''>('');

  // 语义引擎状态
  const [semanticEngineStatus, setSemanticEngineStatus] = useState<
    'idle' | 'initializing' | 'ready' | 'error'
  >('idle');
  const [isSemanticEngineInitializing, setIsSemanticEngineInitializing] = useState(false);
  const [semanticEngineInitProgress, setSemanticEngineInitProgress] = useState('');
  const [semanticEngineLastUpdated, setSemanticEngineLastUpdated] = useState<number | null>(null);

  // 存储与缓存状态
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  const [isClearingData, setIsClearingData] = useState(false);
  const [showClearConfirmation, setShowClearConfirmation] = useState(false);
  const [clearDataProgress, setClearDataProgress] = useState('');
  const [isManagingCache, setIsManagingCache] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);

  // 定时器
  const [statusMonitoringInterval, setStatusMonitoringInterval] = useState<NodeJS.Timeout | null>(
    null,
  );
  const [semanticEngineStatusPollingInterval, setSemanticEngineStatusPollingInterval] =
    useState<NodeJS.Timeout | null>(null);

  // 计算属性
  const showMcpConfig = useMemo(() => {
    return nativeConnectionStatus === 'connected' && serverStatus.isRunning;
  }, [nativeConnectionStatus, serverStatus.isRunning]);

  const mcpConfigJson = useMemo(() => {
    const port = serverStatus.port || nativeServerPort;
    const config = {
      mcpServers: {
        'streamable-mcp-server': {
          type: 'streamable-http',
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    };
    return JSON.stringify(config, null, 2);
  }, [serverStatus.port, nativeServerPort]);

  const availableModels = useMemo(() => {
    return Object.entries(PREDEFINED_MODELS).map(([key, value]) => ({
      preset: key as ModelPreset,
      ...value,
    }));
  }, []);

  // 辅助函数
  const getStatusClass = () => {
    if (nativeConnectionStatus === 'connected') {
      if (serverStatus.isRunning) {
        return 'bg-emerald-500';
      } else {
        return 'bg-yellow-500';
      }
    } else if (nativeConnectionStatus === 'disconnected') {
      return 'bg-red-500';
    } else {
      return 'bg-gray-500';
    }
  };

  const getStatusText = () => {
    if (nativeConnectionStatus === 'connected') {
      if (serverStatus.isRunning) {
        return `服务运行中 (端口: ${serverStatus.port || '未知'})`;
      } else {
        return '已连接，服务未启动';
      }
    } else if (nativeConnectionStatus === 'disconnected') {
      return '服务未连接';
    } else {
      return '检测中...';
    }
  };

  const formatIndexSize = () => {
    if (!storageStats?.indexSize) return '0 MB';
    const sizeInMB = Math.round(storageStats.indexSize / (1024 * 1024));
    return `${sizeInMB} MB`;
  };

  const getModelDescription = (model: any) => {
    switch (model.preset) {
      case 'multilingual-e5-small':
        return '轻量级多语言模型';
      case 'multilingual-e5-base':
        return '比e5-small稍大，但效果更好';
      default:
        return '多语言语义模型';
    }
  };

  const getPerformanceText = (performance: string) => {
    switch (performance) {
      case 'fast':
        return '快速';
      case 'balanced':
        return '平衡';
      case 'accurate':
        return '精确';
      default:
        return performance;
    }
  };

  const getSemanticEngineStatusText = () => {
    switch (semanticEngineStatus) {
      case 'ready':
        return '语义引擎已就绪';
      case 'initializing':
        return '语义引擎初始化中...';
      case 'error':
        return '语义引擎初始化失败';
      case 'idle':
      default:
        return '语义引擎未初始化';
    }
  };

  const getSemanticEngineStatusClass = () => {
    switch (semanticEngineStatus) {
      case 'ready':
        return 'bg-emerald-500';
      case 'initializing':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      case 'idle':
      default:
        return 'bg-gray-500';
    }
  };

  const getActiveTabsCount = () => {
    return storageStats?.totalTabs || 0;
  };

  const getProgressText = () => {
    if (isModelDownloading) {
      return `下载模型中... ${modelDownloadProgress}%`;
    } else if (isModelSwitching) {
      return modelSwitchProgress || '切换模型中...';
    }
    return '';
  };

  const getErrorTypeText = () => {
    switch (modelErrorType) {
      case 'network':
        return '网络连接错误，请检查网络连接后重试';
      case 'file':
        return '模型文件损坏或不完整，请重试下载';
      case 'unknown':
      default:
        return '未知错误，请检查你的网络是否可以访问HuggingFace';
    }
  };

  const getSemanticEngineButtonText = () => {
    switch (semanticEngineStatus) {
      case 'ready':
        return '重新初始化';
      case 'initializing':
        return '初始化中...';
      case 'error':
        return '重新初始化';
      case 'idle':
      default:
        return '初始化语义引擎';
    }
  };

  // 存储相关函数
  const saveSemanticEngineState = async () => {
    try {
      const semanticEngineState = {
        status: semanticEngineStatus,
        lastUpdated: semanticEngineLastUpdated,
      };
      await chrome.storage.local.set({ semanticEngineState });
    } catch (error) {
      console.error('保存语义引擎状态失败:', error);
    }
  };

  const saveModelPreference = async (model: ModelPreset) => {
    try {
      await chrome.storage.local.set({ selectedModel: model });
    } catch (error) {
      console.error('保存模型偏好失败:', error);
    }
  };

  const saveVersionPreference = async (version: 'full' | 'quantized' | 'compressed') => {
    try {
      await chrome.storage.local.set({ selectedVersion: version });
    } catch (error) {
      console.error('保存版本偏好失败:', error);
    }
  };

  const savePortPreference = async (port: number) => {
    try {
      await chrome.storage.local.set({ nativeServerPort: port });
      console.log(`端口偏好已保存: ${port}`);
    } catch (error) {
      console.error('保存端口偏好失败:', error);
    }
  };

  const saveModelState = async () => {
    try {
      const modelState = {
        status: modelInitializationStatus,
        downloadProgress: modelDownloadProgress,
        isDownloading: isModelDownloading,
        lastUpdated: Date.now(),
      };
      await chrome.storage.local.set({ modelState });
    } catch (error) {
      console.error('保存模型状态失败:', error);
    }
  };

  // 加载相关函数
  const loadPortPreference = async () => {
    try {
      const result = await chrome.storage.local.get(['nativeServerPort']);
      if (result.nativeServerPort) {
        setNativeServerPort(result.nativeServerPort);
        console.log(`端口偏好已加载: ${result.nativeServerPort}`);
      }
    } catch (error) {
      console.error('加载端口偏好失败:', error);
    }
  };

  const loadModelPreference = async () => {
    try {
      const result = await chrome.storage.local.get([
        'selectedModel',
        'selectedVersion',
        'modelState',
        'semanticEngineState',
      ]);

      if (result.selectedModel) {
        const storedModel = result.selectedModel as string;
        console.log('📋 Stored model from storage:', storedModel);

        if (PREDEFINED_MODELS[storedModel as ModelPreset]) {
          setCurrentModel(storedModel as ModelPreset);
          console.log(`✅ Loaded valid model: ${storedModel}`);
        } else {
          console.warn(
            `⚠️ Stored model "${storedModel}" not found in PREDEFINED_MODELS, using default`,
          );
          setCurrentModel('multilingual-e5-small');
          await saveModelPreference('multilingual-e5-small');
        }
      } else {
        console.log('⚠️ No model found in storage, using default');
        setCurrentModel('multilingual-e5-small');
        await saveModelPreference('multilingual-e5-small');
      }

      await saveVersionPreference('quantized');

      if (result.modelState) {
        const modelState = result.modelState;

        if (modelState.status === 'ready') {
          setModelInitializationStatus('ready');
          setModelDownloadProgress(modelState.downloadProgress || 100);
          setIsModelDownloading(false);
        } else {
          setModelInitializationStatus('idle');
          setModelDownloadProgress(0);
          setIsModelDownloading(false);
          await saveModelState();
        }
      } else {
        setModelInitializationStatus('idle');
        setModelDownloadProgress(0);
        setIsModelDownloading(false);
      }

      if (result.semanticEngineState) {
        const semanticState = result.semanticEngineState;
        if (semanticState.status === 'ready') {
          setSemanticEngineStatus('ready');
          setSemanticEngineLastUpdated(semanticState.lastUpdated || Date.now());
        } else if (semanticState.status === 'error') {
          setSemanticEngineStatus('error');
          setSemanticEngineLastUpdated(semanticState.lastUpdated || Date.now());
        } else {
          setSemanticEngineStatus('idle');
        }
      } else {
        setSemanticEngineStatus('idle');
      }
    } catch (error) {
      console.error('❌ 加载模型偏好失败:', error);
    }
  };

  const loadCacheStats = async () => {
    try {
      const stats = await getCacheStats();
      setCacheStats(stats);
    } catch (error) {
      console.error('获取缓存统计信息失败:', error);
      setCacheStats(null);
    }
  };

  // 网络相关函数
  const checkNativeConnection = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'ping_native' });
      setNativeConnectionStatus(response?.connected ? 'connected' : 'disconnected');
    } catch (error) {
      console.error('检测 Native 连接状态失败:', error);
      setNativeConnectionStatus('disconnected');
    }
  };

  const checkServerStatus = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
      });
      if (response?.success && response.serverStatus) {
        setServerStatus(response.serverStatus);
      }

      if (response?.connected !== undefined) {
        setNativeConnectionStatus(response.connected ? 'connected' : 'disconnected');
      }
    } catch (error) {
      console.error('检测服务器状态失败:', error);
    }
  };

  const refreshServerStatus = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: BACKGROUND_MESSAGE_TYPES.REFRESH_SERVER_STATUS,
      });
      if (response?.success && response.serverStatus) {
        setServerStatus(response.serverStatus);
      }

      if (response?.connected !== undefined) {
        setNativeConnectionStatus(response.connected ? 'connected' : 'disconnected');
      }
    } catch (error) {
      console.error('刷新服务器状态失败:', error);
    }
  };

  const checkSemanticEngineStatus = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: BACKGROUND_MESSAGE_TYPES.GET_MODEL_STATUS,
      });

      if (response && response.success && response.status) {
        const status = response.status;

        if (status.initializationStatus === 'ready') {
          setSemanticEngineStatus('ready');
          setSemanticEngineLastUpdated(Date.now());
          setIsSemanticEngineInitializing(false);
          setSemanticEngineInitProgress('语义引擎已就绪');
          await saveSemanticEngineState();
          stopSemanticEngineStatusPolling();
          setTimeout(() => {
            setSemanticEngineInitProgress('');
          }, 2000);
        } else if (
          status.initializationStatus === 'downloading' ||
          status.initializationStatus === 'initializing'
        ) {
          setSemanticEngineStatus('initializing');
          setIsSemanticEngineInitializing(true);
          setSemanticEngineInitProgress('语义引擎初始化中...');
          setSemanticEngineLastUpdated(Date.now());
          await saveSemanticEngineState();
        } else if (status.initializationStatus === 'error') {
          setSemanticEngineStatus('error');
          setSemanticEngineLastUpdated(Date.now());
          setIsSemanticEngineInitializing(false);
          setSemanticEngineInitProgress('语义引擎初始化失败');
          await saveSemanticEngineState();
          stopSemanticEngineStatusPolling();
          setTimeout(() => {
            setSemanticEngineInitProgress('');
          }, 5000);
        } else {
          setSemanticEngineStatus('idle');
          setIsSemanticEngineInitializing(false);
          await saveSemanticEngineState();
        }
      } else {
        setSemanticEngineStatus('idle');
        setIsSemanticEngineInitializing(false);
        await saveSemanticEngineState();
      }
    } catch (error) {
      console.error('弹窗：检查语义引擎状态失败:', error);
      setSemanticEngineStatus('idle');
      setIsSemanticEngineInitializing(false);
      await saveSemanticEngineState();
    }
  };

  const refreshStorageStats = async () => {
    if (isRefreshingStats) return;

    setIsRefreshingStats(true);
    try {
      console.log('🔄 正在刷新存储统计信息...');

      const response = await chrome.runtime.sendMessage({
        type: 'get_storage_stats',
      });

      if (response && response.success) {
        setStorageStats({
          indexedPages: response.stats.indexedPages || 0,
          totalDocuments: response.stats.totalDocuments || 0,
          totalTabs: response.stats.totalTabs || 0,
          indexSize: response.stats.indexSize || 0,
          isInitialized: response.stats.isInitialized || false,
        });
        console.log('✅ 存储统计信息已刷新:', response.stats);
      } else {
        console.error('❌ 获取存储统计信息失败:', response?.error);
        setStorageStats({
          indexedPages: 0,
          totalDocuments: 0,
          totalTabs: 0,
          indexSize: 0,
          isInitialized: false,
        });
      }
    } catch (error) {
      console.error('❌ 刷新存储统计信息时出错:', error);
      setStorageStats({
        indexedPages: 0,
        totalDocuments: 0,
        totalTabs: 0,
        indexSize: 0,
        isInitialized: false,
      });
    } finally {
      setIsRefreshingStats(false);
    }
  };

  // Event handlers
  const handleUpdatePort = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newPort = Number(event.target.value);
    setNativeServerPort(newPort);
    await savePortPreference(newPort);
  };

  const handleCopyMcpConfig = async () => {
    try {
      await navigator.clipboard.writeText(mcpConfigJson);
      setCopyButtonText('✅配置已复制到剪贴板');

      setTimeout(() => {
        setCopyButtonText('复制配置');
      }, 2000);
    } catch (error) {
      console.error('复制配置失败:', error);
      setCopyButtonText('❌网络连接错误，请检查网络连接后重试');

      setTimeout(() => {
        setCopyButtonText('复制配置');
      }, 2000);
    }
  };

  const handleTestNativeConnection = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      if (nativeConnectionStatus === 'connected') {
        await chrome.runtime.sendMessage({ type: 'disconnect_native' });
        setNativeConnectionStatus('disconnected');
      } else {
        console.log(`尝试连接到端口: ${nativeServerPort}`);
        const response = await chrome.runtime.sendMessage({
          type: 'connectNative',
          port: nativeServerPort,
        });
        if (response && response.success) {
          setNativeConnectionStatus('connected');
          console.log('连接成功:', response);
          await savePortPreference(nativeServerPort);
        } else {
          setNativeConnectionStatus('disconnected');
          console.error('连接失败:', response);
        }
      }
    } catch (error) {
      console.error('测试连接失败:', error);
      setNativeConnectionStatus('disconnected');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleInitializeSemanticEngine = async () => {
    if (isSemanticEngineInitializing) return;

    const isReinitialization = semanticEngineStatus === 'ready';
    console.log(`🚀 用户触发语义引擎${isReinitialization ? '重新初始化' : '初始化'}`);

    setIsSemanticEngineInitializing(true);
    setSemanticEngineStatus('initializing');
    setSemanticEngineInitProgress(
      isReinitialization ? '语义引擎初始化中...' : '语义引擎初始化中...',
    );
    setSemanticEngineLastUpdated(Date.now());

    await saveSemanticEngineState();

    try {
      chrome.runtime
        .sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.INITIALIZE_SEMANTIC_ENGINE,
        })
        .catch((error) => {
          console.error('❌ 发送语义引擎初始化请求失败:', error);
        });

      startSemanticEngineStatusPolling();

      setSemanticEngineInitProgress(isReinitialization ? '处理中...' : '处理中...');
    } catch (error: any) {
      console.error('❌ 发送初始化请求失败:', error);
      setSemanticEngineStatus('error');
      setSemanticEngineInitProgress(
        `Failed to send initialization request: ${error?.message || 'Unknown error'}`,
      );

      await saveSemanticEngineState();

      setTimeout(() => {
        setSemanticEngineInitProgress('');
      }, 5000);

      setIsSemanticEngineInitializing(false);
      setSemanticEngineLastUpdated(Date.now());
      await saveSemanticEngineState();
    }
  };

  const handleRetryModelInitialization = async () => {
    if (!currentModel) return;

    console.log('🔄 正在重试模型初始化...');

    setModelErrorMessage('');
    setModelErrorType('');
    setModelInitializationStatus('downloading');
    setModelDownloadProgress(0);
    setIsModelDownloading(true);
    await handleSwitchModel(currentModel);
  };

  const handleSwitchModel = async (newModel: ModelPreset) => {
    console.log(`🔄 调用 switchModel，参数 newModel: ${newModel}`);

    if (isModelSwitching) {
      console.log('⏸️ 模型切换正在进行中，跳过');
      return;
    }

    const isSameModel = newModel === currentModel;
    const currentModelInfo = currentModel
      ? getModelInfo(currentModel)
      : getModelInfo('multilingual-e5-small');
    const newModelInfo = getModelInfo(newModel);
    const isDifferentDimension = currentModelInfo.dimension !== newModelInfo.dimension;

    console.log(`📊 切换分析:`);
    console.log(`   - 模型相同: ${isSameModel} (${currentModel} -> ${newModel})`);
    console.log(`   - 当前维度: ${currentModelInfo.dimension}, 新维度: ${newModelInfo.dimension}`);
    console.log(`   - 维度不同: ${isDifferentDimension}`);

    if (isSameModel && !isDifferentDimension) {
      console.log('✅ 模型和维度相同——无需切换');
      return;
    }

    const switchReasons = [];
    if (!isSameModel) switchReasons.push('模型不同');
    if (isDifferentDimension) switchReasons.push('维度不同');

    console.log(`🚀 切换模型原因: ${switchReasons.join(', ')}`);
    console.log(
      `📋 模型: ${currentModel} (${currentModelInfo.dimension}D) -> ${newModel} (${newModelInfo.dimension}D)`,
    );

    setIsModelSwitching(true);
    setModelSwitchProgress('切换模型中...');

    setModelInitializationStatus('downloading');
    setModelDownloadProgress(0);
    setIsModelDownloading(true);

    try {
      await saveModelPreference(newModel);
      await saveVersionPreference('quantized');
      await saveModelState();

      setModelSwitchProgress('语义引擎初始化中...');

      startModelStatusMonitoring();

      const response = await chrome.runtime.sendMessage({
        type: 'switch_semantic_model',
        modelPreset: newModel,
        modelVersion: 'quantized',
        modelDimension: newModelInfo.dimension,
        previousDimension: currentModelInfo.dimension,
      });

      if (response && response.success) {
        setCurrentModel(newModel);
        setModelSwitchProgress('操作成功完成');
        console.log(
          '模型切换成功:',
          newModel,
          'version: quantized',
          'dimension:',
          newModelInfo.dimension,
        );

        setModelInitializationStatus('ready');
        setIsModelDownloading(false);
        await saveModelState();

        setTimeout(() => {
          setModelSwitchProgress('');
        }, 2000);
      } else {
        throw new Error(response?.error || 'Model switch failed');
      }
    } catch (error: any) {
      console.error('模型切换失败:', error);
      setModelSwitchProgress(`Model switch failed: ${error?.message || 'Unknown error'}`);

      setModelInitializationStatus('error');
      setIsModelDownloading(false);

      const errorMessage = error?.message || '未知错误';
      if (
        errorMessage.includes('network') ||
        errorMessage.includes('fetch') ||
        errorMessage.includes('timeout')
      ) {
        setModelErrorType('network');
        setModelErrorMessage('网络连接错误，请检查网络连接后重试');
      } else if (
        errorMessage.includes('corrupt') ||
        errorMessage.includes('invalid') ||
        errorMessage.includes('format')
      ) {
        setModelErrorType('file');
        setModelErrorMessage('模型文件损坏或不完整，请重试下载');
      } else {
        setModelErrorType('unknown');
        setModelErrorMessage(errorMessage);
      }

      await saveModelState();

      setTimeout(() => {
        setModelSwitchProgress('');
      }, 8000);
    } finally {
      setIsModelSwitching(false);
    }
  };

  const handleConfirmClearAllData = async () => {
    if (isClearingData) return;

    setIsClearingData(true);
    setClearDataProgress('清空中...');

    try {
      console.log('🗑️ 开始清空所有数据...');

      const response = await chrome.runtime.sendMessage({
        type: 'clear_all_data',
      });

      if (response && response.success) {
        setClearDataProgress('数据清空成功');
        console.log('✅ 所有数据已成功清空');

        await refreshStorageStats();

        setTimeout(() => {
          setClearDataProgress('');
          setShowClearConfirmation(false);
        }, 2000);
      } else {
        throw new Error(response?.error || 'Failed to clear data');
      }
    } catch (error: any) {
      console.error('❌ 清空所有数据失败:', error);
      setClearDataProgress(`Failed to clear data: ${error?.message || 'Unknown error'}`);

      setTimeout(() => {
        setClearDataProgress('');
      }, 5000);
    } finally {
      setIsClearingData(false);
    }
  };

  const handleCleanupCache = async () => {
    if (isManagingCache) return;

    setIsManagingCache(true);
    try {
      await cleanupModelCache();
      await loadCacheStats();
    } catch (error) {
      console.error('清理缓存失败:', error);
    } finally {
      setIsManagingCache(false);
    }
  };

  const handleClearAllCache = async () => {
    if (isManagingCache) return;

    setIsManagingCache(true);
    try {
      await clearModelCache();
      await loadCacheStats();
    } catch (error) {
      console.error('清空缓存失败:', error);
    } finally {
      setIsManagingCache(false);
    }
  };

  // 监控相关函数
  const startModelStatusMonitoring = () => {
    if (statusMonitoringInterval) {
      clearInterval(statusMonitoringInterval);
    }

    const interval = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'get_model_status',
        });

        if (response && response.success) {
          const status = response.status;
          setModelInitializationStatus(status.initializationStatus || 'idle');
          setModelDownloadProgress(status.downloadProgress || 0);
          setIsModelDownloading(status.isDownloading || false);

          if (status.initializationStatus === 'error') {
            setModelErrorMessage(status.errorMessage || '模型加载失败');
            setModelErrorType(status.errorType || 'unknown');
          } else {
            setModelErrorMessage('');
            setModelErrorType('');
          }

          await saveModelState();

          if (status.initializationStatus === 'ready' || status.initializationStatus === 'error') {
            stopModelStatusMonitoring();
          }
        }
      } catch (error) {
        console.error('获取模型状态失败:', error);
      }
    }, 1000);

    setStatusMonitoringInterval(interval);
  };

  const stopModelStatusMonitoring = () => {
    if (statusMonitoringInterval) {
      clearInterval(statusMonitoringInterval);
      setStatusMonitoringInterval(null);
    }
  };

  const startSemanticEngineStatusPolling = () => {
    if (semanticEngineStatusPollingInterval) {
      clearInterval(semanticEngineStatusPollingInterval);
    }

    const interval = setInterval(async () => {
      try {
        await checkSemanticEngineStatus();
      } catch (error) {
        console.error('语义引擎状态轮询失败:', error);
      }
    }, 2000);

    setSemanticEngineStatusPollingInterval(interval);
  };

  const stopSemanticEngineStatusPolling = () => {
    if (semanticEngineStatusPollingInterval) {
      clearInterval(semanticEngineStatusPollingInterval);
      setSemanticEngineStatusPollingInterval(null);
    }
  };

  // 设置服务器状态监听器
  const setupServerStatusListener = useCallback(() => {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED && message.payload) {
        setServerStatus(message.payload);
        console.log('服务器状态已更新:', message.payload);
      }
    });
  }, []);

  // 副作用
  useEffect(() => {
    const initializeApp = async () => {
      await loadPortPreference();
      await loadModelPreference();
      await checkNativeConnection();
      await checkServerStatus();
      await refreshStorageStats();
      await loadCacheStats();
      await checkSemanticEngineStatus();
      setupServerStatusListener();
    };

    initializeApp();

    return () => {
      stopModelStatusMonitoring();
      stopSemanticEngineStatusPolling();
    };
  }, [setupServerStatusListener]);

  // 当语义引擎状态变化时更新存储状态
  useEffect(() => {
    saveSemanticEngineState();
  }, [semanticEngineStatus, semanticEngineLastUpdated]);

  return (
    <div className="popup-container">
      <div className="header">
        <div className="header-content">
          <h1 className="header-title">Chrome MCP Server</h1>
        </div>
      </div>
      <div className="content">
        <div className="section">
          <h2 className="section-title">Native Server 配置</h2>
          <div className="config-card">
            <div className="status-section">
              <div className="status-header">
                <p className="status-label">运行状态</p>
                <button
                  className="refresh-status-button"
                  onClick={refreshServerStatus}
                  title="刷新状态"
                >
                  🔄
                </button>
              </div>
              <div className="status-info">
                <span className={`status-dot ${getStatusClass()}`}></span>
                <span className="status-text">{getStatusText()}</span>
              </div>
              {serverStatus.lastUpdated && (
                <div className="status-timestamp">
                  最后更新:
                  {new Date(serverStatus.lastUpdated).toLocaleTimeString()}
                </div>
              )}
            </div>

            {showMcpConfig && (
              <div className="mcp-config-section">
                <div className="mcp-config-header">
                  <p className="mcp-config-label">MCP 服务器配置</p>
                  <button className="copy-config-button" onClick={handleCopyMcpConfig}>
                    {copyButtonText}
                  </button>
                </div>
                <div className="mcp-config-content">
                  <pre className="mcp-config-json">{mcpConfigJson}</pre>
                </div>
              </div>
            )}
            <div className="port-section">
              <label htmlFor="port" className="port-label">
                连接端口
              </label>
              <input
                type="text"
                id="port"
                value={nativeServerPort}
                onChange={handleUpdatePort}
                className="port-input"
              />
            </div>

            <button
              className="connect-button"
              disabled={isConnecting}
              onClick={handleTestNativeConnection}
            >
              <BoltIcon />
              <span>
                {isConnecting
                  ? '连接中...'
                  : nativeConnectionStatus === 'connected'
                    ? '断开'
                    : '连接'}
              </span>
            </button>
          </div>
        </div>

        <div className="section">
          <h2 className="section-title">语义引擎</h2>
          <div className="semantic-engine-card">
            <div className="semantic-engine-status">
              <div className="status-info">
                <span className={`status-dot ${getSemanticEngineStatusClass()}`}></span>
                <span className="status-text">{getSemanticEngineStatusText()}</span>
              </div>
              {semanticEngineLastUpdated && (
                <div className="status-timestamp">
                  最后更新:
                  {new Date(semanticEngineLastUpdated).toLocaleTimeString()}
                </div>
              )}
            </div>

            <ProgressIndicator
              visible={isSemanticEngineInitializing}
              text={semanticEngineInitProgress}
              showSpinner={true}
            />

            <button
              className="semantic-engine-button"
              disabled={isSemanticEngineInitializing}
              onClick={handleInitializeSemanticEngine}
            >
              <BoltIcon />
              <span>{getSemanticEngineButtonText()}</span>
            </button>
          </div>
        </div>

        <div className="section">
          <h2 className="section-title">Embedding模型</h2>

          <ProgressIndicator
            visible={isModelSwitching || isModelDownloading}
            text={getProgressText()}
            showSpinner={true}
          />
          {modelInitializationStatus === 'error' && (
            <div className="error-card">
              <div className="error-content">
                <div className="error-icon">⚠️</div>
                <div className="error-details">
                  <p className="error-title">语义引擎初始化失败</p>
                  <p className="error-message">{modelErrorMessage || '语义引擎初始化失败'}</p>
                  <p className="error-suggestion">{getErrorTypeText()}</p>
                </div>
              </div>
              <button
                className="retry-button"
                onClick={handleRetryModelInitialization}
                disabled={isModelSwitching || isModelDownloading}
              >
                <span>🔄</span>
                <span>重试</span>
              </button>
            </div>
          )}

          <div className="model-list">
            {availableModels.map((model) => (
              <div
                key={model.preset}
                className={`model-card ${currentModel === model.preset ? 'selected' : ''} ${
                  isModelSwitching || isModelDownloading ? 'disabled' : ''
                }`}
                onClick={() => {
                  if (!isModelSwitching && !isModelDownloading) {
                    handleSwitchModel(model.preset as ModelPreset);
                  }
                }}
              >
                <div className="model-header">
                  <div className="model-info">
                    <p
                      className={`model-name ${currentModel === model.preset ? 'selected-text' : ''}`}
                    >
                      {model.preset}
                    </p>
                    <p className="model-description">{getModelDescription(model)}</p>
                  </div>
                  {currentModel === model.preset && (
                    <div className="check-icon">
                      <CheckIcon className="text-white" />
                    </div>
                  )}
                </div>
                <div className="model-tags">
                  <span className="model-tag performance">
                    {getPerformanceText(model.performance)}
                  </span>
                  <span className="model-tag size">{model.size}</span>
                  <span className="model-tag dimension">{model.dimension}D</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <h2 className="section-title">索引数据管理</h2>
          <div className="stats-grid">
            <div className="stats-card">
              <div className="stats-header">
                <p className="stats-label">已索引页面</p>
                <span className="stats-icon violet">
                  <DocumentIcon />
                </span>
              </div>
              <p className="stats-value">{storageStats?.indexedPages || 0}</p>
            </div>

            <div className="stats-card">
              <div className="stats-header">
                <p className="stats-label">索引大小</p>
                <span className="stats-icon teal">
                  <DatabaseIcon />
                </span>
              </div>
              <p className="stats-value">{formatIndexSize()}</p>
            </div>

            <div className="stats-card">
              <div className="stats-header">
                <p className="stats-label">活跃标签页</p>
                <span className="stats-icon blue">
                  <TabIcon />
                </span>
              </div>
              <p className="stats-value">{getActiveTabsCount()}</p>
            </div>

            <div className="stats-card">
              <div className="stats-header">
                <p className="stats-label">向量文档</p>
                <span className="stats-icon green">
                  <VectorIcon />
                </span>
              </div>
              <p className="stats-value">{storageStats?.totalDocuments || 0}</p>
            </div>
          </div>
          <ProgressIndicator
            visible={isClearingData && !!clearDataProgress}
            text={clearDataProgress}
            showSpinner={true}
          />

          <button
            className="danger-button"
            disabled={isClearingData}
            onClick={() => setShowClearConfirmation(true)}
          >
            <TrashIcon />
            <span>{isClearingData ? '清空中...' : '清空所有数据'}</span>
          </button>
        </div>

        {/* 模型缓存管理区块 */}
        <ModelCacheManagement
          cacheStats={cacheStats}
          isManagingCache={isManagingCache}
          onCleanupCache={handleCleanupCache}
          onClearAllCache={handleClearAllCache}
        />
      </div>

      <div className="footer">
        <p className="footer-text">chrome mcp server for ai</p>
      </div>

      <ConfirmDialog
        visible={showClearConfirmation}
        title="确认清空数据"
        message="此操作将清空所有已索引的网页内容和向量数据，包括："
        items={['所有网页的文本内容索引', '向量嵌入数据', '搜索历史和缓存']}
        warning="此操作不可撤销！清空后需要重新浏览网页来重建索引。"
        icon="⚠️"
        confirmText="确认清空"
        cancelText="取消"
        confirmingText="清空中..."
        isConfirming={isClearingData}
        onConfirm={handleConfirmClearAllData}
        onCancel={() => setShowClearConfirmation(false)}
      />
    </div>
  );
};

export default App;
