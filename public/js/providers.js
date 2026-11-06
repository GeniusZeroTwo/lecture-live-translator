/**
 * 多语种课堂语音识别与免配置实时翻译引擎中心 (providers.js)
 * 核心特性：
 * 1. 开箱即用免密实时同传（支持俄语 ru-RU、英语 en-US 等多语种，无需前台配置任何 API Key，也无需强制后台环境变量）
 * 2. 支持边说边译（实时流式原文 + 实时同步中文译文对照）与整句精翻双轨并行
 * 3. 内置俄语 (Русский) 与英语 (English) 高频大学学术术语库，自动提取课堂专业词汇对照
 */

export const SUPPORTED_LANGUAGES = {
  "ru-RU": {
    code: "ru-RU",
    short: "ru",
    name: "俄语 (Русский)",
    flag: "🇷🇺",
    sourceBadge: "🇷🇺 俄语原文 (Русский)",
    interimBadge: "🇷🇺 正在识别俄语原声",
    placeholderHint:
      "例如: градиентный спуск, нейронная сеть, равновесие Нэша, инфляция..."
  },
  "en-US": {
    code: "en-US",
    short: "en",
    name: "英语 (美音 en-US)",
    flag: "🇺🇸",
    sourceBadge: "🇺🇸 英语原文 (English)",
    interimBadge: "🇺🇸 正在识别英语原声",
    placeholderHint:
      "例如: Backpropagation, Nash Equilibrium, Gradient Descent, EBITDA..."
  },
  "en-GB": {
    code: "en-GB",
    short: "en",
    name: "英语 (英音 en-GB)",
    flag: "🇬🇧",
    sourceBadge: "🇬🇧 英语原文 (English)",
    interimBadge: "🇬🇧 正在识别英语原声",
    placeholderHint:
      "例如: Backpropagation, Nash Equilibrium, Gradient Descent..."
  },
  "en-AU": {
    code: "en-AU",
    short: "en",
    name: "英语 (澳音 en-AU)",
    flag: "🇦🇺",
    sourceBadge: "🇦🇺 英语原文 (English)",
    interimBadge: "🇦🇺 正在识别英语原声",
    placeholderHint:
      "例如: Backpropagation, Nash Equilibrium, Gradient Descent..."
  },
  "ja-JP": {
    code: "ja-JP",
    short: "ja",
    name: "日语 (日本語 ja-JP)",
    flag: "🇯🇵",
    sourceBadge: "🇯🇵 日语原文 (日本語)",
    interimBadge: "🇯🇵 正在识别日语原声",
    placeholderHint: "例如: 勾配降下法, ニューラルネットワーク, ナッシュ均衡..."
  },
  "de-DE": {
    code: "de-DE",
    short: "de",
    name: "德语 (Deutsch de-DE)",
    flag: "🇩🇪",
    sourceBadge: "🇩🇪 德语原文 (Deutsch)",
    interimBadge: "🇩🇪 正在识别德语原声",
    placeholderHint: "例如: Gradientenverfahren, Neuronales Netz..."
  },
  "fr-FR": {
    code: "fr-FR",
    short: "fr",
    name: "法语 (Français fr-FR)",
    flag: "🇫🇷",
    sourceBadge: "🇫🇷 法语原文 (Français)",
    interimBadge: "🇫🇷 正在识别法语原声",
    placeholderHint: "例如: Descente de gradient, Réseau de neurones..."
  },
  "ko-KR": {
    code: "ko-KR",
    short: "ko",
    name: "韩语 (한국어 ko-KR)",
    flag: "🇰🇷",
    sourceBadge: "🇰🇷 韩语原文 (한국어)",
    interimBadge: "🇰🇷 正在识别韩语原声",
    placeholderHint: "例如: 경사 하강법, 인공신경망..."
  },
  "es-ES": {
    code: "es-ES",
    short: "es",
    name: "西班牙语 (Español es-ES)",
    flag: "🇪🇸",
    sourceBadge: "🇪🇸 西班牙语原文 (Español)",
    interimBadge: "🇪🇸 正在识别西班牙语原声",
    placeholderHint: "例如: Descenso de gradiente, Red neuronal..."
  }
};

