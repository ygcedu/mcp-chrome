import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { LIMITS, NETWORK_FILTERS } from '@/common/constants';

// 静态资源文件扩展名
const STATIC_RESOURCE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.bmp', // 图像
  '.css',
  '.scss',
  '.less', // 样式
  '.js',
  '.jsx',
  '.ts',
  '.tsx', // 脚本
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf', // 字体
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.ogg',
  '.wav', // 媒体
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx', // 文档
];

// 广告和分析域名列表
const AD_ANALYTICS_DOMAINS = NETWORK_FILTERS.EXCLUDED_DOMAINS;

interface NetworkCaptureStartToolParams {
  tabId?: number; // 指定标签页ID。如果未提供，使用活动标签页或如果提供了url则创建新标签页。
  url?: string; // 要导航到或聚焦的URL。如果未提供，使用活动标签页。
  maxCaptureTime?: number; // 最大捕获时间（毫秒）
  inactivityTimeout?: number; // 非活动超时（毫秒）
  includeStatic?: boolean; // 是否包含静态资源
}

interface NetworkRequestInfo {
  requestId: string;
  url: string;
  method: string;
  type: string;
  requestTime: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseTime?: number;
  status?: number;
  statusText?: string;
  responseSize?: number;
  responseType?: string;
  responseBody?: string;
  errorText?: string;
  specificRequestHeaders?: Record<string, string>;
  specificResponseHeaders?: Record<string, string>;
  mimeType?: string; // 响应MIME类型
}

interface CaptureInfo {
  tabId: number;
  tabUrl: string;
  tabTitle: string;
  startTime: number;
  endTime?: number;
  requests: Record<string, NetworkRequestInfo>;
  maxCaptureTime: number;
  inactivityTimeout: number;
  includeStatic: boolean;
  limitReached?: boolean; // 是否达到请求计数限制
}

/**
 * 网络捕获启动工具V2 - 使用Chrome webRequest API开始捕获网络请求
 */
class NetworkCaptureStartTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NETWORK_CAPTURE_START;
  public static instance: NetworkCaptureStartTool | null = null;
  public captureData: Map<number, CaptureInfo> = new Map(); // tabId -> 捕获数据
  private captureTimers: Map<number, NodeJS.Timeout> = new Map(); // tabId -> 最大捕获计时器
  private inactivityTimers: Map<number, NodeJS.Timeout> = new Map(); // tabId -> 非活动计时器
  private lastActivityTime: Map<number, number> = new Map(); // tabId -> 最后活动的时间戳
  private requestCounters: Map<number, number> = new Map(); // tabId -> 捕获请求的计数
  public static MAX_REQUESTS_PER_CAPTURE = LIMITS.MAX_NETWORK_REQUESTS; // 最大捕获请求计数
  private listeners: { [key: string]: (details: any) => void } = {};

  // 静态资源MIME类型列表（用于过滤）
  private static STATIC_MIME_TYPES_TO_FILTER = [
    'image/', // 所有图像类型
    'font/', // 所有字体类型
    'audio/', // 所有音频类型
    'video/', // 所有视频类型
    'text/css',
    'text/javascript',
    'application/javascript',
    'application/x-javascript',
    'application/pdf',
    'application/zip',
    'application/octet-stream', // 通常用于下载或通用二进制数据
  ];

  // API响应MIME类型列表（这些类型通常不被过滤）
  private static API_MIME_TYPES = [
    'application/json',
    'application/xml',
    'text/xml',
    'application/x-www-form-urlencoded',
    'application/graphql',
    'application/grpc',
    'application/protobuf',
    'application/x-protobuf',
    'application/x-json',
    'application/ld+json',
    'application/problem+json',
    'application/problem+xml',
    'application/soap+xml',
    'application/vnd.api+json',
  ];

  constructor() {
    super();
    if (NetworkCaptureStartTool.instance) {
      return NetworkCaptureStartTool.instance;
    }
    NetworkCaptureStartTool.instance = this;

    // 监听标签页关闭事件
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
    // 监听标签页创建事件
    chrome.tabs.onCreated.addListener(this.handleTabCreated.bind(this));
  }

  /**
   * 处理标签页关闭事件
   */
  private handleTabRemoved(tabId: number) {
    if (this.captureData.has(tabId)) {
      console.log(`网络捕获V2: 标签页 ${tabId} 已关闭，清理资源。`);
      this.cleanupCapture(tabId);
    }
  }

  /**
   * 处理标签页创建事件
   * 如果从正在捕获的标签页打开新标签页，自动开始捕获新标签页的请求
   */
  private async handleTabCreated(tab: chrome.tabs.Tab) {
    try {
      // 检查是否有任何标签页正在捕获
      if (this.captureData.size === 0) return;

      // 获取新标签页的openerTabId（打开此标签页的标签页ID）
      const openerTabId = tab.openerTabId;
      if (!openerTabId) return;

      // 检查打开者标签页是否正在捕获
      if (!this.captureData.has(openerTabId)) return;

      // 获取新标签页的ID
      const newTabId = tab.id;
      if (!newTabId) return;

      console.log(
        `网络捕获V2: 从捕获标签页 ${openerTabId} 创建了新标签页 ${newTabId}，将扩展捕获到它。`,
      );

      // 获取打开者标签页的捕获设置
      const openerCaptureInfo = this.captureData.get(openerTabId);
      if (!openerCaptureInfo) return;

      // 等待一小段时间以确保标签页准备就绪
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 开始为新标签页捕获请求
      await this.startCaptureForTab(newTabId, {
        maxCaptureTime: openerCaptureInfo.maxCaptureTime,
        inactivityTimeout: openerCaptureInfo.inactivityTimeout,
        includeStatic: openerCaptureInfo.includeStatic,
      });

      console.log(`网络捕获V2: 成功扩展捕获到新标签页 ${newTabId}`);
    } catch (error) {
      console.error(`网络捕获V2: 扩展捕获到新标签页时出错:`, error);
    }
  }

  /**
   * 确定是否应该过滤请求（基于URL）
   */
  private shouldFilterRequest(url: string, includeStatic: boolean): boolean {
    try {
      const urlObj = new URL(url);

      // 检查是否是广告或分析域名
      if (AD_ANALYTICS_DOMAINS.some((domain) => urlObj.hostname.includes(domain))) {
        console.log(`网络捕获V2: 过滤广告/分析域名: ${urlObj.hostname}`);
        return true;
      }

      // 如果不包含静态资源，检查扩展名
      if (!includeStatic) {
        const path = urlObj.pathname.toLowerCase();
        if (STATIC_RESOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
          console.log(`网络捕获V2: 按扩展名过滤静态资源: ${path}`);
          return true;
        }
      }

      return false;
    } catch (e) {
      console.error('网络捕获V2: 过滤URL时出错:', e);
      return false;
    }
  }

  /**
   * 基于MIME类型过滤
   */
  private shouldFilterByMimeType(mimeType: string, includeStatic: boolean): boolean {
    if (!mimeType) return false;

    // 始终保留API响应类型
    if (NetworkCaptureStartTool.API_MIME_TYPES.some((type) => mimeType.startsWith(type))) {
      return false;
    }

    // 如果不包含静态资源，过滤掉静态资源MIME类型
    if (!includeStatic) {
      // 过滤静态资源MIME类型
      if (
        NetworkCaptureStartTool.STATIC_MIME_TYPES_TO_FILTER.some((type) =>
          mimeType.startsWith(type),
        )
      ) {
        console.log(`网络捕获V2: 按MIME类型过滤静态资源: ${mimeType}`);
        return true;
      }

      // 过滤所有以text/开头的MIME类型（除了已在API_MIME_TYPES中的）
      if (mimeType.startsWith('text/')) {
        console.log(`网络捕获V2: 过滤文本响应: ${mimeType}`);
        return true;
      }
    }

    return false;
  }

  /**
   * 更新最后活动时间并重置非活动计时器
   */
  private updateLastActivityTime(tabId: number): void {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    this.lastActivityTime.set(tabId, Date.now());

    // 重置非活动计时器
    if (this.inactivityTimers.has(tabId)) {
      clearTimeout(this.inactivityTimers.get(tabId)!);
    }

    if (captureInfo.inactivityTimeout > 0) {
      this.inactivityTimers.set(
        tabId,
        setTimeout(() => this.checkInactivity(tabId), captureInfo.inactivityTimeout),
      );
    }
  }

  /**
   * 检查非活动状态
   */
  private checkInactivity(tabId: number): void {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    const lastActivity = this.lastActivityTime.get(tabId) || captureInfo.startTime;
    const now = Date.now();
    const inactiveTime = now - lastActivity;

    if (inactiveTime >= captureInfo.inactivityTimeout) {
      console.log(`网络捕获V2: 无活动 ${inactiveTime}ms，停止标签页 ${tabId} 的捕获`);
      this.stopCaptureByInactivity(tabId);
    } else {
      // 如果尚未达到非活动时间，继续检查
      const remainingTime = captureInfo.inactivityTimeout - inactiveTime;
      this.inactivityTimers.set(
        tabId,
        setTimeout(() => this.checkInactivity(tabId), remainingTime),
      );
    }
  }

  /**
   * 由于非活动停止捕获
   */
  private async stopCaptureByInactivity(tabId: number): Promise<void> {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    console.log(`网络捕获V2: 由于非活动停止标签页 ${tabId} 的捕获`);
    await this.stopCapture(tabId);
  }

  /**
   * 清理捕获资源
   */
  private cleanupCapture(tabId: number): void {
    // 清除计时器
    if (this.captureTimers.has(tabId)) {
      clearTimeout(this.captureTimers.get(tabId)!);
      this.captureTimers.delete(tabId);
    }

    if (this.inactivityTimers.has(tabId)) {
      clearTimeout(this.inactivityTimers.get(tabId)!);
      this.inactivityTimers.delete(tabId);
    }

    // 移除数据
    this.lastActivityTime.delete(tabId);
    this.captureData.delete(tabId);
    this.requestCounters.delete(tabId);

    console.log(`网络捕获V2: 已清理标签页 ${tabId} 的所有资源`);
  }

  /**
   * 设置请求监听器
   */
  private setupListeners(): void {
    // 发送请求之前
    this.listeners.onBeforeRequest = (details: chrome.webRequest.WebRequestBodyDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo) return;

      if (this.shouldFilterRequest(details.url, captureInfo.includeStatic)) {
        return;
      }

      const currentCount = this.requestCounters.get(details.tabId) || 0;
      if (currentCount >= NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE) {
        console.log(
          `网络捕获V2: 标签页 ${details.tabId} 达到请求限制 (${NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE})，忽略新请求: ${details.url}`,
        );
        captureInfo.limitReached = true;
        return;
      }

      this.requestCounters.set(details.tabId, currentCount + 1);
      this.updateLastActivityTime(details.tabId);

      if (!captureInfo.requests[details.requestId]) {
        captureInfo.requests[details.requestId] = {
          requestId: details.requestId,
          url: details.url,
          method: details.method,
          type: details.type,
          requestTime: details.timeStamp,
        };

        if (details.requestBody) {
          const requestBody = this.processRequestBody(details.requestBody);
          if (requestBody) {
            captureInfo.requests[details.requestId].requestBody = requestBody;
          }
        }

        console.log(
          `网络捕获V2: 为标签页 ${details.tabId} 捕获请求 ${currentCount + 1}/${NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE}: ${details.method} ${details.url}`,
        );
      }
    };

    // 发送请求头
    this.listeners.onSendHeaders = (details: chrome.webRequest.WebRequestHeadersDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo || !captureInfo.requests[details.requestId]) return;

      if (details.requestHeaders) {
        const headers: Record<string, string> = {};
        details.requestHeaders.forEach((header) => {
          headers[header.name] = header.value || '';
        });
        captureInfo.requests[details.requestId].requestHeaders = headers;
      }
    };

    // 接收响应头
    this.listeners.onHeadersReceived = (details: chrome.webRequest.WebResponseHeadersDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo || !captureInfo.requests[details.requestId]) return;

      const requestInfo = captureInfo.requests[details.requestId];

      requestInfo.status = details.statusCode;
      requestInfo.statusText = details.statusLine;
      requestInfo.responseTime = details.timeStamp;
      requestInfo.mimeType = details.responseHeaders?.find(
        (h) => h.name.toLowerCase() === 'content-type',
      )?.value;

      // 基于MIME类型的二次过滤
      if (
        requestInfo.mimeType &&
        this.shouldFilterByMimeType(requestInfo.mimeType, captureInfo.includeStatic)
      ) {
        delete captureInfo.requests[details.requestId];

        const currentCount = this.requestCounters.get(details.tabId) || 0;
        if (currentCount > 0) {
          this.requestCounters.set(details.tabId, currentCount - 1);
        }

        console.log(`网络捕获V2: 按MIME类型过滤请求 (${requestInfo.mimeType}): ${requestInfo.url}`);
        return;
      }

      if (details.responseHeaders) {
        const headers: Record<string, string> = {};
        details.responseHeaders.forEach((header) => {
          headers[header.name] = header.value || '';
        });
        requestInfo.responseHeaders = headers;
      }

      this.updateLastActivityTime(details.tabId);
    };

    // 请求完成
    this.listeners.onCompleted = (details: chrome.webRequest.WebResponseCacheDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo || !captureInfo.requests[details.requestId]) return;

      const requestInfo = captureInfo.requests[details.requestId];
      if ('responseSize' in details) {
        requestInfo.responseSize = details.fromCache ? 0 : (details as any).responseSize;
      }

      this.updateLastActivityTime(details.tabId);
    };

    // 请求失败
    this.listeners.onErrorOccurred = (details: chrome.webRequest.WebResponseErrorDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo || !captureInfo.requests[details.requestId]) return;

      const requestInfo = captureInfo.requests[details.requestId];
      requestInfo.errorText = details.error;

      this.updateLastActivityTime(details.tabId);
    };

    // 注册所有监听器
    chrome.webRequest.onBeforeRequest.addListener(
      this.listeners.onBeforeRequest,
      { urls: ['<all_urls>'] },
      ['requestBody'],
    );

    chrome.webRequest.onSendHeaders.addListener(
      this.listeners.onSendHeaders,
      { urls: ['<all_urls>'] },
      ['requestHeaders'],
    );

    chrome.webRequest.onHeadersReceived.addListener(
      this.listeners.onHeadersReceived,
      { urls: ['<all_urls>'] },
      ['responseHeaders'],
    );

    chrome.webRequest.onCompleted.addListener(this.listeners.onCompleted, { urls: ['<all_urls>'] });

    chrome.webRequest.onErrorOccurred.addListener(this.listeners.onErrorOccurred, {
      urls: ['<all_urls>'],
    });
  }

  /**
   * 移除所有请求监听器
   * 只有当所有标签页捕获都停止时才移除监听器
   */
  private removeListeners(): void {
    // 如果仍有标签页在捕获，不要移除监听器
    if (this.captureData.size > 0) {
      console.log(`网络捕获V2: 仍在 ${this.captureData.size} 个标签页上捕获，不移除监听器。`);
      return;
    }

    console.log(`网络捕获V2: 没有更多活动捕获，移除所有监听器。`);

    if (this.listeners.onBeforeRequest) {
      chrome.webRequest.onBeforeRequest.removeListener(this.listeners.onBeforeRequest);
    }

    if (this.listeners.onSendHeaders) {
      chrome.webRequest.onSendHeaders.removeListener(this.listeners.onSendHeaders);
    }

    if (this.listeners.onHeadersReceived) {
      chrome.webRequest.onHeadersReceived.removeListener(this.listeners.onHeadersReceived);
    }

    if (this.listeners.onCompleted) {
      chrome.webRequest.onCompleted.removeListener(this.listeners.onCompleted);
    }

    if (this.listeners.onErrorOccurred) {
      chrome.webRequest.onErrorOccurred.removeListener(this.listeners.onErrorOccurred);
    }

    // 清除监听器对象
    this.listeners = {};
  }

  /**
   * 处理请求体数据
   */
  private processRequestBody(requestBody: chrome.webRequest.WebRequestBody): string | undefined {
    if (requestBody.raw && requestBody.raw.length > 0) {
      return '[二进制数据]';
    } else if (requestBody.formData) {
      return JSON.stringify(requestBody.formData);
    }
    return undefined;
  }

  /**
   * 为指定标签页开始网络请求捕获
   * @param tabId 标签页ID
   * @param options 捕获选项
   */
  private async startCaptureForTab(
    tabId: number,
    options: {
      maxCaptureTime: number;
      inactivityTimeout: number;
      includeStatic: boolean;
    },
  ): Promise<void> {
    const { maxCaptureTime, inactivityTimeout, includeStatic } = options;

    // 如果已经在捕获，先停止
    if (this.captureData.has(tabId)) {
      console.log(`网络捕获V2: 标签页 ${tabId} 已在捕获。停止之前的会话。`);
      await this.stopCapture(tabId);
    }

    try {
      // 获取标签页信息
      const tab = await chrome.tabs.get(tabId);

      // 初始化捕获数据
      this.captureData.set(tabId, {
        tabId: tabId,
        tabUrl: tab.url || '',
        tabTitle: tab.title || '',
        startTime: Date.now(),
        requests: {},
        maxCaptureTime,
        inactivityTimeout,
        includeStatic,
        limitReached: false,
      });

      // 初始化请求计数器
      this.requestCounters.set(tabId, 0);

      // 设置监听器
      this.setupListeners();

      // 更新最后活动时间
      this.updateLastActivityTime(tabId);

      console.log(
        `网络捕获V2: 开始为标签页 ${tabId} (${tab.url}) 捕获。最大请求数: ${NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE}，最大时间: ${maxCaptureTime}ms，非活动: ${inactivityTimeout}ms。`,
      );

      // 设置最大捕获时间
      if (maxCaptureTime > 0) {
        this.captureTimers.set(
          tabId,
          setTimeout(async () => {
            console.log(`网络捕获V2: 标签页 ${tabId} 达到最大捕获时间 (${maxCaptureTime}ms)。`);
            await this.stopCapture(tabId);
          }, maxCaptureTime),
        );
      }
    } catch (error: any) {
      console.error(`网络捕获V2: 为标签页 ${tabId} 开始捕获时出错:`, error);

      // 清理资源
      if (this.captureData.has(tabId)) {
        this.cleanupCapture(tabId);
      }

      throw error;
    }
  }

  /**
   * 停止捕获
   * @param tabId 标签页ID
   */
  public async stopCapture(
    tabId: number,
  ): Promise<{ success: boolean; message?: string; data?: any }> {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) {
      console.log(`网络捕获V2: 标签页 ${tabId} 没有正在进行的捕获`);
      return { success: false, message: `标签页 ${tabId} 没有正在进行的捕获` };
    }

    try {
      // 记录结束时间
      captureInfo.endTime = Date.now();

      // 提取公共请求和响应头
      const requestsArray = Object.values(captureInfo.requests);
      const commonRequestHeaders = this.analyzeCommonHeaders(requestsArray, 'requestHeaders');
      const commonResponseHeaders = this.analyzeCommonHeaders(requestsArray, 'responseHeaders');

      // 处理请求数据，移除公共头
      const processedRequests = requestsArray.map((req) => {
        const finalReq: NetworkRequestInfo = { ...req };

        if (finalReq.requestHeaders) {
          finalReq.specificRequestHeaders = this.filterOutCommonHeaders(
            finalReq.requestHeaders,
            commonRequestHeaders,
          );
          delete finalReq.requestHeaders;
        } else {
          finalReq.specificRequestHeaders = {};
        }

        if (finalReq.responseHeaders) {
          finalReq.specificResponseHeaders = this.filterOutCommonHeaders(
            finalReq.responseHeaders,
            commonResponseHeaders,
          );
          delete finalReq.responseHeaders;
        } else {
          finalReq.specificResponseHeaders = {};
        }

        return finalReq;
      });

      // 按时间排序
      processedRequests.sort((a, b) => (a.requestTime || 0) - (b.requestTime || 0));

      // 移除监听器
      this.removeListeners();

      // 准备结果数据
      const resultData = {
        captureStartTime: captureInfo.startTime,
        captureEndTime: captureInfo.endTime,
        totalDurationMs: captureInfo.endTime - captureInfo.startTime,
        settingsUsed: {
          maxCaptureTime: captureInfo.maxCaptureTime,
          inactivityTimeout: captureInfo.inactivityTimeout,
          includeStatic: captureInfo.includeStatic,
          maxRequests: NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE,
        },
        commonRequestHeaders,
        commonResponseHeaders,
        requests: processedRequests,
        requestCount: processedRequests.length,
        totalRequestsReceived: this.requestCounters.get(tabId) || 0,
        requestLimitReached: captureInfo.limitReached || false,
        tabUrl: captureInfo.tabUrl,
        tabTitle: captureInfo.tabTitle,
      };

      // 清理资源
      this.cleanupCapture(tabId);

      return {
        success: true,
        data: resultData,
      };
    } catch (error: any) {
      console.error(`网络捕获V2: 停止标签页 ${tabId} 捕获时出错:`, error);

      // 确保资源被清理
      this.cleanupCapture(tabId);

      return {
        success: false,
        message: `停止捕获时出错: ${error.message || String(error)}`,
      };
    }
  }

  /**
   * 分析公共请求或响应头
   */
  private analyzeCommonHeaders(
    requests: NetworkRequestInfo[],
    headerType: 'requestHeaders' | 'responseHeaders',
  ): Record<string, string> {
    if (!requests || requests.length === 0) return {};

    // 查找所有请求中都包含的头部
    const commonHeaders: Record<string, string> = {};
    const firstRequestWithHeaders = requests.find(
      (req) => req[headerType] && Object.keys(req[headerType] || {}).length > 0,
    );

    if (!firstRequestWithHeaders || !firstRequestWithHeaders[headerType]) {
      return {};
    }

    // 从第一个请求获取所有头部
    const headers = firstRequestWithHeaders[headerType] as Record<string, string>;
    const headerNames = Object.keys(headers);

    // 检查每个头部是否在所有请求中都存在且值相同
    for (const name of headerNames) {
      const value = headers[name];
      const isCommon = requests.every((req) => {
        const reqHeaders = req[headerType] as Record<string, string>;
        return reqHeaders && reqHeaders[name] === value;
      });

      if (isCommon) {
        commonHeaders[name] = value;
      }
    }

    return commonHeaders;
  }

  /**
   * 过滤掉公共头部
   */
  private filterOutCommonHeaders(
    headers: Record<string, string>,
    commonHeaders: Record<string, string>,
  ): Record<string, string> {
    if (!headers || typeof headers !== 'object') return {};

    const specificHeaders: Record<string, string> = {};
    // 使用Object.keys避免ESLint no-prototype-builtins警告
    Object.keys(headers).forEach((name) => {
      if (!(name in commonHeaders) || headers[name] !== commonHeaders[name]) {
        specificHeaders[name] = headers[name];
      }
    });

    return specificHeaders;
  }

  async execute(args: NetworkCaptureStartToolParams): Promise<ToolResult> {
    const {
      tabId,
      url: targetUrl,
      maxCaptureTime = 3 * 60 * 1000, // 默认3分钟
      inactivityTimeout = 60 * 1000, // 默认1分钟非活动后自动停止
      includeStatic = false, // 默认：不包含静态资源
    } = args;

    console.log(`网络捕获启动工具: 使用参数执行:`, args);

    try {
      // 获取当前标签页或创建新标签页
      let tabToOperateOn: chrome.tabs.Tab;

      if (tabId) {
        // 使用指定的标签页
        try {
          tabToOperateOn = await chrome.tabs.get(tabId);
          console.log(`网络捕获V2: 使用指定的标签页 ${tabId}`);
        } catch (error) {
          return createErrorResponse(`Tab with ID ${tabId} not found`);
        }
      } else if (targetUrl) {
        // 查找匹配URL的标签页
        const matchingTabs = await chrome.tabs.query({ url: targetUrl });

        if (matchingTabs.length > 0) {
          // 使用现有标签页
          tabToOperateOn = matchingTabs[0];
          console.log(`网络捕获V2: 找到现有标签页，URL: ${targetUrl}`);
        } else {
          // 创建新标签页
          console.log(`网络捕获V2: 创建新标签页，URL: ${targetUrl}`);
          tabToOperateOn = await chrome.tabs.create({ url: targetUrl, active: true });

          // 等待页面加载
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } else {
        // 使用当前活动标签页
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) {
          return createErrorResponse('未找到活动标签页');
        }
        tabToOperateOn = tabs[0];
      }

      if (!tabToOperateOn?.id) {
        return createErrorResponse('无法识别或创建标签页');
      }

      // 使用startCaptureForTab方法开始捕获
      try {
        await this.startCaptureForTab(tabToOperateOn.id, {
          maxCaptureTime,
          inactivityTimeout,
          includeStatic,
        });
      } catch (error: any) {
        return createErrorResponse(
          `为标签页 ${tabToOperateOn.id} 开始捕获失败: ${error.message || String(error)}`,
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: '网络捕获V2成功启动，等待停止命令。',
              tabId: tabToOperateOn.id,
              url: tabToOperateOn.url,
              maxCaptureTime,
              inactivityTimeout,
              includeStatic,
              maxRequests: NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE,
            }),
          },
        ],
        isError: false,
      };
    } catch (error: any) {
      console.error('网络捕获启动工具: 严重错误:', error);
      return createErrorResponse(`网络捕获启动工具中出错: ${error.message || String(error)}`);
    }
  }
}

