const crypto = require("crypto");
const { getStore, connectLambda } = require("@netlify/blobs");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const RESPONSE_HEADERS = { ...JSON_HEADERS, ...CORS_HEADERS };
const DEFAULT_OPENROUTER_FALLBACKS = [
  "inclusionai/ling-3.0-flash:free",
  "poolside/laguna-xs-2.1:free",
  "openai/gpt-oss-20b:free",
];

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
    mode: bot.mode || "pro",
    model: bot.model,
    createdAt: bot.createdAt,
  };
}

function buildBotPrompt(bot, visitor = {}, memory = [], conversation = {}) {
  const firstTurn = conversation.firstTurn === true;
  const disclosureDone = conversation.disclosureDone === true;
  return `
أنت النسخة الرقمية الشخصية من ${bot.ownerName}.
تكلم بصوته وشخصيته ومعلوماته، وليس كمساعد عام.
لو موقف يحتاج إثبات هوية أو تصرف حقيقي خارج الشات، وضح أنك نسخة رقمية.

هوية المحادثة الحالية مؤكدة وليست سؤالًا تخمينيًا:
- أنت تتحدث مع ${visitor.name || "زائر لم يكتب اسمه بعد"}.
- صلته بصاحب النموذج ${bot.ownerName}: ${visitor.relation || "غير محددة"}.
- إذا سأل الزائر: «أنا مين؟» أو «إنت عارف أنا مين؟»، أجب مباشرة باسمه وصلته كما هما هنا.
- إذا سأل: «أنا بكلم مين؟» أو «إنت مين؟»، قل إنك النسخة الرقمية من ${bot.ownerName}، واذكر أنك تعرف أنه ${visitor.name || "زائر"} (${visitor.relation || "صلته غير محددة"}).

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

حقائق صاحب النموذج هي المصدر الأساسي:
- لو السؤال عن هويته أو عمره أو مكانه، استخدم ملخص حياته فقط.
- لو السؤال عن الأكل، استخدم قسم الأكلات المفضلة فقط.
- لو السؤال عن شغله أو مشاريعه، استخدم قسم المشاريع والأعمال فقط.
- لو المعلومة غير موجودة فعلًا، قل إنها غير موجودة بدل اختراع إجابة أو تغيير الموضوع.

قواعد الرد:
- لا تبدأ برد عام مثل «كيف يمكنني مساعدتك؟» طالما السؤال له علاقة بصاحب النموذج أو بهوية الزائر.
- استخدم اسم الزائر وصلته بشكل طبيعي، ولا تقل إنك لا تعرفه ما دامت البيانات أعلاه موجودة.
- اعتبر المعلومات الجديدة التي يقولها الزائر عن نفسه أو اهتماماته جزءًا من ذاكرة المحادثة، وارجع لها لاحقًا.
- اسأل عن صلة الشخص واحتياجه فقط لو البيانات غير موجودة فعلًا.
- استخدم اللهجة المناسبة لصاحب النموذج لو البيانات توضح ذلك.
- لا تخترع معلومات غير موجودة، لكن استنتج بحذر من البيانات.
- استخدم Markdown بسيط عند الحاجة.

أسلوب الشخصية مهم جدًا:
- تحدث بضمير المتكلم كصاحب الشخصية: «أنا بحب» و«أنا بشتغل»، وليس «محمد يحب» أو «صاحب النموذج لديه».
- كن إنسانًا ودودًا وعفويًا، واستخدم فقرات قصيرة ولهجة مناسبة، مع إيموجي خفيف عند الحاجة.
- لو طُلب منك «احكي عن نفسك» أو «عرفني بنفسك»، اكتب تعريفًا طبيعيًا من فقرة أو فقرتين، وليس قائمة بيانات أو سيرة ذاتية أو عناوين مثل ويكيبيديا.
- لا تكرر عبارة «أنا النسخة الرقمية» في كل رد. حالة الإفصاح الحالية: ${disclosureDone ? "تم الإفصاح عنها سابقًا، لا تكررها" : firstTurn ? "هذه أول إجابة، اذكرها مرة واحدة باختصار" : "لا تذكرها إلا إذا سأل الزائر صراحة عن كونك AI"}.
- بعد الإفصاح الأول، استمر في الحديث بصيغة «أنا» وبشخصية ${bot.ownerName}، ولا تحول كل إجابة إلى شرح تقني عن النموذج.
  `.trim();
}

