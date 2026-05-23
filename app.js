/* ═══════════════════════════════════════════════════════════
   app.js — TES Pro (Session 4 - Complete Revision)
   Production-grade trading system with all fixes and missing functions
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ─── CONSTANTS ───────────────────────────────────────────── */
const SUB_MS = {
  monthly: 30  * 24 * 60 * 60 * 1000,
  annual:  365 * 24 * 60 * 60 * 1000
};

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
  rankings:     []
};

/* ─── TIMER CLEANUP ───────────────────────────────────────── */
let _sessionTimerInterval = null;
let _goldSessionInterval = null;

/* ═══════════════════════════════════════════════════════════
   SCREEN CONTROL
   ═══════════════════════════════════════════════════════════ */
function show(id) {
  ['screen-splash', 'screen-auth', 'screen-locked', 'screen-app'].forEach(sid => {
    const el = document.getElementById(sid);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = id === 'screen-splash' ? 'flex' : 'block';
}

/* ═══════════════════════════════════════════════════════════
   PAGE NAVIGATION
   ═══════════════════════════════════════════════════════════ */
function goPage(pageId) {
  const pages = document.querySelectorAll('.page');
  const navBtns = document.querySelectorAll('.nav-btn');
  
  pages.forEach(p => p.classList.remove('active'));
  navBtns.forEach(b => b.classList.remove('active'));
  
  const page = document.getElementById('page-' + pageId);
  const btn = document.querySelector('[data-page="' + pageId + '"]');
  
  if (page) page.classList.add('active');
  if (btn) btn.classList.add('active');
  
  // Page-specific initialization
  if (pageId === 'dashboard') {
    _updateDashboardStats();
    _startSessionTimer();
  }
  if (pageId === 'analytics') {
    renderTradeReview();
  }
  if (pageId === 'gold') {
    _initGoldPage();
  }
}

/* ═══════════════════════════════════════════════════════════
   BOOT — Firebase auth observer
   ═══════════════════════════════════════════════════════════ */
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
      S.user    = null;
      S.profile = null;
      _teardown();
      show('screen-auth');
    }
  });
})();

/* ═══════════════════════════════════════════════════════════
   SUBSCRIPTION HELPERS
   ═══════════════════════════════════════════════════════════ */
function _subRead(uid) {
  try { return JSON.parse(localStorage.getItem('tes_sub_' + uid)); }
  catch { return null; }
}

function _subWrite(uid, sub) {
  try { localStorage.setItem('tes_sub_' + uid, JSON.stringify(sub)); }
  catch { console.warn('[TES] localStorage write failed'); }
}

async function _subReadCloud(uid) {
  if (!_db) return null;
  try {
    const doc = await _db.collection('users').doc(uid).get();
    if (doc.exists && doc.data().subscription) {
      const sub = doc.data().subscription;
      _subWrite(uid, sub);
      return sub;
    }
    return null;
  } catch (e) {
    console.warn('[TES] Cloud read failed:', e.message);
    return null;
  }
}

async function _subWriteCloud(uid, sub) {
  if (!_db) return;
  try {
    await _db.collection('users').doc(uid).set({
      subscription: sub,
      email: S.user?.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('[TES] Subscription saved to Firestore ✅');
  } catch (e) {
    console.warn('[TES] Cloud write failed, localStorage intact:', e.message);
  }
}

/* ═══════════════════════════════════════════════════════════
   PAYMENT & SUBSCRIPTION
   ═══════════════════════════════════════════════════════════ */
function onPaymentSuccess(plan) {
  if (!S.user) return;

  const sub = {
    status:    'active',
    plan:      plan,
    expiresAt: Date.now() + SUB_MS[plan]
  };

  _subWrite(S.user.uid, sub);
  _subWriteCloud(S.user.uid, sub);

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

function initiatePaystack(plan) {
  plan = plan || 'monthly';
  if (!S.user) { _toast('Please sign in first.', 'error'); return; }

  const key    = (typeof PAYSTACK_PUBLIC_KEY !== 'undefined') ? PAYSTACK_PUBLIC_KEY : '';
  const rate   = (typeof USD_TO_NGN          !== 'undefined') ? USD_TO_NGN          : 1500;
  const prices = (typeof PLAN_PRICES_USD     !== 'undefined') ? PLAN_PRICES_USD     : { monthly: 15, annual: 120 };
  const usd    = prices[plan] || 15;
  const kobo   = Math.round(usd * rate * 120);

  const openPopup = () => {
    try {
      PaystackPop.setup({
        key,
        email:    S.user.email,
        amount:   kobo,
        currency: 'NGN',
        ref:      'TES_' + S.user.uid + '_' + Date.now(),
        metadata: { uid: S.user.uid, plan },
        callback: (response) => {
          _toast('Verifying payment…', 'warning');
          _verifyPayment(response.reference, plan);
        },
        onClose: () => _toast('Payment window closed.', 'warning')
      }).openIframe();
    } catch (e) {
      console.error('[TES] Paystack setup failed:', e);
      _toast('Payment popup error. Check connection.', 'error');
    }
  };

  if (typeof PaystackPop !== 'undefined') { openPopup(); return; }

  const script  = document.createElement('script');
  script.src    = 'https://js.paystack.co/v1/inline.js';
  script.onload = openPopup;
  script.onerror = () => _toast('Could not load Paystack. Check connection.', 'error');
  document.head.appendChild(script);
}

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
    console.warn('[TES] Verification fetch failed, granting access directly:', err.message);
    onPaymentSuccess(plan);
  }
}

/* ═══════════════════════════════════════════════════════════
   BOOT USER
   ═══════════════════════════════════════════════════════════ */
async function bootUser(uid) {
  if (typeof isOwner === 'function' && isOwner(S.user.email)) {
    S.profile = { uid, email: S.user.email, plan: 'owner', paymentStatus: 'paid' };
    console.log('[TES] Owner bypass active');
    _launchApp();
    return;
  }

  const now = Date.now();
  let sub = await _subReadCloud(uid);
  if (!sub) sub = _subRead(uid);

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
    S.profile = { uid, email: S.user.email, paymentStatus: 'free' };
    _setupLockedScreen();
    show('screen-locked');
  }
}

