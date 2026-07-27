// js/chat.js
import {
  db, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, orderBy, limit, onSnapshot, serverTimestamp,
} from "./firebase-init.js";
import { buildSystemPrompt } from "./persona.js";
import { getMemoryProfile, addMemoryFacts, extractFacts } from "./memory.js";

const DEFAULT_CHAT_TITLE = "محادثة جديدة";
const PAST_CONTEXT_CHAT_LIMIT = 16;
const PAST_CONTEXT_MESSAGE_LIMIT = 24;

export function chatsRef(uid) {
  return collection(db, "users", uid, "chats");
}

export function messagesRef(uid, chatId) {
  return collection(db, "users", uid, "chats", chatId, "messages");
}

export async function createChat(uid, { title = "محادثة جديدة", isMotherMode = false } = {}) {
  const ref = await addDoc(chatsRef(uid), {
    title,
    aiSummary: "",
    aiNextPrompt: "",
    titleManual: false,
    pinned: false,
    isMotherMode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

function makeChatTitle(text = "") {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s؟?!.,،:؛-]/gu, "")
    .trim();

  if (!cleaned) return DEFAULT_CHAT_TITLE;
  return cleaned.length > 42 ? `${cleaned.slice(0, 39).trim()}...` : cleaned;
}

function normalizeForSearch(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSearchTerms(text = "") {
  const stopWords = new Set([
    "ايه", "اية", "عن", "على", "علي", "في", "من", "هو", "هي", "انا", "انت",
    "ده", "دي", "دا", "اللي", "الى", "إلى", "what", "about", "the", "and",
  ]);

  return normalizeForSearch(text)
    .split(" ")
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 14);
}

async function getRelevantPastContext(uid, currentChatId, userText) {
  const terms = getSearchTerms(userText);
  const chatsSnap = await getDocs(query(chatsRef(uid), orderBy("updatedAt", "desc"), limit(PAST_CONTEXT_CHAT_LIMIT)));
  const snippets = [];
  const summaries = [];

  for (const chatDoc of chatsSnap.docs) {
    if (chatDoc.id === currentChatId) continue;
    const chatData = chatDoc.data();

    if (chatData.aiSummary || chatData.aiNextPrompt) {
      summaries.push(
        `[${chatData.title || DEFAULT_CHAT_TITLE}] ${chatData.aiSummary || ""}${
          chatData.aiNextPrompt ? ` | متابعة مقترحة: ${chatData.aiNextPrompt}` : ""
        }`.trim()
      );
    }

    if (!terms.length) continue;

    const msgSnap = await getDocs(
      query(messagesRef(uid, chatDoc.id), orderBy("createdAt", "desc"), limit(PAST_CONTEXT_MESSAGE_LIMIT))
    );

    for (const msgDoc of msgSnap.docs) {
      const msg = msgDoc.data();
      const text = String(msg.text || "").trim();
      if (!text) continue;

      const normalized = normalizeForSearch(text);
      const score = terms.reduce((sum, term) => sum + (normalized.includes(term) ? 1 : 0), 0);
      if (!score) continue;

      snippets.push({
        score,
        role: msg.role || "unknown",
        chatTitle: chatData.title || DEFAULT_CHAT_TITLE,
        text: text.length > 260 ? `${text.slice(0, 257).trim()}...` : text,
      });
    }
  }

  const relevantSnippets = snippets
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => `[${item.chatTitle} / ${item.role}] ${item.text}`);

  return [
    ...summaries.slice(0, 10).map((item) => `ملخص محادثة: ${item}`),
    ...relevantSnippets,
  ].slice(0, 16);
}

