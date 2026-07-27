// js/app.js
import {
  auth, googleProvider, signInWithPopup, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "./firebase-init.js";
import {
  createChat, listenChats, listenMessages, renameChat, togglePin,
  deleteChat, sendMessage,
} from "./chat.js";
import { getMemoryProfile, setMemoryEnabled } from "./memory.js";

const $ = (sel) => document.querySelector(sel);
const views = {
  welcome: $("#view-welcome"),
  builder: $("#view-builder"),
  publicBot: $("#view-public-bot"),
  auth: $("#view-auth"),
  app: $("#view-app"),
};

let isMotherMode = false;
let authMode = "login"; // login | signup
let currentUser = null;
let currentChatId = null;
let unsubChats = null;
let unsubMessages = null;
let messagesCache = [];
let isCreatingChat = false;
let isSendingMessage = false;
let transientError = "";
let lastRenderSignature = "";
let activeChatMeta = {};
let currentPublicBot = null;
let publicVisitor = null;
let publicMessages = [];

const savedStyle = localStorage.getItem("ziad-response-style");
if (savedStyle && $("#setting-style")) {
  $("#setting-style").value = savedStyle;
}

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("view--active"));
  views[name].classList.add("view--active");
  document.body.classList.add("app-ready");
}

function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebar-overlay").hidden = false;
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebar-overlay").hidden = true;
  document.body.classList.remove("sidebar-open");
}

async function readApiResponse(res) {
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const serverMessage = data.error || data.detail;
    if (serverMessage) {
      throw new Error(`${serverMessage} (HTTP ${res.status})`);
    }
    if (res.status === 404) {
      throw new Error("مسار الـ API غير موجود. اعمل Redeploy للموقع وتأكد أن netlify.toml وFunctions اترفعوا.");
    }
    throw new Error(`السيرفر رجّع خطأ HTTP ${res.status}. راجع إعدادات Netlify ثم حاول تاني.`);
  }
  return data;
}

// ---------- البوابة الرئيسية ----------
const bootBotId = new URLSearchParams(location.search).get("bot");
const isPublicRoute = Boolean(bootBotId);
if (bootBotId) {
  loadPublicBot(bootBotId);
}

$("#btn-create-public").addEventListener("click", () => showView("builder"));
$("#btn-admin-enter").addEventListener("click", () => {
  $("#admin-form").hidden = !$("#admin-form").hidden;
  $("#admin-password").focus();
});

$("#admin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#admin-error").hidden = true;
  const password = $("#admin-password").value;

  try {
    const res = await fetch("/api/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await readApiResponse(res);
    if (!data.ok) throw new Error("السيرفر لم يؤكد دخول الأدمن.");
    localStorage.setItem("ziad-admin-ok", "1");
    isMotherMode = false;
    authMode = "login";
    $("#auth-heading").textContent = "دخول أدمن زياد";
    showView("auth");
  } catch (err) {
    $("#admin-error").hidden = false;
    $("#admin-error").textContent = err.message;
  }
});

$("#auth-back").addEventListener("click", () => showView("welcome"));
$("#builder-back").addEventListener("click", () => showView("welcome"));

// ---------- إنشاء نموذج عام ----------
const providerHelp = {
  openrouter: "OpenRouter: افتح openrouter.ai، أنشئ API key، ثم اختر اسم موديل من صفحة Models. مثال مجاني: openai/gpt-oss-20b:free.",
  gemini: "Google Gemini: افتح aistudio.google.com، اختر Get API key، ثم استخدم gemini-2.0-flash أو موديل متاح في حسابك.",
  openai: "OpenAI: افتح platform.openai.com/api-keys، أنشئ مفتاحًا، ثم استخدم gpt-4o-mini أو موديل متاح لحسابك.",
  custom: "Custom: استخدم أي API متوافق مع OpenAI. اكتب Base URL بدون /chat/completions، مثل https://api.example.com/v1.",
};

