// 使用 Chrome Debugger 协议来模拟鼠标行为的工具函数
// 封装了 attach/sendCommand/detach 的完整生命周期，并在页面中计算元素中心点

export interface HoverResult {
  elementInfo: any;
  hoverPosition: { x: number; y: number };
}

/**
 * 在 MAIN world 中计算元素中心点，并通过 Debugger 发送 mouseMoved 事件以模拟鼠标悬停
 * @param tabId 目标标签页 ID
 * @param selector 目标元素的 CSS 选择器
 */
export async function hoverByDebugger(tabId: number, selector: string): Promise<HoverResult> {
  // 1) 在页面中计算元素中心点
  const [{ result }] = (await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`未找到选择器为 "${sel}" 的元素`);
      (el as Element).scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
      const rect = (el as Element).getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const info = {
        tagName: (el as HTMLElement).tagName,
        id: (el as HTMLElement).id || '',
        className: (el as HTMLElement).className || '',
        text: ((el as HTMLElement).textContent || '').trim().slice(0, 100),
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
      return { centerX: cx, centerY: cy, elementInfo: info };
    },
    args: [selector],
  })) as any;

  const { centerX, centerY, elementInfo } = result as {
    centerX: number;
    centerY: number;
    elementInfo: any;
  };

  // 2) 确保调试器未被其他客户端占用（如 DevTools）
  const targets = await chrome.debugger.getTargets();
  const occupied = targets.find((t) => t.tabId === tabId && t.attached && !t.extensionId);
  if (occupied) {
    throw new Error(`调试器已被其它客户端占用，无法在标签页 ${tabId} 上模拟鼠标移动进行悬停。`);
  }

  // 3) attach -> 发送 mouseMoved -> detach
  const target: chrome.debugger.Debuggee = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.max(0, Math.round(centerX)),
      y: Math.max(0, Math.round(centerY)),
      buttons: 0,
    });
  } finally {
    try {
      // await chrome.debugger.detach(target); // 如需严格释放可开启
    } catch (e) {
      // ignore
    }
  }

  return {
    elementInfo,
    hoverPosition: { x: Math.round(centerX), y: Math.round(centerY) },
  };
}
