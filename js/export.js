// ========================================================
// ASCPT - Export & Wi-Fi Printing Module (Daily & Monthly)
// ========================================================

import { CLINIC_CONFIG } from './clinic-config.js';
import { db } from './db.js';

/**
 * Sanitizes a value for safe inclusion inside a quoted CSV field:
 * escapes embedded double-quotes and neutralizes a leading
 * =, +, -, or @ so spreadsheet apps (Excel/Sheets) never treat
 * exported patient/staff-entered text as a formula.
 */
function csvSafe(value) {
  let str = String(value ?? '');
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  return str.replace(/"/g, '""');
}

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
      btnPrint.addEventListener('click', () => this.printReport());
    }

    // Auto-sync responsive print tiers and modes on beforeprint
    window.addEventListener('beforeprint', () => {
      if (document.body.classList.contains('printing-sheet') || 
          document.body.classList.contains('printing-claim') ||
          document.body.classList.contains('printing-cards') ||
          document.body.classList.contains('printing-insurance-letter') ||
          document.body.classList.contains('printing-receipt') ||
          document.body.classList.contains('printing-statement')) {
        return;
      }
      this.syncPrintClasses();
    });

    window.addEventListener('afterprint', () => {
      document.body.classList.remove(
        'printing-monthly',
        'finance-monthly-mode',
        'printing-daily',
        'finance-daily-mode',
        'print-daily-spacious',
        'print-daily-compact',
        'print-daily-multipage'
      );
    });
  }

  syncPrintClasses() {
    const meta = this.financeManager ? this.financeManager.getDataForExport() : { mode: 'daily' };
    if (meta.mode === 'monthly') {
      document.body.classList.add('printing-monthly', 'finance-monthly-mode');
      document.body.classList.remove('printing-daily', 'finance-daily-mode', 'print-daily-spacious', 'print-daily-compact', 'print-daily-multipage');
    } else {
      document.body.classList.remove('printing-monthly', 'finance-monthly-mode');
      document.body.classList.add('printing-daily', 'finance-daily-mode');

      const rows = document.querySelectorAll('#finance-report-tbody tr');
      let sessionCount = 0;
      if (rows.length > 0) {
        const firstTd = rows[0].querySelector('td');
        if (rows.length === 1 && firstTd && firstTd.getAttribute('colspan')) {
          sessionCount = 0;
        } else {
          sessionCount = rows.length;
        }
      }

      document.body.classList.remove('print-daily-spacious', 'print-daily-compact', 'print-daily-multipage');
      if (sessionCount <= 22) {
        document.body.classList.add('print-daily-spacious');
      } else if (sessionCount <= 35) {
        document.body.classList.add('print-daily-compact');
      } else {
        document.body.classList.add('print-daily-multipage');
      }
    }
  }

  async exportToExcel() {
    const meta = this.financeManager.getDataForExport();
    if (meta.mode === 'monthly') {
      await this.exportMonthlyExcel(meta.month);
    } else {
      await this.exportDailyExcel(meta.date);
    }
  }

  // ================= 1. DAILY EXCEL EXPORT =================
  async exportDailyExcel(dateStr) {
    try {
      const allSessions = await db.getSessions(dateStr);
      const allExpenses = await db.getExpenses(dateStr);
      const allSettlements = (typeof db.getInsuranceSettlements === 'function') ? await db.getInsuranceSettlements(dateStr, null) : [];

      const totalSessionsCash = allSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
      const cashSettlements = allSettlements.filter(s => s.paymentMethod === 'cash').reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
      const bankSettlements = allSettlements.filter(s => s.paymentMethod !== 'cash').reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
      const totalDrawerCash = totalSessionsCash + cashSettlements;
      const totalExp = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
      const netCash = totalDrawerCash - totalExp;

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
          { 'البيان': 'إيرادات الجلسات النقدية', 'القيمة': `${totalSessionsCash} ج.م` },
          { 'البيان': 'تحصيلات التأمين النقدية بالدرج', 'القيمة': `${cashSettlements} ج.م` },
          { 'البيان': 'تحصيلات التأمين البنكية', 'القيمة': `${bankSettlements} ج.م` },
          { 'البيان': 'إجمالي المقبوضات النقدية بالدرج', 'القيمة': `${totalDrawerCash} ج.م` },
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

        if (allSettlements && allSettlements.length > 0) {
          const settlementsData = allSettlements.map((s, idx) => ({
            'م': idx + 1,
            'شركة التأمين': s.companyName,
            'فترة المطالبة': s.claimPeriod,
            'المبلغ الأصلي': s.grossAmount,
            'الاستقطاعات والخصومات': s.deductions,
            'سبب الخصم': s.deductionReason,
            'الصافي المحصل': s.netAmount,
            'طريقة الاستلام': s.paymentMethod === 'cash' ? 'نقداً بالدرج' : 'تحويل بنكي / شيك',
            'رقم المعاملة / الشيك': s.referenceNumber || '-',
            'المسؤول': s.recordedBy
          }));
          const wsSet = XLSX.utils.json_to_sheet(settlementsData);
          XLSX.utils.book_append_sheet(wb, wsSet, 'تحصيلات التأمين');
        }

        XLSX.writeFile(wb, `تقرير_${CLINIC_CONFIG.abbreviation}_اليومي_${dateStr}.xlsx`);
        this.app.showToast('تم تصدير تقرير اليوم بنجاح');
        return;
      }

      // ب. Fallback CSV بترميز عربي
      let csv = '\uFEFF';
      csv += `${CLINIC_CONFIG.brandName} (${CLINIC_CONFIG.abbreviation}) - التقرير اليومي: ${dateStr}\r\n\r\n`;
      csv += `إجمالي المرضى: ${allSessions.length}, إيرادات: ${totalDrawerCash} ج.م, مصروفات: ${totalExp} ج.م, صافي الدرج: ${netCash} ج.م\r\n\r\n`;
      csv += 'م,اسم المريض,الطبيب المعالج,نظام الحساب,شركة التأمين,نوع التعاقد,الأعضاء المعالجة,المبلغ المسدد (ج.م),المسؤول,الوقت\r\n';

      allSessions.forEach((s, idx) => {
        const parts = Array.isArray(s.bodyParts) ? s.bodyParts.join(' - ') : '';
        const contract = s.contractType === 'direct' ? 'مباشر' : (s.contractType === 'indirect' ? 'غير مباشر' : '-');
        csv += `${idx + 1},"${csvSafe(s.patientName)}","${csvSafe(s.doctor)}",${s.payType === 'cash' ? 'نقدي' : 'تأمين'},"${csvSafe(s.insuranceName || '-')}","${csvSafe(contract)}","${csvSafe(parts)}",${s.amountPaid},"${csvSafe(s.recordedBy)}","${csvSafe(s.recordedAt)}"\r\n`;
      });

      this.downloadCSV(csv, `تقرير_${CLINIC_CONFIG.abbreviation}_اليومي_${dateStr}.csv`);
    } catch (err) {
      console.error('Export error:', err);
      this.app.showAlert('تعذر تصدير التقرير: ' + err.message, 'خطأ', 'danger');
    }
  }

  // ================= 2. MONTHLY EXCEL EXPORT =================
  async exportMonthlyExcel(monthStr) {
    try {
      const rawSessions = await db.getSessions(monthStr);
      const allSessions = (rawSessions || []).filter(s => s.status !== 'cancelled' && !s.isHomeVisit && s.visitType !== 'home');
      const allExpenses = await db.getExpenses(monthStr);
      const allSettlements = (typeof db.getInsuranceSettlements === 'function') ? await db.getInsuranceSettlements(null, monthStr) : [];
      const doctors = await db.getDoctors();
      const docList = (typeof db.getDoctorsList === 'function') ? await db.getDoctorsList(true) : [];
      const allPatients = (typeof db.getPatients === 'function') ? await db.getPatients() : [];
      const patientMap = new Map();
      allPatients.forEach(p => {
        if (p.id) patientMap.set(p.id, p);
        if (p.name) patientMap.set(p.name.trim(), p);
      });

      const totalPatients = allSessions.length;
      const totalSessionsIncome = allSessions.reduce((acc, curr) => acc + (parseFloat(curr.amountPaid) || 0), 0);
      const totalSettlementsNet = allSettlements.reduce((acc, s) => acc + (parseFloat(s.netAmount) || 0), 0);
      const totalIncome = totalSessionsIncome + totalSettlementsNet;
      const totalExp = allExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0) + totalDoctorsSalaries;
      const netCash = totalIncome - totalExp;

      const cashCount = allSessions.filter(s => s.payType === 'cash').length;
      const insCount = allSessions.filter(s => s.payType === 'insurance').length;

      // بيانات إحصائية ورواتب الأطباء
      const doctorsData = doctors.map((doc, idx) => {
        const docObj = docList.find(d =>
          (d.name && d.name.trim() === doc.trim()) ||
          (d.name && (d.name.includes(doc) || doc.includes(d.name)))
        );
        const docSessions = allSessions.filter(s => s.doctor === doc || (docObj && s.doctorUid === docObj.uid));
        const sessionsCount = docSessions.filter(s => s.entryType !== 'examination').reduce((acc, s) => acc + (s.bodyPartsCount || 1), 0);
        const examsCount = docSessions.filter(s => s.entryType === 'examination').length;

        const cashPatients = (new Set(docSessions.filter(s => s.payType === 'cash').map(s => s.patientId || s.patientName))).size;
        const insPatients = (new Set(docSessions.filter(s => s.payType !== 'cash').map(s => s.patientId || s.patientName))).size;

        let regCount = 0, scolCount = 0, hemiCount = 0, quadCount = 0, specCount = 0;
        docSessions.forEach(s => {
          if (s.entryType === 'examination') return;
          const count = s.bodyPartsCount || 1;
          const patient = patientMap.get(s.patientId) || patientMap.get((s.patientName || '').trim());
          let pType = (s.sessionPricingType || s.programType || '').toLowerCase().trim();

          if (!pType || pType === 'regular') {
            if (patient) {
              const pProg = (patient.programType || patient.clinicalSheet?.programType || '').toLowerCase().trim();
              if (pProg && pProg !== 'regular') pType = pProg;
            }
          }

          if (!pType || pType === 'regular') {
            const diag = ((patient?.clinicalSheet?.diagnosis || '') + ' ' + (patient?.affectedArea || '') + ' ' + (s.notes || '')).toLowerCase();
            if (diag.includes('scoliosis') || diag.includes('اعوجاج') || diag.includes('جنف')) pType = 'scoliosis';
            else if (diag.includes('hemiplegia') || diag.includes('شلل نصفي') || diag.includes('جلطة')) pType = 'hemiplegia';
            else if (diag.includes('quadriplegia') || diag.includes('pediatric') || diag.includes('شلل رباعي') || diag.includes('أطفال') || diag.includes('ضمور')) pType = 'quadriplegia';
          }

          if (pType === 'pediatric') pType = 'quadriplegia';

          if (pType === 'scoliosis') scolCount += count;
          else if (pType === 'hemiplegia') hemiCount += count;
          else if (pType === 'quadriplegia') quadCount += count;
          else if (pType === 'special' || pType === 'custom_special') specCount += count;
          else regCount += count;
        });

        const regRate = (docObj && typeof docObj.regularSessionRate === 'number') ? docObj.regularSessionRate : 0;
        const scolRate = (docObj && typeof docObj.scoliosisRate === 'number') ? docObj.scoliosisRate : 0;
        const hemiRate = (docObj && typeof docObj.hemiplegiaRate === 'number') ? docObj.hemiplegiaRate : 0;
        const quadRate = (docObj && typeof docObj.quadriplegiaRate === 'number') ? docObj.quadriplegiaRate : ((docObj && typeof docObj.pediatricRate === 'number') ? docObj.pediatricRate : 0);
        const specRate = (docObj && typeof docObj.specialSessionRate === 'number') ? docObj.specialSessionRate : 0;

        const totalSalary = (regCount * regRate) + (scolCount * scolRate) + (hemiCount * hemiRate) + (quadCount * quadRate) + (specCount * specRate);

        return {
          'م': idx + 1,
          'الطبيب المعالج': doc,
          'جلسات / كشوفات': `${sessionsCount} / ${examsCount}`,
          'مرضى (نقدي / شركات)': `${cashPatients} / ${insPatients}`,
          'نوع الجلسات (عادية / scoliosis / hemiplegia / quadriplegia)': `${regCount + specCount} / ${scolCount} / ${hemiCount} / ${quadCount}`,
          'راتب الاطباء (ج.م)': totalSalary
        };
      });

      const totalDoctorsSalaries = doctorsData.reduce((acc, d) => acc + (parseFloat(d['راتب الاطباء (ج.م)']) || 0), 0);
      if (doctorsData.length > 0) {
        doctorsData.push({
          'م': 'المجموع',
          'الطبيب المعالج': 'مجموع رواتب الاطباء',
          'جلسات / كشوفات': '-',
          'مرضى (نقدي / شركات)': '-',
          'نوع الجلسات (عادية / scoliosis / hemiplegia / quadriplegia)': '-',
          'راتب الاطباء (ج.م)': totalDoctorsSalaries
        });
      }

      // بيانات جلسات التأمين والنقدي
      let totalCashSessions = 0;
      let totalInsSessions = 0;
      allSessions.forEach(s => {
        const count = (s.entryType === 'examination') ? 1 : (s.bodyPartsCount || 1);
        if (s.payType === 'cash') totalCashSessions += count;
        else totalInsSessions += count;
      });

      const insuranceData = [
        { 'نوع الجلسة': 'عدد جلسات النقدي', 'عدد الجلسات': totalCashSessions },
        { 'نوع الجلسة': 'عدد جلسات التأمين', 'عدد الجلسات': totalInsSessions }
      ];

      // بيانات المصروفات
      const expensesData = allExpenses.map((e, idx) => ({
        'م': idx + 1,
        'التاريخ': e.date || '-',
        'بند المصروف': e.title,
        'المبلغ (ج.م)': e.amount,
        'المسؤول عن الصرف': e.recordedBy || '-'
      }));

      if (totalDoctorsSalaries > 0) {
        expensesData.unshift({
          'م': 1,
          'التاريخ': monthStr,
          'بند المصروف': 'إجمالي راتب الاطباء',
          'المبلغ (ج.م)': totalDoctorsSalaries,
          'المسؤول عن الصرف': 'إدارة المركز'
        });
        expensesData.forEach((e, i) => { e['م'] = i + 1; });
      }

      if (typeof XLSX !== 'undefined') {
        const wb = XLSX.utils.book_new();

        // 1. ملخص الشهر
        const summaryData = [
          { 'البيان': 'شهر التقرير', 'القيمة': monthStr },
          { 'البيان': 'إجمالي عدد المرضى المترددين خلال الشهر', 'القيمة': totalPatients },
          { 'البيان': 'عدد المرضى المسددين نقداً', 'القيمة': `${cashCount} (${totalPatients > 0 ? ((cashCount/totalPatients)*100).toFixed(1) : 0}%)` },
          { 'البيان': 'عدد مرضى شركات التأمين', 'القيمة': `${insCount} (${totalPatients > 0 ? ((insCount/totalPatients)*100).toFixed(1) : 0}%)` },
          { 'البيان': 'إيرادات الجلسات النقدية للمركز', 'القيمة': `${totalSessionsIncome} ج.م` },
          { 'البيان': 'صافي تحصيلات مطالبات التأمين', 'القيمة': `${totalSettlementsNet} ج.م` },
          { 'البيان': 'إجمالي الإيرادات الكلية للمركز', 'القيمة': `${totalIncome} ج.م` },
          { 'البيان': 'إجمالي المصروفات المنصرفة', 'القيمة': `${totalExp} ج.م` },
          { 'البيان': 'صافي الأرباح للشهر', 'القيمة': `${netCash} ج.م` }
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

        // 5. تحصيلات التأمين
        if (allSettlements && allSettlements.length > 0) {
          const settlementsData = allSettlements.map((s, idx) => ({
            'م': idx + 1,
            'تاريخ التحصيل': s.settlementDate,
            'شركة التأمين': s.companyName,
            'فترة المطالبة': s.claimPeriod,
            'المبلغ الأصلي': s.grossAmount,
            'الاستقطاعات والخصومات': s.deductions,
            'سبب الخصم': s.deductionReason,
            'الصافي المحصل': s.netAmount,
            'طريقة الاستلام': s.paymentMethod === 'cash' ? 'نقداً بالدرج' : 'تحويل بنكي / شيك',
            'رقم المعاملة / الشيك': s.referenceNumber || '-',
            'المسؤول': s.recordedBy
          }));
          const wsSet = XLSX.utils.json_to_sheet(settlementsData);
          XLSX.utils.book_append_sheet(wb, wsSet, 'تحصيلات التأمين للشهر');
        }

        XLSX.writeFile(wb, `تقرير_${CLINIC_CONFIG.abbreviation}_الشهري_${monthStr}.xlsx`);
        this.app.showToast('تم تصدير التقرير الشهري بنجاح');
        return;
      }

      // Fallback CSV
      let csv = '\uFEFF';
      csv += `${CLINIC_CONFIG.brandName} (${CLINIC_CONFIG.abbreviation}) - التقرير الشهري: ${monthStr}\r\n\r\n`;
      csv += `إجمالي مرضى الشهر,${totalPatients},نقدي,${cashCount},تأمين,${insCount},إيرادات,${totalIncome} ج.م,مصروفات,${totalExp} ج.م,صافي الأرباح,${netCash} ج.م\r\n\r\n`;
      csv += 'إحصائية الأطباء الشهرية:\r\nم,الطبيب المعالج,مرضى نقدي,مرضى شركات تأمين,إجمالي الحالات,عدد الجلسات المحتسبة,النسبة\r\n';
      doctorsData.forEach(d => {
        csv += `${d['م']},"${csvSafe(d['الطبيب المعالج'])}",${d['مرضى نقدي']},${d['مرضى شركات تأمين']},${d['إجمالي الحالات']},${d['عدد الجلسات المحتسبة']},${d['النسبة من إجمالي المركز']}\r\n`;
      });
      csv += '\r\nتوزيع جهات التأمين والنقدي:\r\nم,الجهة,نوع التعاقد,عدد الحالات,النسبة\r\n';
      insuranceData.forEach(i => {
        csv += `${i['م']},"${csvSafe(i['جهة السداد / شركة التأمين'])}","${csvSafe(i['نوع التعاقد'])}",${i['عدد الحالات في الشهر']},${i['النسبة المئوية']}\r\n`;
      });

      this.downloadCSV(csv, `تقرير_${CLINIC_CONFIG.abbreviation}_الشهري_${monthStr}.csv`);
    } catch (err) {
      console.error('Export error:', err);
      this.app.showAlert('تعذر تصدير التقرير الشهري: ' + err.message, 'خطأ', 'danger');
    }
  }

  downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.app.showToast('تم تصدير الملف بنجاح');
  }

  printReport() {
    try {
      const toast = document.getElementById('toast-notification');
      if (toast) {
        toast.classList.remove('show');
        toast.style.display = 'none';
      }

      // If user is on the claims tab inside finance, delegate directly to claims print
      const claimsContent = document.getElementById('finance-claims-content');
      if (claimsContent && claimsContent.style.display !== 'none' && this.app?.claimsManager) {
        this.app.claimsManager.printClaimStatement();
        return;
      }

      this.syncPrintClasses();
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
      setTimeout(() => {
        document.body.classList.remove(
          'printing-monthly',
          'finance-monthly-mode',
          'printing-daily',
          'finance-daily-mode',
          'print-daily-spacious',
          'print-daily-compact',
          'print-daily-multipage'
        );
      }, 3000);
    } catch (err) {
      console.error('Print trigger error:', err);
      window.print();
    }
  }
}
