/**
 * 多 API 引擎注册表与实时健康监控中心 (providers.js)
 * 当前主推方案一：Chrome Web Speech API + Gemini 2.5 Flash
 * 同时提供可扩展的多 ASR / 多翻译模型插件化架构与 RPM 免费额度监控
 */

export const ASR_PROVIDERS = {
  "web-speech": {
    id: "web-speech",
    name: "Chrome Web Speech API (内置免费)",
    badge: "方案一 · 零成本无限时长",
    status: "ready",
    requiresKey: false,
    description: "浏览器原生内置识别，无需注册账号与密钥，支持静音断连自动重连"
  },
  "deepgram-nova3": {
    id: "deepgram-nova3",
    name: "Deepgram Nova-3 (WebSocket)",
    badge: "后续扩展 · 送$200额度",
    status: "planned",
    requiresKey: true,
    description: "抗教室混响与教授口音极佳，超低延迟流式 WebSocket 接口（已预留扩展槽位）"
  },
  "azure-speech": {
    id: "azure-speech",
    name: "Microsoft Azure Speech (学生免费包)",
    badge: "后续扩展 · .edu送$100",
    status: "planned",
    requiresKey: true,
    description: "支持自定义课堂短语词库 Phrase List，每月 5 小时永久免费（已预留扩展槽位）"
  }
};

export const TRANSLATION_PROVIDERS = {
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    providerType: "gemini",
    model: "gemini-2.5-flash",
    name: "Google Gemini 2.5 Flash",
    badge: "方案一首选 · 免费层 15 RPM",
    rpmLimit: 15,
    keyPlaceholder: "AIzaSy... (Google AI Studio 免费申请)",
    keyHelpUrl: "https://aistudio.google.com/app/apikey",
    description: "速度极快，支持结合课程大纲自动纠正语音识别同音错词并提取学术词汇"
  },
  "gemini-2.5-flash-lite": {
    id: "gemini-2.5-flash-lite",
    providerType: "gemini",
    model: "gemini-2.5-flash-lite",
    name: "Google Gemini 2.5 Flash-Lite",
    badge: "方案一高频备选 · 极速轻量",
    rpmLimit: 15,
    keyPlaceholder: "AIzaSy... (与 Gemini 共用同一个 Key)",
    keyHelpUrl: "https://aistudio.google.com/app/apikey",
    description: "更低延迟的轻量版 Gemini 2.5，适合语速极快的教授课堂"
  },
  "glm-4-flash": {
    id: "glm-4-flash",
    providerType: "glm",
    model: "glm-4-flash",
    endpointUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    name: "智谱 GLM-4-Flash (完全免费API)",
    badge: "多API扩展 · 免Token费",
    rpmLimit: 30,
    keyPlaceholder: "填写智谱开放平台 API Key",
    keyHelpUrl: "https://open.bigmodel.cn/",
    description: "国内大厂免费开放模型，英译中表达自然，可作为 Gemini 限流时的备用通道"
  },
  "siliconflow-qwen": {
    id: "siliconflow-qwen",
    providerType: "siliconflow",
    model: "Qwen/Qwen2.5-7B-Instruct",
    endpointUrl: "https://api.siliconflow.cn/v1/chat/completions",
    name: "硅基流动 Qwen2.5-7B (免费API)",
    badge: "多API扩展 · 永久免费模型",
    rpmLimit: 20,
    keyPlaceholder: "sk-... (填写 SiliconFlow API Key)",
    keyHelpUrl: "https://cloud.siliconflow.cn/",
    description: "开源通义千问 7B 高速推理接口，响应速度极快"
  }
};

/**
 * API 健康状态与免费额度速率监控器
 */
