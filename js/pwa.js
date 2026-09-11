// ========================================================
// ASCPT - PWA Network Status Manager
// ========================================================

export class PWAManager {
  static init() {
    // مراقبة حالة الاتصال بالإنترنت
    const updateOnlineStatus = () => {
      const isOnline = navigator.onLine;
      const dot = document.getElementById('net-status-dot');
      if (dot) {
        dot.className = isOnline ? 'status-dot' : 'status-dot offline';
        dot.title = isOnline ? 'متصل بالإنترنت' : 'وضع غير متصل';
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
