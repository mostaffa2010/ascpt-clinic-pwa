// ========================================================
// Alexandria Specialized Center for Physical Therapy (ASCPT)
// Central Clinic Configuration & Branding
// ========================================================

export const CLINIC_CONFIG = {
  id: 'ascpt-alex',
  brandName: 'مركز اسكندرية التخصصي للعلاج الطبيعي',
  shortName: 'مركز اسكندرية التخصصي',
  englishName: 'Alexandria Specialized Center for Physical Therapy',
  abbreviation: 'ASCPT',
  tagline: 'نظام إدارة مراكز وعيادات العلاج الطبيعي والتأهيل الطبي',
  version: '1.0.0',
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
  // Firebase Web Client Configuration (Safe for frontend - no private keys)
  firebase: (typeof window !== 'undefined' && window.__FIREBASE_CONFIG__) || {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  }
};
