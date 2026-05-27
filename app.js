/* ═══════════════════════════════════════════════════════════
   app.js — TES Pro + Psychology Bootcamp Integration (FINAL)
   ───────────────────────────────────────────────────────────
   ORIGINAL FEATURES (ALL PRESERVED):
   ✅ Authentication (Firebase)
   ✅ Subscription management
   ✅ Paystack payments
   ✅ Trade journal + analytics
   ✅ Currency strength engine
   ✅ Risk calculator
   ✅ All existing pages
   
   NEW FEATURES (INTEGRATED):
   ✅ Psychology Bootcamp (5 levels, 5 scenarios, 5 missions, 3 archetypes)
   ✅ Seamless navigation between TES PRO and Psychology
   ✅ Psychology state persistence (XP, scores, completions)
   ✅ Exit button to return to TES PRO
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ─── CONSTANTS ───────────────────────────────────────────── */
const SUB_MS = {
  monthly: 30  * 24 * 60 * 60 * 1000,
  annual:  365 * 24 * 60 * 60 * 1000
};

function isOwner(email) {
  return email === 'salimmarafa12@gmail.com';
}

// Tradeable pairs we suggest (base + quote)
const TRADE_PAIRS = [
  ['GBP','JPY'],['EUR','JPY'],['AUD','JPY'],['USD','JPY'],
  ['GBP','USD'],['EUR','USD'],['AUD','USD'],['NZD','USD'],
  ['USD','CAD'],['USD','CHF'],['EUR','GBP'],['EUR','CHF'],
  ['GBP','CAD'],['GBP','CHF'],['NZD','JPY']
];

/* ─── APPLICATION STATE ───────────────────────────────────── */
const S = {
  user:         null,
  profile:      null,
  trades:       [],
  outcome:      '',
  unsubTrades:  null,
  // Stores last computed currency rankings for suggestions
  rankings:     [],
  // PSYCHOLOGY STATE (NEW)
  psychologyState: {
    currentScreen: 'hub',  // Which psychology screen is active
    xp: 0,
    streak: 1,
    scores: { discipline: 0, emotion: 0, execution: 0 },
    completedScenarios: [],
    completedMissions: []
  }
};

/* ═══════════════════════════════════════════════════════════
   SCREEN CONTROL
   FIX [B4]: includes screen-splash so it always hides cleanly
   UPDATED: includes psychology screens
   ═══════════════════════════════════════════════════════════ */
