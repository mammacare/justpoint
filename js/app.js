import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  runTransaction,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG, USERS, configured } from "./firebase-config.js";
import { INSPECTOR } from "./inspector.js";

/* ================================================================ */
("use strict");

const $ = (id) => document.getElementById(id);
const frame = $("frame");

let db = null,
  auth = null;
let me = { email: "", name: "", role: "owner" };
let requests = []; // live from Firestore
let currentUrl = "";
let picked = null;
let filter = { scope: "page" };
let frameReady = false;
let unsubscribe = null;
let pendingGoto = null; // selector to scroll to after a cross-page jump

let pages = []; // live from Firestore: { id, url, title, order }
let pagesUnsub = null;
let pagesSeeded = false;

/* Seeded into Firestore the first time the "pages" collection is empty,
   so existing installs keep today's dropdown without manual re-entry. */
const DEFAULT_PAGES = [
  {
    url: "https://mammacare.github.io/org-website-2026/index.html",
    title: "Home",
  },
  {
    url: "https://mammacare.github.io/org-website-2026/mammacare-method.html",
    title: "The MammaCare Method",
  },
  {
    url: "https://mammacare.github.io/org-website-2026/ai-breast-exam-trainer.html",
    title: "AI Breast Exam Trainer",
  },
  {
    url: "https://mammacare.github.io/org-website-2026/cbe-certification.html",
    title: "Clinical Breast Examiner Certification",
  },
  {
    url: "https://mammacare.github.io/org-website-2026/bse-certification.html",
    title: "Breast Self-Examination Instructor Certification",
  },
  {
    url: "https://mammacare.github.io/org-website-2026/bse-training-kit.html",
    title: "Breast Self-Exam Training Kit",
  },
  {
    url: "https://mammacare.github.io/org-website-2026/young-women-at-risk.html",
    title: "Young Women at Risk",
  },
  {
    url: "https://mammacare.github.io/org-website-2026/contact.html",
    title: "Contact",
  },
];

if (!configured) {
  $("configWarn").style.display = "block";
}

/* ---------------- helpers ---------------- */
function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2400);
}
function fmtWhen(ts) {
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })
  );
}
function pagePath(u) {
  try {
    const p = new URL(u);
    return p.host + p.pathname;
  } catch (e) {
    return u;
  }
}
function pageTitle(u) {
  const p = pages.find((x) => x.url === u);
  return p ? p.title : pagePath(u); // request from a page not in the dropdown
}

/* ---------------- auth ---------------- */
if (configured) {
  const app = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);

  onAuthStateChanged(auth, (user) => {
    if (user) {
      const known =
        USERS[(user.email || "").toLowerCase()] ||
        USERS[user.email] ||
        null;
      me = {
        email: user.email,
        name: known ? known.name : (user.email || "").split("@")[0],
        role: known ? known.role : "owner",
      };
      enterApp();
    } else {
      leaveApp();
    }
  });
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!configured) {
    $("loginErr").textContent =
      "Add your Firebase config first (see README).";
    return;
  }
  const btn = $("loginBtn");
  btn.disabled = true;
  $("loginErr").textContent = "";
  try {
    await signInWithEmailAndPassword(
      auth,
      $("loginEmail").value.trim(),
      $("loginPass").value,
    );
  } catch (err) {
    const code = (err && err.code) || "";
    $("loginErr").textContent =
      code.includes("invalid-credential") ||
      code.includes("wrong-password") ||
      code.includes("user-not-found")
        ? "Email or password doesn\u2019t match an account."
        : code.includes("too-many-requests")
          ? "Too many attempts — wait a minute and try again."
          : "Sign-in failed (" + code + ").";
  } finally {
    btn.disabled = false;
  }
});

$("signOutBtn").onclick = () => {
  if (auth) signOut(auth);
};

