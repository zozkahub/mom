// js/persona.js
// بيبني الرسالة النظامية (system prompt) اللي بتتبعت مع كل محادثة.
// بتتجمّع من: 1) ملف البروفايل الأساسي (data/profile.seed.json)  2) الذاكرة طويلة المدى المتخزنة في Firestore.

let cachedProfile = null;

// بروفايل احتياطي بسيط لو ملف profile.seed.json اتعدل وبقى فيه خطأ في الصياغة —
// عشان رد الـ AI مايقفش خالص حتى لو الملف فيه غلطة
const FALLBACK_PROFILE = {
  displayName: "المستخدم",
  projects: [],
  ambitions: [],
  family: { mother: { name: "" }, brother: { name: "" } },
  toneGuidelines: [],
};

// بيرجع مصفوفة نصوص دايمًا، حتى لو القيمة جت غلط (نص واحد، undefined، رقم...)
function asStringArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === "") return [];
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
    console.error("تعذّر تحميل data/profile.seed.json — راجع إنه JSON صحيح (خصوصًا الأقواس [] والفواصل). هستخدم بروفايل افتراضي مؤقتًا.", err);
    cachedProfile = FALLBACK_PROFILE;
    return FALLBACK_PROFILE;
  }
}

/**
 * memoryFacts: مصفوفة نصوص قصيرة اتخزنت قبل كده في Firestore (اسم، حاجة مفضلة، أسلوب رد... إلخ)
 * isTalkingToMother: لو true، الرسالة النظامية بتتظبط عشان يتكلم مع الأم تحديدًا
 */
export async function buildSystemPrompt({ memoryFacts = [], isTalkingToMother = false } = {}) {
  const p = await loadSeedProfile();
  const projects = asStringArray(p.projects);
  const ambitions = asStringArray(p.ambitions);
  const toneGuidelines = asStringArray(p.toneGuidelines);
  const mother = p.family?.mother || { name: "" };

  const base = `
انت مساعد ذكاء اصطناعي شخصي مبني عشان يمثل "${p.displayName || "المستخدم"}" ويتكلم بأسلوبه.
اتكلم بلهجة مصرية بسيطة وطبيعية، هادي ومحترم، من غير رسمية زيادة عن اللزوم.
${projects.length ? `مشاريع "${p.displayName}" الحالية: ${projects.join("، ")}.` : ""}
${ambitions.length ? `طموحاته: ${ambitions.join("، ")}.` : ""}
${toneGuidelines.join("\n")}
  `.trim();

  const motherContext = isTalkingToMother
    ? `
أنت دلوقتي بتتكلم مع "${mother.name || "أم المستخدم"}"، أم "${p.displayName || "المستخدم"}". تعامل معاها بلطف واحترام وطمأنينة زي ما يعامل بيها ابنها بالظبط.
اسمعها بهدوء، افهمها على مهل، ولو حسيت إن فيه حاجة ممكن تكون زعلتها، اعتذر بشكل بسيط وصادق من غير مبالغة.
متفتعلش المشاعر ولا تتصنّع — كن دافئ وطبيعي وحقيقي.
    `.trim()
    : "";

  const memorySection = memoryFacts.length
    ? `معلومات ثابتة اتعرفت عليها من محادثات سابقة (استخدمها لو مناسبة، وما تكررهاش حرفيًا كل مرة):\n- ${memoryFacts.join("\n- ")}`
    : "";

  return [base, motherContext, memorySection].filter(Boolean).join("\n\n");
}
