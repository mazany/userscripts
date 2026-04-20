# Changelog

All notable changes to this userscript should be documented in this file.

The format is intentionally lightweight and optimized for a small personal project.

## [Unreleased]

### Added
- Initial project structure for standalone work inside the shared `userscripts` repository.
- Documentation files for Codex-assisted continuation.
- Support for overriding font-related CSS custom properties.
- Support for overriding regular CSS `font-family` declarations.
- `@font-face` indexing to improve font category classification.
- Selector-aware override generation for variables defined below `:root`.
- Debug logging for override and skip decisions.
- Periodic and SPA-aware rescanning logic.
- Optional mono-specific tuning rules for code-like elements.

### Changed
- Classification logic was refined to prefer value-based heuristics over variable-name-based heuristics.
- Font-family classification now considers `@font-face` metadata before generic fallback families in ambiguous cases.
- Variable overrides are emitted both globally and for original selector scopes.

### Fixed
- Avoided false positives where non-font CSS custom properties were previously overridden.
- Avoided rewriting shorthand-like font tokens that include size, weight, or line-height.
- Improved handling of sites defining font variables on `body` instead of only on `:root`.

### Notes
- Current working script version imported into the repository: `0.5.1`.
- Current `serif` replacement stack is intentionally set to the same rounded sans stack as `sans` for experimentation.

---

## [0.5.1] - Imported baseline

### Added
- Current working userscript imported as repository baseline.

### Notes
- Metadata:
  - `@name`: `Generic Browser Font Override`
  - `@version`: `0.5.1`
  - `@match`: `*://*/*`
  - `@run-at`: `document-idle`
  - `@grant`: `GM_addStyle`
