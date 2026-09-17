// ========================================================
// ASCPT - Unified Push Notifications Serverless Function
// Alexandria Specialized Center for Physical Therapy
// Powered by Firebase Admin SDK (Cloud Messaging & Firestore)
// Designed for Vercel Serverless Functions
// ========================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

function initAdmin() {
  if (getApps().length > 0) {
    const app = getApps()[0];
    return {
      auth: getAuth(app),
      db: getFirestore(app),
      messaging: getMessaging(app)
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
    db: getFirestore(app),
    messaging: getMessaging(app)
  };
}

function normalizeToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return '';
  let t = rawToken.trim();
  if (t.includes('/fcm/send/')) {
    t = t.split('/fcm/send/')[1];
  } else if (t.includes('/gcm/send/')) {
    t = t.split('/gcm/send/')[1];
  }
  return t.trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'طريقة الطلب غير مسموح بها. يجب استخدام POST.'
    });
  }

  try {
    const { auth, db, messaging } = initAdmin();

    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1];
      try {
        await auth.verifyIdToken(idToken);
      } catch (tokenErr) {
        console.warn('Notification Auth Token verification notice:', tokenErr.message);
      }
    }

    const { type, title, body, target, data } = req.body || {};

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'بيانات الإشعار غير مكتملة: يجب تحديد العنوان والنص.'
      });
    }

    const targetType = target || {};
    const recipientUids = new Set();

    // 1. Direct Specific User UIDs (Highest priority)
    if (targetType.recipientUid) {
      recipientUids.add(targetType.recipientUid);
    }

    if (targetType.doctorUid) {
      recipientUids.add(targetType.doctorUid);

      // Also match doctor by UID or Name in users collection
      try {
        const usersSnap = await db.collection('users').where('active', '==', true).get();
        usersSnap.forEach(doc => {
          const u = doc.data();
          if (
            doc.id === targetType.doctorUid ||
            u.uid === targetType.doctorUid ||
            (targetType.doctorName && u.name && u.name.trim() === targetType.doctorName.trim()) ||
            (u.name && targetType.doctorUid.includes(u.name))
          ) {
            recipientUids.add(doc.id);
          }
        });
      } catch (e) {
        console.warn('Doctor recipient resolution notice:', e.message);
      }
    }

    // 2. Role-based fallback (Only if no specific user UID was targeted)
    if (recipientUids.size === 0 && targetType.role) {
      const role = targetType.role;
      let usersQuery = db.collection('users').where('active', '==', true);
      if (role !== 'all') {
        usersQuery = usersQuery.where('role', '==', role);
      }
      const usersSnap = await usersQuery.get();
      usersSnap.forEach(doc => {
        recipientUids.add(doc.id);
      });
    }

    if (recipientUids.size === 0) {
      return res.status(200).json({
        success: true,
        message: 'لا يوجد مستلمون محددون لهذا الإشعار.',
        sentCount: 0
      });
    }

    const targetUidList = Array.from(recipientUids);
    const tokensWithMeta = [];
    const notificationId = 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const nowIso = new Date().toISOString();

    // 3. Save In-App Notifications and Collect FCM Tokens
    const batch = db.batch();

    for (const uid of targetUidList) {
      // In-app notification document
      const notifRef = db.collection('users').doc(uid).collection('notifications').doc(notificationId);
      batch.set(notifRef, {
        id: notificationId,
        type: type || 'general',
        title,
        body,
        data: data || {},
        read: false,
        createdAt: nowIso
      });

      // Fetch user FCM tokens
      try {
        const tokensSnap = await db.collection('users').doc(uid).collection('fcm_tokens').get();
        tokensSnap.forEach(tokenDoc => {
          const tokenData = tokenDoc.data();
          if (tokenData && tokenData.token) {
            const cleanToken = normalizeToken(tokenData.token);
            if (cleanToken) {
              tokensWithMeta.push({
                uid,
                docId: tokenDoc.id,
                cleanToken
              });
            }
          }
        });
      } catch (tokErr) {
        console.warn(`Could not read tokens for user ${uid}:`, tokErr.message);
      }
    }

    await batch.commit();

    if (tokensWithMeta.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'تم حفظ الإشعار في صندوق وارد المستخدمين، ولا توجد أجهزة مسجلة للـ Push.',
        sentCount: 0,
        inAppSaved: targetUidList.length
      });
    }

    // 4. Send Push Notification via Firebase Cloud Messaging Multicast
    const uniqueTokens = Array.from(new Set(tokensWithMeta.map(t => t.cleanToken)));

    const message = {
      tokens: uniqueTokens,
      notification: {
        title,
        body
      },
      data: {
        type: String(type || 'general'),
        title: String(title || ''),
        body: String(body || ''),
        screen: String(data?.screen || ''),
        patientId: String(data?.patientId || ''),
        date: String(data?.date || ''),
        url: String(data?.url || '/')
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          color: '#0284c7',
          priority: 'max',
          defaultSound: true,
          defaultVibrateTimings: true
        }
      },
      webpush: {
        headers: {
          Urgency: 'high'
        },
        notification: {
          title,
          body,
          badge: '/icons/badge-96x96.png',
          dir: 'rtl',
          lang: 'ar',
          tag: String(type || 'ascpt-notification'),
          renotify: true,
          requireInteraction: true,
          vibrate: [500, 200, 500, 200, 500]
        },
        data: {
          screen: String(data?.screen || ''),
          patientId: String(data?.patientId || ''),
          date: String(data?.date || ''),
          url: String(data?.url || '/')
        }
      }
    };

    const response = await messaging.sendEachForMulticast(message);

    // 5. Automatic Stale Token Cleanup
    if (response.failureCount > 0) {
      const deadTokenDocs = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code || '';
          console.warn('FCM token response failure:', errCode, resp.error?.message);
          // Only delete if device token is definitely expired / unregistered
          if (errCode === 'messaging/registration-token-not-registered') {
            const badToken = uniqueTokens[idx];
            tokensWithMeta.filter(t => t.cleanToken === badToken).forEach(t => deadTokenDocs.push(t));
          }
        }
      });

      if (deadTokenDocs.length > 0) {
        const cleanupBatch = db.batch();
        deadTokenDocs.forEach(d => {
          const ref = db.collection('users').doc(d.uid).collection('fcm_tokens').doc(d.docId);
          cleanupBatch.delete(ref);
        });
        await cleanupBatch.commit().catch(e => console.warn('Token cleanup notice:', e.message));
      }
    }

    return res.status(200).json({
      success: true,
      sentCount: response.successCount,
      failureCount: response.failureCount,
      inAppSaved: targetUidList.length
    });
  } catch (error) {
    console.error('ASCPT Push Notification Server Error:', error);
    return res.status(500).json({
      success: false,
      error: 'فشل إرسال الإشعار من السيرفر: ' + (error.message || 'خطأ داخلي')
    });
  }
}
