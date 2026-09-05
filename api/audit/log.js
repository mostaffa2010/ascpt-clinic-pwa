// ========================================================
// ASCPT - Trusted Serverless Audit Logging Endpoint
// Securely records critical operations with verified server context
// ========================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function initAdmin() {
  if (getApps().length > 0) {
    return {
      auth: getAuth(),
      db: getFirestore()
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
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'طريقة غير مسموح بها (Method Not Allowed).' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'رمز التحقق مفقود.' });
  }

  const idToken = authHeader.split('Bearer ')[1].trim();

  let adminServices;
  try {
    adminServices = initAdmin();
  } catch (err) {
    return res.status(500).json({ error: 'خطأ داخلي في الخادم.' });
  }

  const { auth: adminAuth, db: firestore } = adminServices;

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken, true);
    const callerUid = decodedToken.uid;

    const callerDoc = await firestore.collection('users').doc(callerUid).get();
    if (!callerDoc.exists) {
      return res.status(403).json({ error: 'ملف المستخدم غير مسجل.' });
    }

    const callerData = callerDoc.data();
    if (callerData.active === false) {
      return res.status(403).json({ error: 'الحساب معطل.' });
    }

    const { actionType, description, targetType, targetId } = req.body || {};
    if (!actionType || typeof actionType !== 'string') {
      return res.status(400).json({ error: 'نوع الإجراء مطلوب.' });
    }

    const logEntry = {
      actionType: actionType.trim(),
      description: String(description || '').trim(),
      targetType: String(targetType || '').trim(),
      targetId: String(targetId || '').trim(),
      userId: callerUid,
      userName: callerData.name || decodedToken.email || 'مستخدم',
      userRole: callerData.role || 'staff',
      timestamp: new Date().toLocaleString('ar-EG-u-nu-latn'),
      timestampRaw: Date.now(),
      serverTimestamp: FieldValue.serverTimestamp()
    };

    const docRef = await firestore.collection('audit_logs').add(logEntry);

    return res.status(201).json({ success: true, id: docRef.id });
  } catch (err) {
    console.error('Audit log API failure:', err);
    return res.status(500).json({ error: 'فشل تسجيل العملية في سجل الرقابة.' });
  }
}
