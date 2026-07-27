const { RESPONSE_HEADERS, json } = require("./bot-utils");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return json(500, { error: "ADMIN_PASSWORD is not set in Netlify." });

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Bad JSON" });
  }
  if (String(payload.password || "") !== expected) {
    return json(401, { error: "كلمة السر غلط." });
  }

  return json(200, { ok: true });
};
