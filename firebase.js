/* firebase.js — TES Pro
   ─────────────────────────────────────────────────────────
   Original Firebase config and auth: UNCHANGED.
   Added below: Paystack key + pricing constants used by app.js
   ───────────────────────────────────────────────────────── */

// ── Firebase config (original, untouched) ─────────────────
var firebaseConfig = {
  apiKey:            'AIzaSyDD057lBgAKAelh3tWZsGtK0OMYzqq50dQ',
  authDomain:        'trading-web-app-d3959.firebaseapp.com',
  projectId:         'trading-web-app-d3959',
  storageBucket:     'trading-web-app-d3959.appspot.com',
  messagingSenderId: '277574845686',
  appId:             '1:277574845686:web:116ec8d94076c1060858d7'
};

// ── Firebase init (original, untouched) ───────────────────
var FIREBASE_CONFIGURED = false;
var _auth = null;
var _db   = null;
var _storage = null;  // [CLOUD STORAGE]

try {
  firebase.initializeApp(firebaseConfig);
  _auth = firebase.auth();
  _db   = firebase.firestore();
  _storage = firebase.storage();  // [CLOUD STORAGE] Firebase Storage
  FIREBASE_CONFIGURED = true;
  console.log('[TES] Firebase initialized');
} catch (e) {
  console.warn('[TES] Firebase init error:', e);
}

// ── Owner bypass (original, untouched) ────────────────────
function isOwner(email) {
  return email === 'salimmarafa12@gmail.com';
}

/* ─────────────────────────────────────────────────────────
   NEW CONSTANTS — used by app.js for payments and pricing.
   Edit here; the UI updates automatically everywhere.
   ───────────────────────────────────────────────────────── */

// Paystack public key.
// pk_test_ → payment simulated (no real charge).
// pk_live_ → real Paystack popup charges the user.
// var (not const) — prevents duplicate-declaration crash if SW serves stale cache
var PAYSTACK_PUBLIC_KEY = 'pk_live_8d79f78162dd7b1d408256843ae5fe3643ab96d8';

// NGN exchange rate. Adjust as rates change.
var USD_TO_NGN = 1400;

// Plan prices in USD. Drives locked screen display + kobo calculation.
var PLAN_PRICES_USD = {
  monthly: 5,
  annual:  30
};
