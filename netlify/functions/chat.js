// netlify/functions/chat.js
// بروكسي بين الموقع و OpenRouter. المفتاح بيتقرا من Environment Variable اسمها OPENROUTER_API_KEY
// (تتظبط من لوحة تحكم Netlify: Site settings → Environment variables) — أبدًا متتكتبش هنا في الكود.
//
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ لو "كل النماذج فشلت في الرد" بيظهر مع كل طلب من غير استثناء، السبب غالبًا
// مش في الكود أصلًا. اتأكد الأول من الاتنين دول في حساب OpenRouter بتاعك:
//
//   1) https://openrouter.ai/settings/privacy
//      لازم تفعّل "Enable training and logging" (خانة الموديلات المجانية).
//      من غيرها أي موديل :free بيرجع فورًا:
//        404  "No endpoints found matching your data policy"
//      وده بيحصل مع كل موديل في القايمة في نفس اللحظة، فحاسس إن "كله فشل"
//      مع إنها فعليًا مشكلة إعداد واحدة بس. الكود تحت بقى بيكتشف الحالة دي
//      بالذات ويقولك عليها صراحة بدل ما تقعد تلف.
//
//   2) https://openrouter.ai/activity
//      الموديلات المجانية سقفها 20 طلب/دقيقة، و 50 طلب/يوم لو الحساب من غير
//      رصيد، أو 1000 طلب/يوم لو ضفت 10$ رصيد (حتى من غير ما تستخدمه). السقف
//      مشترك بين كل الموديلات المجانية مع بعض، مش لكل موديل لوحده — فلو بتختبر
//      كتير في نفس اليوم ممكن توصل للسقف بسرعة.
//
// غير الاتنين دول، أسماء الموديلات المجانية بتتغيّر باستمرار (شركات زي جوجل
// وميسترال شالوا كل نسخهم المجانية من OpenRouter تمامًا وقت ما اتكتب الملف ده،
// وموديلات تانية بتتضاف كل شوية بعروض مؤقتة). عشان كده الكود تحت بقى مبيعتمدش
// على قايمة ثابتة بس — بيجيب القايمة اللايف من OpenRouter نفسه الأول.
// ═══════════════════════════════════════════════════════════════════════════

// قايمة احتياطية (fallback) لو جلب القايمة اللايف فشل لأي سبب. رتّبها من
// الأقوى للأخف. اتأكدت منها وقت كتابة الملف (يوليو 2026) عن طريق:
// https://openrouter.ai/models?max_price=0 — بس زي ما شرحنا فوق، الكود
// مش هيقف عندها لو قدر يجيب حاجة أحدث لايف.
const PREFERRED_FREE_MODELS = [
  "inclusionai/ling-3.0-flash:free", // ⚠️ عرض مجاني مؤقت بينتهي 3 أغسطس 2026
  "poolside/laguna-s-2.1:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "openai/gpt-oss-120b:free",
  "poolside/laguna-xs-2.1:free",
  "qwen/qwen-2.5-72b-instruct:free",
];

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const RESPONSE_HEADERS = { ...JSON_HEADERS, ...CORS_HEADERS };

// Netlify بتقفل الـ function افتراضيًا بعد 10 ثواني (لحد 26 ثانية لو رفعت
// خطتك وطلبت من الدعم). الأرقام دي بتوزّع الوقت ده بين جلب قايمة الموديلات
// ومحاولات النداء، وبتوقف بدري بما يكفي إننا نرجّع خطأ منظّم (JSON) بدل ما
// Netlify تقفل الدالة بنفسها وترجع خطأ فاضي مالوش شكل تقدر تتعامل معاه.
// ملحوظة مهمة: الشيك قبل كل محاولة بيتأكد إن حتى أسوأ سيناريو (الموديل يعلّق
// للمهلة كاملة) مش هيخرجنا برّه CEILING_MS — مش بس إننا لسه تحت السقف دلوقتي.
const CEILING_MS = 8500;
const PER_MODEL_TIMEOUT_MS = 5000;
const MODEL_DISCOVERY_TIMEOUT_MS = 2000;
const MODEL_LIST_CACHE_TTL_MS = 60 * 60 * 1000; // ساعة

