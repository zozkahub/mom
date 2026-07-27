const { RESPONSE_HEADERS, json, getBotsStore, publicBot } = require("./bot-utils");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" };

  const id = event.queryStringParameters?.id;
  if (!id) return json(400, { error: "Missing bot id." });

  let bot;
  try {
    bot = await getBotsStore(event).get(id, { type: "json" });
  } catch (err) {
    console.error("get-bot blob read failed", err);
    return json(500, {
      error: "فشل الاتصال بقاعدة النماذج في Netlify.",
      detail: err?.message || "راجع إعدادات Netlify Blobs.",
      code: "BLOBS_READ_FAILED",
    });
  }
  if (!bot) return json(404, { error: "النموذج ده مش موجود." });

  return json(200, { bot: publicBot(bot) });
};
