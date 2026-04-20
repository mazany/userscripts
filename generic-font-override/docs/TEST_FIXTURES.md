# Browser Fixture Test Page

The repository includes a small browser-based fixture page:

```text
tests/font-override-fixtures.html
```

It is meant for manual regression checks after changing classification, logging, CSS collection, or CSS emission logic.

## Why this is browser-based

The userscript depends on browser APIs such as:

- `document.styleSheets`
- `CSSRule`
- `getComputedStyle`
- `MutationObserver`
- Tampermonkey / Violentmonkey script injection timing

Because of that, the simplest useful regression test is a real HTML page served over localhost with the userscript enabled.

## How to run

From the repository root, serve the project with any static HTTP server. For example:

```powershell
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/tests/font-override-fixtures.html
```

Make sure the userscript is installed and enabled for `http://localhost:8000/*`.

The page waits briefly for the userscript to run, then checks the injected override style element:

```text
style#tm-generic-font-override
```

It also checks computed styles for selected fixture elements.

## Result types

The page separates checks into two groups:

- `required`: expected to pass with the current baseline behavior.
- `planned`: specification checks for intended future behavior.

The icon-font checks are currently marked as `planned`, because the project has not yet implemented explicit icon-font protection. They define the desired behavior for future work:

- known icon stacks should not be overridden,
- pseudo-element icon rules should not be overridden,
- icon font stacks stored in CSS variables should not be overridden.

Once icon protection is implemented, these planned checks should be promoted to required checks.

## What the fixtures cover

The current page covers:

- root-level CSS custom properties,
- body-scoped CSS custom properties,
- simple variable aliases,
- direct `font-family` rules,
- `@font-face`-assisted mono classification,
- shorthand-like custom properties that must be skipped,
- non-font color and size custom properties that must be skipped,
- planned icon-font preservation cases.

## Maintenance notes

When changing heuristics, add a fixture before or alongside the change. Prefer small cases with explicit expected behavior. If a case documents desired behavior that is not implemented yet, mark it as planned in the fixture page instead of silently accepting the current behavior.
