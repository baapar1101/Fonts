"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const fa = (n) => Number(n || 0).toLocaleString("fa-IR");

function relativeTime(timestamp) {
  if (!timestamp) return "—";
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

let users = [], fonts = [], requests = [], queue = [];
let userFilter = "all";
let fontFilter = "all";
let requestFilter = "all";

const labels = {
  approved: "تأییدشده",
  pending: "در انتظار بررسی",
  suspended: "حساب غیرفعال",
  reviewing: "در حال بررسی",
  completed: "انجام‌شده",
  rejected: "ردشده",
};

function summary() {
  const pendingUsers = users.filter((x) => x.status === "pending").length;
  const openRequests = requests.filter((x) => ["pending", "reviewing"].includes(x.status)).length;

  $("#userCount").textContent = fa(users.length);
  $("#pendingCount").textContent = fa(pendingUsers);
  $("#fontCount").textContent = fa(fonts.length);
  $("#requestCount").textContent = fa(openRequests);

  // Update sidebar alerts
  const userBadge = $("#pendingUsersBadge");
  if (userBadge) {
    userBadge.style.display = pendingUsers > 0 ? "inline-block" : "none";
    userBadge.textContent = fa(pendingUsers);
  }

  const reqBadge = $("#requestsNavBadge");
  if (reqBadge) {
    reqBadge.textContent = fa(openRequests);
  }

  const fontsBadge = $("#fontsNavBadge");
  if (fontsBadge) {
    fontsBadge.textContent = fa(fonts.length);
  }
}

function renderUsers() {
  const q = $("#userSearch").value.trim().toLowerCase();
  const list = users.filter((x) => {
    const matchSearch = !q || x.phone.toLowerCase().includes(q);
    const matchFilter = userFilter === "all" ? true : x.status === userFilter;
    return matchSearch && matchFilter;
  });

  if (!list.length) {
    $("#users").innerHTML = `
      <div class="empty-box">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        </div>
        <strong>کاربری با این مشخصات یافت نشد</strong>
      </div>`;
    return;
  }

  $("#users").innerHTML = list.map((x) => `
    <div class="row">
      <div class="row-start">
        <div class="activity-icon-badge" style="background: ${x.admin ? 'rgba(245, 158, 11, 0.15)' : 'rgba(59, 102, 255, 0.1)'}; color: ${x.admin ? '#f59e0b' : '#3b66ff'};">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            ${x.admin 
              ? '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
              : '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'}
          </svg>
        </div>
        <div class="row-main">
          <div class="row-title">
            <span dir="ltr">${esc(x.phone)}</span>
            ${x.admin ? '<span class="pill" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">مدیر ارشد</span>' : ''}
          </div>
          <div class="row-meta">
            <span>ثبت‌نام: ${relativeTime(x.created_at)}</span>
            <span>•</span>
            <span>${fa(x.likes)} علاقه‌مندی</span>
            <span>•</span>
            <span>${fa(x.collections)} مجموعه</span>
          </div>
        </div>
      </div>
      <div class="row-actions">
        <span class="pill ${x.status}">
          <span class="pill-dot"></span>
          <span>${labels[x.status] || x.status}</span>
        </span>
        ${x.admin ? "" : x.status !== "approved" ? `
          <button class="btn mini ok" data-user="${x.id}" data-status="approved" type="button">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>تأیید عضویت</span>
          </button>
        ` : `
          <button class="btn mini danger" data-user="${x.id}" data-status="suspended" type="button">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            <span>تعلیق حساب</span>
          </button>
        `}
      </div>
    </div>
  `).join("");
}

function renderFonts() {
  const q = $("#fontSearch").value.trim().toLowerCase();
  const list = fonts.filter((x) => {
    const matchSearch = !q || (x.family + " " + x.slug).toLowerCase().includes(q);
    const matchFilter = fontFilter === "all" ? true : fontFilter === "visible" ? !x.hidden : x.hidden;
    return matchSearch && matchFilter;
  });

  if (!list.length) {
    $("#fonts").innerHTML = `
      <div class="empty-box">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>
        </div>
        <strong>فونتی پیدا نشد</strong>
      </div>`;
    return;
  }

  $("#fonts").innerHTML = list.map((x) => `
    <div class="row">
      <div class="row-start">
        <div class="activity-icon-badge" style="background: ${x.hidden ? 'var(--red-soft)' : 'var(--blue-soft)'}; color: ${x.hidden ? 'var(--red)' : 'var(--blue)'};">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>
        </div>
        <div class="row-main">
          <div class="row-title">
            <a href="/?q=${encodeURIComponent(x.slug)}" target="_blank" title="مشاهده پیش‌نمایش در کتابخانه">${esc(x.family)}</a>
            <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-faint);">(${esc(x.slug)})</span>
          </div>
          <div class="row-meta">
            <span><strong>${fa(x.variants)}</strong> وزن</span>
            <span>•</span>
            <span><strong>${fa(x.files)}</strong> فایل</span>
            <span>•</span>
            <span>${(x.languages || []).map((l) => `<code style="padding:1px 5px; border-radius:4px; background:rgba(255,255,255,0.06);">${esc(l)}</code>`).join(" ")}</span>
          </div>
        </div>
      </div>
      <div class="row-actions">
        <span class="pill ${x.hidden ? 'suspended' : 'approved'}">
          <span class="pill-dot"></span>
          <span>${x.hidden ? 'مخفی‌شده' : 'نمایش در کتابخانه'}</span>
        </span>
        <button class="btn mini ${x.hidden ? 'ok' : 'danger'}" data-font="${encodeURIComponent(x.slug)}" data-hidden="${!x.hidden}" type="button">
          ${x.hidden 
            ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span>نمایش مجدد</span>'
            : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg><span>مخفی‌سازی</span>'}
        </button>
      </div>
    </div>
  `).join("");
}

function renderRequests() {
  const list = requests.filter((x) =>
    requestFilter === "all" ? true : x.status === requestFilter
  );

  if (!list.length) {
    $("#requests").innerHTML = `
      <div class="empty-box">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <strong>درخواستی در این وضعیت ثبت نشده است</strong>
      </div>`;
    return;
  }

  $("#requests").innerHTML = list.map((x) => `
    <div class="row">
      <div class="row-start">
        <div class="activity-icon-badge" style="background: var(--blue-soft); color: var(--blue);">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div class="row-main">
          <div class="row-title">
            <strong>${esc(x.font_name)}</strong>
            <button class="btn mini" style="padding: 2px 7px; font-size: 11px;" onclick="navigator.clipboard.writeText('${esc(x.phone)}'); showToast('شماره کاربر کپی شد');" title="کپی شماره">
              <span dir="ltr">${esc(x.phone)}</span>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
          <div class="row-meta">
            <span>${esc(x.details || "بدون توضیحات")}</span>
            <span>•</span>
            <span title="${formatDateTime(x.created_at)}">ارسال: ${relativeTime(x.created_at)}</span>
          </div>
        </div>
      </div>
      <div class="row-actions">
        <span class="pill ${x.status}">
          <span class="pill-dot"></span>
          <span>${labels[x.status] || x.status}</span>
        </span>
        <select class="field mini" data-request="${x.id}" style="width: auto; padding: 6px 10px;">
          <option value="pending" ${x.status === "pending" ? "selected" : ""}>در انتظار</option>
          <option value="reviewing" ${x.status === "reviewing" ? "selected" : ""}>در حال بررسی</option>
          <option value="completed" ${x.status === "completed" ? "selected" : ""}>انجام‌شده</option>
          <option value="rejected" ${x.status === "rejected" ? "selected" : ""}>ردشده</option>
        </select>
      </div>
    </div>
  `).join("");
}

async function load() {
  try {
    const me = await api("/api/me");
    if (!me.user?.admin) {
      location.href = "/";
      return;
    }
    $("#phone").textContent = me.user.phone;

    const out = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/fonts"),
      api("/api/admin/requests"),
    ]);

    users = out[0].users;
    fonts = out[1].fonts;
    requests = out[2].requests;

    summary();
    renderUsers();
    renderFonts();
    renderRequests();
  } catch (err) {
    location.href = "/";
  }
}

