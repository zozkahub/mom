const {
  RESPONSE_HEADERS,
  json,
  decrypt,
  getBotsStore,
  buildBotPrompt,
  callBotModel,
} = require("./bot-utils");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }

  let bot;
  try {
    bot = await getBotsStore(event).get(payload.botId, { type: "json" });
  } catch (err) {
    console.error("bot-chat blob read failed", err);
    return json(500, {
      error: "فشل الاتصال ببيانات النموذج.",
      detail: err?.message || "راجع إعدادات Netlify Blobs.",
      code: "BLOBS_READ_FAILED",
    });
  }
  if (!bot) return json(404, { error: "النموذج ده مش موجود." });

  const messages = Array.isArray(payload.messages)
    ? payload.messages
      .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
      .slice(-20)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 6000) }))
    : [];
  if (!messages.length) return json(400, { error: "لازم تبعت رسالة." });

  let apiKey;
  try {
    apiKey = decrypt(bot.encryptedApiKey);
  } catch {
    return json(500, { error: "فشل فك تشفير مفتاح النموذج. راجع BOT_STORAGE_SECRET." });
  }

  const memory = Array.isArray(payload.memory)
    ? payload.memory.filter((item) => typeof item === "string").slice(-10).map((item) => item.slice(0, 1000))
    : [];
  const systemPrompt = buildBotPrompt(bot, payload.visitor || {}, memory);

  try {
    const reply = await callBotModel({ bot, apiKey, messages, systemPrompt });
    return json(200, { reply, modelUsed: bot.model || bot.provider });
  } catch (err) {
    return json(502, {
      error: "النموذج فشل في الرد.",
      detail: err?.message || "Unknown provider error",
    });
  }
};
