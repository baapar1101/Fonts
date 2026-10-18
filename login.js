"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

async function api(path, opt = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: opt.body ? { "Content-Type": "application/json" } : {},
    ...opt,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const error = new Error(data.error || "خطا در ارتباط با سرور");
    error.pending = !!data.pending;
    error.retryAfter = data.retryAfter;
    throw error;
  }
  return data;
}

const params = new URLSearchParams(location.search);
const requested = params.get("return") || "/";
const destination = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

function message(text, type = "error") {
  const el = $("#message");
  if (!el) return;
  el.textContent = text;
  el.className = `message ${text ? "show " : ""}${type}`;
  if (type === "error" && text) {
    el.style.animation = "none";
    el.offsetHeight; // trigger reflow
    el.style.animation = "slideFadeIn 0.3s ease";
  }
}

function busy(form, on) {
  const submitBtn = form.querySelector(".submit");
  if (!submitBtn) return;
  submitBtn.disabled = on;
  const arrow = submitBtn.querySelector(".submit-arrow");
  const spinner = submitBtn.querySelector(".spinner");
  if (arrow && spinner) {
    arrow.style.display = on ? "none" : "grid";
    spinner.style.display = on ? "inline-block" : "none";
  }
}

let otpPurpose = "signup";

function show(method, purpose = method === "signup" ? "signup" : "login") {
  const isPassword = method === "password";
  if (!isPassword) otpPurpose = purpose;
  $("#passwordForm").hidden = !isPassword;
  $("#otpPhoneForm").hidden = isPassword;
  $("#otpCodeForm").hidden = true;

  $$("[data-method]").forEach((b) =>
    b.classList.toggle("active", isPassword
      ? b.dataset.method === "password"
      : b.dataset.method === "signup")
  );

  $("#stepNumber").textContent = "01";
  const otpTitle = otpPurpose === "signup" ? "ساخت حساب جدید" :
    otpPurpose === "recovery" ? "بازیابی دسترسی" : "ورود با پیامک";
  $("#title").textContent = isPassword ? "خوش آمدید" : otpTitle;
  $("#subtitle").textContent = isPassword
    ? "شماره موبایل و رمز عبور حساب خود را وارد کنید."
    : "در این مرحله فقط شماره موبایل خود را وارد کنید.";
  $("#otpHelp").textContent = otpPurpose === "signup"
    ? "با تأیید شماره، ثبت‌نام اولیه انجام می‌شود و پس از تأیید مدیر دسترسی شما فعال خواهد شد."
    : "یک کد یک‌بارمصرف برای ورود امن به حساب شما ارسال می‌شود.";
  message("");
}

let countdownTimer = null;
function startResendCountdown(seconds = 60) {
  const btn = $("#resendOtpBtn");
  const txt = $("#resendTimerText");
  if (!btn || !txt) return;

  clearInterval(countdownTimer);
  btn.disabled = true;
  let remaining = seconds;

  const update = () => {
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      btn.disabled = false;
      txt.textContent = "ارسال مجدد کد";
    } else {
      txt.textContent = `ارسال مجدد کد (${remaining} ثانیه)`;
      remaining--;
    }
  };

  update();
  countdownTimer = setInterval(update, 1000);
}

function showCode() {
  $("#passwordForm").hidden = true;
  $("#otpPhoneForm").hidden = true;
  $("#otpCodeForm").hidden = false;
  $("#phoneEcho").textContent = $("#otpPhone").value.trim();
  $("#stepNumber").textContent = "02";
  $("#title").textContent = otpPurpose === "signup" ? "تکمیل ثبت‌نام" : "تأیید شماره تماس";
  $("#subtitle").textContent = "فقط کد ۶ رقمی ارسال‌شده را وارد کنید.";
  $("#otpCode").value = "";
  $("#otpCode").focus();
  startResendCountdown(60);
}

// Digits normalizer for Persian / Arabic numerals
function cleanPhone(val) {
  return String(val || "")
    .replace(/[۰-۹]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 48))
    .replace(/[٠-٩]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 48))
    .replace(/\s+/g, "");
}

