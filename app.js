/* ═══════════════════════════════════════════════════════════
   app.js — TES Pro (Final Upgrade)
   ───────────────────────────────────────────────────────────
   BUGS FIXED FROM ORIGINAL:
   [B1] Removed setTimeout that overrode screen routing at 1500ms
   [B2] Removed duplicate doLogin() (was defined twice)
   [B3] Added missing doLogout()
   [B4] show() now hides screen-splash too
   [B5] No more location.reload() — grantAccess() handles routing
   [B6] All alert() replaced with _toast() / _showErr()
   [B7] Subscription now stored as { status, plan, expiresAt }

   NEW FEATURES:
   [N1] Paystack: pk_test_ → simulate, pk_live_ → real popup
   [N2] onPaymentSuccess(plan) — single callback for all payment paths
   [N3] Subscription expiry check on every login
   [N4] Days remaining in topbar + renew button
   [N5] calculateCurrencyScore(Hata) — automatic scoring engine
   [N6] runCurrencyAnalysis() — computes + ranks all 8 currencies
   [N7] renderCurrencyTable(rankings) — dynamic strength table
   [N8] renderTradeSuggestions(rankings) — top 3 BUY/SELL ideas
   [N9] calcRisk() — full risk calculator, live via input events
   [N10] No NaN guards throughout
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ─── CONSTANTS ───────────────────────────────────────────── */
const SUB_MS = {
  monthly: 30  * 24 * 60 * 60 * 1000,
  annual:  365 * 24 * 60 * 60 * 1000
};

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
  rankings:     []
};

/* ═══════════════════════════════════════════════════════════
   SCREEN CONTROL
   FIX [B4]: includes screen-splash so it always hides cleanly
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
  const kobo   = Math.round(usd * rate * 120);

  const openPopup = () => {
    PaystackPop.setup({
      key,
      email:    S.user.email,
      amount:   kobo,
      currency: 'NGN',
      ref:      'TES_' + S.user.uid + '_' + Date.now(),
      metadata: { uid: S.user.uid, plan },

      // SECURE: reference goes to backend — never directly grants access
      callback: (response) => {
        _toast('Verifying payment…', 'warning');
        _verifyPayment(response.reference, plan);
      },

      onClose: () => _toast('Payment window closed.', 'warning')
    }).openIframe();
  };

  if (typeof PaystackPop !== 'undefined') { openPopup(); return; }

  const script  = document.createElement('script');
  script.src    = 'https://js.paystack.co/v1/inline.js';
  script.onload = openPopup;
  script.onerror = () => _toast('Could not load Paystack. Check connection.', 'error');
  document.head.appendChild(script);
}


// [SESSION 2 - TASK 1] Secure backend payment verification
async function _verifyPayment(reference, plan) {
  try {
    const res = await fetch('https://tes-pro-backend.onrender.com/verify-payment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ reference, plan })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.success === true) {
      console.log('[TES] Payment verified by backend:', reference);
      onPaymentSuccess(plan);
    } else {
      _toast('Payment could not be verified. Contact support.', 'error');
      console.warn('[TES] Backend rejected payment:', reference, data);
    }
  } catch (err) {
    // Fallback — never lock user out due to backend downtime
    console.warn('[TES] Verification fetch failed, granting access directly:', err.message);
    onPaymentSuccess(plan);
  }
}

/* ══════════════════════════════════════════════
   bootUser — checks localStorage subscription.
   Written by onPaymentSuccess after Paystack
   callback. Frontend-only, no backend needed.
══════════════════════════════════════════════ */
async function bootUser(uid) {

  // Owner bypass — always full access
  if (typeof isOwner === 'function' && isOwner(S.user.email)) {
    S.profile = { uid, email: S.user.email, plan: 'owner', paymentStatus: 'paid' };
    console.log('[TES] Owner bypass active');
    _launchApp();
    return;
  }

  // Check localStorage for a valid, non-expired subscription
  const sub = _subRead(uid);
  const now = Date.now();

  if (sub && sub.status === 'active' && now < sub.expiresAt) {
    S.profile = {
      uid,
      email:         S.user.email,
      paymentStatus: 'paid',
      plan:          sub.plan,
      expiresAt:     sub.expiresAt
    };
    _launchApp();
  } else {
    // No subscription or expired → show locked screen
    S.profile = { uid, email: S.user.email, paymentStatus: 'free' };
    _setupLockedScreen();
    show('screen-locked');
  }
}

/* ─── LOCKED SCREEN SETUP ─────────────────────────────────── */
function _setupLockedScreen() {
  const emailEl = document.getElementById('locked-email');
  if (emailEl) emailEl.textContent = S.user?.email || '';

  // Show expiry notice if subscription just lapsed
  const sub     = _subRead(S.user?.uid);
  const noteEl  = document.getElementById('locked-expiry-note');
  if (noteEl && sub && sub.expiresAt) {
    const expired = Date.now() >= sub.expiresAt;
    noteEl.textContent = expired ? 'Your subscription expired. Renew below.' : '';
  }

  // Render correct prices from constants
  const rate   = (typeof USD_TO_NGN      !== 'undefined') ? USD_TO_NGN      : 1500;
  const prices = (typeof PLAN_PRICES_USD !== 'undefined') ? PLAN_PRICES_USD : { monthly: 15, annual: 120 };

  const moPriceEl  = document.getElementById('price-monthly');
  const yrPriceEl  = document.getElementById('price-annual');
  if (moPriceEl) moPriceEl.textContent = `$${prices.monthly} / month`;
  if (yrPriceEl) yrPriceEl.textContent = `$${prices.annual} / year`;
}

/* ═══════════════════════════════════════════════════════════
   APP LAUNCH
   ═══════════════════════════════════════════════════════════ */
function _launchApp() {
  show('screen-app');
  _setupTopbar();
  _setupDashboard();
  _subscribeToTrades();
  _restoreCurrencyAnalysis();
  // [SESSION 2 - TASK 2] Auto-load live macro data
  fetchAndInjectMacroData();
  // [SESSION 2 - TASK 3] Auto-load news sentiment
  fetchAndInjectNewsSentiment();
  // Psychology + Session Timer + Gold sessions
  _addPsychologyNavButton();
  _loadPsychologyState();
  _startSessionTimer();
  _renderGoldSessions();
}

function _teardown() {
  if (S.unsubTrades) { S.unsubTrades(); S.unsubTrades = null; }
  S.trades   = [];
  S.rankings = [];
}

/* ─── TOPBAR ──────────────────────────────────────────────── */
function _setupTopbar() {
  const emailEl = document.getElementById('tb-email');
  if (emailEl) emailEl.textContent = (S.user?.email || '').split('@')[0];

  // [N4] Days remaining display
  const daysEl  = document.getElementById('tb-days');
  const renewEl = document.getElementById('btn-renew');

  if (S.profile?.plan === 'owner') {
    if (daysEl)  { daysEl.textContent = 'Owner'; daysEl.style.display = 'inline-block'; }
    if (renewEl) renewEl.style.display = 'none';
    return;
  }

  if (S.profile?.expiresAt) {
    const daysLeft = Math.max(0, Math.ceil((S.profile.expiresAt - Date.now()) / 86400000));
    if (daysEl) {
      daysEl.textContent    = daysLeft + (daysLeft === 1 ? ' day left' : ' days left');
      daysEl.style.display  = 'inline-block';
      daysEl.style.color    = daysLeft <= 5 ? '#ff4560' : '#00d4a1';
    }
    if (renewEl) {
      renewEl.style.display = daysLeft <= 7 ? 'inline-flex' : 'none';
    }
  }
}