function _setupLockedScreen() {
  const emailEl = document.getElementById('locked-email');
  if (emailEl) emailEl.textContent = S.user?.email || '';

  const sub     = _subRead(S.user?.uid);
  const noteEl  = document.getElementById('locked-expiry-note');
  if (noteEl && sub && sub.expiresAt) {
    const expired = Date.now() >= sub.expiresAt;
    noteEl.textContent = expired ? 'Your subscription expired. Renew below.' : '';
  }

  const rate   = (typeof USD_TO_NGN      !== 'undefined') ? USD_TO_NGN      : 1500;
  const prices = (typeof PLAN_PRICES_USD !== 'undefined') ? PLAN_PRICES_USD : { monthly: 15, annual: 120 };

  const moPriceEl  = document.getElementById('price-monthly');
  const yrPriceEl  = document.getElementById('price-annual');
  if (moPriceEl) moPriceEl.textContent = `$${prices.monthly} / month`;
  if (yrPriceEl) yrPriceEl.textContent = `$${prices.annual} / year`;
}

/* ═══════════════════════════════════════════════════════════
   APP LAUNCH & TEARDOWN
   ═══════════════════════════════════════════════════════════ */
function _launchApp() {
  show('screen-app');
  _setupTopbar();
  _setupDashboard();
  _subscribeToTrades();
  _restoreCurrencyAnalysis();
  fetchAndInjectMacroData().catch(() => {});
  fetchAndInjectNewsSentiment().catch(() => {});
  _initCurrencyInputs();
  _initWBBInputs();
  goPage('dashboard');
}

function _teardown() {
  if (S.unsubTrades) { S.unsubTrades(); S.unsubTrades = null; }
  if (_sessionTimerInterval) { clearInterval(_sessionTimerInterval); _sessionTimerInterval = null; }
  if (_goldSessionInterval) { clearInterval(_goldSessionInterval); _goldSessionInterval = null; }
  S.trades   = [];
  S.rankings = [];
}

/* ═══════════════════════════════════════════════════════════
   AUTH UI & TAB SWITCHING
   ═══════════════════════════════════════════════════════════ */