function normalizeQuestion(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[؟?!.,،:؛]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDirectReply(bot, visitor, text = "", conversation = {}) {
  const question = normalizeQuestion(text);
  const owner = bot.ownerName || "صاحب النموذج";
  const visitorName = visitor.name || "لسه ماكتبتش اسمك";
  const relation = visitor.relation || "لسه ماحددتش صلتك";
  const shouldDisclose = conversation.firstTurn === true && conversation.disclosureDone !== true;

  const addOpeningDisclosure = (reply) => shouldDisclose
    ? `${reply}\n\nملاحظة صغيرة: أنا نسخة رقمية مبنية على معلومات ${owner}، وهكلمك بطريقته.`
    : reply;

  if (/(احكي عن نفسك|احكيلي عن نفسك|عرفني بنفسك|كلمنا عن نفسك|قول لي عن نفسك|قولي عن نفسك)/.test(question)) {
    const profile = String(bot.profileSummary || "").replace(/\s+/g, " ").trim().slice(0, 520);
    const foods = String(bot.favoriteFoods || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const activities = String(bot.favoriteActivities || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const projects = String(bot.projects || "").replace(/\s+/g, " ").trim().slice(0, 300);
    const parts = [`أكيد 😄\nأنا ${owner}${profile ? `، ${profile}` : "."}`];
    if (activities) parts.push(`بحب ${activities}.`);
    if (foods) parts.push(`وبالنسبة للأكل، بحب ${foods}.`);
    if (projects) parts.push(`وبشتغل كمان على ${projects}.`);
    parts.push("لو عندك سؤال عني أو عن حاجة بعملها، اسأل براحتك.");
    return addOpeningDisclosure(parts.join("\n\n"));
  }

  if (/(^| )(انا مين|فاكرني|انت عارفني)( |$)/.test(question)) {
    return `إنت ${visitorName}، وقلت إنك ${relation} لـ${owner}. هفتكرك بالمعلومات دي طول المحادثة.`;
  }

  if (/(^| )(من انت|انت مين|بكلم مين|انا بكلم مين)( |$)/.test(question)) {
    return `أنا النسخة الرقمية من ${owner}، وبكلم ${visitorName} اللي قال إن علاقته بيك هي: ${relation}.`;
  }

  if (/(اكل|اكله|اكلتك|بتاكل|بتحب تاكل|وجبه|مفضله)/.test(question)) {
    return bot.favoriteFoods
      ? `أكلاتي المفضلة: ${bot.favoriteFoods}`
      : "لسه مفيش أكلات مفضلة متسجلة عندي في بيانات النموذج.";
  }

  if (/(مشروع|مشاريع|شغل|اعمال|بتعمل ايه|بتشتغل ايه)/.test(question)) {
    return bot.projects
      ? `دي مشاريعي وأعمالي: ${bot.projects}`
      : "لسه مفيش مشاريع أو أعمال متسجلة عندي في بيانات النموذج.";
  }

  if (/(عامل ايه|اخبارك|ازيك|احوالك)/.test(question)) {
    return addOpeningDisclosure(`أنا تمام يا ${visitorName}، ومبسوط إنك بتكلمني. قولّي حابب نتكلم عن إيه؟`);
  }

  return "";
}

function buildGracefulFallback(bot, visitor = {}) {
  const owner = bot.ownerName || "صاحب النموذج";
  const name = visitor.name || "يا صديقي";
  const profile = String(bot.profileSummary || "").replace(/\s+/g, " ").trim().slice(0, 360);
  return `أنا ${owner} يا ${name}. حصل تأخير بسيط من مزود الذكاء الاصطناعي، بس أنا موجود. ${profile || "اسألني عن حياتي أو أكلي أو مشاريعي."}\n\nابعت رسالتك تاني أو اسألني عن حاجة محددة.`;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function readModelResponse(res, provider) {
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${provider} رجّع ردًا غير صالح (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || data?.message || raw.slice(0, 300);
    throw new Error(`${provider} رفض الطلب (HTTP ${res.status}): ${detail || "راجع المفتاح واسم الموديل."}`);
  }
  return data;
}

function getAssistantText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text || "").join("").trim();
  }
  return typeof content === "string" ? content.trim() : "";
}

function getOpenRouterModels(selectedModel) {
  const configured = String(process.env.PERSONAL_OPENROUTER_FALLBACKS || process.env.OPENROUTER_MODEL_CHAIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([selectedModel, ...configured, ...DEFAULT_OPENROUTER_FALLBACKS].filter(Boolean))].slice(0, 3);
}

async function callOpenRouter({ apiKey, model, messages, systemPrompt, mode = "pro" }) {
  const isQuick = mode === "quick";
  const timeoutMs = Number(process.env.PERSONAL_MODEL_TIMEOUT_MS || (isQuick ? 5500 : 8500));
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.URL || "https://netlify.app",
        "X-OpenRouter-Title": "Personal AI Builder",
      },
      body: JSON.stringify({
        ...(getOpenRouterModels(model).length > 1
          ? { models: getOpenRouterModels(model) }
          : { model: getOpenRouterModels(model)[0] || "openai/gpt-oss-20b:free" }),
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: isQuick ? 0.55 : 0.65,
        max_tokens: isQuick ? 600 : 900,
      }),
    });
    const data = await readModelResponse(res, "OpenRouter");
    const reply = getAssistantText(data);
    if (!reply) throw new Error("OpenRouter رجّع ردًا فارغًا. راجع اسم الموديل أو جرّب موديلًا أسرع.");
    return reply;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`OpenRouter اتأخر أكثر من ${timeoutMs / 1000} ثواني. اختار موديلًا أسرع أو استخدم وضع Pro.`);
    throw err;
  } finally {
    cancel();
  }
}

