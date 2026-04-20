# AGENTS.md

## Project Overview

This repository contains small personal userscripts. This project is the generic font override userscript that attempts to replace website fonts in a controlled way.

The script is heuristic by nature. Accuracy matters more than aggressiveness.

## Repository Conventions

- Keep the userscript source in `userscript/`.
- Keep contextual and planning documents in `docs/`.
- Prefer small, reviewable changes.
- Do not rewrite unrelated files.
- Preserve manual notes and project context files.

## Rules for Changes

### 1. Scope of modification
Only change what is necessary for the requested task.

### 2. Safety preference
Prefer false negatives over false positives.
Do not broaden matching heuristics unless explicitly asked.

### 3. Font handling rules
- Only override `font-family`.
- Do not rewrite `font` shorthand unless explicitly requested and implemented safely.
- Do not rewrite unrelated CSS properties such as:
  - color
  - size
  - line-height
  - spacing
  - layout values
  - weight tokens

### 4. Classification rules
When classifying font stacks:
- prefer actual value inspection over selector names or variable names,
- use `@font-face` metadata when available,
- keep heuristics explainable,
- avoid magic behavior that cannot be debugged.

### 5. Debuggability
Keep or improve debug output when changing detection logic.
When changing heuristics, make it possible to understand:
- what was overridden,
- what was skipped,
- and why.

### 6. Style
- Use plain JavaScript compatible with userscript environments.
- Keep functions reasonably small and named clearly.
- Prefer explicit helper functions over dense inline logic.
- Avoid unnecessary dependencies or build steps unless explicitly requested.

## Expected Directory Structure

```text
generic-font-override/
├─ userscript/
│  └─ generic-font-override.user.js
├─ docs/
│  ├─ PROJECT_CONTEXT.md
│  ├─ CHANGELOG.md
│  └─ TEST_CHECKLIST.md
├─ AGENTS.md
├─ README.md
└─ .gitignore
```

## Recommended Workflow

1. Read `docs/PROJECT_CONTEXT.md` before making structural changes.
2. Inspect the current userscript and existing heuristics.
3. Make the smallest viable change.
4. Update docs when behavior changes.
5. Keep changes easy to review and revert.

## Testing Expectations

When changing logic, test at least these categories:

* sites using CSS variables for font stacks
* sites using direct `font-family` rules
* sites using scoped variables on `body` or app containers
* sites with misleading fallback stacks
* sites using `@font-face` with ambiguous family names
* sites with shorthand-like font tokens that must not be rewritten

## Non-Goals

* Do not convert the project to a heavy framework.
* Do not introduce a bundler unless explicitly requested.
* Do not optimize for maximum coverage at the cost of incorrect overrides.

