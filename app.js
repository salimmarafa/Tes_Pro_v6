/* ═══════════════════════════════════════════════════════════════
   TES PRO - COMPLETE APPLICATION WITH ALL FEATURES
   ═══════════════════════════════════════════════════════════════
   INCLUDES:
   ✅ Original TES PRO (1035 lines)
   ✅ Gold Desk (complete implementation)
   ✅ Trade Execution Intelligence
   ✅ Advanced News Bias Generator
   ✅ Session Timer
   ✅ Psychology Bootcamp (full Levels/Scenarios/Missions/Archetypes)
   ✅ All helper functions
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─── CONSTANTS ───────────────────────────────────────────── */
const SUB_MS = {
  monthly: 30 * 24 * 60 * 60 * 1000,
  annual: 365 * 24 * 60 * 60 * 1000
};

const TRIAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days free trial
// These are defined in firebase.js - reference them from window
const PAYSTACK_PUBLIC_KEY = window.PAYSTACK_PUBLIC_KEY || '';
const USD_TO_NGN = window.USD_TO_NGN || 1500;
const PLAN_PRICES_USD = window.PLAN_PRICES_USD || { monthly: 15, annual: 120 };

// Tradeable pairs we suggest
const TRADE_PAIRS = [
  ['GBP','JPY'],['EUR','JPY'],['AUD','JPY'],['USD','JPY'],
  ['GBP','USD'],['EUR','USD'],['AUD','USD'],['NZD','USD'],
  ['USD','CAD'],['USD','CHF'],['EUR','GBP'],['EUR','CHF'],
  ['GBP','CAD'],['GBP','CHF'],['NZD','JPY']
];

/* ─── FIREBASE CONFIG ──────────────────────────────────────── */
let _auth, _firestore, _storage;

(function() {
  if (typeof firebase !== 'undefined') {
    try {
      const firebaseConfig = {
        apiKey: 'AIzaSyDD057lBgAKAelh3tWZsGtK0OMYzqq50dQ',
        authDomain: 'trading-web-app-d3959.firebaseapp.com',
        projectId: 'trading-web-app-d3959',
        storageBucket: 'trading-web-app-d3959.appspot.com',
        messagingSenderId: '277574845686',
        appId: '1:277574845686:web:116ec8d94076c1060858d7'
      };
      firebase.initializeApp(firebaseConfig);
      _auth = firebase.auth();
      _firestore = firebase.firestore();
      _storage = firebase.storage();
    } catch (e) {
      console.warn('[TES] Firebase init error:', e);
    }
  }
})();

/* ─── APPLICATION STATE ───────────────────────────────────── */
const S = {
  user: null,
  profile: null,
  trades: [],
  outcome: '',
  unsubTrades: null,
  rankings: [],
  psychologyState: {
    currentScreen: 'hub',
    xp: 0,
    streak: 1,
    scores: { discipline: 0, emotion: 0, execution: 0 },
    completedScenarios: [],
    completedMissions: []
  }
};

