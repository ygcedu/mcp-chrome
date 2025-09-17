import { initNativeHostListener } from './native-host';
import {
  initSemanticSimilarityListener,
  initializeSemanticEngineIfCached,
} from './semantic-similarity';
import { initStorageManagerListener } from './storage-manager';
import { cleanupModelCache } from '@/utils/semantic-similarity-engine';

/**
 * 后台脚本入口点
 * 初始化所有后台服务和监听器
 */
export default defineBackground(() => {
  // 初始化核心服务
  initNativeHostListener();
  initSemanticSimilarityListener();
  initStorageManagerListener();

  // 如果模型缓存存在，有条件地初始化语义相似度引擎
  initializeSemanticEngineIfCached()
    .then((initialized) => {
      if (initialized) {
        console.log('后台：语义相似度引擎已从缓存初始化');
      } else {
        console.log('后台：跳过语义相似度引擎初始化（未找到缓存）');
      }
    })
    .catch((error) => {
      console.warn('后台：有条件初始化语义引擎失败：', error);
    });

  // 启动时的初始清理
  cleanupModelCache().catch((error) => {
    console.warn('后台：初始缓存清理失败：', error);
  });
});
