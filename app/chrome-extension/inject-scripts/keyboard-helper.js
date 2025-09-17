/* eslint-disable */
// keyboard-helper.js
// 此脚本被注入到页面中以处理键盘事件模拟

if (window.__KEYBOARD_HELPER_INITIALIZED__) {
  // 已初始化，跳过
} else {
  window.__KEYBOARD_HELPER_INITIALIZED__ = true;

  // 特殊键到其 KeyboardEvent 属性的映射
  // 键名应为小写以便匹配
  const SPECIAL_KEY_MAP = {
    enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
    escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    space: { key: ' ', code: 'Space', keyCode: 32 },
    backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
    del: { key: 'Delete', code: 'Delete', keyCode: 46 },
    up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    home: { key: 'Home', code: 'Home', keyCode: 36 },
    end: { key: 'End', code: 'End', keyCode: 35 },
    pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
    // 功能键
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `f${i + 1}`,
        { key: `F${i + 1}`, code: `F${i + 1}`, keyCode: 112 + i },
      ]),
    ),
  };

  const MODIFIER_KEYS = {
    ctrl: 'ctrlKey',
    control: 'ctrlKey',
    alt: 'altKey',
    shift: 'shiftKey',
    meta: 'metaKey',
    command: 'metaKey',
    cmd: 'metaKey',
  };

  /**
   * 解析键字符串（例如 "Ctrl+Shift+A"、"Enter"）为主键和修饰符。
   * @param {string} keyString - 单次按键的字符串表示（可包含修饰符）。
   * @returns { {key: string, code: string, keyCode: number, charCode?: number, modifiers: {ctrlKey:boolean, altKey:boolean, shiftKey:boolean, metaKey:boolean}} | null }
   *          如果 keyString 无效或仅表示修饰符，则返回 null。
   */
  function parseSingleKeyCombination(keyString) {
    const parts = keyString.split('+').map((part) => part.trim().toLowerCase());
    const modifiers = {
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    };
    let mainKeyPart = null;

    for (const part of parts) {
      if (MODIFIER_KEYS[part]) {
        modifiers[MODIFIER_KEYS[part]] = true;
      } else if (mainKeyPart === null) {
        // 第一个非修饰符是主键
        mainKeyPart = part;
      } else {
        // 无效格式：单个组合中有多个主键（例如 "Ctrl+A+B"）
        console.error(`无效的键组合字符串: ${keyString}。找到多个主键。`);
        return null;
      }
    }

    if (!mainKeyPart) {
      // 如果 keyString 是 "Ctrl+" 或仅是 "Ctrl"，可能会发生这种情况
      // 如果意图是仅按 'Control'，输入应该是 'Control' 而不是 'Control+'
      // 让我们检查 mainKeyPart 是否实际上是用作主键的修饰符名称
      if (Object.keys(MODIFIER_KEYS).includes(parts[parts.length - 1]) && parts.length === 1) {
        mainKeyPart = parts[parts.length - 1]; // 例如用户想要按 "Control" 键本身
        // 对于 "Control" 键本身，key: "Control"，code: "ControlLeft"（或 Right）
        if (mainKeyPart === 'ctrl' || mainKeyPart === 'control')
          return { key: 'Control', code: 'ControlLeft', keyCode: 17, modifiers };
        if (mainKeyPart === 'alt') return { key: 'Alt', code: 'AltLeft', keyCode: 18, modifiers };
        if (mainKeyPart === 'shift')
          return { key: 'Shift', code: 'ShiftLeft', keyCode: 16, modifiers };
        if (mainKeyPart === 'meta' || mainKeyPart === 'command' || mainKeyPart === 'cmd')
          return { key: 'Meta', code: 'MetaLeft', keyCode: 91, modifiers };
      } else {
        console.error(`无效的键组合字符串: ${keyString}。未指定主键。`);
        return null;
      }
    }

    const specialKey = SPECIAL_KEY_MAP[mainKeyPart];
    if (specialKey) {
      return { ...specialKey, modifiers };
    }

    // 对于单个字符或其他未映射的键
    if (mainKeyPart.length === 1) {
      const charCode = mainKeyPart.charCodeAt(0);
      // 如果 Shift 激活且是字母，使用大写版本作为 'key'
      // 这更接近键盘的实际行为。
      let keyChar = mainKeyPart;
      if (modifiers.shiftKey && mainKeyPart.match(/^[a-z]$/i)) {
        keyChar = mainKeyPart.toUpperCase();
      }

      return {
        key: keyChar,
        code: `Key${mainKeyPart.toUpperCase()}`, // 'a' -> KeyA，'A' -> KeyA
        keyCode: charCode,
        charCode: charCode, // charCode 是遗留的，但一些旧系统可能会使用它
        modifiers,
      };
    }

    console.error(`未知键: ${mainKeyPart} 在字符串 "${keyString}" 中`);
    return null; // 或作为错误处理
  }

  /**
   * 为解析的键模拟单次按键（keydown、(keypress)、keyup）。
   * @param { {key: string, code: string, keyCode: number, charCode?: number, modifiers: object} } parsedKeyInfo
   * @param {Element} element - 目标元素。
   * @returns {{success: boolean, error?: string}}
   */
  function dispatchKeyEvents(parsedKeyInfo, element) {
    if (!parsedKeyInfo) return { success: false, error: '为分发提供的键信息无效。' };

    const { key, code, keyCode, charCode, modifiers } = parsedKeyInfo;

    const eventOptions = {
      key: key,
      code: code,
      bubbles: true,
      cancelable: true,
      composed: true, // 对 shadow DOM 很重要
      view: window,
      ...modifiers, // ctrlKey, altKey, shiftKey, metaKey
      // keyCode/which 已弃用但通常为兼容性而设置
      keyCode: keyCode || (key.length === 1 ? key.charCodeAt(0) : 0),
      which: keyCode || (key.length === 1 ? key.charCodeAt(0) : 0),
    };

    try {
      const kdRes = element.dispatchEvent(new KeyboardEvent('keydown', eventOptions));

      // keypress 已弃用，但如果是字符键或 Enter 则模拟
      // 仅在 keydown 未被取消且是产生字符的键时分发
      if (kdRes && (key.length === 1 || key === 'Enter' || key === ' ')) {
        const keypressOptions = { ...eventOptions };
        if (charCode) keypressOptions.charCode = charCode;
        element.dispatchEvent(new KeyboardEvent('keypress', keypressOptions));
      }

      element.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
      return { success: true };
    } catch (error) {
      console.error(`为 "${key}" 分发键事件时出错:`, error);
      return {
        success: false,
        error: `为 "${key}" 分发键事件时出错: ${error.message}`,
      };
    }
  }

  /**
   * 在元素或文档上模拟键盘事件
   * @param {string} keysSequenceString - 键的字符串表示（例如 "Enter"、"Ctrl+C, A, B"）
   * @param {Element} targetElement - 要分发事件的元素（可选）
   * @param {number} delay - 键序列之间的延迟（毫秒）（可选）
   * @returns {Promise<Object>} - 键盘操作的结果
   */
  async function simulateKeyboard(keysSequenceString, targetElement = null, delay = 0) {
    try {
      const element = targetElement || document.activeElement || document.body;

      if (element !== document.activeElement && typeof element.focus === 'function') {
        element.focus();
        await new Promise((resolve) => setTimeout(resolve, 50)); // 聚焦的小延迟
      }

      const keyCombinations = keysSequenceString
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      const operationResults = [];

      for (let i = 0; i < keyCombinations.length; i++) {
        const comboString = keyCombinations[i];
        const parsedKeyInfo = parseSingleKeyCombination(comboString);

        if (!parsedKeyInfo) {
          operationResults.push({
            keyCombination: comboString,
            success: false,
            error: `无效的键字符串或组合: ${comboString}`,
          });
          continue; // 跳到序列中的下一个组合
        }

        const dispatchResult = dispatchKeyEvents(parsedKeyInfo, element);
        operationResults.push({
          keyCombination: comboString,
          ...dispatchResult,
        });

        if (dispatchResult.error) {
          // 可选择决定序列是否应在第一个错误时停止
          // 现在我们继续但在结果中记录错误
          console.warn(`模拟键组合 "${comboString}" 失败: ${dispatchResult.error}`);
        }

        if (delay > 0 && i < keyCombinations.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // 检查所有单独操作是否成功
      const overallSuccess = operationResults.every((r) => r.success);

      return {
        success: overallSuccess,
        message: overallSuccess
          ? `键盘事件模拟成功: ${keysSequenceString}`
          : `某些键盘事件失败: ${keysSequenceString}`,
        results: operationResults, // 每个键组合的详细结果
        targetElement: {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          type: element.type, // 如果适用，例如对于 input
        },
      };
    } catch (error) {
      console.error('simulateKeyboard 中的错误:', error);
      return {
        success: false,
        error: `模拟键盘事件时出错: ${error.message}`,
        results: [],
      };
    }
  }

  // 监听来自扩展的消息
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'simulateKeyboard') {
      let targetEl = null;
      if (request.selector) {
        targetEl = document.querySelector(request.selector);
        if (!targetEl) {
          sendResponse({
            success: false,
            error: `未找到选择器为 "${request.selector}" 的元素`,
            results: [],
          });
          return true; // 保持通道开放以进行异步响应
        }
      }

      simulateKeyboard(request.keys, targetEl, request.delay)
        .then(sendResponse)
        .catch((error) => {
          // 此 catch 用于 simulateKeyboard promise 链本身的意外错误
          console.error('simulateKeyboard promise 链中的意外错误:', error);
          sendResponse({
            success: false,
            error: `键盘模拟期间的意外错误: ${error.message}`,
            results: [],
          });
        });
      return true; // 表示期望异步响应
    } else if (request.action === 'chrome_keyboard_ping') {
      sendResponse({ status: 'pong', initialized: true }); // 响应已初始化
      return false; // 同步响应
    }
    // 不是我们的消息，或不需要异步响应
    return false;
  });
}
