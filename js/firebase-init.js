// ========================================================
// ASCPT - Firebase SDK v12.18.0 Initialization
// Pinned CDN Modules: https://www.gstatic.com/firebasejs/12.18.0/
// ========================================================

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { CLINIC_CONFIG } from './clinic-config.js';

let firebaseApp = null;
let firebaseAuth = null;
let firestoreDb = null;

const cfg = CLINIC_CONFIG.firebase;
const isConfigured = Boolean(cfg && cfg.projectId && cfg.apiKey);

if (isConfigured) {
  try {
    const existingApps = getApps();
    firebaseApp = existingApps.length > 0 ? existingApps[0] : initializeApp(cfg);
    firebaseAuth = getAuth(firebaseApp);
    firestoreDb = getFirestore(firebaseApp);
    console.log('ASCPT Firebase v12.18.0 connected to project:', cfg.projectId);
  } catch (err) {
    console.error('ASCPT Firebase initialization error:', err);
  }
} else {
  console.warn('ASCPT Firebase Notice: Configuration is pending.');
}

export { firebaseApp, firebaseAuth, firestoreDb, isConfigured };
