// netlify/functions/chat.js
// OpenRouter proxy for the site.
//
// Env vars:
// OPENROUTER_API_KEY          required
// OPENROUTER_REFERER          optional but recommended
// OPENROUTER_APP_TITLE        optional
// OPENROUTER_REQUIRE_ZDR      optional: "true" to prefer ZDR models only
// OPENROUTER_MODEL_TIMEOUT_MS  optional
// OPENROUTER_DISCOVERY_TIMEOUT_MS optional
// OPENROUTER_MAX_TOKENS       optional
// OPENROUTER_TEMPERATURE      optional
// OPENROUTER_MAX_MODELS       optional
// OPENROUTER_MODEL_CHAIN      optional comma-separated model IDs

const BASE_URL = "https://openrouter.ai";

// Keep a few known free text/chat variants as fallback. Free availability changes frequently.
const PREFERRED_FREE_MODELS = [
  "inclusionai/ling-3.0-flash:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "openai/gpt-oss-20b:free",
  "cohere/north-mini-code:free",
  "google/gemma-4-26b-a4b-it:free",
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

const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_MODEL_TIMEOUT_MS || 8500);
const MODEL_DISCOVERY_TIMEOUT_MS = Number(process.env.OPENROUTER_DISCOVERY_TIMEOUT_MS || 2500);
const MODEL_LIST_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_MODELS_PER_REQUEST = Math.min(
  Math.max(1, Number(process.env.OPENROUTER_MAX_MODELS || 3)),
  3
);

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

function getRequireZdr() {
  return String(process.env.OPENROUTER_REQUIRE_ZDR || "").toLowerCase() === "true";
}

function getConfiguredModelChain() {
  return unique(
    String(process.env.OPENROUTER_MODEL_CHAIN || "")
      .split(",")
      .map((model) => model.trim())
  );
}