export class APIHealthMonitor {
  constructor(onUpdate) {
    this.onUpdate = onUpdate || (() => {});
    this.requestTimestamps = []; // 用于计算滑动窗口 60 秒内的 RPM

    this.state = {
      edge: {
        checked: false,
        active: false, // 是否运行在 Cloudflare Pages Functions 环境
        colo: "未检测",
        hasServerGeminiKey: false,
        requiresPasscode: false,
        modeLabel: "检测中..."
      },
      asr: {
        provider: "web-speech",
        supported:
          "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
        status: "standby", // standby | listening | reconnecting | error | unsupported
        statusText: "待机中",
        reconnectCount: 0,
        lastSpeechAt: null,
        errorMessage: ""
      },
      translation: {
        providerId: "gemini-2.5-flash",
        status: "unconfigured", // healthy | degraded | ratelimited | unconfigured | error | checking
        statusText: "待检测",
        lastLatencyMs: null,
        avgLatencyMs: null,
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        currentRpm: 0,
        rpmLimit: 15,
        lastError: "",
        lastCheckedAt: null
      }
    };

    // 每 3 秒刷新一次滑动窗口 RPM
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

    if (latencyMs > 3800) {
      t.status = "degraded";
      t.statusText = `响应偏慢 (${latencyMs}ms)`;
    } else {
      t.status = "healthy";
      t.statusText = `健康 (${latencyMs}ms)`;
    }
    this.emit();
  }

