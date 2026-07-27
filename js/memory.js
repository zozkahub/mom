// js/memory.js
import { db, doc, getDoc, setDoc } from "./firebase-init.js";

const MAX_FACTS = 120; // مساحة أكبر للذاكرة الدائمة بدون تحويلها لسجل خام لكل الكلام

// بنخزن حقائق زياد وحقائق أمه في حقلين منفصلين تمامًا، عشان الـ AI ميخلطش
// معلومة اتقالت في محادثة مع سماح مع معلومة اتقالت في محادثة مع زياد.
function factsField(isMotherMode) {
  return isMotherMode ? "motherFacts" : "facts";
}

export async function getMemoryProfile(uid) {
  const ref = doc(db, "users", uid, "memory", "profile");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const initial = { facts: [], motherFacts: [], enabled: true, updatedAt: Date.now() };
    await setDoc(ref, initial);
    return initial;
  }
  const data = snap.data();
  return { facts: [], motherFacts: [], enabled: true, ...data };
}

export async function setMemoryEnabled(uid, enabled) {
  const ref = doc(db, "users", uid, "memory", "profile");
  await setDoc(ref, { enabled }, { merge: true });
}

export async function addMemoryFacts(uid, newFacts = [], isMotherMode = false) {
  if (!newFacts.length) return;
  const field = factsField(isMotherMode);
  const ref = doc(db, "users", uid, "memory", "profile");
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data()[field] || [] : [];

  const normalize = (value) =>
    String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();

  const merged = [...existing];
  for (const f of newFacts) {
    const fact = String(f || "").trim().replace(/\s+/g, " ");
    if (fact.length < 6 || fact.length > 220) continue;
    if (!merged.some((e) => normalize(e) === normalize(fact))) merged.push(fact);
  }

  const trimmed = merged.slice(-MAX_FACTS);

  await setDoc(ref, { [field]: trimmed, updatedAt: Date.now() }, { merge: true });
}

/**
 * بيستخدم نفس نقطة الـ AI لاستخلاص حقائق ثابتة (اسم، تفضيلات، أسلوب...) من كلام المستخدم نفسه بس،
 * ويتجاهل تمامًا أي حاجة قالها المساعد كرد. بيترجع مصفوفة نصوص قصيرة جاهزة للتخزين.
 *
 * userTexts: مصفوفة نصوص — رسايل المستخدم فقط (من غير ردود الـ AI خالص)
 */
export async function extractFacts(userTexts = []) {
  const clean = userTexts.filter((t) => typeof t === "string" && t.trim());
  if (!clean.length) return [];

  const extractionPrompt = `
جاي دلوقتي مجموعة رسايل، كل الرسايل دي من المستخدم نفسه بس (مفيش رد من أي مساعد فيها خالص).
استخرج منها بس المعلومات الثابتة والمهمة اللي المستخدم قالها فعلًا عن نفسه (زي: الاسم، طريقة النداء، المشاريع، الأهداف، التفضيلات، الأكل، طريقة التعامل، أسلوب رد بيفضله، موضوع بيتكرر).
متخترعش ولا تفترض حاجة المستخدم ماقالهاش، ومترجعش أي حاجة اتقالت في رد المساعد لأنها مش موجودة هنا أصلًا.
تجاهل أي حاجة مؤقتة أو حالة نفسية لحظية أو موضوع عابر.
لو المعلومة متعلقة بضرر أو سرقة أو احتيال، احفظها كتحذير أو سياق آمن فقط، وليس كهدف مطلوب تنفيذه.
رد بس بقايمة JSON من نصوص قصيرة، من غير أي شرح. لو مفيش حاجة ثابتة تستاهل الحفظ، رجّع [].
مثال: ["بيحب يتنادى عليه زياد", "بيفضل الردود القصيرة"]
  `.trim();

  const userBlock = clean.map((t, i) => `رسالة ${i + 1}: ${t}`).join("\n");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemPrompt: extractionPrompt,
        messages: [{ role: "user", content: userBlock }],
      }),
    });
    const data = await res.json();
    const parsed = JSON.parse(data.reply.match(/\[[\s\S]*\]/)?.[0] || "[]");
    return Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string") : [];
  } catch {
    return []; // فشل الاستخلاص مش لازم يوقف المحادثة
  }
}
