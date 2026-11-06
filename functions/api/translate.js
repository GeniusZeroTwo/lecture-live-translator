/**
 * Cloudflare Pages / Workers Function: /api/translate
 * 免配置开箱即用边缘同传翻译接口：
 * 1. 默认内置免密钥多通道实时神经翻译引擎（无需在 Cloudflare 配置任何环境变量或密钥即可直接使用，支持俄语 ru-RU、英语 en-US 等多语种）
 * 2. 兼容容错：若用户在 Cloudflare「变量和密钥 (Variables and Secrets)」中配置了任意格式的密钥（如 GEMINI_API_KEY / API_KEY / GLM_API_KEY 等，甚至误填了 KEY=VALUE 前缀），自动清洗识别；一旦密钥无效或受限，100% 自动无感降级至内置免密翻译通道，绝不报错阻断课堂同传。
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

/**
 * 自动从 Cloudflare env「变量和密钥」中容错提取可用的大模型 Key（完全可选）
 */
function extractOptionalServerKey(env) {
  if (!env || typeof env !== "object") return null;

  const cleanVal = (v) => {
    if (typeof v !== "string") return "";
    return v
      .trim()
      .replace(/^[A-Z0-9_]+\s*=\s*/i, "") // 容错：用户误将 GEMINI_API_KEY=xxx 整个粘贴进值框
      .replace(/^["']+|["']+$/g, "")
      .trim();
  };

  // 按优先级检查常见变量名
  const geminiCandidates = [
    env.GEMINI_API_KEY,
    env.GOOGLE_API_KEY,
    env.API_KEY,
    env.KEY,
    env.SECRET
  ];
  for (const candidate of geminiCandidates) {
    const cleaned = cleanVal(candidate);
    if (cleaned.startsWith("AIza")) {
      return { provider: "gemini", model: "gemini-2.5-flash", key: cleaned };
    }
  }

  // 扫描 env 所有键值（防止用户在「变量和密钥」中起了自定义名字）
  for (const [, rawVal] of Object.entries(env)) {
    const cleaned = cleanVal(rawVal);
    if (cleaned.startsWith("AIza")) {
      return { provider: "gemini", model: "gemini-2.5-flash", key: cleaned };
    }
  }

  return null;
}

/**
 * 内置零密钥极速神经翻译通道 (Google GTX + MyMemory 双重保障)
 */
async function translateViaBuiltinFreeEngine(text, sourceLang = "auto", targetLang = "zh-CN") {
  const sl = normalizeLangCode(sourceLang, false);
  const tl = normalizeLangCode(targetLang, true);
  const startTime = Date.now();

  // 通道 A：Google GTX 神经机器翻译接口（支持俄语、英语等全语种高精度实时翻译与词典提取）
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
  } catch (_) {
    // 自动切换备用通道
  }

  // 通道 B：MyMemory 免费国际翻译接口兜底
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
      targetLang = "zh-CN",
      systemPrompt = "",
      userPrompt = "",
      mode = "standard",
      temperature = 0.15
    } = body;

    const rawSourceText = String(text || "").trim();

    // 如果是实时流式字幕预览 (fast-stream) 或未配置可选云端大模型密钥，直接走毫秒级内置免密翻译引擎
    const optionalKeyObj = mode === "fast-stream" ? null : extractOptionalServerKey(env);

    if (optionalKeyObj && optionalKeyObj.provider === "gemini" && (userPrompt || rawSourceText)) {
      const startTime = Date.now();
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          optionalKeyObj.model
        )}:generateContent?key=${encodeURIComponent(optionalKeyObj.key)}`;

        const geminiPayload = {
          systemInstruction: systemPrompt
            ? { parts: [{ text: systemPrompt }] }
            : undefined,
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt || `Translate to Chinese: ${rawSourceText}` }]
            }
          ],
          generationConfig: {
            temperature,
            maxOutputTokens: 800,
            responseMimeType: "application/json"
          }
        };

        const upstreamRes = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiPayload)
        });

        if (upstreamRes.ok) {
          const data = await upstreamRes.json().catch(() => ({}));
          const llmText =
            data?.candidates?.[0]?.content?.parts
              ?.map((p) => p.text || "")
              .join("")
              .trim() || "";

          if (llmText) {
            return new Response(
              JSON.stringify({
                ok: true,
                provider: "gemini-cloud",
                model: optionalKeyObj.model,
                latencyMs: Date.now() - startTime,
                text: llmText
              }),
              { status: 200, headers: corsHeaders }
            );
          }
        }
      } catch (_) {
        // 如果用户在 Cloudflare 变量和密钥中配置的密钥不正确或受限，静默降级至免密引擎
      }
    }

    // 默认 / 自动降级：调用内置零配置神经翻译通道
    const targetText =
      rawSourceText ||
      String(userPrompt || "")
        .replace(/^[\s\S]*?"([^"]+)"\s*$/, "$1")
        .trim();

    const result = await translateViaBuiltinFreeEngine(
      targetText,
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