function updateProviderHelp() {
  const provider = $("#bot-provider").value;
  $("#provider-help").textContent = providerHelp[provider] || "";
  $("#bot-base-url-row").hidden = provider !== "custom";
  $("#bot-model").placeholder = provider === "gemini" ? "gemini-2.0-flash" : provider === "openai" ? "gpt-4o-mini" : provider === "custom" ? "اسم الموديل عند مزودك" : "openai/gpt-oss-20b:free";
}

$("#bot-provider").addEventListener("change", updateProviderHelp);
updateProviderHelp();

$("#bot-builder-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submit = $("#create-bot-submit");
  const error = $("#builder-error");
  error.hidden = true;
  submit.disabled = true;
  submit.textContent = "جاري تجهيز نموذجك...";

  const payload = {
    ownerName: $("#bot-owner-name").value.trim(),
    publicTitle: $("#bot-public-title").value.trim(),
    profileSummary: $("#bot-profile-summary").value.trim(),
    favoriteFoods: $("#bot-favorite-foods").value.trim(),
    favoriteActivities: $("#bot-favorite-activities").value.trim(),
    projects: $("#bot-projects").value.trim(),
    extra: $("#bot-extra").value.trim(),
    provider: $("#bot-provider").value,
    model: $("#bot-model").value.trim(),
    baseUrl: $("#bot-base-url").value.trim(),
    apiKey: $("#bot-api-key").value.trim(),
  };

  try {
    const res = await fetch("/api/create-bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readApiResponse(res);
    if (!data.bot?.id) throw new Error("السيرفر أنشأ ردًا غير مكتمل، جرّب تاني.");
    const link = `${location.origin}${location.pathname}?bot=${encodeURIComponent(data.bot.id)}`;
    $("#generated-link").value = link;
    $("#generated-link-panel").hidden = false;
    $("#generated-link-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (err) {
    error.hidden = false;
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
    submit.textContent = "إنشاء رابط النموذج";
  }
});

$("#copy-generated-link").addEventListener("click", async () => {
  const field = $("#generated-link");
  try {
    await navigator.clipboard.writeText(field.value);
    $("#copy-generated-link").textContent = "تم نسخ الرابط";
    setTimeout(() => { $("#copy-generated-link").textContent = "نسخ الرابط"; }, 1800);
  } catch {
    field.select();
    document.execCommand("copy");
  }
});

// ---------- الدخول ----------
$("#auth-toggle-mode").addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  $("#auth-submit").textContent = authMode === "login" ? "دخول" : "إنشاء حساب";
  $("#auth-toggle-mode").textContent =
    authMode === "login" ? "لسه معندكيش حساب؟ سجّلي دلوقتي" : "عندك حساب بالفعل؟ ادخلي";
});

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  $("#auth-error").hidden = true;
  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    $("#auth-error").hidden = false;
    $("#auth-error").textContent = translateAuthError(err.code);
  }
});

$("#auth-google").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    $("#auth-error").hidden = false;
    $("#auth-error").textContent = translateAuthError(err.code);
  }
});

function translateAuthError(code) {
  const map = {
    "auth/wrong-password": "كلمة المرور غلط",
    "auth/user-not-found": "الحساب ده مش موجود",
    "auth/email-already-in-use": "الإيميل ده متسجل قبل كده",
    "auth/invalid-email": "الإيميل مش صحيح",
    "auth/weak-password": "كلمة المرور لازم تكون 6 حروف على الأقل",
  };
  return map[code] || "حصل خطأ، حاول تاني";
}

// ---------- حالة الدخول ----------
onAuthStateChanged(auth, async (user) => {
  if (isPublicRoute) return;
  currentUser = user;
  if (user && localStorage.getItem("ziad-admin-ok") === "1") {
    showView("app");
    await initApp(user);
  } else if (user) {
    await signOut(auth);
    showView("welcome");
  } else {
    showView("welcome");
  }
});

$("#logout-btn").addEventListener("click", async () => {
  localStorage.removeItem("ziad-admin-ok");
  await signOut(auth);
});

// ---------- التطبيق ----------
async function initApp(user) {
  if (unsubChats) unsubChats();
  unsubChats = listenChats(user.uid, renderChatList);

  const memory = await getMemoryProfile(user.uid);
  $("#setting-memory").checked = memory.enabled !== false;
  renderMemoryFacts(memory.facts || [], memory.motherFacts || []);
}

