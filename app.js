/* ═══════════════════════════════════════════════════
   INTERVIEWAI V5 — app.js
   Settings | Forgot password | Voice settings | All bugs fixed
═══════════════════════════════════════════════════ */


const OPENAI_URL   = "https://interview-ai-proxy.captaindawood14.workers.dev";

// ─── SETTINGS STATE ──────────────────────────────────
let appSettings = {
  voice:    "pNInz6obpgDQGcFmaJgB",
  speed:    0.93,
  silence:  3500,
  theme:    "dark",
  fontSize: "normal"
};

async function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("iai-settings") || "{}");
    appSettings = { ...appSettings, ...s };
  } catch(e) {}
  if (SUPABASE_CONFIGURED && sb && currentUser) {
    const { data: profile } = await sb.from("profiles")
      .select("settings").eq("id", currentUser.id).single();
    if (profile?.settings) {
      appSettings = { ...appSettings, ...profile.settings };
      applySettings();
    }
  }
}
function saveSettings() {
  try { localStorage.setItem("iai-settings", JSON.stringify(appSettings)); } catch(e) {}
  if (SUPABASE_CONFIGURED && sb && currentUser) {
    sb.from("profiles").upsert({
      id: currentUser.id,
      settings: appSettings,
      updated_at: new Date().toISOString()
    });
  }
}

// ─── SUPABASE ────────────────────────────────────────
const SUPABASE_CONFIGURED =
  SUPABASE_URL  !== "paste-your-supabase-url-here"  && SUPABASE_URL  !== "" &&
  SUPABASE_KEY  !== "paste-your-supabase-anon-key-here" && SUPABASE_KEY !== "";

let sb = null;
if (SUPABASE_CONFIGURED) {
  try {
    const { createClient } = supabase;
    sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch(e) {
    console.warn("Supabase init failed:", e.message);
  }
}

// ─── DEMO-MODE AUTH ───────────────────────────────────
const DEMO_USERS_KEY = "iai-demo-users";
function demoGetUsers() {
  try { return JSON.parse(localStorage.getItem(DEMO_USERS_KEY) || "{}"); } catch(e) { return {}; }
}
function demoSaveUsers(u) {
  try { localStorage.setItem(DEMO_USERS_KEY, JSON.stringify(u)); } catch(e) {}
}
function demoLogin(email, pass) {
  const users = demoGetUsers();
  const u = users[email.toLowerCase()];
  if (!u) return { error: { message: "No account found with that email. Please create one first." } };
  if (u.pass !== pass) return { error: { message: "Incorrect password." } };
  return { data: { user: { id: u.id, email, user_metadata: { full_name: u.name } } } };
}
function demoRegister(email, pass, name) {
  const users = demoGetUsers();
  if (users[email.toLowerCase()]) return { error: { message: "An account with that email already exists." } };
  const id = "demo-" + Date.now();
  users[email.toLowerCase()] = { id, email, pass, name };
  demoSaveUsers(users);
  return { data: { user: { id, email, user_metadata: { full_name: name } }, session: { user: { id, email } } } };
}
function demoResetPassword(email) {
  const users = demoGetUsers();
  if (!users[email.toLowerCase()]) return { error: { message: "No account found with that email." } };
  return { data: {} };
}

// ─── INTERVIEW STATE ─────────────────────────────────
let currentUser     = null;

// ─── MULTI-ACCOUNT STORE ─────────────────────────────
function getSavedAccounts() {
  try { return JSON.parse(localStorage.getItem("iai-accounts") || "[]"); } catch(e) { return []; }
}
function saveAccountsStore(arr) {
  try { localStorage.setItem("iai-accounts", JSON.stringify(arr)); } catch(e) {}
}
function upsertSavedAccount(user, session) {
  if (!user) return;
  const accounts = getSavedAccounts();
  const idx = accounts.findIndex(a => a.id === user.id);
  const isActiveUser = user.id === currentUser?.id;
  const existingAvatar = idx >= 0 ? accounts[idx].avatar : null;
  const entry = {
    id:           user.id,
    name:         user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
    email:        user.email || "",
    avatar:       isActiveUser ? (localStorage.getItem("iai-avatar") || null) : existingAvatar,
    accessToken:  session?.access_token  || null,
    refreshToken: session?.refresh_token || null,
  };
  if (idx >= 0) accounts[idx] = entry; else accounts.push(entry);
  saveAccountsStore(accounts);
}
function removeFromSavedAccounts(userId) {
  const accounts = getSavedAccounts().filter(a => a.id !== userId);
  saveAccountsStore(accounts);
}

let selIndustry     = "tech";
let selLevel        = "intern";
let totalQ          = 1;
let currentQ        = 0;
let sessionOwnerKey = null;
let allAnswers      = [];
let convoHistory    = [];
let liveTranscript  = "";
let fillerCount     = 0;
let wordCount       = 0;
let hasSpeechStarted = false;
let isListening     = false;
let recognition     = null;
let silenceTimer    = null;
let interviewDone   = false;
let isPaused        = false;
let currentAudio    = null;
let currentUtt      = null;
let warmupDone      = false;
let warmupTurns     = 0;
let sessionSeed     = 0;
let pendingConfirm  = null;
let manualLoginInProgress = false;
let speechRecognition = null;
let mediaRecorder   = null;
let recordingStream = null;
let audioChunks     = [];

const IND_LABELS = { tech:"Technology", banking:"Banking & Finance", healthcare:"Healthcare", education:"Education", engineering:"Engineering" };
const LVL_LABELS = { intern:"Internship", fresh:"Fresh Graduate", senior:"Senior Position" };
const FILLERS    = ["um","uh","err","basically","literally","sort of","kind of","okay so","hmm"];

// ─── INIT ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  loadSettings();
  applySettings();

  document.getElementById("ovc-ok").addEventListener("click", () => {
    closeOv("ov-confirm");
    if (typeof pendingConfirm === "function") {
      const fn = pendingConfirm;
      pendingConfirm = null;
      fn();
    }
  });

  if (SUPABASE_CONFIGURED && sb) {
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        showPage("page-auth");
        ["form-login","form-register","form-forgot"].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.classList.add("ap-hidden"); el.style.display = "none"; }
        });
        const rf = document.getElementById("form-reset");
        if (rf) { rf.classList.remove("ap-hidden","hidden"); rf.style.display = ""; rf.classList.add("slide-in"); }
      } else if (event === "SIGNED_IN" && session && !currentUser) {
              // Handled by handleLogin or getSession below
            }
    });
  }

  if (await handleAuthCallback()) return;

  if (SUPABASE_CONFIGURED && sb) {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        currentUser = data.session.user;
        upsertSavedAccount(data.session.user, data.session);
        await loadSettings();
        applySettings();
        initDashboard();
        loadStoredAvatar();
        return;
      }
    }
  showPage("page-auth");
});

// ─── THEME ───────────────────────────────────────────
function applySettings() {
  document.documentElement.setAttribute("data-theme", appSettings.theme);
  applyFontSize(appSettings.fontSize);
  const icon = appSettings.theme === "dark" ? "🌙" : "☀️";
  ["theme-icon","nav-theme-icon"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = icon;
  });
  syncThemeOptions();
    document.querySelectorAll(".fs-opt").forEach(b => {
      b.classList.toggle("selected", b.id === "fs-" + appSettings.fontSize);
    });
  }

async function toggleTheme() {
  appSettings.theme = appSettings.theme === "dark" ? "light" : "dark";
  saveSettings();
  applySettings();
  if (document.getElementById("dash-sessions-view")?.style.display !== "none") {
    const all = await getSessions();
    drawProgressChart(all);
    drawAvgChart(all);
  }
}

async function setTheme(t) {
  appSettings.theme = t;
  saveSettings();
  applySettings();
  if (document.getElementById("dash-sessions-view")?.style.display !== "none") {
    const all = await getSessions();
    drawProgressChart(all);
    drawAvgChart(all);
  }
}

function syncThemeOptions() {
  const isDark = appSettings.theme === "dark";
  document.getElementById("thcheck-dark")?.classList.toggle("hidden", !isDark);
  document.getElementById("thcheck-light")?.classList.toggle("hidden", isDark);
}

function setFontSize(size, btn) {
  document.querySelectorAll(".fs-opt").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  appSettings.fontSize = size;
  saveSettings();
  applyFontSize(size);
}

function applyFontSize(size) {
  document.documentElement.setAttribute("data-fontsize", size);
  let s = document.getElementById("iai-font-inject");
  if (!s) { s = document.createElement("style"); s.id = "iai-font-inject"; document.head.appendChild(s); }
  if (size === "large") {
    s.textContent = `html{font-size:19px!important}body{font-size:19px!important}.prem-hero-title{font-size:clamp(38px,4vw,58px)!important}.psc-val{font-size:36px!important}.psc-label{font-size:13px!important}.prem-hero-sub,.prem-greet-txt{font-size:16px!important}.prem-cta-btn,.prem-ghost-btn,.prem-launch-btn{font-size:16px!important}.pit-name,.plc-name{font-size:15px!important}.pit-sub,.plc-sub,.prem-tip span,.psl-sub{font-size:13px!important}.psl-title{font-size:18px!important}.prem-q-btn{font-size:17px!important}.pnl-btn,.nav-logout-btn,.prem-user-name{font-size:15px!important}.cm-bubble{font-size:16px!important}.itz-text{font-size:16px!important}.itz-hint,.iv-sb-label{font-size:12px!important}.iv-sb-val{font-size:15px!important}.iv-sb-status-text{font-size:14px!important}.iv-skip-btn,.iv-end-btn,.iv-ctrl-end-full{font-size:15px!important}.sb-s-val{font-size:20px!important}.res-meta{font-size:16px!important}.res-bar-row>span{font-size:15px!important}.rqa-q,.rqa-a{font-size:15px!important}.rqa-tag{font-size:13px!important}.res-tip-row span{font-size:16px!important}.sw-lbl{font-size:13px!important}.res-sw-card p{font-size:16px!important}.res-badge{font-size:13px!important}.st-section-card h4,.st-tab-title,.sess-title,.sa-chart-title,.res-title{font-size:1.15em!important}.st-section-card>p,.st-field label,.sn-item,.fs-opt,.speed-opt,.voice-opt .vo-name,.voice-opt .vo-sub,.ac-field label,.ac-field input,.ac-head p,.st-field input,.sc-ind-name,.sc-ind-level,.sc-bar-label,.sc-date,.sf-pill,.sess-subtitle,.sa-chart-sub{font-size:1.05em!important}.sess-card{min-height:auto!important}.sess-card *{font-size:inherit}.sc-score-badge{font-size:22px!important}.sc-ind-icon{font-size:18px!important}.sc-ind-name{font-size:13px!important}.sc-ind-level{font-size:11px!important}.sc-bar-label{font-size:10px!important}.sc-date{font-size:11px!important}.sc-q-count{font-size:11px!important}.sc-grade-tag{font-size:10px!important}.sc-bars{gap:6px!important}.sc-bar-row{gap:8px!important}.sess-card{padding:18px!important}`;
  } else {
    s.textContent = `body{font-size:14px}.prem-hero-title{font-size:clamp(30px,3vw,46px)}.psc-val{font-size:28px}.psc-label{font-size:10px}.prem-hero-sub,.prem-greet-txt{font-size:13px}.prem-cta-btn,.prem-ghost-btn,.prem-launch-btn{font-size:13px}.pit-name,.plc-name{font-size:12px}.pit-sub,.plc-sub,.prem-tip span,.psl-sub{font-size:10px}.psl-title{font-size:15px}.prem-q-btn{font-size:14px}.pnl-btn,.nav-logout-btn,.prem-user-name{font-size:12px}.cm-bubble{font-size:13px}.itz-text{font-size:13px}.iv-sb-val{font-size:12px}.iv-skip-btn,.iv-end-btn,.iv-ctrl-end-full{font-size:12px}.sb-s-val{font-size:16px}.res-meta{font-size:13px}.res-bar-row>span{font-size:12px}.rqa-q,.rqa-a{font-size:12px}.rqa-tag{font-size:10px}.res-tip-row span{font-size:13px}.res-sw-card p{font-size:13px}.st-section-card h4,.st-tab-title,.sess-title,.sa-chart-title,.res-title{font-size:0.95em}.st-section-card>p,.st-field label,.sn-item,.fs-opt,.speed-opt,.voice-opt .vo-name,.voice-opt .vo-sub,.st-field input,.sc-ind-name,.sc-bar-label,.sf-pill,.sess-subtitle{font-size:0.93em}`;
  }
}

// ─── PAGE NAV ────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById(id);
  el.classList.add("active");
  if (id !== "page-interview") window.scrollTo(0,0);
  setTimeout(loadStoredAvatar, 30);
}

function goToDash() { showPage("page-dashboard"); }
function goToSettings() {
  loadSettingsPage();
  showPage("page-settings");
}

// ─── OVERLAYS ────────────────────────────────────────
function showOv(id) { document.getElementById(id).classList.remove("hidden"); }
function closeOv(id){ document.getElementById(id).classList.add("hidden"); }
function showLoad(msg) { document.getElementById("ov-load-text").textContent = msg||"Processing..."; showOv("ov-load"); }
function hideLoad()    { closeOv("ov-load"); }

function showConfirm(title, msg, fn) {
  document.getElementById("ovc-title").textContent = title;
  document.getElementById("ovc-msg").textContent   = msg;
  pendingConfirm = fn;
  showOv("ov-confirm");
}