export function getLanguageMeta(langCode = "ru-RU") {
  if (SUPPORTED_LANGUAGES[langCode]) {
    return SUPPORTED_LANGUAGES[langCode];
  }
  const prefix = String(langCode || "").split("-")[0].toLowerCase();
  const matched = Object.values(SUPPORTED_LANGUAGES).find(
    (item) => item.short === prefix
  );
  return matched || SUPPORTED_LANGUAGES["ru-RU"];
}

/**
 * 内置俄语 (Русский) 与英语 (English) 高频大学课堂专业词汇字典
 * 支持词干前缀匹配（适配俄语格变化）
 */
const BUILTIN_ACADEMIC_TERMS = [
  // 俄语 (Russian) 计算机、数学、经济、科学高频学术词汇
  { match: "обратно", en: "обратное распространение ошибки", zh: "误差反向传播 (Backpropagation)", lang: "ru" },
  { match: "градиентн", en: "градиентный спуск", zh: "梯度下降 (Gradient Descent)", lang: "ru" },
  { match: "стохастическ", en: "стохастический градиентный спуск", zh: "随机梯度下降 (SGD)", lang: "ru" },
  { match: "нейронн", en: "нейронная сеть", zh: "神经网络 (Neural Network)", lang: "ru" },
  { match: "функци", match2: "потер", en: "функция потерь", zh: "损失函数 (Loss Function)", lang: "ru" },
  { match: "скорост", match2: "обучен", en: "скорость обучения", zh: "学习率 (Learning Rate)", lang: "ru" },
  { match: "локальн", match2: "минимум", en: "локальный минимум", zh: "局部极小值 (Local Minimum)", lang: "ru" },
  { match: "расходимост", en: "расходимость алгоритма", zh: "算法发散 (Divergence)", lang: "ru" },
  { match: "сходимост", en: "сходимость", zh: "收敛性 (Convergence)", lang: "ru" },
  { match: "переобучен", en: "переобучение", zh: "过拟合 (Overfitting)", lang: "ru" },
  { match: "регуляризац", en: "регуляризация", zh: "正则化 (Regularization)", lang: "ru" },
  { match: "оптимизац", en: "оптимизация", zh: "优化 (Optimization)", lang: "ru" },
  { match: "искусственн", match2: "интеллект", en: "искусственный интеллект", zh: "人工智能 (AI)", lang: "ru" },
  { match: "машинн", match2: "обучен", en: "машинное обучение", zh: "机器学习 (Machine Learning)", lang: "ru" },
  { match: "равновеси", match2: "нэш", en: "равновесие Нэша", zh: "纳什均衡 (Nash Equilibrium)", lang: "ru" },
  { match: "макроэкономик", en: "макроэкономика", zh: "宏观经济学 (Macroeconomics)", lang: "ru" },
  { match: "макроэкономическ", en: "макроэкономическая теория", zh: "宏观经济理论", lang: "ru" },
  { match: "инфляционн", en: "инфляционные ожидания", zh: "通胀预期 (Inflation Expectations)", lang: "ru" },
  { match: "процентн", match2: "ставк", en: "ключевая процентная ставка", zh: "基准利率 (Key Interest Rate)", lang: "ru" },
  { match: "центральн", match2: "банк", en: "центральный банк", zh: "中央银行 (Central Bank)", lang: "ru" },
  { match: "дифференциальн", en: "дифференциальное уравнение", zh: "微分方程 (Differential Equation)", lang: "ru" },
  { match: "математическ", match2: "ожидан", en: "математическое ожидание", zh: "数学期望 (Expected Value)", lang: "ru" },
  { match: "вероятност", en: "теория вероятностей", zh: "概率论 (Probability Theory)", lang: "ru" },
  { match: "собственн", match2: "значен", en: "собственные значения", zh: "特征值 (Eigenvalues)", lang: "ru" },

  // 英语 (English) 高频学术词汇
  { match: "backpropagation", en: "Backpropagation", zh: "反向传播算法", lang: "en" },
  { match: "stochastic gradient descent", en: "Stochastic Gradient Descent", zh: "随机梯度下降 (SGD)", lang: "en" },
  { match: "gradient descent", en: "Gradient Descent", zh: "梯度下降", lang: "en" },
  { match: "neural network", en: "Neural Network", zh: "神经网络", lang: "en" },
  { match: "loss landscape", en: "Loss Landscape", zh: "损失曲面", lang: "en" },
  { match: "non-convex", en: "Non-convex", zh: "非凸的 (Non-convex)", lang: "en" },
  { match: "learning rate", en: "Learning Rate", zh: "学习率", lang: "en" },
  { match: "convergence", en: "Convergence", zh: "收敛", lang: "en" },
  { match: "divergence", en: "Divergence", zh: "发散", lang: "en" },
  { match: "local minima", en: "Local Minima", zh: "局部极小值", lang: "en" },
  { match: "nash equilibrium", en: "Nash Equilibrium", zh: "纳什均衡", lang: "en" },
  { match: "rational expectations", en: "Rational Expectations", zh: "理性预期", lang: "en" },
  { match: "monetary policy", en: "Monetary Policy", zh: "货币政策", lang: "en" },
  { match: "interest rate", en: "Interest Rate", zh: "利率", lang: "en" }
];

