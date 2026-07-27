const { RESPONSE_HEADERS, json, getBotsStore, publicBot } = require("./bot-utils");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" };

  const id = event.queryStringParameters?.id;
  if (!id) return json(400, { error: "Missing bot id." });

  const bot = await getBotsStore().get(id, { type: "json" });
  if (!bot) return json(404, { error: "النموذج ده مش موجود." });

  return json(200, { bot: publicBot(bot) });
};