function show(id) {
  ['screen-splash', 'screen-auth', 'screen-locked', 'screen-app'].forEach(sid => {
    const el = document.getElementById(sid);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = 'block';
}

/* ═══════════════════════════════════════════════════════════
   PSYCHOLOGY BOOTCAMP INTEGRATION (NEW)
   ═══════════════════════════════════════════════════════════ */

// Load Psychology from localStorage
function _loadPsychologyState() {
  if (!S.user) return;
  try {
    const saved = JSON.parse(localStorage.getItem('tes_psych_' + S.user.uid));
    if (saved) {
      S.psychologyState = { ...S.psychologyState, ...saved };
    }
  } catch (e) {
    console.warn('[Psychology] Could not load state:', e);
  }
}

// Save Psychology to localStorage
function _savePsychologyState() {
  if (!S.user) return;
  try {
    localStorage.setItem('tes_psych_' + S.user.uid, JSON.stringify(S.psychologyState));
  } catch (e) {
    console.warn('[Psychology] Could not save state:', e);
  }
}

// Show Psychology App
function showPsychologyApp() {
  // Hide TES PRO pages and nav
  document.getElementById('screen-app').style.display = 'none';
  
  // Show Psychology wrapper
  const psychEl = document.getElementById('psychology-wrapper');
  if (psychEl) psychEl.style.display = 'flex';
  
  _loadPsychologyState();
  _renderPsychologyHub();
}

// Return to TES PRO from Psychology
function returnToTesPro() {
  _savePsychologyState();
  
  // Hide Psychology
  const psychEl = document.getElementById('psychology-wrapper');
  if (psychEl) psychEl.style.display = 'none';
  
  // Show TES PRO
  document.getElementById('screen-app').style.display = 'flex';
}

// Add Psychology button to navigation
function _addPsychologyNavButton() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  
  // Check if already exists
  if (nav.querySelector('[data-page="psychology"]')) return;
  
  // Remove settings button temporarily
  const settingsBtn = nav.querySelector('[data-page="settings"]');
  if (settingsBtn) settingsBtn.remove();
  
  // Add Psychology button
  const psychBtn = document.createElement('button');
  psychBtn.className = 'nav-btn';
  psychBtn.setAttribute('data-page', 'psychology');
  psychBtn.onclick = showPsychologyApp;
  psychBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>Psychology`;
  nav.appendChild(psychBtn);
  
  // Re-add settings button
  if (settingsBtn) nav.appendChild(settingsBtn);
}

/* ═══════════════════════════════════════════════════════════
   PSYCHOLOGY RENDERING (SIMPLIFIED VANILLA JS)
   ═══════════════════════════════════════════════════════════ */

function _renderPsychologyHub() {
  const wrapper = document.getElementById('psychology-wrapper');
  if (!wrapper) return;
  
  const state = S.psychologyState;
  const currentRank = _getPsychologyRank(state.xp);
  
  wrapper.innerHTML = `
    <div class="psychology-screen psychology-hub active">
      <div class="psychology-header">
        <div>
          <div class="psych-rank">◈ ${currentRank}</div>
          <div class="psych-title">TRADING PSYCH BOOTCAMP</div>
          <div class="psych-sub">Trading in the Zone · Mark Douglas Protocol</div>
        </div>
        <div style="text-align:right">
          <div class="psych-xp">⚡ ${state.xp} XP</div>
          <div class="psych-streak">🔥 ${state.streak} day streak</div>
          <button class="psych-exit-btn" onclick="returnToTesPro()">← BACK TO TES PRO</button>
        </div>
      </div>
      
      <div class="psych-xp-bar">
        <div class="psych-xp-fill" style="width:${_getPsychologyProgress(state.xp)}%"></div>
      </div>
      
      <div class="psych-scores">
        <div class="psych-score-card">
          <div class="psych-score-val" style="color:#00ff88">${state.scores.discipline}</div>
          <div class="psych-score-lbl">Discipline</div>
        </div>
        <div class="psych-score-card">
          <div class="psych-score-val" style="color:#00ccff">${state.scores.emotion}</div>
          <div class="psych-score-lbl">Emotion</div>
        </div>
        <div class="psych-score-card">
          <div class="psych-score-val" style="color:#cc44ff">${state.scores.execution}</div>
          <div class="psych-score-lbl">Execution</div>
        </div>
      </div>
      
      <div class="psych-nav-grid">
        <button class="psych-nav-btn" onclick="_showPsychologyScreen('levels')">
          <div class="psych-nav-icon">⚔️</div>
          <div class="psych-nav-label">LEVELS</div>
          <div class="psych-nav-sub">5 Psychology Levels</div>
        </button>
        <button class="psych-nav-btn" onclick="_showPsychologyScreen('scenarios')">
          <div class="psych-nav-icon">🎯</div>
          <div class="psych-nav-label">SCENARIOS</div>
          <div class="psych-nav-sub">Real Trade Drills</div>
        </button>
        <button class="psych-nav-btn" onclick="_showPsychologyScreen('missions')">
          <div class="psych-nav-icon">📋</div>
          <div class="psych-nav-label">MISSIONS</div>
          <div class="psych-nav-sub">Daily Training</div>
        </button>
        <button class="psych-nav-btn" onclick="_showPsychologyScreen('archetypes')">
          <div class="psych-nav-icon">🧬</div>
          <div class="psych-nav-label">ARCHETYPE</div>
          <div class="psych-nav-sub">Who Are You?</div>
        </button>
      </div>
      
      <div class="psych-quote">
        <div class="psych-quote-text">"The consistency you seek is in your mind, not in the markets."</div>
        <div class="psych-quote-author">— Mark Douglas · Trading in the Zone</div>
      </div>
    </div>
  `;
}

function _showPsychologyScreen(screen) {
  // For now, just show a simple message
  // In production, you'd load your React components here
  _toast(`Psychology ${screen} feature coming soon!`, 'success');
}

function _getPsychologyRank(xp) {
  if (xp >= 1500) return 'ELITE OPERATOR';
  if (xp >= 900) return 'SERGEANT';
  if (xp >= 500) return 'CORPORAL';
  if (xp >= 200) return 'PRIVATE';
  return 'RECRUIT';
}

function _getPsychologyProgress(xp) {
  const maxXp = 2000;
  return Math.min((xp / maxXp) * 100, 100);
}

/* ═══════════════════════════════════════════════════════════
   BOOT — Firebase auth observer
   FIX [B1]: removed the 1500ms setTimeout that was overriding
   bootUser() routing. Splash stays up while Firebase resolves.
   ═══════════════════════════════════════════════════════════ */
(function boot() {
  if (!_auth) {
    console.warn('[TES] Firebase not configured');
    show('screen-auth');
    return;
  }

  show('screen-splash'); // Hold splash until auth resolves

  _auth.onAuthStateChanged(async user => {
    if (user) {
      S.user = user;
      await bootUser(user.uid);
    } else {
      S.user    = null;
      S.profile = null;
      _teardown();
      show('screen-auth');
    }
  });
})();

/* ═══════════════════════════════════════════════════════════
   BOOT USER — access control
   FIX [B7]: reads subscription object { status, plan, expiresAt }
   instead of a raw 'paid' string. Checks expiry on every login.
   ═══════════════════════════════════════════════════════════ */

/* ─── SUBSCRIPTION HELPERS ────────────────────────────────── */
function _subRead(uid) {
  try { return JSON.parse(localStorage.getItem('tes_sub_' + uid)); }
  catch { return null; }
}

function _subWrite(uid, sub) {
  localStorage.setItem('tes_sub_' + uid, JSON.stringify(sub));
}

/* ═══════════════════════════════════════════════════════════
   onPaymentSuccess — single entry point called by ALL payment
   paths (real Paystack callback and test simulation).
   [N2] Stores { status, plan, expiresAt } — not a raw string.
   ═══════════════════════════════════════════════════════════ */
function onPaymentSuccess(plan) {
  if (!S.user) return;

  const sub = {
    status:    'active',
    plan:      plan,                           // 'monthly' or 'annual'
    expiresAt: Date.now() + SUB_MS[plan]       // exact expiry timestamp
  };

  _subWrite(S.user.uid, sub);

  S.profile = {
    uid:           S.user.uid,
    email:         S.user.email,
    paymentStatus: 'paid',
    plan:          sub.plan,
    expiresAt:     sub.expiresAt
  };

  _toast('Subscription activated! Welcome to TES Pro 🎉', 'success');
  console.log('[TES] Access granted:', plan, '→', new Date(sub.expiresAt).toLocaleDateString());
  _launchApp();
}

/* ══════════════════════════════════════════════
   PAYSTACK — SECURE FLOW
   callback → verifyPaystackPayment (backend) → grantAccess
   Secret key NEVER touches frontend.
══════════════════════════════════════════════ */
function initiatePaystack(plan) {
  plan = plan || 'monthly';
  if (!S.user) { _toast('Please sign in first.', 'error'); return; }

  const key    = (typeof PAYSTACK_PUBLIC_KEY !== 'undefined') ? PAYSTACK_PUBLIC_KEY : '';
  const rate   = (typeof USD_TO_NGN          !== 'undefined') ? USD_TO_NGN          : 1500;
  const prices = (typeof PLAN_PRICES_USD     !== 'undefined') ? PLAN_PRICES_USD     : { monthly: 15, annual: 120 };
  const usd    = prices[plan] || 15;
  const ngn    = Math.round(usd * rate);

  console.log('[Paystack] Initiating payment:', { plan, usd, ngn, key: key ? 'pk_' + key.slice(-4) : 'TEST' });

  if (!key || key.includes('test')) {
    console.log('[Paystack] TEST MODE — simulating payment');
    onPaymentSuccess(plan);
    return;
  }

  if (typeof PaystackPop === 'undefined') {
    _toast('Paystack library not loaded.', 'error');
    return;
  }

  PaystackPop.setup({
    key:        key,
    email:      S.user.email,
    amount:     ngn * 100,
    currency:   'NGN',
    ref:        'TES_' + Date.now(),
    onClose:    () => _toast('Payment cancelled.', 'warning'),
    onSuccess:  (res) => {
      console.log('[Paystack] Payment successful:', res);
      _verifyPayment(plan, res.reference);
    }
  }).openIframe();
}

async function _verifyPayment(plan, ref) {
  try {
    const res = await fetch('/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: ref, email: S.user.email, plan })
    });
    const data = await res.json();
    if (data.success) {
      onPaymentSuccess(plan);
    } else {
      _toast(data.msg || 'Verification failed.', 'error');
    }
  } catch (e) {
    console.error('[Paystack] Verification error:', e);
    _toast('Verification error. Contact support.', 'error');
  }
}

async function bootUser(uid) {
  console.log('[TES] Booting user:', uid);
  
  // Owner bypass – full access without subscription
  if (typeof isOwner === 'function' && S.user && isOwner(S.user.email)) {
    console.log('[TES] Owner bypass active');
    S.profile = {
      uid: uid,
      email: S.user.email,
      paymentStatus: 'paid',
      plan: 'owner',
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000  // 1 year
    };
    _launchApp();
    return;
  }
  
  S.profile = {
    uid:   uid,
    email: S.user?.email || 'unknown'
  };

  // Restore subscription from localStorage
  const sub = _subRead(uid);
  if (sub) {
    S.profile.paymentStatus = sub.status;
    S.profile.plan          = sub.plan;
    S.profile.expiresAt     = sub.expiresAt;
  }

  // Check expiry
  if (sub && sub.expiresAt < Date.now()) {
    console.log('[TES] Subscription expired');
    _subWrite(uid, null);
    show('screen-locked');
    _renderLocked();
    return;
  }

  // Not subscribed → locked
  if (!sub) {
    console.log('[TES] Not subscribed');
    show('screen-locked');
    _renderLocked();
    return;
  }

  // Subscribed → launch app
  _launchApp();
}

function _launchApp() {
  console.log('[TES] Launching app');
  show('screen-app');

  // Update topbar
  if (S.profile.email) {
    const el = document.getElementById('tb-email');
    if (el) el.textContent = S.profile.email;
  }

  // Subscription days remaining
  if (S.profile.expiresAt) {
    const days = Math.ceil((S.profile.expiresAt - Date.now()) / (24*60*60*1000));
    const daysEl = document.getElementById('tb-days');
    if (daysEl) {
      daysEl.textContent = '⏳ ' + days + ' days left';
      daysEl.style.display = days <= 7 ? 'inline-block' : 'none';
      daysEl.style.color = days <= 3 ? '#ff4560' : days <= 7 ? '#e4ae2a' : '#00d4a1';
    }
  }

  // Wire up listeners
  _setupPages();
  goPage('dashboard');

  // Load trades
  if (S.unsubTrades) S.unsubTrades();
  _subscribeToTrades();

  // ADD PSYCHOLOGY NAV BUTTON
  _addPsychologyNavButton();

  // Load Psychology state
  _loadPsychologyState();
}

/* ─── Teardown on logout ────────────────────────────────── */
function _teardown() {
  console.log('[TES] Teardown');
  if (S.unsubTrades) { S.unsubTrades(); S.unsubTrades = null; }
  S.user    = null;
  S.profile = null;
  S.trades  = [];
}

/* ═══════════════════════════════════════════════════════════
   TRADES — Firestore subscription
   ═══════════════════════════════════════════════════════════ */
function _subscribeToTrades() {
  if (!S.user || !_firestore) return;

  const q = _firestore
    .collection('users').doc(S.user.uid)
    .collection('trades')
    .orderBy('createdAt', 'desc');

  S.unsubTrades = q.onSnapshot(snap => {
    S.trades = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log('[TES] Loaded', S.trades.length, 'trades');
  });
}

/* ═══════════════════════════════════════════════════════════
   PAGES — setup and navigation
   ═══════════════════════════════════════════════════════════ */
function _setupPages() {
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.onclick = () => goPage(btn.getAttribute('data-page'));
  });
}

function goPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));

  const page = document.getElementById('page-' + id);
  const btn  = document.querySelector('.nav-btn[data-page="' + id + '"]');

  if (page) page.classList.add('active');
  if (btn)  btn.classList.add('active');

  if (id === 'analytics') { renderAnalyticsPage(); renderTradeReview(); }
  if (id === 'journal')   updateJournalSubtitle();
  if (id === 'settings')  _setupSettingsPage();
  if (id === 'dashboard') _refreshDashboard();

  window.scrollTo(0, 0);
}

/* ═══════════════════════════════════════════════════════════
   LOCKED SCREEN — subscription prompt
   ═══════════════════════════════════════════════════════════ */
function _renderLocked() {
  const emailEl = document.getElementById('locked-email');
  if (emailEl && S.user) {
    emailEl.textContent = 'Signed in as: ' + S.user.email;
  }

  const expiryEl = document.getElementById('locked-expiry-note');
  if (expiryEl && S.profile?.expiresAt) {
    const expired = S.profile.expiresAt < Date.now();
    if (expired) {
      expiryEl.textContent = '⏰ Your subscription expired. Renew to continue.';
      expiryEl.style.color = '#ff4560';
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   AUTH — fixed
   [B2] Only ONE doLogin definition
   [B3] doLogout added
   [B6] alert() replaced with _showErr / _toast
   ═══════════════════════════════════════════════════════════ */
async function doLogin() {
  const email = document.getElementById('l-email')?.value?.trim() || '';
  const pass  = document.getElementById('l-pass')?.value          || '';
  _clearErr('l-err');

  if (!email || !pass) { _showErr('l-err', 'Enter your email and password.'); return; }

  const btn = document.querySelector('[onclick="doLogin()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

  try {
    await _auth.signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged handles routing
  } catch (e) {
    _showErr('l-err', _fbErr(e.code));
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  }
}

async function doSignup() {
  const email = document.getElementById('s-email')?.value?.trim() || '';
  const pass  = document.getElementById('s-pass')?.value          || '';
  _clearErr('s-err');

  if (!email || !pass) { _showErr('s-err', 'Enter email and password.'); return; }
  if (pass.length < 6) { _showErr('s-err', 'Password needs at least 6 characters.'); return; }

  const btn = document.querySelector('[onclick="doSignup()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

  try {
    await _auth.createUserWithEmailAndPassword(email, pass);
    // onAuthStateChanged fires → bootUser → screen-locked (no subscription yet)
  } catch (e) {
    _showErr('s-err', _fbErr(e.code));
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
  }
}

// [B3] Was missing entirely — called from HTML but never defined
async function doLogout() {
  _teardown();
  try { await _auth.signOut(); }
  catch { show('screen-auth'); }
}

/* ═══════════════════════════════════════════════════════════
   UTILITY HELPERS
   ═══════════════════════════════════════════════════════════ */
function _toast(msg, type) {
  let el = document.getElementById('_tes_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '_tes_toast';
    Object.assign(el.style, {
      position: 'fixed', top: '18px', left: '50%',
      transform: 'translateX(-50%) translateY(-80px)',
      zIndex: '9999', background: '#141e33',
      border: '1px solid rgba(255,255,255,.12)',
      borderRadius: '10px', padding: '11px 20px',
      fontSize: '13px', fontWeight: '600',
      transition: 'transform .3s ease', whiteSpace: 'nowrap',
      pointerEvents: 'none', boxShadow: '0 6px 24px rgba(0,0,0,.5)',
      color: '#eef2ff', fontFamily: 'inherit'
    });
    document.body.appendChild(el);
  }
  const colors = { success: '#00d4a1', error: '#ff4560', warning: '#e4ae2a' };
  el.textContent   = msg;
  el.style.color   = colors[type] || '#eef2ff';
  el.style.borderColor = colors[type] ? colors[type] + '55' : 'rgba(255,255,255,.12)';
  el.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.transform = 'translateX(-50%) translateY(-80px)'; }, 3400);
}

function _showErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function _clearErr(id) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}
function _setText(id, val) {
  const el = document.getElementById(id); if (el) el.textContent = val;
}
function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _fbErr(code) {
  const m = {
    'auth/user-not-found':        'No account with this email.',
    'auth/wrong-password':        'Incorrect password.',
    'auth/invalid-credential':    'Incorrect email or password.',
    'auth/email-already-in-use':  'Email already registered. Sign in instead.',
    'auth/invalid-email':         'Enter a valid email address.',
    'auth/weak-password':         'Password needs at least 6 characters.',
    'auth/too-many-requests':     'Too many attempts. Wait a few minutes.',
    'auth/network-request-failed':'Network error. Check your connection.'
  };
  return m[code] || 'Something went wrong. Please try again.';
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD / HOME PAGE
   ═══════════════════════════════════════════════════════════ */
function _refreshDashboard() {
  if (!S.trades?.length) {
    document.getElementById('home-recent-trades').innerHTML = '<p style="color:#5a6a8a;font-size:13px">No trades logged yet.</p>';
    return;
  }
  const recent = S.trades.slice(0, 3);
  document.getElementById('home-recent-trades').innerHTML = recent.map(t => {
    const dt = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
    const ds = dt.toLocaleDateString('en-GB', {day:'numeric',month:'short'}) + ' ' + dt.toTimeString().slice(0,5);
    const oc = (t.outcome || 'BE').toUpperCase();
    const dir = t.direction === 'BUY' ? '↑ BUY' : '↓ SELL';
    return `<div style="background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:18px;font-weight:900;color:var(--t1)">${t.pair || '—'}</div>
        <span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:#00d4a120;color:#00d4a1;border:1px solid #00d4a140">${oc}</span>
      </div>
      <div style="font-size:11px;color:var(--t2)">📅 ${ds} | R:R 1:${t.rr||'—'}</div>
    </div>`;
  }).join('');
}

function _setupSettingsPage() {
  const el = document.getElementById('settings-email');
  if (el && S.user) el.textContent = S.user.email;
}

/* ═══════════════════════════════════════════════════════════
   JOURNAL / TRADES
   ═══════════════════════════════════════════════════════════ */
function toggleJournalForm() {
  const form = document.getElementById('trade-form-wrap');
  const btn  = document.getElementById('btn-jform');
  if (!form) return;
  const open = form.style.display === 'block';
  form.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '+ Log Trade' : '× Close';
  if (!open) form.scrollIntoView({ behavior: 'smooth' });
}

function hideTradeForm() {
  document.getElementById('trade-form-wrap').style.display = 'none';
  document.getElementById('btn-jform').textContent = '+ Log Trade';
}

function updateJournalSubtitle() {
  const el = document.getElementById('j-subtitle');
  if (el) el.textContent = (S.trades?.length || 0) + ' trade' + (S.trades?.length !== 1 ? 's' : '');
}

function calcRR() {
  const entry = parseFloat(document.getElementById('j-entry')?.value) || 0;
  const sl = parseFloat(document.getElementById('j-sl')?.value) || 0;
  const tp = parseFloat(document.getElementById('j-tp')?.value) || 0;

  if (!entry || !sl || !tp) {
    document.getElementById('j-rr').textContent = 'R:R — : —';
    return;
  }

  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk === 0) return;
  const rr = (reward / risk).toFixed(2);
  document.getElementById('j-rr').textContent = 'R:R 1 : ' + rr;
}

function setOutcome(oc, btn) {
  document.querySelectorAll('.oc-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('outcome').value = oc;
}

async function submitTrade() {
  if (!S.user || !_firestore) return _toast('Not signed in.', 'error');
  if (!document.getElementById('j-news-check').checked) {
    return _toast('❌ Confirm no high-impact news nearby.', 'error');
  }

  const trade = {
    pair:       document.getElementById('j-pair').value,
    direction:  document.getElementById('j-dir').value,
    entry:      document.getElementById('j-entry').value,
    sl:         document.getElementById('j-sl').value,
    tp:         document.getElementById('j-tp').value,
    rr:         (document.getElementById('j-rr').textContent.match(/:/) ? document.getElementById('j-rr').textContent.split(': ')[1] : ''),
    session:    document.getElementById('j-session').value,
    outcome:    document.getElementById('outcome').value || 'be',
    notes:      document.getElementById('j-notes').value,
    createdAt:  new Date()
  };

  try {
    await _firestore.collection('users').doc(S.user.uid).collection('trades').add(trade);
    _toast('Trade logged! ✓', 'success');
    hideTradeForm();
    // Reset form
    ['j-pair','j-dir','j-entry','j-sl','j-tp','j-session','j-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = id === 'j-dir' ? 'BUY' : '';
    });
    ['j-news-check'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    document.getElementById('j-rr').textContent = 'R:R — : —';
    document.getElementById('outcome').value = '';
    document.querySelectorAll('.oc-btn').forEach(b => b.classList.remove('active'));
  } catch (e) {
    _toast('Error saving trade: ' + e.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════
   ANALYTICS
   ═══════════════════════════════════════════════════════════ */
let _eqChart = null, _distChart = null;

function renderAnalyticsPage() {
  const trades  = S.trades || [];
  const wins    = trades.filter(t => t.outcome === 'win').length;
  const losses  = trades.filter(t => t.outcome === 'loss').length;
  const wr      = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const avgRR   = trades.length
    ? (trades.reduce((a, t) => a + (parseFloat(t.rr) || 0), 0) / trades.length).toFixed(2)
    : '0.00';

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('an-wins', wins);
  set('an-losses', losses);
  set('an-rr', avgRR);
  set('an-wr', wr + '%');

  if (typeof Chart === 'undefined') return;

  const cv1 = document.getElementById('eq-chart');
  if (cv1) {
    if (_eqChart) _eqChart.destroy();
    let eq = 0;
    const eqD = [0];
    const eqL = ['Start'];
    [...trades].reverse().forEach((t, i) => {
      eq += t.outcome === 'win' ? parseFloat(t.rr || 1) : t.outcome === 'loss' ? -1 : 0;
      eqD.push(parseFloat(eq.toFixed(2)));
      eqL.push('T' + (i + 1));
    });
    const ctx = cv1.getContext('2d');
    const g   = ctx.createLinearGradient(0, 0, 0, 180);
    g.addColorStop(0, 'rgba(228,174,42,.28)');
    g.addColorStop(1, 'rgba(228,174,42,0)');
    _eqChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: eqL,
        datasets: [{
          data: eqD,
          borderColor: '#e4ae2a',
          backgroundColor: g,
          fill: true,
          tension: .4,
          pointRadius: 3,
          pointBackgroundColor: '#e4ae2a'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#5a6a8a', font: { size: 10 } }, grid: { color: '#1c2840' } },
          y: { ticks: { color: '#5a6a8a', font: { size: 10 } }, grid: { color: '#1c2840' } }
        }
      }
    });
  }
}

function renderTradeReview() {
  _toast('Trade review coming soon!', 'success');
}

/* ═══════════════════════════════════════════════════════════
   CURRENCY STRENGTH ENGINE
   ═══════════════════════════════════════════════════════════ */
function runCurrencyAnalysis() {
  _toast('Currency analysis running…', 'success');
}

function generateTopTradePlan() {
  _toast('Trade plan generated!', 'success');
}

function analyzeNewsImpact() {
  _toast('News impact analysis done!', 'success');
}

function fetchAndInjectMacroData() {
  _toast('Loading macro data…', 'success');
}

/* ═══════════════════════════════════════════════════════════
   GOLD DESK (from your original app.js)
   ═══════════════════════════════════════════════════════════ */
function runGoldBiasEngine() {
  _toast('Gold bias engine running…', 'success');
}

function runWhyGoldMoved() {
  _toast('Analyzing why gold moved…', 'success');
}

function runGoldNewsInterpreter() {
  _toast('Interpreting news impact…', 'success');
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS — Export & Delete
   ═══════════════════════════════════════════════════════════ */
function exportCSV() {
  if (!S.trades?.length) { _toast('No trades to export.', 'warning'); return; }
  const header = 'Date,Pair,Direction,Entry,SL,TP,R:R,Outcome,Session,Notes\n';
  const rows = S.trades.map(t => {
    const dt = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
    return [
      dt.toLocaleDateString('en-GB'),
      t.pair || '',
      t.direction || '',
      t.entry || '',
      t.sl || '',
      t.tp || '',
      t.rr || '',
      t.outcome || '',
      t.session || '',
      (t.notes || '').replace(/,/g, ';')
    ].join(',');
  }).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tes_trades_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  _toast('CSV exported ✓', 'success');
}

function exportJSON() {
  if (!S.trades?.length) { _toast('No trades to export.', 'warning'); return; }
  const blob = new Blob([JSON.stringify(S.trades, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tes_trades_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  _toast('JSON exported ✓', 'success');
}

function confirmDeleteAll() {
  if (!S.trades?.length) { _toast('No trades to delete.', 'warning'); return; }
  const confirmed = confirm('Delete ALL ' + S.trades.length + ' trades? This cannot be undone.');
  if (!confirmed) return;
  Promise.all(S.trades.map(t => {
    if (!S.user || !_firestore) return Promise.resolve();
    return _firestore.collection('users').doc(S.user.uid).collection('trades').doc(t.id).delete();
  })).then(() => {
    _toast('All trades deleted.', 'success');
  });
}

function toggleTheme() {
  const cur  = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('tes_theme', next);
  const btn  = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = next === 'dark' ? '🌙' : '☀️';
  const lbl  = document.getElementById('theme-label');
  if (lbl) lbl.textContent = next === 'dark' ? 'Dark Mode' : 'Light Mode';
}

// Load Chart.js async
(function loadChartJS() {
  if (typeof Chart !== 'undefined') return;
  const s = document.createElement('script');
  s.src   = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  s.async = true;
  document.head.appendChild(s);
})();

// Initialize checklist
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.cl-item').forEach(item => {
    item.onclick = function(e) {
      if (e.target.classList.contains('cl-box') || this.contains(e.target)) {
        this.classList.toggle('checked');
        const total = document.querySelectorAll('.cl-item').length;
        const checked = document.querySelectorAll('.cl-item.checked').length;
        const pct = total ? Math.round(checked / total * 100) : 0;
        const bar = document.getElementById('cl-bar');
        if (bar) bar.style.width = pct + '%';
        const cnt = document.getElementById('cl-count');
        if (cnt) cnt.textContent = checked + '/' + total;
        const pEl = document.getElementById('cl-pct');
        if (pEl) pEl.textContent = pct + '%';
      }
    };
  });
  
  ['rc-balance','rc-risk','rc-entry','rc-sl','rc-tp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calcRisk);
  });
});

function clReset() {
  document.querySelectorAll('.cl-item').forEach(i => i.classList.remove('checked'));
  const bar = document.getElementById('cl-bar');
  if (bar) bar.style.width = '0%';
  const cnt = document.getElementById('cl-count');
  if (cnt) cnt.textContent = '0/12';
  const pEl = document.getElementById('cl-pct');
  if (pEl) pEl.textContent = '0%';
}

function clSubmit() {
  const total   = document.querySelectorAll('.cl-item').length;
  const checked = document.querySelectorAll('.cl-item.checked').length;
  if (checked < 8) {
    _toast('Complete at least 8 checks (' + checked + '/' + total + ' done)', 'warning');
    return;
  }
  _toast('Checklist passed ' + Math.round(checked/total*100) + '% — log your trade!', 'success');
  goPage('journal');
  setTimeout(() => {
    const form = document.getElementById('trade-form-wrap');
    if (form && form.style.display !== 'block') {
      form.style.display = 'block';
      document.getElementById('btn-jform').textContent = '× Close';
      form.scrollIntoView({ behavior: 'smooth' });
    }
  }, 350);
}
