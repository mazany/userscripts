# Changelog

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
