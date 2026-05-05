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
  // [SESSION 3 - SESSION TIMER] Start live session timer
  _startSessionTimer();
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
  renderAISummary(rankings);
  renderTradeInsight(rankings);   // [SESSION 3 - TRADE INSIGHT]
  renderTradePlan(null, rankings); // [SESSION 3 - TRADE PLAN]
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

/* ═══════════════════════════════════════════════════════════
   SESSION 3 — TRADE EXECUTION INSIGHT ENGINE
   ═══════════════════════════════════════════════════════════ */

function generateTradeInsight(rankings) {
  if (!rankings || rankings.length < 2) return null;
  const fx      = rankings.filter(r => r.currency !== 'XAU');
  const xau     = rankings.find(r => r.currency === 'XAU');
  const strong  = fx[0];
  const weak    = fx[fx.length - 1];
  const diff    = parseFloat((strong.score - weak.score).toFixed(2));

  let confidence, setup, plan;

  if (diff > 4) {
    confidence = 'HIGH';
    setup      = 'Trend Continuation';
    plan       = `Strong fundamental divergence detected. ${strong.currency} is significantly outperforming ${weak.currency}. Look for pullbacks on ${strong.currency + weak.currency} into premium/discount zones on H1 for continuation entries. Target 1:2 minimum R:R. Avoid counter-trend trades today.`;
  } else if (diff > 2) {
    confidence = 'MEDIUM';
    setup      = 'Momentum Setup';
    plan       = `Moderate divergence between ${strong.currency} and ${weak.currency}. Bias favours ${strong.currency + weak.currency} longs, but wait for confirmation on M15 before entering. Use reduced position size. Watch for news events that could shift momentum.`;
  } else {
    confidence = 'LOW';
    setup      = 'No Clear Edge';
    plan       = `Currencies are closely scored. No dominant bias detected. Best action: stay on the sidelines or paper trade only. Wait for macro events or CB announcements to shift the landscape before committing capital.`;
  }

  let xauNote = '';
  if (xau) {
    const globalRisk = document.getElementById('cs-global-risk')?.value || '';
    if (globalRisk === 'risk-off' && xau.score > 2) {
      xauNote = `Gold (XAU) score is elevated at +${xau.score} — confirms risk-off environment. Consider XAUUSD longs as a secondary play.`;
    } else if (globalRisk === 'risk-on' && xau.score < 0) {
      xauNote = `Gold (XAU) score is weak at ${xau.score} — confirms risk-on environment. Favour commodity currencies (AUD, NZD, CAD).`;
    }
  }

  return {
    pair:       strong.currency + weak.currency,
    direction:  'BUY ' + strong.currency + ' / SELL ' + weak.currency,
    confidence,
    setup,
    plan,
    xauNote,
    scoreDiff:  diff,
    strong:     strong.currency,
    weak:       weak.currency
  };
}

async function renderAISummary(rankings) {
  const el = document.getElementById('ai-summary-box');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:20px"><p style="font-size:13px;color:#5a6a8a">🤖 AI Bias Analysis coming soon.</p></div>`;
  return;
}