function enterApp() {
  $("loginScreen").style.display = "none";
  $("appHeader").style.display = "flex";
  $("appMain").style.display = "flex";
  document.body.dataset.role = me.role;
  $("meName").textContent = me.name;
  $("roleBadge").className = "role-badge " + me.role;
  $("roleLabel").textContent =
    me.role === "dev" ? "Developer" : "Site owner";
  $("managePagesBtn").style.display = me.role === "dev" ? "" : "none";
  if (me.role === "dev") filter.scope = "all";
  setFilter();
  subscribe();
  subscribePages();
}
function leaveApp() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (pagesUnsub) {
    pagesUnsub();
    pagesUnsub = null;
  }
  requests = [];
  pages = [];
  $("pageManager").classList.remove("open");
  $("loginScreen").style.display = "flex";
  $("appHeader").style.display = "none";
  $("appMain").style.display = "none";
  $("loginPass").value = "";
}

/* ---------------- firestore: live sync ---------------- */
function subscribe() {
  if (unsubscribe) unsubscribe();
  const q = query(
    collection(db, "requests"),
    orderBy("createdAt", "desc"),
  );
  $("syncDot").classList.remove("off");
  unsubscribe = onSnapshot(
    q,
    (snap) => {
      requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      sendPins();
    },
    (err) => {
      $("syncDot").classList.add("off");
      $("syncDot").textContent = "offline";
      toast(
        "Lost connection to the database: " + (err.code || err.message),
      );
    },
  );
}

/* ---------------- firestore: page list (dev-managed) ---------------- */
function subscribePages() {
  if (pagesUnsub) pagesUnsub();
  const q = query(collection(db, "pages"), orderBy("order", "asc"));
  pagesUnsub = onSnapshot(
    q,
    (snap) => {
      if (snap.empty && !pagesSeeded) {
        pagesSeeded = true;
        seedDefaultPages(); // onSnapshot fires again once seeded
        return;
      }
      pages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderPageOptions();
      renderPageManager();
      prefetchPages();
    },
    (err) => {
      toast("Couldn’t load the page list: " + (err.code || err.message));
    },
  );
}

async function seedDefaultPages() {
  try {
    for (let i = 0; i < DEFAULT_PAGES.length; i++) {
      await addDoc(collection(db, "pages"), {
        ...DEFAULT_PAGES[i],
        order: i,
        createdAt: Date.now(),
      });
    }
  } catch (err) {
    toast("Couldn’t set up the page list: " + (err.code || err.message));
  }
}

function renderPageOptions() {
  const sel = $("urlInput");
  const prevValue = sel.value;
  sel
    .querySelectorAll("option:not([value=''])")
    .forEach((o) => o.remove());
  pages.forEach((p) => {
    const openCount = requests.filter(
      (r) => r.url === p.url && r.status === "open",
    ).length;
    const o = document.createElement("option");
    o.value = p.url;
    // Native <select> options can't render the app's colored pin-badge,
    // so a colored-circle glyph stands in for it as plain text: red +
    // count when open requests are waiting, green when there are none.
    o.textContent =
      (openCount ? "\u{1F534} (" + openCount + ")  " : "\u{1F7E2} ") +
      p.title;
    sel.appendChild(o);
  });
  if (pages.some((p) => p.url === prevValue)) sel.value = prevValue;
}

function renderPageManager() {
  const list = $("pmList");
  if (!pages.length) {
    list.innerHTML =
      '<div class="pm-empty">No pages yet — add one above.</div>';
    return;
  }
  list.innerHTML = pages
    .map(
      (p) => `
    <div class="pm-item">
<div class="pm-info">
  <span class="pm-title">${esc(p.title)}</span>
  <span class="pm-url">${esc(p.url)}</span>
</div>
<button class="pm-remove" data-remove-page="${p.id}" title="Remove page">&times;</button>
    </div>`,
    )
    .join("");
}

$("managePagesBtn").onclick = () => {
  $("pageManager").classList.toggle("open");
};

$("pmAddBtn").onclick = async () => {
  const title = $("pmTitle").value.trim();
  const url = $("pmUrl").value.trim();
  if (!title || !url) {
    toast("Enter both a name and a URL");
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    toast("URL must start with http:// or https://");
    return;
  }
  if (pages.some((p) => p.url === url)) {
    toast("That page is already in the list");
    return;
  }
  const btn = $("pmAddBtn");
  btn.disabled = true;
  try {
    const order = pages.length
      ? Math.max(...pages.map((p) => p.order || 0)) + 1
      : 0;
    await addDoc(collection(db, "pages"), {
      title,
      url,
      order,
      createdAt: Date.now(),
    });
    $("pmTitle").value = "";
    $("pmUrl").value = "";
    toast("Page added");
  } catch (err) {
    toast("Couldn’t add page: " + (err.code || err.message));
  } finally {
    btn.disabled = false;
  }
};

