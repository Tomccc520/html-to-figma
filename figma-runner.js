/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 */

(async () => {
  /**
   * 等待指定毫秒，给页面渲染和资源加载预留时间。
   */
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 逐段滚动页面，尽量触发懒加载资源，提升复制到 Figma 的完整度。
   */
  async function warmupPageByScroll() {
    const totalHeight = document.body?.scrollHeight ?? 0;
    if (totalHeight <= 0) {
      return;
    }

    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    const originalY = window.scrollY;

    for (let y = 0; y < totalHeight; y += step) {
      window.scrollTo(0, y);
      await wait(300);
    }

    await wait(500);
    window.scrollTo(0, originalY);
  }

  /**
   * 等待页面图片加载完成，减少复制后 Figma 中丢图概率。
   */
  async function waitForImages() {
    const images = Array.from(document.images || []);
    if (images.length === 0) {
      return;
    }

    await Promise.allSettled(
      images.map((img) => {
        if (img.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
          setTimeout(resolve, 10000);
        });
      })
    );
  }

  /**
   * 等待字体加载完成，避免捕获时出现字体回退导致样式偏差。
   */
  async function waitForFonts() {
    if (!document.fonts?.ready) {
      return;
    }
    await Promise.race([document.fonts.ready, wait(3000)]);
  }

  /**
   * 执行 Figma 剪贴板采集流程。
   */
  async function runFigmaClipboardCapture() {
    const captureForDesign = window.figma?.captureForDesign;
    if (typeof captureForDesign !== "function") {
      throw new Error("window.figma.captureForDesign 不存在，请确认 capture.js 已注入");
    }

    await warmupPageByScroll();
    await waitForImages();
    await waitForFonts();
    await wait(800);

    // 不传 endpoint/captureId 时，capture.js 走“复制到剪贴板”模式。
    const capturePromise = Promise.resolve(captureForDesign({ selector: "body" }));
    capturePromise.catch((error) => {
      console.error("[Web to Design] Figma clipboard capture failed:", error);
    });

    // 参考脚本在成功后会进入页面浮层状态，Promise 可能长期不结束。
    // 这里给一个快速等待窗口，超时则返回 started，避免弹窗一直“处理中”。
    const quickResult = await Promise.race([
      capturePromise.then((result) => ({ timedOut: false, result })),
      wait(5000).then(() => ({ timedOut: true }))
    ]);

    if (quickResult.timedOut) {
      return { started: true, pending: true };
    }

    return quickResult.result || { success: true };
  }

  return runFigmaClipboardCapture();
})();