// ─── AUTH HELPERS ────────────────────────────────────
function toggleEye(id, btn) {
  const inp  = document.getElementById(id);
  const show = inp.type === "password";
  inp.type   = show ? "text" : "password";
  btn.innerHTML = show
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

function checkPw(val) {
  const ok = {
    len:   val.length >= 8,
    upper: /[A-Z]/.test(val),
    lower: /[a-z]/.test(val),
    num:   /[0-9]/.test(val),
    sym:   /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(val)
  };
  setPwReq("pr-len",   ok.len);
  setPwReq("pr-upper", ok.upper);
  setPwReq("pr-lower", ok.lower);
  setPwReq("pr-num",   ok.num);
  setPwReq("pr-sym",   ok.sym);

  const score  = Object.values(ok).filter(Boolean).length;
  const bar    = document.getElementById("pw-bar");
  const colors = ["","#ef4444","#f59e0b","#f59e0b","#3d9970","#3d9970"];
  bar.style.width      = `${(score/5)*100}%`;
  bar.style.background = colors[score]||"#ef4444";
  const bar2 = document.getElementById("pw-bar2");
  if (bar2) { bar2.style.width = `${(score/5)*100}%`; bar2.style.background = colors[score]||"#ef4444"; }
}

function setPwReq(id, ok) {
  document.getElementById(id)?.classList.toggle("ok", ok);
}

function switchForm(to) {
  const ids = ["form-login","form-register","form-forgot","form-reset"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("slide-in","slide-out","form-fade-in");
    el.classList.add("ap-hidden");
    el.style.display = "none";
  });
  const target = document.getElementById(`form-${to}`);
  if (target) {
    target.classList.remove("hidden","ap-hidden");
    target.style.display = "";
    target.classList.add("form-fade-in");
    setTimeout(() => target.classList.remove("form-fade-in"), 250);
  }
}

function showForgotPassword() {
  const tb = document.getElementById('auth-tabs');
  if (tb) tb.style.display = 'none';
  document.querySelectorAll('.ac-tab,.ap-tab').forEach(t => t.classList.remove('active'));
  switchForm('forgot');
}

function showAuthAlert(id, msg, isOk=false) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className   = "af-alert" + (isOk ? " ok" : "");
  el.classList.remove("hidden");
}

function setBtnLoading(btnId, spinId, loading, text) {
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = loading;
  const txtEl = document.getElementById(btnId+"-txt");
  if (txtEl) txtEl.textContent = loading ? "Please wait..." : text;
  const spinEl = document.getElementById(spinId);
  if (spinEl) spinEl.classList.toggle("hidden", !loading);
}

// ─── LOGIN ───────────────────────────────────────────
async function handleLogin() {
  const email = document.getElementById("login-email").value.trim();
  const pass  = document.getElementById("login-pass").value;
  document.getElementById("login-alert").classList.add("hidden");
  if (!email||!pass) { showAuthAlert("login-alert","Please fill in all fields."); return; }

  setBtnLoading("login-btn","login-spin",true,"Sign In");

  let data, error;
  if (SUPABASE_CONFIGURED && sb) {
    const res = await sb.auth.signInWithPassword({ email, password:pass });
    data = res.data; error = res.error;
  } else {
    const res = demoLogin(email, pass);
    data = res.data; error = res.error;
    await new Promise(r => setTimeout(r, 400));
  }

  setBtnLoading("login-btn","login-spin",false,"Sign In");

  if (error) { showAuthAlert("login-alert",error.message); return; }

  currentUser = data.user;
  if (SUPABASE_CONFIGURED && sb) {
    const { data: sessData } = await sb.auth.getSession();
    upsertSavedAccount(data.user, sessData?.session);
    const { data: profile } = await sb.from("profiles")
      .select("avatar_url").eq("id", data.user.id).single();
    if (profile?.avatar_url) {
      localStorage.setItem("iai-avatar", profile.avatar_url);
      const accs = getSavedAccounts();
      const idx = accs.findIndex(a => a.id === data.user.id);
      if (idx >= 0) { accs[idx].avatar = profile.avatar_url; saveAccountsStore(accs); }
    } else {
      localStorage.removeItem("iai-avatar");
    }
  } else {
    upsertSavedAccount(data.user, null);
    const _acc = getSavedAccounts().find(a => a.id === data.user.id);
    if (_acc?.avatar) localStorage.setItem("iai-avatar", _acc.avatar);
    else localStorage.removeItem("iai-avatar");
  }
  await loadSettings();
  applySettings();
  initDashboard();
  loadStoredAvatar();
}

// ─── REGISTER ────────────────────────────────────────
async function handleRegister() {
  const name    = document.getElementById("reg-name").value.trim();
  const email   = document.getElementById("reg-email").value.trim();
  const pass    = document.getElementById("reg-pass").value;
  const confirm = document.getElementById("reg-confirm").value;
  document.getElementById("reg-alert").classList.add("hidden");

  if (!name||!email||!pass||!confirm) { showAuthAlert("reg-alert","Please fill in all fields."); return; }
  if (pass.length < 8)   { showAuthAlert("reg-alert","Password must be at least 8 characters."); return; }
  if (!/[A-Z]/.test(pass)) { showAuthAlert("reg-alert","Password must contain an uppercase letter."); return; }
  if (!/[a-z]/.test(pass)) { showAuthAlert("reg-alert","Password must contain a lowercase letter."); return; }
  if (!/[0-9]/.test(pass)) { showAuthAlert("reg-alert","Password must contain a number."); return; }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass)) { showAuthAlert("reg-alert","Password must contain a special character."); return; }
  if (pass !== confirm) { showAuthAlert("reg-alert","Passwords do not match."); return; }
  const fn = name.split(" ")[0].toLowerCase();
  if (pass.toLowerCase().includes(fn)) { showAuthAlert("reg-alert","Password should not contain your name."); return; }

  setBtnLoading("reg-btn","reg-spin",true,"Create Account");

  let data, error;
  if (SUPABASE_CONFIGURED && sb) {
    const res = await sb.auth.signUp({ email, password:pass, options:{ data:{ full_name:name } } });
    data = res.data; error = res.error;
  } else {
    const res = demoRegister(email, pass, name);
    data = res.data; error = res.error;
    await new Promise(r => setTimeout(r, 400));
  }

  setBtnLoading("reg-btn","reg-spin",false,"Create Account");

  if (error) { showAuthAlert("reg-alert",error.message); return; }
  currentUser = data.user;
  if (data.session) {
      await loadSettings();
      applySettings();
      initDashboard();
      loadStoredAvatar();
    }
  else { showAuthAlert("reg-alert","✓ Account created! Check your email to confirm then sign in.", true); }
}

// ─── FORGOT PASSWORD ─────────────────────────────────
async function handleForgotPassword() {
  const email = document.getElementById("forgot-email").value.trim();
  document.getElementById("forgot-alert").classList.add("hidden");
  if (!email) { showAuthAlert("forgot-alert","Please enter your email address."); return; }

  setBtnLoading("forgot-btn","forgot-spin",true,"Send Reset Link");

  let error;
  if (SUPABASE_CONFIGURED && sb) {
    const redirectUrl = "https://dawoodnadeem9914.github.io/AI_Project";
    const res = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
    error = res.error;
  } else {
    const res = demoResetPassword(email);
    error = res.error;
    await new Promise(r => setTimeout(r, 400));
  }

  setBtnLoading("forgot-btn","forgot-spin",false,"Send Reset Link");

  if (error) { showAuthAlert("forgot-alert",error.message); return; }
  showAuthAlert("forgot-alert","✓ Reset link sent! Check your email inbox (and spam folder).", true);
}

async function sendResetEmail() {
  if (!currentUser?.email) return;
  showLoad("Sending reset email...");
  const al = document.getElementById("security-alert");
  if (SUPABASE_CONFIGURED && sb) {
    const { error } = await sb.auth.resetPasswordForEmail(currentUser.email, { redirectTo: "https://dawoodnadeem9914.github.io/AI_Project/" });
    hideLoad();
    if (error) { al.textContent=error.message; al.className="st-alert"; al.classList.remove("hidden"); }
    else { al.textContent="✓ Reset email sent to "+currentUser.email; al.className="st-alert ok"; al.classList.remove("hidden"); }
  } else {
    hideLoad();
    al.textContent="✓ (Demo mode) Reset email would be sent to "+currentUser.email; al.className="st-alert ok"; al.classList.remove("hidden");
  }
}

async function handleLogout() {
  // Save avatar to accounts store BEFORE clearing it
  if (currentUser) {
    const avatar = localStorage.getItem("iai-avatar") || null;
    const accs = getSavedAccounts();
    const idx = accs.findIndex(a => a.id === currentUser.id);
    if (idx >= 0) { accs[idx].avatar = avatar; saveAccountsStore(accs); }
  }
  if (SUPABASE_CONFIGURED && sb) await sb.auth.signOut();
  currentUser = null;
  localStorage.removeItem("iai-avatar");
  showPage("page-auth");
}

// ─── DASHBOARD ───────────────────────────────────────
function initDashboard() {
  const name  = currentUser?.user_metadata?.full_name || currentUser?.email?.split("@")[0] || "User";
  const first = name.split(" ")[0];

  if (!localStorage.getItem("iai-avatar")) clearAvatarDOM();
    const _navAv = document.getElementById("nav-av");
    if (!localStorage.getItem("iai-avatar")) _navAv.textContent = first[0].toUpperCase();
    document.getElementById("nav-name").textContent = first;

  const hour = new Date().getHours();
  const gr   = hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";
  document.getElementById("dhb-greet").textContent = `${gr}, ${first} 👋`;

  loadDashStats();
  loadRecentSessions();
  loadStoredAvatar();
  showPage("page-dashboard");
  initDashParticles();
}

async function loadDashStats() {
  // Show dashes while loading instead of 0
  const elTotal = document.getElementById("st-total");
  const elBest  = document.getElementById("st-best");
  const elAvg   = document.getElementById("st-avg");
  if(elTotal) elTotal.textContent = "—";
  if(elBest)  elBest.textContent  = "—";
  if(elAvg)   elAvg.textContent   = "—";

  const sessions = await getSessions();
  const total = sessions.length;
  const best  = total ? Math.max(...sessions.map(s=>s.score)) : null;
  const avg   = total ? Math.round(sessions.reduce((a,s)=>a+s.score,0)/total) : null;

  if(elTotal) elTotal.textContent = total || 0;
  if(elBest)  elBest.textContent  = best  !== null ? best  : "—";
  if(elAvg)   elAvg.textContent   = avg   !== null ? avg   : "—";

  setTimeout(()=>{
    const barTotal = document.getElementById("psc-bar-total");
    const barBest  = document.getElementById("psc-bar-best");
    const barAvg   = document.getElementById("psc-bar-avg");
    if(barTotal) barTotal.style.width = Math.min(total*10,100)+"%";
    if(barBest && best!==null)  barBest.style.width  = best+"%";
    if(barAvg  && avg!==null)   barAvg.style.width   = avg+"%";
  }, 200);
}

function loadRecentSessions() {}

// ─── SESSIONS PAGE ───────────────────────────────────
let sessFilterInd   = "all";
let sessFilterScore = "all";
let sessSearchTerm  = "";

async function goToSessions() {
  document.getElementById("dash-home-view").style.display   = "none";
  document.getElementById("dash-sessions-view").style.display = "";
  document.querySelectorAll(".pnl-btn").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".pnl-btn")[1]?.classList.add("active");
  renderSessionsPage();
  const all = await getSessions();
  drawProgressChart(all);
  drawAvgChart(all);
}

function showDashHome() {
  document.getElementById("dash-home-view").style.display   = "";
  document.getElementById("dash-sessions-view").style.display = "none";
  document.querySelectorAll(".pnl-btn").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".pnl-btn")[0]?.classList.add("active");
}

async function renderSessionsPage() {
  const all = (await getSessions()).slice().reverse();

  const total  = all.length;
  const best   = total ? Math.max(...all.map(s=>s.score)) : null;
  const avg    = total ? Math.round(all.reduce((a,s)=>a+s.score,0)/total) : null;
  const streak = calcStreak(all);
  const smTotal  = document.getElementById("sm-total");
  const smBest   = document.getElementById("sm-best");
  const smAvg    = document.getElementById("sm-avg");
  const smStreak = document.getElementById("sm-streak");
  if(smTotal)  smTotal.textContent  = total;
  if(smBest)   smBest.textContent   = best  !== null ? best  : "—";
  if(smAvg)    smAvg.textContent    = avg   !== null ? avg   : "—";
  if(smStreak) smStreak.textContent = streak;

  const allSess = await getSessions();
  drawProgressChart(allSess);
  drawAvgChart(allSess);
  filterSessions();
}

function calcStreak(sessions) {
  if (!sessions.length) return 0;
  const days = new Set(sessions.map(s => new Date(s.date).toDateString()));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (days.has(d.toDateString())) streak++;
    else if (i > 0) break;
  }
  return streak;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HD CHART ENGINE — crisp retina rendering + proper glow effects