$("pmList").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-remove-page]");
  if (!btn) return;
  const id = btn.getAttribute("data-remove-page");
  const p = pages.find((x) => x.id === id);
  if (
    !confirm(
      `Remove "${p ? p.title : "this page"}" from the dropdown? Existing change requests for it are kept.`,
    )
  )
    return;
  btn.disabled = true;
  try {
    await deleteDoc(doc(db, "pages", id));
    toast("Page removed");
  } catch (err) {
    toast("Couldn’t remove page: " + (err.code || err.message));
    btn.disabled = false;
  }
});

async function nextNum() {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, "meta", "counter");
    const snap = await tx.get(ref);
    const n = (snap.exists() ? snap.data().n || 0 : 0) + 1;
    tx.set(ref, { n });
    return n;
  });
}

async function submitRequest() {
  if (!picked) return;
  const proposed = $("cProposed").value.trim();
  const note = $("cNote").value.trim();
  if (!proposed && !note) {
    toast("Add the new copy or a note first");
    return;
  }
  const btn = $("cSubmit");
  btn.disabled = true;
  try {
    const num = await nextNum();
    await addDoc(collection(db, "requests"), {
      num,
      url: currentUrl,
      selector: picked.selector,
      tag: picked.tag,
      elementText: picked.text,
      proposed,
      note,
      author: me.name,
      authorEmail: me.email,
      role: me.role,
      status: "open",
      createdAt: Date.now(),
      replies: [],
    });
    picked = null;
    render();
    toast("Change request #" + num + " sent");
  } catch (err) {
    toast("Couldn\u2019t save: " + (err.code || err.message));
    btn.disabled = false;
  }
}

async function addReply(reqId, inputEl) {
  const text = inputEl.value.trim();
  if (!text) return;
  // Clear immediately: the local snapshot re-renders before the write
  // resolves, and the draft-restore in render() would otherwise put the
  // sent text back into the rebuilt input.
  inputEl.value = "";
  inputEl.disabled = true;
  try {
    await updateDoc(doc(db, "requests", reqId), {
      replies: arrayUnion({
        author: me.name,
        role: me.role,
        text,
        createdAt: Date.now(),
      }),
    });
  } catch (err) {
    const live =
      $("reqList").querySelector(`[data-reply="${reqId}"]`) || inputEl;
    live.value = text; // give the draft back on failure
    toast("Couldn\u2019t send reply: " + (err.code || err.message));
  } finally {
    inputEl.disabled = false;
  }
}

async function toggleStatus(reqId) {
  const req = requests.find((r) => r.id === reqId);
  if (!req) return;
  try {
    await updateDoc(doc(db, "requests", reqId), {
      status: req.status === "done" ? "open" : "done",
    });
  } catch (err) {
    toast("Couldn\u2019t update: " + (err.code || err.message));
  }
}

async function toggleClosed(reqId) {
  const req = requests.find((r) => r.id === reqId);
  if (!req) return;
  try {
    await updateDoc(doc(db, "requests", reqId), {
      status: req.status === "closed" ? "open" : "closed",
    });
  } catch (err) {
    toast("Couldn\u2019t update: " + (err.code || err.message));
  }
}

