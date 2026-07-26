// netlify/functions/chat.js
// Netlify proxy between the site and OpenRouter.
//
// Useful env vars:
// - OPENROUTER_API_KEY
// - OPENROUTER_REFERER
// - OPENROUTER_APP_TITLE
// - OPENROUTER_CEILING_MS
// - OPENROUTER_MODEL_TIMEOUT_MS
// - OPENROUTER_DISCOVERY_TIMEOUT_MS
// - OPENROUTER_MAX_TOKENS
// - OPENROUTER_TEMPERATURE

const BASE_URL = "https://openrouter.ai";

const PREFERRED_FREE_MODELS = [
  "inclusionai/ling-3.0-flash:free",
  "poolside/laguna-s-2.1:free",
  "openai/gpt-oss-120b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "poolside/laguna-xs-2.1:free",
  "openrouter/free",
];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const RESPONSE_HEADERS = {
  ...JSON_HEADERS,
  ...CORS_HEADERS,
};

const CEILING_MS = Number(process.env.OPENROUTER_CEILING_MS || 8500);
const PER_MODEL_TIMEOUT_MS = Number(process.env.OPENROUTER_MODEL_TIMEOUT_MS || 5000);
const MODEL_DISCOVERY_TIMEOUT_MS = Number(process.env.OPENROUTER_DISCOVERY_TIMEOUT_MS || 2500);
const MODEL_LIST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let modelListCache = { list: null, fetchedAt: 0 };

function unique(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

function getReferer() {
  return (
    process.env.OPENROUTER_REFERER ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    "http://localhost"
  );
}

function getAppTitle() {
  return process.env.OPENROUTER_APP_TITLE || "Personal Assistant";
}

function normalizeContent(rawContent) {
  if (Array.isArray(rawContent)) {
    return rawContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
        return "";
      })
      .join("")
      .trim();
  }

  if (typeof rawContent === "string") return rawContent.trim();
  return "";
}

function extractErrorDetailFromResponseText(rawText, statusCode) {
  const fallback = `HTTP ${statusCode}`;
  if (!rawText) return fallback;

  try {
    const parsed = JSON.parse(rawText);
    return (
      parsed?.error?.message ||
      parsed?.error ||
      parsed?.message ||
      rawText.slice(0, 300) ||
      fallback
    );
  } catch {
    return rawText.slice(0, 300) || fallback;
  }
}

