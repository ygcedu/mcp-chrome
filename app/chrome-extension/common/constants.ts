/**
 * Chrome 扩展常量
 * 集中配置值和魔法常量
 */

// 原生主机配置
export const NATIVE_HOST = {
  NAME: 'com.chromemcp.nativehost',
  DEFAULT_PORT: 12306,
} as const;

// Chrome 扩展图标
export const ICONS = {
  NOTIFICATION: 'icon/48.png',
} as const;

// 超时和延迟（毫秒）
export const TIMEOUTS = {
  DEFAULT_WAIT: 1000,
  NETWORK_CAPTURE_MAX: 30000,
  NETWORK_CAPTURE_IDLE: 3000,
  SCREENSHOT_DELAY: 100,
  KEYBOARD_DELAY: 50,
  CLICK_DELAY: 100,
} as const;

// 限制和阈值
export const LIMITS = {
  MAX_NETWORK_REQUESTS: 100,
  MAX_SEARCH_RESULTS: 50,
  MAX_BOOKMARK_RESULTS: 100,
  MAX_HISTORY_RESULTS: 100,
  SIMILARITY_THRESHOLD: 0.1,
  VECTOR_DIMENSIONS: 384,
} as const;

// 错误消息
export const ERROR_MESSAGES = {
  NATIVE_CONNECTION_FAILED: '连接原生主机失败',
  NATIVE_DISCONNECTED: '原生连接已断开',
  SERVER_STATUS_LOAD_FAILED: '加载服务器状态失败',
  SERVER_STATUS_SAVE_FAILED: '保存服务器状态失败',
  TOOL_EXECUTION_FAILED: '工具执行失败',
  INVALID_PARAMETERS: '提供的参数无效',
  PERMISSION_DENIED: '权限被拒绝',
  TAB_NOT_FOUND: '未找到标签页',
  ELEMENT_NOT_FOUND: '未找到元素',
  NETWORK_ERROR: '网络错误',
} as const;

// 成功消息
export const SUCCESS_MESSAGES = {
  TOOL_EXECUTED: '工具执行成功',
  CONNECTION_ESTABLISHED: '连接已建立',
  SERVER_STARTED: '服务器启动成功',
  SERVER_STOPPED: '服务器停止成功',
} as const;

// 文件扩展名和 MIME 类型
export const FILE_TYPES = {
  STATIC_EXTENSIONS: [
    '.css',
    '.js',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
  ],
  FILTERED_MIME_TYPES: ['text/html', 'text/css', 'text/javascript', 'application/javascript'],
  IMAGE_FORMATS: ['png', 'jpeg', 'webp'] as const,
} as const;

// 网络过滤
export const NETWORK_FILTERS = {
  EXCLUDED_DOMAINS: [
    'google-analytics.com',
    'googletagmanager.com',
    'facebook.com',
    'doubleclick.net',
    'googlesyndication.com',
  ],
  STATIC_RESOURCE_TYPES: ['stylesheet', 'image', 'font', 'media', 'other'],
} as const;

// 语义相似度配置
export const SEMANTIC_CONFIG = {
  DEFAULT_MODEL: 'sentence-transformers/all-MiniLM-L6-v2',
  CHUNK_SIZE: 512,
  CHUNK_OVERLAP: 50,
  BATCH_SIZE: 32,
  CACHE_SIZE: 1000,
} as const;

// 存储键
export const STORAGE_KEYS = {
  SERVER_STATUS: 'serverStatus',
  SEMANTIC_MODEL: 'selectedModel',
  USER_PREFERENCES: 'userPreferences',
  VECTOR_INDEX: 'vectorIndex',
} as const;

// 通知配置
export const NOTIFICATIONS = {
  PRIORITY: 2,
  TYPE: 'basic' as const,
} as const;

export enum ExecutionWorld {
  ISOLATED = 'ISOLATED',
  MAIN = 'MAIN',
}
