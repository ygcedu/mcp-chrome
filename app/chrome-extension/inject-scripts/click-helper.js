/* eslint-disable */
// click-helper.js
// 此脚本被注入到页面中以处理点击操作

if (window.__CLICK_HELPER_INITIALIZED__) {
  // 已初始化，跳过
} else {
  window.__CLICK_HELPER_INITIALIZED__ = true;
  /**
   * 点击匹配选择器的元素或特定坐标
   * @param {string} selector - 要点击元素的 CSS 选择器
   * @param {boolean} waitForNavigation - 是否等待点击后导航完成
   * @param {number} timeout - 等待元素或导航的超时时间（毫秒）
   * @param {Object} coordinates - 在特定位置点击的可选坐标
   * @param {number} coordinates.x - 相对于视口的 X 坐标
   * @param {number} coordinates.y - 相对于视口的 Y 坐标
   * @returns {Promise<Object>} - 点击操作的结果
   */
  async function clickElement(
    selector,
    waitForNavigation = false,
    timeout = 5000,
    coordinates = null,
  ) {
    try {
      let element = null;
      let elementInfo = null;
      let clickX, clickY;

      if (coordinates && typeof coordinates.x === 'number' && typeof coordinates.y === 'number') {
        clickX = coordinates.x;
        clickY = coordinates.y;

        element = document.elementFromPoint(clickX, clickY);

        if (element) {
          const rect = element.getBoundingClientRect();
          elementInfo = {
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
            clickMethod: 'coordinates',
            clickPosition: { x: clickX, y: clickY },
          };
        } else {
          elementInfo = {
            clickMethod: 'coordinates',
            clickPosition: { x: clickX, y: clickY },
            warning: '在指定坐标处未找到元素',
          };
        }
      } else {
        element = document.querySelector(selector);
        if (!element) {
          return {
            error: `未找到选择器为 "${selector}" 的元素`,
          };
        }

        const rect = element.getBoundingClientRect();
        elementInfo = {
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
          clickMethod: 'selector',
        };

        // 首先滚动使元素可见，然后检查可见性。
        element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        elementInfo.isVisible = isElementVisible(element);
        if (!elementInfo.isVisible) {
          return {
            error: `选择器为 "${selector}" 的元素不可见`,
            elementInfo,
          };
        }

        const updatedRect = element.getBoundingClientRect();
        clickX = updatedRect.left + updatedRect.width / 2;
        clickY = updatedRect.top + updatedRect.height / 2;
      }

      let navigationPromise;
      if (waitForNavigation) {
        navigationPromise = new Promise((resolve) => {
          const beforeUnloadListener = () => {
            window.removeEventListener('beforeunload', beforeUnloadListener);
            resolve(true);
          };
          window.addEventListener('beforeunload', beforeUnloadListener);

          setTimeout(() => {
            window.removeEventListener('beforeunload', beforeUnloadListener);
            resolve(false);
          }, timeout);
        });
      }

      if (element && elementInfo.clickMethod === 'selector') {
        element.click();
      } else {
        simulateClick(clickX, clickY);
      }

      // 如果需要，等待导航
      let navigationOccurred = false;
      if (waitForNavigation) {
        navigationOccurred = await navigationPromise;
      }

      return {
        success: true,
        message: '元素点击成功',
        elementInfo,
        navigationOccurred,
      };
    } catch (error) {
      return {
        error: `点击元素时出错: ${error.message}`,
      };
    }
  }

  /**
   * 在特定坐标模拟鼠标点击
   * @param {number} x - 相对于视口的 X 坐标
   * @param {number} y - 相对于视口的 Y 坐标
   */
  function simulateClick(x, y) {
    const clickEvent = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    });

    const element = document.elementFromPoint(x, y);

    if (element) {
      element.dispatchEvent(clickEvent);
    } else {
      document.dispatchEvent(clickEvent);
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
    if (request.action === 'clickElement') {
      clickElement(
        request.selector,
        request.waitForNavigation,
        request.timeout,
        request.coordinates,
      )
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            error: `意外错误: ${error.message}`,
          });
        });
      return true; // 表示异步响应
    } else if (request.action === 'chrome_click_element_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });
}