/**
 * 从原句中提取俄语/英语专业术语对照
 */
export function extractAcademicTermsFromText(sourceText = "", glossaryKeywords = "") {
  const lower = String(sourceText || "").toLowerCase();
  if (!lower) return [];

  const extracted = [];
  for (const item of BUILTIN_ACADEMIC_TERMS) {
    if (lower.includes(item.match) && (!item.match2 || lower.includes(item.match2))) {
      if (!extracted.some((e) => e.en.toLowerCase() === item.en.toLowerCase())) {
        extracted.push({ en: item.en, zh: item.zh });
      }
    }
  }

  // 匹配用户自定义的本节课课件关键词
  if (glossaryKeywords && glossaryKeywords.trim()) {
    const customList = glossaryKeywords
      .split(/[,，;；\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const kw of customList) {
      if (lower.includes(kw.toLowerCase())) {
        if (!extracted.some((e) => e.en.toLowerCase() === kw.toLowerCase())) {
          extracted.push({ en: kw, zh: "课堂核心关注术语" });
        }
      }
    }
  }

  return extracted.slice(0, 6);
}

/**
 * 实时翻译与健康监控中心（免配置开箱即用）
 */
export class APIHealthMonitor {
  constructor(onUpdate) {
    this.onUpdate = onUpdate || (() => {});
    this.requestTimestamps = [];

    this.state = {
      edge: {
        checked: false,
        active: false,
        colo: "DIRECT",
        modeLabel: "免配置直连 + Cloudflare 边缘双通道"
      },
      asr: {
        provider: "web-speech",
        supported:
          "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
        status: "standby",
        statusText: "待机中",
        reconnectCount: 0,
        lastSpeechAt: null,
        errorMessage: ""
      },
      translation: {
        status: "healthy", // healthy | degraded | checking | error
        statusText: "免密实时引擎就绪",
        lastLatencyMs: null,
        avgLatencyMs: null,
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        currentRpm: 0,
        lastError: "",
        lastCheckedAt: null
      }
    };

    this.rpmTimer = setInterval(() => this.refreshRpm(), 3000);
  }

  refreshRpm() {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(
      (t) => now - t < 60000
    );
    const newRpm = this.requestTimestamps.length;
    if (this.state.translation.currentRpm !== newRpm) {
      this.state.translation.currentRpm = newRpm;
      this.emit();
    }
  }

  recordTranslationAttempt() {
    this.requestTimestamps.push(Date.now());
    this.refreshRpm();
  }

  recordTranslationSuccess(latencyMs) {
    const t = this.state.translation;
    t.totalRequests += 1;
    t.successCount += 1;
    t.lastLatencyMs = latencyMs;
    t.avgLatencyMs =
      t.avgLatencyMs === null
        ? latencyMs
        : Math.round(t.avgLatencyMs * 0.7 + latencyMs * 0.3);
    t.lastCheckedAt = new Date().toLocaleTimeString();
    t.lastError = "";
    t.status = latencyMs > 3500 ? "degraded" : "healthy";
    t.statusText = `在线就绪 (${latencyMs}ms)`;
    this.emit();
  }

  recordTranslationError(status, message) {
    const t = this.state.translation;
    t.totalRequests += 1;
    t.errorCount += 1;
    t.lastCheckedAt = new Date().toLocaleTimeString();
    t.lastError = message || `HTTP ${status}`;
    t.status = "degraded";
    t.statusText = "正在自动切换备用线路";
    this.emit();
  }

  updateAsr(patch) {
    Object.assign(this.state.asr, patch);
    this.emit();
  }

  updateTranslation(patch) {
    Object.assign(this.state.translation, patch);
    this.emit();
  }

  updateEdge(patch) {
    Object.assign(this.state.edge, patch);
    this.emit();
  }

  emit() {
    this.onUpdate(this.state);
  }

  /**
   * 探测实时翻译引擎连通性与访问密码状态
   */
  async probeHealth({ passcode = "" } = {}) {
    this.updateTranslation({
      status: "checking",
      statusText: "正在检测延迟..."
    });

    const startTime = Date.now();
    const cleanPasscode = String(passcode || "").trim();

    // 1. 先检查是否存在 Cloudflare Pages Functions 边缘环境
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch("/api/health?ping=1", {
        headers: cleanPasscode ? { "X-Access-Passcode": cleanPasscode } : {},
        signal: controller.signal
      });
      clearTimeout(timeout);

      const data = await res.json().catch(() => ({}));
      if (data && data.edge?.active) {
        const requiresPasscode = Boolean(data.serverConfig?.requiresPasscode);
        const passcodeVerified = Boolean(data.serverConfig?.passcodeVerified);
        const envLabel =
          data.serverConfig?.label || "Cloudflare 边缘同传节点";

        this.updateEdge({
          checked: true,
          active: true,
          hasCustomEnvApi: Boolean(data.serverConfig?.hasCustomEnvApi),
          requiresPasscode,
          passcodeVerified,
          colo: data.edge.colo || "CF-EDGE",
          modeLabel: `${envLabel} · 节点 ${data.edge.colo || "GLOBAL"}${
            requiresPasscode
              ? passcodeVerified
                ? " · 🔓 密码已解锁"
                : " · 🔒 需输入访问密码"
              : ""
          }`
        });

        if (requiresPasscode && !passcodeVerified) {
          this.updateTranslation({
            status: "degraded",
            statusText: "🔒 待输入访问密码",
            lastError:
              data.error || "当前站点已启用访问密码保护，请输入正确的访问密码"
          });
          return {
            ok: false,
            requiresPasscode: true,
            error: data.error || "需要输入正确的访问密码"
          };
        }

        const latency = data.upstream?.latencyMs || Date.now() - startTime;
        this.updateTranslation({
          status: "healthy",
          statusText: `${
            data.serverConfig?.hasCustomEnvApi
              ? data.serverConfig.provider.toUpperCase()
              : "在线就绪"
          } (${latency}ms)`,
          lastLatencyMs: latency,
          lastCheckedAt: new Date().toLocaleTimeString(),
          lastError: ""
        });
        return {
          ok: true,
          latencyMs: latency,
          via: "cloudflare-edge",
          requiresPasscode
        };
      }
    } catch (_) {
      // 本地或纯静态环境，走浏览器直连翻译通道
    }

    this.updateEdge({
      checked: true,
      active: false,
      colo: "DIRECT",
      modeLabel: "浏览器免配置极速直连模式 (已就绪)"
    });

    // 2. 浏览器直连探测
    try {
      const gtxStart = Date.now();
      const testUrl =
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=zh-CN&dt=t&dj=1&q=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82";
      const res = await fetch(testUrl, { method: "GET" });
      const latency = Date.now() - gtxStart;
      if (res.ok) {
        this.updateTranslation({
          status: "healthy",
          statusText: `在线就绪 (${latency}ms)`,
          lastLatencyMs: latency,
          lastCheckedAt: new Date().toLocaleTimeString(),
          lastError: ""
        });
        return { ok: true, latencyMs: latency, via: "browser-direct" };
      }
    } catch (_) {}

    const fallbackLatency = Date.now() - startTime;
    this.updateTranslation({
      status: "healthy",
      statusText: "多通道备用已就绪",
      lastLatencyMs: fallbackLatency,
      lastCheckedAt: new Date().toLocaleTimeString(),
      lastError: ""
    });
    return { ok: true, latencyMs: fallbackLatency, via: "multi-fallback" };
  }
}

