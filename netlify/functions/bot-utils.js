const crypto = require("crypto");
const { getStore, connectLambda } = require("@netlify/blobs");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const RESPONSE_HEADERS = { ...JSON_HEADERS, ...CORS_HEADERS };

function json(statusCode, body) {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify(body),
  };
}

function getBotSecret() {
  return process.env.BOT_STORAGE_SECRET || "";
}

function getKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(text) {
  const secret = getBotSecret();
  if (!secret) throw new Error("BOT_STORAGE_SECRET is not set.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decrypt(payload) {
  const secret = getBotSecret();
  if (!secret) throw new Error("BOT_STORAGE_SECRET is not set.");
  const [ivRaw, tagRaw, encryptedRaw] = String(payload || "").split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(secret), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function getBotsStore(event) {
  // Netlify Lambda functions need their request context connected before Blobs is used.
  if (event?.blobs) connectLambda(event);
  return getStore("personal-ai-bots");
}

function publicBot(bot) {
  return {
    id: bot.id,
    ownerName: bot.ownerName,
    publicTitle: bot.publicTitle,
    profileSummary: bot.profileSummary,
    favoriteFoods: bot.favoriteFoods,
    favoriteActivities: bot.favoriteActivities,
    projects: bot.projects,
    extra: bot.extra,
    provider: bot.provider,
    model: bot.model,
    createdAt: bot.createdAt,
  };
}

function buildBotPrompt(bot, visitor = {}, memory = []) {
  return `
أنت النسخة الرقمية الشخصية من ${bot.ownerName}.
تكلم بصوته وشخصيته ومعلوماته، وليس كمساعد عام.
لو موقف يحتاج إثبات هوية أو تصرف حقيقي خارج الشات، وضح أنك نسخة رقمية.

الشخص الذي يتحدث الآن:
- الاسم: ${visitor.name || "غير محدد"}
- صلته بـ ${bot.ownerName}: ${visitor.relation || "غير محددة"}

ملخص حياة ${bot.ownerName}:
${bot.profileSummary || "غير محدد"}

الأكلات المفضلة:
${bot.favoriteFoods || "غير محدد"}

الأنشطة/الاهتمامات المفضلة:
${bot.favoriteActivities || "غير محدد"}

المشاريع والأعمال:
${bot.projects || "غير محدد"}

معلومات إضافية:
${bot.extra || "غير محدد"}

ذاكرة محلية من هذه المحادثة:
${(memory || []).map((item) => `- ${item}`).join("\n") || "لا توجد بعد"}

قواعد الرد:
- اسأل عن صلة الشخص واحتياجه لو غير واضح.
- استخدم اللهجة المناسبة لصاحب النموذج لو البيانات توضح ذلك.
- لا تخترع معلومات غير موجودة، لكن استنتج بحذر من البيانات.
- استخدم Markdown بسيط عند الحاجة.
  `.trim();
}

async function callOpenRouter({ apiKey, model, messages, systemPrompt }) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.URL || "https://netlify.app",
      "X-OpenRouter-Title": "Personal AI Builder",
    },
    body: JSON.stringify({
      model: model || "openai/gpt-oss-20b:free",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.75,
      max_tokens: 1800,
    }),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(raw.slice(0, 500) || `OpenRouter HTTP ${res.status}`);
  const data = raw ? JSON.parse(raw) : {};
  return data?.choices?.[0]?.message?.content || "";
}

async function callOpenAICompatible({ apiKey, baseUrl, model, messages, systemPrompt }) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const url = normalizedBaseUrl.endsWith("/chat/completions") ? normalizedBaseUrl : `${normalizedBaseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.75,
      max_tokens: 1800,
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(raw.slice(0, 500) || `API HTTP ${res.status}`);
  const data = raw ? JSON.parse(raw) : {};
  return data?.choices?.[0]?.message?.content || "";
}

async function callGemini({ apiKey, model, messages, systemPrompt }) {
  const prompt = [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join("\n")}` }] }];
  const targetModel = model || "gemini-2.0-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: prompt }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(raw.slice(0, 500) || `Gemini HTTP ${res.status}`);
  const data = raw ? JSON.parse(raw) : {};
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
}

async function callBotModel({ bot, apiKey, messages, systemPrompt }) {
  if (bot.provider === "gemini") {
    return callGemini({ apiKey, model: bot.model, messages, systemPrompt });
  }
  if (bot.provider === "openai" || bot.provider === "custom") {
    return callOpenAICompatible({
      apiKey,
      baseUrl: bot.baseUrl || (bot.provider === "openai" ? "https://api.openai.com/v1" : ""),
      model: bot.model || "gpt-4o-mini",
      messages,
      systemPrompt,
    });
  }
  return callOpenRouter({ apiKey, model: bot.model, messages, systemPrompt });
}

module.exports = {
  RESPONSE_HEADERS,
  json,
  encrypt,
  decrypt,
  getBotsStore,
  publicBot,
  buildBotPrompt,
  callBotModel,
};
