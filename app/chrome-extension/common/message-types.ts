/**
 * Chrome 扩展通信的统一消息类型常量
 * 注意：原生消息类型从共享包中导入
 */

// 路由的消息目标
export enum MessageTarget {
  Offscreen = 'offscreen',
  ContentScript = 'content_script',
  Background = 'background',
}

// 后台脚本消息类型
export const BACKGROUND_MESSAGE_TYPES = {
  SWITCH_SEMANTIC_MODEL: 'switch_semantic_model',
  GET_MODEL_STATUS: 'get_model_status',
  UPDATE_MODEL_STATUS: 'update_model_status',
  GET_STORAGE_STATS: 'get_storage_stats',
  CLEAR_ALL_DATA: 'clear_all_data',
  GET_SERVER_STATUS: 'get_server_status',
  REFRESH_SERVER_STATUS: 'refresh_server_status',
  SERVER_STATUS_CHANGED: 'server_status_changed',
  INITIALIZE_SEMANTIC_ENGINE: 'initialize_semantic_engine',
} as const;

// 离屏消息类型
export const OFFSCREEN_MESSAGE_TYPES = {
  SIMILARITY_ENGINE_INIT: 'similarityEngineInit',
  SIMILARITY_ENGINE_COMPUTE: 'similarityEngineCompute',
  SIMILARITY_ENGINE_BATCH_COMPUTE: 'similarityEngineBatchCompute',
  SIMILARITY_ENGINE_STATUS: 'similarityEngineStatus',
} as const;

// 内容脚本消息类型
export const CONTENT_MESSAGE_TYPES = {
  WEB_FETCHER_GET_TEXT_CONTENT: 'webFetcherGetTextContent',
  WEB_FETCHER_GET_HTML_CONTENT: 'getHtmlContent',
  NETWORK_CAPTURE_PING: 'network_capture_ping',
  CLICK_HELPER_PING: 'click_helper_ping',
  FILL_HELPER_PING: 'fill_helper_ping',
  HOVER_HELPER_PING: 'hover_helper_ping',
  KEYBOARD_HELPER_PING: 'keyboard_helper_ping',
  SCREENSHOT_HELPER_PING: 'screenshot_helper_ping',
  INTERACTIVE_ELEMENTS_HELPER_PING: 'interactive_elements_helper_ping',
} as const;

// 工具操作消息类型（用于 chrome.runtime.sendMessage）
export const TOOL_MESSAGE_TYPES = {
  // 截图相关
  SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE: 'preparePageForCapture',
  SCREENSHOT_GET_PAGE_DETAILS: 'getPageDetails',
  SCREENSHOT_GET_ELEMENT_DETAILS: 'getElementDetails',
  SCREENSHOT_SCROLL_PAGE: 'scrollPage',
  SCREENSHOT_RESET_PAGE_AFTER_CAPTURE: 'resetPageAfterCapture',

  // 网页内容获取
  WEB_FETCHER_GET_HTML_CONTENT: 'getHtmlContent',
  WEB_FETCHER_GET_TEXT_CONTENT: 'getTextContent',

  // 用户交互
  CLICK_ELEMENT: 'clickElement',
  FILL_ELEMENT: 'fillElement',
  HOVER_ELEMENT: 'hoverElement',
  SIMULATE_KEYBOARD: 'simulateKeyboard',

  // 交互元素
  GET_INTERACTIVE_ELEMENTS: 'getInteractiveElements',

  // 网络请求
  NETWORK_SEND_REQUEST: 'sendPureNetworkRequest',

  // 语义相似度引擎
  SIMILARITY_ENGINE_INIT: 'similarityEngineInit',
  SIMILARITY_ENGINE_COMPUTE_BATCH: 'similarityEngineComputeBatch',
} as const;

// 类型安全的类型联合
export type BackgroundMessageType =
  (typeof BACKGROUND_MESSAGE_TYPES)[keyof typeof BACKGROUND_MESSAGE_TYPES];
export type OffscreenMessageType =
  (typeof OFFSCREEN_MESSAGE_TYPES)[keyof typeof OFFSCREEN_MESSAGE_TYPES];
export type ContentMessageType = (typeof CONTENT_MESSAGE_TYPES)[keyof typeof CONTENT_MESSAGE_TYPES];
export type ToolMessageType = (typeof TOOL_MESSAGE_TYPES)[keyof typeof TOOL_MESSAGE_TYPES];

// 向后兼容的遗留枚举（将被弃用）
export enum SendMessageType {
  // 截图相关消息类型
  ScreenshotPreparePageForCapture = 'preparePageForCapture',
  ScreenshotGetPageDetails = 'getPageDetails',
  ScreenshotGetElementDetails = 'getElementDetails',
  ScreenshotScrollPage = 'scrollPage',
  ScreenshotResetPageAfterCapture = 'resetPageAfterCapture',

  // 网页内容获取相关消息类型
  WebFetcherGetHtmlContent = 'getHtmlContent',
  WebFetcherGetTextContent = 'getTextContent',

  // 点击相关消息类型
  ClickElement = 'clickElement',

  // 输入填充相关消息类型
  FillElement = 'fillElement',

  // 交互元素相关消息类型
  GetInteractiveElements = 'getInteractiveElements',

  // 网络请求捕获相关消息类型
  NetworkSendRequest = 'sendPureNetworkRequest',

  // 键盘事件相关消息类型
  SimulateKeyboard = 'simulateKeyboard',

  // 语义相似度引擎相关消息类型
  SimilarityEngineInit = 'similarityEngineInit',
  SimilarityEngineComputeBatch = 'similarityEngineComputeBatch',
}
