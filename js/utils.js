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
