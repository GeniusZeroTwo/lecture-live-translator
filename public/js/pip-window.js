/**
 * 课堂置顶悬浮双语字幕窗控制器 (Document Picture-in-Picture API)
 * 让留学生全屏看俄语/英语课件或记笔记时，依然能看到始终置顶的「原始语言 + 中文翻译」实时双语对照字幕
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
      width: 580,
      height: 280
    });

    const doc = this.pipWindow.document;
    doc.head.innerHTML = `
      <meta charset="utf-8" />
      <title>课堂实时双语对照悬浮字幕</title>
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
        .pip-body {
          flex: 1;
          padding: 10px 14px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          gap: 8px;
          font-size: var(--pip-font-size, 15px);
        }
        .pip-card {
          background: rgba(30, 41, 59, 0.72);
          border-left: 3px solid #38bdf8;
          border-radius: 6px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .pip-orig {
          color: #93c5fd;
          font-size: 0.88em;
          line-height: 1.4;
        }
        .pip-zh {
          color: #f8fafc;
          font-weight: 600;
          line-height: 1.45;
        }
        .pip-live {
          background: rgba(15, 23, 42, 0.95);
          border-top: 1px solid rgba(56, 189, 248, 0.28);
          padding: 7px 14px;
          font-size: 0.85em;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .pip-live-orig {
          color: #38bdf8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pip-live-zh {
          color: #34d399;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    `;

    doc.body.innerHTML = `
      <div class="pip-header">
        <div class="pip-status">
          <span id="pip-dot" class="dot"></span>
          <span id="pip-status-text">实时双语对照同传运行中</span>
        </div>
        <div class="pip-actions">
          <button id="pip-font-dec" class="pip-btn" title="缩小字号">A-</button>
          <button id="pip-font-inc" class="pip-btn" title="放大字号">A+</button>
          <button id="pip-toggle-btn" class="pip-btn">暂停/继续</button>
        </div>
      </div>
      <div id="pip-body" class="pip-body">
        <div class="pip-card">
          <div class="pip-orig">Ожидание речи преподавателя / Waiting for lecture speech...</div>
          <div class="pip-zh">等待老师开始讲课，此处将实时显示「原始语言 + 中文翻译」对照...</div>
        </div>
      </div>
      <div id="pip-live" class="pip-live">
        <div id="pip-live-orig" class="pip-live-orig">🎙️ 原始语言: 正在监听课堂音频...</div>
        <div id="pip-live-zh" class="pip-live-zh">⚡ 实时翻译: 等待语音输入...</div>
      </div>
    `;

    doc.getElementById("pip-font-dec").addEventListener("click", () => {
      this.fontSize = Math.max(12, this.fontSize - 2);
      doc
        .getElementById("pip-body")
        .style.setProperty("--pip-font-size", `${this.fontSize}px`);
    });

    doc.getElementById("pip-font-inc").addEventListener("click", () => {
      this.fontSize = Math.min(28, this.fontSize + 2);
      doc
        .getElementById("pip-body")
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
    const liveOrigEl = doc.getElementById("pip-live-orig");
    const liveZhEl = doc.getElementById("pip-live-zh");
    const bodyEl = doc.getElementById("pip-body");

    if (dotEl) {
      dotEl.className = `dot ${hasError ? "error" : isListening ? "" : "paused"}`;
    }
    if (statusEl && statusText) {
      statusEl.textContent = statusText;
    }
    if (liveOrigEl) {
      liveOrigEl.textContent = liveInterim
        ? `🎙️ 原文: ${liveInterim}`
        : isListening
        ? "🎙️ 原文: 正在监听课堂声音..."
        : "⏸️ 已暂停拾音";
    }
    if (liveZhEl) {
      liveZhEl.textContent = liveInterim
        ? `⚡ 译文: ${liveInterimTranslation || "正在实时同步翻译..."}`
        : "⚡ 译文: 说话时实时同步显示中文对照";
    }
    if (bodyEl && recentItems.length > 0) {
      const slice = recentItems.slice(-2);
      bodyEl.innerHTML = slice
        .map(
          (item) => `
          <div class="pip-card">
            <div class="pip-orig">${this.escapeHtml(
              item.correctedSource || item.source || ""
            )}</div>
            <div class="pip-zh">${this.escapeHtml(
              item.translation || "正在精翻..."
            )}</div>
          </div>
        `
        )
        .join("");
      bodyEl.scrollTop = bodyEl.scrollHeight;
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