// ═══════════════════════════════════════════════════════════════════════════════

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function _drawHDChart(canvasId, pts, lineColor, glowHex, isAvg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const container = canvas.parentElement;
  const W = Math.max(260, (container?.getBoundingClientRect().width || 500) - 48);
  const H = 220;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

  const isDark = document.documentElement.getAttribute("data-theme") !== "light";

  if (!pts.length) {
    ctx.fillStyle = isDark ? "rgba(253,240,234,0.25)" : "rgba(28,6,8,0.45)";
    ctx.font = "500 13px 'DM Sans', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No sessions yet", W / 2, H / 2);
    return;
  }

  const padL = 38, padR = 18, padT = 32, padB = 48;
  const cW = W - padL - padR;
  const cH = H - padT - padB;
  const toX = i => padL + (pts.length > 1 ? (i / (pts.length - 1)) * cW : cW / 2);
  const toY = v => padT + cH - (Math.max(0, Math.min(100, v)) / 100) * cH;

  [0, 25, 50, 75, 100].forEach(v => {
    const y = toY(v);
    ctx.beginPath();
    ctx.setLineDash(v === 0 ? [] : [2, 6]);
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
    ctx.lineWidth = 0.5;
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = isDark ? "rgba(253,240,234,0.3)" : "rgba(28,6,8,0.55)";
    ctx.font = "500 9px 'DM Sans', system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(v, padL - 6, y);
  });

  function buildPath() {
    ctx.beginPath();
    if (pts.length === 1) { ctx.arc(toX(0), toY(pts[0].score), 4, 0, Math.PI * 2); return; }
    ctx.moveTo(toX(0), toY(pts[0].score));
    for (let i = 1; i < pts.length; i++) {
      const cpx = (toX(i - 1) + toX(i)) / 2;
      ctx.bezierCurveTo(cpx, toY(pts[i-1].score), cpx, toY(pts[i].score), toX(i), toY(pts[i].score));
    }
  }

  if (pts.length > 1) {
    const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
    grad.addColorStop(0, isDark ? glowHex + "22" : glowHex + "20");
    grad.addColorStop(1, glowHex + "00");
    buildPath();
    ctx.lineTo(toX(pts.length - 1), H - padB);
    ctx.lineTo(toX(0), H - padB);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.save();
  buildPath();
  ctx.strokeStyle = isDark ? lineColor : (isAvg ? "#1a8a52" : "#c0243f");
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  const dotBg = isDark ? "#0a0407" : "#ffffff";
  const badgeColor = isAvg
    ? (isDark ? "rgba(61,153,112,0.95)" : "rgba(20,100,60,0.95)")
    : (isDark ? "rgba(192,36,63,0.95)" : "rgba(160,20,45,0.95)");
  const dotColor = isDark ? lineColor : (isAvg ? "#1a8a52" : "#c0243f");

  pts.forEach((p, i) => {
    const x = toX(i);
    const y = toY(p.score);

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = dotBg;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    const val = String(p.score);
    ctx.font = "700 9px 'DM Sans', system-ui, sans-serif";
    ctx.textAlign = "center";
    const tw = ctx.measureText(val).width;
    const bW = tw + 12;
    const bH = 17;
    const bY = y - 24;

    roundRect(ctx, x - bW/2, bY - bH/2, bW, bH, 8);
    ctx.fillStyle = badgeColor;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x - 3, bY + bH/2);
    ctx.lineTo(x, bY + bH/2 + 4);
    ctx.lineTo(x + 3, bY + bH/2);
    ctx.closePath();
    ctx.fillStyle = badgeColor;
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 9px 'DM Sans', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(val, x, bY);

    const d = new Date(p.date);
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    ctx.fillStyle = isDark ? "rgba(253,240,234,0.55)" : "rgba(28,6,8,0.7)";
    ctx.font = "600 8.5px 'DM Sans', system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText("#" + (i + 1), x, H - padB + 6);

    ctx.fillStyle = isDark ? "rgba(253,240,234,0.3)" : "rgba(28,6,8,0.45)";
    ctx.font = "400 7.5px 'DM Sans', system-ui, sans-serif";
    ctx.fillText(dateStr, x, H - padB + 19);
  });

  ctx.textBaseline = "alphabetic";
}

function drawProgressChart(sessions) {
  // Always sort by date ascending so oldest=left, newest=right
  const sorted = sessions.slice().sort((a,b) => a.date - b.date);
  const pts = sorted.slice(-10);
  _drawHDChart("prog-chart", pts, "#e03050", "#e03050", false);
}

// ─── PUBLIC: AVERAGE TREND ────────────────────────────────────────────────────
function drawAvgChart(sessions) {
  const sorted = sessions.slice().sort((a,b) => a.date - b.date);
  const raw = sorted.slice(-10);
  let sum = 0;
  const pts = raw.map((p, i) => ({
    score: Math.round((sum += p.score) / (i + 1)),
    date:  p.date
  }));
  _drawHDChart("avg-chart", pts, "#4cb882", "#4cb882", true);
}

// ═══════════════════════════════════════════════════════════════════════════════

async function filterSessions(resetCount) {
  if (resetCount !== false) sessShowCount = 6;
  const search = (document.getElementById("sess-search")?.value || "").toLowerCase();
  const all    = (await getSessions()).slice().reverse();

  const filtered = all.filter(s => {
    const indMatch   = sessFilterInd   === "all" || s.industry === sessFilterInd;
    const label      = (IND_LABELS[s.industry]||"").toLowerCase();
    const lvlLabel   = (LVL_LABELS[s.level]||"").toLowerCase();
    const searchMatch = !search || label.includes(search) || lvlLabel.includes(search) ||
                        String(s.score).includes(search) ||
                        new Date(s.date).toLocaleDateString().includes(search);
    let scoreMatch = true;
    if (sessFilterScore === "excellent") scoreMatch = s.score >= 85;
    else if (sessFilterScore === "good")  scoreMatch = s.score >= 65 && s.score < 85;
    else if (sessFilterScore === "fair")  scoreMatch = s.score >= 40 && s.score < 65;
    return indMatch && scoreMatch && searchMatch;
  });

  renderSessionCards(filtered);
}

function setSessFilter(btn) {
  const filterType = btn.dataset.filter;
  const val        = btn.dataset.v;
  if (filterType === "ind")   sessFilterInd   = val;
  if (filterType === "score") sessFilterScore = val;
  document.querySelectorAll(`.sf-pill[data-filter="${filterType}"]`).forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  filterSessions();
}

function getScoreGrade(score) {
  if (score >= 85) return { cls:"excellent", label:"Excellent" };
  if (score >= 65) return { cls:"good",      label:"Good" };
  if (score >= 40) return { cls:"fair",       label:"Fair" };
  return                  { cls:"needs",      label:"Needs Work" };
}

const IND_ICONS = { tech:"💻", banking:"🏦", healthcare:"🏥", education:"🎓", engineering:"⚙️" };

let sessShowCount = 6;

function renderSessionCards(sessions) {
  const grid  = document.getElementById("sess-grid");
  const empty = document.getElementById("sess-empty");
  if (!grid) return;

  // Remove old "Show More" button
  document.getElementById("sess-show-more")?.remove();

  if (!sessions.length) {
    grid.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  const visible = sessions.slice(0, sessShowCount);

  grid.innerHTML = visible.map((s, idx) => {
    const grade = getScoreGrade(s.score);
    const icon  = IND_ICONS[s.industry] || "📋";
    const date  = new Date(s.date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});

    const comm   = s.communication   || Math.round(s.score * (0.8 + Math.random()*0.4));
    const conf   = s.confidence      || Math.round(s.score * (0.8 + Math.random()*0.4));
    const rel    = s.relevance       || Math.round(s.score * (0.8 + Math.random()*0.4));
    const clamped = v => Math.min(100, Math.max(0, v));

    return `<div class="sess-card" style="animation-delay:${idx*0.05}s">
      <div class="sc-top">
        <div class="sc-ind">
          <span class="sc-ind-icon">${icon}</span>
          <div>
            <p class="sc-ind-name">${IND_LABELS[s.industry]||s.industry}</p>
            <p class="sc-ind-level">${LVL_LABELS[s.level]||s.level}</p>
          </div>
        </div>
        <div>
          <div class="sc-score-badge ${grade.cls}">${s.score}</div>
        </div>
      </div>
      <div class="sc-bars">
        <div class="sc-bar-row">
          <span class="sc-bar-label">Communication</span>
          <div class="sc-bar-track"><div class="sc-bar-fill" style="width:${clamped(comm)}%"></div></div>
        </div>
        <div class="sc-bar-row">
          <span class="sc-bar-label">Confidence</span>
          <div class="sc-bar-track"><div class="sc-bar-fill" style="width:${clamped(conf)}%"></div></div>
        </div>
        <div class="sc-bar-row">
          <span class="sc-bar-label">Relevance</span>
          <div class="sc-bar-track"><div class="sc-bar-fill" style="width:${clamped(rel)}%"></div></div>
        </div>
      </div>
      <div class="sc-meta">
        <span class="sc-date">${date}</span>
        <span class="sc-q-count">${s.questions} Q</span>
        <span class="sc-grade-tag ${grade.cls}">${grade.label}</span>
      </div>
    </div>`;
  }).join("");

  // Show "Show More" button if there are more sessions
    if (sessions.length > sessShowCount) {
      const remaining = sessions.length - sessShowCount;
      const btn = document.createElement("div");
      btn.id = "sess-show-more";
      btn.style.cssText = "text-align:center;margin-top:20px";
      btn.innerHTML = `<button onclick="showMoreSessions()" style="background:var(--bg3);border:1.5px solid var(--bdr2);color:var(--txt2);padding:10px 28px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:.2s">Show More (${remaining} remaining)</button>`;
      grid.parentElement.appendChild(btn);
    }

    // Show "Show Less" button if expanded beyond default
    document.getElementById("sess-show-less")?.remove();
    if (sessShowCount > 6 && sessions.length > 6) {
      const lessBtn = document.createElement("div");
      lessBtn.id = "sess-show-less";
      lessBtn.style.cssText = "text-align:center;margin-top:10px";
      lessBtn.innerHTML = `<button onclick="showLessSessions()" style="background:none;border:1.5px solid var(--bdr);color:var(--txt3);padding:8px 22px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:.2s">Show Less</button>`;
      grid.parentElement.appendChild(lessBtn);
    }
  }

function showLessSessions() {
  sessShowCount = 6;
  filterSessions(false);
}

async function showMoreSessions() {
  sessShowCount += 6;
  const search = (document.getElementById("sess-search")?.value || "").toLowerCase();
  const all    = (await getSessions()).slice().reverse();
  const filtered = all.filter(s => {
    const indMatch   = sessFilterInd === "all" || s.industry === sessFilterInd;
    const label      = (IND_LABELS[s.industry]||"").toLowerCase();
    const lvlLabel   = (LVL_LABELS[s.level]||"").toLowerCase();
    const searchMatch = !search || label.includes(search) || lvlLabel.includes(search) ||
                        String(s.score).includes(search) ||
                        new Date(s.date).toLocaleDateString().includes(search);
    let scoreMatch = true;
    if (sessFilterScore === "excellent") scoreMatch = s.score >= 85;
    else if (sessFilterScore === "good")  scoreMatch = s.score >= 65 && s.score < 85;
    else if (sessFilterScore === "fair")  scoreMatch = s.score >= 40 && s.score < 65;
    return indMatch && scoreMatch && searchMatch;
  });
  renderSessionCards(filtered);
}

function getSessionsKey() {
  return currentUser ? "iai-sessions-" + currentUser.id : "iai-sessions-guest";
}
async function getSessions() {
  if (SUPABASE_CONFIGURED && sb && currentUser) {
    const { data } = await sb.from("sessions").select("*")
      .eq("user_id", currentUser.id).order("date", { ascending: true });
    return data || [];
  }
  try { return JSON.parse(localStorage.getItem(getSessionsKey())||"[]"); } catch { return []; }
}

async function saveSession(score) {
  if (SUPABASE_CONFIGURED && sb && currentUser) {
    await sb.from("sessions").insert({
      user_id: currentUser.id,
      industry: selIndustry,
      level: selLevel,
      questions: allAnswers.length,
      score: score,
      date: Date.now()
    });
    return;
  }
  const key = sessionOwnerKey || getSessionsKey();
  let sessions = [];
  try { sessions = JSON.parse(localStorage.getItem(key) || "[]"); } catch { sessions = []; }
  sessions.push({ industry:selIndustry, level:selLevel, questions:allAnswers.length, score, date:Date.now() });
  if (sessions.length>20) sessions.splice(0, sessions.length-20);
  try { localStorage.setItem(key, JSON.stringify(sessions)); } catch(e) {}
  sessionOwnerKey = null;
}

// ─── SETUP SELECTORS ─────────────────────────────────
function selInd(el) {
  document.querySelectorAll(".ind-tile, .prem-ind-tile").forEach(t=>t.classList.remove("selected"));
  el.classList.add("selected"); selIndustry = el.dataset.v;
}
function selLvl(el) {
  document.querySelectorAll(".lvl-item, .prem-lvl-card").forEach(t=>t.classList.remove("selected"));
  el.classList.add("selected"); selLevel = el.dataset.v;
}
function selQ(el) {
  document.querySelectorAll(".q-pill, .prem-q-btn").forEach(b=>b.classList.remove("selected"));
  el.classList.add("selected"); totalQ = parseInt(el.dataset.v)||1;
  document.getElementById("cq-wrap").classList.add("hidden");
}
function toggleCQ() {
  document.querySelectorAll(".q-pill, .prem-q-btn").forEach(b=>b.classList.remove("selected"));
  const lastBtns = document.querySelectorAll(".q-pill:last-child, .prem-q-btn:last-child");
  lastBtns.forEach(b=>b.classList.add("selected"));
  document.getElementById("cq-wrap").classList.remove("hidden");
}
function setCQ(inp) {
  let v=parseInt(inp.value);
  if(v>10){v=10;inp.value=10;}
  if(v<1||isNaN(v)){v=1;}
  totalQ=v;
}