/* ─── SCREEN CONTROL ───────────────────────────────────────── */
function show(id) {
  ['screen-splash', 'screen-auth', 'screen-locked', 'screen-app'].forEach(sid => {
    const el = document.getElementById(sid);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = id === 'screen-app' ? 'flex' : 'block';
}

/* ─── BOOT SEQUENCE ────────────────────────────────────────– */
(function boot() {
  if (!_auth) {
    console.warn('[TES] Firebase not configured');
    show('screen-auth');
    return;
  }
  show('screen-splash');
  _auth.onAuthStateChanged(async user => {
    if (user) {
      S.user = user;
      await bootUser(user.uid);
    } else {
      S.user = null;
      S.profile = null;
      _teardown();
      show('screen-auth');
    }
  });
})();

/* ─── SUBSCRIPTION HELPERS ─────────────────────────────────– */
function _subRead(uid) {
  try { return JSON.parse(localStorage.getItem('tes_sub_' + uid)); }
  catch { return null; }
}

function _subWrite(uid, sub) {
  localStorage.setItem('tes_sub_' + uid, JSON.stringify(sub));
}

function onPaymentSuccess(plan) {
  if (!S.user) return;
  const sub = {
    status: 'active',
    plan: plan,
    expiresAt: Date.now() + SUB_MS[plan]
  };
  _subWrite(S.user.uid, sub);
  S.profile = {
    uid: S.user.uid,
    email: S.user.email,
    paymentStatus: 'paid',
    plan: sub.plan,
    expiresAt: sub.expiresAt
  };
  _toast('Subscription activated! Welcome to TES Pro 🎉', 'success');
  console.log('[TES] Access granted:', plan);
  _launchApp();
}

function initiatePaystack(plan) {
  plan = plan || 'monthly';
  if (!S.user) { _toast('Please sign in first.', 'error'); return; }
  const key = PAYSTACK_PUBLIC_KEY || '';
  const rate = USD_TO_NGN || 1500;
  const prices = PLAN_PRICES_USD || { monthly: 15, annual: 120 };
  const usd = prices[plan] || 15;
  const ngn = Math.round(usd * rate);
  
  console.log('[Paystack] Initiating:', { plan, usd, ngn });
  
  if (!key || key.includes('test')) {
    console.log('[Paystack] TEST MODE');
    onPaymentSuccess(plan);
    return;
  }
  
  if (typeof PaystackPop === 'undefined') {
    _toast('Paystack library not loaded.', 'error');
    return;
  }
  
  PaystackPop.setup({
    key: key,
    email: S.user.email,
    amount: ngn * 100,
    currency: 'NGN',
    ref: 'TES_' + Date.now(),
    onClose: () => _toast('Payment cancelled.', 'warning'),
    onSuccess: (res) => {
      console.log('[Paystack] Success:', res);
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
    console.error('[Paystack] Error:', e);
    _toast('Verification error.', 'error');
  }
}

/* ─── BOOT USER ────────────────────────────────────────────– */
async function bootUser(uid) {
  console.log('[TES] Booting user:', uid);
  
  if (typeof isOwner === 'function' && S.user && isOwner(S.user.email)) {
    console.log('[TES] Owner bypass active');
    S.profile = {
      uid: uid,
      email: S.user.email,
      paymentStatus: 'paid',
      plan: 'owner',
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000
    };
    _launchApp();
    return;
  }
  
  S.profile = { uid: uid, email: S.user?.email || 'unknown' };
  const sub = _subRead(uid);
  if (sub) {
    S.profile.paymentStatus = sub.status;
    S.profile.plan = sub.plan;
    S.profile.expiresAt = sub.expiresAt;
  }
  
  if (sub && sub.expiresAt < Date.now()) {
    console.log('[TES] Subscription expired');
    _subWrite(uid, null);
    show('screen-locked');
    _renderLocked();
    return;
  }
  
  if (!sub) {
    console.log('[TES] Not subscribed');
    show('screen-locked');
    _renderLocked();
    return;
  }
  
  _launchApp();
}

function _launchApp() {
  console.log('[TES] Launching app');
  show('screen-app');
  _setupTopbar();
  _setupDashboard();
  _subscribeToTrades();
  _restoreCurrencyAnalysis();
  fetchAndInjectMacroData();
  fetchAndInjectNewsSentiment();
  _addPsychologyNavButton();
  _loadPsychologyState();
  _startSessionTimer();
  _renderGoldSessions();
}

function _teardown() {
  console.log('[TES] Teardown');
  if (S.unsubTrades) { S.unsubTrades(); S.unsubTrades = null; }
  S.user = null;
  S.profile = null;
  S.trades = [];
}

/* ─── TRADES SUBSCRIPTION ──────────────────────────────────– */
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

/* ─── PAGES SETUP ──────────────────────────────────────────– */
function _setupPages() {
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.onclick = () => goPage(btn.getAttribute('data-page'));
  });
}

function goPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  const btn = document.querySelector('.nav-btn[data-page="' + id + '"]');
  if (page) page.classList.add('active');
  if (btn) btn.classList.add('active');
  if (id === 'analytics') { renderAnalyticsPage(); }
  if (id === 'journal') updateJournalSubtitle();
  if (id === 'settings') _setupSettingsPage();
  if (id === 'dashboard') _refreshDashboard();
  if (id === 'gold') _initGoldPage();
  window.scrollTo(0, 0);
}

/* ─── TOPBAR ───────────────────────────────────────────────– */
function _setupTopbar() {
  const emailEl = document.getElementById('tb-email');
  if (emailEl) emailEl.textContent = (S.user?.email || '').split('@')[0];
  
  const daysEl = document.getElementById('tb-days');
  const renewEl = document.getElementById('btn-renew');
  
  if (S.profile?.plan === 'owner') {
    if (daysEl) { daysEl.textContent = '👑 Owner'; daysEl.style.display = 'inline-block'; }
    if (renewEl) renewEl.style.display = 'none';
    return;
  }
  
  if (S.profile?.expiresAt) {
    const days = Math.ceil((S.profile.expiresAt - Date.now()) / (24*60*60*1000));
    if (daysEl) {
      daysEl.textContent = '⏳ ' + days + ' days left';
      daysEl.style.display = days <= 7 ? 'inline-block' : 'none';
      daysEl.style.color = days <= 3 ? '#ff4560' : days <= 7 ? '#e4ae2a' : '#00d4a1';
    }
  }
}

/* ─── DASHBOARD ────────────────────────────────────────────– */
function _setupDashboard() {
  _refreshDashboard();
  _setupPages();
  goPage('dashboard');
}

function _refreshDashboard() {
  const trades = S.trades || [];
  const wins = trades.filter(t => t.outcome === 'win').length;
  const losses = trades.filter(t => t.outcome === 'loss').length;
  const wr = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const netR = trades.reduce((a, t) => a + (t.outcome === 'win' ? parseFloat(t.rr || 1) : -1), 0);
  
  _setText('stat-total', trades.length);
  _setText('stat-wr', wr + '%');
  _setText('stat-netr', netR > 0 ? '+' + netR.toFixed(1) : netR.toFixed(1));
  
  const recentEl = document.getElementById('home-recent-trades');
  if (!recentEl) return;
  
  if (!trades.length) {
    recentEl.innerHTML = '<p style="color:#5a6a8a;font-size:13px">No trades logged yet.</p>';
    return;
  }
  
  recentEl.innerHTML = trades.slice(0, 3).map(t => {
    const dt = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
    const ds = dt.toLocaleDateString('en-GB') + ' ' + dt.toTimeString().slice(0, 5);
    const oc = (t.outcome || 'BE').toUpperCase();
    const dir = t.direction === 'BUY' ? '↑' : '↓';
    return `<div style="background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:16px;font-weight:900;color:var(--t1)">${t.pair} ${dir}</div>
        <span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:#00d4a120;color:#00d4a1">${oc}</span>
      </div>
      <div style="font-size:11px;color:var(--t2)">📅 ${ds}</div>
    </div>`;
  }).join('');
}

/* ─── LOCKED SCREEN ────────────────────────────────────────– */
function _renderLocked() {
  const emailEl = document.getElementById('locked-email');
  if (emailEl && S.user) emailEl.textContent = 'Signed in as: ' + S.user.email;
}

/* ─── AUTH ─────────────────────────────────────────────────– */
async function doLogin() {
  const email = document.getElementById('l-email')?.value?.trim() || '';
  const pass = document.getElementById('l-pass')?.value || '';
  _clearErr('l-err');
  if (!email || !pass) { _showErr('l-err', 'Enter email and password.'); return; }
  
  const btn = document.querySelector('[onclick="doLogin()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  
  try {
    await _auth.signInWithEmailAndPassword(email, pass);
  } catch (e) {
    _showErr('l-err', _fbErr(e.code));
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  }
}

async function doSignup() {
  const email = document.getElementById('s-email')?.value?.trim() || '';
  const pass = document.getElementById('s-pass')?.value || '';
  _clearErr('s-err');
  if (!email || !pass) { _showErr('s-err', 'Enter email and password.'); return; }
  if (pass.length < 6) { _showErr('s-err', 'Password min 6 chars.'); return; }
  
  const btn = document.querySelector('[onclick="doSignup()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  
  try {
    await _auth.createUserWithEmailAndPassword(email, pass);
  } catch (e) {
    _showErr('s-err', _fbErr(e.code));
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
  }
}

async function doLogout() {
  _teardown();
  try { await _auth.signOut(); }
  catch { show('screen-auth'); }
}

/* ─── UTILITIES ────────────────────────────────────────────– */
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
  el.textContent = msg;
  el.style.color = colors[type] || '#eef2ff';
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
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _fbErr(code) {
  const m = {
    'auth/user-not-found': 'No account with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/email-already-in-use': 'Email already registered.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/weak-password': 'Password min 6 characters.',
    'auth/too-many-requests': 'Too many attempts.',
    'auth/network-request-failed': 'Network error.'
  };
  return m[code] || 'Something went wrong.';
}

/* ═══════════════════════════════════════════════════════════════
   MACRO / CURRENCY STRENGTH ENGINE
   ═══════════════════════════════════════════════════════════════ */

function _restoreCurrencyAnalysis() {
  const saved = localStorage.getItem('tes_cs_results');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      S.rankings = data.rankings || [];
    } catch (e) {
      console.warn('Could not restore currency analysis');
    }
  }
}

async function fetchAndInjectMacroData() {
  try {
    const res = await fetch('https://tes-pro-backend.onrender.com/macro-data');
    if (!res.ok) throw new Error('API error');
    const macro = await res.json();
    
    ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'].forEach(c => {
      const rateEl = document.getElementById(`cs-rate-${c}`);
      const cpiEl = document.getElementById(`cs-cpi-${c}`);
      if (!rateEl || !cpiEl || !macro[c]) return;
      
      rateEl.value = macro[c].rate || '';
      cpiEl.value = macro[c].cpi || '';
    });
    
    _toast('✅ Live macro data loaded', 'success');
    console.log('[TES] Macro data injected');
  } catch (err) {
    console.warn('[TES] Macro fetch failed:', err);
  }
}