// Persian date
try {
  $("#todayDate").textContent = new Intl.DateTimeFormat("fa-IR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
} catch {}

// Tab switching
function switchView(viewName) {
  $$("[data-view]").forEach((x) => x.classList.toggle("active", x.dataset.view === viewName));
  $$("[data-panel]").forEach((x) => x.classList.toggle("active", x.dataset.panel === viewName));

  const titles = {
    users: { title: "مدیریت کاربران و دسترسی‌ها", sub: "نظارت بر ثبت‌نام‌ها، تأیید عضویت یا غیرفعال‌سازی حساب‌های کاربری" },
    fonts: { title: "کنترل کتابخانه فونت‌ها", sub: "مدیریت نمایش، مخفی‌سازی و بررسی پوشش فایل‌های خانواده‌های قلم" },
    requests: { title: "درخواست‌های قلم اعضا", sub: "پیگیری، بررسی و تغییر وضعیت نیازمندی‌های فونت کاربران" },
    upload: { title: "افزودن و پردازش فونت", sub: "بارگذاری مستقیم فایل‌های فونت جهت استخراج خودکار و الحاق به کتابخانه" },
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

// Filters
$("#userSearch").oninput = renderUsers;
$("#fontSearch").oninput = renderFonts;

$$("#userStatusFilters .filter-btn").forEach((btn) => {
  btn.onclick = () => {
    $$("#userStatusFilters .filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    userFilter = btn.dataset.filter;
    renderUsers();
  };
});

$$("#fontVisibilityFilters .filter-btn").forEach((btn) => {
  btn.onclick = () => {
    $$("#fontVisibilityFilters .filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    fontFilter = btn.dataset.filter;
    renderFonts();
  };
});

$$("#requestStatusFilters .filter-btn").forEach((btn) => {
  btn.onclick = () => {
    $$("#requestStatusFilters .filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    requestFilter = btn.dataset.filter;
    renderRequests();
  };
});

// User action handler
$("#users").onclick = async (e) => {
  const b = e.target.closest("[data-user]");
  if (!b) return;
  b.disabled = true;
  try {
    await api(`/api/admin/users/${b.dataset.user}`, {
      method: "PATCH",
      body: JSON.stringify({ status: b.dataset.status }),
    });
    showToast(b.dataset.status === "approved" ? "عضویت کاربر تأیید شد و پیامک ارسال گردید" : "دسترسی کاربر غیرفعال شد", "ok");
    await load();
  } catch (err) {
    showToast(err.message, "error");
    b.disabled = false;
  }
};

// Font visibility toggle
$("#fonts").onclick = async (e) => {
  const b = e.target.closest("[data-font]");
  if (!b) return;
  b.disabled = true;
  const isHiding = b.dataset.hidden === "true";
  try {
    await api(`/api/admin/fonts/${b.dataset.font}`, {
      method: "PATCH",
      body: JSON.stringify({ hidden: isHiding }),
    });
    showToast(isHiding ? "فونت از دید کاربران مخفی شد" : "فونت در کتابخانه نمایان شد", "ok");
    await load();
  } catch (err) {
    showToast(err.message, "error");
    b.disabled = false;
  }
};

// Request status change
$("#requests").onchange = async (e) => {
  const s = e.target.closest("[data-request]");
  if (!s) return;
  s.disabled = true;
  try {
    await api(`/api/admin/requests/${s.dataset.request}`, {
      method: "PATCH",
      body: JSON.stringify({ status: s.value }),
    });
    showToast("وضعیت درخواست با موفقیت به‌روزرسانی شد", "ok");
    await load();
  } catch (err) {
    showToast(err.message, "error");
    s.disabled = false;
  }
};

// Drag and Drop & Upload Management
const filesInput = $("#files");
const dropZone = $("#dropZone");

function updateQueueUI() {
  const queueSection = $("#queueSection");
  const queueStats = $("#queueStats");
  const fileList = $("#fileList");
  const uploadBtn = $("#upload");

  if (!queue.length) {
    queueSection.style.display = "none";
    $("#dropText").textContent = "فایل‌های فونت را به این کادر بکشید یا برای انتخاب کلیک کنید";
    uploadBtn.disabled = true;
    return;
  }

  queueSection.style.display = "block";
  const totalBytes = queue.reduce((sum, f) => sum + f.size, 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  queueStats.textContent = `${fa(queue.length)} فایل (${totalMB} مگابایت)`;
  $("#dropText").textContent = `${fa(queue.length)} فایل انتخاب شده آماده ارسال است`;
  uploadBtn.disabled = false;

  fileList.innerHTML = queue.map((f, idx) => {
    const ext = f.name.split(".").pop().toUpperCase();
    return `
      <li class="upload-queue-item">
        <div class="file-name">
          <span class="format-chip">${ext}</span>
          <span>${esc(f.name)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="file-size">${(f.size / 1024).toFixed(1)} KB</span>
          <button type="button" class="btn mini danger" data-remove="${idx}" style="padding:2px 6px;">حذف</button>
        </div>
      </li>
    `;
  }).join("");
}

function handleSelectedFiles(fileArray) {
  const valid = [...fileArray].filter((f) => /\.(ttf|otf|woff2?)$/i.test(f.name));
  if (!valid.length) {
    showToast("لطفاً فقط فایل‌های معتبر فونت (.ttf, .otf, .woff, .woff2) انتخاب کنید.", "error");
    return;
  }
  queue = [...queue, ...valid];
  updateQueueUI();
}

filesInput.onchange = () => handleSelectedFiles(filesInput.files);

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files) {
    handleSelectedFiles(e.dataTransfer.files);
  }
});

// Remove item from upload queue
$("#fileList").onclick = (e) => {
  const b = e.target.closest("[data-remove]");
  if (!b) return;
  const idx = Number(b.dataset.remove);
  queue.splice(idx, 1);
  updateQueueUI();
};

const b64 = (f) =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]);
    r.onerror = no;
    r.readAsDataURL(f);
  });

