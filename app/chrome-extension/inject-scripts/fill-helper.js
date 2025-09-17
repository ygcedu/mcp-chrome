/* eslint-disable */
// fill-helper.js
// 此脚本被注入到页面中以处理表单填充操作

if (window.__FILL_HELPER_INITIALIZED__) {
  // 已初始化，跳过
} else {
  window.__FILL_HELPER_INITIALIZED__ = true;
  /**
   * 用指定值填充输入元素
   * @param {string} selector - 要填充元素的 CSS 选择器
   * @param {string} value - 要填充到元素中的值
   * @returns {Promise<Object>} - 填充操作的结果
   */
  async function fillElement(selector, value) {
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
        type: element.type || null,
        isVisible: isElementVisible(element),
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

      // 检查元素是否可见
      if (!elementInfo.isVisible) {
        return {
          error: `选择器为 "${selector}" 的元素不可见`,
          elementInfo,
        };
      }

      // 检查元素是否为 input、textarea 或 select
      const validTags = ['INPUT', 'TEXTAREA', 'SELECT'];
      const validInputTypes = [
        'text',
        'email',
        'password',
        'number',
        'search',
        'tel',
        'url',
        'date',
        'datetime-local',
        'month',
        'time',
        'week',
        'color',
      ];

      if (!validTags.includes(element.tagName)) {
        return {
          error: `选择器为 "${selector}" 的元素不是可填充元素（必须是 INPUT、TEXTAREA 或 SELECT）`,
          elementInfo,
        };
      }

      // 对于 input 元素，检查类型是否有效
      if (
        element.tagName === 'INPUT' &&
        !validInputTypes.includes(element.type) &&
        element.type !== null
      ) {
        return {
          error: `选择器为 "${selector}" 的输入元素类型为 "${element.type}"，不可填充`,
          elementInfo,
        };
      }

      // 滚动元素到可见区域
      element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 聚焦元素
      element.focus();

      // 根据元素类型填充元素
      if (element.tagName === 'SELECT') {
        // 对于 select 元素，查找匹配值或文本的选项
        let optionFound = false;
        for (const option of element.options) {
          if (option.value === value || option.text === value) {
            element.value = option.value;
            optionFound = true;
            break;
          }
        }

        if (!optionFound) {
          return {
            error: `在 select 元素中未找到值或文本为 "${value}" 的选项`,
            elementInfo,
          };
        }

        // 触发 change 事件
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // 对于 input 和 textarea 元素

        // 清除当前值
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));

        // 设置新值
        element.value = value;

        // 触发 input 和 change 事件
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 失焦元素
      element.blur();

      return {
        success: true,
        message: '元素填充成功',
        elementInfo: {
          ...elementInfo,
          value: element.value, // 在响应中包含最终值
        },
      };
    } catch (error) {
      return {
        error: `填充元素时出错: ${error.message}`,
      };
    }
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

    // 检查元素是否在视口内
    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      return false;
    }

    // 检查元素在其中心点是否实际可见
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    if (!elementAtPoint) return false;

    return element === elementAtPoint || element.contains(elementAtPoint);
  }

  // 监听来自扩展的消息
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'fillElement') {
      fillElement(request.selector, request.value)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            error: `意外错误: ${error.message}`,
          });
        });
      return true; // 表示异步响应
    } else if (request.action === 'chrome_fill_or_select_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });
}
