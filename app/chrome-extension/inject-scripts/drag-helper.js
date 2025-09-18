/* eslint-disable */
(() => {
  const EVENT_NAME = {
    RESPONSE: 'chrome-mcp:response',
    CLEANUP: 'chrome-mcp:cleanup',
    EXECUTE: 'chrome-mcp:execute',
  };

  function getMouseButtonCode(button) {
    switch (button) {
      case 'middle':
        return 1;
      case 'right':
        return 2;
      case 'left':
      default:
        return 0;
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function centerOf(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function elementFromSelector(selector) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Element not found for selector: ${selector}`);
    return el;
  }

  function coordsFromEither(point, selector) {
    if (point && typeof point.x === 'number' && typeof point.y === 'number') return point;
    if (selector) return centerOf(elementFromSelector(selector));
    throw new Error('Either coordinates or selector must be provided.');
  }

  function dispatchPointer(el, type, x, y, opts) {
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: opts.buttons ?? 1,
      button: opts.button ?? 0,
    };
    const evt = new PointerEvent(type, init);
    el.dispatchEvent(evt);
  }

  function dispatchMouse(el, type, x, y, opts) {
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      buttons: opts.buttons ?? 1,
      button: opts.button ?? 0,
    };
    const evt = new MouseEvent(type, init);
    el.dispatchEvent(evt);
  }

  async function performDrag(payload) {
    const {
      fromSelector,
      toSelector,
      from,
      to,
      durationMs = 300,
      steps = 20,
      button = 'left',
      holdDelayMs = 50,
      releaseDelayMs = 30,
      usePointerEvents = true,
      scrollIntoView = true,
    } = payload || {};

    const start = coordsFromEither(from, fromSelector);
    const end = coordsFromEither(to, toSelector);

    // 定位事件目标元素（尽量在起点处命中最前元素）
    const startTarget = document.elementFromPoint(start.x, start.y) || document.body;
    const endTarget = document.elementFromPoint(end.x, end.y) || document.body;

    if (scrollIntoView) {
      if (startTarget && startTarget.scrollIntoView)
        startTarget.scrollIntoView({ block: 'center' });
      if (endTarget && endTarget.scrollIntoView) endTarget.scrollIntoView({ block: 'center' });
    }

    const buttonCode = getMouseButtonCode(button);

    const dispatch = usePointerEvents && 'PointerEvent' in window ? dispatchPointer : dispatchMouse;

    // 按下
    dispatch(startTarget, 'pointerover', start.x, start.y, { buttons: 0, button: buttonCode });
    dispatch(startTarget, 'pointermove', start.x, start.y, { buttons: 0, button: buttonCode });
    dispatch(startTarget, 'pointerdown', start.x, start.y, { buttons: 1, button: buttonCode });

    // 触发 HTML5 dragstart（尽量）
    const dragStart = new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      clientX: start.x,
      clientY: start.y,
    });
    startTarget.dispatchEvent(dragStart);

    if (holdDelayMs > 0) await sleep(holdDelayMs);

    // 移动（插值）
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = start.x + (end.x - start.x) * t;
      const y = start.y + (end.y - start.y) * t;
      const moveTarget = document.elementFromPoint(x, y) || document.body;
      dispatch(moveTarget, 'pointermove', x, y, { buttons: 1, button: buttonCode });
      const dragOver = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      moveTarget.dispatchEvent(dragOver);
      await sleep(durationMs / steps);
    }

    if (releaseDelayMs > 0) await sleep(releaseDelayMs);

    // 松开
    const dropTarget = document.elementFromPoint(end.x, end.y) || document.body;
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: end.x,
      clientY: end.y,
    });
    dropTarget.dispatchEvent(drop);

    dispatch(dropTarget, 'pointerup', end.x, end.y, { buttons: 0, button: buttonCode });
    const dragEnd = new DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      clientX: end.x,
      clientY: end.y,
    });
    (document.elementFromPoint(start.x, start.y) || startTarget).dispatchEvent(dragEnd);

    return { start, end };
  }

  const onExecute = async (event) => {
    const { action, payload, requestId } = event.detail || {};
    if (action !== 'drag') return;
    try {
      const data = await performDrag(payload);
      window.dispatchEvent(new CustomEvent(EVENT_NAME.RESPONSE, { detail: { requestId, data } }));
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME.RESPONSE, {
          detail: { requestId, error: error instanceof Error ? error.message : String(error) },
        }),
      );
    }
  };

  window.addEventListener(EVENT_NAME.EXECUTE, onExecute);
  window.addEventListener(EVENT_NAME.CLEANUP, () => {
    window.removeEventListener(EVENT_NAME.EXECUTE, onExecute);
  });
})();