// ─── SETTINGS PAGE ───────────────────────────────────
function loadSettingsPage() {
  if (!localStorage.getItem("iai-avatar")) { clearAvatarDOM(); }
  const name  = currentUser?.user_metadata?.full_name||"";
  const email = currentUser?.email||"";
  const first = name.split(" ")[0]||email.split("@")[0]||"U";

  const _stLetterEl = document.getElementById("st-avatar-letter"); if (_stLetterEl) _stLetterEl.textContent = first[0].toUpperCase(); else document.getElementById("st-avatar").textContent = first[0].toUpperCase();
  document.getElementById("st-avatar-name").textContent = name||"User";
  document.getElementById("st-avatar-email").textContent = email;
  if(document.getElementById("st-name")) document.getElementById("st-name").value = name;
  if(document.getElementById("st-email")) document.getElementById("st-email").value = email;
  document.getElementById("acc-sessions").textContent = "...";
  getSessions().then(s => { document.getElementById("acc-sessions").textContent = s.length; });

  document.querySelectorAll(".voice-opt").forEach(o=>{
    const isSelected = o.dataset.id === (appSettings.voice || "pNInz6obpgDQGcFmaJgB");
    o.classList.toggle("selected", isSelected);
    const check = o.querySelector(".vo-check");
    if (check) check.classList.toggle("hidden", !isSelected);
  });

  document.querySelectorAll(".speed-opt[data-v]").forEach(o=>{
    if(o.closest("#st-voice")) {
      o.classList.toggle("selected", parseFloat(o.dataset.v)===appSettings.speed);
    }
  });

  document.querySelectorAll(".speed-opt[data-v]").forEach(o=>{
    if(o.closest(".st-section-card") && parseInt(o.dataset.v)===appSettings.silence) {
      o.classList.add("selected");
    }
  });

  syncThemeOptions();
}

function switchSettingsTab(btn) {
  document.querySelectorAll(".stn-btn,.sn-item").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const tab = btn.dataset.tab;
  document.querySelectorAll(".stt,.st-tab").forEach(t => { t.classList.remove("active"); t.classList.add("hidden"); });
  const el = document.getElementById("st-" + tab);
  if (el) { el.classList.add("active"); el.classList.remove("hidden"); }
}

async function saveProfile() {
  const name  = document.getElementById("st-name").value.trim();
  const email = document.getElementById("st-email").value.trim();
  const al    = document.getElementById("profile-alert");
  if (!name||!email) { al.textContent="Please fill in all fields."; al.className="st-alert"; al.classList.remove("hidden"); return; }

  showLoad("Saving profile...");
  const updates = {};
  if (email !== currentUser?.email) updates.email = email;

  if (SUPABASE_CONFIGURED && sb) {
    const { error: metaErr } = await sb.auth.updateUser({ data:{ full_name:name }, ...(updates.email?{email:updates.email}:{}) });
    hideLoad();
    if (metaErr) { al.textContent=metaErr.message; al.className="st-alert"; al.classList.remove("hidden"); return; }
  } else {
    if (currentUser) { currentUser.user_metadata = { ...currentUser.user_metadata, full_name: name }; if (updates.email) currentUser.email = email; }
    hideLoad();
  }
  al.textContent="✓ Profile updated successfully!"; al.className="st-alert ok"; al.classList.remove("hidden");
  setTimeout(() => { al.classList.add("hidden"); }, 3000);
  const newFirst = name.split(" ")[0];
  const navAv   = document.getElementById("nav-av");
  const navName = document.getElementById("nav-name");
  if (!localStorage.getItem("iai-avatar")) {
    if (navAv) navAv.textContent = newFirst[0].toUpperCase();
  }
  if (navName) navName.textContent = newFirst;
  const letterEl = document.getElementById("st-avatar-letter");
  if (letterEl) letterEl.textContent = newFirst[0].toUpperCase();
  else { const stAvDiv = document.getElementById("st-avatar"); if (stAvDiv && !stAvDiv.querySelector("img")) stAvDiv.textContent = newFirst[0].toUpperCase(); }
  const stName  = document.getElementById("st-avatar-name");
  const stEmail = document.getElementById("st-avatar-email");
  if (stName)  stName.textContent  = name;
  if (stEmail) stEmail.textContent = email;
  if (SUPABASE_CONFIGURED && sb) {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        currentUser = data.session.user;
        upsertSavedAccount(currentUser, data.session);
        await sb.from("profiles").upsert({
          id: currentUser.id,
          full_name: name,
          updated_at: new Date().toISOString()
        });
      }
    } else {
      if (currentUser) upsertSavedAccount(currentUser, null);
    }
  }

async function changePassword() {
  const newPass = document.getElementById("st-new-pass").value;
  const confirm = document.getElementById("st-confirm-pass").value;
  const al      = document.getElementById("security-alert");
  al.classList.add("hidden");

  if (!newPass||!confirm) { al.textContent="Please fill in both fields."; al.className="st-alert"; al.classList.remove("hidden"); return; }
  if (newPass.length<8) { al.textContent="Password must be at least 8 characters."; al.className="st-alert"; al.classList.remove("hidden"); return; }
  if (newPass!==confirm) { al.textContent="Passwords do not match."; al.className="st-alert"; al.classList.remove("hidden"); return; }

  showLoad("Updating password...");
  if (SUPABASE_CONFIGURED && sb) {
    const { error } = await sb.auth.updateUser({ password:newPass });
    hideLoad();
    if (error) { al.textContent=error.message; al.className="st-alert"; al.classList.remove("hidden"); return; }
  } else {
    hideLoad();
  }
  al.textContent="✓ Password updated successfully!"; al.className="st-alert ok"; al.classList.remove("hidden");
  setTimeout(() => { al.classList.add("hidden"); }, 3000);
  document.getElementById("st-new-pass").value="";
  document.getElementById("st-confirm-pass").value="";
}

function selVoice(el) {
  document.querySelectorAll(".voice-opt").forEach(o=>{ o.classList.remove("selected"); o.querySelector(".vo-check")?.classList.add("hidden"); });
  el.classList.add("selected"); el.querySelector(".vo-check")?.classList.remove("hidden");
  appSettings.voice = el.dataset.id;
  saveSettings();
  previewVoice(el.dataset.id, el.querySelector(".vo-name")?.textContent || "Voice");
}

let previewAudio = null;

const VOICE_BROWSER_MAP = {
  "21m00Tcm4TlvDq8ikWAM": { gender:"female", pitch:1.1, rate:0.95 },
  "EXAVITQu4vr4xnSDxMaL": { gender:"female", pitch:1.2, rate:0.90 },
  "ErXwobaYiN019PkySvjV": { gender:"male",   pitch:0.9, rate:0.95 },
  "TxGEqnHWrfWFTfGW9XjX": { gender:"male",   pitch:0.75,rate:0.88 },
  "pNInz6obpgDQGcFmaJgB": { gender:"male",   pitch:0.85,rate:1.0  },
};

function getBrowserVoice(gender) {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const gv = voices.filter(v => gender === "female"
    ? v.name.toLowerCase().includes("female") || ["samantha","victoria","karen","moira","susan","zira","hazel"].some(n=>v.name.toLowerCase().includes(n))
    : v.name.toLowerCase().includes("male") || ["daniel","alex","fred","tom","james","david","mark"].some(n=>v.name.toLowerCase().includes(n))
  );
  return gv.length ? gv[0] : voices[0];
}

