// ========================================================
// ASCPT - Admin Staff Management Serverless Function
// Secure backend privileged endpoint using Firebase Admin SDK
// Designed for Vercel Serverless Functions
// Phase 2.7 Security Hardened: Strict Validation, Compensation & Trusted Auditing
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

function mapAuthError(err) {
  const code = err?.code || '';
  const errorMap = {
    'auth/email-already-exists': 'البريد الإلكتروني مسجل مسبقاً لمستخدم آخر.',
    'auth/email-already-in-use': 'البريد الإلكتروني مسجل مسبقاً لمستخدم آخر.',
    'auth/invalid-email': 'صيغة البريد الإلكتروني غير صالحة.',
    'auth/weak-password': 'كلمة السر ضعيفة (يجب ألا تقل عن 6 خانات).',
    'auth/invalid-password': 'كلمة السر المدخلة غير صالحة.',
    'auth/operation-not-allowed': 'إنشاء الحسابات غير مفعل في إعدادات النظام.',
    'auth/too-many-requests': 'تم تجاوز عدد المحاولات المسموح به، يرجى المحاولة لاحقاً.'
  };

  return errorMap[code] || 'حدث خطأ أثناء معالجة حساب المستخدم. يرجى مراجعة البيانات والمحاولة مجدداً.';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // 1. Strict HTTP Method validation
  const allowedMethods = ['POST', 'PATCH', 'DELETE'];
  if (!allowedMethods.includes(req.method)) {
    res.setHeader('Allow', allowedMethods.join(', '));
    return res.status(405).json({ error: 'الطريقة المطلوبة غير مسموح بها (Method Not Allowed).' });
  }

  // 2. Strict Content-Type validation
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return res.status(415).json({ error: 'نوع المحتوى غير مدعوم، يجب إرسال application/json.' });
  }

  // 3. Strict Request Body validation
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'بيانات الطلب غير صالحة (Invalid Request Body).' });
  }

  // 4. Authorization Header & ID Token Verification
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح: رمز التحقق مفقود أو غير صالح.' });
  }

  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) {
    return res.status(401).json({ error: 'غير مصرح: رمز التحقق فارغ.' });
  }

  let adminServices;
  try {
    adminServices = initAdmin();
  } catch (initErr) {
    console.error('Firebase Admin init failure:', initErr.message);
    return res.status(500).json({ error: 'خطأ داخلي في الخادم: لم يتم تهيئة خدمات الربط السحابية.' });
  }

  const { auth: adminAuth, db: firestore } = adminServices;
  let callerUid = null;
  let callerRole = null;
  let callerName = null;

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken, true);
    callerUid = decodedToken.uid;

    const callerDoc = await firestore.collection('users').doc(callerUid).get();
    if (!callerDoc.exists) {
      return res.status(403).json({ error: 'محظور: ملف المستخدم صاحب الطلب غير مسجل في قاعدة البيانات.' });
    }

    const callerData = callerDoc.data();
    callerRole = callerData?.role;
    callerName = callerData?.name || 'مدير المركز';

    // Strict Fail-Closed: caller MUST be an active admin
    if (callerRole !== 'admin' || callerData?.active !== true) {
      return res.status(403).json({ error: 'محظور: يتطلب هذا الإجراء صلاحيات مدير المركز النشط.' });
    }
  } catch (authErr) {
    console.error('Caller authentication failure:', authErr.message);
    return res.status(401).json({ error: 'غير مصرح: رمز التحقق منتهي أو غير صالح.' });
  }

  // ================= POST: Create Staff User (Doctor or Receptionist ONLY) =================
  if (req.method === 'POST') {
    const { name, email, password, role, shift, regularSessionRate, specialSessionRate } = req.body;

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

    // Role enforcement: strictly doctor or receptionist. Admin creation from client endpoint is FORBIDDEN.
    const allowedStaffRoles = ['doctor', 'receptionist'];
    if (!role || !allowedStaffRoles.includes(role)) {
      if (role === 'admin') {
        return res.status(400).json({ error: 'إنشاء حسابات المديرين غير متاح عبر هذه الواجهة.' });
      }
      return res.status(400).json({ error: 'الدور المحدد غير صالح، متاح فقط: طبيب معالج أو سكرتارية.' });
    }

    let createdUserRecord = null;

    try {
      // 1. Create user in Firebase Authentication
      createdUserRecord = await adminAuth.createUser({
        email: email.trim().toLowerCase(),
        password,
        displayName: name.trim()
      });

      let doctorShift = null;
      let regRate = null;
      let specRate = null;
      if (role === 'doctor') {
        const allowedShifts = ['sat_mon_wed', 'sun_tue_thu', 'all'];
        doctorShift = (shift && allowedShifts.includes(shift)) ? shift : 'sat_mon_wed';
        regRate = Math.max(0, parseFloat(regularSessionRate) || 0);
        specRate = Math.max(0, parseFloat(specialSessionRate) || 0);
      }

      const userDocData = {
        uid: createdUserRecord.uid,
        id: createdUserRecord.uid,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        shift: doctorShift,
        regularSessionRate: regRate,
        specialSessionRate: specRate,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
        createdByName: callerName
      };

      const shiftDesc = role === 'doctor' ? ` (شفت: ${doctorShift === 'sat_mon_wed' ? 'السبت/الاثنين/الأربعاء' : doctorShift === 'sun_tue_thu' ? 'الأحد/الثلاثاء/الخميس' : 'طوال الأسبوع'})` : '';
      const auditLogData = {
        actionType: 'إنشاء حساب موظف',
        description: `تم إنشاء حساب جديد للموظف: ${name.trim()} بدور: ${role}${shiftDesc} (${email.trim().toLowerCase()})`,
        userId: callerUid,
        userName: callerName,
        userRole: 'admin',
        targetUid: createdUserRecord.uid,
        targetEmail: email.trim().toLowerCase(),
        timestamp: new Date().toISOString(),
        timestampRaw: Date.now()
      };

      // 2. Write to Firestore profile & Audit Log with atomicity/compensation
      try {
        await firestore.collection('users').doc(createdUserRecord.uid).set(userDocData);
        await firestore.collection('audit_logs').add(auditLogData);
      } catch (dbErr) {
        console.error('CRITICAL: Firestore profile write failed for UID:', createdUserRecord.uid, dbErr);
        // Rollback: delete the newly created Auth user so no orphaned auth user exists
        try {
          await adminAuth.deleteUser(createdUserRecord.uid);
          console.log('Rollback successful: Deleted orphaned Auth user UID:', createdUserRecord.uid);
        } catch (rbErr) {
          console.error('CRITICAL ROLLBACK FAILURE: Failed to delete orphaned Auth user UID:', createdUserRecord.uid, rbErr);
        }
        return res.status(500).json({
          error: 'فشل حفظ ملف الموظف في قاعدة البيانات وتم التراجع عن العملية.'
        });
      }

      return res.status(201).json({
        success: true,
        user: {
          uid: createdUserRecord.uid,
          id: createdUserRecord.uid,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role,
          shift: doctorShift,
          regularSessionRate: regRate,
          specialSessionRate: specRate,
          active: true
        }
      });
    } catch (createErr) {
      console.error('Staff creation error:', createErr);
      return res.status(400).json({
        error: mapAuthError(createErr)
      });
    }
  }

  // ================= PATCH: Update Status or Reset Password =================
  if (req.method === 'PATCH') {
    const { targetUid, active, password, shift, regularSessionRate, specialSessionRate } = req.body;

    if ('role' in req.body) {
      return res.status(400).json({ error: 'تعديل الأدوار والصلاحيات غير مسموح به عبر هذه الواجهة.' });
    }

    if (!targetUid || typeof targetUid !== 'string' || targetUid.trim().length === 0) {
      return res.status(400).json({ error: 'معرف المستخدم المستهدف مطلوب.' });
    }

    if (targetUid === callerUid && active === false) {
      return res.status(400).json({ error: 'لا يمكن لمدير المركز تعطيل حسابه الشخصي.' });
    }

    try {
      const targetDoc = await firestore.collection('users').doc(targetUid).get();
      if (!targetDoc.exists) {
        return res.status(404).json({ error: 'الموظف المستهدف غير موجود في قاعدة البيانات.' });
      }

      const targetData = targetDoc.data();
      if (targetData?.role === 'admin' && active === false) {
        return res.status(400).json({ error: 'لا يمكن تعطيل حسابات المديرين من هذه الواجهة.' });
      }

      // 1. Password Reset by Admin
      if (password !== undefined) {
        if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
          return res.status(400).json({ error: 'كلمة السر الجديدة يجب أن تكون بين 6 و 128 خانة.' });
        }
        await adminAuth.updateUser(targetUid, { password });
        await firestore.collection('audit_logs').add({
          actionType: 'تغيير كلمة المرور',
          description: `قام المدير بإعادة تعيين كلمة مرور الموظف: ${targetData.name || targetUid} (UID: ${targetUid})`,
          userId: callerUid,
          userName: callerName,
          userRole: 'admin',
          targetUid,
          timestamp: new Date().toISOString(),
          timestampRaw: Date.now()
        });
        return res.status(200).json({ success: true, targetUid, passwordReset: true });
      }

      // 2. Doctor Settings Update (Shift & Session Rates)
      if (shift !== undefined || regularSessionRate !== undefined || specialSessionRate !== undefined) {
        if (targetData?.role !== 'doctor') {
          return res.status(400).json({ error: 'تعديل الشفت وأسعار الجلسات متاح فقط للأطباء المعالجين.' });
        }

        const updates = {
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: callerUid
        };
        const auditParts = [];

        if (shift !== undefined) {
          const allowedShifts = ['sat_mon_wed', 'sun_tue_thu', 'all'];
          if (!allowedShifts.includes(shift)) {
            return res.status(400).json({ error: 'قيمة الشفت غير صالحة.' });
          }
          updates.shift = shift;
          const shiftLabels = {
            'sat_mon_wed': 'السبت / الاثنين / الأربعاء',
            'sun_tue_thu': 'الأحد / الثلاثاء / الخميس',
            'all': 'طوال أيام الأسبوع'
          };
          auditParts.push(`الشفت: ${shiftLabels[shift]}`);
        }

        if (regularSessionRate !== undefined) {
          const rRate = Math.max(0, parseFloat(regularSessionRate) || 0);
          updates.regularSessionRate = rRate;
          auditParts.push(`سعر العادية: ${rRate} ج.م`);
        }

        if (specialSessionRate !== undefined) {
          const sRate = Math.max(0, parseFloat(specialSessionRate) || 0);
          updates.specialSessionRate = sRate;
          auditParts.push(`سعر الخاصة: ${sRate} ج.م`);
        }

        await firestore.collection('users').doc(targetUid).update(updates);

        await firestore.collection('audit_logs').add({
          actionType: 'تعديل إعدادات الطبيب المعالج',
          description: `قام المدير بتعديل بيانات الطبيب: ${targetData.name || targetUid} (${auditParts.join(' • ')}) [UID: ${targetUid}]`,
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
          shift: updates.shift !== undefined ? updates.shift : targetData.shift,
          regularSessionRate: updates.regularSessionRate !== undefined ? updates.regularSessionRate : targetData.regularSessionRate,
          specialSessionRate: updates.specialSessionRate !== undefined ? updates.specialSessionRate : targetData.specialSessionRate
        });
      }

      if (typeof active !== 'boolean') {
        return res.status(400).json({ error: 'حالة الحساب يجب أن تكون قيمة منطقية (true أو false).' });
      }

      const prevActive = targetData?.active !== false;

      // 2. Update Auth disabled state
      await adminAuth.updateUser(targetUid, { disabled: !active });

      // 2. Update Firestore with compensation
      try {
        await firestore.collection('users').doc(targetUid).update({
          active,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: callerUid
        });

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
      } catch (fsUpdateErr) {
        console.error('Firestore active update failed, compensating Auth state:', fsUpdateErr);
        try {
          await adminAuth.updateUser(targetUid, { disabled: !prevActive });
        } catch (rbErr) {
          console.error('CRITICAL: Compensation failed for Auth state:', rbErr);
        }
        return res.status(500).json({ error: 'فشل تحديث حالة الحساب في قاعدة البيانات وتم التراجع.' });
      }

      return res.status(200).json({ success: true, targetUid, active });
    } catch (patchErr) {
      console.error('Staff status update error:', patchErr);
      return res.status(400).json({ error: 'فشل تحديث حالة الحساب، يرجى المحاولة لاحقاً.' });
    }
  }

  // ================= DELETE: Completely Remove Staff Account =================
  if (req.method === 'DELETE') {
    const { targetUid } = req.body || {};

    if (!targetUid || typeof targetUid !== 'string' || targetUid.trim().length === 0) {
      return res.status(400).json({ error: 'معرف المستخدم المستهدف مطلوب.' });
    }

    if (targetUid === callerUid) {
      return res.status(400).json({ error: 'لا يمكن لمدير المركز حذف حسابه الشخصي.' });
    }

    try {
      const targetDoc = await firestore.collection('users').doc(targetUid).get();
      if (!targetDoc.exists) {
        return res.status(404).json({ error: 'الموظف المستهدف غير موجود في قاعدة البيانات.' });
      }

      const targetData = targetDoc.data();
      if (targetData?.role === 'admin') {
        return res.status(400).json({ error: 'لا يمكن حذف حسابات مديري المركز من هذه الواجهة.' });
      }

      // 1. Delete from Firebase Authentication
      try {
        await adminAuth.deleteUser(targetUid);
      } catch (authDelErr) {
        console.warn('Auth deletion notice (user might already be removed from Auth):', authDelErr.message);
      }

      // 2. Delete from Cloud Firestore
      await firestore.collection('users').doc(targetUid).delete();

      // 3. Write trusted server-side Audit Log
      await firestore.collection('audit_logs').add({
        actionType: 'حذف موظف',
        description: `قام المدير بحذف حساب الموظف: ${targetData.name || targetUid} نهائياً من النظام (UID: ${targetUid})`,
        userId: callerUid,
        userName: callerName,
        userRole: 'admin',
        targetUid,
        timestamp: new Date().toISOString(),
        timestampRaw: Date.now()
      });

      return res.status(200).json({ success: true, targetUid });
    } catch (delErr) {
      console.error('Delete staff error:', delErr);
      return res.status(500).json({ error: 'فشل حذف الموظف من النظام.' });
    }
  }
}