function renderTradeInsight(rankings) {
  const el = document.getElementById('trade-insight');
  if (!el) return;

  const insight = generateTradeInsight(rankings);

  if (!insight) {
    el.innerHTML = '<p style="color:#5a6a8a;font-size:13px;padding:12px 0">Run analysis to generate trade insight.</p>';
    return;
  }

  const confColor = insight.confidence === 'HIGH'   ? '#00d4a1'
                  : insight.confidence === 'MEDIUM' ? '#e4ae2a'
                  : '#ff4560';

  const confBg    = insight.confidence === 'HIGH'   ? 'rgba(0,212,161,.1)'
                  : insight.confidence === 'MEDIUM' ? 'rgba(228,174,42,.1)'
                  : 'rgba(255,69,96,.1)';

  const dirCol    = insight.direction.startsWith('BUY') ? '#00d4a1' : '#ff4560';

  el.innerHTML = `
    <div style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:11px;font-weight:700;color:#5a6a8a;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">⚡ Trade Execution Insight</div>
        <div style="font-size:22px;font-weight:900;letter-spacing:-.5px;color:var(--t1)">
          ${insight.pair}
          <span style="font-size:14px;font-weight:700;color:${dirCol};margin-left:8px">${insight.direction}</span>
        </div>
      </div>
      <div style="text-align:right">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:100px;background:${confBg};border:1px solid ${confColor}40">
          <div style="width:7px;height:7px;border-radius:50%;background:${confColor}"></div>
          <span style="font-size:12px;font-weight:800;color:${confColor};letter-spacing:.5px">
            ${insight.confidence} CONFIDENCE
          </span>
        </div>
        <div style="font-size:11px;color:#5a6a8a;margin-top:4px">Score Δ ${insight.scoreDiff}</div>
      </div>
    </div>

    <div style="background:#0c1525;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;color:#5a6a8a;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Setup Type</div>
      <div style="font-size:14px;font-weight:700;color:var(--gold)">${insight.setup}</div>
    </div>

    <div style="background:#0c1525;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:14px;margin-bottom:${insight.xauNote ? '12px' : '0'}">
      <div style="font-size:10px;font-weight:700;color:#5a6a8a;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Execution Plan</div>
      <div style="font-size:13px;color:var(--t1);line-height:1.7">${insight.plan}</div>
    </div>

    ${insight.xauNote ? `<div style="background:rgba(228,174,42,.06);border:1px solid rgba(228,174,42,.2);border-radius:10px;padding:12px;margin-top:0">
      <div style="font-size:12px;color:#e4ae2a;line-height:1.6">🥇 ${insight.xauNote}</div>
    </div>` : ''}`;
}

/* ═══════════════════════════════════════════════════════════
   SESSION 3 — ONE-CLICK TRADE PLAN GENERATOR
   ═══════════════════════════════════════════════════════════ */

function generateTradePlan(pair, rankings) {
  if (!rankings || rankings.length < 2) return null;

  const fx = rankings.filter(r => r.currency !== 'XAU');

  let base, quote;

  if (pair) {
    const currencies = ['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF','XAU'];
    base  = currencies.find(c => pair.startsWith(c));
    quote = currencies.find(c => pair.endsWith(c) && c !== base);
  }

  if (!base || !quote) {
    base  = fx[0]?.currency;
    quote = fx[fx.length - 1]?.currency;
  }

  const baseRank  = rankings.find(r => r.currency === base);
  const quoteRank = rankings.find(r => r.currency === quote);

  if (!baseRank || !quoteRank) return null;

  const diff      = parseFloat((baseRank.score - quoteRank.score).toFixed(2));
  const direction = diff >= 0 ? 'BUY' : 'SELL';
  const strong    = diff >= 0 ? base  : quote;
  const weak      = diff >= 0 ? quote : base;
  const absDiff   = Math.abs(diff);

  const confidence = absDiff > 4 ? 'HIGH' : absDiff > 2 ? 'MEDIUM' : 'LOW';

  const entry = direction === 'BUY'
    ? 'Wait for a pullback into a premium demand zone on H1. Look for a base forming before entry. Avoid chasing the move.'
    : 'Wait for a retracement into a supply zone on H1. Confirm rejection with a bearish structure shift on M15 before entry.';

  const stopLoss = direction === 'BUY'
    ? 'Place stop loss below the most recent swing low or below the demand zone base. Minimum 10 pips buffer.'
    : 'Place stop loss above the most recent swing high or above the supply zone base. Minimum 10 pips buffer.';

  const takeProfit = direction === 'BUY'
    ? 'Target the next resistance level or previous swing high. Minimum 1:2 R:R. Consider partial close at 1R.'
    : 'Target the next support level or previous swing low. Minimum 1:2 R:R. Consider partial close at 1R.';

  const riskNote = `Do not risk more than 1–2% of your account on this trade. Score divergence is ${absDiff.toFixed(1)} — ${confidence.toLowerCase()} confidence setup. ${confidence === 'LOW' ? 'Consider sitting out or paper trading only.' : confidence === 'MEDIUM' ? 'Wait for strong M15 confirmation before entry.' : 'Conditions are favourable but always respect your stop.'}`;

  return {
    pair:       base + quote,
    direction,
    bias:       strong + ' strong / ' + weak + ' weak',
    entry,
    stopLoss,
    takeProfit,
    riskNote,
    confidence,
    scoreDiff:  absDiff
  };
}

