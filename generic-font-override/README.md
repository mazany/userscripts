# Generic Browser Font Override

A personal userscript for overriding website fonts in a safer and more generic way.

## What it does

The script scans website CSS and tries to replace font stacks with user-defined preferences for:

- monospace
- sans-serif
- serif

It supports both:

- CSS custom properties such as `--font-mono`
- normal CSS rules such as `.font-mono { font-family: ... }`

It only rewrites `font-family`, and tries to avoid touching unrelated CSS values like colors, sizes, spacing, or shorthand tokens.

It also uses `@font-face` metadata to improve classification of ambiguous font families.

## Installation

1. Install a userscript manager such as:
   - Tampermonkey
   - Violentmonkey

2. Open the userscript file from:
   - `userscript/generic-font-override.user.js`

3. Install it in your userscript manager.

4. Edit the `CONFIG.fonts` section in the script if you want to change the preferred replacement font stacks.

## URL scope

Currently the script is configured for all pages:

```js
@match *://*/*
```

That makes it easy to test broadly, but it also means the script may affect any site you visit.

## What already works

* Override of font-related CSS custom properties
* Override of normal CSS `font-family` declarations
* Recursive resolution of simple `var(--...)` chains
* Skipping of shorthand-like values
* Selector-aware overrides for variables not defined on `:root`
* `@font-face`-aware classification for ambiguous family names
* SPA-friendly rescans and periodic refresh
* Debug logging for analysis and troubleshooting

## Roadmap

* More robust `font-family` parsing
* Better site-specific controls and exclusions
* Optional support for inline `style="font-family: ..."`
* More structured test cases across representative websites
* Internal refactoring for maintainability

## Status

This is currently a personal experimental userscript. The focus is correctness and safe heuristics rather than maximum override coverage.

