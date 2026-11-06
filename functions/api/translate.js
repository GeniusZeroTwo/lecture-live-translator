/**
 * Cloudflare Pages Function: /api/translate
 * 边缘同传翻译代理接口：
 * 1. 支持使用 Cloudflare 环境变量预置的 GEMINI_API_KEY（避免前端暴露密钥）
 * 2. 支持前端传入 X-API-Key 并通过 Cloudflare 边缘节点转发（解决部分网络环境直连受阻问题）
 * 3. 预留多模型（Gemini / OpenAI 兼容格式如 GLM-4-Flash / SiliconFlow）路由扩展能力
 */
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Access-Passcode",
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
      provider = "gemini",
      model = "gemini-2.5-flash",
      systemPrompt = "",
      userPrompt = "",
      temperature = 0.2,
      endpointUrl = ""
    } = body;

    const clientKey = request.headers.get("X-API-Key") || "";
    const clientPasscode = request.headers.get("X-Access-Passcode") || "";

    let activeKey = clientKey;
    if (!activeKey && env) {
      if (env.ACCESS_PASSCODE && clientPasscode !== env.ACCESS_PASSCODE) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "需要正确的服务端访问口令 (ACCESS_PASSCODE)"
          }),
          { status: 401, headers: corsHeaders }
        );
      }
      if (provider === "gemini" && env.GEMINI_API_KEY) {
        activeKey = env.GEMINI_API_KEY;
      } else if (provider === "glm" && env.GLM_API_KEY) {
        activeKey = env.GLM_API_KEY;
      } else if (provider === "siliconflow" && env.SILICONFLOW_API_KEY) {
        activeKey = env.SILICONFLOW_API_KEY;
      }
    }

    if (!activeKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "未检测到有效 API Key，请在网页右上角【API 配置】中填入密钥"
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    const startTime = Date.now();

    if (provider === "gemini") {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(activeKey)}`;

      const geminiPayload = {
        systemInstruction: systemPrompt
          ? { parts: [{ text: systemPrompt }] }
          : undefined,
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: 1024
        }
      };

      const upstreamRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload)
      });

      const latencyMs = Date.now() - startTime;
      const data = await upstreamRes.json().catch(() => ({}));

      if (!upstreamRes.ok) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: upstreamRes.status,
            latencyMs,
            error:
              data?.error?.message ||
              `Gemini API Error (HTTP ${upstreamRes.status})`
          }),
          { status: upstreamRes.status, headers: corsHeaders }
        );
      }

      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || "")
          .join("") || "";

      return new Response(
        JSON.stringify({
          ok: true,
          provider,
          model,
          latencyMs,
          text: text.trim(),
          usage: data?.usageMetadata || null
        }),
        { status: 200, headers: corsHeaders }
      );
    } else {
      // OpenAI 兼容格式 (如智谱 GLM-4-Flash、硅基流动 Qwen2.5、Groq、DeepSeek 等后续扩展 API)
      const targetUrl =
        endpointUrl ||
        (provider === "glm"
          ? "https://open.bigmodel.cn/api/paas/v4/chat/completions"
          : "https://api.siliconflow.cn/v1/chat/completions");

      const upstreamRes = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: userPrompt }
          ],
          temperature,
          max_tokens: 1024
        })
      });

      const latencyMs = Date.now() - startTime;
      const data = await upstreamRes.json().catch(() => ({}));

      if (!upstreamRes.ok) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: upstreamRes.status,
            latencyMs,
            error:
              data?.error?.message ||
              `Upstream API Error (HTTP ${upstreamRes.status})`
          }),
          { status: upstreamRes.status, headers: corsHeaders }
        );
      }

      const text = data?.choices?.[0]?.message?.content || "";
      return new Response(
        JSON.stringify({
          ok: true,
          provider,
          model,
          latencyMs,
          text: text.trim(),
          usage: data?.usage || null
        }),
        { status: 200, headers: corsHeaders }
      );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `代理请求异常: ${err.message || String(err)}`
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}

