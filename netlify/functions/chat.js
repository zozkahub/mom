// netlify/functions/chat.js
// بروكسي بين الموقع و OpenRouter. المفتاح بيتقرا من Environment Variable اسمها OPENROUTER_API_KEY
// (تتظبط من لوحة تحكم Netlify: Site settings → Environment variables) — أبدًا متتكتبش هنا في الكود.

// رتّب النماذج من الأقوى للأخف. الاتنين الأولانيين هما اللي اتحددوا، والباقي احتياطي.
// ملحوظة: أسماء النماذج المجانية على OpenRouter بتتغيّر بمرور الوقت، فكل شوية افتح
// https://openrouter.ai/models?max_price=0 وحدّث القايمة دي لو لقيت موديل وقف عن الشغل.
const MODEL_CHAIN = [
  "inclusionai/ling-3.0-flash:free",
  "poolside/laguna-s-2.1:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemma-2-9b-it:free",
];

const HEADERS = {
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "OPENROUTER_API_KEY مش متظبطة في متغيرات البيئة على Netlify.",
      }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON" }) };
  }

  const { messages, systemPrompt } = payload;
  if (!Array.isArray(messages)) {
    return { statusCode: 400, body: JSON.stringify({ error: "messages مطلوبة" }) };
  }

  const fullMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  let lastError = null;

  for (const model of MODEL_CHAIN) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          ...HEADERS,
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://example.netlify.app",
          "X-Title": "Personal Assistant",
        },
        body: JSON.stringify({
          model,
          messages: fullMessages,
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        lastError = `${model}: HTTP ${res.status}`;
        continue; // جرّب الموديل اللي بعده
      }

      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content;

      if (!reply) {
        lastError = `${model}: رد فاضي`;
        continue;
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ reply, modelUsed: model }),
      };
    } catch (err) {
      lastError = `${model}: ${err.message}`;
      continue;
    }
  }

  return {
    statusCode: 502,
    body: JSON.stringify({
      error: "كل النماذج فشلت في الرد، حاول تاني كمان شوية.",
      details: lastError,
    }),
  };
};