// كاش بسيط في الذاكرة. بيفيد بس لما نفس نسخة الـ function تكون لسه "دافية"
// (warm) من طلب سابق؛ مع cold start جديد هيترجع يجيب القايمة تاني، وده طبيعي
// وموصوف عمدًا — أفضل من كاش يفضل يقول معلومة قديمة للأبد.
let modelListCache = { list: null, fetchedAt: 0 };

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/**
 * بيجيب الموديلات المجانية "لايف" من OpenRouter نفسه (endpoint عام، مش محتاج
 * مفتاح)، وبيحط اللي في PREFERRED_FREE_MODELS الأول لو لسه شغالة فعلًا، وبعدين
 * أي موديل مجاني تاني اكتشفه كاحتياطي إضافي. لو الجلب فشل أو طوّل أكتر من
 * MODEL_DISCOVERY_TIMEOUT_MS، بيرجع القايمة الثابتة على طول من غير ما يعطّل
 * أو يفشّل الطلب الأساسي.
 */
async function getFreeModelChain() {
  const now = Date.now();
  if (modelListCache.list && now - modelListCache.fetchedAt < MODEL_LIST_CACHE_TTL_MS) {
    return modelListCache.list;
  }

  const { signal, cancel } = withTimeout(MODEL_DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal });
    cancel();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const freeIds = new Set(
      (data?.data || [])
        .filter((m) => {
          const p = m?.pricing;
          return p && Number(p.prompt) === 0 && Number(p.completion) === 0;
        })
        .map((m) => m.id)
    );

    if (freeIds.size === 0) throw new Error("مفيش موديلات مجانية في الرد");

    const ordered = [
      ...PREFERRED_FREE_MODELS.filter((id) => freeIds.has(id)),
      ...[...freeIds].filter((id) => !PREFERRED_FREE_MODELS.includes(id)),
    ];

    modelListCache = { list: ordered, fetchedAt: now };
    console.log(
      `[model-discovery] لقيت ${freeIds.size} موديل مجاني لايف، هجرب بالترتيب ده أول 8:`,
      ordered.slice(0, 8)
    );
    return ordered;
  } catch (err) {
    cancel();
    console.error("[model-discovery] فشل الجلب اللايف، هرجع للقايمة الثابتة:", err.message);
    return PREFERRED_FREE_MODELS;
  }
}

/**
 * بينده موديل واحد على OpenRouter، وبيرجّع نتيجة منظّمة دايمًا (نجاح بنصه، أو
 * فشل برسالة الخطأ *الحقيقية* اللي رجعها OpenRouter) بدل ما يبلع التفاصيل في
 * مجرد رقم HTTP status زي الكود القديم.
 */
async function callModel(model, fullMessages, apiKey) {
  const { signal, cancel } = withTimeout(PER_MODEL_TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.URL || "https://example.netlify.app",
        "X-Title": "Personal Assistant",
      },
      body: JSON.stringify({ model, messages: fullMessages, temperature: 0.7 }),
      signal,
    });
    cancel();

    if (!res.ok) {
      // اقرا الـ body كنص مرة واحدة بس (مينفعش تقرا الـ response مرتين)،
      // وبعدين حاول تفسّره كـ JSON عشان تطلع رسالة OpenRouter الحقيقية.
      let detail = `HTTP ${res.status}`;
      try {
        const raw = await res.text();
        if (raw) {
          try {
            const errBody = JSON.parse(raw);
            detail = errBody?.error?.message || raw.slice(0, 200);
          } catch {
            detail = raw.slice(0, 200);
          }
        }
      } catch {
        // مقدرش يقرا الـ body خالص، سيب الافتراضي HTTP status
      }
      return { ok: false, status: res.status, detail };
    }

    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    const rawContent = msg?.content;
    // بعض الموديلات بترجع content كنص عادي، وبعضها كـ array من الأجزاء
    // (خصوصًا الموديلات اللي بتدعم تفكير/reasoning منفصل عن الرد النهائي).
    const text = Array.isArray(rawContent)
      ? rawContent.map((p) => (typeof p?.text === "string" ? p.text : "")).join("").trim()
      : typeof rawContent === "string"
      ? rawContent.trim()
      : "";

    if (!text) {
      const reason = msg?.refusal ? `الموديل رفض الرد: ${msg.refusal}` : "رجّع رد فاضي";
      return { ok: false, status: 200, detail: reason };
    }
    return { ok: true, text };
  } catch (err) {
    cancel();
    if (err.name === "AbortError") {
      return { ok: false, status: 0, detail: `ملقاش رد خلال ${PER_MODEL_TIMEOUT_MS}ms (timeout)` };
    }
    return { ok: false, status: 0, detail: err.message };
  }
}