function isTextChatModel(model) {
  const id = String(model?.id || "");
  const name = String(model?.name || "");
  const input = model?.architecture?.input_modalities || [];
  const output = model?.architecture?.output_modalities || [];
  const params = model?.supported_parameters || [];

  if (!id || !input.includes("text") || !output.includes("text")) return false;
  if (output.some((modality) => modality !== "text")) return false;
  if (Array.isArray(params) && !params.includes("max_tokens")) return false;

  // Free catalogs can include safety, music, audio, and other task-specific models.
  return !/safety|moderation|guard|lyria|music|audio|speech|tts/i.test(`${id} ${name}`);
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

async function discoverFreeModels() {
  const now = Date.now();
  const configured = getConfiguredModelChain();

  if (configured.length) {
    return configured;
  }

  if (modelListCache.list && now - modelListCache.fetchedAt < MODEL_LIST_CACHE_TTL_MS) {
    return modelListCache.list;
  }

  const { signal, cancel } = withTimeout(MODEL_DISCOVERY_TIMEOUT_MS);

  try {
    const params = new URLSearchParams();
    params.set("max_price", "0");
    params.set("output_modalities", "text");
    if (getRequireZdr()) params.set("zdr", "true");

    const res = await fetch(`${BASE_URL}/api/v1/models?${params.toString()}`, { signal });
    cancel();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const models = Array.isArray(data?.data) ? data.data : [];

    const discovered = unique(
      models
        .filter((m) => {
          const pricing = m?.pricing;
          const freeByPricing =
            pricing &&
            Number(pricing.prompt) === 0 &&
            Number(pricing.completion) === 0;

          return freeByPricing && isTextChatModel(m);
        })
        .map((m) => String(m.id))
    );

    const ordered = unique([
      ...PREFERRED_FREE_MODELS.filter((id) => discovered.includes(id)),
      ...discovered.filter((id) => !PREFERRED_FREE_MODELS.includes(id)),
    ]);

    modelListCache = {
      list: ordered.length ? ordered : PREFERRED_FREE_MODELS,
      fetchedAt: now,
    };

    console.log("[model-discovery] free chain:", modelListCache.list.slice(0, MAX_MODELS_PER_REQUEST));
    return modelListCache.list;
  } catch (err) {
    cancel();
    console.error("[model-discovery] fallback chain used:", err?.message || err);
    return PREFERRED_FREE_MODELS;
  }
}

async function callModelChain(models, fullMessages, apiKey) {
  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": getReferer(),
        "X-OpenRouter-Title": getAppTitle(),
        "X-OpenRouter-Metadata": "enabled",
      },
      body: JSON.stringify({
        models,
        messages: fullMessages,
        temperature: Number(process.env.OPENROUTER_TEMPERATURE || 0.7),
        max_tokens: Number(process.env.OPENROUTER_MAX_TOKENS || 2000),
      }),
      signal,
    });

    cancel();

    const rawText = await readTextResponse(res);

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        detail: extractErrorDetailFromResponseText(rawText, res.status),
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
      return {
        ok: false,
        status: 200,
        detail: msg?.refusal ? `model refusal: ${msg.refusal}` : "empty reply",
      };
    }

    return { ok: true, text: reply, model: data?.model || models[0] };
  } catch (err) {
    cancel();

    if (err?.name === "AbortError") {
      return {
        ok: false,
        status: 0,
        detail: `timeout after ${REQUEST_TIMEOUT_MS}ms`,
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

  const joined = attempts.map((a) => String(a.detail || "")).join(" | ");

  if (attempts.some((a) => a.status === 401 || a.status === 403)) {
    if (/referer|origin|site|domain/i.test(joined)) {
      return "OpenRouter رفض الطلب بسبب domain/referer restriction. لو المفتاح مربوط بدومين قديم، ضيف دومين Netlify الجديد أو استخدم مفتاح جديد.";
    }
    return "OpenRouter رفض الـ API key (401/403). راجع OPENROUTER_API_KEY في Netlify، خصوصًا إن الـ deploy الجديد على حساب Netlify مختلف.";
  }

  if (attempts.every((a) => a.status === 429)) {
    return "كل المحاولات رجعت 429 (rate limit). غالبًا وصلت لسقف الطلبات المجانية.";
  }

  if (attempts.some((a) => a.status === 402 || /credit|payment|balance|quota/i.test(String(a.detail || "")))) {
    return "OpenRouter محتاج credits أو الرصيد/الكوتا خلصت. جرّب مفتاح جديد عليه رصيد أو موديلات مجانية متاحة للحساب.";
  }

  if (/No endpoints found matching your data policy/i.test(joined) || /data policy/i.test(joined)) {
    return "OpenRouter منع routing بسبب data policy / privacy settings. راجع إعدادات الخصوصية للموديلات المجانية أو فعّل ZDR إذا كنت تحتاجه.";
  }

  if (attempts.every((a) => a.status === 404)) {
    return "كل الموديلات رجعت 404. غالبًا أسماء الموديلات القديمة لم تعد متاحة.";
  }

  if (attempts.every((a) => a.status === 0 && /timeout/i.test(String(a.detail || "")))) {
    return "كل المحاولات انتهت بمهلة زمنية. قلل عدد المحاولات أو زوّد المهلة قليلاً.";
  }

  return null;
}

function publicAttemptDetail(attempts) {
  const first = attempts.find((a) => a.detail)?.detail;
  return first ? String(first).slice(0, 500) : "";
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

  const chain = await discoverFreeModels();
  const models = chain.slice(0, Math.max(1, MAX_MODELS_PER_REQUEST));

  console.log("[chat] trying model chain:", models);
  const result = await callModelChain(models, fullMessages, apiKey);

  if (result.ok) {
    return {
      statusCode: 200,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({
        reply: result.text,
        modelUsed: result.model,
      }),
    };
  }

  const attempts = [
    {
      models,
      status: result.status,
      detail: result.detail,
    },
  ];

  console.error("[chat] failed model chain:", result);

  return {
    statusCode: 502,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({
      error: diagnoseCommonIssue(attempts) || `OpenRouter لم يرجع رد صالح. آخر سبب: ${publicAttemptDetail(attempts) || "غير معروف"}`,
      attempts,
      chainTried: models,
    }),
  };
};
