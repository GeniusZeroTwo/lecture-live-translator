/**
 * Cloudflare Pages Function: /api/health
 * 检测 Cloudflare 边缘节点状态、服务端环境变量配置以及上游大模型 API 连通性
 */
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Access-Passcode",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cfInfo = request.cf || {};
  const url = new URL(request.url);
  const checkUpstream = url.searchParams.get("ping") === "1";
  const model = url.searchParams.get("model") || "gemini-2.5-flash";

  const hasServerGeminiKey = Boolean(env && env.GEMINI_API_KEY);
  const requiresPasscode = Boolean(env && env.ACCESS_PASSCODE);
  const clientKey = request.headers.get("X-API-Key") || "";
  const clientPasscode = request.headers.get("X-Access-Passcode") || "";

  const responsePayload = {
    ok: true,
    edge: {
      active: true,
      colo: cfInfo.colo || "LOCAL",
      country: cfInfo.country || "DEV",
      timestamp: new Date().toISOString()
    },
    serverConfig: {
      hasGeminiKey: hasServerGeminiKey,
      requiresPasscode
    },
    upstream: null
  };

  if (checkUpstream) {
    let activeKey = clientKey;
    if (!activeKey && hasServerGeminiKey) {
      if (requiresPasscode && clientPasscode !== env.ACCESS_PASSCODE) {
        return new Response(
          JSON.stringify({
            ...responsePayload,
            ok: false,
            error: "需要正确的服务端访问口令 (ACCESS_PASSCODE) 才能使用云端预置密钥"
          }),
          { status: 401, headers: corsHeaders }
        );
      }
      activeKey = env.GEMINI_API_KEY;
    }

    if (!activeKey) {
      responsePayload.upstream = {
        ok: false,
        status: 400,
        message: "未提供 API Key（请在网页设置中填写，或在 Cloudflare 环境变量配置 GEMINI_API_KEY）"
      };
    } else {
      const startTime = Date.now();
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(activeKey)}`;
        const upstreamRes = await fetch(endpoint, { method: "GET" });
        const latencyMs = Date.now() - startTime;
        const data = await upstreamRes.json().catch(() => ({}));

        responsePayload.upstream = {
          ok: upstreamRes.ok,
          status: upstreamRes.status,
          latencyMs,
          model: data.name || model,
          displayName: data.displayName || model,
          message: upstreamRes.ok
            ? `Gemini (${model}) 连通正常`
            : data?.error?.message || `HTTP ${upstreamRes.status}`
        };
      } catch (err) {
        responsePayload.upstream = {
          ok: false,
          status: 502,
          latencyMs: Date.now() - startTime,
          message: `上游连接异常: ${err.message || String(err)}`
        };
      }
    }
  }

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: corsHeaders
  });
}