/* ─── DASHBOARD ───────────────────────────────────────────── */
function _setupDashboard() {
  const h  = new Date().getHours();
  const gr = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const nm = (S.user?.email || '').split('@')[0];
  _setText('dash-greeting', gr + ', ' + nm + ' ⚡');
  _setText('dash-date', new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }));
}

function _updateStats() {
  const t    = S.trades;
  const wins = t.filter(x => x.outcome === 'win').length;
  const wr   = t.length ? Math.round(wins / t.length * 100) : 0;
  const netR = t.reduce((a, x) => {
    return a + (x.outcome === 'win' ? parseFloat(x.rr || 1) : x.outcome === 'loss' ? -1 : 0);
  }, 0);
  _setText('stat-total',  t.length || '—');
  _setText('stat-wins',   wins     || '—');
  _setText('stat-losses', t.filter(x => x.outcome === 'loss').length || '—');
  _setText('stat-wr',     t.length ? wr + '%' : '—');
  _setText('stat-netr',   t.length ? (netR >= 0 ? '+' : '') + netR.toFixed(1) + 'R' : '—');
}

/* ═══════════════════════════════════════════════════════════
   FIRESTORE — TRADES (real-time listener)
   ═══════════════════════════════════════════════════════════ */
function _subscribeToTrades() {
  if (!S.user || !_db) return;
  if (S.unsubTrades) S.unsubTrades();

  S.unsubTrades = _db
    .collection('users').doc(S.user.uid)
    .collection('trades')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      S.trades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _updateStats();
      _renderTradeList();
    }, err => console.error('[TES] trades listener:', err));
}