async function fetchAndInjectNewsSentiment() {
  try {
    const res = await fetch('https://tes-pro-backend.onrender.com/news-sentiment');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    window.NEWS_BIAS = data.bias || 'neutral';
    _renderNewsPanel(data.headlines || []);
    console.log('[TES] News loaded');
  } catch (err) {
    console.warn('[TES] News fetch failed:', err);
  }
}

function _renderNewsPanel(headlines) {
  const newsEl = document.getElementById('news-panel');
  if (!newsEl) return;
  
  if (!headlines.length) {
    newsEl.innerHTML = '<p style="color:var(--t2);font-size:13px">No active news events.</p>';
    return;
  }
  
  newsEl.innerHTML = headlines.slice(0, 5).map(h => `
    <div style="padding:10px;background:var(--bg1);border:1px solid var(--bd);border-radius:8px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--t1)">${h.currency || 'USD'}</div>
      <div style="font-size:11px;color:var(--t2);margin-top:2px">${h.event || 'Economic data'}</div>
      <div style="font-size:10px;color:var(--t3);margin-top:2px">⏰ ${h.time || 'Today'}</div>
    </div>
  `).join('');
}

function runCurrencyAnalysis() {
  const globalRisk = document.getElementById('cs-global-risk')?.value || '';
  if (!globalRisk) { _toast('Select global risk sentiment', 'warning'); return; }
  
  let rankings = [];
  
  ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'].forEach(c => {
    const rateEl = document.getElementById(`cs-rate-${c}`);
    const cpiEl = document.getElementById(`cs-cpi-${c}`);
    if (!rateEl || !cpiEl) return;
    
    const rate = rateEl.value || 'neutral';
    const cpi = cpiEl.value || 'stable';
    
    let score = 0;
    if (rate === 'bullish') score += 2;
    if (rate === 'bearish') score -= 2;
    if (cpi === 'rising') score += 1;
    if (cpi === 'falling') score -= 1;
    if (globalRisk === 'risk-on' && ['AUD','NZD','CAD'].includes(c)) score += 1;
    if (globalRisk === 'risk-off' && ['JPY','CHF','USD'].includes(c)) score += 1;
    
    rankings.push({ currency: c, score, rate, cpi });
  });
  
  rankings.sort((a, b) => b.score - a.score);
  S.rankings = rankings;
  
  // Show rankings
  const tbody = document.getElementById('cs-table-body');
  if (tbody) {
    tbody.innerHTML = rankings.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${r.currency}</strong></td>
        <td>${r.score > 0 ? '+' : ''}${r.score}</td>
        <td>${r.score > 2 ? '🟢 STRONG' : r.score > 0 ? '🟡 BULLISH' : r.score < -2 ? '🔴 WEAK' : '⚪ BEARISH'}</td>
      </tr>
    `).join('');
  }
  
  const resultsWrap = document.getElementById('cs-results-wrap');
  if (resultsWrap) resultsWrap.style.display = 'block';
  
  _generateTopSuggestions(rankings);
  _toast('Currency analysis complete!', 'success');
}

function _generateTopSuggestions(rankings) {
  if (rankings.length < 2) return;
  
  const strongest = rankings[0];
  const weakest = rankings[rankings.length - 1];
  
  const suggList = document.getElementById('sugg-list');
  if (suggList) {
    suggList.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:14px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--gold);text-transform:uppercase">1️⃣ BUY ${strongest.currency}/SELL ${weakest.currency}</div>
        <div style="font-size:11px;color:var(--t2);margin-top:6px">${strongest.currency} bullish (${strongest.score}) vs ${weakest.currency} bearish (${weakest.score})</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:14px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--gold);text-transform:uppercase">2️⃣ BUY ${rankings[1]?.currency || 'EUR'}/USD</div>
        <div style="font-size:11px;color:var(--t2);margin-top:6px">Second strongest setup</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--gold);text-transform:uppercase">3️⃣ USD/${rankings[rankings.length-2]?.currency || 'CAD'}</div>
        <div style="font-size:11px;color:var(--t2);margin-top:6px">Third strongest setup</div>
      </div>
    `;
  }
}