$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(requests, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "change-requests.json";
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ---------------- landing screen ---------------- */
/* The Getting Started view doubles as a landing screen the header nav
   link can return to at any time — showLoading()/showFetchFallback()
   overwrite #emptyState's markup while a fetch is in flight, so this
   is rebuilt from scratch rather than restored from the static HTML. */
function gettingStartedHtml() {
  return `
    <div class="big">Getting Started</div>
    ${
currentUrl
  ? `<button class="ghost-btn" id="backToPageBtn">← Back to ${esc(pageTitle(currentUrl))}</button>`
  : ""
    }
    <div class="steps">
<ol>
  <li>Choose a page above</li>
  <li>
    Right-click the headline, paragraph, or button you want changed
    <svg class="mouse-hint" width="34" height="48" viewBox="0 0 40 56" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="38" height="54" rx="19" fill="var(--panel)" stroke="var(--muted)" stroke-width="2" />
      <path d="M20 1 A19 19 0 0 1 39 20 L20 20 Z" fill="var(--red)" />
      <line x1="20" y1="1" x2="20" y2="20" stroke="var(--panel)" stroke-width="2" />
      <rect x="18" y="9" width="4" height="11" rx="2" fill="var(--muted)" />
    </svg>
  </li>
  <li>
    Write the new copy or a note — your developer sees it instantly,
    with numbered pins on the page.
  </li>
</ol>
    </div>
    <div class="landing-history" id="landingHistory"></div>`;
}

function showLandingScreen() {
  frame.style.display = "none";
  $("emptyState").innerHTML = gettingStartedHtml();
  $("emptyState").style.display = "flex";
  $("modeNote").style.display = "none";
  if (currentUrl) {
    $("backToPageBtn").onclick = () => {
      if (pageCache.has(currentUrl))
        renderHtml(pageCache.get(currentUrl), currentUrl);
      else loadUrl(currentUrl);
    };
  }
  renderLandingHistory();
}
$("landingBtn").onclick = showLandingScreen;
$("emptyState").innerHTML = gettingStartedHtml(); // initial state, before any page loads

/* ---------------- page loading ---------------- */
const PROXIES = [
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
];

function showLoading() {
  frame.style.display = "none";
  $("emptyState").style.display = "flex";
  $("emptyState").innerHTML =
    '<div class="spinner" aria-label="Loading"></div><div class="big">Fetching the page…</div>';
}

function showFetchFallback(url, reason) {
  frame.style.display = "none";
  $("emptyState").style.display = "flex";
  $("emptyState").innerHTML =
    '<div class="big">That page couldn\u2019t be fetched from here.</div>' +
    '<div class="steps">' +
    esc(reason) +
    " You can still mark it up: open the page in another tab, view its source (Ctrl/Cmd+U), copy everything, and paste it below.</div>" +
    '<div class="row" style="margin-top:6px"><button class="primary" id="retryFetch">Try again</button></div>' +
    '<div class="paste-fallback">' +
    '<textarea id="pasteHtml" placeholder="Paste the page\u2019s full HTML here…" aria-label="Page HTML"></textarea>' +
    '<div class="row"><button class="primary" id="pasteGo">Render pasted HTML</button></div>' +
    "</div>";
  $("retryFetch").onclick = () => loadUrl(url);
  $("pasteGo").onclick = () => {
    const html = $("pasteHtml").value;
    if (!html.trim()) {
      toast("Paste the page HTML first");
      return;
    }
    renderHtml(html, url || "pasted-page");
  };
}

let loadSeq = 0; // stale in-flight loads must not clobber a newer one
const pageCache = new Map(); // url -> html, so revisits are instant

/* Proxies can return 200 OK with a rate-limit/error body instead of the
   page. Rendering (and especially caching) that shows a blank viewport
   for the rest of the session — reject anything that doesn't look like
   a real document so the next proxy gets tried instead. */
function looksLikeRealPage(html) {
  return (
    !!html &&
    html.length > 2000 &&
    /<(!doctype|html|head|body)[\s>]/i.test(html.slice(0, 3000))
  );
}

// Try a direct fetch first (works if the target site sends CORS headers),
// then proxies; `rounds` full passes with a pause between them so a
// transient proxy rate limit gets a chance to clear. Returns validated
// page HTML or null.
async function fetchPageHtml(url, rounds = 1) {
  const attempts = [(u) => u, ...PROXIES];
  for (let round = 0; round < rounds; round++) {
    if (round) await new Promise((r) => setTimeout(r, 1700));
    for (const make of attempts) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 12000);
        const resp = await fetch(make(url), { signal: ctl.signal });
        clearTimeout(timer);
        if (!resp.ok) continue;
        const html = await resp.text();
        if (looksLikeRealPage(html)) return html;
      } catch (e) {
        /* try next */
      }
    }
  }
  return null;
}

/* The dropdown's option text is a display label, not the source of
   truth — the live page's own <title> is. Every time we fetch a page
   we sync the label to it so a title change on the site (or a stale
   hand-typed label here) never lingers. The homepage's <title> is SEO
   copy, not a page name, so it keeps the "Home" label instead. */
function deriveTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = m[1]
    .replace(/\s+/g, " ")
    .replace(/\s*[—-]\s*(The\s+)?MammaCare Foundation\s*$/i, "")
    .trim();
  return t || null;
}
function syncOptionLabel(url, html) {
  if (/\/index\.html$/i.test(url)) return; // "Home" stays "Home"
  const title = deriveTitle(html);
  if (!title) return;
  const p = pages.find((x) => x.url === url);
  if (p && p.title !== title) {
    p.title = title; // session-only; the dev's stored title is untouched
    renderPageOptions(); // rebuilds labels, including the open-count prefix
  }
}

async function loadUrl(directUrl) {
  const url =
    typeof directUrl === "string" ? directUrl : $("urlInput").value;
  if (!url) {
    toast("Choose a page first");
    return;
  }
  $("urlInput").value = url; // no-op if url isn't a listed page
  const seq = ++loadSeq;

  if (pageCache.has(url)) {
    renderHtml(pageCache.get(url), url);
    return;
  }

  showLoading();
  userLoadBusy = true;
  let html;
  try {
    html = await fetchPageHtml(url, 4);
  } finally {
    userLoadBusy = false;
  }
  if (seq !== loadSeq) return; // a newer load took over
  if (html) {
    pageCache.set(url, html);
    syncOptionLabel(url, html);
    renderHtml(html, url);
    return;
  }
  showFetchFallback(
    url,
    "The site refused the request or the fetch proxies were blocked.",
  );
}
$("urlInput").addEventListener("change", () => {
  pendingGoto = null; // manual page choice cancels any queued jump
  loadUrl();
});

/* Refetches every page from the live site, bypassing pageCache, so
   edits published since sign-in show up. The page on screen goes
   first (and re-renders as soon as it lands) so the visible result
   feels immediate; the rest refresh in the background. */
async function refreshAllPages() {
  const btn = $("refreshPagesBtn");
  const urls = pages.map((p) => p.url);
  const ordered = currentUrl
    ? [currentUrl, ...urls.filter((u) => u !== currentUrl)]
    : urls;
  if (!ordered.length) return;

  btn.disabled = true;
  btn.textContent = "Refreshing…";
  userLoadBusy = true;
  const seq = ++loadSeq; // invalidate any in-flight loadUrl for currentUrl
  if (currentUrl) showLoading();
  let failures = 0;
  try {
    for (const u of ordered) {
      const html = await fetchPageHtml(u, 2);
      if (html) {
        pageCache.set(u, html);
        syncOptionLabel(u, html);
        if (u === currentUrl && seq === loadSeq) renderHtml(html, u);
      } else {
        failures++;
        if (u === currentUrl && seq === loadSeq)
          showFetchFallback(
            u,
            "The site refused the request or the fetch proxies were blocked.",
          );
      }
    }
  } finally {
    userLoadBusy = false;
    btn.disabled = false;
    btn.textContent = "Refresh pages";
  }
  toast(
    failures
      ? `Refreshed with ${failures} page${failures === 1 ? "" : "s"} unreachable`
      : "All pages refreshed with the latest live content",
  );
}
$("refreshPagesBtn").onclick = refreshAllPages;

/* Warm the cache for every page in the dropdown so switching pages
   (and jumping to a request's page) never depends on the network or
   on flaky CORS proxies mid-session. Staggered to avoid proxy rate
   limits; runs once per session after sign-in. */