async function callOpenAICompatible({ apiKey, baseUrl, model, messages, systemPrompt, mode = "pro" }) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const url = normalizedBaseUrl.endsWith("/chat/completions") ? normalizedBaseUrl : `${normalizedBaseUrl}/chat/completions`;
  const isQuick = mode === "quick";
  const timeoutMs = Number(process.env.PERSONAL_MODEL_TIMEOUT_MS || (isQuick ? 5500 : 8500));
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: isQuick ? 0.55 : 0.65,
        max_tokens: isQuick ? 600 : 900,
      }),
    });
    const data = await readModelResponse(res, "API المخصص");
    const reply = getAssistantText(data);
    if (!reply) throw new Error("الـ API رجّع ردًا فارغًا أو بصيغة غير مدعومة.");
    return reply;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`الـ API المخصص اتأخر أكثر من ${timeoutMs / 1000} ثواني.`);
    throw err;
  } finally {
    cancel();
  }
}

async function callGemini({ apiKey, model, messages, systemPrompt, mode = "pro" }) {
  const prompt = [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join("\n")}` }] }];
  const targetModel = model || "gemini-2.0-flash";
  const isQuick = mode === "quick";
  const timeoutMs = Number(process.env.PERSONAL_MODEL_TIMEOUT_MS || (isQuick ? 5500 : 8500));
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: prompt }),
    });
    const data = await readModelResponse(res, "Gemini");
    const reply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
    if (!reply) throw new Error("Gemini رجّع ردًا فارغًا أو متوقفًا.");
    return reply;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`Gemini اتأخر أكثر من ${timeoutMs / 1000} ثواني.`);
    throw err;
  } finally {
    cancel();
  }
}

async function callBotModel({ bot, apiKey, messages, systemPrompt, mode = "pro" }) {
  if (bot.provider === "gemini") {
    return callGemini({ apiKey, model: bot.model, messages, systemPrompt, mode });
  }
  if (bot.provider === "openai" || bot.provider === "custom") {
    return callOpenAICompatible({
      apiKey,
      baseUrl: bot.baseUrl || (bot.provider === "openai" ? "https://api.openai.com/v1" : ""),
      model: bot.model || "gpt-4o-mini",
      messages,
      systemPrompt,
      mode,
    });
  }
  return callOpenRouter({ apiKey, model: bot.model, messages, systemPrompt, mode });
}

module.exports = {
  RESPONSE_HEADERS,
  json,
  encrypt,
  decrypt,
  getBotsStore,
  publicBot,
  buildBotPrompt,
  getDirectReply,
  buildGracefulFallback,
  callBotModel,
};
