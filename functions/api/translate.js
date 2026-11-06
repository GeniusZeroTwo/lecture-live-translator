/**
 * Cloudflare Pages / Workers Function: /api/translate
 * 支持通过 Cloudflare 后台「变量和密钥 (Variables and Secrets)」环境变量配置多种大模型 API 选项：
 *
 * 支持的环境变量选项（均在 Cloudflare 后台 -> 设置 -> 变量和密钥 中添加，前台不暴露任何密钥输入界面）：
 * - API_PROVIDER : 可选值 gemini | glm | siliconflow | deepseek | openai | custom | free（不填则根据密钥自动识别）
 * - API_KEY      : 通用 API 密钥变量（自动识别 AIza... 为 Gemini，id.secret 为智谱 GLM，sk-... 为 SiliconFlow/DeepSeek/OpenAI）
 * - API_MODEL    : 可选，自定义模型名（如 gemini-2.5-flash, glm-4-flash, Qwen/Qwen2.5-7B-Instruct, deepseek-chat, gpt-4o-mini）
 * - API_BASE_URL : 可选，自定义 API 接口地址或中转地址（自动补全 /v1/chat/completions）
 *
 * 同时兼容专属环境变量名：
 * - GEMINI_API_KEY / GOOGLE_API_KEY
 * - GLM_API_KEY / ZHIPU_API_KEY
 * - SILICONFLOW_API_KEY
 * - DEEPSEEK_API_KEY
 * - OPENAI_API_KEY
 *
 * 容错与兜底机制：
 * - 自动清洗环境变量值中误带的 KEY= 前缀、Bearer 前缀、引号或空格。
 * - 若未配置环境变量或配置的 API 临时限流/报错，自动无感降级至内置免密实时神经翻译引擎，确保俄语/英语课堂同传永不中断。
 */

function normalizeLangCode(lang = "ru-RU", isTarget = false) {
  const raw = String(lang || "").trim();
  if (!raw) return isTarget ? "zh-CN" : "auto";
  if (raw.includes("中文") || raw.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }
  const short = raw.split("-")[0].toLowerCase();
  const validShorts = ["ru", "en", "ja", "de", "fr", "ko", "es", "it", "pt", "ar", "auto"];
  return validShorts.includes(short) ? short : "auto";
}