/**
 * 网络捕获停止工具V2 - 停止webRequest API捕获并返回结果
 */
class NetworkCaptureStopTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NETWORK_CAPTURE_STOP;
  public static instance: NetworkCaptureStopTool | null = null;

  constructor() {
    super();
    if (NetworkCaptureStopTool.instance) {
      return NetworkCaptureStopTool.instance;
    }
    NetworkCaptureStopTool.instance = this;
  }

  async execute(): Promise<ToolResult> {
    console.log(`网络捕获停止工具: 执行中`);

    try {
      const startTool = NetworkCaptureStartTool.instance;

      if (!startTool) {
        return createErrorResponse('未找到网络捕获V2启动工具实例');
      }

      // 获取当前正在捕获的所有标签页
      const ongoingCaptures = Array.from(startTool.captureData.keys());
      console.log(
        `网络捕获停止工具: 找到 ${ongoingCaptures.length} 个正在进行的捕获: ${ongoingCaptures.join(', ')}`,
      );

      if (ongoingCaptures.length === 0) {
        return createErrorResponse('在任何标签页中都未找到活动的网络捕获。');
      }

      // 获取当前活动标签页
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTabId = activeTabs[0]?.id;

      // 确定要停止的主要标签页
      let primaryTabId: number;

      if (activeTabId && startTool.captureData.has(activeTabId)) {
        // 如果当前活动标签页正在捕获，优先停止它
        primaryTabId = activeTabId;
        console.log(`网络捕获停止工具: 活动标签页 ${activeTabId} 正在捕获，将首先停止它。`);
      } else if (ongoingCaptures.length === 1) {
        // 如果只有一个标签页在捕获，停止它
        primaryTabId = ongoingCaptures[0];
        console.log(`网络捕获停止工具: 只有一个标签页 ${primaryTabId} 在捕获，停止它。`);
      } else {
        // 如果多个标签页在捕获但当前活动标签页不在其中，停止第一个
        primaryTabId = ongoingCaptures[0];
        console.log(
          `网络捕获停止工具: 多个标签页在捕获，活动标签页不在其中。首先停止标签页 ${primaryTabId}。`,
        );
      }

      const stopResult = await startTool.stopCapture(primaryTabId);

      if (!stopResult.success) {
        return createErrorResponse(
          stopResult.message || `停止标签页 ${primaryTabId} 的网络捕获失败`,
        );
      }

      // 如果多个标签页在捕获，停止其他标签页
      if (ongoingCaptures.length > 1) {
        const otherTabIds = ongoingCaptures.filter((id) => id !== primaryTabId);
        console.log(
          `网络捕获停止工具: 停止 ${otherTabIds.length} 个额外的捕获: ${otherTabIds.join(', ')}`,
        );

        for (const tabId of otherTabIds) {
          try {
            await startTool.stopCapture(tabId);
          } catch (error) {
            console.error(`网络捕获停止工具: 停止标签页 ${tabId} 的捕获时出错:`, error);
          }
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `捕获完成。捕获了 ${stopResult.data?.requestCount || 0} 个请求。`,
              tabId: primaryTabId,
              tabUrl: stopResult.data?.tabUrl || 'N/A',
              tabTitle: stopResult.data?.tabTitle || '未知标签页',
              requestCount: stopResult.data?.requestCount || 0,
              commonRequestHeaders: stopResult.data?.commonRequestHeaders || {},
              commonResponseHeaders: stopResult.data?.commonResponseHeaders || {},
              requests: stopResult.data?.requests || [],
              captureStartTime: stopResult.data?.captureStartTime,
              captureEndTime: stopResult.data?.captureEndTime,
              totalDurationMs: stopResult.data?.totalDurationMs,
              settingsUsed: stopResult.data?.settingsUsed || {},
              totalRequestsReceived: stopResult.data?.totalRequestsReceived || 0,
              requestLimitReached: stopResult.data?.requestLimitReached || false,
              remainingCaptures: Array.from(startTool.captureData.keys()),
            }),
          },
        ],
        isError: false,
      };
    } catch (error: any) {
      console.error('网络捕获停止工具: 严重错误:', error);
      return createErrorResponse(`网络捕获停止工具中出错: ${error.message || String(error)}`);
    }
  }
}

export const networkCaptureStartTool = new NetworkCaptureStartTool();
export const networkCaptureStopTool = new NetworkCaptureStopTool();
