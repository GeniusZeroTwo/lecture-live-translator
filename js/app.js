/**
 * 留学课堂实时同传助手主控制器 (app.js)
 * 特性：
 * 1. 全面支持俄语 (ru-RU)、英语 (en-US) 等多语种实时课堂语音识别与翻译
 * 2. 第一轨（边说边译实时双语流）+ 第二轨（整句原始语言 ⇄ 中文翻译并排/上下对照卡片）
 * 3. 免配置开箱即用：无任何前台 API 添加弹窗或密钥依赖
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
    this.lastCompletedPair = null;
    this.filterStarredOnly = false;
    this.demoTimer = null;
    this.interimTransTimer = null;
    this.interimRequestSeq = 0;

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

    // 4. 初始化 Web Speech 课堂识别引擎
    this.asrEngine = new WebSpeechClassroomEngine({
      lang: this.settings.sourceLang,
      maxWordsPerSegment: 26,
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
      compareLayout: "side-by-side", // side-by-side | stacked
      courseSubject: "计算机科学与人工智能 (Computer Science & AI)",
      glossaryKeywords: "",
      farFieldMic: true
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
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  }

  saveTranscript() {
    try {
      localStorage.setItem(
        STORAGE_KEY_TRANSCRIPT,
        JSON.stringify(this.transcriptList.slice(-300))
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
        JSON.stringify(this.extractedTerms.slice(-120))
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

    // 填充初始设置
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

    // 绑定顶部与主控栏事件
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

    // 授课语言切换
    this.selectSourceLang.addEventListener("change", (e) => {
      this.setSourceLanguage(e.target.value);
    });

    // 俄语 / 英语快捷切换按钮
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

    // 对照排版切换（左右并排 vs 上下双行）
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

    // 手动输入/粘贴俄语或英语课件句子快速对照翻译
    const manualForm = document.getElementById("manual-input-form");
    const manualInput = document.getElementById("manual-sentence-input");
    manualForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = manualInput.value.trim();
      if (!val) return;
      manualInput.value = "";

      // 自动检测是否包含俄语西里尔字母，智能匹配源语言标签
      const hasCyrillic = /[\u0400-\u04FF]/.test(val);
      const detectedLang = hasCyrillic ? "ru-RU" : this.settings.sourceLang;
      this.handleFinalSpeechSegment(val, {
        reason: "manual-input",
        sourceLang: detectedLang
      });
    });

    // 笔记操作栏
    document
      .getElementById("btn-filter-starred")
      .addEventListener("click", (e) => {
        this.filterStarredOnly = !this.filterStarredOnly;
        e.currentTarget.classList.toggle("active", this.filterStarredOnly);
        this.renderTranscriptList();
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
  }

  setSourceLanguage(langCode) {
    this.settings.sourceLang = langCode;
    this.selectSourceLang.value = langCode;
    this.saveSettings();
    this.asrEngine.setLanguage(langCode);
    this.syncLanguageUI();
  }

  syncLanguageUI() {
    const meta = getLanguageMeta(this.settings.sourceLang);
    const liveBadge = document.getElementById("live-source-lang-badge");
    if (liveBadge) {
      liveBadge.textContent = `${meta.flag} 原始语言实时识别 · ${meta.name}`;
    }
    if (this.inputGlossary && !this.inputGlossary.value) {
      this.inputGlossary.placeholder = meta.placeholderHint;
    }

    document.querySelectorAll(".quick-lang-btn").forEach((btn) => {
      const btnLang = btn.getAttribute("data-lang");
      btn.classList.toggle("active", btnLang === this.settings.sourceLang);
    });
  }

  async runInitialHealthProbe(showToast = false) {
    const res = await this.healthMonitor.probeHealth();
    if (showToast && res.ok) {
      this.showBannerNotice(
        `实时翻译通道连通正常：响应延迟 ${res.latencyMs}ms（免配置已就绪）`,
        "success"
      );
    }
  }

  /**
   * 启动 / 停止课堂实时拾音同传
   */
  async toggleListening() {
    if (this.isListening) {
      this.isListening = false;
      this.asrEngine.stop();
      this.audioGuardian.stopMicrophoneMonitor();
      await this.audioGuardian.releaseWakeLock();
      this.updateStartButtonUI();
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
    this.syncPiPWindow();
  }

  /**
   * 模拟教授讲课测试（根据当前选择的语言自动模拟俄语教授或英语教授讲课，测试实时双语对照）
   */
  async runClassroomSimulation() {
    if (this.demoTimer) {
      clearTimeout(this.demoTimer);
      this.demoTimer = null;
    }

    const langMeta = getLanguageMeta(this.settings.sourceLang);
    const pool =
      DEMO_LECTURE_BY_LANG[langMeta.short] || DEMO_LECTURE_BY_LANG.ru;
    const sample = pool[Math.floor(Math.random() * pool.length)];
    const words = sample.split(" ");
    let idx = 0;

    this.btnDemoLecture.disabled = true;
    this.btnDemoLecture.textContent = `🎓 正在模拟${langMeta.flag}教授讲课...`;

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
   * 处理第一轨实时流式语音：立即显示原始语言，并高频同步刷新中文翻译对照
   */
  handleInterimSpeech(interimText) {
    this.liveInterimText = interimText;
    const streamEl = document.getElementById("live-interim-stream");
    const transEl = document.getElementById("live-interim-translation");
    const badgeEl = document.getElementById("live-stream-badge");
    const wordCountEl = document.getElementById("live-word-count");
    const transStatusEl = document.getElementById("live-trans-status");

    if (interimText) {
      streamEl.textContent = interimText;
      streamEl.classList.add("active");
      const wordCount = interimText.split(/\s+/).filter(Boolean).length;
      badgeEl.textContent = "实时双语同传中";
      badgeEl.className = "stream-badge active";
      if (wordCountEl) {
        wordCountEl.textContent = `已识别 ${wordCount} 词`;
      }

      // 触发防抖实时流式翻译，让用户在教授说话过程中实时看到中文翻译对照
      clearTimeout(this.interimTransTimer);
      const currentSeq = ++this.interimRequestSeq;
      if (transStatusEl) {
        transStatusEl.textContent = "正在同步翻译...";
      }

      this.interimTransTimer = setTimeout(async () => {
        const res = await translateLiveInterimText({
          text: interimText,
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang
        });
        if (currentSeq !== this.interimRequestSeq) return;
        if (res.ok && res.translation) {
          this.liveInterimTranslation = res.translation;
          if (transEl) {
            transEl.textContent = res.translation;
            transEl.classList.add("active");
          }
          if (transStatusEl) {
            transStatusEl.textContent = `实时对照 (${res.latencyMs}ms)`;
          }
          this.syncPiPWindow();
        }
      }, 260);
    } else {
      clearTimeout(this.interimTransTimer);
      this.interimRequestSeq++;
      this.liveInterimTranslation = "";

      if (this.lastCompletedPair) {
        streamEl.textContent = this.lastCompletedPair.source;
        streamEl.classList.remove("active");
        if (transEl) {
          transEl.textContent = this.lastCompletedPair.translation;
          transEl.classList.remove("active");
        }
        if (wordCountEl) {
          wordCountEl.textContent = "上一句原文（等待新语音...）";
        }
        if (transStatusEl) {
          transStatusEl.textContent = "上一句译文对照";
        }
      } else {
        streamEl.textContent = this.isListening
          ? "正在监听课堂音频（老师说话时此处将 0.1 秒级实时跳出原始语言）..."
          : "点击上方【开始课堂同传】或【模拟教授讲课测试】开始实时识别...";
        streamEl.classList.remove("active");
        if (transEl) {
          transEl.textContent = "说话时此处将实时同步显示中文翻译对照...";
          transEl.classList.remove("active");
        }
        if (wordCountEl) {
          wordCountEl.textContent = this.isListening ? "监听中" : "等待语音输入";
        }
      }

      badgeEl.textContent = this.isListening ? "监听中" : "待机";
      badgeEl.className = "stream-badge";
    }

    this.syncPiPWindow();
  }

  /**
   * 处理完整句子或长难句切片：归档至下方双语对照列表并提取学术词汇
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

    // 如果刚才实时流已经翻译出了预览结果，先作为即时预览展示，实现 0 等待对照
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
      starred: false,
      splitReason: meta.reason || "vad-final"
    };

    this.lastCompletedPair = {
      source: cleanSource,
      translation: initialPreview || "正在生成中文翻译对照..."
    };
    this.handleInterimSpeech("");

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
      healthMonitor: this.healthMonitor
    });

    const targetItem = this.transcriptList.find((i) => i.id === itemId);
    if (!targetItem) return;

    if (result.ok) {
      targetItem.status = "done";
      targetItem.translation = result.translation;
      targetItem.correctedSource = result.correctedSource || "";
      targetItem.terms = result.terms || [];
      targetItem.latencyMs = result.latencyMs;

      this.lastCompletedPair = {
        source: cleanSource,
        translation: result.translation
      };
      if (!this.liveInterimText) {
        this.handleInterimSpeech("");
      }

      if (Array.isArray(result.terms) && result.terms.length > 0) {
        this.mergeExtractedTerms(result.terms);
      }
    } else {
      targetItem.status = "error";
      targetItem.translation =
        targetItem.translation || `⚠️ 翻译未完成: ${result.error}`;
      targetItem.latencyMs = result.latencyMs;
    }

    this.saveTranscript();
    this.renderTranscriptList(false);
    this.syncPiPWindow();
  }

  async retryTranslation(itemId) {
    const targetItem = this.transcriptList.find((i) => i.id === itemId);
    if (!targetItem) return;

    targetItem.status = "translating";
    targetItem.translation = "正在重新请求翻译...";
    this.renderTranscriptList(false);

    const result = await translateLectureSegment({
      text: targetItem.source,
      courseSubject: this.settings.courseSubject,
      glossaryKeywords: this.settings.glossaryKeywords,
      sourceLang: targetItem.sourceLang || this.settings.sourceLang,
      targetLang: this.settings.targetLang,
      healthMonitor: this.healthMonitor
    });

    if (result.ok) {
      targetItem.status = "done";
      targetItem.translation = result.translation;
      targetItem.correctedSource = result.correctedSource || "";
      targetItem.terms = result.terms || [];
      targetItem.latencyMs = result.latencyMs;
      if (result.terms?.length) {
        this.mergeExtractedTerms(result.terms);
      }
    } else {
      targetItem.status = "error";
      targetItem.translation = `⚠️ 重试失败: ${result.error}`;
    }

    this.saveTranscript();
    this.renderTranscriptList(false);
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

  /**
   * 渲染顶部健康状态栏
   */
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
        this.isListening ? "实时双语同传中" : "已暂停"
      } · ${this.healthMonitor.state.translation.statusText}`,
      liveInterim: this.liveInterimText,
      liveInterimTranslation: this.liveInterimTranslation,
      recentItems: this.transcriptList,
      hasError: this.healthMonitor.state.translation.status === "error"
    });
  }

  /**
   * 渲染「原始语言 ⇄ 中文翻译」实时双语对照卡片列表
   */
  renderTranscriptList(scrollToBottom = false) {
    const container = document.getElementById("transcript-feed");
    const countBadge = document.getElementById("transcript-count-badge");

    const items = this.filterStarredOnly
      ? this.transcriptList.filter((i) => i.starred)
      : this.transcriptList;

    if (countBadge) {
      countBadge.textContent = `已保存 ${this.transcriptList.length} 句`;
    }

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎓</div>
          <h3>免配置开箱即用 · 实时显示「原始语言 ⇄ 中文翻译」双语对照</h3>
          <p>
            1. 在上方选择授课语言（已支持 <strong>🇷🇺 俄语 Русский</strong>、<strong>🇺🇸 英语 English</strong>、日语、德语、法语等）<br/>
            2. 点击 <strong>【🎙️ 开始课堂同传】</strong> 即可边听课边实时查看<strong>原始语言与中文翻译对照</strong>（无需配置任何 API 密钥）<br/>
            3. 点击 <strong>【🎓 模拟教授讲课测试】</strong> 可立即体验俄语/英语课堂实时双语同传与专业词汇提取
          </p>
        </div>
      `;
      return;
    }

    const layoutClass =
      this.settings.compareLayout === "stacked"
        ? "compare-stacked"
        : "compare-side-by-side";

    container.innerHTML = items
      .map((item) => {
        const langMeta = getLanguageMeta(
          item.sourceLang || this.settings.sourceLang
        );
        const hasCorrection =
          item.correctedSource &&
          item.correctedSource.toLowerCase() !== item.source.toLowerCase();

        const termsHtml =
          Array.isArray(item.terms) && item.terms.length > 0
            ? `<div class="card-terms">
                ${item.terms
                  .map(
                    (t) =>
                      `<span class="term-chip">📘 ${this.escapeHtml(
                        t.en
                      )}: ${this.escapeHtml(t.zh)}</span>`
                  )
                  .join("")}
               </div>`
            : "";

        return `
          <article class="transcript-card ${
            item.starred ? "starred" : ""
          } status-${item.status}" data-id="${item.id}">
            <div class="card-meta">
              <div class="meta-left">
                <span class="time-tag">${item.timestamp}</span>
                <span class="lang-tag-mini">${langMeta.flag} ${langMeta.name} ⇄ 🇨🇳 中文</span>
                ${
                  item.splitReason === "long-clause-split"
                    ? `<span class="reason-tag" title="教授长句未停顿，已自动在从句边界抢先切分">⚡ 长句抢先分段</span>`
                    : ""
                }
                ${
                  item.latencyMs
                    ? `<span class="latency-tag">${item.latencyMs}ms</span>`
                    : ""
                }
              </div>
              <div class="meta-actions">
                <button class="card-action-btn btn-copy-pair" data-id="${item.id}" title="复制本句原文与译文对照">
                  📋 复制对照
                </button>
                ${
                  item.status === "error"
                    ? `<button class="card-action-btn btn-retry" data-id="${item.id}" title="重试翻译">🔄 重试</button>`
                    : ""
                }
                <button class="card-action-btn btn-star ${
                  item.starred ? "active" : ""
                }" data-id="${item.id}" title="标记为课堂重点/考点">
                  ${item.starred ? "⭐ 重点" : "☆ 标重点"}
                </button>
              </div>
            </div>

            <!-- 原始语言与中文翻译实时对照主视图 -->
            <div class="bilingual-compare-box ${layoutClass}">
              <div class="compare-pane source-pane">
                <div class="pane-header">
                  <span class="pane-badge source">${langMeta.sourceBadge}</span>
                </div>
                <div class="card-source">${this.escapeHtml(item.source)}</div>
                ${
                  hasCorrection
                    ? `<div class="card-correction">
                        ✨ 术语修正: <span>${this.escapeHtml(
                          item.correctedSource
                        )}</span>
                       </div>`
                    : ""
                }
              </div>

              <div class="compare-pane target-pane">
                <div class="pane-header">
                  <span class="pane-badge target">🇨🇳 中文翻译对照</span>
                </div>
                <div class="card-translation">
                  ${
                    item.status === "translating" && !item.translation
                      ? `<span class="loading-dots">正在生成实时双语对照翻译...</span>`
                      : this.escapeHtml(item.translation)
                  }
                </div>
              </div>
            </div>

            ${termsHtml}
          </article>
        `;
      })
      .join("");

    // 绑定复制双语对照、标重点与重试按钮
    container.querySelectorAll(".btn-copy-pair").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const target = this.transcriptList.find((i) => i.id === id);
        if (target && navigator.clipboard) {
          const textToCopy = `${target.source}\n${target.translation}`;
          navigator.clipboard.writeText(textToCopy).then(() => {
            this.showBannerNotice("已复制该句「原始语言 + 中文翻译」对照", "success");
          });
        }
      });
    });

    container.querySelectorAll(".btn-star").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const target = this.transcriptList.find((i) => i.id === id);
        if (target) {
          target.starred = !target.starred;
          this.saveTranscript();
          this.renderTranscriptList(false);
        }
      });
    });

    container.querySelectorAll(".btn-retry").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.retryTranslation(id);
      });
    });

    if (scrollToBottom) {
      container.scrollTop = container.scrollHeight;
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
    const lines = [
      `# 🎓 留学课堂实时双语同传对照笔记 (${dateStr})`,
      ``,
      `- **授课语言**：${langMeta.flag} ${langMeta.name}`,
      `- **课程专业领域**：${this.settings.courseSubject}`,
      `- **预设课件词汇**：${this.settings.glossaryKeywords || "无"}`,
      ``
    ];

    const starredItems = this.transcriptList.filter((i) => i.starred);
    if (starredItems.length > 0) {
      lines.push(`## ⭐ 课堂重点与考点双语汇总 (${starredItems.length} 处)`, ``);
      starredItems.forEach((item) => {
        lines.push(
          `- **[${item.timestamp}]**`,
          `  - **原始语言**: ${item.correctedSource || item.source}`,
          `  - **中文翻译**: **${item.translation}**`
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

    lines.push(
      `## 📝 完整课堂「原始语言 ⇄ 中文翻译」对照逐字稿 (${this.transcriptList.length} 句)`,
      ``
    );
    this.transcriptList.forEach((item) => {
      const starMark = item.starred ? " ⭐" : "";
      lines.push(
        `### [${item.timestamp}]${starMark}`,
        `- **原始语言**：${item.source}`,
        `- **中文翻译**：**${item.translation}**`,
        ``
      );
    });

    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Lecture_Bilingual_Notes_${dateStr}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  clearAllNotes() {
    if (this.transcriptList.length === 0) return;
    if (
      !confirm(
        "确定要清空当前保存的所有课堂双语对照记录吗？（建议先导出 Markdown 备份）"
      )
    ) {
      return;
    }
    this.transcriptList = [];
    this.lastCompletedPair = null;
    this.saveTranscript();
    this.renderTranscriptList();
    this.handleInterimSpeech("");
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
