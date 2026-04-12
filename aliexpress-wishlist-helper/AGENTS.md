# AGENTS.md

## Project

Tampermonkey userscript for AliExpress wishlist management:

- adds badges for wishlist membership
- adds filters for default/custom/unknown
- supports edit mode
- enhances "Move to another list" dialog

## Constraints

- Do not break edit mode behavior
- Do not remove existing workarounds unless clearly replaced
- Prefer minimal diffs
- Preserve current UX for selection logic

## Workflow

- Read docs/PROJECT_CONTEXT.md before making changes
- Make one focused change per branch
- Explain risky DOM assumptions in comments
- Keep config centralized in CONFIG
- Keep all comments and text in English

## Manual test areas

- All items
- Default / Custom filters
- Edit mode
- All visible
- Move dialog annotation
- Move dialog auto-load
