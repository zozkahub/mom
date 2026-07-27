const crypto = require("crypto");
const { RESPONSE_HEADERS, json, encrypt, getBotsStore, publicBot } = require("./bot-utils");

function pick(payload, key, max = 4000) {
  return String(payload[key] || "").trim().slice(0, max);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  const ownerName = pick(payload, "ownerName", 120);
  const apiKey = pick(payload, "apiKey", 3000);
  const provider = pick(payload, "provider", 40) || "openrouter";
  const mode = pick(payload, "mode", 20) || "pro";
  const allowedProviders = new Set(["openrouter", "gemini", "openai", "custom"]);

  if (!ownerName) return json(400, { error: "اكتب اسم صاحب النموذج." });
  if (!apiKey) return json(400, { error: "لازم تضيف API key للنموذج." });
  if (!allowedProviders.has(provider)) return json(400, { error: "مزود النموذج غير مدعوم." });
  if (!new Set(["quick", "pro"]).has(mode)) return json(400, { error: "وضع الذكاء غير مدعوم." });

  let encryptedApiKey;
  try {
    encryptedApiKey = encrypt(apiKey);
  } catch (err) {
    return json(500, { error: "BOT_STORAGE_SECRET مش متضاف في Netlify، وده مطلوب لتشفير مفاتيح المستخدمين." });
  }

  const id = crypto.randomBytes(9).toString("base64url");
  const now = Date.now();
  const bot = {
    id,
    ownerName,
    publicTitle: pick(payload, "publicTitle", 160) || `نموذج ${ownerName}`,
    profileSummary: pick(payload, "profileSummary"),
    favoriteFoods: pick(payload, "favoriteFoods"),
    favoriteActivities: pick(payload, "favoriteActivities"),
    projects: pick(payload, "projects"),
    extra: pick(payload, "extra"),
    provider,
    mode,
    model: pick(payload, "model", 160),
    baseUrl: pick(payload, "baseUrl", 300),
    encryptedApiKey,
    createdAt: now,
    updatedAt: now,
  };

  if (provider === "custom" && !bot.baseUrl) {
    return json(400, { error: "اكتب Base URL للـ API المتوافق." });
  }

  try {
    await getBotsStore(event).setJSON(id, bot);
  } catch (err) {
    console.error("create-bot blob write failed", err);
    return json(500, {
      error: "فشل حفظ النموذج داخل Netlify Blobs.",
      detail: err?.message || "تأكد أن Netlify مربوط بالموقع وأن Deploy يضم Functions وBlobs.",
      code: "BLOBS_WRITE_FAILED",
    });
  }

  return json(200, {
    ok: true,
    bot: publicBot(bot),
  });
};