// Tab navigation
$$("[data-method]").forEach((b) => {
  b.onclick = () => show(b.dataset.method,
    b.dataset.method === "signup" ? "signup" : "login");
});

// Forgot password -> switch to OTP
const forgotBtn = $("#forgotToOtp");
if (forgotBtn) {
  forgotBtn.onclick = () => show("otp", "recovery");
}

const otpLoginBtn = $("#loginWithOtp");
if (otpLoginBtn) otpLoginBtn.onclick = () => show("otp", "login");

// Password visibility toggle
const peekBtn = $("#peek");
if (peekBtn) {
  peekBtn.onclick = () => {
    const input = $("#password");
    const eyeOpen = peekBtn.querySelector(".eye-open");
    const eyeClosed = peekBtn.querySelector(".eye-closed");
    const isShowing = input.type === "text";
    input.type = isShowing ? "password" : "text";
    if (eyeOpen && eyeClosed) {
      eyeOpen.style.display = isShowing ? "block" : "none";
      eyeClosed.style.display = isShowing ? "none" : "block";
    }
  };
}

// Form 1: Password Login
$("#passwordForm").onsubmit = async (e) => {
  e.preventDefault();
  const phone = cleanPhone($("#passwordPhone").value);
  const password = $("#password").value;
  busy(e.target, true);
  message("");

  try {
    await api("/api/auth/login-password", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    });
    message("ورود با موفقیت انجام شد. در حال انتقال…", "ok");
    setTimeout(() => location.replace(destination), 300);
  } catch (err) {
    message(err.message, "error");
  } finally {
    busy(e.target, false);
  }
};

// Form 2: Request OTP
async function triggerOtpSend(formEl) {
  const phone = cleanPhone($("#otpPhone").value);
  if (formEl) busy(formEl, true);
  message("");

  try {
    await api("/api/auth/request-otp", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
    showCode();
    message("کد تایید با موفقیت پیامک شد.", "ok");
  } catch (err) {
    message(err.message, "error");
    if (err.retryAfter) {
      startResendCountdown(err.retryAfter);
    }
  } finally {
    if (formEl) busy(formEl, false);
  }
}

$("#otpPhoneForm").onsubmit = (e) => {
  e.preventDefault();
  triggerOtpSend(e.target);
};

// Resend OTP button
const resendBtn = $("#resendOtpBtn");
if (resendBtn) {
  resendBtn.onclick = () => triggerOtpSend(null);
}

// Form 3: Verify OTP Code
$("#otpCodeForm").onsubmit = async (e) => {
  e.preventDefault();
  const code = cleanPhone($("#otpCode").value).trim();
  if (!/^\d{6}$/.test(code)) {
    return message("لطفاً کد ۶ رقمی را به صورت کامل وارد کنید.");
  }

  const phone = cleanPhone($("#otpPhone").value);
  const password = $("#newPassword").value;

  busy(e.target, true);
  message("");

  try {
    await api("/api/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ phone, code, password }),
    });
    message("ورود موفقیت‌آمیز بود! در حال انتقال…", "ok");
    setTimeout(() => location.replace(destination), 350);
  } catch (err) {
    message(err.message, err.pending ? "ok" : "error");
  } finally {
    busy(e.target, false);
  }
};

// Change Phone action
$("#changePhone").onclick = () => show("otp", otpPurpose);

// Specimen Live Weight Switcher
$$(".specimen-btn").forEach((btn) => {
  btn.onclick = () => {
    $$(".specimen-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const weight = btn.dataset.weight;
    const textEl = $("#specimenText");
    if (textEl) {
      textEl.style.fontWeight = weight;
    }
  };
});

// Auto-advance or sanitization for OTP input
const otpInput = $("#otpCode");
if (otpInput) {
  otpInput.addEventListener("input", (e) => {
    e.target.value = cleanPhone(e.target.value).replace(/\D/g, "").slice(0, 6);
  });
}

// Auto-redirect if already signed in
api("/api/me")
  .then((data) => {
    if (data.user) {
      location.replace(destination);
    }
  })
  .catch(() => {});