  recordTranslationError(status, message) {
    const t = this.state.translation;
    t.totalRequests += 1;
    t.errorCount += 1;
    t.lastCheckedAt = new Date().toLocaleTimeString();
    t.lastError = message || `HTTP ${status}`;

    if (status === 429 || /quota|rate|429/i.test(message)) {
      t.status = "ratelimited";
      t.statusText = "触发免费限频 (429)";
    } else if (status === 400 || status === 401 || status === 403) {
      t.status = "error";
      t.statusText = "Key 无效或未授权";
    } else {
      t.status = "error";
      t.statusText = "连接异常";
    }
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
   * 探测 Cloudflare Pages Function 边缘节点与上游 API 健康状态
   */
  async probeHealth({ providerId, apiKey, passcode, routeMode }) {
    const provider =
      TRANSLATION_PROVIDERS[providerId] ||
      TRANSLATION_PROVIDERS["gemini-2.5-flash"];

    this.updateTranslation({
      providerId: provider.id,
      rpmLimit: provider.rpmLimit,
      status: "checking",
      statusText: "正在诊断连通性..."
    });

    // 1. 先探测 /api/health 看是否存在 Cloudflare Pages Function 环境
    let edgeActive = false;
    let hasServerKey = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(
        `/api/health?ping=0&model=${encodeURIComponent(provider.model)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data && data.edge?.active) {
          edgeActive = true;
          hasServerKey = Boolean(data.serverConfig?.hasGeminiKey);
          this.updateEdge({
            checked: true,
            active: true,
            colo: data.edge.colo || "CF-EDGE",
            hasServerGeminiKey: hasServerKey,
            requiresPasscode: Boolean(data.serverConfig?.requiresPasscode),
            modeLabel: hasServerKey
              ? `Cloudflare 边缘节点 (${data.edge.colo}) · 已预置云端 Key`
              : `Cloudflare 边缘节点 (${data.edge.colo})`
          });
        }
      }
    } catch (_) {
      // 纯静态托管或本地静态服务器模式
    }

    if (!edgeActive) {
      this.updateEdge({
        checked: true,
        active: false,
        colo: "STATIC",
        hasServerGeminiKey: false,
        requiresPasscode: false,
        modeLabel: "纯前端直连模式 (Static)"
      });
    }

    // 2. 判断是否有可用 Key
    const cleanKey = (apiKey || "").trim();
    if (!cleanKey && !(edgeActive && hasServerKey && provider.providerType === "gemini")) {
      this.updateTranslation({
        status: "unconfigured",
        statusText: "待填写 API Key",
        lastError: "尚未配置 API Key，请点击右上角【API 配置】填入免费密钥"
      });
      return { ok: false, reason: "missing_key" };
    }

    // 3. 发起真实轻量 Ping 检测模型可用性与延迟
    const startTime = Date.now();
    try {
      const useEdgeProxy =
        edgeActive &&
        (routeMode === "proxy" || (!cleanKey && hasServerKey));

      if (useEdgeProxy && provider.providerType === "gemini") {
        const res = await fetch(
          `/api/health?ping=1&model=${encodeURIComponent(provider.model)}`,
          {
            headers: {
              ...(cleanKey ? { "X-API-Key": cleanKey } : {}),
              ...(passcode ? { "X-Access-Passcode": passcode } : {})
            }
          }
        );
        const data = await res.json();
        if (res.ok && data.upstream?.ok) {
          const latency = data.upstream.latencyMs || Date.now() - startTime;
          this.updateTranslation({
            status: "healthy",
            statusText: `正常 (${latency}ms)`,
            lastLatencyMs: latency,
            lastCheckedAt: new Date().toLocaleTimeString(),
            lastError: ""
          });
          return { ok: true, latencyMs: latency, via: "cloudflare-edge" };
        } else {
          const errMsg =
            data.error || data.upstream?.message || `HTTP ${res.status}`;
          this.recordTranslationError(
            data.upstream?.status || res.status,
            errMsg
          );
          return { ok: false, error: errMsg };
        }
      }

      // 浏览器端直连检测
      if (provider.providerType === "gemini") {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          provider.model
        )}?key=${encodeURIComponent(cleanKey)}`;
        const res = await fetch(endpoint, { method: "GET" });
        const latency = Date.now() - startTime;
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          this.updateTranslation({
            status: "healthy",
            statusText: `直连正常 (${latency}ms)`,
            lastLatencyMs: latency,
            lastCheckedAt: new Date().toLocaleTimeString(),
            lastError: ""
          });
          return { ok: true, latencyMs: latency, via: "browser-direct" };
        } else {
          const errMsg = data?.error?.message || `HTTP ${res.status}`;
          this.recordTranslationError(res.status, errMsg);
          return { ok: false, error: errMsg };
        }
      } else {
        // OpenAI 兼容接口轻量探测
        const res = await fetch(provider.endpointUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cleanKey}`
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 2
          })
        });
        const latency = Date.now() - startTime;
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          this.updateTranslation({
            status: "healthy",
            statusText: `直连正常 (${latency}ms)`,
            lastLatencyMs: latency,
            lastCheckedAt: new Date().toLocaleTimeString(),
            lastError: ""
          });
          return { ok: true, latencyMs: latency, via: "browser-direct" };
        } else {
          const errMsg = data?.error?.message || `HTTP ${res.status}`;
          this.recordTranslationError(res.status, errMsg);
          return { ok: false, error: errMsg };
        }
      }
    } catch (err) {
      const msg = err.message || String(err);
      this.recordTranslationError(500, `网络请求失败: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}

/**
 * 方案一核心语音识别引擎：Chrome Web Speech API 课堂增强版
 * 解决原生 Web Speech API 的两大痛点：
 * 1. 老师写板书停顿 5~10 秒后浏览器自动断开 -> 毫秒级无缝自动重连
 * 2. 教授长篇大论不断句导致翻译滞后 -> 超过字数阈值自动在从句连接词处智能切分提交
 */
export class WebSpeechClassroomEngine {
  constructor({
    lang = "en-US",
    maxWordsPerSegment = 28,
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
    this.committedInterimOffset = 0; // 用于对超长未断句的 interim 流进行提前分段
    this.restartTimer = null;
  }

  get isSupported() {
    return (
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window
    );
  }

  setLanguage(lang) {
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
    this.committedInterimOffset = 0;
    this._initAndStartInstance();
    return true;
  }

  _initAndStartInstance() {
    if (!this.shouldKeepRunning) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.lang;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.onStateChange({
        status: "listening",
        statusText:
          this.reconnectCount > 0
            ? `持续拾音中 (已保活重连 ${this.reconnectCount} 次)`
            : "正在实时拾音 (Web Speech API)",
        reconnectCount: this.reconnectCount
      });
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          // 扣除之前已经因为超长而提前切片提交的部分
          const fullText = transcript.trim();
          const remaining = fullText
            .slice(this.committedInterimOffset)
            .trim();
          this.committedInterimOffset = 0;

          if (remaining.length > 1) {
            this.onFinalSegment(remaining, { reason: "vad-final" });
          }
          this.onInterim("");
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        const activeInterim = interimTranscript
          .slice(this.committedInterimOffset)
          .trim();

        // 教授长难句超过阈值时，寻找自然意群边界提前切片送去翻译，不等教授停顿
        const words = activeInterim.split(/\s+/).filter(Boolean);
        if (words.length >= this.maxWordsPerSegment) {
          const splitChunk = this._findSmartSplitIndex(activeInterim);
          if (splitChunk) {
            this.committedInterimOffset += splitChunk.consumedLength;
            this.onFinalSegment(splitChunk.chunkText, {
              reason: "long-clause-split"
            });
            const rest = interimTranscript
              .slice(this.committedInterimOffset)
              .trim();
            this.onInterim(rest);
            return;
          }
        }

        this.onInterim(activeInterim);
      }
    };

    this.recognition.onerror = (event) => {
      // 'no-speech' 是课堂上老师写板书/停顿最常见的事件，直接静默保活重连即可
      if (event.error === "no-speech") {
        return;
      }
      if (event.error === "aborted" && !this.shouldKeepRunning) {
        return;
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
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
      this.committedInterimOffset = 0;
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
        }, 160);
      } else {
        this.onStateChange({
          status: "standby",
          statusText: "已暂停拾音"
        });
      }
    };

