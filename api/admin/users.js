// ========================================================
// ASCPT - Admin Staff Management Serverless Function
// Secure backend privileged endpoint using Firebase Admin SDK
// Designed for Vercel Serverless Functions
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

  // Support escaped newlines in Vercel environment variables
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

function mapAuthError(err) {
  const code = err?.code || '';
  const errorMap = {
    'auth/email-already-exists': 'البريد الإلكتروني مسجل مسبقاً لمستخدم آخر.',
    'auth/invalid-email': 'صيغة البريد الإلكتروني غير صالحة.',
    'auth/weak-password': 'كلمة السر ضعيفة (يجب ألا تقل عن 6 خانات).',
    'auth/invalid-password': 'كلمة السر المدخلة غير صالحة.',
    'auth/operation-not-allowed': 'إنشاء الحسابات غير مفعل في إعدادات النظام.',
    'auth/too-many-requests': 'تم تجاوز عدد المحاولات المسموح به، يرجى المحاولة لاحقاً.'
  };

  return errorMap[code] || 'حدث خطأ أثناء معالجة حساب المستخدم. يرجى مراجعة البيانات والمحاولة مجدداً.';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // 1. Strict HTTP Method enforcement
  if (req.method !== 'POST' && req.method !== 'PATCH') {
    return res.status(405).json({ error: 'الطريقة المطلوبة غير مسموح بها (Method Not Allowed).' });
  }

  // 2. Strict Content-Type enforcement
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return res.status(415).json({ error: 'نوع المحتوى غير مدعوم، يجب إرسال application/json.' });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'بيانات الطلب غير صالحة (Invalid Request Body).' });
  }

  // 3. Authenticate caller via Firebase ID Token
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح: رمز التحقق مفقود أو غير صالح.' });
  }

  const idToken = authHeader.split('Bearer ')[1].trim();
  let adminServices;
  try {
    adminServices = initAdmin();
  } catch (initErr) {
    console.error('Firebase Admin init failure:', initErr.message);
    return res.status(500).json({ error: 'خطأ داخلي في الخادم: لم يتم تهيئة خدمات الربط بنجاح.' });
  }

  const { auth: adminAuth, db: firestore } = adminServices;
  let callerUid = null;
  let callerRole = null;
  let callerName = null;

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    callerUid = decodedToken.uid;

    const callerDoc = await firestore.collection('users').doc(callerUid).get();
    if (!callerDoc.exists) {
      return res.status(403).json({ error: 'محظور: ملف المستخدم صاحب الطلب غير مسجل.' });
    }

    const callerData = callerDoc.data();
    callerRole = callerData.role;
    callerName = callerData.name || 'مدير المركز';

    if (callerRole !== 'admin' || callerData.active === false) {
      return res.status(403).json({ error: 'محظور: يتطلب هذا الإجراء صلاحيات مدير المركز.' });
    }
  } catch (authErr) {
    console.error('Caller authentication failure:', authErr.message);
    return res.status(401).json({ error: 'غير مصرح: رمز التحقق منتهي أو غير صالح.' });
  }

  // ================= Handle POST: Create Staff User (Doctor / Receptionist ONLY) =================
  if (req.method === 'POST') {
    const { name, email, password, role } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: 'اسم الموظف مطلوب ويجب أن يكون بين 2 و 100 حرف.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صحيحة.' });
    }

    if (!password || typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: 'كلمة السر يجب أن تكون بين 6 و 128 خانة.' });
    }

    // Explicitly forbid creating "admin" accounts from this endpoint
    const validRoles = ['doctor', 'receptionist'];
    if (!role || !validRoles.includes(role)) {
      if (role === 'admin') {
        return res.status(400).json({ error: 'إنشاء حسابات المديرين غير متاح عبر هذه الواجهة.' });
      }
      return res.status(400).json({ error: 'الدور المحدد غير صالح، متاح فقط: طبيب معالج أو سكرتارية.' });
    }

    let createdAuthUser = null;

    try {
      // 1. Create User in Firebase Auth
      createdAuthUser = await adminAuth.createUser({
        email: email.trim().toLowerCase(),
        password,
        displayName: name.trim()
      });

      // 2. Prepare Firestore document
      const userDocData = {
        uid: createdAuthUser.uid,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
        createdByName: callerName
      };

      const auditLogData = {
        actionType: 'إنشاء حساب موظف',
        description: `تم إنشاء حساب جديد للموظف: ${name.trim()} بدور: ${role} (${email.trim().toLowerCase()})`,
        userId: callerUid,
        userName: callerName,
        userRole: 'admin',
        targetUid: createdAuthUser.uid,
        targetEmail: email.trim().toLowerCase(),
        timestamp: new Date().toISOString(),
        timestampRaw: Date.now()
      };

      // 3. Attempt Firestore writes
      try {
        await firestore.collection('users').doc(createdAuthUser.uid).set(userDocData);
        await firestore.collection('audit_logs').add(auditLogData);
      } catch (dbErr) {
        console.error('CRITICAL: Firestore profile write failed for UID:', createdAuthUser.uid, dbErr);

        // Rollback: Attempt to delete the created Auth user
        try {
          await adminAuth.deleteUser(createdAuthUser.uid);
          console.log('Rollback succeeded: Deleted orphaned Auth user UID:', createdAuthUser.uid);
        } catch (rollbackErr) {
          console.error('CRITICAL ROLLBACK FAILURE: Could not delete orphaned Auth user UID:', createdAuthUser.uid, rollbackErr);
        }

        return res.status(500).json({
          error: 'فشل حفظ ملف الموظف في قاعدة البيانات وتم التراجع عن العملية.'
        });
      }

      return res.status(201).json({
        success: true,
        user: {
          uid: createdAuthUser.uid,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role,
          active: true
        }
      });
    } catch (createErr) {
      console.error('Staff Auth creation error:', createErr);
      return res.status(400).json({
        error: mapAuthError(createErr)
      });
    }
  }

  // ================= Handle PATCH: Update Staff Status (Active / Disabled ONLY) =================
  if (req.method === 'PATCH') {
    const { targetUid, active } = req.body;

    // Strict rejection if any role alteration is attempted
    if ('role' in req.body) {
      return res.status(400).json({ error: 'تعديل الصلاحيات والأدوار غير مسموح به عبر هذه الواجهة.' });
    }

    if (!targetUid || typeof targetUid !== 'string' || targetUid.trim().length === 0) {
      return res.status(400).json({ error: 'معرف المستخدم المستهدف (targetUid) مطلوب.' });
    }

    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'حالة الحساب (active) يجب أن تكون قيمة منطقية (true أو false).' });
    }

    // Do not allow current Admin to deactivate their own account
    if (targetUid === callerUid && active === false) {
      return res.status(400).json({ error: 'لا يمكن لمدير المركز تعطيل حسابه الشخصي.' });
    }

    try {
      // Validate target user exists in Firestore
      const targetDoc = await firestore.collection('users').doc(targetUid).get();
      if (!targetDoc.exists) {
        return res.status(404).json({ error: 'الموظف المستهدف غير موجود في قاعدة البيانات.' });
      }

      const targetData = targetDoc.data();

      // Forbid deactivating another Admin
      if (targetData.role === 'admin' && active === false) {
        return res.status(400).json({ error: 'لا يمكن تعطيل حسابات المديرين من هذه الواجهة.' });
      }

      // 1. Update Firebase Auth status
      await adminAuth.updateUser(targetUid, {
        disabled: !active
      });

      // 2. Update Firestore user document
      await firestore.collection('users').doc(targetUid).update({
        active,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: callerUid
      });

      // 3. Write Audit Log
      await firestore.collection('audit_logs').add({
        actionType: active ? 'تفعيل حساب موظف' : 'تعطيل حساب موظف',
        description: `تم ${active ? 'تفعيل' : 'تعطيل'} حساب الموظف: ${targetData.name || targetUid} (UID: ${targetUid})`,
        userId: callerUid,
        userName: callerName,
        userRole: 'admin',
        targetUid,
        timestamp: new Date().toISOString(),
        timestampRaw: Date.now()
      });

      return res.status(200).json({
        success: true,
        targetUid,
        active
      });
    } catch (patchErr) {
      console.error('Staff status update error:', patchErr);
      return res.status(400).json({ error: 'فشل تحديث حالة الحساب، يرجى المحاولة لاحقاً.' });
    }
  }
}