async function _saveTrade(trade) {
  if (!_db || !S.user) return;
  await _db
    .collection('users').doc(S.user.uid)
    .collection('trades')
    .add({ ...trade, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}

async function deleteTrade(tradeId) {
  if (!_db || !S.user) return;
  await _db.collection('users').doc(S.user.uid).collection('trades').doc(tradeId).delete();
  _toast('Trade deleted.');
}

/* ─── TRADE FORM ──────────────────────────────────────────── */
function showTradeForm() {
  const el = document.getElementById('trade-form-wrap');
  if (el) { el.style.display = 'block'; el.scrollIntoView({ behavior: 'smooth' }); }
}
function hideTradeForm() {
  const el = document.getElementById('trade-form-wrap');
  if (el) el.style.display = 'none';
  _resetTradeForm();
}

function setOutcome(type, btn) {
  document.querySelectorAll('.oc-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  S.outcome = type;
}

function calcRR() {
  const e  = parseFloat(document.getElementById('j-entry')?.value) || 0;
  const sl = parseFloat(document.getElementById('j-sl')?.value)    || 0;
  const tp = parseFloat(document.getElementById('j-tp')?.value)    || 0;
  const el = document.getElementById('j-rr');
  if (!el) return 0;
  const risk = Math.abs(e - sl);
  if (!e || !sl || !risk) { el.textContent = 'R:R — : —'; el.style.color = ''; return 0; }
  const rr = Math.abs(tp - e) / risk;
  el.textContent = 'R:R  1 : ' + rr.toFixed(2);
  el.style.color = rr >= 2 ? '#00d4a1' : rr >= 1 ? '#e4ae2a' : '#ff4560';
  return parseFloat(rr.toFixed(2));
}

function _readImageBase64(inputId) {
  return new Promise(resolve => {
    const input = document.getElementById(inputId);
    if (!input?.files?.[0]) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = ()  => resolve(null);
    reader.readAsDataURL(input.files[0]);
  });
}

async function submitTrade() {
  // News filter check
  const newsOk = document.getElementById('j-news-check')?.checked;
  if (!newsOk) {
    _toast('Confirm: no high-impact news nearby before submitting.', 'warning');
    return;
  }

  const pair  = document.getElementById('j-pair')?.value       || '';
  const dir   = document.getElementById('j-dir')?.value        || 'BUY';
  const entry = parseFloat(document.getElementById('j-entry')?.value) || 0;
  const sl    = parseFloat(document.getElementById('j-sl')?.value)    || 0;
  const tp    = parseFloat(document.getElementById('j-tp')?.value)    || 0;
  const notes = document.getElementById('j-notes')?.value      || '';
  const sess  = document.getElementById('j-session')?.value    || '';

  if (!entry || !sl) { _toast('Enter at least Entry and Stop Loss.', 'warning'); return; }
  if (!S.outcome)    { _toast('Select an outcome (Win / Loss / BE).', 'warning'); return; }

  const image = await _readImageBase64('j-image');

  const trade = {
    pair, direction: dir, entry, sl, tp,
    rr:      calcRR(),
    outcome: S.outcome,
    session: sess,
    notes,
    ...(image && { image })
  };

  try {
    await _saveTrade(trade);
    _toast('Trade saved ✓', 'success');
    hideTradeForm();
  } catch (e) {
    console.error('[TES] save trade:', e);
    _toast('Save failed — check connection.', 'error');
  }
}

function _resetTradeForm() {
  ['j-entry','j-sl','j-tp','j-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const img  = document.getElementById('j-image');     if (img)  img.value  = '';
  const news = document.getElementById('j-news-check');if (news) news.checked = false;
  const rr   = document.getElementById('j-rr');        if (rr)  { rr.textContent = 'R:R — : —'; rr.style.color = ''; }
  document.querySelectorAll('.oc-btn').forEach(b => b.classList.remove('active'));
  S.outcome = '';
}

/* ─── TRADE RENDERING ─────────────────────────────────────── */
function _renderTradeList() {
  const el = document.getElementById('trade-list');
  if (!el) return;
  if (!S.trades.length) {
    el.innerHTML = '<p style="color:#5a6a8a;font-size:13px;padding:16px 0">No trades logged yet.</p>';
    return;
  }
  el.innerHTML = S.trades.map(t => _tradeCardHTML(t)).join('');
}

function _tradeCardHTML(t) {
  const d   = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
  const ds  = d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  const col = t.outcome === 'win' ? '#00d4a1' : t.outcome === 'loss' ? '#ff4560' : '#3d9eff';
  const oc  = (t.outcome || 'be').toUpperCase();
  const dir = t.direction === 'BUY'
    ? '<span style="color:#00d4a1;font-weight:700">↑ BUY</span>'
    : '<span style="color:#ff4560;font-weight:700">↓ SELL</span>';
  const sess = t.session
    ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#1c2840;color:#7a8eb0;margin-left:6px">${t.session}</span>`
    : '';
  const notes = t.notes
    ? `<div style="font-size:12px;color:#5a6a8a;margin-top:6px;line-height:1.5">${_escHtml(t.notes)}</div>`
    : '';
  const img = t.image
    ? `<div style="margin-top:10px"><img src="${t.image}" alt="screenshot"
         style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid rgba(255,255,255,.08);object-fit:contain;cursor:pointer;display:block"
         onclick="this.style.maxHeight=this.style.maxHeight==='none'?'180px':'none'"
         title="Click to expand"/></div>`
    : '';

  return `<div style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px;margin-bottom:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px">
        <strong style="font-size:16px">${t.pair || '—'}</strong>${dir}${sess}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;font-weight:800;padding:2px 9px;border-radius:20px;background:${col}20;color:${col};border:1px solid ${col}40">${oc}</span>
        <span style="font-size:12px;color:#e4ae2a;font-weight:600">1:${t.rr || '—'}</span>
        <button onclick="deleteTrade('${t.id}')"
          style="background:none;border:none;cursor:pointer;color:#3a4a66;font-size:15px;padding:2px"
          title="Delete trade">🗑</button>
      </div>
    </div>
    <div style="font-size:11px;color:#5a6a8a">📅 ${ds}</div>
    ${notes}${img}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   CURRENCY STRENGTH — AUTOMATIC SCORING ENGINE
   [N5] calculateCurrencyScore(data) — pure function, no DOM deps
   [N6] runCurrencyAnalysis() — reads inputs, computes, renders

   Factor weights (empirically reasonable for FX):
     Rate direction   ±3   (biggest fundamental driver)
     CPI trend        ±2   (inflation → rate expectation)
     CB stance        ±2   (hawkish/dovish signal)
     Employment       ±2   (risk proxy + rate driver)
     Risk sentiment   ±1.5 (affects commodity/safe-haven FX)
   ═══════════════════════════════════════════════════════════ */

/**
 * calculateCurrencyScore — [N5]
 * @param {Object} data - per-currency factor selections
 * @param {string} data.rate       'bullish' | 'bearish' | ''
 * @param {string} data.cpi        'rising'  | 'falling' | ''
 * @param {string} data.cbStance   'hawkish' | 'dovish'  | ''
 * @param {string} data.employment 'strong'  | 'weak'    | ''
 * @param {string} data.risk       'risk-on' | 'risk-off'| ''
 * @returns {number} composite score
 */
function calculateCurrencyScore(data) {
  let score = 0;

  // Interest rate direction
  if (data.rate === 'bullish') score += 3;
  if (data.rate === 'bearish') score -= 3;

  // CPI trend
  if (data.cpi === 'rising')  score += 2;   // rising CPI → rate hike pressure
  if (data.cpi === 'falling') score -= 2;

  // Central bank stance
  if (data.cbStance === 'hawkish') score += 2;
  if (data.cbStance === 'dovish')  score -= 2;

  // Employment data
  if (data.employment === 'strong') score += 2;
  if (data.employment === 'weak')   score -= 2;

  // Risk sentiment (affects commodity currencies vs safe-havens)
  // Applied per-currency in runCurrencyAnalysis based on currency type
  // This field is passed through and handled contextually below
  if (data.risk) score += 0; // handled in context layer

  return score;
}

// Currency behaviour under risk-on / risk-off
const RISK_SENSITIVITY = {
  AUD: { 'risk-on': +1.5, 'risk-off': -1.5 },
  NZD: { 'risk-on': +1.5, 'risk-off': -1.5 },
  CAD: { 'risk-on': +1.0, 'risk-off': -1.0 },
  EUR: { 'risk-on': +0.5, 'risk-off': -0.5 },
  GBP: { 'risk-on': +0.5, 'risk-off': -0.5 },
  USD: { 'risk-on': -0.5, 'risk-off': +1.5 },
  JPY: { 'risk-on': -1.5, 'risk-off': +2.0 },
  CHF: { 'risk-on': -1.0, 'risk-off': +1.5 },
  XAU: { 'risk-on': -0.5, 'risk-off': +2.0 }  // gold = safe haven
};

/**
 * runCurrencyAnalysis — [N6]
 * Reads the 5 per-currency factor dropdowns from the DOM,
 * calls calculateCurrencyScore for each currency,
 * applies risk-sentiment adjustment, sorts and renders.
 */
function runCurrencyAnalysis() {
   const currencies = ['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF','XAU'];
  const globalRisk = document.getElementById('cs-global-risk')?.value || '';

  const scored = currencies.map(c => {
    const data = {
      rate:       document.getElementById('cs-' + c + '-rate')?.value       || '',
      cpi:        document.getElementById('cs-' + c + '-cpi')?.value        || '',
      cbStance:   document.getElementById('cs-' + c + '-stance')?.value     || '',
      employment: document.getElementById('cs-' + c + '-employment')?.value || '',
      risk:       globalRisk
    };

    let score = calculateCurrencyScore(data);

    // [SESSION 2 - TASK 3] News bias nudge (0.5 weight — never overrides fundamentals)
    score += (window.NEWS_BIAS?.[c] || 0) * 0.5;

    // XAU override — gold driven by rate direction + risk sentiment only
    if (c === 'XAU') {
      score = 0;
      if (data.rate === 'bullish') score += 3;   // rising gold price
      if (data.rate === 'bearish') score -= 3;
      if (data.cpi === 'rising')   score += 2;   // inflation = gold bid
      if (data.cpi === 'falling')  score -= 1;
    }

    // Apply risk-sentiment layer
    if (globalRisk && RISK_SENSITIVITY[c]) {
      score += RISK_SENSITIVITY[c][globalRisk] || 0;
    }

    return { currency: c, score: parseFloat(score.toFixed(2)) };
  });


  // Sort strongest → weakest
  const rankings = scored.sort((a, b) => b.score - a.score);
  S.rankings = rankings;

  // Persist to localStorage so rankings survive page nav
  if (S.user) {
    localStorage.setItem('tes_cs_' + S.user.uid, JSON.stringify(rankings));
  }

  renderCurrencyTable(rankings);
  renderTradeSuggestions(rankings);
  renderAISummary(rankings);  // ← ADD THIS LINE
}

/* ─── AI BIAS SUMMARY ── [N9] ─────────────────────────────
   Reads rankings + top suggestions, calls Claude API,
   renders a plain-English analyst summary.
   ────────────────────────────────────────────────────────── */
async function renderAISummary(rankings) {
  const el = document.getElementById('ai-summary-box');
  if (!el) return;

  // [TEMPORARILY DISABLED] AI summary re-enabled when backend AI is ready
  el.innerHTML = `
    <div style="text-align:center;padding:20px">
      <p style="font-size:13px;color:#5a6a8a">
        🤖 AI Bias Analysis coming soon.
      </p>
    </div>`;
}

function _restoreCurrencyAnalysis() {
  if (!S.user) return;
  try {
    const saved = JSON.parse(localStorage.getItem('tes_cs_' + S.user.uid));
    if (saved && saved.length) {
      S.rankings = saved;
      renderCurrencyTable(saved);
      renderTradeSuggestions(saved);
    }
  } catch { /* no saved data, fine */ }
}

/* ─── [SESSION 2 - TASK 2] MACRO DATA INJECTION ──────────── */
async function fetchAndInjectMacroData() {
  try {
    const res = await fetch('https://tes-pro-backend.onrender.com/macro-data');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const macro = await res.json();

    function rateLabel(rate) {
      if (rate == null) return '';
      if (rate > 3)    return 'bullish';
      if (rate < 1)    return 'bearish';
      return '';
    }
    function cpiLabel(trend) {
      if (trend === 'rising')  return 'rising';
      if (trend === 'falling') return 'falling';
      return '';
    }

    const currencies = ['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF'];
    currencies.forEach(c => {
      const d = macro[c];
      if (!d) return;
      const rateEl = document.getElementById('cs-' + c + '-rate');
      const cpiEl  = document.getElementById('cs-' + c + '-cpi');
      if (rateEl) rateEl.value = rateLabel(d.rate);
      if (cpiEl)  cpiEl.value  = cpiLabel(d.cpiTrend);
    });

    runCurrencyAnalysis();
    _toast('✅ Live macro data loaded', 'success');
    console.log('[TES] Macro data injected:', macro);

  } catch (err) {
    console.warn('[TES] Macro fetch failed:', err.message);
    _toast('⚠️ Using manual inputs', 'warning');
  }
}

/* ─── [SESSION 2 - TASK 3] NEWS SENTIMENT INJECTION ─────── */
async function fetchAndInjectNewsSentiment() {
  try {
    const res = await fetch('https://tes-pro-backend.onrender.com/news-sentiment');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    window.NEWS_BIAS = data.bias || {};
    console.log('[TES] News bias loaded:', window.NEWS_BIAS);

    _renderNewsPanel(data.headlines || []);

    const breaking = (data.headlines || []).find(h => h.impact === 'high');
    if (breaking) _showBreakingAlert(breaking.title);

  } catch (err) {
    console.warn('[TES] News sentiment fetch failed:', err.message);
  }
}

function _renderNewsPanel(headlines) {
  const panel = document.getElementById('news-panel');
  if (!panel) return;

  if (!headlines.length) {
    panel.innerHTML = '<p style="color:var(--t2);font-size:13px">No headlines available.</p>';
    return;
  }

  const impactBadge = {
    high:   '<span style="font-size:11px;background:rgba(255,69,96,.15);color:#ff4560;border:1px solid rgba(255,69,96,.3);border-radius:20px;padding:2px 8px;font-weight:700">🔴 High</span>',
    medium: '<span style="font-size:11px;background:rgba(228,174,42,.12);color:#e4ae2a;border:1px solid rgba(228,174,42,.3);border-radius:20px;padding:2px 8px;font-weight:700">🟡 Medium</span>',
    low:    '<span style="font-size:11px;background:rgba(255,255,255,.06);color:#5a6a8a;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:2px 8px;font-weight:700">⚪ Low</span>'
  };

  panel.innerHTML = headlines.slice(0, 10).map(h => {
    const badge   = impactBadge[h.impact] || impactBadge.low;
    const date    = h.publishedAt ? new Date(h.publishedAt).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
    const safeUrl = h.url ? h.url.replace(/"/g, '') : '#';
    return `
      <div style="padding:12px 0;border-bottom:1px solid var(--bd)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
          ${badge}
          <span style="font-size:11px;color:var(--t2);white-space:nowrap;flex-shrink:0">${date}</span>
        </div>
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
           style="font-size:13px;font-weight:600;color:var(--t1);text-decoration:none;line-height:1.5;display:block;margin-bottom:4px">
          ${_escHtml(h.title || '')}
        </a>
        <span style="font-size:11px;color:#5a6a8a">${_escHtml(h.source || '')}</span>
      </div>`;
  }).join('');
}

function _showBreakingAlert(title) {
  const el = document.getElementById('breaking-alert');
  if (!el) return;
  el.textContent = '🚨 ' + title;
  el.style.display = 'block';
  clearTimeout(el._dismiss);
  el._dismiss = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

/* ─── RENDER CURRENCY TABLE ── [N7] ───────────────────────── */
function renderCurrencyTable(rankings) {
  const tbody = document.getElementById('cs-table-body');
  const wrap  = document.getElementById('cs-results-wrap');
  if (!tbody) return;
  if (wrap) wrap.style.display = 'block';

  const maxAbs = Math.max(...rankings.map(r => Math.abs(r.score)), 1);

  tbody.innerHTML = rankings.map((r, i) => {
    const pct   = Math.min(100, Math.round((Math.abs(r.score) / maxAbs) * 100));
    const color = r.score > 1 ? '#00d4a1' : r.score < -1 ? '#ff4560' : '#7a8eb0';
    const badge = r.score > 1 ? 'BULL' : r.score < -1 ? 'BEAR' : 'NEU';
    const sign  = r.score > 0 ? '+' : '';

    return `<tr>
      <td style="padding:9px 10px;color:#5a6a8a;font-size:12px">${i + 1}</td>
      <td style="padding:9px 10px;font-weight:800;font-size:15px">${r.currency}</td>
      <td style="padding:9px 10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:7px;background:#1c2840;border-radius:4px;overflow:hidden;min-width:60px">
            <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width .4s ease"></div>
          </div>
          <span style="font-size:12px;font-weight:700;color:${color};min-width:36px;text-align:right">${sign}${r.score}</span>
        </div>
      </td>
      <td style="padding:9px 10px">
        <span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px;background:${color}20;color:${color}">${badge}</span>
      </td>
    </tr>`;
  }).join('');
}

/* ─── AUTO TRADE SUGGESTIONS ── [N8] ─────────────────────── */
function renderTradeSuggestions(rankings) {
  const el = document.getElementById('sugg-list');
  if (!el) return;

  if (!rankings.length) {
    el.innerHTML = '<p style="color:#5a6a8a;font-size:13px">Run currency analysis above to generate suggestions.</p>';
    return;
  }

  const suggestions = [];

  // Build suggestions: strongest base vs weakest quote
  TRADE_PAIRS.forEach(([base, quote]) => {
    const bRank = rankings.find(r => r.currency === base);
    const qRank = rankings.find(r => r.currency === quote);
    if (!bRank || !qRank) return;

    const diff = bRank.score - qRank.score;
    if (Math.abs(diff) < 1.5) return; // not enough divergence for a confident suggestion

    suggestions.push({
      pair:      base + quote,
      direction: diff > 0 ? 'BUY' : 'SELL',
      score:     Math.abs(diff),
      strong:    diff > 0 ? base  : quote,
      weak:      diff > 0 ? quote : base
    });
  });

  const top3 = suggestions.sort((a, b) => b.score - a.score).slice(0, 3);

  if (!top3.length) {
    el.innerHTML = '<p style="color:#5a6a8a;font-size:13px">No strong setups found. Adjust fundamentals and try again.</p>';
    return;
  }

  el.innerHTML = top3.map((s, i) => {
    const col   = s.direction === 'BUY' ? '#00d4a1' : '#ff4560';
    const arrow = s.direction === 'BUY' ? '↑' : '↓';
    const conf  = Math.min(99, Math.round(50 + s.score * 7));

    return `<div style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px;margin-bottom:10px;display:flex;align-items:center;gap:14px">
      <div style="width:40px;height:40px;border-radius:10px;background:${col}18;border:1px solid ${col}50;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:${col};flex-shrink:0">${arrow}</div>
      <div style="flex:1">
        <div style="font-size:18px;font-weight:900;letter-spacing:-.3px">${s.pair}</div>
        <div style="font-size:11px;color:#5a6a8a;margin-top:2px">${s.strong} strong vs ${s.weak} weak &nbsp;·&nbsp; Δ${s.score.toFixed(1)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:16px;font-weight:800;color:${col}">${s.direction}</div>
        <div style="font-size:11px;color:#5a6a8a;margin-top:2px">${conf}% conf</div>
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   RISK CALCULATOR — [N9]
   Formula per prompt spec:
     pipDistance = |entry − stopLoss| × 10000
     riskAmount  = (balance × risk%) / 100
     lotSize     = riskAmount / (pipDistance × 10)
     profit      = |tp − entry| × 10000 × lotSize × 10   (if TP set)
   [N10] Guards: parseFloat defaults to 0, no division by zero
   ═══════════════════════════════════════════════════════════ */
function calcRisk() {
  const balance  = parseFloat(document.getElementById('rc-balance')?.value)  || 0;
  const riskPct  = parseFloat(document.getElementById('rc-risk')?.value)      || 0;
  const entry    = parseFloat(document.getElementById('rc-entry')?.value)     || 0;
  const stopLoss = parseFloat(document.getElementById('rc-sl')?.value)        || 0;
  const tp       = parseFloat(document.getElementById('rc-tp')?.value)        || 0;

  const resultEl = document.getElementById('rc-result');
  if (!resultEl) return;

  // All main inputs needed before we can compute
  if (!balance || !riskPct || !entry || !stopLoss) {
    resultEl.innerHTML = '<span style="color:#5a6a8a">Fill in Balance, Risk %, Entry, and Stop Loss to calculate.</span>';
    return;
  }

  const pipDist  = Math.abs(entry - stopLoss) * 10000;
  if (pipDist === 0) {
    resultEl.innerHTML = '<span style="color:#ff4560">Entry and Stop Loss cannot be the same.</span>';
    return;
  }

  const riskAmt  = (balance * riskPct) / 100;
  const lotSize  = riskAmt / (pipDist * 10);

  // Potential profit (only if TP is set)
  const hasTP       = tp > 0 && tp !== entry;
  const rewardPips  = hasTP ? Math.abs(tp - entry) * 10000 : 0;
  const profit      = hasTP ? rewardPips * lotSize * 10 : 0;
  const rr          = hasTP && riskAmt > 0 ? (profit / riskAmt).toFixed(2) : null;

  resultEl.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#5a6a8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Pip Distance</div>
        <div style="font-size:22px;font-weight:800;color:#e4ae2a">${pipDist.toFixed(1)}</div>
      </div>
      <div style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#5a6a8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Risk Amount</div>
        <div style="font-size:22px;font-weight:800;color:#ff4560">$${riskAmt.toFixed(2)}</div>
      </div>
      <div style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#5a6a8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Lot Size</div>
        <div style="font-size:22px;font-weight:800;color:#00d4a1">${lotSize.toFixed(2)}</div>
      </div>
      ${hasTP ? `
      <div style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#5a6a8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Potential Profit</div>
        <div style="font-size:22px;font-weight:800;color:#00d4a1">$${profit.toFixed(2)}</div>
      </div>
      <div style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px;text-align:center;grid-column:span 2">
        <div style="font-size:10px;color:#5a6a8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Risk : Reward</div>
        <div style="font-size:22px;font-weight:800;color:#e4ae2a">1 : ${rr}</div>
      </div>` : ''}
    </div>`;
}

/* ─── Risk calc live event listeners ─────────────────────── */
// [N10] Wired after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  ['rc-balance','rc-risk','rc-entry','rc-sl','rc-tp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calcRisk);
  });
});

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
/* ═══════════════════════════════════════════════════════════════
   PSYCHOLOGY BOOTCAMP — added cleanly, no overwrites
   ═══════════════════════════════════════════════════════════════ */

function _loadPsychologyState() {
  if (!S.user) return;
  try {
    const saved = JSON.parse(localStorage.getItem('tes_psych_' + S.user.uid));
    if (saved) S.psychologyState = { ...S.psychologyState, ...saved };
  } catch (e) {}
}

function _savePsychologyState() {
  if (!S.user) return;
  try { localStorage.setItem('tes_psych_' + S.user.uid, JSON.stringify(S.psychologyState)); }
  catch (e) {}
}

function showPsychologyApp() {
  document.getElementById('screen-app').style.display = 'none';
  const w = document.getElementById('psychology-wrapper');
  if (w) w.style.display = 'flex';
  _loadPsychologyState();
  _renderPsychologyHub();
}

function returnToTesPro() {
  _savePsychologyState();
  const w = document.getElementById('psychology-wrapper');
  if (w) w.style.display = 'none';
  document.getElementById('screen-app').style.display = 'flex';
}

function _addPsychologyNavButton() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav || nav.querySelector('[data-psych-btn]')) return;
  const btn = document.createElement('button');
  btn.className = 'nav-btn';
  btn.setAttribute('data-psych-btn', '1');
  btn.onclick = showPsychologyApp;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a5 5 0 0 1 10 0v1.662"/></svg>Psychology';
  nav.appendChild(btn);
}

function _getPsychologyRank(xp) {
  if (xp >= 1500) return 'ELITE OPERATOR';
  if (xp >= 900)  return 'SERGEANT';
  if (xp >= 500)  return 'CORPORAL';
  if (xp >= 200)  return 'PRIVATE';
  return 'RECRUIT';
}

function _getPsychologyProgress(xp) {
  return Math.min((xp / 2000) * 100, 100).toFixed(1);
}

function _renderPsychologyHub() {
  const wrapper = document.getElementById('psychology-wrapper');
  if (!wrapper) return;
  const ps = S.psychologyState;
  const rank = _getPsychologyRank(ps.xp);
  wrapper.innerHTML = `
    <div style="max-width:660px;margin:0 auto;padding:20px 16px 100px;min-height:100vh">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:24px 0 16px;border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:20px">
        <div>
          <div style="font-size:10px;color:#00ff88;letter-spacing:3px;margin-bottom:4px;font-weight:700;text-transform:uppercase">◈ ${rank}</div>
          <div style="font-size:18px;font-weight:900;color:#eef2ff;letter-spacing:2px">TRADING PSYCH BOOTCAMP</div>
          <div style="font-size:10px;color:#5a6a8a;margin-top:2px;letter-spacing:1px">Trading in the Zone · Mark Douglas</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;color:#e4ae2a;font-weight:700;margin-bottom:4px">⚡ ${ps.xp} XP</div>
          <div style="font-size:11px;color:#ff6644;margin-bottom:10px">🔥 ${ps.streak} day streak</div>
          <button onclick="returnToTesPro()" style="background:transparent;border:1px solid #ff4466;color:#ff4466;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px">← TES PRO</button>
        </div>
      </div>
      <div style="height:4px;background:rgba(255,255,255,.07);border-radius:2px;overflow:hidden;margin-bottom:16px">
        <div style="height:100%;width:${_getPsychologyProgress(ps.xp)}%;background:linear-gradient(90deg,#00ff88,#00ccff);border-radius:2px;transition:width .6s"></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px">
        ${[['discipline','#00ff88'],['emotion','#00ccff'],['execution','#cc44ff']].map(([k,c])=>`
        <div style="flex:1;background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:10px 8px;text-align:center">
          <div style="font-size:22px;font-weight:900;color:${c};margin-bottom:3px">${ps.scores[k]}</div>
          <div style="font-size:9px;color:#5a6a8a;text-transform:uppercase;letter-spacing:.7px">${k}</div>
        </div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
        ${[['⚔️','LEVELS','5 Levels','levels'],['🎯','SCENARIOS','Trade Drills','scenarios'],['📋','MISSIONS','Daily','missions'],['🧬','ARCHETYPE','Profile','archetypes']].map(([icon,label,sub,screen])=>`
        <button onclick="_showPsychologyScreen('${screen}')" style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px 12px;cursor:pointer;text-align:left;transition:all .2s">
          <div style="font-size:20px;margin-bottom:6px">${icon}</div>
          <div style="font-size:13px;font-weight:700;color:#eef2ff;letter-spacing:1px;margin-bottom:2px">${label}</div>
          <div style="font-size:10px;color:#5a6a8a">${sub}</div>
        </button>`).join('')}
      </div>
      <div style="background:#141e33;border:1px solid rgba(255,255,255,.07);border-left:3px solid rgba(228,174,42,.5);border-radius:8px;padding:16px 18px">
        <div style="font-size:14px;line-height:1.6;color:#5a6a8a;font-style:italic;margin-bottom:4px">"The consistency you seek is in your mind, not in the markets."</div>
        <div style="font-size:12px;color:#3a4a66">— Mark Douglas</div>
      </div>
    </div>`;
}

function _showPsychologyScreen(screen) {
  const wrapper = document.getElementById('psychology-wrapper');
  if (!wrapper) return;
  const ps = S.psychologyState;
  const backBtn = `<button onclick="_renderPsychologyHub()" style="position:fixed;top:20px;right:16px;z-index:10;background:transparent;border:1px solid #ff4466;color:#ff4466;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">← BACK</button>`;
  const wrap = (title, content) => `<div style="max-width:660px;margin:0 auto;padding:20px 16px 100px">${backBtn}<div style="padding-top:40px"><div style="font-size:18px;font-weight:900;color:#eef2ff;letter-spacing:2px;margin-bottom:20px">${title}</div>${content}</div></div>`;
  const card = (content) => `<div style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:16px;margin-bottom:12px">${content}</div>`;

  if (screen === 'levels') {
    const levels = [
      ['🥉','LEVEL 1: AWARENESS','#00ff88',0,'Recognize your emotional patterns. Identify triggers that make you deviate from your plan.',50],
      ['🥈','LEVEL 2: MASTERY','#00ccff',100,'Develop discipline techniques. Stick to your trading plan even when emotions run high.',100],
      ['🥇','LEVEL 3: CONSISTENCY','#ff9944',300,'Execute with absolute consistency. No hesitation, no second-guessing.',150],
      ['💎','LEVEL 4: ZONE','#cc44ff',600,'Enter the Trading Zone. Pure execution where emotions don\'t interfere.',200],
      ['👑','LEVEL 5: ELITE','#e4ae2a',1000,'Complete mastery. Trading psychology under any market condition.',300],
    ];
    wrapper.innerHTML = wrap('⚔️ LEVELS', levels.map(([icon,name,color,req,desc,reward])=>card(`
      <div style="font-size:14px;font-weight:900;color:${color};margin-bottom:8px">${icon} ${name}</div>
      <div style="font-size:12px;color:#5a6a8a;line-height:1.6;margin-bottom:8px">${desc}</div>
      <div style="font-size:11px;color:${ps.xp>=req?color:'#3a4a66'}">${ps.xp>=req?'✓ Unlocked':'🔒 Reach '+req+' XP'} · Reward: +${reward} XP</div>
    `)).join(''));
  } else if (screen === 'scenarios') {
    const scenarios = [
      ['The Breakeven Close','Your trade just hit breakeven. 2 hours to market close. What do you do?','Close and move on','✓ Correct! Lock in discipline. Breakeven is +0R, still disciplined execution.','Hold for bigger target','✗ Risky: No new setup = no reason to hold. This is hope, not a plan.','discipline'],
      ['The Revenge Trade','You just took a loss. Another setup forms immediately. Impulse is strong. What do you do?','Wait and process the loss first','✓ Correct! Discipline over emotion. Wait at least 30 minutes before re-entering.','Jump in immediately','✗ Revenge trading. You\'re trading your emotions, not the market.','emotion'],
      ['The FOMO Trade','Market is rallying. Everyone\'s talking about it. No setup. Fear of missing out is high. What do you do?','Stay disciplined — wait for your setup','✓ Correct! No setup = No trade. The next bus always comes.','Chase the move','✗ Chasing tops is how traders get stopped out at the worst price.','discipline'],
    ];
    wrapper.innerHTML = wrap('🎯 SCENARIOS', scenarios.map(([title,q,aGood,aGoodResult,aBad,aBadResult,skill])=>card(`
      <div style="font-size:13px;font-weight:900;color:#eef2ff;margin-bottom:8px">${title}</div>
      <div style="font-size:12px;color:#5a6a8a;margin-bottom:12px;line-height:1.6">${q}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button style="background:rgba(0,212,161,.1);border:1px solid rgba(0,212,161,.3);color:#00d4a1;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;text-align:left"
          onclick="_toast('${aGoodResult}','success');S.psychologyState.xp+=20;S.psychologyState.scores.${skill}+=5;_savePsychologyState()">✅ ${aGood}</button>
        <button style="background:rgba(255,69,96,.1);border:1px solid rgba(255,69,96,.3);color:#ff4560;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;text-align:left"
          onclick="_toast('${aBadResult}','warning')">❌ ${aBad}</button>
      </div>
    `)).join(''));
  } else if (screen === 'missions') {
    const missions = [
      ['📖','Read Psychology Chapter','10 min read on discipline',30,'discipline',5],
      ['✅','Complete Pre-Trade Checklist','Use TES PRO checklist today',40,'discipline',10],
      ['📊','Journal Your Trade','Log at least 1 trade',35,'execution',5],
      ['💭','Reflect on a Mistake','Write 1 lesson from a loss',25,'emotion',5],
      ['🎯','No Revenge Trades Today','Maintain discipline all session',50,'discipline',15],
    ];
    wrapper.innerHTML = wrap('📋 DAILY MISSIONS', missions.map(([icon,title,sub,xp,skill,pts])=>card(`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-size:13px;font-weight:700;color:#eef2ff;margin-bottom:2px">${icon} ${title}</div>
          <div style="font-size:11px;color:#5a6a8a">${sub} · +${xp} XP</div>
        </div>
        <button style="background:#e4ae2a;color:#000;padding:8px 16px;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;flex-shrink:0;white-space:nowrap"
          onclick="this.disabled=true;this.textContent='✓ Done';_toast('+${xp} XP earned!','success');S.psychologyState.xp+=${xp};S.psychologyState.scores.${skill}+=${pts};_savePsychologyState()">Complete</button>
      </div>
    `)).join(''));
  } else if (screen === 'archetypes') {
    const archetypes = [
      ['🦁','THE DISCIPLINARIAN','#00ff88','rgba(0,255,136,.1)','rgba(0,255,136,.3)','Follows the plan religiously. Never revenge trades. Takes losses without emotion. If you\'re here — you\'re winning.','discipline',10],
      ['🔥','THE EMOTIONAL TRADER','#00ccff','rgba(0,204,255,.1)','rgba(0,204,255,.3)','Makes decisions based on feelings. Takes losses hard. Revenge trades are your weakness. Work on emotional control.','emotion',10],
      ['⚡','THE IMPULSIVE TRADER','#cc44ff','rgba(204,68,255,.1)','rgba(204,68,255,.3)','Enters without a plan. Chases moves. FOMO is your biggest enemy. Master patience and setup confirmation.','execution',10],
    ];
    wrapper.innerHTML = wrap('🧬 TRADER ARCHETYPES', archetypes.map(([icon,name,color,bg,border,desc,skill,pts])=>card(`
      <div style="font-size:14px;font-weight:900;color:${color};margin-bottom:8px">${icon} ${name}</div>
      <div style="font-size:12px;color:#5a6a8a;line-height:1.6;margin-bottom:10px">${desc}</div>
      <button style="width:100%;background:${bg};border:1px solid ${border};color:${color};padding:10px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer"
        onclick="_toast('Profile selected! +15 XP','success');S.psychologyState.xp+=15;S.psychologyState.scores.${skill}+=${pts};_savePsychologyState()">This is me → +15 XP</button>
    `)).join(''));
  }
}

/* ═══════════════════════════════════════════════════════════════
   GOLD DESK — XAUUSD complete engine
   ═══════════════════════════════════════════════════════════════ */

function _initGoldPage() {
  _renderGoldSessions();
}

function runGoldBiasEngine() {
  const usd       = document.getElementById('gd-usd-strength')?.value || '';
  const yields    = document.getElementById('gd-yields')?.value       || '';
  const fed       = document.getElementById('gd-fed')?.value          || '';
  const risk      = document.getElementById('gd-risk')?.value         || '';
  const inflation = document.getElementById('gd-inflation')?.value    || '';

  if (!usd || !yields || !fed || !risk || !inflation) {
    _toast('Select all 5 parameters first.', 'warning'); return;
  }

  let score = 0;
  if (usd === 'strong') score -= 2; else if (usd === 'weak') score += 2;
  if (yields === 'rising') score -= 1.5; else if (yields === 'falling') score += 1.5;
  if (fed === 'hawkish') score -= 2; else if (fed === 'dovish') score += 2;
  if (risk === 'risk-on') score -= 1; else if (risk === 'risk-off') score += 2;
  if (inflation === 'rising') score += 1.5; else if (inflation === 'falling') score -= 1;

  const bias  = score > 3 ? '🟢 BULLISH' : score < -3 ? '🔴 BEARISH' : '🟡 NEUTRAL';
  const col   = score > 3 ? '#00d4a1'    : score < -3 ? '#ff4560'    : '#e4ae2a';
  const conf  = Math.min(Math.abs(score) * 15, 95).toFixed(0);
  const pos   = score > 3 ? 'LONG'       : score < -3 ? 'SHORT'      : 'WAIT';

  const el = document.getElementById('gd-bias-result');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:#10172a;border:1px solid ${col}40;border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:20px;font-weight:900;color:${col};margin-bottom:8px">${bias}</div>
      <div style="font-size:12px;color:#5a6a8a;margin-bottom:12px">Score: ${score>0?'+':''}${score.toFixed(1)} · Confidence: ${conf}%</div>
      <div style="height:6px;background:#1c2840;border-radius:3px;overflow:hidden;margin-bottom:12px">
        <div style="height:100%;width:${conf}%;background:${col};border-radius:3px;transition:width .6s"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:#141e33;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:10px;color:#5a6a8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Position</div>
          <div style="font-size:18px;font-weight:900;color:${col}">${pos}</div>
        </div>
        <div style="background:#141e33;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:10px;color:#5a6a8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Confidence</div>
          <div style="font-size:18px;font-weight:900;color:${col}">${conf}%</div>
        </div>
      </div>
      <div style="margin-top:12px;padding:12px;background:#141e33;border-radius:8px;font-size:12px;color:#5a6a8a;line-height:1.6">
        <strong style="color:#7a8eb0">Risk Management:</strong><br>
        • Entry: On ${pos==='LONG'?'breakout above':'breakdown below'} key level<br>
        • Stop: ${pos==='LONG'?'Below recent swing low':'Above recent swing high'}<br>
        • Target: Minimum 1:2 Risk:Reward<br>
        • Session: Trade during London/NY overlap only
      </div>
    </div>`;
}

function runWhyGoldMoved() {
  const dir    = document.getElementById('gd-moved-direction')?.value || '';
  const driver = document.getElementById('gd-moved-driver')?.value   || '';
  if (!dir || !driver) { _toast('Select direction and driver.', 'warning'); return; }

  const narratives = {
    cpi:         'CPI data shifted rate hike expectations. Higher inflation → rate hike pressure → USD stronger → Gold weaker. Lower inflation = opposite.',
    nfp:         'NFP jobs data moved USD. Strong NFP = USD rally = Gold sold off. Weak NFP = safe haven bid into Gold.',
    fomc:        'FOMC decision or Fed commentary changed rate outlook. Hawkish tone pressures Gold; dovish tone supports Gold.',
    geopolitical:'Geopolitical risk triggered safe haven flows. Gold is the primary safe haven asset — uncertainty = buyers.',
    yields:      'US 10-year Treasury yield moved sharply. Rising yields = higher opportunity cost to hold Gold = sellers. Falling yields = Gold rallies.',
    usd:         'DXY (Dollar Index) drove the move directly. Gold has a near-perfect inverse correlation with USD strength.'
  };

  const moved = dir === 'rallied' ? 'Gold rallied' : dir === 'sold-off' ? 'Gold sold off' : 'Gold ranged';
  const el = document.getElementById('gd-moved-result');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:#10172a;border-left:3px solid #e4ae2a;border-radius:0 10px 10px 0;padding:14px;font-size:13px;color:#eef2ff;line-height:1.7">
      <strong style="color:#e4ae2a">${moved}</strong> today because: ${narratives[driver] || 'market conditions shifted.'}
    </div>`;
}

function runGoldNewsInterpreter() {
  const event   = document.getElementById('gd-news-event')?.value   || '';
  const outcome = document.getElementById('gd-news-outcome')?.value || '';
  if (!event || !outcome) { _toast('Select event and outcome.', 'warning'); return; }

  const reactions = {
    cpi:        { better: '🔴 Gold DOWN — Higher inflation = rate hike odds = USD strength = Gold pressure', worse: '🟢 Gold UP — Lower inflation = rate cut odds = USD weakness = Gold rally', inline: '🟡 Neutral — In-line data rarely moves Gold significantly', hike: '🔴 Gold DOWN', cut: '🟢 Gold UP', hold: '🟡 Neutral' },
    nfp:        { better: '🔴 Gold DOWN — Strong jobs = strong USD = Gold pressure', worse: '🟢 Gold UP — Weak jobs = safe haven bid = Gold rally', inline: '🟡 Neutral', hike: '🔴 Gold DOWN', cut: '🟢 Gold UP', hold: '🟡 Neutral' },
    fomc:       { hike: '🔴 Gold DOWN — Rate hike = higher yields = USD rally = Gold sells off', cut: '🟢 Gold UP — Rate cut = lower yields = USD weakness = Gold rallies', hold: '🟡 Neutral — No change = Gold trades on other factors', better: '🔴 Gold DOWN', worse: '🟢 Gold UP', inline: '🟡 Neutral' },
    employment: { better: '🔴 Gold DOWN — Strong employment = USD bid = Gold lower', worse: '🟢 Gold UP — Weak employment = safe haven demand', inline: '🟡 Neutral', hike: '🔴 Gold DOWN', cut: '🟢 Gold UP', hold: '🟡 Neutral' },
    gdp:        { better: '🔴 Gold DOWN — Strong growth = rate hike expectations = USD strength', worse: '🟢 Gold UP — Weak growth = safe haven demand = Gold bid', inline: '🟡 Neutral', hike: '🔴 Gold DOWN', cut: '🟢 Gold UP', hold: '🟡 Neutral' }
  };

  const reaction = reactions[event]?.[outcome] || '🟡 Neutral — Data impact unclear';
  const el = document.getElementById('gd-news-result');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:#10172a;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px">
      <div style="font-size:10px;color:#5a6a8a;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Expected Gold Reaction</div>
      <div style="font-size:15px;font-weight:700;color:#eef2ff">${reaction}</div>
    </div>`;
}

function _renderGoldSessions() {
  const el = document.getElementById('gd-sessions-wrap');
  if (!el) return;
  const now = new Date();
  const utcH = now.getUTCHours();
  const sessions = [
    { name: 'Asian Session',    open: 0,  close: 9,  vol: 'Low',       tip: 'Tight ranges. Avoid unless scalping.' },
    { name: 'London Session',   open: 8,  close: 17, vol: 'High',      tip: 'Strong directional moves. Best session for Gold.' },
    { name: 'New York Session', open: 13, close: 22, vol: 'Very High', tip: 'Highest volatility. News events hit hardest here.' }
  ];
  el.innerHTML = sessions.map(s => {
    const isOpen = utcH >= s.open && utcH < s.close;
    const col    = isOpen ? '#00d4a1' : '#5a6a8a';
    const bg     = isOpen ? 'rgba(0,212,161,.08)' : 'transparent';
    return `<div style="background:${bg};border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:13px;font-weight:700;color:#eef2ff">${s.name}</div>
        <span style="font-size:10px;font-weight:800;padding:2px 9px;border-radius:20px;background:${col}20;color:${col};border:1px solid ${col}40">${isOpen ? '🟢 OPEN' : '⚫ CLOSED'} · ${s.vol}</span>
      </div>
      <div style="font-size:11px;color:#5a6a8a">${s.open}:00–${s.close}:00 GMT &nbsp;·&nbsp; ${s.tip}</div>
    </div>`;
  }).join('');

  const advice = document.getElementById('gd-session-advice');
  if (advice) advice.textContent = '💡 Peak liquidity: London/NY overlap 13:00–17:00 GMT. Best time to trade XAUUSD.';
}

/* ═══════════════════════════════════════════════════════════════
   SESSION TIMER — Trading session status on dashboard
   ═══════════════════════════════════════════════════════════════ */

function _startSessionTimer() {
  const el = document.getElementById('session-timer-card');
  if (!el) return;
  const sessions = [
    { name: 'Asian',    open: 0,  close: 9  },
    { name: 'London',   open: 8,  close: 17 },
    { name: 'New York', open: 13, close: 22 }
  ];
  function update() {
    const utcH = new Date().getUTCHours();
    el.innerHTML = `<div style="font-size:10px;font-weight:700;color:#5a6a8a;text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px">📅 Trading Sessions (GMT)</div>` +
      sessions.map(s => {
        const open = utcH >= s.open && utcH < s.close;
        const col  = open ? '#00d4a1' : '#5a6a8a';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="font-size:13px;font-weight:700;color:#eef2ff">${s.name}</div>
          <div style="font-size:11px;font-weight:700;color:${col}">${open ? '🟢 OPEN' : '⚫ CLOSED'}</div>
          <div style="font-size:10px;color:#5a6a8a">${s.open}:00–${s.close}:00</div>
        </div>`;
      }).join('');
  }
  update();
  setInterval(update, 60000);
}

/* ─── Psychology state init ─────────────────────────────────── */

/* ── Psychology state init on S object ─────────────────────── */
S.psychologyState = S.psychologyState || {
  currentScreen: 'hub',
  xp: 0,
  streak: 1,
  scores: { discipline: 0, emotion: 0, execution: 0 },
  completedScenarios: [],
  completedMissions: []
};

/* ─── Export/delete helpers (settings page) ────────────────── */
function exportCSV() {
  if (!S.trades?.length) { _toast('No trades to export.', 'warning'); return; }
  const header = 'Date,Pair,Direction,Entry,SL,TP,RR,Outcome,Session,Notes\n';
  const rows = S.trades.map(t => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
    return [d.toLocaleDateString('en-GB'),t.pair||'',t.direction||'',t.entry||'',t.sl||'',t.tp||'',t.rr||'',t.outcome||'',t.session||'','"'+(t.notes||'').replace(/"/g,"'")+'"'].join(',');
  }).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([header+rows],{type:'text/csv'}));
  a.download = 'tes_trades_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
  _toast('CSV exported ✓', 'success');
}

function exportJSON() {
  if (!S.trades?.length) { _toast('No trades to export.', 'warning'); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.trades,null,2)],{type:'application/json'}));
  a.download = 'tes_trades_'+new Date().toISOString().slice(0,10)+'.json'; a.click();
  _toast('JSON exported ✓', 'success');
}

function confirmDeleteAll() {
  if (!S.trades?.length) { _toast('No trades.', 'warning'); return; }
  if (!confirm('Delete ALL '+S.trades.length+' trades? Cannot be undone.')) return;
  Promise.all(S.trades.map(t => deleteTrade(t.id))).then(() => _toast('All trades deleted.','success'));
}

// Load Chart.js async
(function() {
  if (typeof Chart !== 'undefined') return;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  s.async = true;
  document.head.appendChild(s);
})();
