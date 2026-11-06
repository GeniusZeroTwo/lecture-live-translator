/**
 * 留学课堂实时同传助手主控制器 (app.js)
 * 特性：
 * 1. 全面支持俄语 (ru-RU)、英语 (en-US) 等多语种实时课堂语音识别与翻译
 * 2. 整堂课不间断连续全文对照：不分碎卡片，左侧（或上方）连续显示整堂课原始语言全文，右侧（或下方）连续同步显示整堂课中文翻译全文，说话时直接在末尾实时追加
 * 3. 前台隐藏 API 添加入口，支持后台 Cloudflare「变量和密钥」配置 API 选项与 ACCESS_PASSWORD 访问密码
 */
import {
  SUPPORTED_LANGUAGES,
  getLanguageMeta,
  APIHealthMonitor,
  WebSpeechClassroomEngine,
  translateLiveInterimText,
  translateLectureSegment
} from "./providers.js";
import { ClassroomAudioGuardian } from "./audio-meter.js";
import { FloatingSubtitlePiP } from "./pip-window.js";

const STORAGE_KEY_SETTINGS = "classsync_settings_v2";
const STORAGE_KEY_TRANSCRIPT = "classsync_transcript_v2";
const STORAGE_KEY_GLOSSARY = "classsync_extracted_terms_v2";

const DEMO_LECTURE_BY_LANG = {
  ru: [
    "Доброе утро, уважаемые студенты. Сегодня на лекции мы подробно рассмотрим, как метод обратного распространения ошибки и стохастический градиентный спуск оптимизируют глубокие нейронные сети.",
    "Обратите особое внимание перед экзаменом: слишком высокая скорость обучения часто приводит к расходимости алгоритма и колебаниям вокруг локального минимума функции потерь.",
    "С точки зрения макроэкономической теории, равновесие Нэша объясняет, почему центральный банк должен учитывать инфляционные ожидания при изменении ключевой процентной ставки."
  ],
  en: [
    "Good morning everyone. Today we are going to examine how backpropagation and stochastic gradient descent optimize deep neural networks when the loss landscape is highly non-convex.",
    "A common misconception on the midterm exam is that increasing the learning rate always accelerates convergence, whereas in practice it often causes divergence or oscillation around local minima.",
    "From a macroeconomic perspective, Nash equilibrium explains why central banks must account for rational expectations when adjusting monetary policy and interest rates."
  ],
  ja: [
    "皆さんおはようございます。本日の講義では、誤差逆伝播法と確率的勾配降下法が深層ニューラルネットワークをどのように最適化するかを詳しく解説します。"
  ],
  de: [
    "Guten Morgen zusammen. In der heutigen Vorlesung untersuchen wir, wie Backpropagation und das Gradientenverfahren tiefe neuronale Netze optimieren."
  ],
  fr: [
    "Bonjour à tous. Aujourd'hui, nous allons examiner comment la rétropropagation et la descente de gradient optimisent les réseaux de neurones profonds."
  ],
  ko: [
    "여러분 좋은 아침입니다. 오늘 강의에서는 역전파 알고리즘과 확률적 경사 하강법이 심층 신경망을 어떻게 최적화하는지 살펴보겠습니다."
  ],
  es: [
    "Buenos días a todos. Hoy analizaremos cómo la retropropagación y el descenso de gradiente estocástico optimizan las redes neuronales profundas."
  ]
};

class LectureTranslatorApp {
  constructor() {
    this.settings = this.loadSettings();
    this.transcriptList = this.loadTranscript();
    this.extractedTerms = this.loadExtractedTerms();

    this.isListening = false;
    this.liveInterimText = "";
    this.liveInterimTranslation = "";
    this.filterStarredOnly = false;
    this.demoTimer = null;
    this.interimTransTimer = null;
    this.interimRequestSeq = 0;
    this.isSyncingScroll = false;

    // 1. 初始化实时翻译健康监控中心
    this.healthMonitor = new APIHealthMonitor((healthState) => {
      this.renderHealthUI(healthState);
    });

    // 2. 初始化课堂远场麦克风与防息屏守护
    this.audioGuardian = new ClassroomAudioGuardian({
      onVolumeChange: (level) => this.updateMicVolumeUI(level),
      onWakeLockChange: (wlState) => this.updateWakeLockUI(wlState)
    });

    // 3. 初始化置顶悬浮双语字幕窗 (Document PiP)
    this.pipController = new FloatingSubtitlePiP({
      onToggleRecognition: () => this.toggleListening(),
      onClose: () => this.updatePiPButtonUI()
    });

    // 4. 初始化 Web Speech 课堂连续识别引擎
    this.asrEngine = new WebSpeechClassroomEngine({
      lang: this.settings.sourceLang,
      onInterim: (interim) => this.handleInterimSpeech(interim),
      onFinalSegment: (sentence, meta) =>
        this.handleFinalSpeechSegment(sentence, meta),
      onStateChange: (asrPatch) => {
        this.healthMonitor.updateAsr(asrPatch);
        this.syncPiPWindow();
      }
    });

    this.initDOM();
    this.syncLanguageUI();
    this.renderTranscriptList();
    this.renderExtractedTerms();
    this.runInitialHealthProbe();
  }

