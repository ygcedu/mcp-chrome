/* eslint-disable */

(() => {
  // 防止重复注入桥接本身。
  if (window.__INJECT_SCRIPT_TOOL_UNIVERSAL_BRIDGE_LOADED__) return;
  window.__INJECT_SCRIPT_TOOL_UNIVERSAL_BRIDGE_LOADED__ = true;
  const EVENT_NAME = {
    RESPONSE: 'chrome-mcp:response',
    CLEANUP: 'chrome-mcp:cleanup',
    EXECUTE: 'chrome-mcp:execute',
  };
  const pendingRequests = new Map();

  const messageHandler = (request, _sender, sendResponse) => {
    // --- 生命周期命令 ---
    if (request.type === EVENT_NAME.CLEANUP) {
      window.dispatchEvent(new CustomEvent(EVENT_NAME.CLEANUP));
      // 确认收到清理信号，但不保持连接。
      sendResponse({ success: true });
      return true;
    }

    // --- MAIN世界的执行命令 ---
    if (request.targetWorld === 'MAIN') {
      const requestId = `req-${Date.now()}-${Math.random()}`;
      pendingRequests.set(requestId, sendResponse);

      window.dispatchEvent(
        new CustomEvent(EVENT_NAME.EXECUTE, {
          detail: {
            action: request.action,
            payload: request.payload,
            requestId: requestId,
          },
        }),
      );
      return true; // 期望异步响应。
    }
    // 注意：ISOLATED世界的请求由用户的isolatedWorldCode脚本直接处理。
    // 除非它是ISOLATED世界中的唯一脚本，否则此监听器不会处理它们。
  };

  chrome.runtime.onMessage.addListener(messageHandler);

  // 监听来自MAIN世界的响应。
  const responseHandler = (event) => {
    const { requestId, data, error } = event.detail;
    if (pendingRequests.has(requestId)) {
      const sendResponse = pendingRequests.get(requestId);
      sendResponse({ data, error });
      pendingRequests.delete(requestId);
    }
  };
  window.addEventListener(EVENT_NAME.RESPONSE, responseHandler);

  // --- 自我清理 ---
  // 当清理信号到达时，此桥接也必须清理自己。
  const cleanupHandler = () => {
    chrome.runtime.onMessage.removeListener(messageHandler);
    window.removeEventListener(EVENT_NAME.RESPONSE, responseHandler);
    window.removeEventListener(EVENT_NAME.CLEANUP, cleanupHandler);
    delete window.__INJECT_SCRIPT_TOOL_UNIVERSAL_BRIDGE_LOADED__;
  };
  window.addEventListener(EVENT_NAME.CLEANUP, cleanupHandler);
})();
