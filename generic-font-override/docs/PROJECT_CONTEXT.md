# Project Context: Generic Browser Font Override

## Goal

This project is a general-purpose browser userscript for overriding fonts on arbitrary websites in a controlled and relatively safe way.

The main objective is to let the user define preferred font stacks for three categories:

- monospace
- sans-serif
- serif

The script should then detect where a website defines fonts and override only the `font-family` part, while avoiding unrelated CSS values such as colors, spacing, font size, line-height, or shorthand tokens.

The long-term goal is to make this a reusable personal tool for improving typography across many websites, including sites that:
- use CSS custom properties for font stacks,
- define fonts directly in normal CSS rules,
- use aliases and indirection through `var(--...)`,
- use custom `@font-face` definitions where the family name itself is ambiguous.

---

## Current Script Status

Current working script version: `0.5.1`. The userscript metadata currently targets all sites via `@match *://*/*`, runs at `document-idle`, and uses `GM_addStyle` for CSS injection. The current configuration includes three user-defined stacks (`mono`, `sans`, `serif`), periodic rescans, variable overrides, regular CSS rule overrides, and optional mono-specific tuning rules. :contentReference[oaicite:1]{index=1}

---

## What Has Been Implemented

### 1. User-configurable font stacks

The script defines configurable replacement stacks for:

- `mono`
- `sans`
- `serif`

At the moment, the `serif` stack is intentionally configured to the same rounded sans stack as `sans`, while the previous serif stack remains commented out in the source. This reflects current experimentation rather than a final typography decision. :contentReference[oaicite:2]{index=2}

---

### 2. Detection and override of CSS custom properties

The script scans stylesheets and computed root styles for CSS custom properties (`--...`) and stores:
- the raw value,
- the source,
- the selectors where the variable was found.

It then tries to resolve simple `var(--...)` chains recursively, with a configurable recursion depth limit.

Only variables that resolve to something that looks like a **pure font-family list** are eligible for override. Variables that look like:
- colors,
- sizes,
- weights,
- line-height values,
- layout values,
- or font shorthand expressions

are skipped.

This was added because earlier heuristic versions were too aggressive and incorrectly rewrote variables unrelated to font family.

---

### 3. Detection and override of normal CSS `font-family` declarations

The script also scans ordinary CSS rules and collects declarations where the property name is exactly `font-family`.

These rules are classified and overridden independently from CSS custom properties.

This was added to support websites that do not use CSS variables for fonts at all and instead define fonts directly on selectors such as `.font-mono`.

The override is intentionally limited to `font-family` only. Other font-related declarations such as `font-feature-settings`, `font-weight`, `font-size`, and line-height are left untouched.

---

### 4. `@font-face`-aware classification

A stylesheet pass builds an index of `@font-face` declarations keyed by `font-family`.

This is used to improve classification of family names that are ambiguous on their own. For example, a stack like:

```css
font-family: geist, geist-fallback, ui-sans-serif, system-ui, sans-serif;
```

might look sans-like if classified only from fallback generic families, but can actually refer to a mono font if the associated `@font-face src` contains something like `geist-mono-latin.woff2`.

The current classification pipeline uses:

1. some direct known-name checks,
2. `@font-face`-based heuristics,
3. generic family fallback heuristics,
4. remaining known-name fallback.

This was introduced after discovering real-world cases where fallback stacks were misleading.

---

### 5. Scope-aware variable overrides

Overriding only `:root` was not sufficient for some sites, because custom properties were defined on `body` or on other scoped selectors.

The script now:

* always emits a global fallback override block for `:root, html, body`,
* also emits overrides for the original selectors where variables were found.

This improves behavior on sites that scope font variables below `:root`.

---

### 6. Conservative handling of shorthand-like values

One of the important design decisions was to **not rewrite font shorthand tokens**.

Examples like:

```css
--text-codeBlock-shorthand: var(--text-codeBlock-weight)var(--text-codeBlock-size)/var(--text-codeBlock-lineHeight)var(--fontStack-monospace);
```

should not be replaced directly, because that would destroy important non-family information such as weight, size, and line-height.

Instead, the script tries to override the underlying font stack variables and leaves shorthand tokens intact.

---

### 7. Debug logging

The script includes a debug mode that logs:

