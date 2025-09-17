/* eslint-disable */
/**
 * 网络捕获助手
 *
 * 此脚本帮助使用原始 cookie 和标头重放网络请求。
 */

// 防止重复初始化
if (window.__NETWORK_CAPTURE_HELPER_INITIALIZED__) {
  // 已初始化，跳过
} else {
  window.__NETWORK_CAPTURE_HELPER_INITIALIZED__ = true;

  /**
   * 重放网络请求
   * @param {string} url - 要发送请求的 URL
   * @param {string} method - 要使用的 HTTP 方法
   * @param {Object} headers - 请求中包含的标头
   * @param {any} body - 请求的主体
   * @param {number} timeout - 超时时间（毫秒）（默认：30000）
   * @returns {Promise<Object>} - 响应数据
   */
  async function replayNetworkRequest(url, method, headers, body, timeout = 30000) {
    try {
      // 创建 fetch 选项
      const options = {
        method: method,
        headers: headers || {},
        credentials: 'include', // 包含 cookie
        mode: 'cors',
        cache: 'no-cache',
      };

      // 为非 GET 请求添加主体
      if (method !== 'GET' && method !== 'HEAD' && body !== undefined) {
        options.body = body;
      }

      // 创建一个带超时的 fetch
      const fetchWithTimeout = async (url, options, timeout) => {
        const controller = new AbortController();
        const signal = controller.signal;

        // 设置超时
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, { ...options, signal });
          clearTimeout(timeoutId);
          return response;
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      };

      // 发送带超时的请求
      const response = await fetchWithTimeout(url, options, timeout);

      // 处理响应
      const responseData = {
        status: response.status,
        statusText: response.statusText,
        headers: {},
      };

      // 获取响应标头
      response.headers.forEach((value, key) => {
        responseData.headers[key] = value;
      });

      // 尝试根据内容类型获取响应主体
      const contentType = response.headers.get('content-type') || '';

      try {
        if (contentType.includes('application/json')) {
          responseData.body = await response.json();
        } else if (
          contentType.includes('text/') ||
          contentType.includes('application/xml') ||
          contentType.includes('application/javascript')
        ) {
          responseData.body = await response.text();
        } else {
          // 对于二进制数据，只表示已接收但未解析
          responseData.body = '[二进制数据未显示]';
        }
      } catch (error) {
        responseData.body = `[解析响应主体时出错: ${error.message}]`;
      }

      return {
        success: true,
        response: responseData,
      };
    } catch (error) {
      console.error('重放请求时出错:', error);
      return {
        success: false,
        error: `重放请求时出错: ${error.message}`,
      };
    }
  }

  // 监听来自扩展的消息
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    // 响应 ping 消息
    if (request.action === 'chrome_network_request_ping') {
      sendResponse({ status: 'pong' });
      return false; // 同步响应
    } else if (request.action === 'sendPureNetworkRequest') {
      replayNetworkRequest(
        request.url,
        request.method,
        request.headers,
        request.body,
        request.timeout,
      )
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            success: false,
            error: `意外错误: ${error.message}`,
          });
        });
      return true; // 表示异步响应
    }
  });
}
