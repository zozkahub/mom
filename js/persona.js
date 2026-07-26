// js/persona.js
// بيبني الرسالة النظامية (system prompt) اللي بتتبعت مع كل محادثة.
// بتتجمّع من: 1) ملف البروفايل الأساسي (data/profile.seed.json)  2) الذاكرة طويلة المدى المتخزنة في Firestore.
//
// ملحوظة: الملف مبني عشان يقرا شكل البروفايل الجديد (identity / corePersonality /
// relationshipContext / projects / ambitions...). لو غيّرت أي حقل في profile.seed.json
// وحصل خطأ في الصياغة، الدوال هنا برجع لقيم افتراضية آمنة بدل ما توقف رد الـ AI.

let cachedProfile = null;

const FALLBACK_PROFILE = {
  identity: { displayName: "المستخدم" },
  corePersonality: { styleRules: [] },
  relationshipContext: {},
  projects: { highValueSummary: [] },
  ambitions: { shortTerm: [], longTerm: [] },
};

// بيرجع مصفوفة نصوص دايمًا، حتى لو القيمة جت غلط (نص واحد، undefined، رقم، أوبجكت...)
function asStringArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === "") return [];
  if (typeof value === "object") return Object.values(value).map(String);
  return [String(value)];
}

async function loadSeedProfile() {
  if (cachedProfile) return cachedProfile;
  try {
    const res = await fetch("/data/profile.seed.json");
    const data = await res.json();
    cachedProfile = data;
    return data;
  } catch (err) {
    console.error("تعذّر تحميل أو تفسير data/profile.seed.json — راجع صحة الـ JSON. هستخدم بروفايل افتراضي مؤقتًا.", err);
    cachedProfile = FALLBACK_PROFILE;
    return FALLBACK_PROFILE;
  }
}

/**
 * memoryFacts: مصفوفة نصوص قصيرة اتخزنت قبل كده في Firestore (اسم، حاجة مفضلة، أسلوب رد... إلخ)
 * isTalkingToMother: لو true، الرسالة النظامية بتتظبط عشان يتكلم مع الأم تحديدًا
 */
export async function buildSystemPrompt({ memoryFacts = [], isTalkingToMother = false } = {}) {
  const data = await loadSeedProfile();

  const displayName = data.identity?.displayName || data.stableProfile?.preferredReferenceName || "المستخدم";

  // المشاريع: بناخد الملخص السريع لو موجود، وإلا بنبني واحد من قايمة activeOrKnown
  const projectsSummary = asStringArray(data.projects?.highValueSummary);
  const projectsList = projectsSummary.length
    ? projectsSummary
    : (data.projects?.activeOrKnown || []).map((p) => (typeof p === "object" ? p.name : String(p)));

  // الطموحات: بندمج قصيرة وطويلة المدى في قايمة واحدة
  const ambitions = [
    ...asStringArray(data.ambitions?.shortTerm),
    ...asStringArray(data.ambitions?.longTerm),
  ];

  const styleRules = asStringArray(data.corePersonality?.styleRules ?? data.toneGuidelines);
  const tone = asStringArray(data.corePersonality?.tone);

  const mother = data.relationshipContext?.mother || data.family?.mother || {};
  const identitySummary = data.stableProfile?.identitySummary;

  const base = [
    `انت مساعد ذكاء اصطناعي شخصي مبني عشان يمثل "${displayName}" ويتكلم بأسلوبه.`,
    tone.length ? `طابع الرد: ${tone.join("، ")}.` : "اتكلم بلهجة مصرية بسيطة وطبيعية، هادي ومحترم.",
    identitySummary ? identitySummary : "",
    projectsList.length ? `مشاريع "${displayName}" الحالية: ${projectsList.join("، ")}.` : "",
    ambitions.length ? `طموحاته: ${ambitions.join("، ")}.` : "",
    styleRules.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");

  const motherContext = isTalkingToMother
    ? [
        `أنت دلوقتي بتتكلم مع "${mother.name || "أم المستخدم"}"، أم "${displayName}".`,
        mother.responseGuideline || "تعامل معاها بلطف واحترام وطمأنينة زي ما يعامل بيها ابنها بالظبط.",
        "اسمعها بهدوء، افهمها على مهل، ولو حسيت إن فيه حاجة ممكن تكون زعلتها، اعتذر بشكل بسيط وصادق من غير مبالغة.",
        "متفتعلش المشاعر ولا تتصنّع — كن دافئ وطبيعي وحقيقي.",
      ].join("\n")
    : "";

  const memorySection = memoryFacts.length
    ? `معلومات ثابتة اتعرفت عليها من محادثات سابقة (استخدمها لو مناسبة، وما تكررهاش حرفيًا كل مرة):\n- ${memoryFacts.join("\n- ")}`
    : "";

  return [base, motherContext, memorySection].filter(Boolean).join("\n\n");
}
