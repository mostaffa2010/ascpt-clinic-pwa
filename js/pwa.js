// ========================================================
// ASCPT - PWA Network Status Manager
// ========================================================

export class PWAManager {
  static init() {
    // مراقبة حالة الاتصال بالإنترنت
    let previousState = navigator.onLine;
    const updateOnlineStatus = () => {
      const isOnline = navigator.onLine;
      const dot = document.getElementById('net-status-dot');
      if (dot) {
        dot.className = isOnline ? 'status-dot' : 'status-dot offline';
        dot.title = isOnline ? 'متصل بالإنترنت' : 'وضع غير متصل (البيانات تحفظ محلياً)';
      }
      if (previousState !== isOnline) {
        previousState = isOnline;
        if (!isOnline) {
          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast('وضع غير متصل بالإنترنت — البيانات تُحفظ محلياً بأمان', 'warning');
          }
        } else {
          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast('تم استعادة الاتصال بالإنترنت بنجاح', 'success');
          }
        }
      }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // دعم زر التثبيت المباشر للـ PWA
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      console.log('PWA install prompt ready.');
    });
  }
}