    try {
      this.recognition.start();
    } catch (err) {
      // 防止重复调用 start 抛错
    }
  }

  /**
   * 在超长句子中寻找合适的连词/标点切分点
   */
  _findSmartSplitIndex(text) {
    // 尝试在后半段寻找从句引导词或标点
    const halfIdx = Math.floor(text.length * 0.55);
    const tail = text.slice(halfIdx);
    const clauseRegex =
      /([,.;?!]\s+|\s+(?:because|which|that|however|therefore|moreover|although|while|so that|and then|where)\s+)/i;
    const match = clauseRegex.exec(tail);

    if (match) {
      const cutPos = halfIdx + match.index + match[0].length;
      return {
        chunkText: text.slice(0, cutPos).trim(),
        consumedLength: cutPos
      };
    }

    // 若无连词，按前 22 个词切分
    const words = text.split(/\s+/);
    if (words.length >= 26) {
      const chunkWords = words.slice(0, 20).join(" ");
      return {
        chunkText: chunkWords,
        consumedLength: chunkWords.length
      };
    }
    return null;
  }

  stop(silent = false) {
    this.shouldKeepRunning = false;
    clearTimeout(this.restartTimer);
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
 * 留学课堂专业同传翻译调度器
 * 支持：
 * 1. 注入课程专业学科（如 CS / 金融 / 医学）与当堂 PPT 术语词表
 * 2. 携带前 2 句课堂上下文，消除代词指代不明与半句话断章取义
 * 3. 自动修正语音识别 (ASR) 的同音学术错词，并提取双语专业词汇卡片
 */
export async function translateLectureSegment({
  text,
  providerId = "gemini-2.5-flash",
  apiKey = "",
  passcode = "",
  routeMode = "auto",
  courseSubject = "通用大学学术课堂 (General University Lecture)",
  glossaryKeywords = "",
  recentContext = [],
  sourceLang = "en-US",
  targetLang = "简体中文",
  healthMonitor
}) {
  const provider =
    TRANSLATION_PROVIDERS[providerId] ||
    TRANSLATION_PROVIDERS["gemini-2.5-flash"];

  const contextLines = recentContext
    .slice(-2)
    .map((item, idx) => `[前文${idx + 1}] 原文: ${item.source} -> 译文: ${item.translation}`)
    .join("\n");

  const systemPrompt = `你是一位顶尖的海外名校课堂同声传译专家，正在为留学生实时翻译教授的讲课内容。
当前课程领域：【${courseSubject}】
${
  glossaryKeywords.trim()
    ? `本节课课件核心专业词汇/热词参考：【${glossaryKeywords.trim()}】`
    : ""
}

请严格遵守以下同传准则：
1. 【同音错词自动纠错】：前端语音识别（ASR）可能会把教授说的学术专有名词识别成日常同音词。请结合课程领域和上下文自动推断并按正确的专业术语翻译。
2. 【保留关键英文术语括号对照】：遇到核心专业概念或高频考点词时，在中文译文中首次出现处附上英文原词，格式如“梯度下降 (Gradient Descent)”，方便留学生对照英文 PPT 课件。
3. 【自然通顺的课堂口吻】：去除口语废话（如 you know, um, like, basically），将破碎的长难句重组为符合中文母语习惯、逻辑清晰的学术表达。
4. 【严格返回 JSON 格式】：不要输出任何 Markdown 代码块标记，仅输出一个合法 JSON 对象，结构如下：
{
  "translation": "通顺准确的中文同传译文",
  "correctedSource": "如果原句存在明显的语音识别专业词拼写错误，给出修正后的原句；若无错误则返回空字符串",
  "terms": [
    {"en": "英文专业术语", "zh": "对应中文释义"}
  ]
}`;

  const userPrompt = `${
    contextLines ? `课堂前文参考：\n${contextLines}\n\n` : ""
  }请实时同传以下教授刚讲完的句子（源语言 ${sourceLang} -> 目标语言 ${targetLang}）：
"${text}"`;

  if (healthMonitor) {
    healthMonitor.recordTranslationAttempt();
  }

  const startTime = Date.now();
  const cleanKey = (apiKey || "").trim();
  const edgeState = healthMonitor?.state?.edge || {};

  const useEdgeProxy =
    routeMode === "proxy" ||
    (routeMode === "auto" &&
      edgeState.active &&
      !cleanKey &&
      edgeState.hasServerGeminiKey);

  try {
    let rawOutput = "";
    let latencyMs = 0;

    if (useEdgeProxy) {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cleanKey ? { "X-API-Key": cleanKey } : {}),
          ...(passcode ? { "X-Access-Passcode": passcode } : {})
        },
        body: JSON.stringify({
          provider: provider.providerType,
          model: provider.model,
          endpointUrl: provider.endpointUrl || "",
          systemPrompt,
          userPrompt,
          temperature: 0.15
        })
      });

      const data = await res.json().catch(() => ({}));
      latencyMs = data.latencyMs || Date.now() - startTime;

      if (!res.ok || !data.ok) {
        const errMsg = data.error || `HTTP ${res.status}`;
        if (healthMonitor) {
          healthMonitor.recordTranslationError(res.status, errMsg);
        }
        throw new Error(errMsg);
      }

      rawOutput = data.text || "";
    } else if (provider.providerType === "gemini") {
      if (!cleanKey) {
        if (healthMonitor) {
          healthMonitor.recordTranslationError(
            400,
            "未填写 Gemini API Key"
          );
        }
        throw new Error("请先在右上角【API 配置】中填入免费的 Gemini API Key");
      }

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        provider.model
      )}:generateContent?key=${encodeURIComponent(cleanKey)}`;

      const res = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 800,
            responseMimeType: "application/json"
          }
        })
      });

      latencyMs = Date.now() - startTime;
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg =
          data?.error?.message || `Gemini API 错误 (HTTP ${res.status})`;
        if (healthMonitor) {
          healthMonitor.recordTranslationError(res.status, errMsg);
        }
        throw new Error(errMsg);
      }

      rawOutput =
        data?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || "")
          .join("") || "";
    } else {
      // OpenAI 兼容格式直连 (智谱 GLM-4-Flash / 硅基流动 Qwen2.5)
      if (!cleanKey) {
        if (healthMonitor) {
          healthMonitor.recordTranslationError(400, "未填写该模型的 API Key");
        }
        throw new Error(`请先配置 ${provider.name} 的 API Key`);
      }

      const res = await fetch(provider.endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanKey}`
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.15,
          max_tokens: 800
        })
      });

      latencyMs = Date.now() - startTime;
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg =
          data?.error?.message || `${provider.name} 错误 (HTTP ${res.status})`;
        if (healthMonitor) {
          healthMonitor.recordTranslationError(res.status, errMsg);
        }
        throw new Error(errMsg);
      }

      rawOutput = data?.choices?.[0]?.message?.content || "";
    }

    if (healthMonitor) {
      healthMonitor.recordTranslationSuccess(latencyMs);
    }

    const parsed = parseStructuredTranslation(rawOutput);
    return {
      ok: true,
      latencyMs,
      providerName: provider.name,
      translation: parsed.translation,
      correctedSource: parsed.correctedSource,
      terms: parsed.terms
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startTime,
      error: err.message || String(err)
    };
  }
}

/**
 * 解析模型返回的 JSON 或回退文本
 */
function parseStructuredTranslation(rawText) {
  const cleaned = String(rawText || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const obj = JSON.parse(cleaned);
    return {
      translation: obj.translation || cleaned,
      correctedSource: obj.correctedSource || "",
      terms: Array.isArray(obj.terms) ? obj.terms : []
    };
  } catch (_) {
    // 尝试提取花括号内的 JSON
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        return {
          translation: obj.translation || cleaned,
          correctedSource: obj.correctedSource || "",
          terms: Array.isArray(obj.terms) ? obj.terms : []
        };
      } catch (_) {}
    }
    return {
      translation: cleaned,
      correctedSource: "",
      terms: []
    };
  }
}

