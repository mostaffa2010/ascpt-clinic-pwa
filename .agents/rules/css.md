---
glob: "**/*.css"
---

# CSS Architecture & Quality Rules

## 1. Strict Protection of `css/print.css`
- **Read-Only / Protected Asset:** `css/print.css` is strictly read-only and immutable.
- **SHA-256 Integrity Verification:** Any agent operating on CSS must ensure that `css/print.css` remains completely untouched (SHA-256 baseline: `024af17f2f20e3088d3d8bf15885f199df73ad7854b8298d7b174fa24d3badc9`).
- **No Unapproved Modifications:** Never alter, refactor, or delete print styles or selectors without explicit written approval and verified print preview testing before and after.

## 2. Zero `!important` Rule
- **Clean Specificity Baseline:** Exactly zero instances of `!important` are permitted in any new or modified CSS.
- Maintain flat specificity through proper cascading order, CSS variables, and scoped class names.

## 3. Flat Design Tokens
- **Single Source of Truth:** `css/design-tokens.css` is the sole source of truth for all design tokens (colors, border-radii, spacing, shadows, and typography).
- **Direct Token Usage:** Use CSS custom properties defined in `css/design-tokens.css` directly. Avoid hardcoding hex colors, inline pixel dimensions, or duplicating token values.

## 4. Theme Contract Integrity
- Maintain theme contract integrity across light and dark modes.
- Preserve consistent variable bindings and component-level tokens across modular stylesheets (`css/components/*.css`, `css/views/*.css`).
- Never introduce new inline `style="..."` attributes in HTML markup.
