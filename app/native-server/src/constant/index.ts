export enum NATIVE_MESSAGE_TYPE {
  START = 'start',
  STARTED = 'started',
  STOP = 'stop',
  STOPPED = 'stopped',
  PING = 'ping',
  PONG = 'pong',
  ERROR = 'error',
}

export const NATIVE_SERVER_PORT = 56889;

// 超时常量（以毫秒为单位）
export const TIMEOUTS = {
  DEFAULT_REQUEST_TIMEOUT: 15000,
  EXTENSION_REQUEST_TIMEOUT: 20000,
  PROCESS_DATA_TIMEOUT: 20000,
} as const;

// 服务器配置
export const SERVER_CONFIG = {
  HOST: '127.0.0.1',
  CORS_ORIGIN: true,
  LOGGER_ENABLED: false,
} as const;

// HTTP 状态码
export const HTTP_STATUS = {
  OK: 200,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  INTERNAL_SERVER_ERROR: 500,
  GATEWAY_TIMEOUT: 504,
} as const;

// 错误消息
export const ERROR_MESSAGES = {
  NATIVE_HOST_NOT_AVAILABLE: '未建立本地主机连接。',
  SERVER_NOT_RUNNING: '服务器未正在运行。',
  REQUEST_TIMEOUT: '对扩展的请求超时。',
  INVALID_MCP_REQUEST: '无效的 MCP 请求或会话。',
  INVALID_SESSION_ID: '无效或缺失的 MCP 会话 ID。',
  INTERNAL_SERVER_ERROR: '内部服务器错误',
  MCP_SESSION_DELETION_ERROR: 'MCP 会话删除过程中的内部服务器错误。',
  MCP_REQUEST_PROCESSING_ERROR: 'MCP 请求处理过程中的内部服务器错误。',
  INVALID_SSE_SESSION: 'SSE 的无效或缺失的 MCP 会话 ID。',
} as const;
