// ========================================================
// PhysioFlow - Common Security & Formatting Utilities
// ========================================================

/**
 * Escapes unsafe characters in a string before inserting into innerHTML
 * to prevent Cross-Site Scripting (XSS) injection.
 * @param {*} str - input string or value
 * @returns {string} escaped safe string
 */
export function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Returns a date as a local YYYY-MM-DD string using the device's
 * local timezone (e.g. Africa/Cairo, UTC+2), NOT UTC.
 *
 * Do NOT use `date.toISOString().split('T')[0]` for "today"/"this
 * session's date" logic: toISOString() always converts to UTC first,
 * so between local midnight and ~2-3 AM (Cairo time) it silently
 * returns YESTERDAY's date instead of today's. That mismatch can
 * misattribute a late-night session or the daily cash report to the
 * wrong calendar day.
 * @param {Date} [date=new Date()] - defaults to right now
 * @returns {string} local date in YYYY-MM-DD format
 */
export function getLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Renders the trigger box summary, badge, and removable tags for a picker field.
 */
export function updatePickerTriggerDisplay({
  summaryId,
  subId,
  countBadgeId,
  tagsContainerId,
  selectedItems = [],
  placeholder = 'اضغط للاختيار...',
  emptySub = 'لم يتم تحديد أي عنصر',
  unitName = 'عناصر',
  icon = 'fa-solid fa-tag',
  onRemove
}) {
  const summaryEl = document.getElementById(summaryId);
  const subEl = document.getElementById(subId);
  const countBadgeEl = document.getElementById(countBadgeId);
  const tagsContainer = document.getElementById(tagsContainerId);

  const items = Array.isArray(selectedItems) ? selectedItems : (selectedItems ? [selectedItems] : []);
  const count = items.length;

  if (count === 0) {
    if (summaryEl) summaryEl.textContent = placeholder;
    if (subEl) subEl.textContent = emptySub;
    if (countBadgeEl) countBadgeEl.textContent = `0 ${unitName}`;
    if (tagsContainer) tagsContainer.innerHTML = '';
    return;
  }

  if (summaryEl) {
    summaryEl.textContent = items.slice(0, 3).join('، ') + (count > 3 ? ` ... (+${count - 3})` : '');
  }
  if (subEl) {
    subEl.textContent = `تم تحديد ${count} ${unitName}`;
  }
  if (countBadgeEl) {
    countBadgeEl.textContent = `${count} ${unitName}`;
  }

  if (tagsContainer) {
    tagsContainer.innerHTML = items.map(item => `
      <span class="selected-pill">
        <i class="${icon}"></i>
        <span>${escapeHTML(item)}</span>
        <button type="button" data-remove-item="${escapeHTML(item)}" title="إلغاء">&times;</button>
      </span>
    `).join('');

    tagsContainer.querySelectorAll('[data-remove-item]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itm = btn.getAttribute('data-remove-item');
        if (typeof onRemove === 'function') onRemove(itm);
      });
    });
  }
}