let allChats = [];
function renderChatList(chats) {
  allChats = chats;
  const term = $("#chat-search").value.trim().toLowerCase();
  const filtered = term ? chats.filter((c) => c.title.toLowerCase().includes(term)) : chats;
  const sorted = [...filtered].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const activeChat = allChats.find((c) => c.id === currentChatId);

  if (currentChatId && !activeChat) {
    currentChatId = null;
    messagesCache = [];
  }

  $("#chat-list").innerHTML = sorted
    .map(
      (c) => `
      <div class="chat-item ${c.id === currentChatId ? "active" : ""}" data-id="${c.id}">
        <span class="chat-item-title">${c.pinned ? "📌 " : ""}${escapeHtml(c.title)}</span>
      </div>`
    )
    .join("");

  document.querySelectorAll(".chat-item").forEach((el) => {
    el.addEventListener("click", () => {
      openChat(el.dataset.id);
      closeSidebar();
    });
    el.addEventListener("dblclick", async () => {
      const chat = allChats.find((c) => c.id === el.dataset.id);
      const newTitle = prompt("اسم جديد للمحادثة:", chat.title);
      if (newTitle) await renameChat(currentUser.uid, chat.id, newTitle);
    });
  });

  if (activeChat) setChatHeading(activeChat);
  if (!currentChatId && sorted.length) openChat(sorted[0].id);
}

$("#chat-search").addEventListener("input", () => renderChatList(allChats));

$("#new-chat-btn").addEventListener("click", async () => {
  if (isCreatingChat) return;

  if (currentChatId && messagesCache.length === 0) {
    closeSidebar();
    input.focus();
    return;
  }

  isCreatingChat = true;
  $("#new-chat-btn").disabled = true;
  try {
    const id = await createChat(currentUser.uid, { isMotherMode });
    openChat(id);
  } finally {
    isCreatingChat = false;
    $("#new-chat-btn").disabled = false;
  }
  closeSidebar();
});

function openChat(chatId) {
  currentChatId = chatId;
  transientError = "";
  lastRenderSignature = "";
  const chat = allChats.find((c) => c.id === chatId);
  setChatHeading(chat);
  if (unsubMessages) unsubMessages();
  unsubMessages = listenMessages(currentUser.uid, chatId, renderMessages);
  document.querySelectorAll(".chat-item").forEach((el) =>
    el.classList.toggle("active", el.dataset.id === chatId)
  );
}

function setChatHeading(chat = {}) {
  activeChatMeta = chat || {};
  $("#chat-title").textContent = chat?.title || "محادثة";
}

function renderMessages(msgs) {
  messagesCache = msgs;
  const signature = JSON.stringify({
    ids: msgs.map((m) => `${m.id}:${m.role}:${m.text}`),
    isSendingMessage,
    transientError,
    nextPrompt: activeChatMeta.aiNextPrompt || "",
  });

  if (signature === lastRenderSignature) return;
  lastRenderSignature = signature;

  $("#empty-state").hidden = msgs.length > 0;
  $("#messages").innerHTML =
    `<div class="empty-state" id="empty-state" ${msgs.length ? "hidden" : ""}>
      <p>اسألني عن أي حاجة، أو افتح موضوع من اللي كنا شغالين عليه.</p>
    </div>` +
    msgs
      .map((m) => `<div class="msg msg--${m.role}" dir="auto">${renderRichText(m.text)}</div>`)
      .join("") +
    (isSendingMessage ? `<div class="msg msg--assistant msg--typing" aria-label="المساعد يكتب"><span></span><span></span><span></span></div>` : "") +
    (transientError ? `<div class="msg msg--assistant msg--error" dir="auto">${renderRichText(transientError)}</div>` : "");
  $("#messages").scrollTop = $("#messages").scrollHeight;
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderInlineMarkdown(text = "") {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
}

function renderRichText(text = "") {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^#{1,3}\s+(.+)/);
    const bullet = line.match(/^[-*]\s+(.+)/);

    if (!line.trim()) {
      closeList();
      html.push("<br>");
    } else if (heading) {
      closeList();
      html.push(`<h3>${renderInlineMarkdown(heading[1])}</h3>`);
    } else if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
    } else {
      closeList();
      html.push(`<p>${renderInlineMarkdown(line)}</p>`);
    }
  }

  closeList();
  return html.join("");
}