/** بيدوّر على نمط مألوف في كل المحاولات الفاشلة عشان يديك تشخيص مباشر بدل رسالة عامة. */
function diagnoseCommonIssue(attempts) {
  if (attempts.length === 0) return null;
  if (attempts.every((a) => a.status === 404 && /data policy/i.test(a.detail || ""))) {
    return (
      "كل الموديلات رجعت 'No endpoints found matching your data policy' — " +
      "ده شبه مؤكد إن إعداد الخصوصية في حسابك مش مفعّل. روح https://openrouter.ai/settings/privacy " +
      "وفعّل الخيار الخاص بنشر بيانات الموديلات المجانية (training/logging)."
    );
  }
  if (attempts.every((a) => a.status === 429)) {
    return (
      "كل المحاولات رجعت 429 (Rate Limit) — يمكن وصلت لسقف الطلبات اليومي أو الدقيقة " +
      "للموديلات المجانية في حسابك. شوف https://openrouter.ai/activity، وممكن ضيف 10$ رصيد " +
      "يرفع السقف من 50 لـ 1000 طلب في اليوم حتى لو مش هتستخدم الرصيد ده."
    );
  }
  if (attempts.every((a) => a.status === 404)) {
    return (
      "كل الموديلات رجعت 404 (مش موجودة/اتشالت) — أسماء الموديلات في القايمة قديمة. " +
      "افتح https://openrouter.ai/models?max_price=0 وحدّث PREFERRED_FREE_MODELS."
    );
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" };
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
        error: "OPENROUTER_API_KEY مش متظبطة في متغيرات البيئة على Netlify.",
      }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: RESPONSE_HEADERS, body: JSON.stringify({ error: "Bad JSON" }) };
  }

  const { messages, systemPrompt } = payload;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: "messages مطلوبة (array فيها عنصر واحد على الأقل)" }),
    };
  }

  const fullMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const startedAt = Date.now();
  const chain = await getFreeModelChain();
  const attempts = [];

  for (const model of chain) {
    // مش بس "هل احنا لسه تحت السقف دلوقتي؟" — لازم كمان "لو المحاولة دي علّقت
    // للمهلة كاملة، هل هنعدي السقف؟". من غيرها ممكن محاولتين معلّقتين ورا بعض
    // يودّونا لضعف PER_MODEL_TIMEOUT_MS من غير ما الشيك يوقفهم.
    const elapsed = Date.now() - startedAt;
    if (elapsed + PER_MODEL_TIMEOUT_MS > CEILING_MS) {
      console.warn(`[chat] قربنا من حد وقت Netlify (استهلكنا ${elapsed}ms)، هوقف المحاولات وأرجع اللي عندي لحد دلوقتي`);
      break;
    }

    console.log(`[chat] بجرّب: ${model}`);
    const result = await callModel(model, fullMessages, apiKey);

    if (result.ok) {
      console.log(`[chat] نجح: ${model}`);
      return {
        statusCode: 200,
        headers: RESPONSE_HEADERS,
        body: JSON.stringify({ reply: result.text, modelUsed: model }),
      };
    }

    console.error(`[chat] فشل: ${model} -> status=${result.status} detail=${result.detail}`);
    attempts.push({ model, status: result.status, detail: result.detail });

    // 401/403 معناها المفتاح نفسه مرفوض عالميًا — تكملة باقي الموديلات مش
    // هتفرق لأن السبب واحد للكل، فنوقف على طول ونوفّر الوقت والطلبات.
    if (result.status === 401 || result.status === 403) {
      return {
        statusCode: 502,
        headers: RESPONSE_HEADERS,
        body: JSON.stringify({
          error:
            "الـ API key اتّرفض (401/403) — راجع قيمة OPENROUTER_API_KEY في Netlify، " +
            "وتأكد إنه منسوخ صح من https://openrouter.ai/settings/keys",
          attempts,
        }),
      };
    }
  }

  return {
    statusCode: 502,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({
      error: diagnoseCommonIssue(attempts) || "كل النماذج فشلت في الرد، حاول تاني كمان شوية.",
      attempts,
    }),
  };
};