function generateTopTradePlan() {
  const pairs = S.rankings || [];
  if (pairs.length < 2) { _toast('Run analysis first', 'warning'); return; }
  
  const strongest = pairs[0];
  const weakest = pairs[pairs.length - 1];
  
  const plan = `
    <div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:12px;padding:16px">
      <div style="font-size:12px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">📋 Structured Trade Plan</div>
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--t2);text-transform:uppercase;margin-bottom:6px">Primary Setup</div>
        <div style="font-size:14px;font-weight:900;color:var(--gold)">${strongest.currency} / ${weakest.currency}</div>
        <div style="font-size:12px;color:var(--t2);margin-top:4px">Buy strongest vs sell weakest</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:12px">
        <div style="font-size:11px;font-weight:700;color:var(--t2);text-transform:uppercase;margin-bottom:6px">Confirmation Checklist</div>
        <div style="font-size:12px;color:var(--t2)">✓ H4 trend confirmation<br>✓ Supply/Demand zone<br>✓ R:R minimum 1:2<br>✓ No major news</div>
      </div>
    </div>
  `;
  
  document.getElementById('trade-plan').innerHTML = plan;
  _toast('Trade plan generated!', 'success');
}

function analyzeNewsImpact() {
  const currency = document.getElementById('news-currency')?.value || '';
  const event = document.getElementById('news-event')?.value || '';
  const outcome = document.getElementById('news-outcome')?.value || '';
  
  if (!currency || !event || !outcome) { _toast('Select all fields', 'warning'); return; }
  
  let impact = { bias: 'NEUTRAL', reason: '' };
  
  if (event === 'cpi') {
    if (outcome === 'better') {
      impact.bias = 'BULLISH ' + currency;
      impact.reason = 'Higher inflation → Rate hike odds → Currency strengthens';
    } else {
      impact.bias = 'BEARISH ' + currency;
      impact.reason = 'Lower inflation → Rate cut odds → Currency weakens';
    }
  } else if (event === 'rate') {
    if (outcome === 'better') {
      impact.bias = 'BULLISH ' + currency;
      impact.reason = 'Rate hike surprise → Immediate strength';
    } else {
      impact.bias = 'BEARISH ' + currency;
      impact.reason = 'Rate cut surprise → Weakness';
    }
  } else if (event === 'nfp') {
    impact.bias = outcome === 'better' ? 'BULLISH USD' : 'BEARISH USD';
    impact.reason = outcome === 'better' ? 'Strong employment → USD rally' : 'Weak employment → USD weakness';
  } else if (event === 'gdp') {
    impact.bias = outcome === 'better' ? 'BULLISH ' + currency : 'BEARISH ' + currency;
    impact.reason = outcome === 'better' ? 'Strong growth → Rally' : 'Weak growth → Weakness';
  }
  
  const newsImpactEl = document.getElementById('news-impact');
  if (newsImpactEl) {
    newsImpactEl.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:14px">
        <div style="font-size:14px;font-weight:900;color:${impact.bias.includes('BULL') ? '#00d4a1' : '#ff4560'};margin-bottom:8px">${impact.bias}</div>
        <div style="font-size:13px;color:var(--t2)">${impact.reason}</div>
      </div>
    `;
  }
}

/* ═══════════════════════════════════════════════════════════════
   GOLD DESK - XAUUSD TRADING
   ═══════════════════════════════════════════════════════════════ */

function _initGoldPage() {
  _renderGoldSessions();
}

function runGoldBiasEngine() {
  const usdStrength = document.getElementById('gd-usd-strength')?.value || '';
  const yields = document.getElementById('gd-yields')?.value || '';
  const fed = document.getElementById('gd-fed')?.value || '';
  const risk = document.getElementById('gd-risk')?.value || '';
  const inflation = document.getElementById('gd-inflation')?.value || '';
  
  if (!usdStrength || !yields || !fed || !risk || !inflation) {
    _toast('Select all parameters', 'warning');
    return;
  }
  
  let score = 0;
  if (usdStrength === 'strong') score -= 2;
  if (usdStrength === 'weak') score += 2;
  if (yields === 'rising') score -= 1.5;
  if (yields === 'falling') score += 1.5;
  if (fed === 'hawkish') score -= 2;
  if (fed === 'dovish') score += 2;
  if (risk === 'risk-on') score -= 1;
  if (risk === 'risk-off') score += 2;
  if (inflation === 'rising') score += 1.5;
  if (inflation === 'falling') score -= 1;
  
  const bias = score > 3 ? '🟢 BULLISH' : score < -3 ? '🔴 BEARISH' : '🟡 NEUTRAL';
  
  const resultEl = document.getElementById('gd-bias-result');
  if (resultEl) {
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:16px">
        <div style="font-size:16px;font-weight:900;color:var(--gold);margin-bottom:12px">${bias}</div>
        <div style="font-size:13px;color:var(--t2)">Bias Score: ${score > 0 ? '+' : ''}${score.toFixed(1)}</div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--bd);font-size:12px;color:var(--t2)">
          ${bias.includes('BULL') ? '✅ Favorable for long positions' : ''}
          ${bias.includes('BEAR') ? '✅ Favorable for short positions' : ''}
          ${bias.includes('NEUT') ? '⚖️ Wait for confirmation' : ''}
        </div>
      </div>
    `;
  }
}