function authTab(tabName, btn) {
  document.querySelectorAll('.atab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('auth-' + tabName).classList.add('active');
}

async function doLogin() {
  const email = document.getElementById('l-email')?.value?.trim() || '';
  const pass  = document.getElementById('l-pass')?.value          || '';
  _clearErr('l-err');

  if (!email || !pass) { _showErr('l-err', 'Enter your email and password.'); return; }

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
  const pass  = document.getElementById('s-pass')?.value          || '';
  _clearErr('s-err');

  if (!email || !pass) { _showErr('s-err', 'Enter email and password.'); return; }
  if (pass.length < 6) { _showErr('s-err', 'Password needs at least 6 characters.'); return; }

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

/* ═══════════════════════════════════════════════════════════
   TOPBAR
   ═══════════════════════════════════════════════════════════ */
function _setupTopbar() {
  const emailEl = document.getElementById('tb-email');
  if (emailEl) emailEl.textContent = (S.user?.email || '').split('@')[0];

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
      renewEl.style.display = daysLeft <= 7 ? 'inline-block' : 'none';
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════ */
function _setupDashboard() {
  const h  = new Date().getHours();
  const gr = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const nm = (S.user?.email || '').split('@')[0];
  _setText('dash-greeting', gr + ', ' + nm + ' ⚡');
  _setText('dash-date', new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }));
}

function _updateDashboardStats() {
  _updateStats();
  _renderRecentTrades();
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

function _renderRecentTrades() {
  const el = document.getElementById('home-recent-trades');
  if (!el) return;
  const recent = S.trades.slice(0, 3);
  if (!recent.length) {
    el.innerHTML = '<p style="color:var(--t3);font-size:13px;padding:8px 0">No trades logged yet.</p>';
    return;
  }
  el.innerHTML = recent.map(t => {
    const col = t.outcome === 'win' ? '#00d4a1' : t.outcome === 'loss' ? '#ff4560' : '#3d9eff';
    const oc  = (t.outcome || 'be').toUpperCase();
    const dir = t.direction === 'BUY' ? '↑' : '↓';
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--bd)">
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700">${t.pair || '—'} ${dir}</div>
        <div style="font-size:11px;color:var(--t2);margin-top:2px">1:${t.rr || '—'}</div>
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:15px;background:${col}20;color:${col}">${oc}</span>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   FIRESTORE — TRADES
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
      _updateDashboardStats();
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
  try {
    await _db.collection('users').doc(S.user.uid).collection('trades').doc(tradeId).delete();
    _toast('Trade deleted.', 'success');
  } catch (e) {
    console.error('[TES] delete failed:', e);
    _toast('Delete failed. Try again.', 'error');
  }
}

/* ─── TRADE FORM ──────────────────────────────────────────── */
function toggleJournalForm() {
  const el = document.getElementById('trade-form-wrap');
  const btn = document.getElementById('btn-jform');
  if (!el || !btn) return;
  
  if (el.style.display === 'block') {
    hideTradeForm();
  } else {
    showTradeForm();
  }
}

function showTradeForm() {
  const el = document.getElementById('trade-form-wrap');
  const btn = document.getElementById('btn-jform');
  if (!el) return;
  el.style.display = 'block';
  if (btn) btn.textContent = '× Close';
  el.scrollIntoView({ behavior: 'smooth' });
}

function hideTradeForm() {
  const el = document.getElementById('trade-form-wrap');
  const btn = document.getElementById('btn-jform');
  if (!el) return;
  el.style.display = 'none';
  if (btn) btn.textContent = '+ Log Trade';
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

async function _uploadScreenshot(inputId) {
  const input = document.getElementById(inputId);
  if (!input?.files?.[0]) return null;
  if (!_storage) { console.warn('[TES] Storage not initialized'); return null; }

  const file = input.files[0];
  if (file.size > 2 * 1024 * 1024) {
    _toast('Image too large. Max 2 MB.', 'warning');
    return null;
  }

  const uid = S.user?.uid;
  if (!uid) return null;

  const timestamp = Date.now();
  const path = `trades/${uid}/${timestamp}.jpg`;
  const ref = _storage.ref(path);

  try {
    const snapshot = await ref.put(file, { contentType: 'image/jpeg' });
    const url = await snapshot.ref.getDownloadURL();
    console.log('[TES] Screenshot uploaded ✅');
    return url;
  } catch (e) {
    console.error('[TES] Screenshot upload failed:', e);
    _toast('Screenshot upload failed. Trade saved without image.', 'warning');
    return null;
  }
}

async function submitTrade() {
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
  if (entry === sl)  { _toast('Entry and Stop Loss cannot be the same.', 'warning'); return; }

  const imageUrl = await _uploadScreenshot('j-image');

  const trade = {
    pair, direction: dir, entry, sl, tp,
    rr:      calcRR(),
    outcome: S.outcome,
    session: sess,
    notes,
    ...(imageUrl && { imageUrl })
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
  const subtitle = document.getElementById('j-subtitle');
  if (!el) return;
  
  if (subtitle) subtitle.textContent = S.trades.length + (S.trades.length === 1 ? ' trade' : ' trades');
  
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
  const imgUrl = t.imageUrl || t.image;
  const img = imgUrl
    ? `<div style="margin-top:10px"><img src="${imgUrl}" alt="screenshot"
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
   CHECKLIST
   ═══════════════════════════════════════════════════════════ */
function clToggle(el) {
  el.classList.toggle('checked');
  _updateChecklistProgress();
}

function clReset() {
  document.querySelectorAll('.cl-item').forEach(el => el.classList.remove('checked'));
  _updateChecklistProgress();
}

function clSubmit() {
  const checked = document.querySelectorAll('.cl-item.checked').length;
  if (checked < 12) {
    _toast('Complete all 12 items before proceeding.', 'warning');
    return;
  }
  goPage('journal');
  showTradeForm();
}

function _updateChecklistProgress() {
  const checked = document.querySelectorAll('.cl-item.checked').length;
  const total = document.querySelectorAll('.cl-item').length;
  const pct = Math.round(checked / total * 100);
  
  const bar = document.getElementById('cl-bar');
  const count = document.getElementById('cl-count');
  const pctEl = document.getElementById('cl-pct');
  
  if (bar) bar.style.width = pct + '%';
  if (count) count.textContent = checked + '/' + total;
  if (pctEl) pctEl.textContent = pct + '%';
}

/* ═══════════════════════════════════════════════════════════
   THEME TOGGLE
   ═══════════════════════════════════════════════════════════ */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('tes_theme', next);
  const label = document.getElementById('theme-label');
  if (label) label.textContent = next === 'dark' ? 'Dark Mode' : 'Light Mode';
}

/* ═══════════════════════════════════════════════════════════
   EXPORT FUNCTIONS
   ═══════════════════════════════════════════════════════════ */
function exportCSV() {
  if (!S.trades.length) { _toast('No trades to export.', 'warning'); return; }
  
  const headers = ['Date', 'Pair', 'Direction', 'Entry', 'SL', 'TP', 'R:R', 'Outcome', 'Session', 'Notes'];
  const rows = S.trades.map(t => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
    return [
      d.toLocaleDateString(),
      t.pair || '',
      t.direction || '',
      t.entry || '',
      t.sl || '',
      t.tp || '',
      t.rr || '',
      t.outcome || '',
      t.session || '',
      t.notes ? `"${t.notes}"` : ''
    ].join(',');
  });
  
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tes-pro-trades-' + Date.now() + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  _toast('CSV exported ✓', 'success');
}

function exportJSON() {
  if (!S.trades.length) { _toast('No trades to export.', 'warning'); return; }
  
  const data = {
    exportDate: new Date().toISOString(),
    user: S.user?.email,
    trades: S.trades
  };
  
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tes-pro-backup-' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  _toast('JSON exported ✓', 'success');
}

function confirmDeleteAll() {
  if (!confirm('Delete ALL trades? This cannot be undone.')) return;
  
  const docs = S.trades.map(t => t.id);
  if (!docs.length) { _toast('No trades to delete.', 'warning'); return; }
  
  Promise.all(docs.map(id => deleteTrade(id)))
    .then(() => _toast('All trades deleted.', 'success'))
    .catch(e => { console.error(e); _toast('Delete failed.', 'error'); });
}

/* ═══════════════════════════════════════════════════════════
   CURRENCY STRENGTH ENGINE
   ═══════════════════════════════════════════════════════════ */

function calculateCurrencyScore(data) {
  let score = 0;
  if (data.rate === 'bullish') score += 3;
  if (data.rate === 'bearish') score -= 3;
  if (data.cpi === 'rising')  score += 2;
  if (data.cpi === 'falling') score -= 2;
  if (data.cbStance === 'hawkish') score += 2;
  if (data.cbStance === 'dovish')  score -= 2;
  if (data.employment === 'strong') score += 2;
  if (data.employment === 'weak')   score -= 2;
  return score;
}

const RISK_SENSITIVITY = {
  AUD: { 'risk-on': +1.5, 'risk-off': -1.5 },
  NZD: { 'risk-on': +1.5, 'risk-off': -1.5 },
  CAD: { 'risk-on': +1.0, 'risk-off': -1.0 },
  EUR: { 'risk-on': +0.5, 'risk-off': -0.5 },
  GBP: { 'risk-on': +0.5, 'risk-off': -0.5 },
  USD: { 'risk-on': -0.5, 'risk-off': +1.5 },
  JPY: { 'risk-on': -1.5, 'risk-off': +2.0 },
  CHF: { 'risk-on': -1.0, 'risk-off': +1.5 },
  XAU: { 'risk-on': -0.5, 'risk-off': +2.0 }
};

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
    score += (window.NEWS_BIAS?.[c] || 0) * 0.5;

    // XAU override
    if (c === 'XAU') {
      score = 0;
      if (data.rate === 'bullish') score += 3;
      if (data.rate === 'bearish') score -= 3;
      if (data.cpi === 'rising')   score += 2;
      if (data.cpi === 'falling')  score -= 1;
    }

    if (globalRisk && RISK_SENSITIVITY[c]) {
      score += RISK_SENSITIVITY[c][globalRisk] || 0;
    }

    return { currency: c, score: parseFloat(score.toFixed(2)) };
  });

  const rankings = scored.sort((a, b) => b.score - a.score);
  S.rankings = rankings;

  if (S.user) {
    try { localStorage.setItem('tes_cs_' + S.user.uid, JSON.stringify(rankings)); }
    catch { console.warn('[TES] localStorage save failed'); }
  }

  renderCurrencyTable(rankings);
  renderTradeSuggestions(rankings);
  renderTradeInsight(rankings);
  _toast('✅ Currency analysis complete', 'success');
}

function _initCurrencyInputs() {
  const currencies = ['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF','XAU'];
  const wrap = document.getElementById('cs-inputs-wrap');
  if (!wrap) return;

  let html = '';
  currencies.forEach(c => {
    html += `<div class="cfs-currency-card">
      <div class="cfs-cname-row"><div class="cfs-cname">${c}</div></div>
      <div class="cfs-field"><label>Rate</label><select id="cs-${c}-rate"><option value="">—</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option></select></div>
      <div class="cfs-field"><label>CPI</label><select id="cs-${c}-cpi"><option value="">—</option><option value="rising">Rising</option><option value="falling">Falling</option></select></div>
      <div class="cfs-field"><label>CB Stance</label><select id="cs-${c}-stance"><option value="">—</option><option value="hawkish">Hawkish</option><option value="dovish">Dovish</option></select></div>
      <div class="cfs-field"><label>Employment</label><select id="cs-${c}-employment"><option value="">—</option><option value="strong">Strong</option><option value="weak">Weak</option></select></div>
    </div>`;
  });
  wrap.innerHTML = html;
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
  } catch { /* no saved data */ }
}

/* ─── CURRENCY TABLE ──────────────────────────────────────── */
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

/* ─── TRADE SUGGESTIONS ───────────────────────────────────── */
function renderTradeSuggestions(rankings) {
  const el = document.getElementById('sugg-list');
  if (!el) return;

  if (!rankings.length) {
    el.innerHTML = '<p style="color:#5a6a8a;font-size:13px">Run analysis above to generate suggestions.</p>';
    return;
  }

  const suggestions = [];
  TRADE_PAIRS.forEach(([base, quote]) => {
    const bRank = rankings.find(r => r.currency === base);
    const qRank = rankings.find(r => r.currency === quote);
    if (!bRank || !qRank) return;

    const diff = bRank.score - qRank.score;
    if (Math.abs(diff) < 1.5) return;

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
    el.innerHTML = '<p style="color:#5a6a8a;font-size:13px">No strong setups found.</p>';
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
        <div style="font-size:11px;color:#5a6a8a;margin-top:2px">${s.strong} strong vs ${s.weak} weak</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:16px;font-weight:800;color:${col}">${s.direction}</div>
        <div style="font-size:11px;color:#5a6a8a;margin-top:2px">${conf}% conf</div>
      </div>
    </div>`;
  }).join('');
}

/* ─── TRADE INSIGHT ───────────────────────────────────────── */
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
    plan       = `Strong divergence: ${strong.currency} outperforming ${weak.currency}. Look for pullbacks on ${strong.currency + weak.currency} for continuation. Target 1:2 minimum R:R.`;
  } else if (diff > 2) {
    confidence = 'MEDIUM';
    setup      = 'Momentum Setup';
    plan       = `Moderate divergence. Bias favours ${strong.currency + weak.currency} longs. Wait for M15 confirmation before entry.`;
  } else {
    confidence = 'LOW';
    setup      = 'No Clear Edge';
    plan       = `Close scores. No dominant bias. Best to wait for macro clarity.`;
  }

  let xauNote = '';
  if (xau) {
    const globalRisk = document.getElementById('cs-global-risk')?.value || '';
    if (globalRisk === 'risk-off' && xau.score > 2) {
      xauNote = `Gold (XAU) is elevated — confirms risk-off. Consider XAUUSD longs.`;
    } else if (globalRisk === 'risk-on' && xau.score < 0) {
      xauNote = `Gold (XAU) is weak — confirms risk-on. Favour commodity currencies.`;
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

/* ─── TRADE PLAN ──────────────────────────────────────────── */
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
  const absDiff   = Math.abs(diff);
  const confidence = absDiff > 4 ? 'HIGH' : absDiff > 2 ? 'MEDIUM' : 'LOW';

  const entry = direction === 'BUY'
    ? 'Wait for pullback into premium demand zone on H1.'
    : 'Wait for retracement into supply zone on H1.';

  const stopLoss = direction === 'BUY'
    ? 'Below recent swing low. Minimum 10 pips buffer.'
    : 'Above recent swing high. Minimum 10 pips buffer.';

  const takeProfit = direction === 'BUY'
    ? 'Target next resistance. Minimum 1:2 R:R.'
    : 'Target next support. Minimum 1:2 R:R.';

  const riskNote = `Max risk 1–2% per trade. Divergence: ${absDiff.toFixed(1)} — ${confidence.toLowerCase()} confidence. ${confidence === 'LOW' ? 'Consider sitting out.' : 'Wait for confirmation.'}`;

  return {
    pair:       base + quote,
    direction,
    bias:       base + ' strong / ' + quote + ' weak',
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

  const plan = generateTradePlan(pair, rankings);
  if (!plan) {
    el.innerHTML = '<p style="color:var(--t3);font-size:13px;padding:12px 0">Could not generate plan.</p>';
    return;
  }

  const dirCol   = plan.direction === 'BUY' ? '#00d4a1' : '#ff4560';
  const dirArrow = plan.direction === 'BUY' ? '↑' : '↓';
  const confCol  = plan.confidence === 'HIGH' ? '#00d4a1' : plan.confidence === 'MEDIUM' ? '#e4ae2a' : '#ff4560';
  const confBg   = plan.confidence === 'HIGH' ? 'rgba(0,212,161,.08)' : plan.confidence === 'MEDIUM' ? 'rgba(228,174,42,.08)' : 'rgba(255,69,96,.08)';

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
    </div>

    <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:12px;padding:0 14px;overflow:hidden">
      <div style="padding:12px 0;border-bottom:1px solid var(--bd);display:flex;align-items:flex-start;gap:12px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--bg1);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">🎯</div>
        <div style="flex:1"><div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Entry Condition</div><div style="font-size:13px;color:var(--t1);line-height:1.6">${plan.entry}</div></div>
      </div>
      <div style="padding:12px 0;border-bottom:1px solid var(--bd);display:flex;align-items:flex-start;gap:12px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--bg1);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">🛑</div>
        <div style="flex:1"><div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Stop Loss</div><div style="font-size:13px;color:#ff4560;line-height:1.6">${plan.stopLoss}</div></div>
      </div>
      <div style="padding:12px 0;border-bottom:1px solid var(--bd);display:flex;align-items:flex-start;gap:12px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--bg1);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">💰</div>
        <div style="flex:1"><div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Take Profit</div><div style="font-size:13px;color:#00d4a1;line-height:1.6">${plan.takeProfit}</div></div>
      </div>
      <div style="padding:12px 0;display:flex;align-items:flex-start;gap:12px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--bg1);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">⚠️</div>
        <div style="flex:1"><div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Risk Note</div><div style="font-size:13px;color:var(--gold);line-height:1.6">${plan.riskNote}</div></div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   MACRO DATA INJECTION
   ═══════════════════════════════════════════════════════════ */
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
  }
}

/* ═══════════════════════════════════════════════════════════
   NEWS SENTIMENT INJECTION
   ═══════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════
   NEWS DECISION ENGINE
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
    better: 'Higher inflation → central bank may hike rates. Bullish for currency as higher rates attract capital.',
    worse:  'Lower inflation reduces rate hike pressure. Weakens currency as rate cut expectations rise.'
  },
  rate: {
    better: 'Rate hike increases yield differentials. Strong bullish signal.',
    worse:  'Rate cut reduces yield advantage. Capital flows out, weakening currency.'
  },
  nfp: {
    better: 'Strong employment signals healthy economy and supports tightening. Bullish.',
    worse:  'Weak employment undermines tightening case. Bearish, especially for USD.'
  },
  gdp: {
    better: 'Strong growth supports hawkish stance. Bullish for currency.',
    worse:  'Weak growth raises recession fears. Bearish.'
  }
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
          📢 News Impact — ${result.currency}
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
        ⚠️ Wait for confirmation on your chart before entering.
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   WEEKLY BIAS BUILDER
   ═══════════════════════════════════════════════════════════ */

const WBB_PAIRS = ['GBP/USD','EUR/USD','USD/JPY','AUD/USD','NZD/USD','USD/CAD','EUR/JPY','GBP/JPY'];

function _initWBBInputs() {
  const wrap = document.getElementById('wbb-pairs-wrap');
  if (!wrap) return;

  let html = '';
  WBB_PAIRS.forEach(pair => {
    html += `<div class="bias-pair-row">
      <div class="bias-pair-name">${pair}</div>
      <div class="bias-btns">
        <button class="bias-btn bull" onclick="wbbSetBias('${pair}','bull',this)">Bull</button>
        <button class="bias-btn neu" onclick="wbbSetBias('${pair}','neu',this)">Neu</button>
        <button class="bias-btn bear" onclick="wbbSetBias('${pair}','bear',this)">Bear</button>
      </div>
    </div>`;
  });
  wrap.innerHTML = html;
}

function wbbSetBias(pair, bias, btn) {
  btn.parentElement.querySelectorAll('.bias-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function saveWeeklyBias() {
  const biases = {};
  WBB_PAIRS.forEach(pair => {
    const btn = document.querySelector(`[onclick*="wbbSetBias('${pair}"]`);
    const active = document.querySelector(`[onclick*="wbbSetBias('${pair}"] .active`);
    if (active) {
      biases[pair] = active.textContent.toLowerCase();
    }
  });
  
  if (S.user) {
    try { localStorage.setItem('tes_wbb_' + S.user.uid, JSON.stringify(biases)); }
    catch { console.warn('[TES] localStorage save failed'); }
  }
  
  _toast('Weekly bias saved ✓', 'success');
}

/* ═══════════════════════════════════════════════════════════
   TRADE REVIEW & ANALYTICS
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
    notes.push(`Your win rate of ${d.wr}% is strong. Protect this edge by not overtrading.`);
  } else if (d.wr >= 45) {
    notes.push(`A ${d.wr}% win rate is workable if R:R is consistent. Your average winner is ${d.avgRR}R.`);
  } else {
    notes.push(`Your win rate is ${d.wr}%. Review your last 5 losses and identify entry issues.`);
  }

  if (parseFloat(d.netR) > 0) {
    notes.push(`You're net positive at +${d.netR}R. You are profitable.`);
  } else {
    notes.push(`Your net R is ${d.netR}R. Cut losses short and let winners run.`);
  }

  if (d.bestPair) {
    const [pair, stats] = d.bestPair;
    const pairWR = Math.round(stats.wins / stats.total * 100);
    notes.push(`Your strongest pair is ${pair} (${pairWR}% WR). Prioritise this pair.`);
  }

  if (d.bestSession) {
    const [sess, stats] = d.bestSession;
    const sessWR = Math.round(stats.wins / stats.total * 100);
    notes.push(`You trade best in ${sess} (${sessWR}% WR). Concentrate your energy here.`);
  }

  if (d.last5Count >= 5 && d.last5WR <= 30) {
    notes.push(`Your recent form is concerning — ${d.last5WR}% over last 5 trades. Take a break.`);
  }

  if (d.streak >= 3) {
    if (d.streakType === 'loss') {
      notes.push(`You've had ${d.streak} consecutive losses. Step back and reset your mindset.`);
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

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">📋 Weekly Trade Review</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
      <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:16px;font-weight:900;color:${wrCol};margin-bottom:3px">${d.wr}%</div>
        <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Win Rate</div>
      </div>
      <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:16px;font-weight:900;color:${netCol};margin-bottom:3px">${(parseFloat(d.netR) >= 0 ? '+' : '')}${d.netR}R</div>
        <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Net R</div>
      </div>
      <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:16px;font-weight:900;color:var(--gold);margin-bottom:3px">1:${d.avgRR}</div>
        <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Avg R:R</div>
      </div>
      <div style="background:var(--bg1);border:1px solid var(--bd);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:16px;font-weight:900;color:var(--t1);margin-bottom:3px">${d.total}</div>
        <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Total</div>
      </div>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🧠 Coaching Notes</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${notes.map((note, i) => `
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="width:22px;height:22px;border-radius:50%;background:rgba(228,174,42,.1);border:1px solid rgba(228,174,42,.3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:var(--gold);flex-shrink:0">${i + 1}</div>
          <div style="font-size:13px;color:var(--t1);line-height:1.7">${note}</div>
        </div>`).join('')}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   GOLD DESK — Implemented in app.js
   ═══════════════════════════════════════════════════════════ */

/* Gold Bias Engine */
function runGoldBiasEngine() {
  const usd      = document.getElementById('gd-usd-strength')?.value;
  const yields   = document.getElementById('gd-yields')?.value;
  const fed      = document.getElementById('gd-fed')?.value;
  const risk     = document.getElementById('gd-risk')?.value;
  const infl     = document.getElementById('gd-inflation')?.value;

  if (!usd || !yields || !fed || !risk || !infl) {
    _toast('Please fill all 5 factors.', 'warning');
    return;
  }

  let score = 0;
  if (usd === 'weak')    score += 1;
  if (usd === 'strong')  score -= 1;
  if (yields === 'falling') score += 1;
  if (yields === 'rising')  score -= 1;
  if (fed === 'dovish')   score += 1;
  if (fed === 'hawkish')  score -= 1;
  if (risk === 'risk-off') score += 1;
  if (risk === 'risk-on')  score -= 1;
  if (infl === 'rising')  score -= 1;
  if (infl === 'falling') score += 1;

  const conf = Math.min(95, Math.max(40, 60 + Math.abs(score) * 7));
  const bias = score >= 2 ? 'BULLISH' : score <= -2 ? 'BEARISH' : 'NEUTRAL';
  const cls = bias.toLowerCase();

  const resultDiv = document.getElementById('gd-bias-result');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `
    <div class="gd-bias-badge ${cls}">
      ${bias === 'BULLISH' ? '↑' : bias === 'BEARISH' ? '↓' : '→'} ${bias}
    </div>
    <div class="gd-conf-wrap">
      <div class="gd-conf-label"><span>Confidence</span><span>${Math.round(conf)}%</span></div>
      <div class="gd-conf-track"><div class="gd-conf-fill" style="width:${conf}%"></div></div>
    </div>
    <div style="font-size:12px;color:var(--t2);margin-top:12px">Macro score: ${score > 0 ? '+' : ''}${score}</div>`;

  _renderGoldExecution(bias, cls, conf);
}

function _renderGoldExecution(bias, cls, conf) {
  const el = document.getElementById('gd-execution-wrap');
  if (!el) return;

  let execHtml = '';
  if (bias === 'BULLISH') {
    execHtml = `
      <div class="gd-exec-row"><div class="gd-exec-icon">📈</div><div><div class="gd-exec-lbl">Entry Zone</div><div class="gd-exec-val">Support cluster — wait for bounce</div></div></div>
      <div class="gd-exec-row"><div class="gd-exec-icon">🛑</div><div><div class="gd-exec-lbl">Stop Loss</div><div class="gd-exec-val">Below entry swing low</div></div></div>
      <div class="gd-exec-row"><div class="gd-exec-icon">🎯</div><div><div class="gd-exec-lbl">Take Profit</div><div class="gd-exec-val">Next resistance | TP1 & TP2</div></div></div>
      <div class="gd-exec-row"><div class="gd-exec-icon">⚡</div><div><div class="gd-exec-lbl">Setup Type</div><div class="gd-exec-val">Trend Continuation (Strong)</div></div></div>`;
  } else if (bias === 'BEARISH') {
    execHtml = `
      <div class="gd-exec-row"><div class="gd-exec-icon">📉</div><div><div class="gd-exec-lbl">Entry Zone</div><div class="gd-exec-val">Resistance cluster — wait for rejection</div></div></div>
      <div class="gd-exec-row"><div class="gd-exec-icon">🛑</div><div><div class="gd-exec-lbl">Stop Loss</div><div class="gd-exec-val">Above entry swing high</div></div></div>
      <div class="gd-exec-row"><div class="gd-exec-icon">🎯</div><div><div class="gd-exec-lbl">Take Profit</div><div class="gd-exec-val">Next support | TP1 & TP2</div></div></div>
      <div class="gd-exec-row"><div class="gd-exec-icon">⚡</div><div><div class="gd-exec-lbl">Setup Type</div><div class="gd-exec-val">Trend Continuation (Strong)</div></div></div>`;
  } else {
    execHtml = `
      <div class="gd-exec-row"><div class="gd-exec-icon">⏸️</div><div><div class="gd-exec-lbl">Recommendation</div><div class="gd-exec-val">No clear bias. Wait for macro clarity or breakout.</div></div></div>`;
  }
  el.innerHTML = execHtml;
}

/* Why Gold Moved */
function runWhyGoldMoved() {
  const dir    = document.getElementById('gd-moved-direction')?.value;
  const driver = document.getElementById('gd-moved-driver')?.value;

  if (!dir || !driver) {
    _toast('Please select both direction and driver.', 'warning');
    return;
  }

  const explanations = {
    rallied: {
      cpi: 'Soft CPI data weakened the USD and increased rate-cut expectations. Gold rallied.',
      nfp: 'Weak NFP triggered USD selloff. Gold surged on safe-haven flows.',
      fomc: 'Dovish Fed signaling cuts. USD dumped, gold rallied strongly.',
      geopolitical: 'Rising geopolitical risk drove safe-haven demand into gold.',
      yields: 'Treasury yields fell. Lower real yields supported gold demand.',
      usd: 'DXY collapsed. Weaker dollar lifted gold prices.'
    },
    'sold-off': {
      cpi: 'Hot CPI crushed rate-cut hopes. Gold dumped on stronger dollar.',
      nfp: 'Strong NFP boosted USD and real yields. Gold sold off.',
      fomc: 'Hawkish Fed outlook pushed gold lower.',
      geopolitical: 'Risk premium unwound. Profit-taking accelerated.',
      yields: 'Real yields spiked. Gold fell sharply.',
      usd: 'DXY surged. Strong dollar triggered liquidation.'
    },
    ranging: {
      cpi: 'CPI in line — no surprise. Gold consolidating.',
      nfp: 'NFP met expectations. Gold awaiting next catalyst.',
      fomc: 'Hold confirmed. Gold choppy pending direction.',
      geopolitical: 'Tensions unchanged. Gold range-bound.',
      yields: 'Yields flat. Gold stuck in range.',
      usd: 'DXY neutral. Gold trading sideways.'
    }
  };

  const explanation = explanations[dir]?.[driver] || 'No explanation available.';
  const resultDiv = document.getElementById('gd-moved-result');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `<div class="gd-moved-box">${explanation}</div>`;
}

/* Gold News Interpreter */
function runGoldNewsInterpreter() {
  const event   = document.getElementById('gd-news-event')?.value;
  const outcome = document.getElementById('gd-news-outcome')?.value;

  if (!event || !outcome) {
    _toast('Please select both event and outcome.', 'warning');
    return;
  }

  const reactions = {
    cpi: {
      better: 'BEARISH: Hot inflation → Fed hikes → gold down',
      worse: 'BULLISH: Soft CPI → rate cuts → gold up',
      inline: 'NEUTRAL'
    },
    nfp: {
      better: 'BEARISH: Strong jobs → USD up → gold down',
      worse: 'BULLISH: Weak jobs → gold up',
      inline: 'NEUTRAL'
    },
    fomc: {
      hike: 'BEARISH: Immediate USD spike',
      hold: 'SLIGHTLY BULLISH: Pause confirmed',
      cut: 'VERY BULLISH: Gold explodes higher'
    },
    employment: {
      better: 'BEARISH',
      worse: 'BULLISH',
      inline: 'NEUTRAL'
    },
    gdp: {
      better: 'BEARISH: Strong growth',
      worse: 'BULLISH: Weak growth',
      inline: 'NEUTRAL'
    }
  };

  const reaction = reactions[event]?.[outcome];
  if (!reaction) { _toast('That combination is not applicable.', 'warning'); return; }

  const resultDiv = document.getElementById('gd-news-result');
  resultDiv.classList.add('show');
  resultDiv.innerHTML = `<strong style="color:var(--gold)">Gold Reaction:</strong> ${reaction}`;
}

/* Gold Sessions */
function _renderGoldSessions() {
  const el = document.getElementById('gd-sessions-wrap');
  if (!el) return;

  const now = new Date();
  const utcHour = now.getUTCHours();
  const sessions = [
    { name: 'Asia (Tokyo)', utcOpen: 0, utcClose: 8, vol: 'Moderate' },
    { name: 'London', utcOpen: 8, utcClose: 16, vol: 'High' },
    { name: 'New York', utcOpen: 13, utcClose: 22, vol: 'High' },
    { name: 'Sydney', utcOpen: 22, utcClose: 6, nextDay: true, vol: 'Low' }
  ];

  let html = '';
  sessions.forEach(s => {
    let isOpen = false;
    if (s.nextDay) isOpen = (utcHour >= s.utcOpen || utcHour < s.utcClose);
    else isOpen = (utcHour >= s.utcOpen && utcHour < s.utcClose);
    const statusClass = isOpen ? 'open' : 'closed';
    const statusText = isOpen ? 'OPEN' : 'CLOSED';
    html += `<div class="gd-session-row">
              <div><span class="gd-session-name">${s.name}</span><div class="gd-session-time">${s.utcOpen}:00 – ${s.utcClose}:00 UTC</div></div>
              <div><span class="gd-session-tag ${statusClass}">${statusText}</span><span class="gd-session-tag hot" style="margin-left:6px">Vol: ${s.vol}</span></div>
            </div>`;
  });
  el.innerHTML = html;

  const advice = document.getElementById('gd-session-advice');
  if (advice) advice.innerHTML = '💡 Best liquidity: London (8:00 UTC) and NY (13:00 UTC)';
}

function _initGoldPage() {
  _renderGoldSessions();
  if (_goldSessionInterval) clearInterval(_goldSessionInterval);
  _goldSessionInterval = setInterval(_renderGoldSessions, 60000);
}

/* ═══════════════════════════════════════════════════════════
   SESSION TIMER
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
    advice    = '✅ London session open — your primary window.';
    adviceCol = '#3d9eff';
  } else if (nyActive) {
    advice    = '🟡 New York session open — moderate opportunity.';
    adviceCol = '#e4ae2a';
  } else if (activeSessions.length) {
    advice    = '⚠️ Asian/Sydney session — low volatility.';
    adviceCol = '#e4ae2a';
  } else {
    advice    = '😴 All sessions closed. Prepare for London open.';
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

function _renderSessionTimer() {
  const el = document.getElementById('session-timer-card');
  if (!el) return;
  el.innerHTML = _buildSessionTimerHTML();
}

function _startSessionTimer() {
  _renderSessionTimer();
  if (_sessionTimerInterval) clearInterval(_sessionTimerInterval);
  _sessionTimerInterval = setInterval(_renderSessionTimer, 30000);
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
      position: 'fixed', top: '70px', left: '50%',
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
   DOM READY
   ═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Risk calculator input listeners
  ['rc-balance','rc-risk','rc-entry','rc-sl','rc-tp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calcRisk);
  });

  // Initialize currency inputs
  _initCurrencyInputs();
  _initWBBInputs();
});