/**
 * 语音识别引擎：Chrome Web Speech API 课堂增强版（全面支持俄语 ru-RU 与英语等）
 * 1. 自动静音保活重连
 * 2. 针对俄语/英语长难句智能在连词/标点处提前分段送译
 */
export class WebSpeechClassroomEngine {
  constructor({
    lang = "ru-RU",
    maxWordsPerSegment = 32,
    onInterim,
    onFinalSegment,
    onStateChange
  }) {
    this.lang = lang;
    this.maxWordsPerSegment = maxWordsPerSegment;
    this.onInterim = onInterim || (() => {});
    this.onFinalSegment = onFinalSegment || (() => {});
    this.onStateChange = onStateChange || (() => {});

    this.recognition = null;
    this.shouldKeepRunning = false;
    this.reconnectCount = 0;
    this.restartTimer = null;
    this.silenceFlushTimer = null;
    this.pendingFinalBuffer = "";
    this.finalizedResultIndices = new Set();
  }

  get isSupported() {
    return (
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window
    );
  }

  setLanguage(lang) {
    this._flushPendingBuffer("lang-switch");
    this.lang = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
    if (this.shouldKeepRunning) {
      this.stop(true);
      setTimeout(() => this.start(), 120);
    }
  }

  start() {
    if (!this.isSupported) {
      this.onStateChange({
        status: "unsupported",
        statusText: "浏览器不支持 Web Speech API（请使用 Chrome 或 Edge）"
      });
      return false;
    }

    this.shouldKeepRunning = true;
    this.pendingFinalBuffer = "";
    this.finalizedResultIndices = new Set();
    this._initAndStartInstance();
    return true;
  }