async function previewVoice(voiceId, voiceName) {
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  window.speechSynthesis?.cancel();

  const sampleText = `Hello, I am ${voiceName}. I will be conducting your interview today. Shall we begin?`;
  const btn = document.querySelector(`[data-id="${voiceId}"] .vo-preview-btn`);

  // Always try ElevenLabs proxy first — falls back to browser TTS on failure

  try {
    if (btn) btn.textContent = "⏳";

    const res = await fetch(`${OPENAI_URL}/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        text: sampleText,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability:.70, similarity_boost:.45, style:.0, use_speaker_boost:true }
      })
    });

    if (btn) btn.textContent = "▶";

    if (!res.ok) {
      const cfg = VOICE_BROWSER_MAP[voiceId] || { gender:"female", pitch:1.0, rate:0.93 };
      const utt = new SpeechSynthesisUtterance(sampleText);
      utt.rate=cfg.rate; utt.pitch=cfg.pitch;
      const pick = getBrowserVoice(cfg.gender);
      if (pick) utt.voice = pick;
      window.speechSynthesis.speak(utt);
      return;
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    previewAudio = new Audio(url);
    previewAudio.play();
    previewAudio.onended = () => { previewAudio = null; if (btn) btn.textContent = "▶"; };

  } catch(e) {
    if (btn) btn.textContent = "▶";
    const cfg = VOICE_BROWSER_MAP[voiceId] || { gender:"female", pitch:1.0, rate:0.93 };
    const utt = new SpeechSynthesisUtterance(sampleText);
    utt.rate=cfg.rate; utt.pitch=cfg.pitch;
    window.speechSynthesis.speak(utt);
  }
}

function previewSpeed(rate) {
  window.speechSynthesis?.cancel();
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  const samples = {
    0.75: "This... is... the... slow... speaking... pace. Notice how each word has more space.",
    0.93: "This is the normal speaking pace. Clear and easy to follow.",
    1.4:  "This is the fast speaking pace! Notice how quick the words flow now."
  };
  const text = samples[rate] || "This is a speed preview.";
  const utt  = new SpeechSynthesisUtterance(text);
  utt.rate   = rate;
  utt.pitch  = 1.0;
  window.speechSynthesis.speak(utt);
}

function selSpeed(btn) {
  const parent = btn.closest(".stt-card") || btn.closest(".st-section-card");
  if (parent) parent.querySelectorAll(".speed-opt").forEach(b=>b.classList.remove("selected"));
  btn.classList.add("selected");
  appSettings.speed = parseFloat(btn.dataset.v);
  saveSettings();
  previewSpeed(appSettings.speed);
}

function selSilence(btn) {
  const parent = btn.closest(".stt-card") || btn.closest(".st-section-card");
  if (parent) parent.querySelectorAll(".speed-opt").forEach(b=>b.classList.remove("selected"));
  btn.classList.add("selected");
  appSettings.silence = parseInt(btn.dataset.v);
  saveSettings();
}

function clearHistory() {
  showConfirm("Clear session history?","This will remove all your saved practice sessions. This cannot be undone.", async () => {
    try { localStorage.removeItem(getSessionsKey()); } catch(e) {}
    if (SUPABASE_CONFIGURED && sb && currentUser) {
      await sb.from("sessions").delete().eq("user_id", currentUser.id);
    }
    document.getElementById("acc-sessions").textContent = "0";
    loadDashStats();
    loadRecentSessions();
    alert("Session history cleared.");
  });
}

async function confirmDeleteAccount() {
  showConfirm("Delete account?","This will permanently delete your account and all data. This action cannot be undone.", async () => {
    showLoad("Deleting account...");
    if (SUPABASE_CONFIGURED && sb) {
      try {
        await sb.rpc("delete_user");
      } catch(e) {}
      await sb.auth.signOut();
    }
    try { localStorage.removeItem(getSessionsKey()); } catch(e) {}
    try { localStorage.removeItem("iai-avatar"); } catch(e) {}
    try { removeFromSavedAccounts(currentUser?.id); } catch(e) {}
    hideLoad();
    currentUser = null;
    showPage("page-auth");
  });
}

// ─── START INTERVIEW ─────────────────────────────────
async function startInterview() {
  if (!currentUser) { showPage("page-auth"); return; }
  if (!document.getElementById("cq-wrap").classList.contains("hidden")) {
    const v = parseInt(document.getElementById("cq-input").value)||1;
    totalQ = Math.min(10,Math.max(1,v));
  }

  currentQ=0; allAnswers=[]; convoHistory=[]; liveTranscript="";
  fillerCount=0; wordCount=0; isListening=false; interviewDone=false;
  sessionOwnerKey = getSessionsKey();
  isPaused=false; warmupDone=false; warmupTurns=0; interviewStarted=false;
  sessionSeed=Date.now(); currentAudio=null; currentUtt=null;

  document.getElementById("sb-industry").textContent = IND_LABELS[selIndustry];
  document.getElementById("sb-level").textContent    = LVL_LABELS[selLevel];
  document.getElementById("sb-prog").style.width     = "0%";
  document.getElementById("sb-prog-label").textContent = "Warmup";
  document.getElementById("iv-chat").innerHTML       = "";
  document.getElementById("itz-text").innerHTML      = `<span class="itz-placeholder">Speak your answer — it appears here in real time...</span>`;

  setMicState(false); setSkipState(false); setPauseState(false);
  setSbStatus("thinking","Connecting...");
  showPage("page-interview");
  await sleep(300);
  await unlockAudioForIOS();
  await beginInterview();
}

// ─── INTERVIEW FLOW ──────────────────────────────────
let interviewStarted = false;
async function beginInterview() {
  if (convoHistory.length > 0 || interviewStarted) return;
  interviewStarted = true;
  setSbStatus("thinking","AI is preparing...");
  showTyping();
  const kickoff = [{ role:"user", parts:[{ text:"Start the interview now. Say hello and ask how the candidate is doing." }] }];
  const reply = await callGemini(buildWarmupPrompt(), kickoff);
  if (!reply || interviewDone) { removeTyping(); return; }
  convoHistory.push({ role:"model", parts:[{ text:reply }] });
  removeTyping();
  setSbStatus("speaking","AI is speaking");
  setPauseState(true);
  await typewriterMsg("ai", reply);
  await speakText(reply);
  setPauseState(false);
  if (!interviewDone) {
    setSbStatus("listening","Listening...");
    await sleep(1200);
    if (!interviewDone) startListening();
  }
}

async function handleAnswer(answer) {
  if (interviewDone) return;
  stopListening();
  addUserMsg(answer);

  if (warmupDone) {
    allAnswers.push({ question: getLastAIMsg(), answer, fillers: fillerCount, words: wordCount });
    currentQ++;
    updateSbProgress();
  } else {
    warmupTurns++;
  }

  liveTranscript = ''; fillerCount = 0; wordCount = 0; resetStats();
  document.getElementById('itz-text').innerHTML =
    `<span class="itz-placeholder">Speak your answer — it appears here in real time...</span>`;
  document.getElementById('itz-dot').classList.remove('live');
  document.getElementById('itz-hint').textContent = 'Processing...';

  // Add user answer to history
  convoHistory.push({ role: 'user', parts: [{ text: answer }] });

  if (warmupDone && currentQ >= totalQ) { await doEndAndScore(); return; }

  setSbStatus('thinking', 'AI is thinking...');
  showTyping();
  setMicState(false); setSkipState(false);

  const isSkipped = answer === '(No answer — skipped)' || answer.trim().length < 3;

  let sys, instruction;

  if (!warmupDone && warmupTurns >= 3) {
    // ── Transition to technical phase ──
    warmupDone = true;
    document.getElementById('sb-prog-label').textContent = 'Q 1 / ' + totalQ;
    sys = buildTransitionPrompt();
    instruction = isSkipped
      ? `The candidate did not respond. Transition to technical questions: briefly say "No worries, let's move on!" then ask the first technical question (Q 1 of ${totalQ}).`
      : `Transition smoothly — one short sentence like "Great, let's move to some specific questions now." Then ask the first technical question (Q 1 of ${totalQ}).`;

  } else if (!warmupDone) {
    // ── Still in warmup ──
    sys = buildWarmupPrompt();
    instruction = isSkipped
      ? 'The candidate did not respond. Politely acknowledge this and ask a simpler warmup question. Do not pretend they answered.'
      : 'Based on their answer, ask ONE specific natural follow-up question about their background. Be conversational.';

  } else {
    // ── Technical question ──
    sys = buildTechnicalPrompt();
    instruction = isSkipped
      ? `Candidate skipped. Briefly acknowledge ("Let's try another one.") then ask technical question ${currentQ + 1} of ${totalQ}. Seed:${sessionSeed}-Q${currentQ}. Never repeat a previous question.`
      : `React to what the candidate just said in 1 brief sentence — reference something SPECIFIC they mentioned. Then ask the next technical question (${currentQ + 1} of ${totalQ}). Seed:${sessionSeed}-Q${currentQ}. Never repeat a previous question.`;
  }

  // ── FIXED: instruction goes into a TEMP array, not convoHistory ──
  // This stops the model seeing accumulated instructions on every turn.
  const messagesForThisTurn = [...convoHistory, { role: 'user', parts: [{ text: instruction }] }];
  const reply = await callGemini(sys, messagesForThisTurn);

  if (!reply || interviewDone) { removeTyping(); return; }

  // Only the AI's actual reply is saved to history
  convoHistory.push({ role: 'model', parts: [{ text: reply }] });

  removeTyping();
  setSbStatus('speaking', 'AI is speaking');
  setPauseState(true);
  await typewriterMsg('ai', reply);
  await speakText(reply);
  setPauseState(false);
  await sleep(1300);
  if (!interviewDone) {
    setSbStatus('listening', 'Listening...');
    await sleep(500);
    if (!interviewDone) startListening();
  }
}
// ─── PROMPTS ─────────────────────────────────────────
function buildWarmupPrompt() {
  const openers = [
    "Start with a warm hello and ask how they are doing today.",
    "Greet them enthusiastically and ask if they are ready to begin.",
    "Welcome them and ask what made them interested in this role.",
    "Say hello and ask them to tell you a little about themselves.",
    "Greet them and ask how their day has been so far."
  ];
  const opener = openers[Math.floor(Math.random() * openers.length)];
  return `You are a professional, warm HR interviewer at a top ${IND_LABELS[selIndustry]} company. You are conducting a real ${LVL_LABELS[selLevel]} job interview.
WARMUP RULES: ${opener} Then naturally ask them to introduce themselves if not already done. Listen to their answer and ask ONE specific follow-up about exactly what they mentioned. Max 2-3 sentences per turn. Never evaluate or score. Vary your language and tone each session — never repeat the same opening phrase.`;
}

function buildTransitionPrompt() {
  return `You are a professional HR interviewer at a ${IND_LABELS[selIndustry]} company. You are moving from warmup to the technical interview.
CRITICAL: You just heard the candidate's warmup answer. Reference something SPECIFIC they just said before transitioning. Never use a generic transition. Be smooth, professional, and natural. Keep it to 2 sentences max.`;
}

function buildTechnicalPrompt() {
  const topics = {
    tech:["a specific project you built and your role","your debugging approach when something breaks","system design or architecture thinking","why you chose a particular tech stack","handling technical debt in a codebase","your code review process","how you learn new technologies quickly","performance optimization you have done","teamwork conflict on a technical project","handling a production incident or outage","a time you refactored legacy code","your experience with version control workflows","how you prioritize tasks with tight deadlines","a challenging bug you solved recently","your experience with testing and QA","how you handle ambiguous requirements","a feature you designed end to end","your approach to documentation","how you stay updated with industry trends","experience mentoring or helping junior developers"],
    banking:["financial analysis you performed","your risk management approach","handling a difficult client relationship","regulatory compliance challenge you faced","attention to detail in financial reporting","a data-driven decision you made","working under market pressure or deadlines","building a financial model","communicating complex findings to stakeholders","fraud detection or prevention experience","portfolio management approach","your experience with auditing processes","handling confidential financial information","a time you identified cost savings","cross-department collaboration in finance","your approach to financial forecasting","dealing with regulatory changes","client onboarding experience","investment analysis methodology","handling discrepancies in financial records"],
    healthcare:["handling a difficult patient situation","working under clinical pressure","multidisciplinary team collaboration","patient privacy and ethical dilemma","keeping up with medical developments","managing emotional demands of healthcare","clinical documentation best practices","responding to a medical error","patient education approach you used","triage and prioritization under pressure","infection control experience","handling family members of patients","adapting to new medical technology","a time you advocated for a patient","managing workload during staff shortages","your approach to continuing education","handling a disagreement with a colleague","experience with electronic health records","cultural sensitivity in patient care","emergency response situation you handled"],
    education:["your classroom management approach","handling a disruptive student situation","curriculum design experience","communicating with difficult parents","inclusive teaching methods you use","your student assessment approach","professional development that changed your teaching","integrating technology in your classroom","supporting diverse learners effectively","motivating a disengaged student","differentiating instruction for varied levels","handling bullying or conflict between students","collaborating with other teachers","adapting lessons when plans fail","your approach to homework and grading","building relationships with students","teaching a concept students struggle with","using data to improve instruction","creating a positive classroom culture","handling administrative pressures while teaching"],
    engineering:["a complex engineering problem you solved","managing project timelines and delays","your safety compliance approach","working within tight design constraints","cross-functional team collaboration","technical documentation practices","your quality assurance methodology","handling unexpected project scope changes","engineering tools and software expertise","translating client requirements to specs","failure analysis you conducted","your approach to prototyping","cost estimation for engineering projects","environmental considerations in your work","experience with regulatory standards","a design trade-off decision you made","field testing or commissioning experience","handling vendor or supplier issues","your approach to continuous improvement","risk assessment in engineering projects"]
  };
  const previousQuestions = allAnswers.map(a => a.question).join(" | ");
  const pool = topics[selIndustry] || topics.tech;
  // Shuffle with session seed + current question number for unique selection
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 5).join(", ");
  return `You are a professional HR interviewer at a top ${IND_LABELS[selIndustry]} company. Technical interview phase for ${LVL_LABELS[selLevel]} candidate.
  RULES: Ask exactly ONE question. Max 3 sentences total.
  STEP 1 — React: Give a genuine 1-sentence reaction that references something SPECIFIC and UNIQUE the candidate just said. Do NOT use generic phrases like "Great answer" or "That's interesting". Instead say something like "Using Redis for caching in that scenario was a smart call" or "Handling the patient's family that way shows real emotional intelligence."
  STEP 2 — Ask: Ask the next technical question about a completely different topic.
  CRITICAL — NEVER repeat or rephrase: [${previousQuestions}]
  Pick from these unused topics: ${picked}.
  Question ${currentQ + 1} of ${totalQ}. Be specific and creative — no generic questions.`;
}

// ─── OPENAI API ──────────────────────────────────────
async function callClaude(sys, history, attempt=1) {
  if (interviewDone) return null;
  try {
    const messages = [
      { role: "system", content: sys },
      ...history.map(h => ({
        role: h.role === "model" ? "assistant" : "user",
        content: h.parts.map(p => p.text).join(" ")
      }))
    ];

    const res = await fetch(OPENAI_URL + "/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OPENAI_KEY
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 300,
        temperature: 0.95,
        messages: messages
      })
    });

    const data = await res.json();

    if (data.error) {
      if (attempt < 3) { await sleep(3500); return callClaude(sys, history, attempt + 1); }
      addErrMsg("Connection issue — " + (data.error.message || "Unknown error").slice(0, 100));
      return null;
    }

    return data.choices[0].message.content.trim();

  } catch(e) {
    if (attempt < 3) { await sleep(3500); return callClaude(sys, history, attempt + 1); }
    addErrMsg("Network error. Check your internet connection.");
    return null;
  }
}

const callGemini = callClaude;

// ─── TYPEWRITER ──────────────────────────────────────
async function typewriterMsg(role, text) {
  if (interviewDone && role==="ai") return;
  const area = document.getElementById("iv-chat");
  const time = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  const storedAvatar = localStorage.getItem("iai-avatar");
  const userInitial = currentUser?.user_metadata?.full_name?.[0]?.toUpperCase()||"U";
  const userAvHTML = (role==="user" && storedAvatar)
    ? `<img src="${storedAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" alt="avatar"/>`
    : (role==="ai" ? "AI" : userInitial);

  const div = document.createElement("div");
  div.className = `cm ${role}`;
  div.innerHTML = `
    <div class="cm-av">${userAvHTML}</div>
    <div class="cm-body">
      <div class="cm-bubble" id="tw"></div>
      <div class="cm-time">${time}</div>
    </div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;

  const bubble = div.querySelector("#tw");
  bubble.removeAttribute("id");

  if (role==="user") { bubble.textContent=text; area.scrollTop=area.scrollHeight; return; }

  let i=0;
  await new Promise(r => {
    const iv = setInterval(()=>{
      if (isPaused) return;
      bubble.textContent = text.slice(0,++i);
      area.scrollTop = area.scrollHeight;
      if (i>=text.length) { clearInterval(iv); r(); }
    },35);
  });
}

function addUserMsg(text) {
  const area = document.getElementById("iv-chat");
  const time = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  const storedAvatar = localStorage.getItem("iai-avatar");
  const userInitial = currentUser?.user_metadata?.full_name?.[0]?.toUpperCase()||"U";
  const avHTML = storedAvatar
    ? `<img src="${storedAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" alt="avatar"/>`
    : userInitial;
  const div  = document.createElement("div");
  div.className = "cm user";
  div.innerHTML = `
    <div class="cm-av">${avHTML}</div>
    <div class="cm-body">
      <div class="cm-bubble">${text}</div>
      <div class="cm-time">${time}</div>
    </div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function addErrMsg(msg) {
  removeTyping();
  const area = document.getElementById("iv-chat");
  const div  = document.createElement("div");
  div.className = "cm-err";
  const short = msg.length > 120 ? msg.slice(0,120) + "..." : msg;
  const hasMore = msg.length > 120;
  const eid = "err-" + Date.now();
  div.innerHTML = `
    <div class="cm-av" style="background:var(--grad);color:white;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0">AI</div>
    <div class="cm-err-bubble">
      <p class="cm-err-title">⚠ Connection Issue</p>
      <p class="cm-err-msg" id="${eid}-short">${short}</p>
      ${hasMore ? `<p class="cm-err-msg hidden" id="${eid}-full">${msg}</p>
      <button onclick="toggleErrExpand('${eid}')" id="${eid}-btn" style="background:none;border:none;color:rgba(252,165,165,.7);font-size:12px;cursor:pointer;padding:0;margin-top:6px;font-family:inherit;text-decoration:underline">Show full error</button>` : ""}
    </div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function toggleErrExpand(eid) {
  const short = document.getElementById(eid+"-short");
  const full  = document.getElementById(eid+"-full");
  const btn   = document.getElementById(eid+"-btn");
  const isShowing = !full.classList.contains("hidden");
  if (isShowing) {
    full.classList.add("hidden"); short.classList.remove("hidden");
    btn.textContent = "Show full error";
  } else {
    full.classList.remove("hidden"); short.classList.add("hidden");
    btn.textContent = "Show less";
  }
}

function showTyping() {
  removeTyping();
  const area = document.getElementById("iv-chat");
  const div  = document.createElement("div");
  div.id = "typing-ind";
  div.className = "cm-typing";
  div.innerHTML = `
    <div class="cm-av" style="background:var(--grad);color:white">AI</div>
    <div class="cm-typing-dots"><div class="td"></div><div class="td"></div><div class="td"></div></div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function removeTyping() { document.getElementById("typing-ind")?.remove(); }

function getLastAIMsg() {
  const bubbles = document.querySelectorAll(".cm.ai .cm-bubble");
  return bubbles.length ? bubbles[bubbles.length-1].textContent : "Question";
}

// ─── VOICE ───────────────────────────────────────────
// ─── PLATFORM DETECTION ──────────────────────────────
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}
function supportsWebSpeech() {
  // Web Speech API works on Chrome, Edge, Android Chrome — NOT iOS Safari
  return ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) && !isIOS();
}


