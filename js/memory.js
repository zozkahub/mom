// js/memory.js
import { db, doc, getDoc, setDoc, updateDoc, arrayUnion } from "./firebase-init.js";

const MAX_FACTS = 40; // سقف عشان الذاكرة تفضل مركّزة على الأهم مش أي كلام عابر

export async function getMemoryProfile(uid) {
  const ref = doc(db, "users", uid, "memory", "profile");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { facts: [], enabled: true, updatedAt: Date.now() });
    return { facts: [], enabled: true };
  }
  return snap.data();
}

export async function setMemoryEnabled(uid, enabled) {
  const ref = doc(db, "users", uid, "memory", "profile");
  await setDoc(ref, { enabled }, { merge: true });
}

export async function addMemoryFacts(uid, newFacts = []) {
  if (!newFacts.length) return;
  const ref = doc(db, "users", uid, "memory", "profile");
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data().facts || [] : [];

  // امنع تكرار حرفي لنفس المعلومة
  const merged = [...existing];
  for (const f of newFacts) {
    if (!merged.some((e) => e.trim() === f.trim())) merged.push(f.trim());
  }
  const trimmed = merged.slice(-MAX_FACTS); // احتفظ بآخر الحقائق الأهم فقط

  await setDoc(ref, { facts: trimmed, updatedAt: Date.now() }, { merge: true });
}

/**
 * بيستخدم نفس نقطة الـ AI لاستخلاص حقائق ثابتة (اسم، تفضيلات، أسلوب...) من آخر تبادل رسايل،
 * ويتجاهل أي حاجة مؤقتة (مزاج اللحظة، موضوع عابر). بيترجع مصفوفة نصوص قصيرة جاهزة للتخزين.
 */
export async function extractFacts(recentMessages) {
  const extractionPrompt = `
من المحادثة دي، استخرج بس المعلومات الثابتة والمهمة (زي: الاسم، طريقة النداء، حاجة مفضلة، أسلوب رد بيفضله، موضوع بيتكرر) لو فيه أي حاجة من دي.
تجاهل أي حاجة مؤقتة أو حالة نفسية لحظية أو موضوع عابر.
رد بس بقايمة JSON من نصوص قصيرة، من غير أي شرح. لو مفيش حاجة ثابتة تستاهل الحفظ، رجّع [].
مثال: ["بيحب يتنادى عليه زياد", "بيفضل الردود القصيرة"]
  `.trim();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemPrompt: extractionPrompt,
        messages: recentMessages,
      }),
    });
    const data = await res.json();
    const parsed = JSON.parse(data.reply.match(/\[[\s\S]*\]/)?.[0] || "[]");
    return Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string") : [];
  } catch {
    return []; // فشل الاستخلاص مش لازم يوقف المحادثة
  }
}