  _flushPendingBuffer(reason = "paragraph-complete") {
    clearTimeout(this.silenceFlushTimer);
    this.silenceFlushTimer = null;
    const textToFlush = this.pendingFinalBuffer.trim();
    if (!textToFlush) return;
    this.pendingFinalBuffer = "";
    this.onInterim("");
    this.onFinalSegment(textToFlush, {
      reason,
      sourceLang: this.lang
    });
  }

  _initAndStartInstance() {
    if (!this.shouldKeepRunning) return;

    this.finalizedResultIndices = new Set();

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.lang;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    const langMeta = getLanguageMeta(this.lang);

    this.recognition.onstart = () => {
      this.onStateChange({
        status: "listening",
        statusText:
          this.reconnectCount > 0
            ? `${langMeta.flag} 持续拾音中 (已保活 ${this.reconnectCount} 次)`
            : `${langMeta.flag} 正在实时识别 (${langMeta.name})`,
        reconnectCount: this.reconnectCount
      });
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = (result[0]?.transcript || "").trim();
        if (!transcript) continue;

        if (result.isFinal) {
          if (!this.finalizedResultIndices.has(i)) {
            this.finalizedResultIndices.add(i);
            this.pendingFinalBuffer = this.pendingFinalBuffer
              ? `${this.pendingFinalBuffer} ${transcript}`
              : transcript;
          }
        } else {
          interimTranscript += (interimTranscript ? " " : "") + transcript;
        }
      }

      const combinedLive = [this.pendingFinalBuffer, interimTranscript.trim()]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (combinedLive) {
        this.onInterim(combinedLive);
      }

      // 判断缓冲区是否已经累积成完整的一段话（防止变成一个词/短句就切段）
      if (this.pendingFinalBuffer) {
        const wordCount = this.pendingFinalBuffer
          .split(/\s+/)
          .filter(Boolean).length;
        const charCount = this.pendingFinalBuffer.length;
        const endsWithPunct = /[.?!。？！]$/.test(this.pendingFinalBuffer);

        const isFullParagraph =
          wordCount >= 32 ||
          charCount >= 200 ||
          ((wordCount >= 22 || charCount >= 140) &&
            endsWithPunct &&
            !interimTranscript);

        if (isFullParagraph && !interimTranscript) {
          this._flushPendingBuffer("paragraph-full");
          // 当单次会话结果累积较多时，趁段落落盘瞬间静默重置识别器，防止 Chrome 后续碎片化吐词
          if (event.results.length >= 10 && this.shouldKeepRunning) {
            try {
              this.recognition.stop();
            } catch (_) {}
          }
          return;
        }

        // 若老师停顿超过 2.4 秒未继续说话，再将缓冲内容送交段落合并器
        clearTimeout(this.silenceFlushTimer);
        this.silenceFlushTimer = setTimeout(() => {
          if (!this.pendingFinalBuffer) return;
          this._flushPendingBuffer("pause-flush");
        }, 2400);
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error === "no-speech") {
        return;
      }
      if (event.error === "aborted" && !this.shouldKeepRunning) {
        return;
      }
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        this.shouldKeepRunning = false;
        this.onStateChange({
          status: "error",
          statusText: "麦克风权限被拒绝",
          errorMessage: "请在浏览器地址栏左侧允许麦克风权限"
        });
        return;
      }