// ─── START LISTENING ─────────────────────────────────
function startListening() {
  isListening      = true;
  liveTranscript   = '';
  hasSpeechStarted = false;

  setMicState(true);
  setSkipState(true);
  document.getElementById('iv-mic-btn').classList.add('on');
  document.getElementById('mic-r1').classList.add('pulse');
  document.getElementById('mic-r2').classList.add('pulse');
  document.getElementById('itz-dot').classList.add('live');
  document.getElementById('itz-hint').textContent = 'Listening — tap mic to submit';
  document.getElementById('itz-text').innerHTML =
    `<span class="itz-placeholder">Listening... speak your answer</span>`;

  if (supportsWebSpeech()) {
    startWebSpeechRecognition();   // Desktop / Android
  } else {
    startWhisperRecording();       // iOS Safari fallback
    document.getElementById('itz-text').innerHTML =
      `<span class="itz-placeholder">🎙 Recording... tap the mic button when done</span>`;
    document.getElementById('itz-hint').textContent = 'Tap mic when finished speaking';
  }
}

// ─── STOP LISTENING ──────────────────────────────────
function stopListening() {
  isListening = false;
  clearTimeout(silenceTimer);

  if (speechRecognition) {
    try { speechRecognition.abort(); } catch(e) {}
    speechRecognition = null;
  }
  // mediaRecorder is NOT stopped here — manualSubmit handles it
  // so transcribeWithWhisper completes before handleAnswer is called

  document.getElementById('iv-mic-btn').classList.remove('on');
  document.getElementById('mic-r1').classList.remove('pulse');
  document.getElementById('mic-r2').classList.remove('pulse');
  document.getElementById('itz-dot').classList.remove('live');
  document.getElementById('itz-hint').textContent = 'Processing...';
  setMicState(false);
  setSkipState(false);
}

// ═══════════════════════════════════════════════════
//  WEB SPEECH API  (Chrome, Edge, Android)
//  Shows text LIVE as user speaks.
//  Only submits after the user STOPS + silence delay elapses.
// ═══════════════════════════════════════════════════
function startWebSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognition = new SR();
  speechRecognition.continuous      = true;
  speechRecognition.interimResults  = true;
  speechRecognition.lang            = 'en-US';
  speechRecognition.maxAlternatives = 1;

  let finalTranscript = '';
  let lastResultTime = Date.now();
  let hasInterim = false;

  speechRecognition.onstart = () => {
    document.getElementById('itz-text').innerHTML =
      `<span class="itz-placeholder">Listening... speak now</span>`;
  };

  speechRecognition.onresult = (event) => {
    if (!isListening) return;

    let interim = '';
    // Rebuild finalTranscript from ALL final results to prevent disappearing text
    finalTranscript = '';
    for (let i = 0; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += t + ' ';
      } else {
        interim += t;
      }
    }

    liveTranscript = (finalTranscript + interim).trim();
    hasInterim = interim.length > 0;
    lastResultTime = Date.now();

    if (liveTranscript) {
      document.getElementById('itz-text').textContent = liveTranscript;
      updateStats(liveTranscript);
      hasSpeechStarted = true;

      // Only start silence timer when there's NO interim (user actually stopped)
      clearTimeout(silenceTimer);
      if (!hasInterim) {
        silenceTimer = setTimeout(() => {
          // Double-check: if new results came in since timer started, skip
          if (Date.now() - lastResultTime < appSettings.silence - 200) return;
          if (isListening && hasSpeechStarted && !interviewDone) {
            autoSubmitAnswer();
          }
        }, appSettings.silence);
      }
    }
  };

  speechRecognition.onspeechend = () => {};

  speechRecognition.onend = () => {
    if (isListening && !interviewDone && speechRecognition) {
      // Preserve finalTranscript across restarts by capturing it
      const savedFinal = finalTranscript;
      try {
        speechRecognition.start();
        // Restore after restart so text doesn't disappear
        setTimeout(() => { finalTranscript = savedFinal; }, 50);
      } catch(e) {}
    }
  };

  speechRecognition.onerror = (e) => {
    if (['no-speech', 'aborted'].includes(e.error)) return;
    if (e.error === 'not-allowed') {
      addErrMsg('Microphone permission denied. Please allow mic access in your browser settings.');
      stopListening();
    }
  };

  try {
    speechRecognition.start();
  } catch(e) {
    speechRecognition = null;
    startWhisperRecording();
  }
}

// ─── AUTO-SUBMIT after silence ───────────────────────
function autoSubmitAnswer() {
  if (!isListening || interviewDone) return;
  const ans = liveTranscript.trim();
  if (ans.length > 0) {
    stopListening();
    handleAnswer(ans);
  }
  // if nothing spoken yet, just keep listening
}

// ─── MANUAL: tap mic button ───────────────────────────
function manualSubmit() {
  if (interviewDone) return;
  clearTimeout(silenceTimer);

  // iOS Whisper path — mediaRecorder is active, must wait for transcription
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    isListening = false;
    document.getElementById('iv-mic-btn').classList.remove('on');
    document.getElementById('mic-r1').classList.remove('pulse');
    document.getElementById('mic-r2').classList.remove('pulse');
    document.getElementById('itz-dot').classList.remove('live');
    document.getElementById('itz-hint').textContent = 'Transcribing...';
    setMicState(false);
    setSkipState(false);
    try { mediaRecorder.stop(); } catch(e) {}
    if (recordingStream) {
      recordingStream.getTracks().forEach(t => t.stop());
      recordingStream = null;
    }
    return;
  }

  // Web Speech path (Chrome/Edge/Android)
  stopListening();
  const ans = liveTranscript.trim();
  handleAnswer(ans || '(No answer — skipped)');
}

// ─── SKIP ─────────────────────────────────────────────
function skipQ() {
  const ans = liveTranscript.trim() || '(No answer — skipped)';
  clearTimeout(silenceTimer);
  stopListening();
  handleAnswer(ans);
}

// ═══════════════════════════════════════════════════
//  iOS WHISPER FALLBACK
//  No live transcript — records then transcribes on submit.
// ═══════════════════════════════════════════════════
async function startWhisperRecording() {
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType  = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                    : MediaRecorder.isTypeSupported('audio/mp4')  ? 'audio/mp4'
                    : 'audio/ogg';
    mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
    audioChunks   = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      if (audioChunks.length > 0) await transcribeWithWhisper();
    };

    mediaRecorder.start(250);
  } catch(e) {
    addErrMsg('Microphone access denied. Please allow mic in browser settings.');
    stopListening();
  }
}

function stopWhisperRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch(e) {}
  }
  if (recordingStream) {
    recordingStream.getTracks().forEach(t => t.stop());
    recordingStream = null;
  }
}

async function transcribeWithWhisper() {
  if (interviewDone) return;
  if (audioChunks.length === 0) { handleAnswer('(No answer — skipped)'); return; }

  document.getElementById('itz-hint').textContent = 'Transcribing...';
  document.getElementById('itz-text').innerHTML =
    `<span class="itz-placeholder">⏳ Processing your audio...</span>`;

  const mimeType = audioChunks[0].type || 'audio/webm';
  const ext      = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const blob     = new Blob(audioChunks, { type: mimeType });
  audioChunks    = [];

  if (blob.size < 1000) { handleAnswer('(No answer — skipped)'); return; }

  const formData = new FormData();
  formData.append('file', blob, `audio.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');

  try {
    const res  = await fetch(OPENAI_URL + '/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + OPENAI_KEY },
      body: formData,
    });
    const data = await res.json();
    if (data.text && data.text.trim()) {
      liveTranscript = data.text.trim();
      document.getElementById('itz-text').textContent = liveTranscript;
      handleAnswer(liveTranscript);
    } else {
      handleAnswer('(No answer — skipped)');
    }
  } catch(e) {
    addErrMsg('Transcription failed. Please try again.');
    handleAnswer('(No answer — skipped)');
  }
}

// ─── PAUSE ───────────────────────────────────────────
function togglePause() {
  isPaused=!isPaused;
  const btn  = document.getElementById("iv-pause-btn");
  const icon = document.getElementById("pause-icon");
  btn.classList.toggle("paused",isPaused);
  icon.innerHTML = isPaused
    ? `<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>`
    : `<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>`;

  if (isPaused) { currentAudio?.pause(); window.speechSynthesis?.pause(); setSbStatus("paused","Paused"); }
  else { currentAudio?.play(); window.speechSynthesis?.resume(); setSbStatus("speaking","AI is speaking"); }
}

// ─── TTS ─────────────────────────────────────────────
async function speakText(text) {
  if (interviewDone) return;
  stopListening();
  // Always try ElevenLabs proxy first — falls back to browserSpeak on failure
  try {
    const res = await fetch(`${OPENAI_URL}/v1/text-to-speech/${appSettings.voice}`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ text, model_id:"eleven_monolingual_v1", voice_settings:{ stability:.68, similarity_boost:.42, style:.0, use_speaker_boost:true } })
    });
    if (!res.ok) { await browserSpeak(text); return; }
    const blob=await res.blob(), url=URL.createObjectURL(blob);
    currentAudio=new Audio(url);
    await new Promise(r=>{ currentAudio.onended=()=>{currentAudio=null;r()}; currentAudio.onerror=()=>{currentAudio=null;r()}; currentAudio.play().catch(()=>browserSpeak(text).then(r)); });
  } catch(e) { await browserSpeak(text); }
}

function browserSpeak(text) {
  return new Promise(r => {
    if (!window.speechSynthesis) { r(); return; }
    window.speechSynthesis.cancel();
    isListening = false;
    clearTimeout(silenceTimer);

    const speak = () => {
      currentUtt = new SpeechSynthesisUtterance(text);
      const cfg = VOICE_BROWSER_MAP[appSettings.voice] || { gender:"male", pitch:0.85, rate:1.0 };
      currentUtt.pitch = cfg.pitch;
      currentUtt.rate = appSettings.speed * (cfg.rate || 1.0);
      const pick = getBrowserVoice(cfg.gender);
      if (pick) currentUtt.voice = pick;
      currentUtt.onend = currentUtt.onerror = () => { currentUtt = null; r(); };
      window.speechSynthesis.speak(currentUtt);
    };

    const voices = window.speechSynthesis.getVoices();
        if (voices.length) {
          speak();
        } else {
          let spoken = false;
          window.speechSynthesis.onvoiceschanged = () => {
            if (!spoken) { spoken = true; speak(); }
          };
          setTimeout(() => {
            if (!spoken) { spoken = true; speak(); }
          }, 400);
        }
  });
}

// ─── END INTERVIEW ───────────────────────────────────
function safeBack() {
  showConfirm("Leave interview?","Your current progress will be lost and you'll return to the dashboard.", ()=>forceExit());
}

function safeEnd() {
  showConfirm(
    "End interview?",
    allAnswers.length>0
      ? `You've answered ${allAnswers.length} question${allAnswers.length>1?"s":""}. The AI will generate your performance report.`
      : "You haven't answered any questions yet.",
    ()=>{ if(allAnswers.length>0) doEndAndScore(); else forceExit(); }
  );
}

function forceExit() {
  interviewDone=true; stopListening();
  clearTimeout(silenceTimer);
  if (recognition) { try { recognition.abort(); } catch(e) {} recognition=null; }
  currentAudio?.pause(); currentAudio=null;
  window.speechSynthesis?.cancel(); currentUtt=null;
  showPage("page-dashboard");
  initDashboard();
}

async function doEndAndScore() {
  interviewDone=true; stopListening();
  currentAudio?.pause(); currentAudio=null;
  window.speechSynthesis?.cancel(); currentUtt=null;
  showLoad("Analysing your interview...");
  await getReport();
}

