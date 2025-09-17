/* eslint-disable */
// interactive-elements-helper.js
// 此脚本被注入到页面中以查找交互元素。
// Calvin 的最终版本，具有多层回退策略
// 和全面的元素支持，构建在高性能和可靠的核心上。

(function () {
  // 防止重复初始化
  if (window.__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__) {
    return;
  }
  window.__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__ = true;

  /**
   * @typedef {Object} ElementInfo
   * @property {string} type - 元素的类型（例如，'button'、'link'）。
   * @property {string} selector - 用于唯一标识元素的 CSS 选择器。
   * @property {string} text - 元素的可见文本或可访问名称。
   * @property {boolean} isInteractive - 元素当前是否交互。
   * @property {Object} [coordinates] - 如果请求，元素的坐标。
   * @property {boolean} [disabled] - 对于可以禁用的元素。
   * @property {string} [href] - 对于链接。
   * @property {boolean} [checked] - 对于复选框和单选按钮。
   */

  /**
   * 元素类型及其相应选择器的配置。
   * 现在更全面，包含常见的 ARIA 角色。
   */
  const ELEMENT_CONFIG = {
    button: 'button, input[type="button"], input[type="submit"], [role="button"]',
    link: 'a[href], [role="link"]',
    input:
      'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    textarea: 'textarea',
    select: 'select',
    tab: '[role="tab"]',
    // 通用交互元素：结合 tabindex、常见角色和显式处理程序。
    // 这是查找自定义构建的交互组件的关键。
    interactive: `[onclick], [tabindex]:not([tabindex^="-"]), [role="menuitem"], [role="slider"], [role="option"], [role="treeitem"]`,
  };

  // 任何交互元素的组合选择器，用于回退逻辑。
  const ANY_INTERACTIVE_SELECTOR = Object.values(ELEMENT_CONFIG).join(', ');

  // --- 核心助手函数 ---

  /**
   * 检查元素在页面上是否真正可见。
   * “可见”意味着它没有使用 display:none、visibility:hidden 等样式。
   * 此检查有意忽略元素是否在当前视口内。
   * @param {Element} el 要检查的元素。
   * @returns {boolean} 如果元素可见则为 true。
   */
  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity) === 0
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || el.tagName === 'A'; // 允许零尺寸锤点，因为它们仍然可以导航
  }

  /**
   * 检查元素是否被认为是交互的（未禁用或从可访问性中隐藏）。
   * @param {Element} el 要检查的元素。
   * @returns {boolean} 如果元素是交互的则为 true。
   */
  function isElementInteractive(el) {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    if (el.closest('[aria-hidden="true"]')) {
      return false;
    }
    return true;
  }

  /**
   * 为给定元素生成相对稳定的 CSS 选择器。
   * @param {Element} el 元素。
   * @returns {string} CSS 选择器。
   */
  function generateSelector(el) {
    if (!(el instanceof Element)) return '';

    if (el.id) {
      const idSelector = `#${CSS.escape(el.id)}`;
      if (document.querySelectorAll(idSelector).length === 1) return idSelector;
    }

    for (const attr of ['data-testid', 'data-cy', 'name']) {
      const attrValue = el.getAttribute(attr);
      if (attrValue) {
        const attrSelector = `[${attr}="${CSS.escape(attrValue)}"]`;
        if (document.querySelectorAll(attrSelector).length === 1) return attrSelector;
      }
    }

    let path = '';
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName !== 'BODY') {
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path = path ? `${selector} > ${path}` : selector;
      current = parent;
    }
    return path ? `body > ${path}` : 'body';
  }

  /**
   * 查找元素的可访问名称（标签、aria-label 等）。
   * @param {Element} el 元素。
   * @returns {string} 可访问名称。
   */
  function getAccessibleName(el) {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const labelElement = document.getElementById(labelledby);
      if (labelElement) return labelElement.textContent?.trim() || '';
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent?.trim() || '';
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent?.trim() || '';
    return (
      el.getAttribute('placeholder') ||
      el.getAttribute('value') ||
      el.textContent?.trim() ||
      el.getAttribute('title') ||
      ''
    );
  }

  /**
   * 用于模糊搜索的简单子序列匹配。
   * @param {string} text 要在其中搜索的文本。
   * @param {string} query 查询子序列。
   * @returns {boolean}
   */
  function fuzzyMatch(text, query) {
    if (!text || !query) return false;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let textIndex = 0;
    let queryIndex = 0;
    while (textIndex < lowerText.length && queryIndex < lowerQuery.length) {
      if (lowerText[textIndex] === lowerQuery[queryIndex]) {
        queryIndex++;
      }
      textIndex++;
    }
    return queryIndex === lowerQuery.length;
  }

  /**
   * 为元素创建标准化的信息对象。
   * 修改以处理来自最终回退的新 'text' 类型。
   */
  function createElementInfo(el, type, includeCoordinates, isInteractiveOverride = null) {
    const isActuallyInteractive = isElementInteractive(el);
    const info = {
      type,
      selector: generateSelector(el),
      text: getAccessibleName(el) || el.textContent?.trim(),
      isInteractive: isInteractiveOverride !== null ? isInteractiveOverride : isActuallyInteractive,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
    };
    if (includeCoordinates) {
      const rect = el.getBoundingClientRect();
      info.coordinates = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
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
    }
    return info;
  }

  /**
   * [核心实用程序] 根据一组类型查找交互元素。
   * 这是我们的高性能第 1 层搜索函数。
   */
  function findInteractiveElements(options = {}) {
    const { textQuery, includeCoordinates = true, types = Object.keys(ELEMENT_CONFIG) } = options;

    const selectorsToFind = types
      .map((type) => ELEMENT_CONFIG[type])
      .filter(Boolean)
      .join(', ');
    if (!selectorsToFind) return [];

    const targetElements = Array.from(document.querySelectorAll(selectorsToFind));
    const uniqueElements = new Set(targetElements);
    const results = [];

    for (const el of uniqueElements) {
      if (!isElementVisible(el) || !isElementInteractive(el)) continue;

      const accessibleName = getAccessibleName(el);
      if (textQuery && !fuzzyMatch(accessibleName, textQuery)) continue;

      let elementType = 'unknown';
      for (const [type, typeSelector] of Object.entries(ELEMENT_CONFIG)) {
        if (el.matches(typeSelector)) {
          elementType = type;
          break;
        }
      }
      results.push(createElementInfo(el, elementType, includeCoordinates));
    }
    return results;
  }

  /**
   * [编排器] 实现 3 层回退逻辑的主入口点。
   * @param {object} options - 主要搜索选项。
   * @returns {ElementInfo[]}
   */
  function findElementsByTextWithFallback(options = {}) {
    const { textQuery, includeCoordinates = true } = options;

    if (!textQuery) {
      return findInteractiveElements({ ...options, types: Object.keys(ELEMENT_CONFIG) });
    }

    // --- 第 1 层：高可靠性搜索匹配文本的交互元素 ---
    let results = findInteractiveElements({ ...options, types: Object.keys(ELEMENT_CONFIG) });
    if (results.length > 0) {
      return results;
    }

    // --- 第 2 层：查找文本，然后查找其交互祖先 ---
    const lowerCaseText = textQuery.toLowerCase();
    const xPath = `//text()[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${lowerCaseText}')]`;
    const textNodes = document.evaluate(
      xPath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );

    const interactiveElements = new Set();
    if (textNodes.snapshotLength > 0) {
      for (let i = 0; i < textNodes.snapshotLength; i++) {
        const parentElement = textNodes.snapshotItem(i).parentElement;
        if (parentElement) {
          const interactiveAncestor = parentElement.closest(ANY_INTERACTIVE_SELECTOR);
          if (
            interactiveAncestor &&
            isElementVisible(interactiveAncestor) &&
            isElementInteractive(interactiveAncestor)
          ) {
            interactiveElements.add(interactiveAncestor);
          }
        }
      }

      if (interactiveElements.size > 0) {
        return Array.from(interactiveElements).map((el) => {
          let elementType = 'interactive';
          for (const [type, typeSelector] of Object.entries(ELEMENT_CONFIG)) {
            if (el.matches(typeSelector)) {
              elementType = type;
              break;
            }
          }
          return createElementInfo(el, elementType, includeCoordinates);
        });
      }
    }

    // --- 第 3 层：最终回退，返回包含文本的任何元素 ---
    const leafElements = new Set();
    for (let i = 0; i < textNodes.snapshotLength; i++) {
      const parentElement = textNodes.snapshotItem(i).parentElement;
      if (parentElement && isElementVisible(parentElement)) {
        leafElements.add(parentElement);
      }
    }

    const finalElements = Array.from(leafElements).filter((el) => {
      return ![...leafElements].some((otherEl) => el !== otherEl && el.contains(otherEl));
    });

    return finalElements.map((el) => createElementInfo(el, 'text', includeCoordinates, true));
  }

  // --- Chrome 消息监听器 ---
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getInteractiveElements') {
      try {
        let elements;
        if (request.selector) {
          // 如果提供了选择器，则绕过基于文本的逻辑并使用直接查询。
          const foundEls = Array.from(document.querySelectorAll(request.selector));
          elements = foundEls.map((el) =>
            createElementInfo(
              el,
              'selected',
              request.includeCoordinates !== false,
              isElementInteractive(el),
            ),
          );
        } else {
          // 否则，使用我们强大的多层文本搜索
          elements = findElementsByTextWithFallback(request);
        }
        sendResponse({ success: true, elements });
      } catch (error) {
        console.error('getInteractiveElements 中出错:', error);
        sendResponse({ success: false, error: error.message });
      }
      return true; // 异步响应
    } else if (request.action === 'chrome_get_interactive_elements_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });

  console.log('交互元素助手脚本已加载');
})();
