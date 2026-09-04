// ========================================================
// Alexandria Specialized Center for Physical Therapy (ASCPT)
// Central Clinic Configuration & Production Branding
// ========================================================

export const CLINIC_CONFIG = {
  id: 'ascpt-clinic-pwa',
  brandName: 'مركز اسكندرية التخصصي للعلاج الطبيعي',
  shortName: 'مركز اسكندرية التخصصي',
  englishName: 'Alexandria Specialized Center for Physical Therapy',
  abbreviation: 'ASCPT',
  tagline: 'نظام إدارة مراكز وعيادات العلاج الطبيعي والتأهيل الطبي',
  version: '1.1.0',
  contact: {
    address: 'الإسكندرية، جمهورية مصر العربية',
    phone: '',
    email: ''
  },
  settings: {
    defaultCurrency: 'ج.م',
    allowDoctorDeletePatient: false,
    enableInsuranceClaims: true,
    enableAttendanceCards: true
  },
  // Production Firebase Web Client Configuration (Safe for frontend)
  firebase: {
    apiKey: "AIzaSyBBVMHo-Rya1iFnE-7QEVPKeoBibDgqXKw",
    authDomain: "ascpt-clinic-pwa.firebaseapp.com",
    projectId: "ascpt-clinic-pwa",
    storageBucket: "ascpt-clinic-pwa.firebasestorage.app",
    messagingSenderId: "480756686941",
    appId: "1:480756686941:web:ccd6a8a1f6aeafca5fadb4"
  }
};
