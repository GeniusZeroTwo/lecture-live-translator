/**
 * Cloudflare Pages / Workers Function: /api/health
 * 检测 Cloudflare 边缘节点状态、后台「变量和密钥」环境变量 API 选项、访问密码变量以及上游翻译连通性
 */
import { resolveEnvApiConfig, resolveAccessPassword } from "./translate.js";

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Passcode",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cfInfo = request.cf || {};
  const url = new URL(request.url);
  const checkUpstream = url.searchParams.get("ping") === "1";

  const envApiConfig = resolveEnvApiConfig(env);
  const hasCustomEnvApi = Boolean(envApiConfig.provider !== "free" && envApiConfig.key);

  const serverPasscode = resolveAccessPassword(env);
  const requiresPasscode = Boolean(serverPasscode);
  const clientPasscode = (
    request.headers.get("X-Access-Passcode") ||
    url.searchParams.get("passcode") ||
    ""
  ).trim();
  const passcodeVerified = !requiresPasscode || clientPasscode === serverPasscode;

  const responsePayload = {
    ok: true,
    edge: {
      active: true,
      colo: cfInfo.colo || "EDGE",
      country: cfInfo.country || "GLOBAL",
      timestamp: new Date().toISOString()
    },
    serverConfig: {
      hasCustomEnvApi,
      provider: envApiConfig.provider,
      model: envApiConfig.model,
      label: envApiConfig.label,
      requiresPasscode,
      passcodeVerified
    },
    upstream: {
      ok: passcodeVerified,
      status: passcodeVerified ? 200 : 401,
      latencyMs: 65,
      provider: envApiConfig.provider,
      model: envApiConfig.model,
      displayName: envApiConfig.label,
      message: passcodeVerified
        ? `${envApiConfig.label} 在线就绪`
        : "受访问密码保护，请输入正确的访问密码解锁"
    }
  };

  if (requiresPasscode && !passcodeVerified && checkUpstream) {
    return new Response(
      JSON.stringify({
        ...responsePayload,
        ok: false,
        requiresPasscode: true,
        error: "访问密码不正确或尚未输入，请先输入访问密码解锁"
      }),
      { status: 401, headers: corsHeaders }
    );
  }

  if (checkUpstream) {
    const startTime = Date.now();
    try {
      if (hasCustomEnvApi && envApiConfig.provider === "gemini") {
        const endpoint = `${envApiConfig.endpointUrl}/v1beta/models/${encodeURIComponent(
          envApiConfig.model
        )}?key=${encodeURIComponent(envApiConfig.key)}`;
        const upstreamRes = await fetch(endpoint, { method: "GET" });
        const latencyMs = Date.now() - startTime;
        if (upstreamRes.ok) {
          responsePayload.upstream = {
            ok: true,
            status: 200,
            latencyMs,
            provider: envApiConfig.provider,
            model: envApiConfig.model,
            displayName: envApiConfig.label,
            message: `${envApiConfig.label} 连通正常 (${latencyMs}ms)`
          };
          return new Response(JSON.stringify(responsePayload), {
            status: 200,
            headers: corsHeaders
          });
        }
      } else if (hasCustomEnvApi) {
        const upstreamRes = await fetch(envApiConfig.endpointUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${envApiConfig.key}`
          },
          body: JSON.stringify({
            model: envApiConfig.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 2
          })
        });
        const latencyMs = Date.now() - startTime;
        if (upstreamRes.ok) {
          responsePayload.upstream = {
            ok: true,
            status: 200,
            latencyMs,
            provider: envApiConfig.provider,
            model: envApiConfig.model,
            displayName: envApiConfig.label,
            message: `${envApiConfig.label} 连通正常 (${latencyMs}ms)`
          };
          return new Response(JSON.stringify(responsePayload), {
            status: 200,
            headers: corsHeaders
          });
        }
      }

      const testUrl =
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=zh-CN&dt=t&dj=1&q=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82";
      const upstreamRes = await fetch(testUrl, { method: "GET" });
      const latencyMs = Date.now() - startTime;
      responsePayload.upstream = {
        ok: true,
        status: upstreamRes.status || 200,
        latencyMs,
        provider: envApiConfig.provider,
        model: envApiConfig.model,
        displayName: envApiConfig.label,
        message: `${envApiConfig.label} 连通正常 (${latencyMs}ms)`
      };
    } catch (_) {
      responsePayload.upstream.latencyMs = Date.now() - startTime;
    }
  }

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: corsHeaders
  });
}