function cleanEnvValue(val) {
  if (typeof val !== "string") return "";
  return val
    .trim()
    .replace(/^[A-Za-z0-9_]+\s*=\s*/, "") // 容错：用户把 GEMINI_API_KEY=xxx 粘贴到了值里
    .replace(/^Bearer\s+/i, "")           // 容错：用户把 Bearer sk-xxx 粘贴到了值里
    .replace(/^["'`]+|["'`]+$/g, "")      // 容错：首尾多余引号
    .trim();
}

function getEnvCaseInsensitive(env, keys) {
  if (!env || typeof env !== "object") return "";
  for (const k of keys) {
    if (env[k] !== undefined && env[k] !== null && String(env[k]).trim() !== "") {
      return cleanEnvValue(String(env[k]));
    }
  }
  const lowerMap = {};
  for (const [k, v] of Object.entries(env)) {
    lowerMap[k.toLowerCase().trim()] = v;
  }
  for (const k of keys) {
    const found = lowerMap[k.toLowerCase()];
    if (found !== undefined && found !== null && String(found).trim() !== "") {
      return cleanEnvValue(String(found));
    }
  }
  return "";
}

function normalizeOpenAIEndpoint(rawUrl, fallbackUrl) {
  const u = cleanEnvValue(rawUrl);
  if (!u) return fallbackUrl;
  if (u.endsWith("/chat/completions")) return u;
  if (u.endsWith("/v1") || u.endsWith("/v1/")) {
    return `${u.replace(/\/+$/, "")}/chat/completions`;
  }
  if (u.endsWith("/v4") || u.endsWith("/v4/")) {
    return `${u.replace(/\/+$/, "")}/chat/completions`;
  }
  if (!/^https?:\/\//i.test(u)) {
    return `https://${u.replace(/\/+$/, "")}/v1/chat/completions`;
  }
  try {
    const parsed = new URL(u);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      return `${u.replace(/\/+$/, "")}/v1/chat/completions`;
    }
  } catch (_) {}
  return u;
}

/**
 * 解析 Cloudflare「变量和密钥」中的 API 配置选项
 */
export function resolveEnvApiConfig(env) {
  if (!env || typeof env !== "object") {
    return { provider: "free", model: "neural-realtime-mt", key: "", label: "内置免密神经翻译" };
  }

  const explicitProvider = getEnvCaseInsensitive(env, [
    "API_PROVIDER",
    "TRANSLATION_PROVIDER",
    "PROVIDER",
    "LLM_PROVIDER"
  ]).toLowerCase();

  const customModel = getEnvCaseInsensitive(env, [
    "API_MODEL",
    "MODEL",
    "LLM_MODEL",
    "TRANSLATION_MODEL"
  ]);

  const customBaseUrl = getEnvCaseInsensitive(env, [
    "API_BASE_URL",
    "API_URL",
    "BASE_URL",
    "OPENAI_BASE_URL"
  ]);

  const geminiKey = getEnvCaseInsensitive(env, ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_KEY"]);
  const glmKey = getEnvCaseInsensitive(env, ["GLM_API_KEY", "ZHIPU_API_KEY", "BIGMODEL_API_KEY"]);
  const sfKey = getEnvCaseInsensitive(env, ["SILICONFLOW_API_KEY", "SF_API_KEY"]);
  const dsKey = getEnvCaseInsensitive(env, ["DEEPSEEK_API_KEY", "DS_API_KEY"]);
  const oaKey = getEnvCaseInsensitive(env, ["OPENAI_API_KEY"]);
  const genericKey = getEnvCaseInsensitive(env, ["API_KEY", "KEY", "SECRET", "TOKEN", "TRANSLATE_API_KEY"]);

  // 如果用户没有使用标准变量名，自动扫描 env 中任何像 API Key 的值
  let scannedKey = "";
  for (const [k, v] of Object.entries(env)) {
    if (/^(CF_|NODE_|PATH|HOME|PWD| WRANGLER)/i.test(k)) continue;
    const cleaned = cleanEnvValue(String(v || ""));
    if (
      cleaned.startsWith("AIza") ||
      cleaned.startsWith("sk-") ||
      /^[a-zA-Z0-9]{20,}\.[a-zA-Z0-9]{10,}$/.test(cleaned)
    ) {
      scannedKey = cleaned;
      break;
    }
  }

  const candidateKey =
    geminiKey || glmKey || sfKey || dsKey || oaKey || genericKey || scannedKey;

  if (explicitProvider === "free" || !candidateKey) {
    return {
      provider: "free",
      model: "neural-realtime-mt",
      key: "",
      endpointUrl: "",
      label: "内置免密实时神经翻译引擎"
    };
  }

  // 1. 判断是否为 Google Gemini
  if (
    explicitProvider === "gemini" ||
    explicitProvider === "google" ||
    geminiKey ||
    candidateKey.startsWith("AIza")
  ) {
    const key = geminiKey || candidateKey;
    const model = customModel || "gemini-2.5-flash";
    const baseHost = customBaseUrl
      ? customBaseUrl.replace(/\/+$/, "")
      : "https://generativelanguage.googleapis.com";
    return {
      provider: "gemini",
      model,
      key,
      endpointUrl: baseHost,
      label: `云端环境变量 API: Google Gemini (${model})`
    };
  }

  // 2. 判断是否为智谱 GLM
  const isGlmFormat = /^[a-zA-Z0-9]{16,}\.[a-zA-Z0-9]{8,}$/.test(candidateKey);
  if (
    explicitProvider === "glm" ||
    explicitProvider === "zhipu" ||
    glmKey ||
    (isGlmFormat && !customBaseUrl)
  ) {
    const key = glmKey || candidateKey;
    const model = customModel || "glm-4-flash";
    return {
      provider: "glm",
      model,
      key,
      endpointUrl: normalizeOpenAIEndpoint(
        customBaseUrl,
        "https://open.bigmodel.cn/api/paas/v4/chat/completions"
      ),
      label: `云端环境变量 API: 智谱 GLM (${model})`
    };
  }

  // 3. 判断是否为 DeepSeek
  if (
    explicitProvider === "deepseek" ||
    dsKey ||
    /deepseek/i.test(customBaseUrl) ||
    /deepseek/i.test(customModel)
  ) {
    const key = dsKey || candidateKey;
    const model = customModel || "deepseek-chat";
    return {
      provider: "deepseek",
      model,
      key,
      endpointUrl: normalizeOpenAIEndpoint(
        customBaseUrl,
        "https://api.deepseek.com/v1/chat/completions"
      ),
      label: `云端环境变量 API: DeepSeek (${model})`
    };
  }

  // 4. 判断是否为硅基流动 SiliconFlow
  if (
    explicitProvider === "siliconflow" ||
    explicitProvider === "qwen" ||
    sfKey ||
    /siliconflow/i.test(customBaseUrl)
  ) {
    const key = sfKey || candidateKey;
    const model = customModel || "Qwen/Qwen2.5-7B-Instruct";
    return {
      provider: "siliconflow",
      model,
      key,
      endpointUrl: normalizeOpenAIEndpoint(
        customBaseUrl,
        "https://api.siliconflow.cn/v1/chat/completions"
      ),
      label: `云端环境变量 API: 硅基流动 (${model})`
    };
  }

  // 5. OpenAI 或通用兼容接口（若用户只填了 sk-... 且未指定 URL，默认优先尝试硅基流动/OpenAI）
  const defaultUrl = customBaseUrl
    ? normalizeOpenAIEndpoint(customBaseUrl, "https://api.openai.com/v1/chat/completions")
    : oaKey
    ? "https://api.openai.com/v1/chat/completions"
    : "https://api.siliconflow.cn/v1/chat/completions";

  const defaultModel =
    customModel ||
    (defaultUrl.includes("siliconflow") ? "Qwen/Qwen2.5-7B-Instruct" : "gpt-4o-mini");

  return {
    provider: "openai-compatible",
    model: defaultModel,
    key: candidateKey,
    endpointUrl: defaultUrl,
    label: `云端环境变量 API (${defaultModel})`
  };
}

/**
 * 调用环境变量中配置的大模型进行课堂学术同传与术语提取
 */
async function translateViaConfiguredLLM(config, {
  text,
  sourceLang = "ru-RU",
  targetLang = "简体中文",
  courseSubject = "通用大学学术课堂",
  glossaryKeywords = "",
  systemPrompt = "",
  userPrompt = "",
  temperature = 0.15
}) {
  const startTime = Date.now();

  const finalSystemPrompt =
    systemPrompt ||
    `你是一位顶尖的海外名校课堂同声传译专家，正在为留学生实时将教授讲课内容（源语言：${sourceLang}）翻译为${targetLang}。
当前课程领域：【${courseSubject}】
${glossaryKeywords ? `本节课课件重点专业词汇参考：【${glossaryKeywords}】` : ""}
请严格遵守以下准则：
1. 结合课程学术背景自动修正语音识别(ASR)可能产生的同音词错误。
2. 译文自然通顺、逻辑清晰，适合课堂同传阅读。
3. 仅返回一个合法 JSON 对象（不要输出任何 Markdown 代码块标记），结构如下：
{
  "translation": "准确的中文同传译文",
  "correctedSource": "若原句存在明显语音识别拼写错误则给出修正后的原句，否则返回空字符串",
  "terms": [
    {"en": "原语言专业术语（如俄语或英语原词）", "zh": "对应中文释义"}
  ]
}`;

  const finalUserPrompt =
    userPrompt ||
    `请将以下教授刚讲完的句子从 ${sourceLang} 实时翻译为 ${targetLang}：\n"${text}"`;

  if (config.provider === "gemini") {
    const geminiUrl = `${config.endpointUrl}/v1beta/models/${encodeURIComponent(
      config.model
    )}:generateContent?key=${encodeURIComponent(config.key)}`;

    const res = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: finalSystemPrompt }] },
        contents: [{ role: "user", parts: [{ text: finalUserPrompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: 800,
          responseMimeType: "application/json"
        }
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
    }

    const llmText =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("")
        .trim() || "";

    if (!llmText) {
      throw new Error("Gemini 返回内容为空");
    }

    return {
      ok: true,
      provider: config.provider,
      model: config.model,
      providerLabel: config.label,
      latencyMs: Date.now() - startTime,
      text: llmText
    };
  }

  // OpenAI 兼容格式 (智谱 GLM / 硅基流动 SiliconFlow / DeepSeek / OpenAI / 自定义中转)
  const res = await fetch(config.endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.key}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: finalSystemPrompt },
        { role: "user", content: finalUserPrompt }
      ],
      temperature,
      max_tokens: 800
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `API HTTP ${res.status}`);
  }

  const llmText = (data?.choices?.[0]?.message?.content || "").trim();
  if (!llmText) {
    throw new Error("API 返回内容为空");
  }

  return {
    ok: true,
    provider: config.provider,
    model: config.model,
    providerLabel: config.label,
    latencyMs: Date.now() - startTime,
    text: llmText
  };
}