// ---------- الرابط العام والذاكرة المحلية ----------
let isPublicSending = false;

function publicStorageKey() {
  if (!currentPublicBot || !publicVisitor) return "";
  const identity = `${publicVisitor.name}|${publicVisitor.relation}`.toLowerCase();
  return `public-bot:${currentPublicBot.id}:${encodeURIComponent(identity)}`;
}

function savePublicMessages() {
  const key = publicStorageKey();
  if (key) localStorage.setItem(key, JSON.stringify(publicMessages.slice(-80)));
}

function loadSavedPublicMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(publicStorageKey()) || "[]");
    publicMessages = Array.isArray(saved) ? saved.filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content) : [];
  } catch {
    publicMessages = [];
  }
}

function savePublicVisitor() {
  if (!currentPublicBot || !publicVisitor) return;
  localStorage.setItem(`public-visitor:${currentPublicBot.id}`, JSON.stringify(publicVisitor));
}

function loadSavedPublicVisitor() {
  if (!currentPublicBot) return;
  try {
    const saved = JSON.parse(localStorage.getItem(`public-visitor:${currentPublicBot.id}`) || "null");
    if (saved?.name) $("#visitor-name").value = saved.name;
    if (saved?.relation) $("#visitor-relation").value = saved.relation;
  } catch {
    // Ignore malformed local browser data and let the visitor enter it again.
  }
}

function renderPublicMessages() {
  const container = $("#public-messages");
  if (!publicMessages.length && !isPublicSending) {
    container.innerHTML = `<div class="empty-state"><p>ابدأ بسؤال عن ${escapeHtml(currentPublicBot?.ownerName || "صاحب النموذج")}، أو احكِ له عن نفسك.</p></div>`;
  } else {
    container.innerHTML = publicMessages.map((m) => `<div class="msg msg--${m.role}" dir="auto">${renderRichText(m.content)}</div>`).join("");
    if (isPublicSending) container.innerHTML += `<div class="msg msg--assistant msg--typing" aria-label="النموذج يكتب"><span></span><span></span><span></span></div>`;
  }
  container.scrollTop = container.scrollHeight;
}

async function loadPublicBot(id) {
  try {
    const res = await fetch(`/api/get-bot?id=${encodeURIComponent(id)}`);
    const data = await readApiResponse(res);
    if (!res.ok) throw new Error(data.error || "الرابط ده غير صالح أو النموذج اتحذف.");
    currentPublicBot = data.bot;
    $("#public-bot-title").textContent = currentPublicBot.publicTitle || `نموذج ${currentPublicBot.ownerName}`;
    $("#public-bot-intro").textContent = `أنت على وشك التحدث مع النسخة الرقمية من ${currentPublicBot.ownerName}. اكتب اسمك وصلتك به عشان الرد يكون مناسبًا.`;
    $("#public-chat-title").textContent = currentPublicBot.publicTitle || currentPublicBot.ownerName;
    loadSavedPublicVisitor();
    showView("publicBot");
  } catch (err) {
    $("#public-bot-title").textContent = "النموذج غير متاح";
    $("#public-bot-intro").textContent = err.message;
    showView("publicBot");
  }
}

$("#visitor-form").addEventListener("submit", (e) => {
  e.preventDefault();
  publicVisitor = {
    name: $("#visitor-name").value.trim(),
    relation: $("#visitor-relation").value.trim(),
  };
  if (!publicVisitor.name || !publicVisitor.relation) return;
  savePublicVisitor();
  loadSavedPublicMessages();
  $("#visitor-gate").hidden = true;
  $("#public-chat").hidden = false;
  $("#public-chat-person").textContent = `أنت: ${publicVisitor.name} · ${publicVisitor.relation}`;
  renderPublicMessages();
  $("#public-composer-input").focus();
});

const publicInput = $("#public-composer-input");
publicInput.addEventListener("input", () => {
  publicInput.style.height = "auto";
  publicInput.style.height = Math.min(publicInput.scrollHeight, 140) + "px";
});

