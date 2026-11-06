/**
 * 课堂置顶悬浮双语字幕窗控制器 (Document Picture-in-Picture API)
 * 整堂课不间断连续显示「原始语言全文 ⇄ 中文翻译全文」实时对照
 */
export class FloatingSubtitlePiP {
  constructor({ onToggleRecognition, onClose }) {
    this.pipWindow = null;
    this.fontSize = 15;
    this.onToggleRecognition = onToggleRecognition || (() => {});
    this.onClose = onClose || (() => {});
  }

  get isSupported() {
    return "documentPictureInPicture" in window;
  }

  get isOpen() {
    return Boolean(this.pipWindow && !this.pipWindow.closed);
  }

  async open(initialState = {}) {
    if (!this.isSupported) {
      throw new Error(
        "当前浏览器不支持 Document Picture-in-Picture API（建议使用桌面版 Chrome / Edge 116+）"
      );
    }

    if (this.isOpen) {
      this.pipWindow.focus();
      return this.pipWindow;
    }

    this.pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 620,
      height: 300
    });

    const doc = this.pipWindow.document;
    doc.head.innerHTML = `
      <meta charset="utf-8" />
      <title>整堂课实时双语对照悬浮窗</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
          background: #0b1120;
          color: #f8fafc;
          height: 100vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          user-select: text;
        }
        .pip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          background: rgba(15, 23, 42, 0.95);
          border-bottom: 1px solid rgba(148, 163, 184, 0.16);
          font-size: 12px;
          color: #94a3b8;
        }
        .pip-status {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.7);
        }
        .dot.paused { background: #f59e0b; box-shadow: none; }
        .dot.error { background: #ef4444; }
        .pip-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pip-btn {
          background: rgba(51, 65, 85, 0.65);
          color: #e2e8f0;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 5px;
          padding: 2px 8px;
          font-size: 11px;
          cursor: pointer;
        }
        .pip-btn:hover { background: rgba(71, 85, 105, 0.9); }
        .pip-flow-box {
          flex: 1;
          margin: 8px 10px;
          background: rgba(17, 24, 39, 0.88);
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-top: 2px solid #38bdf8;
          border-radius: 8px;
          padding: 10px 12px;
          overflow-y: auto;
          font-size: var(--pip-font-size, 15px);
          line-height: 1.6;
        }
        .pip-utterance {
          padding: 6px 0;
          border-bottom: 1px dashed rgba(148, 163, 184, 0.14);
        }
        .pip-utterance:last-child {
          border-bottom: none;
        }
        .pip-orig {
          color: #cbd5e1;
          margin-bottom: 2px;
        }
        .pip-zh {
          color: #f8fafc;
          font-weight: 600;
        }
        .pip-live .pip-orig {
          color: #38bdf8;
        }
        .pip-live .pip-zh {
          color: #34d399;
        }
      </style>
    `;

    doc.body.innerHTML = `
      <div class="pip-header">
        <div class="pip-status">
          <span id="pip-dot" class="dot"></span>
          <span id="pip-status-text">整堂课单框双语同传运行中</span>
        </div>
        <div class="pip-actions">
          <button id="pip-font-dec" class="pip-btn" title="缩小字号">A-</button>
          <button id="pip-font-inc" class="pip-btn" title="放大字号">A+</button>
          <button id="pip-toggle-btn" class="pip-btn">暂停/继续</button>
        </div>
      </div>
      <div id="pip-flow-box" class="pip-flow-box">
        等待老师开始讲课，每一段话的双语对照将在此同一输出框内连续生成...
      </div>
    `;

    doc.getElementById("pip-font-dec").addEventListener("click", () => {
      this.fontSize = Math.max(12, this.fontSize - 2);
      doc
        .getElementById("pip-flow-box")
        .style.setProperty("--pip-font-size", `${this.fontSize}px`);
    });

    doc.getElementById("pip-font-inc").addEventListener("click", () => {
      this.fontSize = Math.min(26, this.fontSize + 2);
      doc
        .getElementById("pip-flow-box")
        .style.setProperty("--pip-font-size", `${this.fontSize}px`);
    });

    doc.getElementById("pip-toggle-btn").addEventListener("click", () => {
      this.onToggleRecognition();
    });

    this.pipWindow.addEventListener("pagehide", () => {
      this.pipWindow = null;
      this.onClose();
    });

    this.update(initialState);
    return this.pipWindow;
  }

  update({
    isListening,
    statusText,
    liveInterim,
    liveInterimTranslation,
    recentItems = [],
    hasError = false
  }) {
    if (!this.isOpen) return;
    const doc = this.pipWindow.document;

    const dotEl = doc.getElementById("pip-dot");
    const statusEl = doc.getElementById("pip-status-text");
    const flowBox = doc.getElementById("pip-flow-box");

    if (dotEl) {
      dotEl.className = `dot ${hasError ? "error" : isListening ? "" : "paused"}`;
    }
    if (statusEl && statusText) {
      statusEl.textContent = statusText;
    }

    if (flowBox) {
      const wasScrolledUp =
        flowBox.scrollHeight - flowBox.scrollTop - flowBox.clientHeight > 50;
      const prevScrollTop = flowBox.scrollTop;

      const historyHtml = recentItems
        .map(
          (i) => `
          <div class="pip-utterance">
            <div class="pip-orig">${this.escapeHtml(
              i.correctedSource || i.source || ""
            )}</div>
            <div class="pip-zh">${this.escapeHtml(
              i.translation || "正在同步翻译..."
            )}</div>
          </div>
        `
        )
        .join("");

      const liveHtml = liveInterim
        ? `
          <div class="pip-utterance pip-live">
            <div class="pip-orig">${this.escapeHtml(liveInterim)}</div>
            <div class="pip-zh">${this.escapeHtml(
              liveInterimTranslation || "正在同步翻译..."
            )}</div>
          </div>
        `
        : "";

      flowBox.innerHTML =
        historyHtml || liveHtml
          ? `${historyHtml}${liveHtml}`
          : "等待语音输入，每一段话的双语对照将在此同一输出框内连续生成...";

      if (wasScrolledUp) {
        flowBox.scrollTop = prevScrollTop;
      } else {
        flowBox.scrollTop = flowBox.scrollHeight;
      }
    }
  }

  close() {
    if (this.isOpen) {
      this.pipWindow.close();
      this.pipWindow = null;
    }
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
