// ========================================================
// ASCPT - Firebase SDK v12.18.0 Initialization
// Pinned CDN Modules: https://www.gstatic.com/firebasejs/12.18.0/
// Offline-First Persistent Cache Architecture
// ========================================================

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
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

    try {
      firestoreDb = initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      });
      console.log('ASCPT Cloud Firestore v12.18.0 initialized with Multi-tab Persistent Cache.');
    } catch (cacheErr) {
      console.warn('Persistent cache fallback to getFirestore:', cacheErr.message);
      firestoreDb = getFirestore(firebaseApp);
    }
  } catch (err) {
    console.error('ASCPT Firebase initialization error:', err);
  }
} else {
  console.warn('ASCPT Firebase Notice: Configuration is pending.');
}

export { firebaseApp, firebaseAuth, firestoreDb, isConfigured };
