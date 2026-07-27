const {
  RESPONSE_HEADERS,
  json,
  decrypt,
  getBotsStore,
  buildBotPrompt,
  getDirectReply,
  buildGracefulFallback,
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

  const mode = payload.mode === "quick" || payload.mode === "pro" ? payload.mode : bot.mode || "pro";
  const messageLimit = mode === "quick" ? 12 : 36;
  const memoryLimit = mode === "quick" ? 8 : 24;
  const messages = Array.isArray(payload.messages)
    ? payload.messages
      .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
      .slice(-messageLimit)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 6000) }))
    : [];
  if (!messages.length) return json(400, { error: "لازم تبعت رسالة." });

  const memory = Array.isArray(payload.memory)
    ? payload.memory.filter((item) => typeof item === "string").slice(-memoryLimit).map((item) => item.slice(0, 1000))
    : [];
  const visitor = {
    name: String(payload.visitor?.name || "").trim().slice(0, 120),
    relation: String(payload.visitor?.relation || "").trim().slice(0, 160),
  };
  const latestUserMessage = messages.filter((message) => message.role === "user").at(-1)?.content || "";
  const userTurns = messages.filter((message) => message.role === "user");
  const conversation = {
    firstTurn: userTurns.length <= 1,
    disclosureDone: messages.some((message) => message.role === "assistant" && /نسخة رقمية|ذكاء اصطناعي|\bAI\b/i.test(message.content)),
  };
  const directReply = getDirectReply(bot, visitor, latestUserMessage, conversation);
  if (directReply) return json(200, { reply: directReply, direct: true });

  let apiKey;
  try {
    apiKey = decrypt(bot.encryptedApiKey);
  } catch {
    return json(200, {
      reply: buildGracefulFallback(bot, visitor),
      degraded: true,
      warning: "فشل فك تشفير مفتاح النموذج. راجع BOT_STORAGE_SECRET.",
    });
  }

  const systemPrompt = buildBotPrompt(bot, visitor, memory, conversation);

  try {
    const reply = await callBotModel({ bot, apiKey, messages, systemPrompt, mode });
    return json(200, { reply, mode, modelUsed: bot.model || bot.provider });
  } catch (err) {
    const detail = err?.message || "Unknown provider error";
    console.error("bot provider failed", detail);
    return json(200, {
      reply: buildGracefulFallback(bot, visitor),
      degraded: true,
      warning: detail,
    });
  }
};
