# Test Checklist

This checklist is intended for manual validation after changes to detection, classification, or CSS emission logic.

---

## 1. Basic smoke test

- [ ] Userscript installs correctly in Tampermonkey / Violentmonkey.
- [ ] Script runs without syntax errors.
- [ ] Debug logging appears in DevTools console when `CONFIG.debug = true`.
- [ ] Override `<style>` element is created.
- [ ] No obvious page breakage occurs on a generic site.
- [ ] Browser fixture page opens from `http://localhost`.
- [ ] Required browser fixture checks pass.

---

## 2. CSS custom property override

### Goal
Verify that pure font-family custom properties are detected and overridden.

- [ ] Site uses CSS variables such as `--font-mono`, `--font-sans`, `--fontStack-*`, etc.
- [ ] Script detects the variables.
- [ ] Script overrides only font-family-like custom properties.
- [ ] The emitted CSS contains overrides under `:root, html, body`.
- [ ] If variables were originally defined on another selector, emitted CSS also contains selector-specific overrides.
- [ ] Visual font change is actually applied.

### Example checks
- [ ] Variable defined on `:root`
- [ ] Variable defined on `body`
- [ ] Variable defined on app container / theme scope

---

## 3. Variable indirection / alias resolution

### Goal
Verify that simple `var(--...)` chains are resolved correctly.

- [ ] Direct alias works:
  - `--font-sans: var(--font-mono)`
- [ ] Nested alias chain works within configured depth.
- [ ] Unresolvable variable chains are skipped safely.
- [ ] Circular or problematic references do not break the script.

---

## 4. Shorthand safety

### Goal
Ensure shorthand-like values are not overridden.

- [ ] Values like `font shorthand` are skipped.
- [ ] Variable tokens combining weight / size / line-height / family are skipped.
- [ ] No override is emitted for shorthand-like declarations.
- [ ] Underlying font-stack variables can still be overridden separately.

### Example patterns
- [ ] `400 14px/1.5 Inter, sans-serif`
- [ ] `var(--weight)var(--size)/var(--lineHeight)var(--fontStack)`
- [ ] `font: ...` should remain untouched

---

## 5. Non-font token safety

### Goal
Ensure non-font CSS values are not misclassified.

- [ ] Color tokens are skipped.
- [ ] Size tokens are skipped.
- [ ] Line-height tokens are skipped.
- [ ] Weight tokens are skipped.
- [ ] Spacing / layout tokens are skipped.
- [ ] No bogus overrides appear for unrelated CSS variables.

### Example patterns
- [ ] `--...fgColor`
- [ ] `--...bgColor`
- [ ] `--...size`
- [ ] `--...lineHeight`
- [ ] `--...weight`
- [ ] `--...padding`
- [ ] `--...gap`
- [ ] `--...maxWidth`

---

## 6. Regular CSS rule `font-family` override

### Goal
Verify that normal CSS rules without custom properties are supported.

- [ ] Script detects regular rules containing `font-family`.
- [ ] Script emits selector-specific override blocks.
- [ ] Only `font-family` is overridden.
- [ ] Other declarations such as `font-feature-settings` remain untouched.
- [ ] Visual font change is actually applied.

### Example selectors
- [ ] `.font-mono`
- [ ] `.font-sans`
- [ ] `.prose`
- [ ] `body`
- [ ] framework-generated selectors

---

## 7. `@font-face`-aware classification

### Goal
Verify that ambiguous family names are classified using `@font-face`.

- [ ] `@font-face` rules are detected and indexed.
- [ ] If `src` contains `mono`, family can be classified as `mono`.
- [ ] If `src` contains `sans`, family can be classified as `sans`.
- [ ] If `src` contains `serif`, family can be classified as `serif`.
- [ ] `@font-face` signals take precedence over misleading fallback families when appropriate.

### Example case
- [ ] Family name itself is ambiguous
- [ ] Fallback stack looks sans
- [ ] `@font-face src` reveals mono intent
- [ ] Final override uses mono replacement stack

---

## 8. Real-world site categories

### Category A — CSS variable-based sites
- [ ] Site with clean root-level font variables
- [ ] Site with body-scoped font variables
- [ ] Site with aliased variables

### Category B — Direct `font-family` sites
- [ ] Site with selector-based `font-family` only
- [ ] Site with framework utility classes like `.font-mono`

### Category C — Ambiguous custom fonts
- [ ] Site using custom `@font-face` family names
- [ ] Site where fallback generic family is misleading

### Category D — SPA behavior
- [ ] Font override survives route change
- [ ] Font override survives lazy-loaded stylesheet
- [ ] Font override survives delayed hydration

---

## 9. Performance / stability

- [ ] No runaway CSS growth after repeated rescans.
- [ ] No obvious memory leak in long SPA sessions.
- [ ] Periodic rescans do not visibly degrade browsing.
- [ ] Repeated calls do not generate duplicated CSS lines excessively.
- [ ] No console spam beyond expected debug output.

---

## 10. Debug output quality

### Goal
Ensure debugging remains useful after heuristic changes.

- [ ] Console output shows collected `@font-face` index.
- [ ] Console output shows overridden variable-based entries.
- [ ] Console output shows overridden rule-based entries.
- [ ] Console output shows skipped shorthand cases.
- [ ] Console output shows skipped non-font cases.
- [ ] Console output shows skipped unresolved cases.

---

## 11. Regression checks for known problem areas

- [ ] Variables on `body` override correctly.
- [ ] `:root`-only override is no longer the only emitted scope.
- [ ] Shorthand variables are not rewritten.
- [ ] Non-font variables are not rewritten.
- [ ] Ambiguous families like `geist` are classified correctly when `@font-face` gives a stronger signal.
- [ ] Utility class names like `.font-mono` do not override classification by name alone.

---

## 12. Final manual review before commit

- [ ] Run `tests/font-override-fixtures.html` over localhost.
- [ ] Read generated CSS in DevTools.
- [ ] Confirm only intended selectors are affected.
- [ ] Confirm only intended variables are affected.
- [ ] Confirm `font-family` replacement stack matches expected category.
- [ ] Confirm no page becomes visibly broken.
- [ ] Update `CHANGELOG.md` if behavior changed.
- [ ] Update `PROJECT_CONTEXT.md` if architecture or heuristics changed significantly.
