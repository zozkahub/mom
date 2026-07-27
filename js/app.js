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
const views = { welcome: $("#view-welcome"), auth: $("#view-auth"), app: $("#view-app") };

let isMotherMode = false;
let authMode = "login"; // login | signup
let currentUser = null;
let currentChatId = null;
let unsubChats = null;
let unsubMessages = null;
let messagesCache = [];

const savedStyle = localStorage.getItem("ziad-response-style");
if (savedStyle && $("#setting-style")) {
  $("#setting-style").value = savedStyle;
}

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("view--active"));
  views[name].classList.add("view--active");
}

// ---------- شاشة الترحيب ----------
$("#btn-mother-enter").addEventListener("click", () => {
  isMotherMode = true;
  authMode = "login";
  $("#auth-heading").textContent = "أهلاً يا سماح";
  showView("auth");
});
$("#btn-owner-enter").addEventListener("click", () => {
  isMotherMode = false;
  authMode = "login";
  $("#auth-heading").textContent = "تسجيل الدخول";
  showView("auth");
});
$("#auth-back").addEventListener("click", () => showView("welcome"));

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
  currentUser = user;
  if (user) {
    showView("app");
    await initApp(user);
  } else {
    showView("welcome");
  }
});

$("#logout-btn").addEventListener("click", () => signOut(auth));

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

  $("#chat-list").innerHTML = sorted
    .map(
      (c) => `
      <div class="chat-item ${c.id === currentChatId ? "active" : ""}" data-id="${c.id}">
        <span class="chat-item-title">${c.pinned ? "📌 " : ""}${escapeHtml(c.title)}</span>
      </div>`
    )
    .join("");

  document.querySelectorAll(".chat-item").forEach((el) => {
    el.addEventListener("click", () => openChat(el.dataset.id));
    el.addEventListener("dblclick", async () => {
      const chat = allChats.find((c) => c.id === el.dataset.id);
      const newTitle = prompt("اسم جديد للمحادثة:", chat.title);
      if (newTitle) await renameChat(currentUser.uid, chat.id, newTitle);
    });
  });

  if (!currentChatId && sorted.length) openChat(sorted[0].id);
}

$("#chat-search").addEventListener("input", () => renderChatList(allChats));

$("#new-chat-btn").addEventListener("click", async () => {
  const id = await createChat(currentUser.uid, { isMotherMode });
  openChat(id);
  $("#sidebar").classList.remove("open");
});

function openChat(chatId) {
  currentChatId = chatId;
  const chat = allChats.find((c) => c.id === chatId);
  $("#chat-title").textContent = chat ? chat.title : "محادثة";
  if (unsubMessages) unsubMessages();
  unsubMessages = listenMessages(currentUser.uid, chatId, renderMessages);
  document.querySelectorAll(".chat-item").forEach((el) =>
    el.classList.toggle("active", el.dataset.id === chatId)
  );
}

function renderMessages(msgs) {
  messagesCache = msgs;
  $("#empty-state").hidden = msgs.length > 0;
  $("#messages").innerHTML =
    `<div class="empty-state" id="empty-state" ${msgs.length ? "hidden" : ""}><p>ابدئي بأي كلمة، أنا موجود.</p></div>` +
    msgs
      .map((m) => `<div class="msg msg--${m.role}" dir="auto">${renderRichText(m.text)}</div>`)
      .join("");
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
  $("#typing-indicator").hidden = false;

  const history = messagesCache.slice(-16).map((m) => ({ role: m.role, content: m.text }));

  try {
    await sendMessage(currentUser.uid, currentChatId, {
      text,
      isMotherMode,
      history,
      responseStyle: $("#setting-style").value,
    });
  } catch (err) {
    alert(err.message);
  } finally {
    $("#typing-indicator").hidden = true;
    $("#send-btn").disabled = false;
  }
});

// ---------- الشريط الجانبي (موبايل) ----------
$("#toggle-sidebar").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

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
