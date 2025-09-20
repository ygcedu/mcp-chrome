import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface NetworkDebuggerStartToolParams {
  tabId?: number; // Tab ID to capture from. If not provided, uses active tab or creates new tab if url is provided.
  url?: string; // URL to navigate to or focus. If not provided, uses active tab.
  maxCaptureTime?: number;
  inactivityTimeout?: number; // Inactivity timeout (milliseconds)
  includeStatic?: boolean; // if include static resources
}

// Network request object interface
interface NetworkRequestInfo {
  requestId: string;
  url: string;
  method: string;
  requestHeaders?: Record<string, string>; // Will be removed after common headers extraction
  responseHeaders?: Record<string, string>; // Will be removed after common headers extraction
  requestTime?: number; // Timestamp of the request
  responseTime?: number; // Timestamp of the response
  type: string; // Resource type (e.g., Document, XHR, Fetch, Script, Stylesheet)
  status: string; // 'pending', 'complete', 'error'
  statusCode?: number;
  statusText?: string;
  requestBody?: string;
  responseBody?: string;
  base64Encoded?: boolean; // For responseBody
  encodedDataLength?: number; // Actual bytes received
  errorText?: string; // If loading failed
  canceled?: boolean; // If loading was canceled
  mimeType?: string;
  specificRequestHeaders?: Record<string, string>; // Headers unique to this request
  specificResponseHeaders?: Record<string, string>; // Headers unique to this response
  [key: string]: any; // Allow other properties from debugger events
}

// Static resource file extensions list
const STATIC_RESOURCE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.ico',
  '.cur',
  '.css',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.webm',
  '.ogg',
  '.wav',
  '.pdf',
  '.zip',
  '.rar',
  '.7z',
  '.iso',
  '.dmg',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.map', // Source maps
];

// Ad and analytics domains list
const AD_ANALYTICS_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleads.g.doubleclick.net',
  'facebook.com/tr',
  'connect.facebook.net',
  'bat.bing.com',
  'linkedin.com', // Often for tracking pixels/insights
  'analytics.twitter.com',
  'static.hotjar.com',
  'script.hotjar.com',
  'stats.g.doubleclick.net',
  'amazon-adsystem.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'ads-twitter.com',
  'ads.yahoo.com',
  'adroll.com',
  'adnxs.com',
  'criteo.com',
  'quantserve.com',
  'scorecardresearch.com',
  'segment.io',
  'amplitude.com',
  'mixpanel.com',
  'optimizely.com',
  'crazyegg.com',
  'clicktale.net',
  'mouseflow.com',
  'fullstory.com',
  'clarity.ms',
];

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const MAX_RESPONSE_BODY_SIZE_BYTES = 1 * 1024 * 1024; // 1MB
const DEFAULT_MAX_CAPTURE_TIME_MS = 3 * 60 * 1000; // 3 minutes
const DEFAULT_INACTIVITY_TIMEOUT_MS = 60 * 1000; // 1 minute

/**
 * Network capture start tool - uses Chrome Debugger API to start capturing network requests
 */
class NetworkDebuggerStartTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NETWORK_DEBUGGER_START;
  private captureData: Map<number, any> = new Map(); // tabId -> capture data
  private captureTimers: Map<number, NodeJS.Timeout> = new Map(); // tabId -> max capture timer
  private inactivityTimers: Map<number, NodeJS.Timeout> = new Map(); // tabId -> inactivity timer
  private lastActivityTime: Map<number, number> = new Map(); // tabId -> timestamp of last network activity
  private pendingResponseBodies: Map<string, Promise<any>> = new Map(); // requestId -> promise for getResponseBody
  private requestCounters: Map<number, number> = new Map(); // tabId -> count of captured requests (after filtering)
  private static MAX_REQUESTS_PER_CAPTURE = 100; // Max requests to store to prevent memory issues
  public static instance: NetworkDebuggerStartTool | null = null;

  constructor() {
    super();
    if (NetworkDebuggerStartTool.instance) {
      return NetworkDebuggerStartTool.instance;
    }
    NetworkDebuggerStartTool.instance = this;

    chrome.debugger.onEvent.addListener(this.handleDebuggerEvent.bind(this));
    chrome.debugger.onDetach.addListener(this.handleDebuggerDetach.bind(this));
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
    chrome.tabs.onCreated.addListener(this.handleTabCreated.bind(this));
  }

  private handleTabRemoved(tabId: number) {
    if (this.captureData.has(tabId)) {
      console.log(`网络调试器启动工具: 标签页 ${tabId} 已关闭，清理资源。`);
      this.cleanupCapture(tabId);
    }
  }

  /**
   * Handle tab creation events
   * If a new tab is opened from a tab that is currently capturing, automatically start capturing the new tab's requests
   */
  private async handleTabCreated(tab: chrome.tabs.Tab) {
    try {
      // Check if there are any tabs currently capturing
      if (this.captureData.size === 0) return;

      // Get the openerTabId of the new tab (ID of the tab that opened this tab)
      const openerTabId = tab.openerTabId;
      if (!openerTabId) return;

      // Check if the opener tab is currently capturing
      if (!this.captureData.has(openerTabId)) return;

      // Get the new tab's ID
      const newTabId = tab.id;
      if (!newTabId) return;

      console.log(
        `网络调试器启动工具: 从捕获标签页 ${openerTabId} 创建了新标签页 ${newTabId}，将扩展捕获到该标签页。`,
      );

      // Get the opener tab's capture settings
      const openerCaptureInfo = this.captureData.get(openerTabId);
      if (!openerCaptureInfo) return;

      // Wait a short time to ensure the tab is ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Start capturing requests for the new tab
      await this.startCaptureForTab(newTabId, {
        maxCaptureTime: openerCaptureInfo.maxCaptureTime,
        inactivityTimeout: openerCaptureInfo.inactivityTimeout,
        includeStatic: openerCaptureInfo.includeStatic,
      });

      console.log(`网络调试器启动工具: 成功扩展捕获到新标签页 ${newTabId}`);
    } catch (error) {
      console.error(`网络调试器启动工具: 扩展捕获到新标签页时出错:`, error);
    }
  }

  /**
   * Start network request capture for specified tab
   * @param tabId Tab ID
   * @param options Capture options
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

    // If already capturing, stop first
    if (this.captureData.has(tabId)) {
      console.log(`网络调试器启动工具: 标签页 ${tabId} 已在捕获中。停止之前的会话。`);
      await this.stopCapture(tabId);
    }

    try {
      // Get tab information
      const tab = await chrome.tabs.get(tabId);

      // Check if debugger is already attached
      const targets = await chrome.debugger.getTargets();
      const existingTarget = targets.find(
        (t) => t.tabId === tabId && t.attached && t.type === 'page',
      );
      if (existingTarget && !existingTarget.extensionId) {
        throw new Error(`调试器已被其他工具（如开发者工具）附加到标签页 ${tabId}。`);
      }

      // Attach debugger
      try {
        await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
      } catch (error: any) {
        if (error.message?.includes('Cannot attach to the target with an attached client')) {
          throw new Error(`调试器已附加到标签页 ${tabId}。这可能是开发者工具或其他扩展。`);
        }
        throw error;
      }

      // Enable network tracking
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
      } catch (error: any) {
        await chrome.debugger
          .detach({ tabId })
          .catch((e) => console.warn('Error detaching after failed enable:', e));
        throw error;
      }

      // Initialize capture data
      this.captureData.set(tabId, {
        startTime: Date.now(),
        tabUrl: tab.url,
        tabTitle: tab.title,
        maxCaptureTime,
        inactivityTimeout,
        includeStatic,
        requests: {},
        limitReached: false,
      });

      // Initialize request counter
      this.requestCounters.set(tabId, 0);

      // Update last activity time
      this.updateLastActivityTime(tabId);

      console.log(
        `网络调试器启动工具: 开始捕获标签页 ${tabId} (${tab.url})。最大请求数: ${NetworkDebuggerStartTool.MAX_REQUESTS_PER_CAPTURE}，最大时间: ${maxCaptureTime}ms，非活动超时: ${inactivityTimeout}ms。`,
      );

      // Set maximum capture time
      if (maxCaptureTime > 0) {
        this.captureTimers.set(
          tabId,
          setTimeout(async () => {
            console.log(
              `网络调试器启动工具: 标签页 ${tabId} 达到最大捕获时间 (${maxCaptureTime}ms)。`,
            );
            await this.stopCapture(tabId, true); // Auto-stop due to max time
          }, maxCaptureTime),
        );
      }
    } catch (error: any) {
      console.error(`网络调试器启动工具: 启动标签页 ${tabId} 捕获时出错:`, error);

      // Clean up resources
      if (this.captureData.has(tabId)) {
        await chrome.debugger
          .detach({ tabId })
          .catch((e) => console.warn('Cleanup detach error:', e));
        this.cleanupCapture(tabId);
      }

      throw error;
    }
  }

  private handleDebuggerEvent(source: chrome.debugger.Debuggee, method: string, params?: any) {
    if (!source.tabId) return;

    const tabId = source.tabId;
    const captureInfo = this.captureData.get(tabId);

    if (!captureInfo) return; // Not capturing for this tab

    // Update last activity time for any relevant network event
    this.updateLastActivityTime(tabId);

    switch (method) {
      case 'Network.requestWillBeSent':
        this.handleRequestWillBeSent(tabId, params);
        break;
      case 'Network.responseReceived':
        this.handleResponseReceived(tabId, params);
        break;
      case 'Network.loadingFinished':
        this.handleLoadingFinished(tabId, params);
        break;
      case 'Network.loadingFailed':
        this.handleLoadingFailed(tabId, params);
        break;
    }
  }

  private handleDebuggerDetach(source: chrome.debugger.Debuggee, reason: string) {
    if (source.tabId && this.captureData.has(source.tabId)) {
      console.log(
        `网络调试器启动工具: 调试器从标签页 ${source.tabId} 分离，原因: ${reason}。正在清理。`,
      );
      // Potentially inform the user or log the result if the detachment was unexpected
      this.cleanupCapture(source.tabId); // Ensure cleanup happens
    }
  }

  private updateLastActivityTime(tabId: number) {
    this.lastActivityTime.set(tabId, Date.now());
    const captureInfo = this.captureData.get(tabId);

    if (captureInfo && captureInfo.inactivityTimeout > 0) {
      if (this.inactivityTimers.has(tabId)) {
        clearTimeout(this.inactivityTimers.get(tabId)!);
      }
      this.inactivityTimers.set(
        tabId,
        setTimeout(() => this.checkInactivity(tabId), captureInfo.inactivityTimeout),
      );
    }
  }

  private checkInactivity(tabId: number) {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    const lastActivity = this.lastActivityTime.get(tabId) || captureInfo.startTime; // Use startTime if no activity yet
    const now = Date.now();
    const inactiveTime = now - lastActivity;

    if (inactiveTime >= captureInfo.inactivityTimeout) {
      console.log(
        `网络调试器启动工具: 无活动 ${inactiveTime}ms（阈值: ${captureInfo.inactivityTimeout}ms），停止标签页 ${tabId} 的捕获`,
      );
      this.stopCaptureByInactivity(tabId);
    } else {
      // Reschedule check for the remaining time, this handles system sleep or other interruptions
      const remainingTime = Math.max(0, captureInfo.inactivityTimeout - inactiveTime);
      this.inactivityTimers.set(
        tabId,
        setTimeout(() => this.checkInactivity(tabId), remainingTime),
      );
    }
  }

  private async stopCaptureByInactivity(tabId: number) {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    console.log(`网络调试器启动工具: 由于非活动停止标签页 ${tabId} 的捕获。`);
    // Potentially, we might want to notify the client/user that this happened.
    // For now, just stop and make the results available if StopTool is called.
    await this.stopCapture(tabId, true); // Pass a flag indicating it's an auto-stop
  }

  // Static resource MIME types list (used when includeStatic is false)
  private static STATIC_MIME_TYPES_TO_FILTER = [
    'image/', // all image types (image/png, image/jpeg, etc.)
    'font/', // all font types (font/woff, font/ttf, etc.)
    'audio/', // all audio types
    'video/', // all video types
    'text/css',
    // Note: text/javascript, application/javascript etc. are often filtered by extension.
    // If script files need to be filtered by MIME type as well, add them here.
    // 'application/javascript',
    // 'application/x-javascript',
    'application/pdf',
    'application/zip',
    'application/octet-stream', // Often used for downloads or generic binary data
  ];

  // API-like response MIME types (these are generally NOT filtered, and we might want their bodies)
  private static API_MIME_TYPES = [
    'application/json',
    'application/xml',
    'text/xml',
    // 'text/json' is not standard, but sometimes seen. 'application/json' is preferred.
    'text/plain', // Can be API response, handle with care. Often captured.
    'application/x-www-form-urlencoded', // Form submissions, can be API calls
    'application/graphql',
    // Add other common API types if needed
  ];

  private shouldFilterRequestByUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      // Filter ad/analytics domains
      if (AD_ANALYTICS_DOMAINS.some((domain) => urlObj.hostname.includes(domain))) {
        // console.log(`网络调试器启动工具: 过滤广告/分析域名: ${urlObj.hostname}`);
        return true;
      }
      return false;
    } catch (e) {
      // Invalid URL? Log and don't filter.
      console.error(`网络调试器启动工具: 解析URL进行过滤时出错: ${url}`, e);
      return false;
    }
  }

  private shouldFilterRequestByExtension(url: string, includeStatic: boolean): boolean {
    if (includeStatic) return false; // If including static, don't filter by extension

    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.toLowerCase();
      if (STATIC_RESOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
        // console.log(`网络调试器启动工具: 按扩展名过滤静态资源: ${path}`);
        return true;
      }
      return false;
    } catch (e) {
      console.error(`网络调试器启动工具: 解析URL进行扩展名过滤时出错: ${url}`, e);
      return false;
    }
  }

  // MIME type-based filtering, called after response is received
  private shouldFilterByMimeType(mimeType: string, includeStatic: boolean): boolean {
    if (!mimeType) return false; // No MIME type, don't make a decision based on it here

    // If API_MIME_TYPES contains this mimeType, we explicitly DON'T want to filter it by MIME.
    if (NetworkDebuggerStartTool.API_MIME_TYPES.some((apiMime) => mimeType.startsWith(apiMime))) {
      return false;
    }

    // If we are NOT including static files, then check against the list of static MIME types.
    if (!includeStatic) {
      if (
        NetworkDebuggerStartTool.STATIC_MIME_TYPES_TO_FILTER.some((staticMime) =>
          mimeType.startsWith(staticMime),
        )
      ) {
        // console.log(`网络调试器启动工具: 按MIME类型过滤静态资源: ${mimeType}`);
        return true;
      }
    }

    // Default: don't filter by MIME type if no other rule matched
    return false;
  }

  private handleRequestWillBeSent(tabId: number, params: any) {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    const { requestId, request, timestamp, type, loaderId, frameId } = params;

    // Initial filtering by URL (ads, analytics) and extension (if !includeStatic)
    if (
      this.shouldFilterRequestByUrl(request.url) ||
      this.shouldFilterRequestByExtension(request.url, captureInfo.includeStatic)
    ) {
      return;
    }

    const currentCount = this.requestCounters.get(tabId) || 0;
    if (currentCount >= NetworkDebuggerStartTool.MAX_REQUESTS_PER_CAPTURE) {
      // console.log(`网络调试器启动工具: 标签页 ${tabId} 达到请求限制 (${NetworkDebuggerStartTool.MAX_REQUESTS_PER_CAPTURE})。忽略: ${request.url}`);
      captureInfo.limitReached = true; // Mark that limit was hit
      return;
    }

    // Store initial request info
    // Ensure we don't overwrite if a redirect (same requestId) occurred, though usually loaderId changes
    if (!captureInfo.requests[requestId]) {
      // Or check based on loaderId as well if needed
      captureInfo.requests[requestId] = {
        requestId,
        url: request.url,
        method: request.method,
        requestHeaders: request.headers, // Temporary, will be processed
        requestTime: timestamp * 1000, // Convert seconds to milliseconds
        type: type || 'Other',
        status: 'pending', // Initial status
        loaderId, // Useful for tracking redirects
        frameId, // Useful for context
      };

      if (request.postData) {
        captureInfo.requests[requestId].requestBody = request.postData;
      }
      // console.log(`网络调试器启动工具: 捕获标签页 ${tabId} 的请求: ${request.method} ${request.url}`);
    } else {
      // This could be a redirect. Update URL and other relevant fields.
      // Chrome often issues a new `requestWillBeSent` for redirects with the same `requestId` but a new `loaderId`.
      // console.log(`网络调试器启动工具: 标签页 ${tabId} 的请求 ${requestId} 已更新（可能是重定向）到URL: ${request.url}`);
      const existingRequest = captureInfo.requests[requestId];
      existingRequest.url = request.url; // Update URL due to redirect
      existingRequest.requestTime = timestamp * 1000; // Update time for the redirected request
      if (request.headers) existingRequest.requestHeaders = request.headers;
      if (request.postData) existingRequest.requestBody = request.postData;
      else delete existingRequest.requestBody;
    }
  }

  private handleResponseReceived(tabId: number, params: any) {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    const { requestId, response, timestamp, type } = params; // type here is resource type
    const requestInfo: NetworkRequestInfo = captureInfo.requests[requestId];

    if (!requestInfo) {
      // console.warn(`NetworkDebuggerStartTool: Received response for unknown requestId ${requestId} on tab ${tabId}`);
      return;
    }

    // Secondary filtering based on MIME type, now that we have it
    if (this.shouldFilterByMimeType(response.mimeType, captureInfo.includeStatic)) {
      // console.log(`网络调试器启动工具: 按MIME类型过滤请求 (${response.mimeType}): ${requestInfo.url}`);
      delete captureInfo.requests[requestId]; // Remove from captured data
      // Note: We don't decrement requestCounter here as it's meant to track how many *potential* requests were processed up to MAX_REQUESTS.
      // Or, if MAX_REQUESTS is strictly for *stored* requests, then decrement. For now, let's assume it's for stored.
      // const currentCount = this.requestCounters.get(tabId) || 0;
      // if (currentCount > 0) this.requestCounters.set(tabId, currentCount -1);
      return;
    }

    // If not filtered by MIME, then increment actual stored request counter
    const currentStoredCount = Object.keys(captureInfo.requests).length; // A bit inefficient but accurate
    this.requestCounters.set(tabId, currentStoredCount);

    requestInfo.status = response.status === 0 ? 'pending' : 'complete'; // status 0 can mean pending or blocked
    requestInfo.statusCode = response.status;
    requestInfo.statusText = response.statusText;
    requestInfo.responseHeaders = response.headers; // Temporary
    requestInfo.mimeType = response.mimeType;
    requestInfo.responseTime = timestamp * 1000; // Convert seconds to milliseconds
    if (type) requestInfo.type = type; // Update resource type if provided by this event

    // console.log(`网络调试器启动工具: 收到标签页 ${tabId} 上请求 ${requestId} 的响应: ${response.status}`);
  }

  private async handleLoadingFinished(tabId: number, params: any) {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    const { requestId, encodedDataLength } = params;
    const requestInfo: NetworkRequestInfo = captureInfo.requests[requestId];

    if (!requestInfo) {
      // console.warn(`NetworkDebuggerStartTool: LoadingFinished for unknown requestId ${requestId} on tab ${tabId}`);
      return;
    }

    requestInfo.encodedDataLength = encodedDataLength;
    if (requestInfo.status === 'pending') requestInfo.status = 'complete'; // Mark as complete if not already
    // requestInfo.responseTime is usually set by responseReceived, but this timestamp is later.
    // timestamp here is when the resource finished loading. Could be useful for duration calculation.

    if (this.shouldCaptureResponseBody(requestInfo)) {
      try {
        // console.log(`网络调试器启动工具: 尝试获取请求 ${requestId} 的响应体 (${requestInfo.url})`);
        const responseBodyData = await this.getResponseBody(tabId, requestId);
        if (responseBodyData) {
          if (
            responseBodyData.body &&
            responseBodyData.body.length > MAX_RESPONSE_BODY_SIZE_BYTES
          ) {
            requestInfo.responseBody =
              responseBodyData.body.substring(0, MAX_RESPONSE_BODY_SIZE_BYTES) +
              `\n\n... [Response truncated, total size: ${responseBodyData.body.length} bytes] ...`;
          } else {
            requestInfo.responseBody = responseBodyData.body;
          }
          requestInfo.base64Encoded = responseBodyData.base64Encoded;
          // console.log(`网络调试器启动工具: 成功获取请求 ${requestId} 的响应体，大小: ${requestInfo.responseBody?.length || 0} 字节`);
        }
      } catch (error) {
        // console.warn(`NetworkDebuggerStartTool: Failed to get response body for ${requestId}:`, error);
        requestInfo.errorText =
          (requestInfo.errorText || '') +
          ` Failed to get body: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  private shouldCaptureResponseBody(requestInfo: NetworkRequestInfo): boolean {
    const mimeType = requestInfo.mimeType || '';

    // Prioritize API MIME types for body capture
    if (NetworkDebuggerStartTool.API_MIME_TYPES.some((type) => mimeType.startsWith(type))) {
      return true;
    }

    // Heuristics for other potential API calls not perfectly matching MIME types
    const url = requestInfo.url.toLowerCase();
    if (
      /\/(api|service|rest|graphql|query|data|rpc|v[0-9]+)\//i.test(url) ||
      url.includes('.json') ||
      url.includes('json=') ||
      url.includes('format=json')
    ) {
      // If it looks like an API call by URL structure, try to get body,
      // unless it's a known non-API MIME type that slipped through (e.g. a script from a /api/ path)
      if (
        mimeType &&
        NetworkDebuggerStartTool.STATIC_MIME_TYPES_TO_FILTER.some((staticMime) =>
          mimeType.startsWith(staticMime),
        )
      ) {
        return false; // e.g. a CSS file served from an /api/ path
      }
      return true;
    }

    return false;
  }

  private handleLoadingFailed(tabId: number, params: any) {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    const { requestId, errorText, canceled, type } = params;
    const requestInfo: NetworkRequestInfo = captureInfo.requests[requestId];

    if (!requestInfo) {
      // console.warn(`NetworkDebuggerStartTool: LoadingFailed for unknown requestId ${requestId} on tab ${tabId}`);
      return;
    }

    requestInfo.status = 'error';
    requestInfo.errorText = errorText;
    requestInfo.canceled = canceled;
    if (type) requestInfo.type = type;
    // timestamp here is when loading failed.
    // console.log(`网络调试器启动工具: 标签页 ${tabId} 上请求 ${requestId} 加载失败: ${errorText}`);
  }

  private async getResponseBody(
    tabId: number,
    requestId: string,
  ): Promise<{ body: string; base64Encoded: boolean } | null> {
    const pendingKey = `${tabId}_${requestId}`;
    if (this.pendingResponseBodies.has(pendingKey)) {
      return this.pendingResponseBodies.get(pendingKey)!; // Return existing promise
    }

    const responseBodyPromise = (async () => {
      try {
        // Check if debugger is still attached to this tabId
        const attachedTabs = await chrome.debugger.getTargets();
        if (!attachedTabs.some((target) => target.tabId === tabId && target.attached)) {
          // console.warn(`网络调试器启动工具: 尝试获取请求 ${requestId} 的响应体时，调试器未附加到标签页 ${tabId}。`);
          throw new Error(`调试器未附加到标签页 ${tabId}`);
        }

        const result = (await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', {
          requestId,
        })) as { body: string; base64Encoded: boolean };
        return result;
      } finally {
        this.pendingResponseBodies.delete(pendingKey); // Clean up after promise resolves or rejects
      }
    })();

    this.pendingResponseBodies.set(pendingKey, responseBodyPromise);
    return responseBodyPromise;
  }

  private cleanupCapture(tabId: number) {
    if (this.captureTimers.has(tabId)) {
      clearTimeout(this.captureTimers.get(tabId)!);
      this.captureTimers.delete(tabId);
    }
    if (this.inactivityTimers.has(tabId)) {
      clearTimeout(this.inactivityTimers.get(tabId)!);
      this.inactivityTimers.delete(tabId);
    }

    this.lastActivityTime.delete(tabId);
    this.captureData.delete(tabId);
    this.requestCounters.delete(tabId);

    // Abort pending getResponseBody calls for this tab
    // Note: Promises themselves cannot be "aborted" externally in a standard way once created.
    // We can delete them from the map, so new calls won't use them,
    // and the original promise will eventually resolve or reject.
    const keysToDelete: string[] = [];
    this.pendingResponseBodies.forEach((_, key) => {
      if (key.startsWith(`${tabId}_`)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => this.pendingResponseBodies.delete(key));

    console.log(`网络调试器启动工具: 已清理标签页 ${tabId} 的资源。`);
  }

  // isAutoStop is true if stop was triggered by timeout, false if by user/explicit call
  async stopCapture(tabId: number, isAutoStop: boolean = false): Promise<any> {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) {
      return { success: false, message: '此标签页没有正在进行的捕获。' };
    }

    console.log(`网络调试器启动工具: 停止标签页 ${tabId} 的捕获。自动停止: ${isAutoStop}`);

    try {
      // Detach debugger first to prevent further events.
      // Check if debugger is attached before trying to send commands or detach
      const attachedTargets = await chrome.debugger.getTargets();
      const isAttached = attachedTargets.some(
        (target) => target.tabId === tabId && target.attached,
      );

      if (isAttached) {
        try {
          await chrome.debugger.sendCommand({ tabId }, 'Network.disable');
        } catch (e) {
          console.warn(`网络调试器启动工具: 禁用标签页 ${tabId} 网络时出错（可能已分离）:`, e);
        }
        try {
          await chrome.debugger.detach({ tabId });
        } catch (e) {
          console.warn(`网络调试器启动工具: 分离标签页 ${tabId} 调试器时出错（可能已分离）:`, e);
        }
      } else {
        console.log(`网络调试器启动工具: 在stopCapture时调试器未附加到标签页 ${tabId}。`);
      }
    } catch (error: any) {
      // Catch errors from getTargets or general logic
      console.error('网络调试器启动工具: 在stopCapture中调试器交互时出错:', error);
      // Proceed to cleanup and data formatting
    }

    // Process data even if detach/disable failed, as some data might have been captured.
    const allRequests = Object.values(captureInfo.requests) as NetworkRequestInfo[];
    const commonRequestHeaders = this.analyzeCommonHeaders(allRequests, 'requestHeaders');
    const commonResponseHeaders = this.analyzeCommonHeaders(allRequests, 'responseHeaders');

    const processedRequests = allRequests.map((req) => {
      const finalReq: Partial<NetworkRequestInfo> &
        Pick<NetworkRequestInfo, 'requestId' | 'url' | 'method' | 'type' | 'status'> = { ...req };

      if (finalReq.requestHeaders) {
        finalReq.specificRequestHeaders = this.filterOutCommonHeaders(
          finalReq.requestHeaders,
          commonRequestHeaders,
        );
        delete finalReq.requestHeaders; // Remove original full headers
      } else {
        finalReq.specificRequestHeaders = {};
      }

      if (finalReq.responseHeaders) {
        finalReq.specificResponseHeaders = this.filterOutCommonHeaders(
          finalReq.responseHeaders,
          commonResponseHeaders,
        );
        delete finalReq.responseHeaders; // Remove original full headers
      } else {
        finalReq.specificResponseHeaders = {};
      }
      return finalReq as NetworkRequestInfo; // Cast back to full type
    });

    // Sort requests by requestTime
    processedRequests.sort((a, b) => (a.requestTime || 0) - (b.requestTime || 0));

    const resultData = {
      captureStartTime: captureInfo.startTime,
      captureEndTime: Date.now(),
      totalDurationMs: Date.now() - captureInfo.startTime,
      commonRequestHeaders,
      commonResponseHeaders,
      requests: processedRequests,
      requestCount: processedRequests.length, // Actual stored requests
      totalRequestsReceivedBeforeLimit: captureInfo.limitReached
        ? NetworkDebuggerStartTool.MAX_REQUESTS_PER_CAPTURE
        : processedRequests.length,
      requestLimitReached: !!captureInfo.limitReached,
      stoppedBy: isAutoStop
        ? this.lastActivityTime.get(tabId)
          ? 'inactivity_timeout'
          : 'max_capture_time'
        : 'user_request',
      tabUrl: captureInfo.tabUrl,
      tabTitle: captureInfo.tabTitle,
    };

    console.log(
      `网络调试器启动工具: 标签页 ${tabId} 的捕获已停止。处理了 ${resultData.requestCount} 个请求。达到限制: ${resultData.requestLimitReached}。停止原因: ${resultData.stoppedBy}`,
    );

    this.cleanupCapture(tabId); // Final cleanup of all internal states for this tab

    return {
      success: true,
      message: `捕获已停止。${resultData.requestCount} 个请求。`,
      data: resultData,
    };
  }

  private analyzeCommonHeaders(
    requests: NetworkRequestInfo[],
    headerTypeKey: 'requestHeaders' | 'responseHeaders',
  ): Record<string, string> {
    if (!requests || requests.length === 0) return {};

    const headerValueCounts = new Map<string, Map<string, number>>(); // headerName -> (headerValue -> count)
    let requestsWithHeadersCount = 0;

    for (const req of requests) {
      const headers = req[headerTypeKey] as Record<string, string> | undefined;
      if (headers && Object.keys(headers).length > 0) {
        requestsWithHeadersCount++;
        for (const name in headers) {
          // Normalize header name to lowercase for consistent counting
          const lowerName = name.toLowerCase();
          const value = headers[name];
          if (!headerValueCounts.has(lowerName)) {
            headerValueCounts.set(lowerName, new Map());
          }
          const values = headerValueCounts.get(lowerName)!;
          values.set(value, (values.get(value) || 0) + 1);
        }
      }
    }

    if (requestsWithHeadersCount === 0) return {};

    const commonHeaders: Record<string, string> = {};
    headerValueCounts.forEach((values, name) => {
      values.forEach((count, value) => {
        if (count === requestsWithHeadersCount) {
          // This (name, value) pair is present in all requests that have this type of headers.
          // We need to find the original casing for the header name.
          // This is tricky as HTTP headers are case-insensitive. Let's pick the first encountered one.
          // A more robust way would be to store original names, but lowercase comparison is standard.
          // For simplicity, we'll use the lowercase name for commonHeaders keys.
          // Or, find one original casing:
          let originalName = name;
          for (const req of requests) {
            const hdrs = req[headerTypeKey] as Record<string, string> | undefined;
            if (hdrs) {
              const foundName = Object.keys(hdrs).find((k) => k.toLowerCase() === name);
              if (foundName) {
                originalName = foundName;
                break;
              }
            }
          }
          commonHeaders[originalName] = value;
        }
      });
    });
    return commonHeaders;
  }

  private filterOutCommonHeaders(
    headers: Record<string, string>,
    commonHeaders: Record<string, string>,
  ): Record<string, string> {
    if (!headers || typeof headers !== 'object') return {};

    const specificHeaders: Record<string, string> = {};
    const commonHeadersLower: Record<string, string> = {};

    // Use Object.keys to avoid ESLint no-prototype-builtins warning
    Object.keys(commonHeaders).forEach((commonName) => {
      commonHeadersLower[commonName.toLowerCase()] = commonHeaders[commonName];
    });

    // Use Object.keys to avoid ESLint no-prototype-builtins warning
    Object.keys(headers).forEach((name) => {
      const lowerName = name.toLowerCase();
      // If the header (by name, case-insensitively) is not in commonHeaders OR
      // if its value is different from the common one, then it's specific.
      if (!(lowerName in commonHeadersLower) || headers[name] !== commonHeadersLower[lowerName]) {
        specificHeaders[name] = headers[name];
      }
    });

    return specificHeaders;
  }

  async execute(args: NetworkDebuggerStartToolParams): Promise<ToolResult> {
    const {
      tabId,
      url: targetUrl,
      maxCaptureTime = DEFAULT_MAX_CAPTURE_TIME_MS,
      inactivityTimeout = DEFAULT_INACTIVITY_TIMEOUT_MS,
      includeStatic = false,
    } = args;

    console.log(
      `NetworkDebuggerStartTool: Executing with args: tabId=${tabId}, url=${targetUrl}, maxTime=${maxCaptureTime}, inactivityTime=${inactivityTimeout}, includeStatic=${includeStatic}`,
    );

    let tabToOperateOn: chrome.tabs.Tab | undefined;

    try {
      if (tabId) {
        // Use specified tab
        try {
          tabToOperateOn = await chrome.tabs.get(tabId);
          console.log(`NetworkDebuggerStartTool: Using specified tab ${tabId}`);
        } catch (error) {
          return createErrorResponse(`Tab with ID ${tabId} not found`);
        }
      } else if (targetUrl) {
        const existingTabs = await chrome.tabs.query({
          url: targetUrl.startsWith('http') ? targetUrl : `*://*/*${targetUrl}*`,
        }); // More specific query
        if (existingTabs.length > 0 && existingTabs[0]?.id) {
          tabToOperateOn = existingTabs[0];
          // Ensure window gets focus and tab is truly activated
          await chrome.windows.update(tabToOperateOn.windowId, { focused: true });
          await chrome.tabs.update(tabToOperateOn.id!, { active: true });
        } else {
          tabToOperateOn = await chrome.tabs.create({ url: targetUrl, active: true });
          // Wait for tab to be somewhat ready. A better way is to listen to tabs.onUpdated status='complete'
          // but for debugger attachment, it just needs the tabId.
          await new Promise((resolve) => setTimeout(resolve, 500)); // Short delay
        }
      } else {
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTabs.length > 0 && activeTabs[0]?.id) {
          tabToOperateOn = activeTabs[0];
        } else {
          return createErrorResponse('未找到活动标签页且未提供URL。');
        }
      }

      if (!tabToOperateOn?.id) {
        return createErrorResponse('无法识别或创建目标标签页。');
      }
      const tabId = tabToOperateOn.id;

      // Use startCaptureForTab method to start capture
      try {
        await this.startCaptureForTab(tabId, {
          maxCaptureTime,
          inactivityTimeout,
          includeStatic,
        });
      } catch (error: any) {
        return createErrorResponse(
          `启动标签页 ${tabId} 捕获失败: ${error.message || String(error)}`,
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `标签页 ${tabId} 上的网络捕获已启动。等待停止命令或超时。`,
              tabId,
              url: tabToOperateOn.url,
              maxCaptureTime,
              inactivityTimeout,
              includeStatic,
              maxRequests: NetworkDebuggerStartTool.MAX_REQUESTS_PER_CAPTURE,
            }),
          },
        ],
        isError: false,
      };
    } catch (error: any) {
      console.error('网络调试器启动工具: 执行期间发生严重错误:', error);
      // If a tabId was involved and debugger might be attached, try to clean up.
      const tabIdToClean = tabToOperateOn?.id;
      if (tabIdToClean && this.captureData.has(tabIdToClean)) {
        await chrome.debugger
          .detach({ tabId: tabIdToClean })
          .catch((e) => console.warn('Cleanup detach error:', e));
        this.cleanupCapture(tabIdToClean);
      }
      return createErrorResponse(`网络调试器启动工具错误: ${error.message || String(error)}`);
    }
  }
}

/**
 * Network capture stop tool - stops capture and returns results for the active tab
 */
class NetworkDebuggerStopTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NETWORK_DEBUGGER_STOP;
  public static instance: NetworkDebuggerStopTool | null = null;

  constructor() {
    super();
    if (NetworkDebuggerStopTool.instance) {
      return NetworkDebuggerStopTool.instance;
    }
    NetworkDebuggerStopTool.instance = this;
  }

  async execute(): Promise<ToolResult> {
    console.log(`网络调试器停止工具: 执行命令。`);

    const startTool = NetworkDebuggerStartTool.instance;
    if (!startTool) {
      return createErrorResponse('网络调试器启动工具实例不可用。无法停止捕获。');
    }

    // Get all tabs currently capturing
    const ongoingCaptures = Array.from(startTool['captureData'].keys());
    console.log(
      `网络调试器停止工具: 发现 ${ongoingCaptures.length} 个正在进行的捕获: ${ongoingCaptures.join(', ')}`,
    );

    if (ongoingCaptures.length === 0) {
      return createErrorResponse('在任何标签页中都没有找到活动的网络捕获。');
    }

    // Get current active tab
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = activeTabs[0]?.id;

    // Determine the primary tab to stop
    let primaryTabId: number;

    if (activeTabId && startTool['captureData'].has(activeTabId)) {
      // If current active tab is capturing, prioritize stopping it
      primaryTabId = activeTabId;
      console.log(`网络调试器停止工具: 活动标签页 ${activeTabId} 正在捕获，将首先停止它。`);
    } else if (ongoingCaptures.length === 1) {
      // If only one tab is capturing, stop it
      primaryTabId = ongoingCaptures[0];
      console.log(`网络调试器停止工具: 只有一个标签页 ${primaryTabId} 在捕获，停止它。`);
    } else {
      // If multiple tabs are capturing but current active tab is not among them, stop the first one
      primaryTabId = ongoingCaptures[0];
      console.log(
        `网络调试器停止工具: 多个标签页在捕获，活动标签页不在其中。首先停止标签页 ${primaryTabId}。`,
      );
    }

    // Stop capture for the primary tab
    const result = await this.performStop(startTool, primaryTabId);

    // If multiple tabs are capturing, stop other tabs
    if (ongoingCaptures.length > 1) {
      const otherTabIds = ongoingCaptures.filter((id) => id !== primaryTabId);
      console.log(
        `网络调试器停止工具: 停止 ${otherTabIds.length} 个额外的捕获: ${otherTabIds.join(', ')}`,
      );

      for (const tabId of otherTabIds) {
        try {
          await startTool.stopCapture(tabId);
        } catch (error) {
          console.error(`网络调试器停止工具: 停止标签页 ${tabId} 捕获时出错:`, error);
        }
      }
    }

    return result;
  }

  private async performStop(
    startTool: NetworkDebuggerStartTool,
    tabId: number,
  ): Promise<ToolResult> {
    console.log(`网络调试器停止工具: 尝试停止标签页 ${tabId} 的捕获。`);
    const stopResult = await startTool.stopCapture(tabId);

    if (!stopResult?.success) {
      return createErrorResponse(
        stopResult?.message || `停止标签页 ${tabId} 的网络捕获失败。它可能没有在捕获。`,
      );
    }

    const resultData = stopResult.data || {};

    // Get all tabs still capturing (there might be other tabs still capturing after stopping)
    const remainingCaptures = Array.from(startTool['captureData'].keys());

    // Sort requests by time
    if (resultData.requests && Array.isArray(resultData.requests)) {
      resultData.requests.sort(
        (a: NetworkRequestInfo, b: NetworkRequestInfo) =>
          (a.requestTime || 0) - (b.requestTime || 0),
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `标签页 ${tabId} (${resultData.tabUrl || 'N/A'}) 的捕获已停止。捕获了 ${resultData.requestCount || 0} 个请求。`,
            tabId: tabId,
            tabUrl: resultData.tabUrl || 'N/A',
            tabTitle: resultData.tabTitle || '未知标签页',
            requestCount: resultData.requestCount || 0,
            commonRequestHeaders: resultData.commonRequestHeaders || {},
            commonResponseHeaders: resultData.commonResponseHeaders || {},
            requests: resultData.requests || [],
            captureStartTime: resultData.captureStartTime,
            captureEndTime: resultData.captureEndTime,
            totalDurationMs: resultData.totalDurationMs,
            settingsUsed: resultData.settingsUsed || {},
            remainingCaptures: remainingCaptures,
            totalRequestsReceived: resultData.totalRequestsReceived || resultData.requestCount || 0,
            requestLimitReached: resultData.requestLimitReached || false,
          }),
        },
      ],
      isError: false,
    };
  }
}

export const networkDebuggerStartTool = new NetworkDebuggerStartTool();
export const networkDebuggerStopTool = new NetworkDebuggerStopTool();
