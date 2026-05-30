/* ═══════════════════════════════════════════════════════════════
   FIREBASE CONFIGURATION FILE
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// Firebase config - these match your project
var firebaseConfig = {
  apiKey: 'AIzaSyDD057lBgAKAelh3tWZsGtK0OMYzqq50dQ',
  authDomain: 'trading-web-app-d3959.firebaseapp.com',
  projectId: 'trading-web-app-d3959',
  storageBucket: 'trading-web-app-d3959.appspot.com',
  messagingSenderId: '277574845686',
  appId: '1:277574845686:web:116ec8d94076c1060858d7'
};

// Initialize Firebase (this will be called by app.js)
if (typeof firebase !== 'undefined') {
  try {
    firebase.initializeApp(firebaseConfig);
    console.log('[Firebase] Initialized successfully');
  } catch (e) {
    console.warn('[Firebase] Already initialized or error:', e.message);
  }
}

// Paystack public key
var PAYSTACK_PUBLIC_KEY = 'pk_live_8d79f78162dd7b1d408256843ae5fe3643ab96d8';

// USD to NGN conversion rate
var USD_TO_NGN = 1500;

// Subscription pricing in USD
var PLAN_PRICES_USD = {
  monthly: 5,
  annual: 30
};

// Helper: Check if user is owner
function isOwner(email) {
  return email === 'salimmarafa12@gmail.com';
}

console.log('[Firebase Config] Loaded');