$("#public-composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = publicInput.value.trim();
  if (!text || !currentPublicBot || !publicVisitor || isPublicSending) return;
  publicInput.value = "";
  publicInput.style.height = "auto";
  publicMessages.push({ role: "user", content: text });
  savePublicMessages();
  isPublicSending = true;
  $("#public-send-btn").disabled = true;
  renderPublicMessages();

  const messages = publicMessages.slice(-36);
  const memory = [];
  let memoryBudget = 12000;
  for (const message of publicMessages.slice(0, -36).concat(publicMessages.slice(-36, -1))) {
    const excerpt = `${message.role === "user" ? "الزائر" : "النموذج"}: ${message.content}`.slice(0, 900);
    if (memoryBudget - excerpt.length < 0) break;
    memory.push(`من أرشيف المحادثة: ${excerpt}`);
    memoryBudget -= excerpt.length;
  }

  try {
    const request = (requestMessages, requestMemory) => fetch("/api/bot-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botId: currentPublicBot.id, visitor: publicVisitor, messages: requestMessages, memory: requestMemory }),
    });

    let data;
    try {
      data = await readApiResponse(await request(messages, memory));
    } catch (firstError) {
      // Retry with a compact context when a provider rejects a long prompt or briefly times out.
      data = await readApiResponse(await request(publicMessages.slice(-8), []));
    }
    publicMessages.push({ role: "assistant", content: data.reply || "مفيش رد صالح من النموذج." });
    savePublicMessages();
  } catch (err) {
    const owner = currentPublicBot?.ownerName || "صاحب النموذج";
    publicMessages.push({ role: "assistant", content: `أنا ${owner}. حصل عطل مؤقت في الاتصال، لكن المحادثة محفوظة. جرّب تبعت الرسالة تاني بعد لحظة.` });
    console.warn("public bot request failed after retry", err);
  } finally {
    isPublicSending = false;
    $("#public-send-btn").disabled = false;
    renderPublicMessages();
    publicInput.focus();
  }
});

// ---------- الإرسال ----------
const input = $("#composer-input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});

$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !currentChatId) return;
  input.value = "";
  input.style.height = "auto";
  $("#send-btn").disabled = true;
  isSendingMessage = true;
  transientError = "";
  $("#typing-indicator").hidden = true;
  renderMessages(messagesCache);

  const history = messagesCache.slice(-16).map((m) => ({ role: m.role, content: m.text }));

  try {
    await sendMessage(currentUser.uid, currentChatId, {
      text,
      isMotherMode,
      history,
      responseStyle: $("#setting-style").value,
    });
  } catch (err) {
    transientError = err.message;
  } finally {
    isSendingMessage = false;
    $("#send-btn").disabled = false;
    renderMessages(messagesCache);
  }
});

// ---------- الشريط الجانبي (موبايل) ----------
$("#toggle-sidebar").addEventListener("click", openSidebar);
$("#close-sidebar").addEventListener("click", closeSidebar);
$("#sidebar-overlay").addEventListener("click", closeSidebar);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSidebar();
});

// ---------- الإعدادات ----------
$("#open-settings").addEventListener("click", () => ($("#settings-panel").hidden = false));
$("#settings-close").addEventListener("click", () => ($("#settings-panel").hidden = true));

$("#setting-memory").addEventListener("change", async (e) => {
  await setMemoryEnabled(currentUser.uid, e.target.checked);
});

$("#setting-style").addEventListener("change", (e) => {
  localStorage.setItem("ziad-response-style", e.target.value);
});

function renderMemoryFacts(facts, motherFacts = []) {
  const list = $("#memory-facts-list");
  const ownerItems = facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const motherItems = motherFacts.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  list.innerHTML = `
    <li class="memory-group-label">حقائق عن زياد</li>
    ${ownerItems || `<li>لسه مفيش حقائق متخزنة</li>`}
    <li class="memory-group-label">حقائق من محادثات سماح</li>
    ${motherItems || `<li>لسه مفيش حقائق متخزنة</li>`}
  `;
}