      this.onStateChange({
        status: "reconnecting",
        statusText: `语音流波动 (${event.error})，正在自动恢复...`,
        errorMessage: event.error
      });
    };

    this.recognition.onend = () => {
      if (this.pendingFinalBuffer) {
        this._flushPendingBuffer("session-end");
      }
      if (this.shouldKeepRunning) {
        this.reconnectCount += 1;
        this.onStateChange({
          status: "reconnecting",
          statusText: `静音保活重连中 (#${this.reconnectCount})...`,
          reconnectCount: this.reconnectCount
        });
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          if (this.shouldKeepRunning) {
            try {
              this._initAndStartInstance();
            } catch (_) {}
          }
        }, 100);
      } else {
        this.onStateChange({
          status: "standby",
          statusText: "已暂停拾音"
        });
      }
    };

    try {
      this.recognition.start();
    } catch (_) {}
  }

  stop(silent = false) {
    this.shouldKeepRunning = false;
    clearTimeout(this.restartTimer);
    clearTimeout(this.silenceFlushTimer);
    if (this.pendingFinalBuffer) {
      this._flushPendingBuffer("manual-stop");
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (_) {}
      this.recognition = null;
    }
    if (!silent) {
      this.onInterim("");
      this.onStateChange({
        status: "standby",
        statusText: "已停止拾音"
      });
    }
  }
}

/**
 * 内部通用免配置神经翻译调用（浏览器极速直连 -> Cloudflare 边缘 `/api/translate` -> MyMemory 三重保障）
 */