$("#upload").onclick = async () => {
  const btn = $("#upload");
  const msg = $("#uploadMsg");
  btn.disabled = true;
  msg.className = "notice show";
  msg.textContent = "در حال کدگذاری، ارسال و پردازش فونت‌ها با خط لوله پایتون… لطفاً شکیبا باشید.";

  try {
    const payload = [];
    for (const f of queue) {
      payload.push({ name: f.name, data: await b64(f) });
    }
    const r = await api("/api/admin/upload", {
      method: "POST",
      body: JSON.stringify({ folder: $("#batch").value, files: payload }),
    });

    msg.className = "notice show ok";
    msg.textContent = `${fa(r.added || queue.length)} فایل فونت با موفقیت پردازش و به کتابخانه اضافه شد.`;
    showToast(`${fa(r.added || queue.length)} فونت به کتابخانه افزوده شد!`, "ok");
    queue = [];
    filesInput.value = "";
    updateQueueUI();
    await load();
  } catch (err) {
    msg.className = "notice show error";
    msg.textContent = err.message;
    showToast(err.message, "error");
    btn.disabled = false;
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

// Responsive mobile drawer
$("#menu").onclick = () => $("#side").classList.toggle("open");
const backdrop = $("#sideBackdrop");
if (backdrop) {
  backdrop.onclick = () => $("#side").classList.remove("open");
}

load();