async function readTextResponse(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function getFreeModelChain() {
  const now = Date.now();

  if (modelListCache.list && now - modelListCache.fetchedAt < MODEL_LIST_CACHE_TTL_MS) {
    return modelListCache.list;
  }

  const { signal, cancel } = withTimeout(MODEL_DISCOVERY_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/api/v1/models?max_price=0`, { signal });
    cancel();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const liveModels = Array.isArray(data?.data) ? data.data : [];

    const freeIds = unique(
      liveModels
        .filter((m) => {
          const id = String(m?.id || "");
          const pricing = m?.pricing;

          const isFreeByPricing =
            pricing &&
            Number(pricing.prompt) === 0 &&
            Number(pricing.completion) === 0;

          const isFreeBySlug = /:free$/.test(id) || id === "openrouter/free";

          return isFreeByPricing || isFreeBySlug;
        })
        .map((m) => String(m.id))
    );

    const ordered = unique([
      ...PREFERRED_FREE_MODELS.filter((id) => freeIds.includes(id)),
      ...freeIds.filter((id) => !PREFERRED_FREE_MODELS.includes(id)),
    ]);

    const finalChain = unique([
      ...ordered,
      "openrouter/free",
    ]);

    modelListCache = {
      list: finalChain.length ? finalChain : PREFERRED_FREE_MODELS,
      fetchedAt: now,
    };

    console.log("[model-discovery] free models chain:", modelListCache.list.slice(0, 10));

    return modelListCache.list;
  } catch (err) {
    cancel();
    console.error("[model-discovery] falling back to static model chain:", err?.message || err);
    return unique(PREFERRED_FREE_MODELS);
  }
}

async function callModel(model, fullMessages, apiKey) {
  const { signal, cancel } = withTimeout(PER_MODEL_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": getReferer(),
        "X-Title": getAppTitle(),
      },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        temperature: Number(process.env.OPENROUTER_TEMPERATURE || 0.7),
        max_tokens: Number(process.env.OPENROUTER_MAX_TOKENS || 2000),
      }),
      signal,
    });

    cancel();

    const rawText = await readTextResponse(response);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail: extractErrorDetailFromResponseText(rawText, response.status),
      };
    }

    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = {};
    }

    const msg = data?.choices?.[0]?.message;
    const reply = normalizeContent(msg?.content);

    if (!reply) {
      const refusal = msg?.refusal;
      return {
        ok: false,
        status: 200,
        detail: refusal ? `model refusal: ${refusal}` : "empty reply",
      };
    }

    return {
      ok: true,
      text: reply,
    };
  } catch (err) {
    cancel();

    if (err?.name === "AbortError") {
      return {
        ok: false,
        status: 0,
        detail: `timeout after ${PER_MODEL_TIMEOUT_MS}ms`,
      };
    }

    return {
      ok: false,
      status: 0,
      detail: err?.message || "unknown error",
    };
  }
}

function diagnoseCommonIssue(attempts) {
  if (!attempts.length) return null;

  const details = attempts.map((a) => String(a.detail || "")).join(" | ");

  if (attempts.some((a) => a.status === 401 || a.status === 403)) {
    return "OpenRouter رفض الـ API key (401/403). راجع OPENROUTER_API_KEY في Netlify وتأكد إنه صحيح 100%.";
  }

  if (attempts.every((a) => a.status === 429)) {
    return "كل المحاولات رجعت 429 (rate limit). غالبًا وصلت لسقف الموديلات المجانية في OpenRouter.";
  }

  if (/No endpoints found matching your data policy/i.test(details) || /data policy/i.test(details)) {
    return "OpenRouter رفض الموديلات الحرة بسبب إعدادات data policy/privacy في الحساب. راجع إعدادات الخصوصية للموديلات المجانية.";
  }

  if (attempts.every((a) => a.status === 404)) {
    return "كل الموديلات رجعت 404. غالبًا أسماء الموديلات قديمة أو اتشالت من OpenRouter.";
  }

  if (attempts.every((a) => a.status === 0 && /timeout/i.test(String(a.detail || "")))) {
    return "كل المحاولات انتهت بمهلة زمنية. قلل عدد المحاولات أو زوّد مهلة كل موديل قليلًا.";
  }

  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: RESPONSE_HEADERS,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({
        error: "OPENROUTER_API_KEY not set in Netlify environment variables.",
      }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: "Bad JSON" }),
    };
  }

  const { messages, systemPrompt } = payload || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: "messages must be a non-empty array" }),
    };
  }

  const fullMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const chain = await getFreeModelChain();
  const attempts = [];
  const startedAt = Date.now();

  for (const model of chain) {
    const elapsed = Date.now() - startedAt;

    if (elapsed + PER_MODEL_TIMEOUT_MS > CEILING_MS) {
      console.warn(`[chat] stopping early to stay within ceiling (${elapsed}ms elapsed)`);
      break;
    }

    console.log(`[chat] trying model: ${model}`);
    const result = await callModel(model, fullMessages, apiKey);

    if (result.ok) {
      return {
        statusCode: 200,
        headers: RESPONSE_HEADERS,
        body: JSON.stringify({
          reply: result.text,
          modelUsed: model,
        }),
      };
    }

    attempts.push({
      model,
      status: result.status,
      detail: result.detail,
    });

    console.error(`[chat] failed: ${model}`, result);

    if (result.status === 401 || result.status === 403) {
      return {
        statusCode: 502,
        headers: RESPONSE_HEADERS,
        body: JSON.stringify({
          error: "API key rejected by OpenRouter (401/403).",
          attempts,
        }),
      };
    }
  }

  return {
    statusCode: 502,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({
      error: diagnoseCommonIssue(attempts) || "All models failed to respond.",
      attempts,
    }),
  };
};