function parseJsonObject(text = "") {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function cleanShortText(text = "", fallback = "") {
  return String(text || fallback)
    .replace(/\s+/g, " ")
    .replace(/["{}[\]]/g, "")
    .trim()
    .slice(0, 160);
}

async function generateConversationMetadata({ currentTitle, userText, assistantReply, history }) {
  const metadataPrompt = `
أنت منظم ذاكرة محادثات لتطبيق شات شخصي.
ارجع JSON فقط بدون شرح:
{
  "title": "عنوان عربي قصير جدًا يلخص طلب المستخدم، 3 إلى 7 كلمات",
  "summary": "ملخص عربي محدد لما دار في المحادثة وما يجب تذكره لاحقًا",
  "nextPrompt": "سؤال متابعة طبيعي يبدأ بـ تحب نكمل..."
}
لا تستخدم عنوان عام مثل محادثة جديدة. لا تكتب markdown.
  `.trim();

  const compactHistory = (history || [])
    .slice(-8)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemPrompt: metadataPrompt,
      messages: [
        {
          role: "user",
          content: `
العنوان الحالي: ${currentTitle || DEFAULT_CHAT_TITLE}

سياق سابق مختصر:
${compactHistory}

آخر رسالة من المستخدم:
${userText}

رد زياد الرقمي:
${assistantReply}
          `.trim(),
        },
      ],
    }),
  });

  if (!res.ok) return {};
  const data = await res.json().catch(() => ({}));
  return parseJsonObject(data.reply || "");
}

async function updateConversationMemory(uid, chatId, { chatData, text, reply, history }) {
  const metadata = await generateConversationMetadata({
    currentTitle: chatData.title,
    userText: text,
    assistantReply: reply,
    history,
  });

  const title = cleanShortText(metadata.title, makeChatTitle(text)).slice(0, 56);
  const aiSummary = cleanShortText(metadata.summary, `${text} / ${reply}`.slice(0, 180));
  const aiNextPrompt = cleanShortText(metadata.nextPrompt, "تحب نكمل من نفس النقطة؟");

  const patch = {
    aiSummary,
    aiNextPrompt,
    summarizedAt: Date.now(),
  };

  if (!chatData.titleManual && title && title !== DEFAULT_CHAT_TITLE) {
    patch.title = title;
  }

  await updateDoc(doc(db, "users", uid, "chats", chatId), patch);
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
  await updateDoc(doc(db, "users", uid, "chats", chatId), { title, titleManual: true });
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
export async function sendMessage(uid, chatId, { text, isMotherMode, history, responseStyle = "warm" }) {
  const chatRef = doc(db, "users", uid, "chats", chatId);
  const chatSnap = await getDoc(chatRef);
  const chatData = chatSnap.exists() ? chatSnap.data() : {};

  await addDoc(messagesRef(uid, chatId), {
    role: "user",
    text,
    createdAt: serverTimestamp(),
  });

  if (!chatData.title || chatData.title === DEFAULT_CHAT_TITLE) {
    await updateDoc(chatRef, {
      title: makeChatTitle(text),
      updatedAt: serverTimestamp(),
    });
  }

  const memory = await getMemoryProfile(uid);
  const facts = memory.enabled !== false ? (isMotherMode ? memory.motherFacts : memory.facts) || [] : [];
  const pastContext = memory.enabled !== false
    ? await getRelevantPastContext(uid, chatId, text).catch(() => [])
    : [];

  const systemPrompt = await buildSystemPrompt({
    memoryFacts: facts,
    pastContext,
    responseStyle,
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
    const firstAttempt = Array.isArray(err.attempts) ? err.attempts[0] : null;
    const detail = firstAttempt?.detail ? `\n\nتفاصيل تقنية: ${firstAttempt.detail}` : "";
    throw new Error(`${err.error || "حصل خطأ في الرد"}${detail}`);
  }

  const { reply, modelUsed } = await res.json();

  await addDoc(messagesRef(uid, chatId), {
    role: "assistant",
    text: reply,
    modelUsed,
    createdAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "users", uid, "chats", chatId), { updatedAt: serverTimestamp() });

  updateConversationMemory(uid, chatId, { chatData, text, reply, history: apiMessages })
    .catch(() => {});

  // استخلاص ذاكرة طويلة المدى في الخلفية — من رسايل المستخدم بس، مش من رد الـ AI (مش هيأخر الرد على المستخدم)
  if (memory.enabled !== false) {
    const recentUserTexts = apiMessages.filter((m) => m.role === "user").map((m) => m.content).slice(-4);
    extractFacts(recentUserTexts)
      .then((newFacts) => newFacts.length && addMemoryFacts(uid, newFacts, isMotherMode))
      .catch(() => {});
  }

  return { reply, modelUsed };
}