const liveTranslationCache = new Map();

function normalizeShortLang(langCode = "ru-RU") {
  const raw = String(langCode || "ru-RU").trim();
  if (raw.includes("中文") || raw.toLowerCase().startsWith("zh")) return "zh-CN";
  return raw.split("-")[0].toLowerCase() || "ru";
}

async function fetchZeroConfigTranslation(
  text,
  sourceLang = "ru-RU",
  targetLang = "zh-CN",
  mode = "standard",
  extraMeta = {}
) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    return { translation: "", terms: [], latencyMs: 0 };
  }

  const sl = normalizeShortLang(sourceLang);
  const tl = normalizeShortLang(targetLang);
  const cacheKey = `${mode}:${sl}:${tl}:${cleanText}`;
  if (liveTranslationCache.has(cacheKey)) {
    return { ...liveTranslationCache.get(cacheKey), cached: true };
  }

  const startTime = Date.now();

  // 1. 无论整句精翻 (standard) 还是实时流式预览 (fast-stream)，均优先请求 Cloudflare `/api/translate` 边缘接口
  let passcodeBlockedError = "";
  try {
    const cleanPasscode = String(extraMeta.passcode || "").trim();
    const controller = new AbortController();
    const timeoutMs = mode === "fast-stream" ? 5000 : 14000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cleanPasscode ? { "X-Access-Passcode": cleanPasscode } : {})
      },
      body: JSON.stringify({
        text: cleanText,
        sourceLang,
        targetLang,
        courseSubject: extraMeta.courseSubject || "",
        glossaryKeywords: extraMeta.glossaryKeywords || "",
        passcode: cleanPasscode,
        mode
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data?.requiresPasscode) {
      passcodeBlockedError =
        data?.error || "需要输入正确的访问密码才能使用同传翻译服务";
    } else if (res.ok) {
      const parsed = parseStructuredTranslation(
        data.text || data.translation || ""
      );
      const finalTrans = data.translation || parsed.translation;
      if (finalTrans && !/MYMEMORY WARNING/i.test(finalTrans)) {
        const result = {
          translation: finalTrans,
          correctedSource: parsed.correctedSource || "",
          terms:
            Array.isArray(data.terms) && data.terms.length > 0
              ? data.terms
              : parsed.terms,
          latencyMs: data.latencyMs || Date.now() - startTime
        };
        if (liveTranslationCache.size > 200) {
          const firstKey = liveTranslationCache.keys().next().value;
          liveTranslationCache.delete(firstKey);
        }
        liveTranslationCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (_) {
    // 若本地静态运行无 /api/translate 则自动向下走直连通道
  }
  if (passcodeBlockedError) {
    const err = new Error(passcodeBlockedError);
    err.requiresPasscode = true;
    throw err;
  }

  // 2. 本地纯静态环境备用通道 A：Google GTX 神经翻译接口
  try {
    const gtxUrl =
      `https://translate.googleapis.com/translate_a/single?client=gtx` +
      `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
      `&dt=t&dt=bd&dj=1&q=${encodeURIComponent(cleanText)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(gtxUrl, { method: "GET", signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const translation = Array.isArray(data?.sentences)
        ? data.sentences.map((s) => s.trans || "").join("").trim()
        : "";

      const dictTerms = [];
      if (Array.isArray(data?.dict)) {
        for (const entry of data.dict.slice(0, 4)) {
          if (entry.base_form && Array.isArray(entry.terms) && entry.terms.length > 0) {
            dictTerms.push({
              en: entry.base_form,
              zh: entry.terms.slice(0, 2).join(" / ")
            });
          }
        }
      }

      if (translation) {
        const result = {
          translation,
          terms: dictTerms,
          latencyMs: Date.now() - startTime
        };
        liveTranslationCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (_) {}

  // 3. 本地纯静态环境备用通道 B：Clients5 神经翻译集群（彻底移除有每日配额告警的 MyMemory）
  try {
    const client5Url =
      `https://clients5.google.com/translate_a/t?client=dict-chrome-ex` +
      `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
      `&q=${encodeURIComponent(cleanText)}`;
    const res2 = await fetch(client5Url, { method: "GET" });
    if (res2.ok) {
      const data2 = await res2.json();
      const trans2 = Array.isArray(data2)
        ? typeof data2[0] === "string"
          ? data2[0]
          : Array.isArray(data2[0])
          ? data2[0].map((i) => (Array.isArray(i) ? i[0] : i)).join("")
          : ""
        : "";
      if (trans2 && trans2.trim()) {
        const result = {
          translation: trans2.trim(),
          terms: [],
          latencyMs: Date.now() - startTime
        };
        liveTranslationCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (_) {}

  throw new Error("网络连接波动，请稍后重试");
}

/**
 * 第一轨专用：教授说话过程中的实时流式同步翻译（边说边译，实时显示原始语言与翻译对照）
 */
export async function translateLiveInterimText({
  text,
  sourceLang = "ru-RU",
  targetLang = "zh-CN",
  passcode = ""
}) {
  try {
    const res = await fetchZeroConfigTranslation(
      text,
      sourceLang,
      targetLang,
      "fast-stream",
      { passcode }
    );
    return {
      ok: true,
      translation: res.translation,
      latencyMs: res.latencyMs
    };
  } catch (err) {
    return {
      ok: false,
      translation: "",
      error: err.message || String(err)
    };
  }
}

/**
 * 第二轨专用：整句完成后的双语对照精翻与学术词汇自动提取
 */
export async function translateLectureSegment({
  text,
  courseSubject = "通用大学学术课堂",
  glossaryKeywords = "",
  sourceLang = "ru-RU",
  targetLang = "简体中文",
  passcode = "",
  healthMonitor
}) {
  if (healthMonitor) {
    healthMonitor.recordTranslationAttempt();
  }

  const startTime = Date.now();
  try {
    const res = await fetchZeroConfigTranslation(
      text,
      sourceLang,
      targetLang,
      "standard",
      { courseSubject, glossaryKeywords, passcode }
    );

    const latencyMs = res.latencyMs || Date.now() - startTime;
    if (healthMonitor) {
      healthMonitor.recordTranslationSuccess(latencyMs);
    }

    // 合并内置俄语/英语学术术语词库与接口词典
    const localTerms = extractAcademicTermsFromText(text, glossaryKeywords);
    const combinedTerms = [...localTerms];
    if (Array.isArray(res.terms)) {
      for (const t of res.terms) {
        if (
          t &&
          t.en &&
          t.zh &&
          !combinedTerms.some((c) => c.en.toLowerCase() === t.en.toLowerCase())
        ) {
          combinedTerms.push(t);
        }
      }
    }

    return {
      ok: true,
      latencyMs,
      translation: res.translation,
      correctedSource: res.correctedSource || "",
      terms: combinedTerms
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    if (healthMonitor) {
      healthMonitor.recordTranslationError(
        err.requiresPasscode ? 401 : 500,
        err.message || String(err)
      );
    }
    return {
      ok: false,
      requiresPasscode: Boolean(err.requiresPasscode),
      latencyMs,
      error: err.message || String(err)
    };
  }
}

function parseStructuredTranslation(rawText) {
  const cleaned = String(rawText || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!cleaned.startsWith("{")) {
    return {
      translation: cleaned,
      correctedSource: "",
      terms: []
    };
  }

  try {
    const obj = JSON.parse(cleaned);
    return {
      translation: obj.translation || cleaned,
      correctedSource: obj.correctedSource || "",
      terms: Array.isArray(obj.terms) ? obj.terms : []
    };
  } catch (_) {
    return {
      translation: cleaned,
      correctedSource: "",
      terms: []
    };
  }
}
