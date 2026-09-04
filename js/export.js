// ========================================================
// ASCPT - Export & Wi-Fi Printing Module (Daily & Monthly)
// ========================================================

import { db } from './db.js';

export class ExportManager {
  constructor(app, financeManager) {
    this.app = app;
    this.financeManager = financeManager;
  }

  init() {
    const btnExcel = document.getElementById('btn-export-excel');
    if (btnExcel) {
      btnExcel.addEventListener('click', () => this.exportToExcel());
    }

        const btnPrint = document.getElementById('btn-print-report');
    if (btnPrint) {
      btnPrint.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btnPrint.disabled) return;
        this.printReport();
      };
    }
  }

  async exportToExcel() {
    const btnExcel = document.getElementById('btn-export-excel');
    try {
      if (btnExcel) {
        btnExcel.disabled = true;
        btnExcel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري التصدير...</span>';
      }

      const meta = this.financeManager.getDataForExport();
      if (meta.mode === 'monthly') {
        await this.exportMonthlyExcel(meta.month);
      } else {
        await this.exportDailyExcel(meta.date);
      }
    } catch (err) {
      console.error('Export excel error:', err);
      this.app.showAlert('حدث خطأ أثناء تصدير ملف الإكسيل: ' + err.message, 'خطأ');
    } finally {
      if (btnExcel) {
        btnExcel.disabled = false;
        btnExcel.innerHTML = '<i class="fa-solid fa-file-excel"></i> <span>تصدير Excel</span>';
      }
    }
  }

  // ================= 1. DAILY EXCEL EXPORT =================
  async exportDailyExcel(dateStr) {
    try {
      const allSessions = await db.getSessions(dateStr);
      const allExpenses = await db.getExpenses(dateStr);

      const totalCash = allSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
      const totalExp = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
      const netCash = totalCash - totalExp;

      // أ. استخدام SheetJS إن وُجدت
      if (typeof XLSX !== 'undefined') {
        const sessionsData = allSessions.map((s, idx) => ({
          'م': idx + 1,
          'اسم المريض': s.patientName,
          'الطبيب المعالج': s.doctor,
          'نظام الحساب': s.payType === 'cash' ? 'نقدي' : 'تأمين',
          'شركة التأمين': s.insuranceName || '-',
          'نوع التعاقد': s.payType === 'insurance' ? (s.contractType === 'direct' ? 'مباشر' : 'غير مباشر') : '-',
          'عدد الأعضاء': s.bodyPartsCount || (Array.isArray(s.bodyParts) ? s.bodyParts.length : 1),
          'الأعضاء المعالجة': Array.isArray(s.bodyParts) ? s.bodyParts.join('، ') : '',
          'المبلغ المقبوض (ج.م)': s.amountPaid,
          'مسجل الجلسة': s.recordedBy,
          'الوقت': s.recordedAt
        }));

        const expensesData = allExpenses.map((e, idx) => ({
          'م': idx + 1,
          'بند المصروف': e.title,
          'المبلغ (ج.م)': e.amount,
          'المسؤول عن الصرف': e.recordedBy,
          'الوقت': e.time
        }));

        const summaryData = [
          { 'البيان': 'تاريخ التقرير اليومي', 'القيمة': dateStr },
          { 'البيان': 'إجمالي عدد المرضى المترددين', 'القيمة': allSessions.length },
          { 'البيان': 'إجمالي الإيرادات النقدية', 'القيمة': `${totalCash} ج.م` },
          { 'البيان': 'إجمالي المصروفات', 'القيمة': `${totalExp} ج.م` },
          { 'البيان': 'صافي النقدية بالدرج', 'القيمة': `${netCash} ج.م` }
        ];

        const docCounts = {};
        allSessions.forEach(s => { docCounts[s.doctor] = (docCounts[s.doctor] || 0) + 1; });
        Object.keys(docCounts).forEach(doc => {
          summaryData.push({ 'البيان': `مرضى ${doc}`, 'القيمة': `${docCounts[doc]} مريض` });
        });

        const wb = XLSX.utils.book_new();
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص اليوم');

        const wsSessions = XLSX.utils.json_to_sheet(sessionsData.length ? sessionsData : [{ 'تنبيه': 'لا توجد جلسات مسجلة اليوم' }]);
        XLSX.utils.book_append_sheet(wb, wsSessions, 'بيان المرضى والجلسات');

        const wsExpenses = XLSX.utils.json_to_sheet(expensesData.length ? expensesData : [{ 'تنبيه': 'لا توجد مصروفات' }]);
        XLSX.utils.book_append_sheet(wb, wsExpenses, 'المصروفات');

        XLSX.writeFile(wb, `تقرير_PhysioFlow_اليومي_${dateStr}.xlsx`);
        this.app.showToast('تم تصدير تقرير اليوم (Excel) بنجاح');
        return;
      }

      // ب. Fallback CSV بترميز عربي
      let csv = '\uFEFF';
      csv += `نظام PhysioFlow لإدارة مراكز العلاج الطبيعي - التقرير اليومي: ${dateStr}\r\n\r\n`;
      csv += `إجمالي المرضى: ${allSessions.length}, إيرادات: ${totalCash} ج.م, مصروفات: ${totalExp} ج.م, صافي الدرج: ${netCash} ج.م\r\n\r\n`;
      csv += 'م,اسم المريض,الطبيب المعالج,نظام الحساب,شركة التأمين,نوع التعاقد,الأعضاء المعالجة,المبلغ المسدد (ج.م),المسؤول,الوقت\r\n';

      allSessions.forEach((s, idx) => {
        const parts = Array.isArray(s.bodyParts) ? s.bodyParts.join(' - ') : '';
        const contract = s.contractType === 'direct' ? 'مباشر' : (s.contractType === 'indirect' ? 'غير مباشر' : '-');
        csv += `${idx + 1},"${s.patientName}","${s.doctor}",${s.payType === 'cash' ? 'نقدي' : 'تأمين'},"${s.insuranceName || '-'}","${contract}","${parts}",${s.amountPaid},"${s.recordedBy}","${s.recordedAt}"\r\n`;
      });

      this.downloadCSV(csv, `تقرير_PhysioFlow_اليومي_${dateStr}.csv`);
    } catch (err) {
      console.error('Export error:', err);
      this.app.showAlert('تعذر تصدير التقرير: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= 2. MONTHLY EXCEL EXPORT =================
  async exportMonthlyExcel(monthStr) {
    try {
      const allSessions = await db.getSessions(monthStr);
      const allExpenses = await db.getExpenses(monthStr);
      const doctors = await db.getDoctors();

      const totalPatients = allSessions.length;
      const totalCash = allSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
      const totalExp = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
      const netCash = totalCash - totalExp;

      const cashCount = allSessions.filter(s => s.payType === 'cash').length;
      const insCount = allSessions.filter(s => s.payType === 'insurance').length;

      // بيانات إحصائية الأطباء
      const doctorsData = doctors.map((doc, idx) => {
        const docSessions = allSessions.filter(s => s.doctor === doc);
        const docCash = docSessions.filter(s => s.payType === 'cash').length;
        const docIns = docSessions.filter(s => s.payType === 'insurance').length;
        const total = docSessions.length;
        const pct = totalPatients > 0 ? ((total / totalPatients) * 100).toFixed(1) + '%' : '0%';

        return {
          'م': idx + 1,
          'الطبيب المعالج': doc,
          'مرضى نقدي': docCash,
          'مرضى شركات تأمين': docIns,
          'إجمالي الحالات': total,
          'النسبة من إجمالي المركز': pct
        };
      });

      // بيانات شركات التأمين والنقدي
      const catMap = {};
      allSessions.forEach(s => {
        const key = s.payType === 'cash' ? 'نقدي (Cash)' : (s.insuranceName || 'شركة تأمين');
        const type = s.payType === 'cash' ? 'نقدي مباشر' : (s.contractType === 'direct' ? 'تعاقد مباشر' : 'تعاقد غير مباشر');
        if (!catMap[key]) catMap[key] = { name: key, type, count: 0 };
        catMap[key].count++;
      });

      const insuranceData = Object.values(catMap).map((item, idx) => ({
        'م': idx + 1,
        'جهة السداد / شركة التأمين': item.name,
        'نوع التعاقد': item.type,
        'عدد الحالات في الشهر': item.count,
        'النسبة المئوية': totalPatients > 0 ? ((item.count / totalPatients) * 100).toFixed(1) + '%' : '0%'
      }));

      // بيانات المصروفات
      const expensesData = allExpenses.map((e, idx) => ({
        'م': idx + 1,
        'التاريخ': e.date || '-',
        'بند المصروف': e.title,
        'المبلغ (ج.م)': e.amount,
        'المسؤول عن الصرف': e.recordedBy || '-'
      }));

      if (typeof XLSX !== 'undefined') {
        const wb = XLSX.utils.book_new();

        // 1. ملخص الشهر
        const summaryData = [
          { 'البيان': 'شهر التقرير', 'القيمة': monthStr },
          { 'البيان': 'إجمالي عدد المرضى المترددين خلال الشهر', 'القيمة': totalPatients },
          { 'البيان': 'عدد المرضى المسددين نقداً', 'القيمة': `${cashCount} (${totalPatients > 0 ? ((cashCount/totalPatients)*100).toFixed(1) : 0}%)` },
          { 'البيان': 'عدد مرضى شركات التأمين', 'القيمة': `${insCount} (${totalPatients > 0 ? ((insCount/totalPatients)*100).toFixed(1) : 0}%)` },
          { 'البيان': 'إجمالي الإيرادات النقدية للمركز', 'القيمة': `${totalCash} ج.م` },
          { 'البيان': 'إجمالي المصروفات المنصرفة', 'القيمة': `${totalExp} ج.م` },
          { 'البيان': 'صافي الأرباح / النقدية بالدرج', 'القيمة': `${netCash} ج.م` }
        ];
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص الشهر والأرباح');

        // 2. أداء الأطباء
        const wsDocs = XLSX.utils.json_to_sheet(doctorsData.length ? doctorsData : [{ 'تنبيه': 'لا توجد بيانات' }]);
        XLSX.utils.book_append_sheet(wb, wsDocs, 'إحصائية الأطباء');

        // 3. جهات التأمين
        const wsIns = XLSX.utils.json_to_sheet(insuranceData.length ? insuranceData : [{ 'تنبيه': 'لا توجد بيانات' }]);
        XLSX.utils.book_append_sheet(wb, wsIns, 'توزيع جهات التأمين');

        // 4. المصروفات
        const wsExp = XLSX.utils.json_to_sheet(expensesData.length ? expensesData : [{ 'تنبيه': 'لا توجد مصروفات' }]);
        XLSX.utils.book_append_sheet(wb, wsExp, 'سجل المصروفات');

        XLSX.writeFile(wb, `تقرير_PhysioFlow_الشهري_${monthStr}.xlsx`);
        this.app.showToast('تم تصدير التقرير الشهري (Excel) بنجاح');
        return;
      }

      // Fallback CSV
      let csv = '\uFEFF';
      csv += `نظام PhysioFlow لإدارة مراكز العلاج الطبيعي - التقرير الشهري: ${monthStr}\r\n\r\n`;
      csv += `إجمالي مرضى الشهر,${totalPatients},نقدي,${cashCount},تأمين,${insCount},إيرادات,${totalCash} ج.م,مصروفات,${totalExp} ج.م,صافي الأرباح,${netCash} ج.م\r\n\r\n`;
      csv += 'إحصائية الأطباء الشهرية:\r\nم,الطبيب المعالج,مرضى نقدي,مرضى شركات تأمين,إجمالي الحالات,النسبة\r\n';
      doctorsData.forEach(d => {
        csv += `${d['م']},"${d['الطبيب المعالج']}",${d['مرضى نقدي']},${d['مرضى شركات تأمين']},${d['إجمالي الحالات']},${d['النسبة من إجمالي المركز']}\r\n`;
      });
      csv += '\r\nتوزيع جهات التأمين والنقدي:\r\nم,الجهة,نوع التعاقد,عدد الحالات,النسبة\r\n';
      insuranceData.forEach(i => {
        csv += `${i['م']},"${i['جهة السداد / شركة التأمين']}","${i['نوع التعاقد']}",${i['عدد الحالات في الشهر']},${i['النسبة المئوية']}\r\n`;
      });

      this.downloadCSV(csv, `تقرير_PhysioFlow_الشهري_${monthStr}.csv`);
    } catch (err) {
      console.error('Export error:', err);
      this.app.showAlert('تعذر تصدير التقرير الشهري: ' + err.message, 'خطأ', 'danger');
    }
  }

  downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      try {
        if (document.body.contains(a)) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {}
    }, 60000);

    this.app.showToast('تم تصدير الملف (Excel CSV) بنجاح');
  }

  printReport() {
    try {
      const meta = this.financeManager.getDataForExport();
      const metaEl = document.getElementById('print-report-meta');
      const subEl = document.getElementById('print-report-subtitle');
      const now = new Date().toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });

      if (meta.mode === 'monthly') {
        if (subEl) subEl.textContent = `التقرير المالي والإحصائي الشهري - شهر (${meta.month})`;
        if (metaEl) metaEl.textContent = `شهر: ${meta.month} | تاريخ ووقت الطباعة: ${new Date().toLocaleDateString('ar-EG-u-nu-latn')} ${now}`;
      } else {
        if (subEl) subEl.textContent = 'تقرير إيرادات وحركات الجلسات اليومية';
        if (metaEl) metaEl.textContent = `تاريخ اليوم: ${meta.date} | وقت الطباعة: ${now}`;
      }

      if (this.app && this.app.currentView !== 'finance') {
        this.app.switchView('finance');
      }

      // إطلاق أمر الطباعة
      window.print();
    } catch (err) {
      console.error('Print trigger error:', err);
    }
  }
}
