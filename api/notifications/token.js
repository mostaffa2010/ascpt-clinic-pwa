// ========================================================
// ASCPT - Notification Token & Subscription Serverless Endpoint
// Alexandria Specialized Center for Physical Therapy
// Privileged endpoint using Firebase Admin SDK
// Designed for Vercel Serverless Functions
// ========================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function initAdmin() {
  if (getApps().length > 0) {
    const app = getApps()[0];
    return {
      auth: getAuth(app),
      db: getFirestore(app)
    };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Server Configuration Error: Missing Firebase Admin environment variables.');
  }

  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const app = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey
    })
  });

  return {
    auth: getAuth(app),
    db: getFirestore(app)
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const { db } = initAdmin();

    // GET /api/notifications/token?uid=... -> List recent notifications (fallback if client Firestore blocked)
    if (req.method === 'GET') {
      const uid = req.query.uid;
      if (!uid) {
        return res.status(400).json({ success: false, error: 'المعرف uid مطلوب.' });
      }

      const notifSnap = await db.collection('users').doc(uid).collection('notifications')
        .orderBy('createdAt', 'desc')
        .limit(30)
        .get();

      const notifs = notifSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json({
        success: true,
        notifications: notifs
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'طريقة الطلب غير مسموح بها.' });
    }

    const { action, uid, token, role, name, userAgent } = req.body || {};

    if (!uid) {
      return res.status(400).json({ success: false, error: 'المعرف uid مطلوب.' });
    }

    // ACTION: register token
    if (action === 'register') {
      if (!token) {
        return res.status(400).json({ success: false, error: 'رمز الجهاز token مطلوب للتسجيل.' });
      }

      const tokenKey = Buffer.from(token.slice(-32)).toString('base64').replace(/[/+=]/g, '_');
      const tokenRef = db.collection('users').doc(uid).collection('fcm_tokens').doc(tokenKey);

      await tokenRef.set({
        token,
        role: role || 'staff',
        name: name || '',
        updatedAt: FieldValue.serverTimestamp(),
        deviceInfo: (userAgent || '').slice(0, 100)
      }, { merge: true });

      // Create welcome notification if this is user's first time
      const welcomeId = 'notif_welcome_' + uid;
      const welcomeRef = db.collection('users').doc(uid).collection('notifications').doc(welcomeId);
      const existingWelcome = await welcomeRef.get();
      if (!existingWelcome.exists) {
        await welcomeRef.set({
          id: welcomeId,
          type: 'system',
          title: 'تم تفعيل الإشعارات الفورية بنجاح!',
          body: 'ستصلك هنا وعلى هاتفك تنبيهات حضور المرضى والمواعيد وتسليم العهدة.',
          read: false,
          createdAt: new Date().toISOString()
        });
      }

      return res.status(200).json({
        success: true,
        message: 'تم تسجيل الجهاز وتفعيل الإشعارات بنجاح.'
      });
    }

    // ACTION: unregister token
    if (action === 'unregister') {
      if (token) {
        const tokenKey = Buffer.from(token.slice(-32)).toString('base64').replace(/[/+=]/g, '_');
        await db.collection('users').doc(uid).collection('fcm_tokens').doc(tokenKey).delete();
      }
      return res.status(200).json({
        success: true,
        message: 'تم إلغاء تسجيل الجهاز.'
      });
    }

    // ACTION: mark_all_read
    if (action === 'mark_all_read') {
      const snap = await db.collection('users').doc(uid).collection('notifications').where('read', '==', false).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.forEach(doc => {
          batch.update(doc.ref, { read: true });
        });
        await batch.commit();
      }
      return res.status(200).json({
        success: true,
        message: 'تم تحديد كافة الإشعارات كمقروءة.'
      });
    }

    return res.status(400).json({ success: false, error: 'الإجراء المطلوب غير معروف.' });
  } catch (err) {
    console.error('Notification Token Server Endpoint Error:', err);
    return res.status(500).json({
      success: false,
      error: 'فشل معالجة رمز الإشعارات: ' + (err.message || 'خطأ داخلي')
    });
  }
}
