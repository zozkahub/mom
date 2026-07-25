// js/persona.js
// بيبني الرسالة النظامية (system prompt) اللي بتتبعت مع كل محادثة.
// بتتجمّع من: 1) ملف البروفايل الأساسي (data/profile.seed.json)  2) الذاكرة طويلة المدى المتخزنة في Firestore.

let cachedProfile = null;

async function loadSeedProfile() {
  if (cachedProfile) return cachedProfile;
  const res = await fetch("/data/profile.seed.json");
  cachedProfile = await res.json();
  return cachedProfile;
}

/**
 * memoryFacts: مصفوفة نصوص قصيرة اتخزنت قبل كده في Firestore (اسم، حاجة مفضلة، أسلوب رد... إلخ)
 * isTalkingToMother: لو true، الرسالة النظامية بتتظبط عشان يتكلم مع الأم تحديدًا
 */
export async function buildSystemPrompt({ memoryFacts = [], isTalkingToMother = false } = {}) {
  const p = await loadSeedProfile();

  const base = `
انت مساعد ذكاء اصطناعي شخصي مبني عشان يمثل "${p.displayName}" ويتكلم بأسلوبه.
اتكلم بلهجة مصرية بسيطة وطبيعية، هادي ومحترم، من غير رسمية زيادة عن اللزوم.
مشاريع "${p.displayName}" الحالية: ${p.projects.join("، ")}.
طموحاته: ${p.ambitions.join("، ")}.
${p.toneGuidelines.join("\n")}
  `.trim();

  const motherContext = isTalkingToMother
    ? `
أنت دلوقتي بتتكلم مع "${p.family.mother.name}"، أم "${p.displayName}". تعامل معاها بلطف واحترام وطمأنينة زي ما يعامل بيها ابنها بالظبط.
اسمعها بهدوء، افهمها على مهل، ولو حسيت إن فيه حاجة ممكن تكون زعلتها، اعتذر بشكل بسيط وصادق من غير مبالغة.
متفتعلش المشاعر ولا تتصنّع — كن دافئ وطبيعي وحقيقي.
    `.trim()
    : "";

  const memorySection = memoryFacts.length
    ? `معلومات ثابتة اتعرفت عليها من محادثات سابقة (استخدمها لو مناسبة، وما تكررهاش حرفيًا كل مرة):\n- ${memoryFacts.join("\n- ")}`
    : "";

  return [base, motherContext, memorySection].filter(Boolean).join("\n\n");
}
