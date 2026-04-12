# Changelog

## 0.6.15 - 2026-04-13

- centralized wishlist page-mode detection into a single helper so toolbar visibility no longer depends on scattered pathname, pageType, and tab-text checks

## 0.6.14 - 2026-04-13

- skipped expensive move-dialog context tracking on helper-toolbar, "All visible", native footer "All", card checkbox, and card menu-button clicks that cannot open the dialog directly
- reduced redundant "All visible" full-card scans during refresh by reusing already known card roots and avoiding an extra mismatch pass when a reconcile verification is already queued

## 0.6.13 - 2026-04-13

- reduced edit-mode "All visible" filter-switch overhead by restoring page scroll once per batch selection pass instead of after every checkbox toggle
- kept the existing checkbox overlay click workaround while making bulk reconcile and prune passes less layout-heavy

## 0.6.12 - 2026-04-13

- simplified `getCardRoots()` to build the root list directly from product cards instead of first scanning wrapper nodes
- made `ensureCardItemIds()` skip DOM lookups for cards that already have a cached item id
- added badge signatures so existing card badges are not restyled or relabeled when nothing relevant changed

## 0.6.11 - 2026-04-12

- stopped move-dialog processing when the modal is hidden or otherwise not visibly open
- kept the modal observer attach timing safe for the dialog's staged render so first-open behavior still works
- added row-level signatures in move-dialog annotation to skip unchanged rows on repeated modal mutations
- replaced repeated move-dialog metadata `innerHTML` rewrites with in-place node updates for privacy/count metadata

## 0.6.10 - 2026-04-12

- changed the refresh scheduler so observer-driven updates can reprocess only affected card roots instead of rescanning every card
- added incremental loaded-card count tracking so toolbar counts stay correct during partial card refreshes
- kept full refreshes for filter changes, network payload changes, and other broad state changes to keep this optimization low risk

## 0.6.9 - 2026-04-12

- narrowed the global `MutationObserver` so it ignores helper UI churn and most move-dialog internal updates
- added removed-node handling so dialog open/close and major card-container teardown still trigger a refresh
- kept the existing refresh pipeline unchanged to make this a focused performance-only pass

## 0.6.8 - 2026-04-12

- custom-list product badges now open the native `wish-manage/detail.html?wishGroupId=...` page instead of the filtered `index.html` view
- added `detail.html` support so move-dialog enhancements can still run on native custom-list pages
- improved badge tooltips to describe the action instead of exposing debug item/group IDs
- added `Shift+click` on custom-list badges to open the destination in a new browser tab
- prevented the All-items toolbar/filter layer from appearing on native detail pages

## 0.6.7 - 2026-04-12

- added clickable product-card badges in **All items**
- custom wishlist badges now open the corresponding wishlist detail page
- clicking the default wishlist badge from **All** now switches to the **Default wishlist** filter
- added defensive comments around fragile edit-mode and move-dialog DOM assumptions
- refreshed README, project context, and manual test checklist for the clickable-badge behavior

## 0.6.6 - 2026-04-12

- fixed move-dialog auto-load so reopening the dialog continues loading additional pages instead of stopping after the first session
- fixed the auto-load session reset when AliExpress reuses the same modal DOM node between openings
- cleaned up comments in the userscript and kept only comments that still explain behavior or risky DOM assumptions
- refreshed README, project context, and test checklist to match the current behavior
- expanded the userscript metadata block with homepage, support, update, and download URLs