// ─── SCORING ─────────────────────────────────────────
async function getReport() {
  const aText = allAnswers.map((a,i)=>
    `Q${i+1}: ${a.question}\nAnswer: ${a.answer}\nWords: ${a.words}, Fillers: ${a.fillers}`
  ).join("\n\n");

  const scoring = `CRITICAL SCORING — score based on CONTENT QUALITY. This is speech-to-text so ignore ALL punctuation, grammar, and filler words in scoring.
      SKIPPED or "(No answer — skipped)" or under 5 words: overallScore 0-10.
      POOR (vague, off-topic, no real substance): 20-35.
      BASIC (somewhat relevant but generic, no examples): 38-52.
      DECENT (relevant answer with some specifics, shows understanding): 53-65.
      GOOD (clear understanding, gives real examples, structured): 66-78.
      STRONG (detailed examples, well-structured, shows depth): 79-88.
      EXCELLENT (exceptional depth, multiple specific examples, impressive industry knowledge): 89-96.
      IMPORTANT CALIBRATION RULES:
      - This is a VOICE interview — spoken answers are naturally shorter than written ones. Be generous.
      - A 60-80 word spoken answer with a real example = GOOD (66-75).
      - A 30-60 word answer that directly addresses the question = DECENT (53-65).
      - Penalize only for truly irrelevant or empty answers.
      - Each filler word (um, uh, basically, literally) reduces fluencyScore by 2 ONLY, not the overall score.
      - Never score below 35 if the candidate made a genuine attempt to answer.
      - NEVER give the same score to every question — vary based on actual answer quality.`;

  const prompt = `Evaluate this ${LVL_LABELS[selLevel]} ${IND_LABELS[selIndustry]} interview.
${scoring}
ANSWERS:\n${aText}
Return ONLY raw JSON no markdown:
{"overallScore":NUMBER,"communicationScore":NUMBER,"contentScore":NUMBER,"confidenceScore":NUMBER,"fluencyScore":NUMBER,"grade":"GRADE","strength":"describe actual strength","weakness":"describe actual weakness","improvements":["tip1","tip2","tip3"],"answerFeedback":[{"score":NUMBER,"note":"specific feedback per answer"}]}
Grade: Excellent(85+)/Good(65-84)/Fair(40-64)/Needs Work(<40). answerFeedback: exactly ${allAnswers.length} items.`;

  for (let attempt=1; attempt<=3; attempt++) {
    try {
      document.getElementById("ov-load-text").textContent = attempt>1?`Retrying (${attempt}/3)...`:"Analysing your interview...";
      const res  = await fetch(OPENAI_URL + "/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + OPENAI_KEY
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          max_tokens: 1000,
          temperature: 0.4,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      if (data.error) { if(attempt<3){await sleep(3500);continue;} throw new Error(data.error.message); }
      let raw = data.choices[0].message.content.trim().replace(/```json|```/g,"").trim();
      const report = JSON.parse(raw);
            await saveSession(report.overallScore);
            hideLoad(); renderResults(report); return;
    } catch(e) {
      if (attempt<3) { await sleep(3500); continue; }
      const avgW=allAnswers.reduce((s,a)=>s+a.words,0)/allAnswers.length;
      const avgF=allAnswers.reduce((s,a)=>s+a.fillers,0)/allAnswers.length;
      let base = avgW<1?5:avgW<6?15:avgW<16?32:avgW<36?48:avgW<71?62:avgW<121?76:88;
      base = Math.max(10,Math.round(base-avgF*3));
      const gr = base>=85?"Excellent":base>=65?"Good":base>=40?"Fair":"Needs Work";
      await saveSession(base);
            hideLoad();
            renderResults({ overallScore:base, communicationScore:Math.round(base-4), contentScore:Math.round(base+3), confidenceScore:Math.round(base-2), fluencyScore:Math.max(10,Math.round(base-avgF*4)), grade:gr,
        strength:"Interview session completed.", weakness:"AI analysis unavailable — score estimated from response length and fluency.",
        improvements:["Speak in full detailed sentences","Use the STAR method for behavioural questions","Pause instead of using filler words"],
        answerFeedback:allAnswers.map(a=>({ score:Math.max(0,Math.round((a.words<1?3:a.words<6?15:a.words<16?30:a.words<36?45:60)-a.fillers*3)), note:a.words<1?`Skipped — no answer provided.`:`${a.words} words, ${a.fillers} fillers.` }))
      });
    }
  }
}

// ─── RENDER RESULTS ──────────────────────────────────
function renderResults(r) {
  showPage("page-results");
  document.getElementById("res-meta").textContent = `${IND_LABELS[selIndustry]} · ${LVL_LABELS[selLevel]} · ${allAnswers.length} Question${allAnswers.length!==1?"s":""}`;

  setTimeout(()=>{
    const ring   = document.getElementById("ring-prog");
    const offset = 364.4-(r.overallScore/100)*364.4;
    ring.style.strokeDashoffset = offset;
    const gc={Excellent:"#3d9970",Good:"#c0243f",Fair:"#e89060","Needs Work":"#ef4444"};
    ring.style.stroke=gc[r.grade]||"#c0243f";
  },150);

  document.getElementById("res-num").textContent   = r.overallScore;
  const grEl = document.getElementById("res-grade");
  grEl.textContent=r.grade;
  const gc={Excellent:"#3d9970",Good:"#c0243f",Fair:"#e89060","Needs Work":"#ef4444"};
  grEl.style.color=gc[r.grade]||"#c0243f";

  setTimeout(()=>{
    setRb("comm",r.communicationScore);
    setRb("cont",r.contentScore);
    setRb("conf",r.confidenceScore);
    setRb("flu", r.fluencyScore);
  },300);

  document.getElementById("sw-str").textContent = r.strength;
  document.getElementById("sw-wk").textContent  = r.weakness;

  document.getElementById("res-tips").innerHTML = r.improvements.map((t,i)=>`
    <div class="res-tip-row"><div class="res-tip-num">${i+1}</div><span>${t}</span></div>`).join("");

  document.getElementById("res-qa").innerHTML = allAnswers.map((a,i)=>{
    const fb=r.answerFeedback?.[i]; const sc=fb?.score??"—"; const note=fb?.note??"";
    const c=sc>=70?"#3d9970":sc>=40?"#e89060":"#ef4444";
    return `<div class="res-qa-item">
      <div class="rqa-q">Q${i+1}: ${a.question}</div>
      <div class="rqa-a">${a.answer}</div>
      <div class="rqa-tags">
        <span class="rqa-tag">Score: <strong style="color:${c}">${sc}/100</strong></span>
        <span class="rqa-tag">${a.words} words</span>
        <span class="rqa-tag">${a.fillers} fillers</span>
        ${note?`<span class="rqa-tag">${note}</span>`:""}
      </div></div>`;
  }).join("");

  setTimeout(() => { loadDashStats(); loadRecentSessions(); }, 500);
}

function setRb(id,val) {
  document.getElementById(`rb-${id}`).style.width=`${val}%`;
  document.getElementById(`rv-${id}`).textContent=`${val}/100`;
}

// ─── UI STATE ─────────────────────────────────────────
function setSbStatus(state, label) {
  const ring = document.getElementById("sb-ai-ring");
  ring.className = "sb-ai-ring " + (state==="thinking"||state==="speaking"||state==="listening" ? state : "");
  document.getElementById("sb-status-text").textContent = label||state;
}

function updateSbProgress() {
  const pct = warmupDone&&totalQ>0 ? (currentQ/totalQ)*100 : 0;
  document.getElementById("sb-prog").style.width = pct+"%";
  document.getElementById("sb-prog-label").textContent = warmupDone ? `Q${currentQ+1}/${totalQ}` : "Warmup";
}

function updateStats(text) {
  const words = text.trim().split(/\s+/).filter(w=>w.length>0);
  wordCount   = words.length;
  fillerCount = 0;
  const lower = text.toLowerCase();
  FILLERS.forEach(fw=>{ const m=lower.match(new RegExp(`\\b${fw}\\b`,"gi")); if(m)fillerCount+=m.length; });
  renderStats();
}

function resetStats() { wordCount=0; fillerCount=0; renderStats(); }

function renderStats() {
  document.getElementById("sb-words").textContent   = wordCount;
  document.getElementById("sb-fillers").textContent = fillerCount;
  document.getElementById("sb-fillers").style.color = fillerCount>3?"var(--red)":"";
  const q=wordCount<6?"Short":wordCount<16?"Basic":wordCount<36?"Decent":wordCount<71?"Good":wordCount<121?"Strong":"Expert";
  document.getElementById("sb-quality").textContent = q;
}

function setMicState(v)   { const b=document.getElementById("iv-mic-btn"); b.disabled=!v; }
function setSkipState(v)  { const b=document.getElementById("iv-skip-btn"); b.disabled=!v; }
function setPauseState(v) { const b=document.getElementById("iv-pause-btn"); b.disabled=!v; }

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function switchToTab(tab) {
  document.querySelectorAll(".ac-tab,.auth-tab,.ap-tab").forEach(t => t.classList.remove("active"));
  const btn = document.getElementById("tab-" + tab);
  if (btn) btn.classList.add("active");
  const tabs = document.getElementById("auth-tabs");
  if (tabs) tabs.removeAttribute("style");
  switchForm(tab);
}

function showSignIn() {
  document.querySelectorAll(".ac-tab,.auth-tab,.ap-tab").forEach(t => t.classList.remove("active"));
  const btn = document.getElementById("tab-login");
  if (btn) btn.classList.add("active");
  const tabs = document.getElementById("auth-tabs");
  if (tabs) tabs.removeAttribute("style");
  switchForm("login");
}

// ─── AVATAR UPLOAD ────────────────────────────────────
function openAvatarChange(e) {
  e.stopPropagation();
  document.getElementById("avatar-file-input").click();
}

function handleAvatarUpload(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 2 * 1024 * 1024) { alert("Image must be smaller than 2MB"); return; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    try { localStorage.setItem("iai-avatar", dataUrl); } catch(err) {}
    applyAvatar(dataUrl);
    input.value = "";
    if (SUPABASE_CONFIGURED && sb && currentUser) {
      await sb.from("profiles").upsert({
        id: currentUser.id,
        avatar_url: dataUrl,
        updated_at: new Date().toISOString()
      });
      const accs = getSavedAccounts();
      const idx = accs.findIndex(a => a.id === currentUser.id);
      if (idx >= 0) { accs[idx].avatar = dataUrl; saveAccountsStore(accs); }
    }
  };
  reader.readAsDataURL(file);
}

function applyAvatar(dataUrl) {
  if (!dataUrl) return;

  const navAv = document.getElementById("nav-av");
  if (navAv) navAv.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" alt="avatar"/>`;

  const stAv = document.getElementById("st-avatar");
  if (stAv) {
    stAv.style.position   = "relative";
    stAv.style.overflow   = "hidden";
    stAv.querySelectorAll("img").forEach(i => i.remove());
    const imgEl = document.createElement("img");
    imgEl.src   = dataUrl;
    imgEl.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;z-index:1";
    stAv.insertBefore(imgEl, stAv.firstChild);
  }

  const swAv = document.getElementById("switch-av");
  if (swAv) swAv.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" alt="avatar"/>`;
}

function loadStoredAvatar() {
  try {
    const stored = localStorage.getItem("iai-avatar");
    if (stored) applyAvatar(stored);
  } catch(e) {}
}

// ─── SWITCH ACCOUNT ──────────────────────────────────
function openSwitchAccount() {
  renderSwitchModal();
  showOv("ov-switch");
}

function renderSwitchModal(view) {
  const container = document.getElementById("switch-modal-body");
  if (!container) return;
  view = view || "accounts";

  if (view === "add") {
    container.innerHTML = `
      <button class="ovs-back-btn" onclick="renderSwitchModal('accounts')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back
      </button>
      <p class="ovs-sub" style="margin-top:12px">Sign in to another account</p>
      <div class="ovs-add-field">
        <label>Email</label>
        <input type="email" id="sw-email" placeholder="another@email.com" autocomplete="email"/>
      </div>
      <div class="ovs-add-field">
        <label>Password</label>
        <div style="position:relative">
          <input type="password" id="sw-pass" placeholder="Password" autocomplete="current-password"
            onkeydown="if(event.key==='Enter')doSwitchLogin()"/>
          <button class="af-eye" onclick="toggleEye('sw-pass',this)" style="position:absolute;right:10px;top:50%;transform:translateY(-50%)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div class="af-alert hidden" id="sw-alert" style="margin-bottom:8px"></div>
      <button class="ovs-switch-btn" style="width:100%;justify-content:center;margin-top:4px" onclick="doSwitchLogin()">
        Sign In
      </button>
    `;
    return;
  }

  const accounts   = getSavedAccounts();
  const currentId  = currentUser?.id;
  const storedAvatar = localStorage.getItem("iai-avatar");

  const accountsHTML = accounts.map(acc => {
    const isActive = acc.id === currentId;
    const avatarHTML = (isActive && storedAvatar)
      ? `<img src="${storedAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" alt="avatar"/>`
      : (acc.avatar && !isActive)
        ? `<img src="${acc.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" alt="avatar"/>`
        : acc.name[0].toUpperCase();
    const activeBadge = isActive ? `<span class="ovs-active-badge">● Active</span>` : "";
    const switchBtn   = !isActive
      ? `<button class="ovs-mini-switch" onclick="switchToAccount('${acc.id}','${acc.accessToken}','${acc.refreshToken}')">Switch</button>`
      : `<span style="font-size:11px;color:var(--txt3)">You</span>`;
    return `
      <div class="ovs-account-row ${isActive ? "ovs-account-active" : ""}">
        <div class="ovs-av">${avatarHTML}</div>
        <div class="ovs-info">
          <div class="ovs-name-row">
            <p class="ovs-name">${acc.name}</p>${activeBadge}
          </div>
          <p class="ovs-email">${acc.email}</p>
        </div>
        ${switchBtn}
      </div>`;
  }).join("");

  container.innerHTML = `
    ${accountsHTML}
    <div class="ovs-divider" style="margin:14px 0"></div>
    <button class="ovs-add-account-btn" onclick="renderSwitchModal('add')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 10-16 0"/><path d="M19 14v6M16 17h6"/></svg>
      Add another account
    </button>
    <button class="ovs-cancel-btn" onclick="closeOv('ov-switch')">Cancel</button>
  `;
}