  loadSettings() {
    const defaults = {
      sourceLang: "ru-RU",
      targetLang: "简体中文",
      compareLayout: "stacked", // stacked (每段上下双语对照) | side-by-side (每段左右双语对照)
      courseSubject: "计算机科学与人工智能 (Computer Science & AI)",
      glossaryKeywords: "",
      farFieldMic: true,
      passcode: ""
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS));
      if (saved && typeof saved === "object") {
        return { ...defaults, ...saved };
      }
    } catch (_) {}
    return defaults;
  }

  saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(this.settings));
    } catch (_) {}
  }

  loadTranscript() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_TRANSCRIPT));
      if (!Array.isArray(saved)) return [];
      return saved.filter(
        (item) => !/MYMEMORY WARNING/i.test(String(item?.translation || ""))
      );
    } catch (_) {
      return [];
    }
  }

  saveTranscript() {
    try {
      localStorage.setItem(
        STORAGE_KEY_TRANSCRIPT,
        JSON.stringify(this.transcriptList.slice(-500))
      );
    } catch (_) {}
  }

  loadExtractedTerms() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_GLOSSARY));
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  }

  saveExtractedTerms() {
    try {
      localStorage.setItem(
        STORAGE_KEY_GLOSSARY,
        JSON.stringify(this.extractedTerms.slice(-150))
      );
    } catch (_) {}
  }

  initDOM() {
    this.btnStartStop = document.getElementById("btn-start-stop");
    this.btnDemoLecture = document.getElementById("btn-demo-lecture");
    this.btnOpenPiP = document.getElementById("btn-open-pip");
    this.btnPingHealth = document.getElementById("btn-ping-health");
    this.btnToggleHealthPanel = document.getElementById(
      "btn-toggle-health-panel"
    );

    this.selectSourceLang = document.getElementById("select-source-lang");
    this.selectCompareLayout = document.getElementById("select-compare-layout");
    this.selectCourseSubject = document.getElementById("select-course-subject");
    this.inputGlossary = document.getElementById("input-glossary");
    this.toggleFarField = document.getElementById("toggle-far-field");

    if (SUPPORTED_LANGUAGES[this.settings.sourceLang]) {
      this.selectSourceLang.value = this.settings.sourceLang;
    } else {
      this.settings.sourceLang = "ru-RU";
      this.selectSourceLang.value = "ru-RU";
    }
    this.selectCompareLayout.value =
      this.settings.compareLayout || "side-by-side";
    this.selectCourseSubject.value = this.settings.courseSubject;
    this.inputGlossary.value = this.settings.glossaryKeywords;
    this.toggleFarField.checked = this.settings.farFieldMic;

    this.btnStartStop.addEventListener("click", () => this.toggleListening());
    this.btnDemoLecture.addEventListener("click", () =>
      this.runClassroomSimulation()
    );
    this.btnOpenPiP.addEventListener("click", () => this.togglePiPWindow());
    this.btnPingHealth.addEventListener("click", () =>
      this.runInitialHealthProbe(true)
    );
    this.btnToggleHealthPanel.addEventListener("click", () => {
      const panel = document.getElementById("health-detail-drawer");
      panel.classList.toggle("collapsed");
    });

    this.selectSourceLang.addEventListener("change", (e) => {
      this.setSourceLanguage(e.target.value);
    });

    document.querySelectorAll(".quick-lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lang = btn.getAttribute("data-lang");
        if (lang) {
          this.setSourceLanguage(lang);
          const meta = getLanguageMeta(lang);
          this.showBannerNotice(`已切换授课语言为：${meta.flag} ${meta.name}`, "success");
        }
      });
    });

    this.selectCompareLayout.addEventListener("change", (e) => {
      this.settings.compareLayout = e.target.value;
      this.saveSettings();
      this.renderTranscriptList(false);
    });

    this.selectCourseSubject.addEventListener("change", (e) => {
      this.settings.courseSubject = e.target.value;
      this.saveSettings();
    });

    this.inputGlossary.addEventListener("input", (e) => {
      this.settings.glossaryKeywords = e.target.value;
      this.saveSettings();
    });

    this.toggleFarField.addEventListener("change", async (e) => {
      this.settings.farFieldMic = e.target.checked;
      this.saveSettings();
      if (this.isListening) {
        await this.audioGuardian.startMicrophoneMonitor(
          this.settings.farFieldMic
        );
      }
    });

    const manualForm = document.getElementById("manual-input-form");
    const manualInput = document.getElementById("manual-sentence-input");
    manualForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = manualInput.value.trim();
      if (!val) return;
      manualInput.value = "";

      const hasCyrillic = /[\u0400-\u04FF]/.test(val);
      const detectedLang = hasCyrillic ? "ru-RU" : this.settings.sourceLang;
      this.handleFinalSpeechSegment(val, {
        reason: "manual-input",
        sourceLang: detectedLang
      });
    });

    const copyFullBtn = document.getElementById("btn-copy-full-lecture");
    if (copyFullBtn) {
      copyFullBtn.addEventListener("click", () => this.copyFullLectureText());
    }

    document
      .getElementById("btn-filter-starred")
      .addEventListener("click", (e) => {
        this.filterStarredOnly = !this.filterStarredOnly;
        e.currentTarget.classList.toggle("active", this.filterStarredOnly);
        this.renderTranscriptList(false);
      });

    document
      .getElementById("btn-export-md")
      .addEventListener("click", () => this.exportMarkdownNotes());

    document
      .getElementById("btn-clear-notes")
      .addEventListener("click", () => this.clearAllNotes());

    document
      .getElementById("btn-clear-terms")
      .addEventListener("click", () => {
        this.extractedTerms = [];
        this.saveExtractedTerms();
        this.renderExtractedTerms();
      });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.isListening) {
        this.audioGuardian.acquireWakeLock();
      }
    });

    this.initPasscodeModal();
  }

  initPasscodeModal() {
    const modal = document.getElementById("passcode-modal");
    const openBtn = document.getElementById("btn-open-passcode");
    const closeBtn = document.getElementById("btn-close-passcode");
    const form = document.getElementById("passcode-form");
    const input = document.getElementById("input-access-passcode");
    const feedback = document.getElementById("passcode-feedback");

    if (!modal || !form || !input) return;

    if (openBtn) {
      openBtn.addEventListener("click", () => {
        this.openPasscodeModal();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
      });
    }

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      this.settings.passcode = input.value.trim();
      this.saveSettings();

      if (feedback) {
        feedback.textContent = "⏳ 正在验证访问密码...";
        feedback.className = "modal-feedback checking";
      }

      const res = await this.healthMonitor.probeHealth({
        passcode: this.settings.passcode
      });

      if (res.ok) {
        if (feedback) {
          feedback.textContent = "✅ 访问密码验证通过！";
          feedback.className = "modal-feedback success";
        }
        setTimeout(() => {
          modal.classList.add("hidden");
        }, 400);
        this.showBannerNotice("🔓 访问密码验证成功，同传服务已解锁", "success");
      } else {
        if (feedback) {
          feedback.textContent = `❌ ${res.error || "访问密码不正确，请重试"}`;
          feedback.className = "modal-feedback error";
        }
      }
    });
  }

  openPasscodeModal(message = "") {
    const modal = document.getElementById("passcode-modal");
    const input = document.getElementById("input-access-passcode");
    const feedback = document.getElementById("passcode-feedback");
    if (!modal) return;
    if (input) input.value = this.settings.passcode || "";
    if (feedback) {
      feedback.textContent = message;
      feedback.className = message ? "modal-feedback error" : "modal-feedback";
    }
    modal.classList.remove("hidden");
    setTimeout(() => input?.focus(), 60);
  }

  setSourceLanguage(langCode) {
    this.settings.sourceLang = langCode;
    this.selectSourceLang.value = langCode;
    this.saveSettings();
    this.asrEngine.setLanguage(langCode);
    this.syncLanguageUI();
    this.renderTranscriptList(false);
  }

  syncLanguageUI() {
    const meta = getLanguageMeta(this.settings.sourceLang);
    if (this.inputGlossary && !this.inputGlossary.value) {
      this.inputGlossary.placeholder = meta.placeholderHint;
    }

    document.querySelectorAll(".quick-lang-btn").forEach((btn) => {
      const btnLang = btn.getAttribute("data-lang");
      btn.classList.toggle("active", btnLang === this.settings.sourceLang);
    });
  }

  async runInitialHealthProbe(showToast = false) {
    const res = await this.healthMonitor.probeHealth({
      passcode: this.settings.passcode
    });
    if (res.requiresPasscode && !res.ok) {
      this.openPasscodeModal("🔒 当前站点已设置访问密码保护，请输入密码解锁");
      return;
    }
    if (showToast && res.ok) {
      this.showBannerNotice(
        `实时翻译通道连通正常：响应延迟 ${res.latencyMs}ms`,
        "success"
      );
    }
  }

  async toggleListening() {
    if (this.isListening) {
      this.isListening = false;
      this.asrEngine.stop();
      this.audioGuardian.stopMicrophoneMonitor();
      await this.audioGuardian.releaseWakeLock();
      this.updateStartButtonUI();
      this.renderTranscriptList(false);
      this.syncPiPWindow();
      return;
    }

    if (!this.asrEngine.isSupported) {
      this.showBannerNotice(
        "当前浏览器不支持内置 Web Speech API，请使用桌面或移动端 Chrome / Edge 浏览器打开。",
        "error"
      );
      return;
    }

    const micResult = await this.audioGuardian.startMicrophoneMonitor(
      this.settings.farFieldMic
    );
    if (!micResult.ok) {
      this.healthMonitor.updateAsr({
        status: "error",
        statusText: "麦克风受阻",
        errorMessage: micResult.error
      });
      this.showBannerNotice(
        `无法启动麦克风：${micResult.error}（请检查浏览器地址栏麦克风权限）`,
        "error"
      );
      return;
    }

    await this.audioGuardian.acquireWakeLock();

    this.asrEngine.lang = this.settings.sourceLang;
    this.asrEngine.start();
    this.isListening = true;
    this.updateStartButtonUI();
    this.renderTranscriptList(true);
    this.syncPiPWindow();
  }

  /**
   * 模拟教授连续讲课测试（连续追加进整堂课全文流）
   */
  async runClassroomSimulation() {
    if (this.demoTimer) {
      clearTimeout(this.demoTimer);
      this.demoTimer = null;
    }

    const langMeta = getLanguageMeta(this.settings.sourceLang);
    const pool =
      DEMO_LECTURE_BY_LANG[langMeta.short] || DEMO_LECTURE_BY_LANG.ru;
    const sample = pool[this.transcriptList.length % pool.length];
    const words = sample.split(" ");
    let idx = 0;

    this.btnDemoLecture.disabled = true;
    this.btnDemoLecture.textContent = `🎓 正在模拟${langMeta.flag}教授连续讲课...`;

    const stepInterim = () => {
      idx += 3;
      if (idx < words.length) {
        this.handleInterimSpeech(words.slice(0, idx).join(" "));
        this.demoTimer = setTimeout(stepInterim, 220);
      } else {
        this.btnDemoLecture.disabled = false;
        this.btnDemoLecture.textContent = "🎓 模拟教授讲课测试";
        this.handleFinalSpeechSegment(sample, {
          reason: "simulation",
          sourceLang: this.settings.sourceLang
        });
      }
    };

    stepInterim();
  }

  /**
   * 处理正在说的实时语音流：直接追加显示在整堂课全文末尾，并同步刷新中文译文
   */
  handleInterimSpeech(interimText) {
    this.liveInterimText = interimText;
    const badgeEl = document.getElementById("live-stream-badge");

    if (interimText) {
      if (badgeEl) {
        badgeEl.textContent = "🎙️ 正在实时听写与同传...";
        badgeEl.className = "stream-badge active";
      }

      // 确保统一全文输出框已挂载
      if (!document.getElementById("unified-lecture-flow")) {
        this.renderTranscriptList(true);
      } else {
        this.updateInlineLiveNodes();
      }

      clearTimeout(this.interimTransTimer);
      const currentSeq = ++this.interimRequestSeq;
      const transStatusEl = document.getElementById("live-trans-status");
      if (transStatusEl) {
        transStatusEl.textContent = "正在同步翻译...";
      }

      this.interimTransTimer = setTimeout(async () => {
        const res = await translateLiveInterimText({
          text: interimText,
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang,
          passcode: this.settings.passcode
        });
        if (currentSeq !== this.interimRequestSeq) return;
        if (res.ok && res.translation) {
          this.liveInterimTranslation = res.translation;
          this.updateInlineLiveNodes();
          const statusEl = document.getElementById("live-trans-status");
          if (statusEl) {
            statusEl.textContent = `实时同步 (${res.latencyMs}ms)`;
          }
          this.syncPiPWindow();
        }
      }, 360);
    } else {
      clearTimeout(this.interimTransTimer);
      this.interimRequestSeq++;
      this.liveInterimTranslation = "";
      if (badgeEl) {
        badgeEl.textContent = this.isListening ? "监听中" : "待机";
        badgeEl.className = "stream-badge";
      }
      this.updateInlineLiveNodes();
    }

    this.syncPiPWindow();
  }

  /**
   * 更新单一全文输出框末尾正在说话的实时双语对照段落节点
   */
  updateInlineLiveNodes() {
    const liveBlockEl = document.getElementById("live-inline-block");
    const liveSrcEl = document.getElementById("live-inline-source");
    const liveTgtEl = document.getElementById("live-inline-target");
    const unifiedFlow = document.getElementById("unified-lecture-flow");

    if (liveBlockEl) {
      if (this.liveInterimText) {
        liveBlockEl.classList.remove("hidden");
      } else {
        liveBlockEl.classList.add("hidden");
      }
    }

    if (liveSrcEl) {
      liveSrcEl.textContent = this.liveInterimText || "";
    }
    if (liveTgtEl) {
      liveTgtEl.textContent = this.liveInterimText
        ? this.liveInterimTranslation || "正在同步翻译..."
        : "";
    }
    if (this.liveInterimText && unifiedFlow) {
      unifiedFlow.scrollTop = unifiedFlow.scrollHeight;
    }
  }

  /**
   * 教授讲完一句后，无缝追加到整堂课连续全文流中
   */
  async handleFinalSpeechSegment(sourceText, meta = {}) {
    const cleanSource = String(sourceText || "").trim();
    if (!cleanSource) return;

    const usedSourceLang = meta.sourceLang || this.settings.sourceLang;
    const itemId = `seg_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const initialPreview = this.liveInterimTranslation || "";

    const newItem = {
      id: itemId,
      timestamp,
      sourceLang: usedSourceLang,
      source: cleanSource,
      correctedSource: "",
      translation: initialPreview,
      terms: [],
      status: "translating",
      latencyMs: null,
      starred: false
    };

    this.liveInterimText = "";
    this.liveInterimTranslation = "";
    this.transcriptList.push(newItem);
    this.saveTranscript();
    this.renderTranscriptList(true);
    this.syncPiPWindow();

    const result = await translateLectureSegment({
      text: cleanSource,
      courseSubject: this.settings.courseSubject,
      glossaryKeywords: this.settings.glossaryKeywords,
      sourceLang: usedSourceLang,
      targetLang: this.settings.targetLang,
      passcode: this.settings.passcode,
      healthMonitor: this.healthMonitor
    });

    const targetItem = this.transcriptList.find((i) => i.id === itemId);
    if (!targetItem) return;

    if (result.requiresPasscode) {
      this.openPasscodeModal(result.error);
    }

    if (result.ok) {
      targetItem.status = "done";
      targetItem.translation = result.translation;
      targetItem.correctedSource = result.correctedSource || "";
      targetItem.terms = result.terms || [];
      targetItem.latencyMs = result.latencyMs;

      if (Array.isArray(result.terms) && result.terms.length > 0) {
        this.mergeExtractedTerms(result.terms);
      }
    } else {
      targetItem.status = "error";
      targetItem.translation =
        targetItem.translation || `[翻译重试中: ${result.error}]`;
      targetItem.latencyMs = result.latencyMs;
    }

    this.saveTranscript();
    this.renderTranscriptList(true);
    this.syncPiPWindow();
  }

  mergeExtractedTerms(newTerms) {
    let added = false;
    for (const term of newTerms) {
      const origTerm = (term?.term || term?.en || "").trim();
      const zhTerm = (term?.zh || "").trim();
      if (!origTerm || !zhTerm) continue;

      const exists = this.extractedTerms.some(
        (t) => t.en.toLowerCase() === origTerm.toLowerCase()
      );
      if (!exists) {
        this.extractedTerms.unshift({
          en: origTerm,
          zh: zhTerm,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })
        });
        added = true;
      }
    }
    if (added) {
      this.saveExtractedTerms();
      this.renderExtractedTerms();
    }
  }

  renderHealthUI(state) {
    const asrDot = document.getElementById("health-asr-dot");
    const asrText = document.getElementById("health-asr-text");
    const asrDetail = document.getElementById("detail-asr-status");
    const asrReconnect = document.getElementById("detail-asr-reconnect");

    const asrStatusMap = {
      listening: "healthy",
      reconnecting: "warning",
      standby: "neutral",
      error: "error",
      unsupported: "error"
    };
    const asrClass = asrStatusMap[state.asr.status] || "neutral";
    if (asrDot) asrDot.className = `status-dot ${asrClass}`;
    if (asrText) asrText.textContent = `ASR: ${state.asr.statusText}`;
    if (asrDetail) asrDetail.textContent = state.asr.statusText;
    if (asrReconnect) {
      asrReconnect.textContent = `${state.asr.reconnectCount} 次静音自动续接`;
    }

    const llmDot = document.getElementById("health-llm-dot");
    const llmText = document.getElementById("health-llm-text");
    const llmStatusMap = {
      healthy: "healthy",
      degraded: "warning",
      checking: "checking",
      error: "error"
    };
    const llmClass = llmStatusMap[state.translation.status] || "healthy";
    if (llmDot) llmDot.className = `status-dot ${llmClass}`;
    if (llmText) {
      llmText.textContent = `实时同传翻译: ${state.translation.statusText}`;
    }

    const elLatency = document.getElementById("detail-llm-latency");
    const elAvgLatency = document.getElementById("detail-llm-avg-latency");
    const elSuccessRate = document.getElementById("detail-llm-success-rate");
    const elEdgeMode = document.getElementById("detail-edge-mode");
    const elLastError = document.getElementById("detail-last-error");

    if (elLatency) {
      elLatency.textContent =
        state.translation.lastLatencyMs !== null
          ? `${state.translation.lastLatencyMs} ms`
          : "-- ms";
    }
    if (elAvgLatency) {
      elAvgLatency.textContent =
        state.translation.avgLatencyMs !== null
          ? `平均 ${state.translation.avgLatencyMs} ms`
          : "平均 -- ms";
    }
    if (elSuccessRate) {
      const total = state.translation.totalRequests;
      const rate =
        total > 0
          ? Math.round((state.translation.successCount / total) * 100)
          : 100;
      elSuccessRate.textContent = `${state.translation.successCount}/${total} (${rate}%)`;
    }
    if (elEdgeMode) {
      elEdgeMode.textContent = state.edge.modeLabel;
    }
    if (elLastError) {
      if (state.translation.lastError) {
        elLastError.textContent = `提示: ${state.translation.lastError}`;
        elLastError.classList.remove("hidden");
      } else {
        elLastError.textContent = "";
        elLastError.classList.add("hidden");
      }
    }
  }

  updateMicVolumeUI(level) {
    const bar = document.getElementById("mic-volume-bar");
    const text = document.getElementById("mic-volume-text");
    if (bar) {
      bar.style.width = `${level}%`;
    }
    if (text) {
      text.textContent = this.isListening ? `${level}%` : "待机";
    }
  }

  updateWakeLockUI(wlState) {
    const el = document.getElementById("detail-wakelock-status");
    if (el) {
      el.textContent = wlState.message;
      el.className = `health-sub ${wlState.active ? "text-ok" : ""}`;
    }
  }

  updateStartButtonUI() {
    if (this.isListening) {
      this.btnStartStop.innerHTML = `<span class="rec-pulse"></span> 停止课堂同传 (正在拾音)`;
      this.btnStartStop.classList.add("recording");
    } else {
      this.btnStartStop.innerHTML = `🎙️ 开始课堂同传`;
      this.btnStartStop.classList.remove("recording");
    }
  }

  async togglePiPWindow() {
    try {
      if (this.pipController.isOpen) {
        this.pipController.close();
        this.updatePiPButtonUI();
      } else {
        await this.pipController.open({
          isListening: this.isListening,
          statusText: `${
            this.isListening ? "同传拾音中" : "已暂停"
          } · ${this.healthMonitor.state.translation.statusText}`,
          liveInterim: this.liveInterimText,
          liveInterimTranslation: this.liveInterimTranslation,
          recentItems: this.transcriptList
        });
        this.updatePiPButtonUI();
      }
    } catch (err) {
      this.showBannerNotice(err.message, "error");
    }
  }

  updatePiPButtonUI() {
    if (this.pipController.isOpen) {
      this.btnOpenPiP.textContent = "🪟 关闭悬浮字幕窗";
      this.btnOpenPiP.classList.add("active");
    } else {
      this.btnOpenPiP.textContent = "🪟 弹出置顶悬浮窗";
      this.btnOpenPiP.classList.remove("active");
    }
  }

  syncPiPWindow() {
    if (!this.pipController.isOpen) return;
    this.pipController.update({
      isListening: this.isListening,
      statusText: `${
        this.isListening ? "整堂课实时双语同传中" : "已暂停"
      } · ${this.healthMonitor.state.translation.statusText}`,
      liveInterim: this.liveInterimText,
      liveInterimTranslation: this.liveInterimTranslation,
      recentItems: this.transcriptList,
      hasError: this.healthMonitor.state.translation.status === "error"
    });
  }

  /**
   * 渲染整堂课单一输出框：每一段话显示双语对照（原文 + 中文译文），全文在同一个输出框内连续呈现
   */
  renderTranscriptList(scrollToBottom = false) {
    const container = document.getElementById("transcript-feed");
    const countBadge = document.getElementById("transcript-count-badge");

    const items = this.filterStarredOnly
      ? this.transcriptList.filter((i) => i.starred)
      : this.transcriptList;

    if (countBadge) {
      countBadge.textContent = `已累计 ${this.transcriptList.length} 段`;
    }

    if (items.length === 0 && !this.liveInterimText && !this.isListening) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎓</div>
          <h3>整堂课双语同传（每段话双语对照 · 全文集中在一个输出框内）</h3>
          <p>
            1. 在上方选择授课语言（支持 <strong>🇷🇺 俄语 Русский</strong>、<strong>🇺🇸 英语 English</strong> 等多语种一键切换）<br/>
            2. 点击 <strong>【🎙️ 开始课堂同传】</strong> 或 <strong>【🎓 模拟教授讲课测试】</strong>，整堂课全文将统一在<strong>同一个输出框内</strong>连续输出，<strong>每一段话自动显示原始语言与中文翻译对照</strong><br/>
            3. 点击输出框内任意一段话即可标记为 ⭐ 课堂重点，课后可一键复制或导出整堂课双语全文
          </p>
        </div>
      `;
      return;
    }

    const langMeta = getLanguageMeta(this.settings.sourceLang);
    const utteranceLayoutClass =
      this.settings.compareLayout === "side-by-side"
        ? "utterance-side-by-side"
        : "utterance-stacked";

    const paragraphsHtml = items
      .map((item) => {
        const displaySrc = item.correctedSource || item.source || "";
        const displayTrans =
          item.status === "translating" && !item.translation
            ? "正在同步翻译..."
            : `${item.translation || ""}`;

        return `
          <div class="bilingual-utterance ${
            item.starred ? "starred" : ""
          }" data-id="${item.id}" title="[${
            item.timestamp
          }] 点击可标记/取消⭐课堂重点">
            <div class="utterance-source">${this.escapeHtml(displaySrc)}</div>
            <div class="utterance-target ${
              item.status === "error" ? "seg-error" : ""
            }">${this.escapeHtml(displayTrans)}</div>
          </div>
        `;
      })
      .join("");

    container.innerHTML = `
      <div class="unified-lecture-box">
        <div class="unified-box-header">
          <div class="unified-header-left">
            <span class="pane-badge source">${langMeta.flag} ${langMeta.name}</span>
            <span class="bilingual-arrow">⇄</span>
            <span class="pane-badge target">🇨🇳 中文翻译 · 整堂课单框双语全文流</span>
          </div>
          <div class="col-header-actions">
            <span id="live-trans-status" class="live-meta-text">每段话双语对照 · 点击段落标⭐重点</span>
            <button type="button" id="btn-copy-source-only" class="card-action-btn">📋 仅复制原文</button>
            <button type="button" id="btn-copy-target-only" class="card-action-btn">📋 仅复制译文</button>
          </div>
        </div>

        <!-- 唯一全文输出框：所有段落的双语对照及实时正在讲的话全部在此同一个输出框内 -->
        <div id="unified-lecture-flow" class="unified-flow-body ${utteranceLayoutClass}">
          ${paragraphsHtml}
          <div id="live-inline-block" class="bilingual-utterance live-utterance ${
            this.liveInterimText ? "" : "hidden"
          }">
            <div id="live-inline-source" class="utterance-source live-speaking">${this.escapeHtml(
              this.liveInterimText || ""
            )}</div>
            <div id="live-inline-target" class="utterance-target live-speaking-trans">${this.escapeHtml(
              this.liveInterimText
                ? this.liveInterimTranslation || "正在同步翻译..."
                : ""
            )}</div>
          </div>
          ${
            items.length === 0 && !this.liveInterimText
              ? `<div class="listening-placeholder">🎙️ 正在监听课堂声音，老师开口讲课时，每一段话的「${langMeta.name}原文 + 中文翻译对照」将在此同一个输出框内连续生成...</div>`
              : ""
          }
        </div>
      </div>
    `;

    const unifiedFlowEl = document.getElementById("unified-lecture-flow");

    // 点击任意一段话可切换重点标记
    container.querySelectorAll(".bilingual-utterance[data-id]").forEach((el) => {
      const id = el.getAttribute("data-id");
      el.addEventListener("click", () => {
        const target = this.transcriptList.find((i) => i.id === id);
        if (target) {
          target.starred = !target.starred;
          this.saveTranscript();
          this.renderTranscriptList(false);
        }
      });
    });

    // 绑定仅复制原文 / 仅复制译文按钮
    const btnCopySrc = document.getElementById("btn-copy-source-only");
    if (btnCopySrc) {
      btnCopySrc.addEventListener("click", () => {
        const text = this.transcriptList
          .map((i) => i.correctedSource || i.source)
          .join("\n");
        if (text && navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => {
            this.showBannerNotice("已复制整堂课原始语言全文", "success");
          });
        }
      });
    }

    const btnCopyTgt = document.getElementById("btn-copy-target-only");
    if (btnCopyTgt) {
      btnCopyTgt.addEventListener("click", () => {
        const text = this.transcriptList.map((i) => i.translation).join("\n");
        if (text && navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => {
            this.showBannerNotice("已复制整堂课中文翻译全文", "success");
          });
        }
      });
    }

    if (scrollToBottom && unifiedFlowEl) {
      unifiedFlowEl.scrollTop = unifiedFlowEl.scrollHeight;
    }
  }

  copyFullLectureText() {
    if (this.transcriptList.length === 0) {
      this.showBannerNotice("当前还没有课堂同传内容可复制", "warn");
      return;
    }
    const bilingualParagraphs = this.transcriptList
      .map(
        (i) =>
          `${i.correctedSource || i.source}\n${i.translation || ""}`
      )
      .join("\n\n");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(bilingualParagraphs).then(() => {
        this.showBannerNotice("已复制整堂课逐段双语对照全文", "success");
      });
    }
  }

  renderExtractedTerms() {
    const listEl = document.getElementById("extracted-terms-list");
    const countEl = document.getElementById("terms-count-badge");
    if (countEl) {
      countEl.textContent = `${this.extractedTerms.length}`;
    }

    if (this.extractedTerms.length === 0) {
      listEl.innerHTML = `
        <div class="terms-empty">
          同传过程中，系统会自动提取教授提到的<strong>俄语 / 英语学术术语与中文释义对照</strong>并汇总于此，方便课后复习。
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.extractedTerms
      .map(
        (t) => `
        <div class="glossary-item">
          <div class="glossary-en">${this.escapeHtml(t.en)}</div>
          <div class="glossary-zh">${this.escapeHtml(t.zh)}</div>
        </div>
      `
      )
      .join("");
  }

  exportMarkdownNotes() {
    if (this.transcriptList.length === 0) {
      this.showBannerNotice("当前还没有课堂同传记录可供导出", "warn");
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const langMeta = getLanguageMeta(this.settings.sourceLang);
    const bilingualParagraphs = this.transcriptList
      .map(
        (i) =>
          `${i.correctedSource || i.source}\n**${i.translation || ""}**`
      )
      .join("\n\n");

    const lines = [
      `# 🎓 留学课堂整堂课双语对照全文笔记 (${dateStr})`,
      ``,
      `- **授课语言**：${langMeta.flag} ${langMeta.name}`,
      `- **课程专业领域**：${this.settings.courseSubject}`,
      `- **预设课件词汇**：${this.settings.glossaryKeywords || "无"}`,
      ``,
      `## 📝 整堂课逐段双语对照全文 (${langMeta.flag} 原文 ⇄ 🇨🇳 中文翻译)`,
      ``,
      bilingualParagraphs,
      ``
    ];

    const starredItems = this.transcriptList.filter((i) => i.starred);
    if (starredItems.length > 0) {
      lines.push(`## ⭐ 课堂重点与考点标记 (${starredItems.length} 处)`, ``);
      starredItems.forEach((item) => {
        lines.push(
          `- **[${item.timestamp}]**`,
          `  - **原文**: ${item.correctedSource || item.source}`,
          `  - **译文**: **${item.translation}**`
        );
      });
      lines.push(``);
    }

    if (this.extractedTerms.length > 0) {
      lines.push(`## 📘 本节课核心专业词汇表`, ``);
      lines.push(`| 原语专业术语 (Term) | 中文释义 (Translation) |`);
      lines.push(`| :--- | :--- |`);
      this.extractedTerms.forEach((t) => {
        lines.push(`| **${t.en}** | ${t.zh} |`);
      });
      lines.push(``);
    }

    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Lecture_Full_Notes_${dateStr}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  clearAllNotes() {
    if (this.transcriptList.length === 0) return;
    if (
      !confirm(
        "确定要清空当前整堂课的所有双语记录吗？（建议先导出 Markdown 备份）"
      )
    ) {
      return;
    }
    this.transcriptList = [];
    this.saveTranscript();
    this.renderTranscriptList();
  }

  showBannerNotice(message, type = "info") {
    const banner = document.getElementById("top-toast-banner");
    if (!banner) return;
    banner.textContent = message;
    banner.className = `toast-banner ${type}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      banner.className = "toast-banner hidden";
    }, 4000);
  }

  escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.lectureApp = new LectureTranslatorApp();
});
