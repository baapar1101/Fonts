"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const fa = (n) => Number(n || 0).toLocaleString("fa-IR");

function relativeTime(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "چند لحظه پیش";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${fa(min)} دقیقه پیش`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${fa(hr)} ساعت پیش`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${fa(days)} روز پیش`;
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(timestamp));
}

const formatDateTime = (n) =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(n));

function esc(s) {
  const e = document.createElement("span");
  e.textContent = s || "";
  return e.innerHTML;
}

function showToast(text, type = "ok") {
  const container = $("#toasts");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
      ${type === "ok" 
        ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' 
        : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
    </svg>
    <span>${esc(text)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

async function api(path, opt = {}) {
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: opt.body ? { "Content-Type": "application/json" } : {},
    ...opt,
  });
  let d = {};
  try {
    d = await r.json();
  } catch {}
  if (!r.ok) throw new Error(d.error || "خطا در ارتباط با سرور");
  return d;
}

let dashboardData = null;
let userData = null;
let currentActivityFilter = "all";

function activityRows(items) {
  if (!items || !items.length) {
    return `
      <div class="empty-box">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <strong>هنوز فعالیتی ثبت نشده است</strong>
        <p>فونت‌های کتابخانه را مشاهده یا دانلود کنید تا تاریخچه فعالیت‌های شما در اینجا ثبت شود.</p>
      </div>`;
  }

  return items.map((x) => {
    const isDownload = x.kind === "download";
    return `
      <div class="row">
        <div class="row-start">
          <div class="activity-icon-badge ${x.kind}">
            ${isDownload 
              ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
              : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
            }
          </div>
          <div class="row-main">
            <div class="row-title">
              <a href="/?q=${encodeURIComponent(x.slug || x.family)}" title="مشاهده قلم در کتابخانه">${esc(x.family)}</a>
            </div>
            <div class="row-meta">
              <span>${isDownload ? "دانلود بسته فونت" : "مشاهده جزئیات قلم"}</span>
              <span>•</span>
              <span title="${formatDateTime(x.created_at)}">${relativeTime(x.created_at)}</span>
            </div>
          </div>
        </div>
        <div class="row-actions">
          <a href="/?q=${encodeURIComponent(x.slug || x.family)}" class="btn mini">پیش‌نمایش</a>
        </div>
      </div>
    `;
  }).join("");
}

function renderLikes(slugs) {
  const container = $("#likesList");
  if (!container) return;
  const q = ($("#likesSearch")?.value || "").trim().toLowerCase();
  const filtered = (slugs || []).filter((s) => !q || s.toLowerCase().includes(q));

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-box">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </div>
        <strong>هنوز فونتی را نشان نکرده‌اید</strong>
        <p>در صفحه کتابخانه با کلیک بر روی آیکون قلب، فونت‌های محبوب خود را برای دسترسی سریع به این بخش بیفزایید.</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map((slug) => `
    <div class="row">
      <div class="row-start">
        <div class="activity-icon-badge" style="background: var(--red-soft); color: var(--red);">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </div>
        <div class="row-main">
          <div class="row-title">
            <a href="/?q=${encodeURIComponent(slug)}">${esc(slug)}</a>
          </div>
          <div class="row-meta">
            <span>نشان‌شده در حساب کاربری شما</span>
          </div>
        </div>
      </div>
      <div class="row-actions">
        <a href="/?q=${encodeURIComponent(slug)}" class="btn mini">مشاهده در کتابخانه</a>
      </div>
    </div>
  `).join("");
}

function renderCollections(cols) {
  const container = $("#collectionsList");
  if (!container) return;
  if (!cols || !cols.length) {
    container.innerHTML = `
      <div class="empty-box">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <strong>مجموعه‌ای ایجاد نشده است</strong>
        <p>در صفحه اصلی کتابخانه می‌توانید فونت‌ها را در پوشه‌ها و کالکشن‌های اختصاصی دسته‌بندی کنید.</p>
      </div>`;
    return;
  }

  container.innerHTML = cols.map((col) => `
    <div class="row">
      <div class="row-start">
        <div class="activity-icon-badge" style="background: var(--purple-soft); color: var(--purple);">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="row-main">
          <div class="row-title">
            <strong>${esc(col.name)}</strong>
          </div>
          <div class="row-meta">
            <span>${fa(col.items?.length || 0)} قلم در این مجموعه</span>
          </div>
        </div>
      </div>
      <div class="row-actions">
        <a href="/" class="btn mini">مدیریت در کتابخانه</a>
      </div>
    </div>
  `).join("");
}

function requestsRows(items) {
  if (!items || !items.length) {
    return `
      <div class="empty-box">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <strong>هنوز درخواستی ثبت نکرده‌اید</strong>
        <p>از فرم بخش نمای کلی می‌توانید فونت دلخواهتان را برای اضافه شدن به کتابخانه درخواست دهید.</p>
      </div>`;
  }

  const labels = {
    pending: "در انتظار بررسی",
    reviewing: "در حال بررسی تیم",
    completed: "اضافه شده به کتابخانه",
    rejected: "عدم تایید",
  };

  return items.map((x) => `
    <div class="row">
      <div class="row-start">
        <div class="activity-icon-badge" style="background: var(--blue-soft); color: var(--blue);">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <div class="row-main">
          <div class="row-title">
            <strong>${esc(x.font_name)}</strong>
          </div>
          <div class="row-meta">
            <span>${esc(x.details || "بدون توضیحات تکمیلی")}</span>
            <span>•</span>
            <span title="${formatDateTime(x.created_at)}">ثبت: ${relativeTime(x.created_at)}</span>
          </div>
        </div>
      </div>
      <div class="row-actions">
        <span class="pill ${x.status}">
          <span class="pill-dot"></span>
          <span>${labels[x.status] || x.status}</span>
        </span>
      </div>
    </div>
  `).join("");
}

function filterAndRenderActivities() {
  if (!dashboardData) return;
  const filtered = dashboardData.activities.filter((x) =>
    currentActivityFilter === "all" ? true : x.kind === currentActivityFilter
  );
  $("#activity").innerHTML = activityRows(filtered);
}

async function load() {
  try {
    const [dash, me] = await Promise.all([api("/api/dashboard"), api("/api/me")]);
    dashboardData = dash;
    userData = me;

    // User profile
    $("#phone").textContent = dash.user.phone;
    if (me.user?.admin) {
      $("#roleText").textContent = "مدیر کل سیستم";
      const adminLink = $("#adminLink");
      if (adminLink) adminLink.style.display = "flex";
    }

    // Stats
    for (const k of ["views", "downloads", "likes", "collections"]) {
      const el = $("#" + k);
      if (el) el.textContent = fa(dash.counts[k]);
    }

    // Nav badges
    if ($("#likesNavBadge")) $("#likesNavBadge").textContent = fa(me.likes?.length || 0);
    if ($("#collectionsNavBadge")) $("#collectionsNavBadge").textContent = fa(me.collections?.length || 0);

    // Render panels
    $("#recent").innerHTML = activityRows(dash.activities.slice(0, 8));
    filterAndRenderActivities();
    renderLikes(me.likes || []);
    renderCollections(me.collections || []);
    $("#myRequests").innerHTML = requestsRows(dash.requests);
  } catch (err) {
    location.href = "/";
  }
}

// Set Persian Date in Topbar
try {
  $("#todayDate").textContent = new Intl.DateTimeFormat("fa-IR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
} catch {}

// Tab View Switcher
function switchView(viewName) {
  $$("[data-view]").forEach((x) => x.classList.toggle("active", x.dataset.view === viewName));
  $$("[data-panel]").forEach((x) => x.classList.toggle("active", x.dataset.panel === viewName));

  const titles = {
    overview: { title: "داشبورد کاربری", sub: "نمای جامع فعالیت‌ها، دانلودها، فونت‌های منتخب و پیگیری درخواست‌ها" },
    likes: { title: "فونت‌های نشان‌شده", sub: "دسترسی سریع به فونت‌های ستاره‌دار شده در کتابخانه" },
    collections: { title: "مجموعه‌های من", sub: "پوشه‌بندی‌های موضوعی برای پروژه‌های طراحی و وب" },
    activity: { title: "تاریخچه فعالیت", sub: "گزارش زمان‌بندی‌شده از تمامی تعاملات، بازدیدها و دانلودهای شما" },
    requests: { title: "درخواست‌های قلم", sub: "پیگیری وضعیت درخواست‌های افزودن فونت جدید" },
  };

  if (titles[viewName]) {
    $("#pageTitle").textContent = titles[viewName].title;
    $("#pageSubtitle").textContent = titles[viewName].sub;
  }

  $("#side").classList.remove("open");
}

$$("[data-view]").forEach((b) => {
  b.onclick = () => switchView(b.dataset.view);
});

$$("[data-switch-view]").forEach((b) => {
  b.onclick = () => switchView(b.dataset.switchView);
});

// Activity filter chips
$$("#activityFilters .filter-btn").forEach((btn) => {
  btn.onclick = () => {
    $$("#activityFilters .filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentActivityFilter = btn.dataset.filter;
    filterAndRenderActivities();
  };
});

// Likes search
const likesSearch = $("#likesSearch");
if (likesSearch) {
  likesSearch.oninput = () => renderLikes(userData?.likes || []);
}

// Request Form Submit
$("#requestForm").onsubmit = async (e) => {
  e.preventDefault();
  const msg = $("#requestMsg");
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    await api("/api/font-requests", {
      method: "POST",
      body: JSON.stringify({
        fontName: $("#fontName").value,
        details: $("#details").value,
      }),
    });
    msg.className = "notice show ok";
    msg.textContent = "درخواست شما با موفقیت ثبت شد و به زودی بررسی خواهد شد.";
    showToast("درخواست فونت جدید با موفقیت ثبت شد", "ok");
    e.target.reset();
    await load();
  } catch (err) {
    msg.className = "notice show error";
    msg.textContent = err.message;
    showToast(err.message, "error");
  } finally {
    submitBtn.disabled = false;
  }
};

// Logout
$("#logout").onclick = async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    location.href = "/";
  }
};

// Responsive mobile menu
$("#menu").onclick = () => $("#side").classList.toggle("open");
const backdrop = $("#sideBackdrop");
if (backdrop) {
  backdrop.onclick = () => $("#side").classList.remove("open");
}

load();
