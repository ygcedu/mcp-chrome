/* eslint-disable */
// hover-helper.js
// 此脚本被注入到页面中以处理悬停操作

if (window.__HOVER_HELPER_INITIALIZED__) {
  // 已初始化，跳过
} else {
  window.__HOVER_HELPER_INITIALIZED__ = true;
  /**
   * 悬停在匹配选择器的元素上
   * @param {string} selector - 要悬停元素的 CSS 选择器
   * @returns {Promise<Object>} - 悬停操作的结果
   */
  async function hoverElement(selector) {
    try {
      // 查找元素
      const element = document.querySelector(selector);
      if (!element) {
        return {
          error: `未找到选择器为 "${selector}" 的元素`,
        };
      }

      // 获取元素信息
      const rect = element.getBoundingClientRect();
      const elementInfo = {
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        text: element.textContent?.trim().substring(0, 100) || '',
        href: element.href || null,
        type: element.type || null,
        isVisible: true,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        },
      };

      // 首先滚动使元素可见，然后检查可见性
      element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      elementInfo.isVisible = isElementVisible(element);

      if (!elementInfo.isVisible) {
        return {
          error: `选择器为 "${selector}" 的元素不可见`,
          elementInfo,
        };
      }

      // 获取更新后的位置信息
      const updatedRect = element.getBoundingClientRect();
      const centerX = updatedRect.left + updatedRect.width / 2;
      const centerY = updatedRect.top + updatedRect.height / 2;

      // 模拟鼠标悬停事件
      simulateHover(element, centerX, centerY);

      return {
        success: true,
        message: '元素悬停成功',
        elementInfo: {
          ...elementInfo,
          rect: {
            x: updatedRect.x,
            y: updatedRect.y,
            width: updatedRect.width,
            height: updatedRect.height,
            top: updatedRect.top,
            right: updatedRect.right,
            bottom: updatedRect.bottom,
            left: updatedRect.left,
          },
          hoverPosition: { x: centerX, y: centerY },
        },
      };
    } catch (error) {
      return {
        error: `悬停元素时出错: ${error.message}`,
      };
    }
  }

  /**
   * 模拟鼠标悬停事件
   * @param {Element} element - 要悬停的元素
   * @param {number} x - 相对于视口的 X 坐标
   * @param {number} y - 相对于视口的 Y 坐标
   */
  function simulateHover(element, x, y) {
    // 创建鼠标事件序列来模拟悬停
    const events = [
      new MouseEvent('mouseover', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      }),
      new MouseEvent('mouseenter', {
        view: window,
        bubbles: false,
        cancelable: false,
        clientX: x,
        clientY: y,
      }),
    ];

    // 依次触发事件
    events.forEach((event) => {
      element.dispatchEvent(event);
    });
  }

  /**
   * 检查元素是否可见
   * @param {Element} element - 要检查的元素
   * @returns {boolean} - 元素是否可见
   */
  function isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      return false;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    if (!elementAtPoint) return false;

    return element === elementAtPoint || element.contains(elementAtPoint);
  }

  // 监听来自扩展的消息
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'hoverElement') {
      hoverElement(request.selector)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            error: `意外错误: ${error.message}`,
          });
        });
      return true; // 表示异步响应
    } else if (request.action === 'chrome_hover_element_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });
}
