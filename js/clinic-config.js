// ========================================================
// Alexandria Specialized Center for Physical Therapy (ASCPT)
// Central Clinic Configuration & Production Branding
// ========================================================

export const CLINIC_CONFIG = {
 id: 'ascpt-clinic-pwa',
 brandName: 'مركز الإسكندرية التخصصي للعلاج الطبيعي',
 shortName: 'مركز الإسكندرية التخصصي',
 englishName: 'Alexandria Specialized Center for Physical Therapy',
 abbreviation: 'ASCPT',
 tagline: 'نظام إدارة مراكز وعيادات العلاج الطبيعي',
 version: '1.4.92',
 director: {
  name: 'د. حسني أحمد الجويلي',
  title: 'إستشاري العلاج الطبيعي والتقويم الحركي للعمود الفقري'
 },
 contact: {
  address: '١٧ شارع حسين شيرين - لوران - الإسكندرية',
  phone: '03-5702356',
  email: 'algewelyspinecare@yahoo.com'
 },
 settings: {
  defaultCurrency: 'ج.م',
  allowDoctorDeletePatient: false,
  enableInsuranceClaims: true,
  enableAttendanceCards: true
 },
 // Supabase Cloud PostgreSQL Configuration (Zero-Limit Unlimited Reads)
 supabase: {
  url: "https://wpgjkqlswiszwfyqlujz.supabase.co",
  anonKey: "sb_publishable_uMXZizxCE1H5xyMS8Fwcww_3sES_YaR"
 },
 // Legacy Firebase Configuration (Kept for fallback if needed)
 firebase: {
  apiKey: "AIzaSyBBVMHo-Rya1iFnE-7QEVPKeoBibDgqXKw",
  authDomain: "ascpt-clinic-pwa.firebaseapp.com",
  projectId: "ascpt-clinic-pwa",
  storageBucket: "ascpt-clinic-pwa.firebasestorage.app",
  messagingSenderId: "480756686941",
  appId: "1:480756686941:web:ccd6a8a1f6aeafca5fadb4"
 }
};