let prefetchStarted = false;
let userLoadBusy = false; // prefetch yields to user-initiated loads
async function prefetchPages() {
  if (prefetchStarted) return;
  prefetchStarted = true;
  const urls = pages.map((p) => p.url);
  for (const u of urls) {
    while (userLoadBusy) await new Promise((r) => setTimeout(r, 300));
    if (!pageCache.has(u)) {
      const html = await fetchPageHtml(u);
      if (html) {
        pageCache.set(u, html);
        syncOptionLabel(u, html);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function renderHtml(rawHtml, url) {
  let docParsed;
  try {
    docParsed = new DOMParser().parseFromString(rawHtml, "text/html");
  } catch (e) {
    showFetchFallback(url, "The HTML couldn\u2019t be parsed.");
    return;
  }

  /* Left-click interacts with the page, so its own scripts must run:
     keep every inline script, the site's own external scripts, and
     known chart/animation libraries. Strip other third-party scripts
     (analytics etc.) and <noscript>. Navigation is still blocked by
     the inspector's link/submit interception and the meta-refresh
     removal below. */
  const LIB_SRC =
    /chart(\.umd|\.min)?\.js|chartjs|\bd3\b|highcharts|echarts|plotly|leaflet|apexcharts|gsap/i;
  docParsed.querySelectorAll("script, noscript").forEach((n) => {
    if (n.tagName === "SCRIPT") {
      const src = n.getAttribute("src") || "";
      if (!src) return; // inline: the page's own UI wiring
      if (LIB_SRC.test(src)) return;
      try {
        if (new URL(src, url).origin === new URL(url).origin) return;
      } catch (e) {
        /* unparseable src — strip it */
      }
    }
    n.remove();
  });
  docParsed.querySelectorAll("meta[http-equiv]").forEach((m) => {
    if (/refresh/i.test(m.getAttribute("http-equiv") || "")) m.remove();
  });
  if (/^https?:\/\//i.test(url) && !docParsed.querySelector("base")) {
    const base = docParsed.createElement("base");
    base.href = url;
    docParsed.head
      ? docParsed.head.prepend(base)
      : docParsed.documentElement.prepend(base);
  }
  /* Safety net: if a page hides content pending an entrance animation
     whose trigger didn't survive (or never fires inside the sandbox),
     force it visible and settled. */
  const noAnim = docParsed.createElement("style");
  noAnim.textContent = `
    /* Zero out entrance animations, but leave carousel/slider/marquee
       elements alone so they keep rotating */
    *:not([class*="carousel"], [class*="slide"], [class*="marquee"], [class*="ticker"], [data-alt-src]),
    *:not([class*="carousel"], [class*="slide"], [class*="marquee"], [class*="ticker"], [data-alt-src])::before,
    *:not([class*="carousel"], [class*="slide"], [class*="marquee"], [class*="ticker"], [data-alt-src])::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      animation-play-state: running !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      scroll-behavior: auto !important;
    }
    /* Common scroll/entrance-animation libraries and conventions that
       hide elements until a script reveals them */
    [data-aos], .aos-init, .aos-animate,
    [data-sal], [data-scroll], [data-animate], [data-reveal],
    [data-w-id],
    .wow, .animate__animated, .animated,
    .fade-in, .fade-up, .fadeIn, .fade,
    .reveal, .is-hidden-until-reveal,
    .lazyload, .lazyloading {
      opacity: 1 !important;
      visibility: visible !important;
      transform: none !important;
      filter: none !important;
      clip-path: none !important;
    }
  `;
  (docParsed.head || docParsed.documentElement).appendChild(noAnim);

  const sc = docParsed.createElement("script");
  sc.textContent = INSPECTOR;
  (docParsed.body || docParsed.documentElement).appendChild(sc);

  frameReady = false;
  currentUrl = url;
  picked = null;
  frame.srcdoc = "<!DOCTYPE html>" + docParsed.documentElement.outerHTML;
  frame.style.display = "block";
  $("emptyState").style.display = "none";
  $("modeNote").style.display = "flex";
  render();
}

/* ---------------- messages from iframe ---------------- */
window.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "rl-ready") {
    frameReady = true;
    sendPins();
    if (pendingGoto) {
      const target = pendingGoto;
      pendingGoto = null;
      // let images/charts settle so the scroll position holds
      setTimeout(() => gotoElement(target), 400);
    }
  }
  if (d.type === "rl-pick") {
    picked = { selector: d.selector, tag: d.tag, text: d.text };
    render();
    const ta = document.querySelector("#composerSlot textarea");
    if (ta) ta.focus();
  }
});

function sendPins() {
  if (!frameReady || !currentUrl) return;
  const pins = requests
    .filter((r) => r.url === currentUrl)
    .map((r) => ({
      selector: r.selector,
      num: r.num,
      status: r.status,
      tag: r.tag,
      elementText: r.elementText,
    }));
  frame.contentWindow.postMessage({ type: "rl-pins", pins }, "*");
}
function gotoElement(selector) {
  if (frameReady)
    frame.contentWindow.postMessage({ type: "rl-goto", selector }, "*");
}

/* ---------------- filters ---------------- */
function setFilter(scope) {
  if (scope) filter.scope = scope;
  $("filterPage").classList.toggle("active", filter.scope === "page");
  $("filterAll").classList.toggle("active", filter.scope === "all");
  render();
}
$("filterPage").onclick = () => setFilter("page");
$("filterAll").onclick = () => setFilter("all");

/* ---------------- rendering ---------------- */
/* Card actions are delegated: onSnapshot re-renders replace the card
   elements at any moment, so per-card handlers can go stale and
   silently swallow clicks. The listener on the list itself survives. */
$("reqList").addEventListener("click", (e) => {
  const sel = e.target.closest("[data-goto]");
  if (sel) {
    const u = sel.getAttribute("data-url");
    if (u === currentUrl) {
      gotoElement(sel.getAttribute("data-goto"));
    } else {
      // Jump to the element once the new page has rendered
      pendingGoto = sel.getAttribute("data-goto");
      loadUrl(u);
    }
    return;
  }
  const statusBtn = e.target.closest("[data-status]");
  if (statusBtn) {
    toggleStatus(statusBtn.getAttribute("data-status"));
    return;
  }
  const closeBtn = e.target.closest("[data-close]");
  if (closeBtn) {
    toggleClosed(closeBtn.getAttribute("data-close"));
    return;
  }
  const sendBtn = e.target.closest("[data-send]");
  if (sendBtn) {
    const id = sendBtn.getAttribute("data-send");
    addReply(id, $("reqList").querySelector(`[data-reply="${id}"]`));
  }
});
$("reqList").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const inp = e.target.closest("[data-reply]");
  if (inp) addReply(inp.getAttribute("data-reply"), inp);
});