async function doSwitchLogin() {
  const email = (document.getElementById("sw-email")?.value || "").trim();
  const pass  = document.getElementById("sw-pass")?.value || "";
  if (!email || !pass) { showAuthAlert("sw-alert","Please fill in both fields."); return; }

  const btn = document.querySelector("#switch-modal-body .ovs-switch-btn");
  if (btn) { btn.textContent = "Signing in…"; btn.disabled = true; }

  try {
    if (currentUser) {
      const _curAccs = getSavedAccounts();
      const _curIdx  = _curAccs.findIndex(a => a.id === currentUser.id);
      if (_curIdx >= 0) {
        _curAccs[_curIdx].avatar = localStorage.getItem("iai-avatar") || null;
        saveAccountsStore(_curAccs);
      }
    }

    let targetId = null;
    if (SUPABASE_CONFIGURED && sb) {
      const { data: curSess } = await sb.auth.getSession();
      if (curSess?.session) {
        const _oldAccs = getSavedAccounts();
        const _oldIdx  = _oldAccs.findIndex(a => a.id === currentUser?.id);
        if (_oldIdx >= 0) { _oldAccs[_oldIdx].accessToken = curSess.session.access_token; _oldAccs[_oldIdx].refreshToken = curSess.session.refresh_token; saveAccountsStore(_oldAccs); }
      }
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) { showAuthAlert("sw-alert", error.message); if(btn){btn.textContent="Sign In";btn.disabled=false;} return; }
      targetId = data.user.id;
      const _newAccs = getSavedAccounts();
      const _newIdx  = _newAccs.findIndex(a => a.id === targetId);
      const _newEntry = { id: data.user.id, name: data.user.user_metadata?.full_name || email.split("@")[0], email: data.user.email || email, avatar: _newIdx >= 0 ? _newAccs[_newIdx].avatar : null, accessToken: data.session?.access_token || null, refreshToken: data.session?.refresh_token || null };
      if (_newIdx >= 0) _newAccs[_newIdx] = _newEntry; else _newAccs.push(_newEntry);
      saveAccountsStore(_newAccs);
      currentUser = data.user;
    } else {
      const res = demoLogin(email, pass);
      if (res.error) { showAuthAlert("sw-alert", res.error.message); if(btn){btn.textContent="Sign In";btn.disabled=false;} return; }
      targetId = res.data.user.id;
      currentUser = res.data.user;
      const _dAccs = getSavedAccounts();
      const _dIdx  = _dAccs.findIndex(a => a.id === targetId);
      if (_dIdx < 0) _dAccs.push({ id: targetId, name: currentUser.user_metadata?.full_name || email.split("@")[0], email, avatar: null, accessToken: null, refreshToken: null });
      saveAccountsStore(_dAccs);
    }

    const _finalAccs  = getSavedAccounts();
    const _finalEntry = _finalAccs.find(a => a.id === currentUser?.id);
    if (_finalEntry?.avatar) {
      try { localStorage.setItem("iai-avatar", _finalEntry.avatar); } catch(e) {}
    } else {
      localStorage.removeItem("iai-avatar");
    }

    clearAvatarDOM();
    sessFilterInd   = "all";
    sessFilterScore = "all";
    sessSearchTerm  = "";
    sessionOwnerKey = null;
    closeOv("ov-switch");
    loadStoredAvatar();
    initDashboard();
  } catch(e) {
    showAuthAlert("sw-alert", "Sign in failed. Please try again.");
    if(btn){btn.textContent="Sign In";btn.disabled=false;}
  }
}

async function switchToAccount(accountId, accessToken, refreshToken) {
  if (accountId === currentUser?.id) return;
  showLoad("Switching account…");
  try {
    if (currentUser) {
      const _accs = getSavedAccounts();
      const _curIdx = _accs.findIndex(a => a.id === currentUser.id);
      if (_curIdx >= 0) {
        _accs[_curIdx].avatar = localStorage.getItem("iai-avatar") || null;
        saveAccountsStore(_accs);
      }
    }

    if (SUPABASE_CONFIGURED && sb && accessToken && refreshToken) {
      const { data, error } = await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) throw error;
      const _newAccs = getSavedAccounts();
      const _newIdx  = _newAccs.findIndex(a => a.id === data.user.id);
      if (_newIdx >= 0) {
        _newAccs[_newIdx].accessToken  = data.session?.access_token  || null;
        _newAccs[_newIdx].refreshToken = data.session?.refresh_token || null;
        saveAccountsStore(_newAccs);
      }
      currentUser = data.user;
    } else if (!SUPABASE_CONFIGURED) {
      const _demoAccs  = getSavedAccounts();
      const _demoTarget = _demoAccs.find(a => a.id === accountId);
      if (!_demoTarget) { hideLoad(); renderSwitchModal("add"); return; }
      const _demoUsers    = demoGetUsers();
      const _demoUserEntry = Object.values(_demoUsers).find(u => u.id === accountId);
      currentUser = {
        id:            _demoTarget.id,
        email:         _demoTarget.email,
        user_metadata: { full_name: _demoTarget.name || _demoUserEntry?.name || _demoTarget.email.split("@")[0] }
      };
    } else {
      hideLoad();
      renderSwitchModal("add");
      return;
    }

    const _targetAccs = getSavedAccounts();
    const _targetEntry = _targetAccs.find(a => a.id === accountId);
    if (_targetEntry?.avatar) {
      try { localStorage.setItem("iai-avatar", _targetEntry.avatar); } catch(e) {}
    } else {
      localStorage.removeItem("iai-avatar");
    }

    clearAvatarDOM();
    sessFilterInd   = "all";
    sessFilterScore = "all";
    sessSearchTerm  = "";
    sessionOwnerKey = null;

    hideLoad();
    closeOv("ov-switch");
    loadStoredAvatar();
    initDashboard();
  } catch(e) {
    hideLoad();
    renderSwitchModal("add");
  }
}

function clearAvatarDOM() {
  const navAv = document.getElementById("nav-av");
  if (navAv) { navAv.querySelectorAll("img").forEach(i => i.remove()); }
  const stAv  = document.getElementById("st-avatar");
  if (stAv)  { stAv.querySelectorAll("img").forEach(i => i.remove()); }
  const swAv  = document.getElementById("switch-av");
  if (swAv)  { swAv.querySelectorAll("img").forEach(i => i.remove()); }
}

function addNewAccount() {
  closeOv("ov-switch");
  handleLogout();
}

// ─── PASSWORD RESET VIA EMAIL LINK ───────────────────
async function handleAuthCallback() {
  const hash   = window.location.hash;
  const search = window.location.search;

  if (hash && hash.includes("access_token")) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const type   = params.get("type");
    if (type === "recovery") {
      const accessToken  = params.get("access_token");
      const refreshToken = params.get("refresh_token") || "";
      if (SUPABASE_CONFIGURED && sb && accessToken) {
        await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      }
      history.replaceState(null, "", window.location.pathname);
      showResetPasswordForm();
      return true;
    }
    if (params.get("access_token")) {
      history.replaceState(null, "", window.location.pathname);
      return false;
    }
  }

  if (search && (search.includes("code=") || search.includes("type=recovery"))) {
    const params = new URLSearchParams(search);
    const code   = params.get("code");
    const type   = params.get("type");

    if (type === "recovery" || code) {
      showLoad("Verifying reset link...");
      try {
        if (code && SUPABASE_CONFIGURED && sb) {
          const { data, error } = await sb.auth.exchangeCodeForSession(code);
          hideLoad();
          if (!error) {
            history.replaceState(null, "", window.location.pathname);
            showResetPasswordForm();
            return true;
          }
        }
      } catch(e) {
        hideLoad();
      }
      history.replaceState(null, "", window.location.pathname);
      showResetPasswordForm();
      return true;
    }
  }

  return false;
}

function showResetPasswordForm() {
  showPage("page-auth");
  const tb = document.getElementById("auth-tabs");
  if (tb) tb.style.display = "none";
  ["form-login","form-register","form-forgot"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add("ap-hidden");
  });
  const rf = document.getElementById("form-reset");
  if (rf) rf.classList.remove("ap-hidden");
}

async function handlePasswordReset() {
  const pass    = document.getElementById("reset-pass").value;
  const confirm = document.getElementById("reset-confirm").value;
  const al      = document.getElementById("reset-alert");
  al.classList.add("hidden");

  if (!pass || !confirm)  { showResetAlert("Please fill in both fields."); return; }
  if (pass.length < 8)    { showResetAlert("Password must be at least 8 characters."); return; }
  if (pass !== confirm)   { showResetAlert("Passwords do not match."); return; }

  setBtnLoading("reset-btn","reset-spin",true,"Set New Password");
  if (SUPABASE_CONFIGURED && sb) {
    const { error } = await sb.auth.updateUser({ password: pass });
    setBtnLoading("reset-btn","reset-spin",false,"Set New Password");
    if (error) { showResetAlert(error.message); return; }
  } else {
    setBtnLoading("reset-btn","reset-spin",false,"Set New Password");
  }

  al.textContent = "✓ Password updated! Redirecting to sign in...";
  al.className   = "af-alert ok";
  al.classList.remove("hidden");
  setTimeout(async () => {
    if (SUPABASE_CONFIGURED && sb) await sb.auth.signOut();
    switchForm("login");
  }, 2000);
}

function showResetAlert(msg) {
  const al = document.getElementById("reset-alert");
  al.textContent = msg;
  al.className   = "af-alert";
  al.classList.remove("hidden");
}

// ─── DASHBOARD CONSTELLATION PARTICLES ──────────────
function initDashParticles() {
  const existing = document.getElementById('dash-particle-canvas');
  if (existing) existing.remove();

  const canvas = document.createElement('canvas');
  canvas.id = 'dash-particle-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.4';
  const dashPage = document.getElementById('page-dashboard');
  dashPage.insertBefore(canvas, dashPage.firstChild);

  const ctx = canvas.getContext('2d');
  let w, h, particles = [], mouseX = -1000, mouseY = -1000;
  const PARTICLE_COUNT = 45;
  const CONNECT_DIST = 140;
  const MOUSE_DIST = 180;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.5 + 0.5,
      baseAlpha: Math.random() * 0.5 + 0.2,
      pulse: Math.random() * Math.PI * 2
    });
  }

  let animId;
  function draw() {
    if (!document.getElementById('page-dashboard')?.classList.contains('active')) {
      animId = requestAnimationFrame(draw);
      return;
    }
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += 0.02;

      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      const dmx = p.x - mouseX, dmy = p.y - mouseY;
      const dm = Math.sqrt(dmx * dmx + dmy * dmy);
      if (dm < MOUSE_DIST) {
        const force = (MOUSE_DIST - dm) / MOUSE_DIST * 0.015;
        p.vx += dmx * force;
        p.vy += dmy * force;
      }

      p.vx *= 0.998;
      p.vy *= 0.998;

      const alpha = p.baseAlpha * (0.6 + 0.4 * Math.sin(p.pulse));

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(192,36,63,${alpha})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(192,36,63,${alpha * 0.15})`;
      ctx.fill();

      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dx = p.x - p2.x, dy = p.y - p2.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < CONNECT_DIST) {
          const lineAlpha = (1 - d / CONNECT_DIST) * 0.15;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(192,36,63,${lineAlpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      if (dm < MOUSE_DIST) {
        const lineAlpha = (1 - dm / MOUSE_DIST) * 0.25;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(mouseX, mouseY);
        ctx.strokeStyle = `rgba(224,48,80,${lineAlpha})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    animId = requestAnimationFrame(draw);
  }
  draw();
}
// ─── REMOVE AVATAR ──────────────────────────────────
function removeAvatar() {
  if (SUPABASE_CONFIGURED && sb && currentUser) {
    sb.from("profiles").upsert({
      id: currentUser.id, avatar_url: null, updated_at: new Date().toISOString()
    });
  }
  try { localStorage.removeItem("iai-avatar"); } catch(e) {}

  const navAv = document.getElementById("nav-av");
  if (navAv && currentUser) {
    const name = currentUser?.user_metadata?.full_name || currentUser?.email?.split("@")[0] || "User";
    navAv.textContent = name[0].toUpperCase();
    navAv.querySelectorAll("img").forEach(i => i.remove());
  }

  const stAv = document.getElementById("st-avatar");
  if (stAv) {
    stAv.querySelectorAll("img").forEach(i => i.remove());
    const letter = document.getElementById("st-avatar-letter");
    if (letter && currentUser) {
      const name = currentUser?.user_metadata?.full_name || currentUser?.email?.split("@")[0] || "User";
      letter.textContent = name[0].toUpperCase();
    }
  }

  const swAv = document.getElementById("switch-av");
  if (swAv && currentUser) {
    const name = currentUser?.user_metadata?.full_name || currentUser?.email?.split("@")[0] || "User";
    swAv.textContent = name[0].toUpperCase();
    swAv.querySelectorAll("img").forEach(i => i.remove());
      }
    }

    async function unlockAudioForIOS() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (!isIOS && !isSafari) return;

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:99999;
        background:rgba(10,4,7,0.96);
        display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:20px;
      `;
      overlay.innerHTML = `
        <div style="font-size:52px">🎙️</div>
        <p style="color:#fdf0ea;font-size:20px;font-weight:700;text-align:center;padding:0 24px;margin:0">
          Tap to enable voice
        </p>
        <p style="color:rgba(253,240,234,.5);font-size:14px;text-align:center;padding:0 32px;margin:0;line-height:1.6">
          Safari requires a tap to activate the microphone and audio
        </p>
        <button id="ios-unlock-btn" style="
          padding:16px 44px;
          background:linear-gradient(135deg,#8b1228,#c0243f);
          color:white;border:none;border-radius:12px;
          font-size:17px;font-weight:700;
          font-family:inherit;cursor:pointer;
          box-shadow:0 4px 20px rgba(192,36,63,.5);
        ">Start Interview</button>
      `;
      document.body.appendChild(overlay);

      document.getElementById('ios-unlock-btn').addEventListener('click', () => {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const buf = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
          setTimeout(() => ctx.close(), 100);
        } catch(e) {}

        try {
          const utt = new SpeechSynthesisUtterance('');
          window.speechSynthesis.speak(utt);
        } catch(e) {}

        overlay.remove();
        resolve();
      }, { once: true });
    });
  }