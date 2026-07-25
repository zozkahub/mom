// js/chat.js
import {
  db, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp,
} from "./firebase-init.js";
import { buildSystemPrompt } from "./persona.js";
import { getMemoryProfile, addMemoryFacts, extractFacts } from "./memory.js";

export function chatsRef(uid) {
  return collection(db, "users", uid, "chats");
}

export function messagesRef(uid, chatId) {
  return collection(db, "users", uid, "chats", chatId, "messages");
}

export async function createChat(uid, { title = "محادثة جديدة", isMotherMode = false } = {}) {
  const ref = await addDoc(chatsRef(uid), {
    title,
    pinned: false,
    isMotherMode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function listenChats(uid, cb) {
  const q = query(chatsRef(uid), orderBy("updatedAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function listenMessages(uid, chatId, cb) {
  const q = query(messagesRef(uid, chatId), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function renameChat(uid, chatId, title) {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { title });
}

export async function togglePin(uid, chatId, pinned) {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { pinned });
}

export async function deleteChat(uid, chatId) {
  await deleteDoc(doc(db, "users", uid, "chats", chatId));
}

/**
 * بيبعت رسالة المستخدم، يجيب رد الـ AI (مع الذاكرة والـ persona)، ويخزن الاتنين في Firestore.
 * بيرجع { reply, modelUsed }.
 */
export async function sendMessage(uid, chatId, { text, isMotherMode, history }) {
  await addDoc(messagesRef(uid, chatId), {
    role: "user",
    text,
    createdAt: serverTimestamp(),
  });

  const memory = await getMemoryProfile(uid);
  const facts = memory.enabled !== false ? memory.facts || [] : [];

  const systemPrompt = await buildSystemPrompt({
    memoryFacts: facts,
    isTalkingToMother: isMotherMode,
  });

  const apiMessages = [...history, { role: "user", content: text }];

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt, messages: apiMessages }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "حصل خطأ في الرد");
  }

  const { reply, modelUsed } = await res.json();

  await addDoc(messagesRef(uid, chatId), {
    role: "assistant",
    text: reply,
    modelUsed,
    createdAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "users", uid, "chats", chatId), { updatedAt: serverTimestamp() });

  // استخلاص ذاكرة طويلة المدى في الخلفية (مش هيأخر الرد على المستخدم)
  if (memory.enabled !== false) {
    extractFacts([...apiMessages, { role: "assistant", content: reply }].slice(-6))
      .then((newFacts) => newFacts.length && addMemoryFacts(uid, newFacts))
      .catch(() => {});
  }

  return { reply, modelUsed };
}
