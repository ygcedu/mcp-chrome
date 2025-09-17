/* eslint-disable */
/**
 * 截图助手内容脚本
 * 处理页面准备、滚动、元素定位等。
 */

if (window.__SCREENSHOT_HELPER_INITIALIZED__) {
  // 已初始化，跳过
} else {
  window.__SCREENSHOT_HELPER_INITIALIZED__ = true;

  // 保存原始样式
  let originalOverflowStyle = '';
  let hiddenFixedElements = [];

  /**
   * 获取固定/粘性定位元素
   * @returns 固定/粘性元素数组
   */
  function getFixedElements() {
    const fixed = [];

    document.querySelectorAll('*').forEach((el) => {
      const htmlEl = el;
      const style = window.getComputedStyle(htmlEl);
      if (style.position === 'fixed' || style.position === 'sticky') {
        // 过滤掉微小或不可见的元素，以及属于扩展 UI 的元素
        if (
          htmlEl.offsetWidth > 1 &&
          htmlEl.offsetHeight > 1 &&
          !htmlEl.id.startsWith('chrome-mcp-')
        ) {
          fixed.push({
            element: htmlEl,
            originalDisplay: htmlEl.style.display,
            originalVisibility: htmlEl.style.visibility,
          });
        }
      }
    });
    return fixed;
  }

  /**
   * 隐藏固定/粘性元素
   */
  function hideFixedElements() {
    hiddenFixedElements = getFixedElements();
    hiddenFixedElements.forEach((item) => {
      item.element.style.display = 'none';
    });
  }

  /**
   * 恢复固定/粘性元素
   */
  function showFixedElements() {
    hiddenFixedElements.forEach((item) => {
      item.element.style.display = item.originalDisplay || '';
    });
    hiddenFixedElements = [];
  }

  // 监听来自扩展的消息
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    // 响应 ping 消息
    if (request.action === 'chrome_screenshot_ping') {
      sendResponse({ status: 'pong' });
      return false; // 同步响应
    }

    // 为捕获准备页面
    else if (request.action === 'preparePageForCapture') {
      originalOverflowStyle = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden'; // 隐藏主滚动条
      if (request.options?.fullPage) {
        // 仅在整页时隐藏固定元素以避免闪烁
        hideFixedElements();
      }
      // 给样式一些时间来应用
      setTimeout(() => {
        sendResponse({ success: true });
      }, 50);
      return true; // 异步响应
    }

    // 获取页面详情
    else if (request.action === 'getPageDetails') {
      const body = document.body;
      const html = document.documentElement;
      sendResponse({
        totalWidth: Math.max(
          body.scrollWidth,
          body.offsetWidth,
          html.clientWidth,
          html.scrollWidth,
          html.offsetWidth,
        ),
        totalHeight: Math.max(
          body.scrollHeight,
          body.offsetHeight,
          html.clientHeight,
          html.scrollHeight,
          html.offsetHeight,
        ),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        currentScrollX: window.scrollX,
        currentScrollY: window.scrollY,
      });
    }

    // 获取元素详情
    else if (request.action === 'getElementDetails') {
      const element = document.querySelector(request.selector);
      if (element) {
        element.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
        setTimeout(() => {
          // 等待滚动
          const rect = element.getBoundingClientRect();
          sendResponse({
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            devicePixelRatio: window.devicePixelRatio || 1,
          });
        }, 200); // 为 scrollIntoView 增加延迟
        return true; // 异步响应
      } else {
        sendResponse({ error: `未找到选择器为 "${request.selector}" 的元素。` });
      }
      return true; // 异步响应
    }

    // 滚动页面
    else if (request.action === 'scrollPage') {
      window.scrollTo({ left: request.x, top: request.y, behavior: 'instant' });
      // 等待滚动和潜在的重排/懒加载
      setTimeout(() => {
        sendResponse({
          success: true,
          newScrollX: window.scrollX,
          newScrollY: window.scrollY,
        });
      }, request.scrollDelay || 300); // 可配置延迟
      return true; // 异步响应
    }

    // 重置页面
    else if (request.action === 'resetPageAfterCapture') {
      document.documentElement.style.overflow = originalOverflowStyle;
      showFixedElements();
      if (typeof request.scrollX !== 'undefined' && typeof request.scrollY !== 'undefined') {
        window.scrollTo({ left: request.scrollX, top: request.scrollY, behavior: 'instant' });
      }
      sendResponse({ success: true });
    }

    return false; // 同步响应
  });
}