* collected `@font-face` data,
* overridden variable-based font entries,
* skipped shorthand values,
* skipped non-font values,
* unresolved variable cases,
* overridden normal CSS rules.

This is important because the script is heuristic by design and needs easy inspection when testing on new websites.

---

## Main Problems Encountered

### Problem 1: Overly aggressive classification

Early versions used variable names and weak heuristics, which caused many false positives such as:

* color tokens,
* spacing tokens,
* text size tokens,
* weight tokens,
* line-height tokens,
* layout tokens.

### Decision

Classification should rely primarily on the **value**, not the variable name.

---

### Problem 2: Font shorthand vs. pure font-family

Some tokens visually looked “font-related” but were actually `font` shorthand or shorthand-like compositions combining size, weight, line-height, and a font stack.

### Decision

Only override values that look like **pure `font-family` lists**. Shorthand-like values should be detected and skipped.

---

### Problem 3: `:root` override not taking effect everywhere

Some sites defined CSS variables on `body` or other selectors, so a `:root` override alone was insufficient.

### Decision

Generate:

* a fallback block for `:root, html, body`,
* plus per-selector override blocks for discovered variable scopes.

---

### Problem 4: Ambiguous family names

Some font-family values use family names like `geist`, which are not inherently mono/sans/serif. Generic fallbacks may also be misleading.

### Decision

Introduce `@font-face` indexing and use `src`/family-name heuristics to infer category when possible, especially when the file name contains strong signals such as `mono`, `sans`, or `serif`.

---

### Problem 5: Sites without CSS variables

Not all sites expose font stacks via CSS custom properties.

### Decision

Add support for scanning normal CSS rules and overriding explicit `font-family` declarations.

---

## Current Behavior Summary

The script currently:

* scans stylesheets for CSS variables and normal `font-family` rules,
* scans `@font-face` declarations,
* resolves simple custom-property indirection,
* classifies values as mono / sans / serif using layered heuristics,
* rewrites only `font-family`,
* avoids rewriting non-font tokens and shorthand-like values,
* injects override CSS via a dedicated `<style>` element,
* rescans after delays, periodically, and on SPA navigation or stylesheet changes. 

---

## Known Trade-offs

This is still a heuristic system.

### Conservative behavior

The script may miss some legitimate font-family cases if they do not clearly look like pure family lists.

### Imperfect family parsing

The current family splitting is simple and may not cover every exotic edge case.

### `@font-face` naming is heuristic

Using `src` file names such as `*-mono-*` is useful, but not universally reliable.

### Cross-origin stylesheet access

Some stylesheet inspection may fail because browser security blocks access to `cssRules` on cross-origin stylesheets.

### Selector duplication

Generating both global and selector-specific overrides is intentional, but it can make the emitted CSS larger.

---

## Future Work / Roadmap

### Short term

* Improve font-family parsing to handle more complex quoted family lists robustly.
* Add better deduplication and normalization of emitted selector blocks.
* Add configuration flags for stricter vs. more aggressive classification.
* Add a cleaner way to disable debug logging per site.

### Medium term

* Support inline styles (`style="font-family: ..."`), likely via DOM inspection and direct mutation rather than CSS only.
* Add optional site-specific overrides or exceptions.
* Add a simple menu/UI for toggling debug mode and enabling/disabling categories.

### Long term

* Introduce a small test corpus of representative websites and CSS samples.
* Separate classification logic, CSS collection logic, and CSS emission logic into clearer internal modules.
* Consider publishing the userscript in a cleaner reusable form for a broader personal userscript collection.

---

## Notes for Codex / Future Contributors

When modifying this script, keep these principles:

1. **Only override `font-family`.**
   Do not rewrite unrelated font properties unless there is a very strong reason.

2. **Prefer false negatives over false positives.**
   It is better to miss an override than to corrupt unrelated CSS tokens.

3. **Treat shorthand values as dangerous.**
   If a value might contain size, line-height, weight, or multiple concatenated variable references, skip it.

4. **Do not trust selector names or variable names too much.**
   Classification should be based primarily on the actual value and, where possible, related `@font-face` metadata.

5. **Real sites are messy.**
   Fallback stacks, custom font names, and scoped variables may be misleading. Keep heuristics layered and inspectable.

6. **Keep the debug logs useful.**
   This project depends heavily on being able to explain why something was overridden or skipped.