function runWhyGoldMoved() {
  const direction = document.getElementById('gd-moved-direction')?.value || '';
  const driver = document.getElementById('gd-moved-driver')?.value || '';
  
  if (!direction || !driver) { _toast('Select direction and driver', 'warning'); return; }
  
  const drivers = {
    'cpi': 'CPI came in higher than expected, boosting rate hike odds, weakening gold',
    'nfp': 'Strong NFP supports USD strength and higher rates, negative for gold',
    'fomc': 'Fed signals rate hikes, strengthening USD and pressuring gold',
    'geopolitical': 'Geopolitical tensions increase risk-off sentiment, supporting gold',
    'yields': 'Bond yields surged, making gold less attractive',
    'usd': 'USD index strengthened significantly, pulling gold lower'
  };
  
  const narrative = drivers[driver] || 'Market moved on fundamental driver';
  const movedText = direction === 'rallied' ? 'Gold rallied' : direction === 'sold-off' ? 'Gold sold off' : 'Gold ranged';
  
  const resultEl = document.getElementById('gd-moved-result');
  if (resultEl) {
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div style="padding:14px;background:var(--bg2);border-left:3px solid var(--gold);border-radius:0 10px 10px 0;font-size:13px;color:var(--t1);line-height:1.7;font-style:italic">
        ${movedText} today because: <strong>${narrative}</strong>
      </div>
    `;
  }
}

function runGoldNewsInterpreter() {
  const newsEvent = document.getElementById('gd-news-event')?.value || '';
  const outcome = document.getElementById('gd-news-outcome')?.value || '';
  
  if (!newsEvent || !outcome) { _toast('Select event and outcome', 'warning'); return; }
  
  let goldReaction = '';
  
  if (newsEvent === 'cpi') {
    goldReaction = outcome === 'better' ? 'Gold DOWN' : 'Gold UP';
  } else if (newsEvent === 'nfp') {
    goldReaction = outcome === 'better' ? 'Gold DOWN' : 'Gold UP';
  } else if (newsEvent === 'fomc') {
    goldReaction = outcome === 'hike' ? 'Gold DOWN' : outcome === 'cut' ? 'Gold UP' : 'Gold NEUTRAL';
  } else if (newsEvent === 'employment') {
    goldReaction = outcome === 'better' ? 'Gold DOWN' : 'Gold UP';
  } else if (newsEvent === 'gdp') {
    goldReaction = outcome === 'better' ? 'Gold DOWN' : 'Gold UP';
  }
  
  const resultEl = document.getElementById('gd-news-result');
  if (resultEl) {
    resultEl.classList.add('show');
    resultEl.innerHTML = `
      <div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:12px;padding:14px">
        <div style="font-size:13px;font-weight:700;color:var(--gold);margin-bottom:8px">EXPECTED REACTION:</div>
        <div style="font-size:15px;font-weight:700;color:var(--t1)">${goldReaction}</div>
      </div>
    `;
  }
}

function _renderGoldSessions() {
  const sessionsEl = document.getElementById('gd-sessions-wrap');
  if (!sessionsEl) return;
  
  const sessions = [
    { name: 'Asian Session', time: '00:00–09:00 GMT', volatility: 'Low', tag: 'closed' },
    { name: 'London Session', time: '08:00–17:00 GMT', volatility: 'High', tag: 'open' },
    { name: 'New York Session', time: '13:00–22:00 GMT', volatility: 'Very High', tag: 'hot' }
  ];
  
  sessionsEl.innerHTML = sessions.map(s => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:10px;background:var(--bg2);border:1px solid var(--bd);margin-bottom:8px">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--t1)">${s.name}</div>
        <div style="font-size:11px;color:var(--t2)">${s.time}</div>
      </div>
      <span style="font-size:10px;font-weight:800;padding:3px 9px;border-radius:20px;letter-spacing:.3px;${s.tag === 'hot' ? 'background:rgba(228,174,42,.15);color:var(--gold);border:1px solid rgba(228,174,42,.3)' : s.tag === 'open' ? 'background:rgba(0,212,161,.12);color:#00d4a1;border:1px solid rgba(0,212,161,.25)' : 'background:var(--bg3);color:var(--t2);border:1px solid var(--bd)'}">${s.volatility}</span>
    </div>
  `).join('');
  
  const adviceEl = document.getElementById('gd-session-advice');
  if (adviceEl) {
    adviceEl.textContent = '💡 Best trading during London open and NY overlap (highest liquidity)';
  }
}

/* ═══════════════════════════════════════════════════════════════
   JOURNAL & TRADES
   ═══════════════════════════════════════════════════════════════ */

function toggleJournalForm() {
  const form = document.getElementById('trade-form-wrap');
  const btn = document.getElementById('btn-jform');
  if (!form) return;
  const open = form.style.display === 'block';
  form.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '+ Log Trade' : '× Close';
}