function composerHtml() {
  if (!picked) return "";
  return `
    <div class="composer">
<div class="picked">
  <span class="tag">&lt;${esc(picked.tag)}&gt;</span>
  <span class="txt">${esc(picked.text) || "<i>no text in this element</i>"}</span>
</div>
<label for="cProposed">Change the text to</label>
<textarea id="cProposed" placeholder="Write the exact copy you want here…"></textarea>
<label for="cNote">Note for the developer</label>
<textarea id="cNote" placeholder="Anything else — tone, links, styling…"></textarea>
<div class="actions">
  <button class="cancel" id="cCancel">Cancel</button>
  <button class="submit" id="cSubmit">Send request</button>
</div>
    </div>`;
}

function cardHtml(r) {
  const replies = (r.replies || [])
    .map(
      (rep) => `
    <div class="msg ${rep.role === "dev" ? "dev" : "owner"}">
<div class="author">${esc(rep.author)} <span class="when">${fmtWhen(rep.createdAt)}</span></div>
<div>${esc(rep.text)}</div>
    </div>`,
    )
    .join("");
  return `
    <div class="card ${r.status}" data-id="${r.id}">
<div class="top">
  <span class="pin-badge" style="${r.status === "done" ? "background:var(--green)" : r.status === "closed" ? "background:var(--muted)" : ""}">${r.num}</span>
  <div class="meta">
    <div class="sel" data-goto="${esc(r.selector)}" data-url="${esc(r.url)}" title="Show on page">${esc(r.selector)}</div>
    <div class="page">${esc(pageTitle(r.url))}</div>
  </div>
  <button class="status-btn ${r.status === "done" ? "done" : ""}" data-status="${r.id}">${r.status === "done" ? "Done" : "Mark done"}</button>
  <button class="status-btn ${r.status === "closed" ? "closed" : ""}" data-close="${r.id}" title="Close without marking done">${r.status === "closed" ? "Closed" : "Close"}</button>
</div>
${r.elementText ? `<div class="orig">${esc(r.elementText)}</div>` : ""}
<div class="msg ${r.role === "dev" ? "dev" : "owner"}">
  <div class="author">${esc(r.author)} <span class="when">${fmtWhen(r.createdAt)}</span></div>
  ${r.proposed ? `<div class="change-label">Change to</div><div>${esc(r.proposed)}</div>` : ""}
  ${r.note ? `<div style="${r.proposed ? "margin-top:6px;" : ""}">${esc(r.note)}</div>` : ""}
</div>
${replies}
<div class="reply-row">
  <input placeholder="Reply…" data-reply="${r.id}" maxlength="1000" aria-label="Reply to request ${r.num}">
  <button data-send="${r.id}">Reply</button>
</div>
    </div>`;
}

