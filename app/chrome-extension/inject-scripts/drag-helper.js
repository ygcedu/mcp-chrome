/* eslint-disable */
/**
 * Drag Helper - 统一拖拽接口
 *
 * API 说明:
 * - from: 拖拽起始位置，可以是:
 *   - 坐标对象: {x: number, y: number}
 *   - 元素选择器字符串: 'button', '#myId', '.myClass' 等
 * - to: 拖拽结束位置，格式同 from
 *
 * 示例:
 * performDrag({ from: {x: 100, y: 200}, to: '#target' })
 * performDrag({ from: '.source', to: {x: 300, y: 400} })
 * performDrag({ from: '#source', to: '#target' })
 */
if (window.__DRAG_HELPER_INITIALIZED__) {
} else {
  window.__DRAG_HELPER_INITIALIZED__ = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const centerOf = (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  const elementFromSelector = (selector) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Element not found for selector: ${selector}`);
    return el;
  };

  const coordsFromEither = (fromOrTo) => {
    // 如果是坐标对象 {x, y}
    if (fromOrTo && typeof fromOrTo.x === 'number' && typeof fromOrTo.y === 'number') {
      return fromOrTo;
    }
    // 如果是字符串选择器
    if (typeof fromOrTo === 'string') {
      return centerOf(elementFromSelector(fromOrTo));
    }
    throw new Error('from/to must be either coordinates {x, y} or element selector string.');
  };

  const dispatchPointer = (el, type, x, y) => {
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
    };
    const evt = new PointerEvent(type, init);
    el.dispatchEvent(evt);
  };

  const dispatchMouse = (el, type, x, y) => {
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
    };
    const evt = new MouseEvent(type, init);
    el.dispatchEvent(evt);
  };

  const dispatchDrag = (el = document, type, x, y, transfer = null) => {
    el.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        dataTransfer: transfer,
      }),
    );
  };

  // 同时分发 Pointer 与 Mouse 事件
  const dispatchBothEvents = (element, type, x, y) => {
    if ('PointerEvent' in window) {
      dispatchPointer(element, type.replace('mouse', 'pointer'), x, y);
    }
    dispatchMouse(element, type.replace('pointer', 'mouse'), x, y);
  };

  // 根据选择器或坐标获取目标元素（含回退）
  const getTargetBySelectorOrPoint = (fromOrTo, point) => {
    // 如果是字符串选择器
    if (typeof fromOrTo === 'string') {
      try {
        return elementFromSelector(fromOrTo);
      } catch (e) {
        console.warn('选择器未找到元素，使用坐标定位:', e.message);
        return document.elementFromPoint(point.x, point.y) || document.body;
      }
    }
    // 如果是坐标对象，直接使用坐标定位
    return document.elementFromPoint(point.x, point.y) || document.body;
  };

  // 可选滚动到视图中心
  const maybeScrollIntoView = async (el, enabled) => {
    if (!enabled || !el || !el.scrollIntoView) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(100);
  };

  // 线性插值拖拽路径生成与移动
  const moveAlongPath = async (target, start, end, steps, stepDelay) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = start.x + (end.x - start.x) * t;
      const y = start.y + (end.y - start.y) * t;
      dispatchBothEvents(target, 'mousemove', x, y);
      if (stepDelay > 0) await sleep(stepDelay);
    }
  };

  async function performDrag(payload) {
    const { from, to, scrollIntoView = true } = payload || {};

    // 固定的拖拽参数
    const durationMs = 300;
    const steps = 20;
    const holdDelayMs = 50;
    const releaseDelayMs = 30;

    if (!from || !to) {
      throw new Error(
        'Both from and to parameters are required. They can be either coordinates {x, y} or element selector strings.',
      );
    }

    console.log('开始拖拽操作:', { from, to });

    const start = coordsFromEither(from);
    const end = coordsFromEither(to);

    // 根据参数类型获取目标元素
    const startTarget = getTargetBySelectorOrPoint(from, start);
    const endTarget = getTargetBySelectorOrPoint(to, end);

    console.log('拖拽目标元素:', {
      startTarget: startTarget.tagName,
      endTarget: endTarget.tagName,
    });

    await maybeScrollIntoView(startTarget, scrollIntoView);
    await maybeScrollIntoView(endTarget, scrollIntoView);

    // 检查元素是否具有 draggable 属性
    const isDraggable = startTarget.draggable || startTarget.getAttribute('draggable') === 'true';
    console.log('元素是否可拖拽:', isDraggable);

    if (isDraggable) {
      // HTML5 原生拖拽流程
      try {
        const dt = new DataTransfer();
        dispatchDrag(startTarget, 'dragstart', start.x, start.y, dt);
        dispatchDrag(endTarget, 'dragenter', end.x, end.y, dt);
        dispatchDrag(endTarget, 'dragover', end.x, end.y, dt);
        dispatchDrag(endTarget, 'drop', end.x, end.y, dt);
        dispatchDrag(startTarget, 'dragend', end.x, end.y, dt);
        console.log('拖拽完成（DataTransfer 版）');
      } catch (e) {
        console.warn('原生拖拽触发失败，回退到模拟拖拽。', e);
      }
    }

    if (!isDraggable) {
      // 阶段1: 鼠标悬停和按下
      console.log('阶段1: 鼠标按下');
      dispatchBothEvents(startTarget, 'mouseover', start.x, start.y);
      dispatchBothEvents(startTarget, 'mouseenter', start.x, start.y);
      dispatchBothEvents(startTarget, 'mousemove', start.x, start.y);
      dispatchBothEvents(startTarget, 'mousedown', start.x, start.y);

      if (holdDelayMs > 0) await sleep(holdDelayMs);

      // 阶段2: 拖拽移动
      console.log('阶段2: 拖拽移动');
      const stepDelay = Math.max(1, Math.floor(durationMs / Math.max(1, steps)));
      await moveAlongPath(startTarget, start, end, steps, stepDelay);

      if (releaseDelayMs > 0) await sleep(releaseDelayMs);

      // 阶段3: 释放和放置
      console.log('阶段3: 鼠标释放');
      dispatchBothEvents(endTarget, 'mouseup', end.x, end.y);
      dispatchBothEvents(endTarget, 'click', end.x, end.y);
      console.log('拖拽操作完成');
    }

    return {
      start,
      end,
      startTarget: startTarget.tagName,
      endTarget: endTarget.tagName,
      isDraggable,
    };
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request && request.action === 'dragElement') {
      (async () => {
        try {
          const data = await performDrag(request.options || request);
          sendResponse({ success: true, message: '拖拽完成', data });
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        }
      })();
      return true; // 异步响应
    } else if (request && request.action === 'chrome_drag_element_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });
}