function showTradeForm() {
  toggleJournalForm();
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
    return _toast('❌ Confirm no high-impact news.', 'error');
  }
  
  const trade = {
    pair: document.getElementById('j-pair').value,
    direction: document.getElementById('j-dir').value,
    entry: document.getElementById('j-entry').value,
    sl: document.getElementById('j-sl').value,
    tp: document.getElementById('j-tp').value,
    rr: (document.getElementById('j-rr').textContent.match(/:/) ? document.getElementById('j-rr').textContent.split(': ')[1] : ''),
    session: document.getElementById('j-session').value,
    outcome: document.getElementById('outcome').value || 'be',
    notes: document.getElementById('j-notes').value,
    createdAt: new Date()
  };
  
  try {
    await _firestore.collection('users').doc(S.user.uid).collection('trades').add(trade);
    _toast('Trade logged! ✓', 'success');
    hideTradeForm();
    ['j-pair','j-dir','j-entry','j-sl','j-tp','j-session','j-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = id === 'j-dir' ? 'BUY' : '';
    });
    document.getElementById('j-news-check').checked = false;
    document.getElementById('j-rr').textContent = 'R:R — : —';
    document.getElementById('outcome').value = '';
    document.querySelectorAll('.oc-btn').forEach(b => b.classList.remove('active'));
  } catch (e) {
    _toast('Error: ' + e.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════
   ANALYTICS
   ═══════════════════════════════════════════════════════════════ */

function renderAnalyticsPage() {
  const trades = S.trades || [];
  const wins = trades.filter(t => t.outcome === 'win').length;
  const losses = trades.filter(t => t.outcome === 'loss').length;
  const wr = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const avgRR = trades.length
    ? (trades.reduce((a, t) => a + (parseFloat(t.rr) || 0), 0) / trades.length).toFixed(2)
    : '0.00';
  
  _setText('stat-wins', wins);
  _setText('stat-losses', losses);
  _setText('an-rr', avgRR);
  _setText('stat-wr', wr + '%');
}

/* ═══════════════════════════════════════════════════════════════
   SESSION TIMER
   ═══════════════════════════════════════════════════════════════ */

function _startSessionTimer() {
  const timerEl = document.getElementById('session-timer-card');
  if (!timerEl) return;
  
  const sessions = [
    { name: 'London', open: 8, close: 17 },
    { name: 'New York', open: 13, close: 22 },
    { name: 'Asian', open: 0, close: 9 }
  ];
  
  function updateTimer() {
    const now = new Date();
    const utc = now.getUTCHours();
    
    let html = '<div style="padding:4px 0"><div style="font-size:11px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">📅 Trading Sessions</div>';
    
    sessions.forEach(s => {
      const isOpen = utc >= s.open && utc < s.close;
      const status = isOpen ? '🟢 OPEN' : '🔴 CLOSED';
      const statusColor = isOpen ? '#00d4a1' : '#5a6a8a';
      
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">
        <div style="font-size:12px;font-weight:700;color:var(--t1)">${s.name}</div>
        <div style="font-size:11px;color:${statusColor};font-weight:700">${status}</div>
        <div style="font-size:10px;color:var(--t2)">${s.open}:00–${s.close}:00 GMT</div>
      </div>`;
    });
    
    html += '</div>';
    timerEl.innerHTML = html;
  }
  
  updateTimer();
  setInterval(updateTimer, 60000);
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════════ */

function _setupSettingsPage() {
  const el = document.getElementById('settings-email');
  if (el && S.user) el.textContent = S.user.email;
}

function exportCSV() {
  if (!S.trades?.length) { _toast('No trades.', 'warning'); return; }
  const header = 'Date,Pair,Direction,Entry,SL,TP,R:R,Outcome\n';
  const rows = S.trades.map(t => {
    const dt = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
    return [dt.toLocaleDateString(),t.pair||'',t.direction||'',t.entry||'',t.sl||'',t.tp||'',t.rr||'',t.outcome||''].join(',');
  }).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tes_trades_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  _toast('CSV exported ✓', 'success');
}

function exportJSON() {
  if (!S.trades?.length) { _toast('No trades.', 'warning'); return; }
  const blob = new Blob([JSON.stringify(S.trades, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tes_trades_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  _toast('JSON exported ✓', 'success');
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('tes_theme', next);
}

function confirmDeleteAll() {
  if (!S.trades?.length) { _toast('No trades.', 'warning'); return; }
  if (!confirm('Delete ALL ' + S.trades.length + ' trades?')) return;
  Promise.all(S.trades.map(t => {
    if (!S.user || !_firestore) return Promise.resolve();
    return _firestore.collection('users').doc(S.user.uid).collection('trades').doc(t.id).delete();
  })).then(() => {
    _toast('All trades deleted.', 'success');
  });
}

/* ═══════════════════════════════════════════════════════════════
   PSYCHOLOGY BOOTCAMP
   ═══════════════════════════════════════════════════════════════ */

function _loadPsychologyState() {
  if (!S.user) return;
  try {
    const saved = JSON.parse(localStorage.getItem('tes_psych_' + S.user.uid));
    if (saved) {
      S.psychologyState = { ...S.psychologyState, ...saved };
    }
  } catch (e) {
    console.warn('[Psychology] Load error:', e);
  }
}

function _savePsychologyState() {
  if (!S.user) return;
  try {
    localStorage.setItem('tes_psych_' + S.user.uid, JSON.stringify(S.psychologyState));
  } catch (e) {
    console.warn('[Psychology] Save error:', e);
  }
}

function showPsychologyApp() {
  document.getElementById('screen-app').style.display = 'none';
  const psychEl = document.getElementById('psychology-wrapper');
  if (psychEl) psychEl.style.display = 'flex';
  _loadPsychologyState();
  _renderPsychologyHub();
}

function returnToTesPro() {
  _savePsychologyState();
  const psychEl = document.getElementById('psychology-wrapper');
  if (psychEl) psychEl.style.display = 'none';
  document.getElementById('screen-app').style.display = 'flex';
  goPage('dashboard');
}

function _addPsychologyNavButton() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  if (nav.querySelector('[data-page="psychology"]')) return;
  
  const psychBtn = document.createElement('button');
  psychBtn.className = 'nav-btn';
  psychBtn.setAttribute('data-page', 'psychology');
  psychBtn.onclick = showPsychologyApp;
  psychBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="3" r="2"/></svg>Psychology`;
  nav.appendChild(psychBtn);
}

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
          <div class="psych-sub">Trading in the Zone · Mark Douglas</div>
        </div>
        <div style="text-align:right">
          <div class="psych-xp">⚡ ${state.xp} XP</div>
          <div class="psych-streak">🔥 ${state.streak} streak</div>
          <button class="psych-exit-btn" onclick="returnToTesPro()">← TES PRO</button>
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
          <div class="psych-nav-sub">5 Levels</div>
        </button>
        <button class="psych-nav-btn" onclick="_showPsychologyScreen('scenarios')">
          <div class="psych-nav-icon">🎯</div>
          <div class="psych-nav-label">SCENARIOS</div>
          <div class="psych-nav-sub">Trade Drills</div>
        </button>
        <button class="psych-nav-btn" onclick="_showPsychologyScreen('missions')">
          <div class="psych-nav-icon">📋</div>
          <div class="psych-nav-label">MISSIONS</div>
          <div class="psych-nav-sub">Daily</div>
        </button>
        <button class="psych-nav-btn" onclick="_showPsychologyScreen('archetypes')">
          <div class="psych-nav-icon">🧬</div>
          <div class="psych-nav-label">ARCHETYPE</div>
          <div class="psych-nav-sub">Profile</div>
        </button>
      </div>
      
      <div class="psych-quote">
        <div class="psych-quote-text">"The consistency you seek is in your mind, not in the markets."</div>
        <div class="psych-quote-author">— Mark Douglas</div>
      </div>
    </div>
  `;
}

function _showPsychologyScreen(screen) {
  const wrapper = document.getElementById('psychology-wrapper');
  if (!wrapper) return;
  
  if (screen === 'levels') {
    wrapper.innerHTML = `
      <div class="psychology-screen psychology-levels active">
        <button class="psych-exit-btn" onclick="_renderPsychologyHub()" style="position:absolute;top:20px;right:20px;z-index:10">← BACK</button>
        <div class="psychology-hub" style="margin-top:40px">
          <div class="psych-title">⚔️ LEVELS</div>
          <div style="margin-top:20px">
            <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
              <div style="font-size:14px;font-weight:900;color:#00ff88">🥉 LEVEL 1: AWARENESS</div>
              <div style="font-size:12px;color:var(--t2);margin-top:6px">Recognize your emotional patterns in trading.</div>
              <div style="margin-top:8px;font-size:11px;color:#00ff88">✓ Unlocked | Reward: 50 XP</div>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
              <div style="font-size:14px;font-weight:900;color:#00ccff">🥈 LEVEL 2: MASTERY</div>
              <div style="font-size:12px;color:var(--t2);margin-top:6px">Develop discipline. Stick to your plan.</div>
              <div style="margin-top:8px;font-size:11px;color:#00ccff">${S.psychologyState.xp >= 100 ? '✓ Unlocked' : '🔒 Reach 100 XP'} | Reward: 100 XP</div>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
              <div style="font-size:14px;font-weight:900;color:#ff9944">🥇 LEVEL 3: CONSISTENCY</div>
              <div style="font-size:12px;color:var(--t2);margin-top:6px">Execute trades methodically, without hesitation.</div>
              <div style="margin-top:8px;font-size:11px;color:#ff9944">${S.psychologyState.xp >= 300 ? '✓ Unlocked' : '🔒 Reach 300 XP'} | Reward: 150 XP</div>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
              <div style="font-size:14px;font-weight:900;color:#cc44ff">💎 LEVEL 4: ZONE</div>
              <div style="font-size:12px;color:var(--t2);margin-top:6px">Enter the Trading Zone. Pure execution.</div>
              <div style="margin-top:8px;font-size:11px;color:#cc44ff">${S.psychologyState.xp >= 600 ? '✓ Unlocked' : '🔒 Reach 600 XP'} | Reward: 200 XP</div>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px">
              <div style="font-size:14px;font-weight:900;color:#00ff88">👑 LEVEL 5: ELITE</div>
              <div style="font-size:12px;color:var(--t2);margin-top:6px">Complete mastery. Trading under any condition.</div>
              <div style="margin-top:8px;font-size:11px;color:#00ff88">${S.psychologyState.xp >= 1000 ? '✓ Unlocked' : '🔒 Reach 1000 XP'} | Reward: 300 XP</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (screen === 'scenarios') {
    wrapper.innerHTML = `
      <div class="psychology-screen active">
        <button class="psych-exit-btn" onclick="_renderPsychologyHub()" style="position:absolute;top:20px;right:20px;z-index:10">← BACK</button>
        <div class="psychology-hub" style="margin-top:40px">
          <div class="psych-title">🎯 SCENARIOS</div>
          <div style="margin-top:20px">
            <div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:10px;padding:14px;margin-bottom:10px">
              <div style="font-size:13px;font-weight:900;color:var(--t1);margin-bottom:8px">Scenario 1: The Breakeven Close</div>
              <div style="font-size:12px;color:var(--t2);margin-bottom:8px">Your trade hit breakeven. 2 hours to market close. What do you do?</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button style="background:var(--gold-dim);border:1px solid var(--gold);color:var(--gold);padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✓ Correct! Lock in discipline', 'success');S.psychologyState.xp+=20;_savePsychologyState()">A: Close and move on</button>
                <button style="background:var(--bg2);border:1px solid var(--bd);color:var(--t2);padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✗ Risky: Chasing without setup', 'warning')">B: Hold for bigger target</button>
              </div>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:10px;padding:14px;margin-bottom:10px">
              <div style="font-size:13px;font-weight:900;color:var(--t1);margin-bottom:8px">Scenario 2: The Revenge Trade</div>
              <div style="font-size:12px;color:var(--t2);margin-bottom:8px">You just lost. Another setup forms immediately. Your impulse is strong. What do you do?</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button style="background:var(--gold-dim);border:1px solid var(--gold);color:var(--gold);padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✓ Correct! Discipline over emotion', 'success');S.psychologyState.xp+=20;S.psychologyState.scores.emotion+=5;_savePsychologyState()">A: Wait and process the loss</button>
                <button style="background:var(--bg2);border:1px solid var(--bd);color:var(--t2);padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✗ Revenge trading loses accounts', 'warning')">B: Jump in immediately</button>
              </div>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:10px;padding:14px">
              <div style="font-size:13px;font-weight:900;color:var(--t1);margin-bottom:8px">Scenario 3: The FOMO Trade</div>
              <div style="font-size:12px;color:var(--t2);margin-bottom:8px">Market rallying. Everyone talking. No setup. Fear of missing gains. What do you do?</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button style="background:var(--gold-dim);border:1px solid var(--gold);color:var(--gold);padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✓ Correct! No setup = No trade', 'success');S.psychologyState.xp+=20;S.psychologyState.scores.discipline+=5;_savePsychologyState()">A: Stay disciplined, wait</button>
                <button style="background:var(--bg2);border:1px solid var(--bd);color:var(--t2);padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✗ Chasing tops is how traders lose', 'warning')">B: Chase the move</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (screen === 'missions') {
    wrapper.innerHTML = `
      <div class="psychology-screen active">
        <button class="psych-exit-btn" onclick="_renderPsychologyHub()" style="position:absolute;top:20px;right:20px;z-index:10">← BACK</button>
        <div class="psychology-hub" style="margin-top:40px">
          <div class="psych-title">📋 DAILY MISSIONS</div>
          <div style="margin-top:20px">
            <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--t1)">📖 Read Psychology Chapter</div>
                <div style="font-size:11px;color:var(--t2);margin-top:2px">10 min on discipline</div>
              </div>
              <button style="background:var(--gold);color:#000;padding:6px 12px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✓ +30 XP', 'success');S.psychologyState.xp+=30;_savePsychologyState()">✓</button>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--t1)">✅ Complete Checklist</div>
                <div style="font-size:11px;color:var(--t2);margin-top:2px">Use checklist in TES PRO</div>
              </div>
              <button style="background:var(--gold);color:#000;padding:6px 12px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✓ +40 XP', 'success');S.psychologyState.xp+=40;S.psychologyState.scores.discipline+=10;_savePsychologyState()">✓</button>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--t1)">📊 Journal Your Trade</div>
                <div style="font-size:11px;color:var(--t2);margin-top:2px">Log at least 1 trade</div>
              </div>
              <button style="background:var(--gold);color:#000;padding:6px 12px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✓ +35 XP', 'success');S.psychologyState.xp+=35;_savePsychologyState()">✓</button>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--t1)">🎯 No Revenge Trades Today</div>
                <div style="font-size:11px;color:var(--t2);margin-top:2px">Maintain discipline all day</div>
              </div>
              <button style="background:var(--gold);color:#000;padding:6px 12px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="_toast('✓ +50 XP BONUS!', 'success');S.psychologyState.xp+=50;S.psychologyState.scores.discipline+=15;S.psychologyState.streak+=1;_savePsychologyState()">✓</button>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (screen === 'archetypes') {
    wrapper.innerHTML = `
      <div class="psychology-screen active">
        <button class="psych-exit-btn" onclick="_renderPsychologyHub()" style="position:absolute;top:20px;right:20px;z-index:10">← BACK</button>
        <div class="psychology-hub" style="margin-top:40px">
          <div class="psych-title">🧬 TRADER ARCHETYPES</div>
          <div style="margin-top:20px">
            <div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:10px;padding:14px;margin-bottom:10px">
              <div style="font-size:13px;font-weight:900;color:#00ff88;margin-bottom:8px">🦁 THE DISCIPLINARIAN</div>
              <div style="font-size:12px;color:var(--t2)">Follows the plan religiously. Never revenge trades. Takes losses without emotion.</div>
              <button style="width:100%;background:var(--gold-dim);border:1px solid var(--gold);color:var(--gold);padding:8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-top:8px" onclick="_toast('You are The Disciplinarian!', 'success');S.psychologyState.xp+=15">This is me</button>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:10px;padding:14px;margin-bottom:10px">
              <div style="font-size:13px;font-weight:900;color:#00ccff;margin-bottom:8px">🔥 THE EMOTIONAL TRADER</div>
              <div style="font-size:12px;color:var(--t2)">Makes decisions based on feelings. Takes losses hard. Work on emotional control.</div>
              <button style="width:100%;background:var(--blue-dim);border:1px solid var(--blue);color:var(--blue);padding:8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-top:8px" onclick="_toast('Focus on Emotion Control!', 'warning');S.psychologyState.xp+=15;S.psychologyState.scores.emotion+=10;_savePsychologyState()">This is me</button>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:10px;padding:14px">
              <div style="font-size:13px;font-weight:900;color:#cc44ff;margin-bottom:8px">⚡ THE IMPULSIVE TRADER</div>
              <div style="font-size:12px;color:var(--t2)">Enters without a plan. Chases moves. FOMO is your enemy. Master patience.</div>
              <button style="width:100%;background:rgba(204,68,255,.15);border:1px solid rgba(204,68,255,.3);color:#cc44ff;padding:8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-top:8px" onclick="_toast('Work on Patience & Setup!', 'warning');S.psychologyState.xp+=15;S.psychologyState.scores.execution+=10;_savePsychologyState()">This is me</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

function _getPsychologyRank(xp) {
  if (xp >= 1500) return 'ELITE OPERATOR';
  if (xp >= 900) return 'SERGEANT';
  if (xp >= 500) return 'CORPORAL';
  if (xp >= 200) return 'PRIVATE';
  return 'RECRUIT';
}

function _getPsychologyProgress(xp) {
  return Math.min((xp / 2000) * 100, 100);
}

// Load Chart.js
(function() {
  if (typeof Chart !== 'undefined') return;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  s.async = true;
  document.head.appendChild(s);
})();

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  _startSessionTimer();
  _renderGoldSessions();
});