function render() {
  /* Firestore snapshots re-render at any moment (e.g. when someone
     else files a request). Rebuilding the composer would wipe what
     this user is typing — only rebuild it when the picked element
     actually changed. */
  const slot = $("composerSlot");
  const composerKey = picked ? picked.selector + " " + picked.tag : "";
  if (slot.dataset.key !== composerKey) {
    slot.innerHTML = composerHtml();
    slot.dataset.key = composerKey;
    if (picked) {
      $("cSubmit").onclick = submitRequest;
      $("cCancel").onclick = () => {
        picked = null;
        render();
      };
    }
  }

  let list = requests.filter((r) => r.status === "open");
  if (filter.scope === "page") {
    list = currentUrl ? list.filter((r) => r.url === currentUrl) : [];
  }

  $("reqCount").textContent = list.length;
  const holder = $("reqList");

  /* Rebuilding the cards wipes half-typed replies \u2014 save their text
     (and which one has focus) and restore after. */
  const replyDrafts = {};
  holder.querySelectorAll("[data-reply]").forEach((inp) => {
    if (inp.value)
      replyDrafts[inp.getAttribute("data-reply")] = inp.value;
  });
  const focused = document.activeElement;
  const focusedReply =
    focused && focused.matches && focused.matches("[data-reply]")
      ? {
          id: focused.getAttribute("data-reply"),
          pos: focused.selectionStart,
        }
      : null;

  if (!list.length) {
    holder.innerHTML = `<div class="req-empty">${
      filter.scope === "page"
        ? currentUrl
          ? "No open requests on this page." +
            (document.body.dataset.role === "owner"
              ? " Click any element on the left to start one."
              : "")
          : "Load a page to see its requests, or switch to \u201cAll pages\u201d."
        : "No open change requests. Done and closed ones show on the landing screen."
    }</div>`;
  } else {
    holder.innerHTML = list.map(cardHtml).join("");
  }

  Object.entries(replyDrafts).forEach(([id, val]) => {
    const inp = holder.querySelector(`[data-reply="${id}"]`);
    if (inp) inp.value = val;
  });
  if (focusedReply) {
    const inp = holder.querySelector(`[data-reply="${focusedReply.id}"]`);
    if (inp) {
      inp.focus();
      inp.setSelectionRange(focusedReply.pos, focusedReply.pos);
    }
  }

  $("modePill").textContent =
    me.role === "dev" ? "Review mode" : "Markup mode";
  $("modeNoteText").textContent =
    me.role === "dev"
      ? "Left-click uses the page. Right-click an element to file a request, or click a request’s selector to jump to it."
      : "Left-click uses the page. Right-click an element to request a change. Links won’t navigate.";

  renderPageOptions();
  renderLandingHistory();
}

/* Done/closed requests never show in the working list on the right —
   they surface here instead, on the landing screen shown before a
   page is chosen. Only meaningful while that screen is up, so this
   no-ops once a page has loaded and #landingHistory no longer exists. */
function renderLandingHistory() {
  const holder = $("landingHistory");
  if (!holder) return;
  const items = requests
    .filter((r) => r.status === "done" || r.status === "closed")
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!items.length) {
    holder.style.display = "none";
    holder.innerHTML = "";
    return;
  }
  holder.style.display = "block";
  holder.innerHTML = `
    <div class="lh-head">Done &amp; closed (${items.length})</div>
    <div class="lh-list">${items.map(landingHistoryItemHtml).join("")}</div>
  `;
}

function landingHistoryItemHtml(r) {
  return `
    <div class="lh-item">
<span class="lh-badge ${r.status}">${r.status === "done" ? "Done" : "Closed"}</span>
<div class="lh-body">
  <div class="lh-title">#${r.num} · ${esc(pageTitle(r.url))}</div>
  <div class="lh-text">${esc(r.proposed || r.note || r.elementText || "")}</div>
</div>
    </div>`;
}