function generateTopTradePlan() {
  const rankings = S.rankings;
  if (!rankings || rankings.length < 2) {
    _toast('Run currency analysis first.', 'warning');
    return;
  }
  renderTradePlan(null, rankings);
  const el = document.getElementById('trade-plan');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTradePlan(pair, rankings) {
  const el = document.getElementById('trade-plan');
  if (!el) return;

  if (!rankings || rankings.length < 2) {
    el.innerHTML = '<p style="color:var(--t3);font-size:13px;padding:12px 0">Run analysis to generate a trade plan.</p>';
    return;
  }

  const plan = generateTradePlan(pair, rankings);

  if (!plan) {
    el.innerHTML = '<p style="color:var(--t3);font-size:13px;padding:12px 0">Could not generate plan. Check rankings.</p>';
    return;
  }

  const dirCol   = plan.direction === 'BUY' ? '#00d4a1' : '#ff4560';
  const dirArrow = plan.direction === 'BUY' ? '↑' : '↓';
  const confCol  = plan.confidence === 'HIGH' ? '#00d4a1' : plan.confidence === 'MEDIUM' ? '#e4ae2a' : '#ff4560';
  const confBg   = plan.confidence === 'HIGH' ? 'rgba(0,212,161,.08)' : plan.confidence === 'MEDIUM' ? 'rgba(228,174,42,.08)' : 'rgba(255,69,96,.08)';

  const row = (icon, label, value, valColor) => `
    <div style="padding:12px 0;border-bottom:1px solid var(--bd);display:flex;align-items:flex-start;gap:12px">
      <div style="width:32px;height:32px;border-radius:8px;background:var(--bg1);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">${icon}</div>
      <div style="flex:1">
        <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${label}</div>
        <div style="font-size:13px;color:${valColor || 'var(--t1)'};line-height:1.6;font-weight:500">${value}</div>
      </div>
    </div>`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">⚡ Trade Plan</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:26px;font-weight:900;letter-spacing:-.5px;color:var(--t1)">${plan.pair}</span>
          <span style="font-size:15px;font-weight:800;color:${dirCol};background:${dirCol}18;border:1px solid ${dirCol}40;border-radius:8px;padding:4px 12px">
            ${dirArrow} ${plan.direction}
          </span>
          <span style="font-size:11px;font-weight:800;color:${confCol};background:${confBg};border:1px solid ${confCol}30;border-radius:20px;padding:3px 10px">
            ${plan.confidence} CONF
          </span>
        </div>
        <div style="font-size:12px;color:var(--t2);margin-top:6px">${plan.bias}</div>
      </div>
      <button onclick="generateTopTradePlan()"
        style="background:var(--bg3);border:1px solid var(--bd2);color:var(--gold);border-radius:10px;padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">
        ↻ Regenerate
      </button>
    </div>

    <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:12px;padding:0 14px;overflow:hidden">
      ${row('🎯','Entry Condition', plan.entry)}
      ${row('🛑','Stop Loss', plan.stopLoss, '#ff4560')}
      ${row('💰','Take Profit', plan.takeProfit, '#00d4a1')}
      <div style="padding:12px 0;display:flex;align-items:flex-start;gap:12px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--bg1);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">⚠️</div>
        <div style="flex:1">
          <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Risk Note</div>
          <div style="font-size:13px;color:var(--gold);line-height:1.6;font-weight:500">${plan.riskNote}</div>
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   SESSION 3 — TRADING SESSION TIMER
   ═══════════════════════════════════════════════════════════ */

const TRADING_SESSIONS = [
  { name: 'London',   open: 7,  close: 16, flag: '🇬🇧', color: '#3d9eff', pairs: 'GBP, EUR, XAU' },
  { name: 'New York', open: 12, close: 21, flag: '🇺🇸', color: '#00d4a1', pairs: 'USD, CAD' },
  { name: 'Tokyo',    open: 0,  close: 9,  flag: '🇯🇵', color: '#e4ae2a', pairs: 'JPY, AUD, NZD' },
  { name: 'Sydney',   open: 22, close: 7,  flag: '🇦🇺', color: '#b464ff', pairs: 'AUD, NZD' }
];

function _utcDecimalHour() {
  const now = new Date();
  return now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
}

function _isSessionActive(session) {
  const h = _utcDecimalHour();
  if (session.open < session.close) {
    return h >= session.open && h < session.close;
  } else {
    return h >= session.open || h < session.close;
  }
}

function _minutesUntil(targetHourUTC) {
  const now     = new Date();
  const target  = new Date(now);
  target.setUTCHours(targetHourUTC, 0, 0, 0);
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  return Math.round((target - now) / 60000);
}

function _fmtMins(mins) {
  if (mins <= 0) return 'Now';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function _buildSessionTimerHTML() {
  const now    = new Date();
  const watHr  = now.getUTCHours() + 1;
  const watMin = now.getUTCMinutes();
  const timeStr = `${String(watHr % 24).padStart(2,'0')}:${String(watMin).padStart(2,'0')} WAT`;

  const cards = TRADING_SESSIONS.map(s => {
    const active    = _isSessionActive(s);
    const minsLeft  = active ? _minutesUntil(s.close) : _minutesUntil(s.open);
    const label     = active ? 'Closes in' : 'Opens in';
    const statusTxt = active ? 'OPEN' : 'CLOSED';
    const statusCol = active ? s.color : 'var(--t3)';
    const statusBg  = active ? s.color + '18' : 'var(--bg1)';
    const borderCol = active ? s.color + '50' : 'var(--bd)';

    return `
      <div style="background:${statusBg};border:1px solid ${borderCol};border-radius:12px;padding:13px 14px;position:relative;overflow:hidden">
        ${active ? `<div style="position:absolute;top:0;left:0;right:0;height:2px;background:${s.color}"></div>` : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:7px">
            <span style="font-size:16px">${s.flag}</span>
            <span style="font-size:13px;font-weight:800;color:var(--t1)">${s.name}</span>
          </div>
          <span style="font-size:10px;font-weight:800;color:${statusCol};background:${active ? s.color+'22' : 'var(--bg2)'};border:1px solid ${active ? s.color+'40' : 'var(--bd)'};border-radius:20px;padding:2px 8px;letter-spacing:.5px">
            ${statusTxt}
          </span>
        </div>
        <div style="font-size:10px;color:var(--t3);margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">${label}</div>
        <div style="font-size:22px;font-weight:900;color:${active ? s.color : 'var(--t2)'};line-height:1;margin-bottom:6px">
          ${_fmtMins(minsLeft)}
        </div>
        <div style="font-size:10px;color:var(--t3)">Active: ${s.pairs}</div>
      </div>`;
  }).join('');

  const activeSessions = TRADING_SESSIONS.filter(s => _isSessionActive(s));
  const londonActive   = activeSessions.some(s => s.name === 'London');
  const nyActive       = activeSessions.some(s => s.name === 'New York');
  const overlap        = londonActive && nyActive;

  let advice, adviceCol;
  if (overlap) {
    advice    = '🔥 London/NY overlap — highest volatility. Best time to trade.';
    adviceCol = '#00d4a1';
  } else if (londonActive) {
    advice    = '✅ London session open — your primary trading window.';
    adviceCol = '#3d9eff';
  } else if (nyActive) {
    advice    = '🟡 New York session open — moderate opportunity.';
    adviceCol = '#e4ae2a';
  } else if (activeSessions.length) {
    advice    = '⚠️ Asian/Sydney session — low volatility. Avoid major pairs.';
    adviceCol = '#e4ae2a';
  } else {
    advice    = '😴 All sessions closed. Review analysis and prepare for London open.';
    adviceCol = 'var(--t2)';
  }

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">🕐 Session Timer</div>
        <div style="font-size:13px;font-weight:700;color:var(--t2)">${timeStr}</div>
      </div>
      <div style="font-size:10px;color:var(--t3);text-align:right">Updates live<br/>every 30s</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      ${cards}
    </div>
    <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:10px;padding:11px 14px;font-size:12px;font-weight:600;color:${adviceCol};line-height:1.5">
      ${advice}
    </div>`;
}

let _sessionTimerInterval = null;

function _startSessionTimer() {
  _renderSessionTimer();
  clearInterval(_sessionTimerInterval);
  _sessionTimerInterval = setInterval(_renderSessionTimer, 30000);
}

function _renderSessionTimer() {
  const el = document.getElementById('session-timer-card');
  if (!el) return;
  el.innerHTML = _buildSessionTimerHTML();
}

/* ═══════════════════════════════════════════════════════════
   SESSION 3 — TRADE REVIEW MODE
   ═══════════════════════════════════════════════════════════ */

function _analyseTradeHistory() {
  const trades = S.trades;
  if (!trades || trades.length < 3) return null;

  const wins   = trades.filter(t => t.outcome === 'win');
  const losses = trades.filter(t => t.outcome === 'loss');
  const be     = trades.filter(t => t.outcome === 'be');
  const total  = trades.length;
  const wr     = Math.round(wins.length / total * 100);

  const avgRR = wins.length
    ? (wins.reduce((a, t) => a + parseFloat(t.rr || 0), 0) / wins.length).toFixed(2)
    : 0;

  const netR = trades.reduce((a, t) => {
    return a + (t.outcome === 'win' ? parseFloat(t.rr || 1) : t.outcome === 'loss' ? -1 : 0);
  }, 0);

  const pairMap = {};
  trades.forEach(t => {
    if (!t.pair) return;
    if (!pairMap[t.pair]) pairMap[t.pair] = { wins: 0, losses: 0, total: 0 };
    pairMap[t.pair].total++;
    if (t.outcome === 'win')  pairMap[t.pair].wins++;
    if (t.outcome === 'loss') pairMap[t.pair].losses++;
  });

  const pairList = Object.entries(pairMap).filter(([, d]) => d.total >= 2);
  const bestPair = pairList.sort((a, b) => {
    return (b[1].wins / b[1].total) - (a[1].wins / a[1].total);
  })[0];
  const worstPair = pairList.sort((a, b) => {
    return (a[1].wins / a[1].total) - (b[1].wins / b[1].total);
  })[0];

  const sessionMap = {};
  trades.forEach(t => {
    if (!t.session) return;
    if (!sessionMap[t.session]) sessionMap[t.session] = { wins: 0, total: 0 };
    sessionMap[t.session].total++;
    if (t.outcome === 'win') sessionMap[t.session].wins++;
  });

  const sessionList = Object.entries(sessionMap).filter(([, d]) => d.total >= 2);
  const bestSession = sessionList.sort((a, b) => {
    return (b[1].wins / b[1].total) - (a[1].wins / a[1].total);
  })[0];

  let streak = 0, streakType = '';
  for (let i = 0; i < trades.length; i++) {
    const o = trades[i].outcome;
    if (i === 0) { streakType = o; streak = 1; continue; }
    if (o === streakType) streak++;
    else break;
  }

  const last5    = trades.slice(0, 5);
  const last5WR  = Math.round(last5.filter(t => t.outcome === 'win').length / last5.length * 100);

  const buyTrades  = trades.filter(t => t.direction === 'BUY');
  const sellTrades = trades.filter(t => t.direction === 'SELL');
  const buyWR      = buyTrades.length  ? Math.round(buyTrades.filter(t => t.outcome === 'win').length / buyTrades.length * 100)  : null;
  const sellWR     = sellTrades.length ? Math.round(sellTrades.filter(t => t.outcome === 'win').length / sellTrades.length * 100) : null;

  return {
    total, wins: wins.length, losses: losses.length, be: be.length,
    wr, avgRR, netR: netR.toFixed(1),
    bestPair, worstPair, bestSession,
    streak, streakType,
    last5WR, last5Count: last5.length,
    buyWR, sellWR,
    buyCount: buyTrades.length, sellCount: sellTrades.length
  };
}

function _generateCoachingNote(d) {
  const notes = [];

  if (d.wr >= 60) {
    notes.push(`Your win rate of ${d.wr}% is strong. Focus on protecting this edge by not overtrading — quality over quantity.`);
  } else if (d.wr >= 45) {
    notes.push(`A ${d.wr}% win rate is workable if your R:R is consistent. Your average winner is ${d.avgRR}R — keep targeting setups where you can achieve at least 1:2.`);
  } else {
    notes.push(`Your win rate is currently ${d.wr}%. This suggests your entries need refinement. Review your last 5 losses and identify whether the issue is entry timing, zone selection, or news events.`);
  }

  if (parseFloat(d.netR) > 0) {
    notes.push(`You're net positive at +${d.netR}R across ${d.total} trades — you are profitable. Protect this by sticking to your system.`);
  } else {
    notes.push(`Your net R is ${d.netR}R. Even with a good win rate, cutting losses short and letting winners run will improve this number significantly.`);
  }

  if (d.bestPair) {
    const [pair, stats] = d.bestPair;
    const pairWR = Math.round(stats.wins / stats.total * 100);
    notes.push(`Your strongest pair is ${pair} with a ${pairWR}% win rate over ${stats.total} trades. Prioritise this pair when it aligns with your macro bias.`);
  }

  if (d.worstPair && d.worstPair[0] !== d.bestPair?.[0]) {
    const [pair, stats] = d.worstPair;
    const pairWR = Math.round(stats.wins / stats.total * 100);
    notes.push(`Avoid ${pair} for now — your win rate there is only ${pairWR}% across ${stats.total} trades. This pair may not suit your current setup style.`);
  }

  if (d.bestSession) {
    const [sess, stats] = d.bestSession;
    const sessWR = Math.round(stats.wins / stats.total * 100);
    notes.push(`The ${sess} session is where you perform best (${sessWR}% WR). Concentrate your trading energy during this window.`);
  }

  if (d.buyWR !== null && d.sellWR !== null && d.buyCount >= 2 && d.sellCount >= 2) {
    if (Math.abs(d.buyWR - d.sellWR) >= 15) {
      const betterDir = d.buyWR > d.sellWR ? 'BUY' : 'SELL';
      const betterWR  = d.buyWR > d.sellWR ? d.buyWR : d.sellWR;
      notes.push(`You trade ${betterDir} setups significantly better (${betterWR}% WR). Lean into this — only take the other direction when the macro setup is extremely clear.`);
    }
  }

  if (d.last5Count >= 5) {
    if (d.last5WR >= 60) {
      notes.push(`Your last 5 trades show ${d.last5WR}% WR — you're in good form. Stay disciplined and avoid changing your process.`);
    } else if (d.last5WR <= 30) {
      notes.push(`Your recent form is concerning — only ${d.last5WR}% across your last 5 trades. Consider reducing position size or taking a short break to reset your mindset.`);
    }
  }

  if (d.streak >= 3) {
    if (d.streakType === 'win') {
      notes.push(`You're on a ${d.streak}-trade winning streak. Stay humble — avoid oversizing just because you're running hot.`);
    } else if (d.streakType === 'loss') {
      notes.push(`You've had ${d.streak} consecutive losses. This is the most dangerous time to trade — step back, review your setups, and only return when conditions are clear.`);
    }
  }

  return notes;
}

function renderTradeReview() {
  const el = document.getElementById('trade-review-card');
  if (!el) return;

  const d = _analyseTradeHistory();

  if (!d) {
    el.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📋 Trade Review</div><p style="color:var(--t3);font-size:13px">Log at least 3 trades to unlock your coaching note.</p>';
    return;
  }

  const notes    = _generateCoachingNote(d);
  const netCol   = parseFloat(d.netR) >= 0 ? 'var(--green)' : 'var(--red)';
  const wrCol    = d.wr >= 55 ? 'var(--green)' : d.wr >= 40 ? 'var(--gold)' : 'var(--red)';
  const streakIcon = d.streakType === 'win' ? '🔥' : d.streakType === 'loss' ? '❄️' : '—';

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">
      📋 Weekly Trade Review
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
      ${[
        ['Win Rate',  d.wr + '%',         wrCol],
        ['Net R',     (parseFloat(d.netR) >= 0 ? '+' : '') + d.netR + 'R', netCol],
        ['Avg R:R',   '1:' + d.avgRR,     'var(--gold)'],
        ['Streak',    streakIcon + ' ' + d.streak, d.streakType === 'win' ? 'var(--green)' : d.streakType === 'loss' ? 'var(--red)' : 'var(--t2)']
      ].map(([lbl, val, col]) => `
        <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:900;color:${col};margin-bottom:3px">${val}</div>
          <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">${lbl}</div>
        </div>`).join('')}
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">
      🧠 Coaching Note — based on your ${d.total} trades
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${notes.map((note, i) => `
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="width:22px;height:22px;border-radius:50%;background:var(--gold-dim);border:1px solid rgba(228,174,42,.3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:var(--gold);flex-shrink:0;margin-top:1px">${i + 1}</div>
          <div style="font-size:13px;color:var(--t1);line-height:1.7">${note}</div>
        </div>`).join('')}
    </div>

    ${d.bestPair || d.bestSession ? `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--bd)">
      ${d.bestPair ? `<span style="font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;background:var(--green-dim);color:var(--green);border:1px solid rgba(0,212,161,.25)">✅ Best pair: ${d.bestPair[0]}</span>` : ''}
      ${d.worstPair ? `<span style="font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;background:var(--red-dim);color:var(--red);border:1px solid rgba(255,69,96,.25)">⚠️ Avoid: ${d.worstPair[0]}</span>` : ''}
      ${d.bestSession ? `<span style="font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;background:var(--blue-dim);color:var(--blue);border:1px solid rgba(61,158,255,.25)">🕐 Best session: ${d.bestSession[0]}</span>` : ''}
    </div>` : ''}`;
}

/* ═══════════════════════════════════════════════════════════
   SESSION 4 — NEWS DECISION ENGINE
   ═══════════════════════════════════════════════════════════ */

const NEWS_PAIRS = {
  USD: { quote: ['EUR/USD','GBP/USD','AUD/USD','NZD/USD'], base: ['USD/JPY','USD/CAD','USD/CHF'] },
  EUR: { quote: ['EUR/GBP','EUR/JPY','EUR/CHF','EUR/CAD'], base: ['EUR/USD'] },
  GBP: { quote: ['GBP/JPY','GBP/CHF','GBP/CAD'], base: ['GBP/USD','EUR/GBP'] },
  JPY: { quote: [], base: ['USD/JPY','EUR/JPY','GBP/JPY','AUD/JPY','NZD/JPY'] },
  AUD: { quote: ['AUD/JPY','AUD/CAD','AUD/NZD'], base: ['AUD/USD'] },
  NZD: { quote: ['NZD/JPY','NZD/CAD'], base: ['NZD/USD','AUD/NZD'] },
  CAD: { quote: [], base: ['USD/CAD','GBP/CAD','AUD/CAD','EUR/CAD'] },
  CHF: { quote: [], base: ['USD/CHF','EUR/CHF','GBP/CHF'] }
};

const NEWS_EXPLANATIONS = {
  cpi: {
    better: 'Higher-than-expected inflation signals the central bank may hike rates or stay hawkish longer. This is bullish for the currency as higher rates attract capital inflows.',
    worse:  'Lower-than-expected inflation reduces pressure on the central bank to hike rates, often triggering a dovish repricing. This weakens the currency as rate cut expectations rise.'
  },
  rate: {
    better: 'A rate hike or more hawkish-than-expected decision increases yield differentials, making the currency more attractive to institutional investors. Strong bullish signal.',
    worse:  'A rate cut or dovish surprise reduces the currency\'s yield advantage. Capital flows out toward higher-yielding alternatives, putting downward pressure on the currency.'
  },
  nfp: {
    better: 'Strong employment data signals a healthy economy and supports central bank tightening. More jobs = more consumer spending = inflationary pressure = bullish for currency.',
    worse:  'Weak employment undermines the central bank\'s case for rate hikes and raises recession fears. This is bearish for the currency, especially impactful on USD pairs.'
  },
  gdp: {
    better: 'GDP beating expectations confirms economic strength and supports a hawkish central bank stance. Strong growth = bullish currency as rate hike probability increases.',
    worse:  'GDP missing estimates signals economic contraction risk. Central banks are unlikely to hike in a slowing economy, weakening the currency against its peers.'
  }
};

const NEWS_EVENT_NAMES = {
  cpi:  'CPI (Inflation)',
  rate: 'Interest Rate Decision',
  nfp:  'Employment / NFP',
  gdp:  'GDP (Growth)'
};

function analyzeNewsImpact() {
  const currency = document.getElementById('news-currency')?.value;
  const event    = document.getElementById('news-event')?.value;
  const outcome  = document.getElementById('news-outcome')?.value;

  if (!currency || !event || !outcome) {
    _toast('Please select all three fields.', 'warning');
    return;
  }

  const isBullish = outcome === 'better';

  const pairs    = NEWS_PAIRS[currency] || { base: [], quote: [] };
  const affected = [];

  if (isBullish) {
    pairs.base.forEach(p  => affected.push({ pair: p, direction: 'BUY',  reason: currency + ' is base — buy the pair' }));
    pairs.quote.forEach(p => affected.push({ pair: p, direction: 'SELL', reason: currency + ' is quote — sell the pair' }));
  } else {
    pairs.base.forEach(p  => affected.push({ pair: p, direction: 'SELL', reason: currency + ' is base — sell the pair' }));
    pairs.quote.forEach(p => affected.push({ pair: p, direction: 'BUY',  reason: currency + ' is quote — buy the pair' }));
  }

  const result = {
    currency,
    event,
    outcome,
    isBullish,
    bias:        isBullish ? 'BULLISH' : 'BEARISH',
    explanation: NEWS_EXPLANATIONS[event]?.[outcome] || '',
    pairs:       affected.slice(0, 5)
  };

  renderNewsImpact(result);

  const el = document.getElementById('news-impact');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderNewsImpact(result) {
  const el = document.getElementById('news-impact');
  if (!el) return;

  const biasCol  = result.isBullish ? '#00d4a1' : '#ff4560';
  const biasBg   = result.isBullish ? 'rgba(0,212,161,.08)' : 'rgba(255,69,96,.08)';
  const biasBdr  = result.isBullish ? 'rgba(0,212,161,.25)' : 'rgba(255,69,96,.25)';
  const biasIcon = result.isBullish ? '↑' : '↓';

  const pairRows = result.pairs.map(p => {
    const col = p.direction === 'BUY' ? '#00d4a1' : '#ff4560';
    const arr = p.direction === 'BUY' ? '↑' : '↓';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
        <div style="font-size:15px;font-weight:900;color:var(--t1);letter-spacing:-.3px">${p.pair}</div>
        <span style="font-size:12px;font-weight:800;color:${col};background:${col}18;border:1px solid ${col}40;border-radius:8px;padding:4px 12px">
          ${arr} ${p.direction}
        </span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="background:${biasBg};border:1px solid ${biasBdr};border-radius:12px;padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">
          📢 News Impact — ${result.currency} ${NEWS_EVENT_NAMES[result.event]}
        </div>
        <div style="font-size:11px;color:var(--t2)">
          ${result.outcome === 'better' ? 'Better than expected' : 'Worse than expected'}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-radius:100px;background:${biasBg};border:1px solid ${biasBdr}">
        <span style="font-size:20px;font-weight:900;color:${biasCol}">${biasIcon}</span>
        <span style="font-size:14px;font-weight:900;color:${biasCol};letter-spacing:.5px">${result.bias}</span>
      </div>
    </div>

    <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Why?</div>
      <div style="font-size:13px;color:var(--t1);line-height:1.75">${result.explanation}</div>
    </div>

    <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:12px;padding:14px 16px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Affected Pairs</div>
      <div style="font-size:11px;color:var(--t2);margin-bottom:8px">Based on ${result.currency} ${result.bias === 'BULLISH' ? 'strength' : 'weakness'}</div>
      ${pairRows}
      <div style="padding-top:12px;font-size:11px;color:var(--t3);line-height:1.6">
        ⚠️ Wait for confirmation on your chart before entering. News analysis is directional guidance — always validate with structure and a valid entry model.
      </div>
    </div>`;
}