/**
 * 内置零密钥极速神经翻译通道 (Google GTX + MyMemory 双重保障)
 */
async function translateViaBuiltinFreeEngine(text, sourceLang = "auto", targetLang = "zh-CN") {
  const sl = normalizeLangCode(sourceLang, false);
  const tl = normalizeLangCode(targetLang, true);
  const startTime = Date.now();

  try {
    const gtxUrl =
      `https://translate.googleapis.com/translate_a/single?client=gtx` +
      `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
      `&dt=t&dt=bd&dj=1&q=${encodeURIComponent(text)}`;

    const res = await fetch(gtxUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      }
    });

    if (res.ok) {
      const data = await res.json();
      const translation = Array.isArray(data?.sentences)
        ? data.sentences.map((s) => s.trans || "").join("").trim()
        : "";

      const terms = [];
      if (Array.isArray(data?.dict)) {
        for (const entry of data.dict.slice(0, 4)) {
          if (entry.base_form && Array.isArray(entry.terms) && entry.terms.length > 0) {
            terms.push({
              en: entry.base_form,
              zh: entry.terms.slice(0, 2).join(" / ")
            });
          }
        }
      }

      if (translation) {
        return {
          ok: true,
          provider: "builtin-neural",
          model: "neural-realtime-mt",
          providerLabel: "内置免密实时神经翻译引擎",
          latencyMs: Date.now() - startTime,
          translation,
          terms,
          text: JSON.stringify({
            translation,
            correctedSource: "",
            terms
          })
        };
      }
    }
  } catch (_) {}

  const pairSl = sl === "auto" ? "ru" : sl;
  const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    text
  )}&langpair=${encodeURIComponent(`${pairSl}|${tl}`)}`;

  const mmRes = await fetch(mmUrl);
  const mmData = await mmRes.json().catch(() => ({}));
  const mmTranslation = mmData?.responseData?.translatedText || "";

  if (mmTranslation) {
    return {
      ok: true,
      provider: "mymemory-free",
      model: "mymemory-mt",
      providerLabel: "内置备用翻译通道",
      latencyMs: Date.now() - startTime,
      translation: mmTranslation,
      terms: [],
      text: JSON.stringify({
        translation: mmTranslation,
        correctedSource: "",
        terms: []
      })
    };
  }

  throw new Error("实时翻译网络波动，请稍后重试");
}

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method Not Allowed, use POST" }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    const body = await request.json();
    const {
      text = "",
      sourceLang = "ru-RU",
      targetLang = "简体中文",
      courseSubject = "通用大学学术课堂",
      glossaryKeywords = "",
      systemPrompt = "",
      userPrompt = "",
      mode = "standard",
      temperature = 0.15
    } = body;

    const rawSourceText =
      String(text || "").trim() ||
      String(userPrompt || "")
        .replace(/^[\s\S]*?"([^"]+)"\s*$/, "$1")
        .trim();

    // 1. 解析 Cloudflare 环境变量中配置的 API 选项
    const envApiConfig = resolveEnvApiConfig(env);

    // 2. 若环境变量配置了大模型 API 且非极速流式预览，优先使用环境变量配置的 API
    if (envApiConfig.provider !== "free" && envApiConfig.key && mode !== "fast-stream") {
      try {
        const llmResult = await translateViaConfiguredLLM(envApiConfig, {
          text: rawSourceText,
          sourceLang,
          targetLang,
          courseSubject,
          glossaryKeywords,
          systemPrompt,
          userPrompt,
          temperature
        });
        return new Response(JSON.stringify(llmResult), {
          status: 200,
          headers: corsHeaders
        });
      } catch (llmErr) {
        // 如果环境变量中的 API 密钥限流或报错，自动降级到内置免密翻译引擎并附带告警信息
        const fallbackResult = await translateViaBuiltinFreeEngine(
          rawSourceText,
          sourceLang,
          targetLang
        );
        fallbackResult.fallbackWarning = `环境变量 API (${envApiConfig.provider}) 响应异常 (${llmErr.message})，已自动无缝切换至内置免密翻译`;
        return new Response(JSON.stringify(fallbackResult), {
          status: 200,
          headers: corsHeaders
        });
      }
    }

    // 3. 默认或流式预览模式：调用内置免密实时神经翻译通道
    const result = await translateViaBuiltinFreeEngine(
      rawSourceText,
      sourceLang,
      targetLang
    );

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `翻译服务暂时忙碌: ${err.message || String(err)}`
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
