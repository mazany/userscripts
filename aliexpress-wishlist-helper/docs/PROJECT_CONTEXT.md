# AliExpress Wishlist Helper — Project Context Summary

## Goal

Build a Tampermonkey userscript for the AliExpress wishlist management page that makes the hidden/default wishlist actually manageable and improves the overall wishlist workflow.

Primary goals:

- identify which items belong to the **default wishlist** (`groupId = 0`)
- display that information directly in the **All items** view
- add **filtering** for:
  - All
  - Default wishlist
  - Custom lists
  - Unknown
- make the script work correctly in **edit mode**
- improve the **"Move to another list"** dialog:
  - highlight the current list
  - show compact, color-coded badges
  - load more list metadata automatically
- keep the script robust enough for real daily use on the AliExpress web UI

Current uploaded baseline: **version 0.6.15**.

---

## Core discovery / data model

AliExpress exposes enough data in wishlist-related XHR/fetch responses to map items to wishlists.

Important findings:

- In the **All items** response, each product has `productBaseDTO.groupId`
- Items that are only in the **default wishlist** have:
  - `groupId = 0`
- Custom wishlist names and counts are available from:
  - the **My lists** response
  - the **Move to another list** dialog data
- One item appears to belong to **one effective wishlist at a time**
  - moving an item changes `groupId`
  - the relation record ID stays stable when moving between custom lists
  - removing + re-adding recreates the relation record

The script therefore models item membership primarily as:

- `itemId -> groupId`
- plus cached metadata for:
  - group name
  - item count
  - timestamps / relation metadata

---

## What has been implemented

## 1. Network interception and local cache

Implemented:

- hooks for both:
  - `fetch`
  - `XMLHttpRequest`
- parsing of relevant wishlist API responses
- local cache stored in `localStorage`

Tracked state includes:

- `items`
  - `itemId -> { g, f, c, m }`
- `groups`
  - `groupId -> { name, itemCount, synthetic? }`
- `customCountsByName`
- `paletteSlots`
- `nextPaletteSlot`
- `totalCount`
- `pageType`

This allows the script to keep working even when not everything is currently visible on screen.

---

## 2. Badge rendering on product cards

Implemented:

- badge added to product cards in **All items**
- special styling for:
  - **Default wishlist** — strong red
  - **Custom lists** — softer color-coded palette
  - **Unknown** — neutral fallback
- badges are rendered from the cached item/group mapping

Badge palette currently uses:

- a **stable slot-based palette**
- slot assignment persisted in cache
- colors derived from slot order, not directly from a simple hash

This was chosen because pure hash-based hues produced too many visually similar colors.

---

## 3. Filters / toolbar

Implemented custom toolbar below the primary AliExpress tabs:

- All
- Default wishlist
- Custom lists
- Unknown (shown only when non-zero)
- status text on the right

Filtering works on loaded cards by toggling a CSS class such as:

- `ae-wh-hidden-by-filter`

Counts are recalculated from loaded/cached data.

---

## 4. Edit mode support

Implemented support for AliExpress edit mode:

- native AliExpress **All** checkbox remains untouched
- custom **All visible** checkbox was added
- `All visible` selects only currently visible items
- if `All visible` is active:
  - newly loaded visible items are auto-selected
- if user manually deselects one item:
  - `All visible` drops out of master mode
  - checkbox becomes `indeterminate`
- when filters change:
  - if `All visible` is active, selection is reconciled to match the filter
  - if `All visible` is not active, selection is **pruned** to the active filter

This took several iterations to get right.

---

## 5. Reconciliation logic for `All visible`

A lot of work went into making selection stable.

Final working design:

- `setFilter()` is the main place that reacts to filter changes
- `scheduleRefresh()` no longer performs redundant immediate reconciliation
- `syncAllVisibleControl()` only reflects state and schedules verification when needed
- selection logic was split into:
  - `reconcileAllVisibleSelection(...)`
  - `pruneSelectionToActiveFilter(...)`
  - `getAllVisibleMismatches(...)`
  - `scheduleReconcileVerification()`

A major bug was caused by **double reconciliation in the same refresh cycle**, which produced repeated `+1 / -1` count errors. That was fixed by simplifying the refresh pipeline and making filter changes the authoritative trigger.

---

## 6. Move dialog annotation

Implemented support for the **Move to another list** dialog:

- detect the dialog
- annotate rows with:
  - color-coded badge
  - compact metadata
  - private/public indicator
  - count
- highlight the current list
- support both:
  - single-item move from overflow menu
  - batch move in edit mode

A `MutationObserver` is used because the dialog content is dynamic and paginated.

The current row highlight and current-checkmark behavior was also fixed so that:

- previously selected rows do not keep stale custom icons
- row heights remain stable when switching selected list inside the dialog

---

## 7. Compact move dialog layout

Implemented a compact layout for the move dialog:

- badge + metadata on one line
- privacy shown as icon
- count shown as number only
- smaller paddings
- improved visual density
- custom current-selection slot reserved so row height does not jump

This significantly improved usability.

---

## 8. Auto-loading additional pages in the move dialog

Because the move dialog initially loads only a limited number of lists, the script now supports **automatic loading of additional dialog pages** without changing backend payload signing.

Implemented approach:

- detect the move dialog scroll container
- if needed, inject a temporary invisible spacer
- programmatically scroll to the bottom
- trigger native infinite-scroll loading
- restore scroll position afterward
- stop after a configurable number of rounds or when no more rows are added

Important outcome:

- this approach works
- it is less disruptive after scroll restoration was added
- it avoids request signing / integrity issues
- reopening the dialog now correctly re-arms auto-loading when AliExpress reuses the same modal node and resets the list back to page 1

---

## Important problems encountered and decisions made

## A. Default wishlist has no direct standalone page on web

Problem:

- AliExpress web UI exposes custom wishlist detail pages
- but the default wishlist is not directly navigable with `wishGroupId=0`

Decision:

- treat the **All items** page as the primary source
- detect default-wishlist items via `groupId = 0`
- add our own filtering and labeling

---

## B. Unknown items / mappings

Problem:

- initially not all loaded cards have known mapping
- group names are not always available immediately

Decision:

- keep a temporary **Unknown** category
- hide the Unknown filter when count is zero
- cache group names/counts from both:
  - My lists
  - move dialog

---

## C. Edit mode selection was difficult

Problem:

- AliExpress selection UI uses custom checkbox/radio-like controls
- different DOM parts respond differently to clicks
- some approaches caused scroll jumps or missed toggles

Decision:

- rely on the working native overlay/click path that actually toggles selection
- preserve viewport when clicking overlays
- separate master mode (`allVisibleMaster`) from derived checkbox state

---

## D. Off-by-one selection bugs (`+1 / -1`)

Problem:

- selection counts shown by AliExpress Delete button often differed by one
- especially after filter changes

Root cause:

- selection reconciliation was being triggered **multiple times**
- once during refresh and again during state sync

Decision:

- move responsibility to `setFilter()`
- remove redundant immediate reconcile from `scheduleRefresh()`
- keep verification logic only where necessary

This was the key breakthrough that stabilized edit-mode behavior.

---

## E. Request rewriting for `pageSize` was explored and rejected

Tried:

- modifying request payloads for move dialog list loading
- increasing `pageSize`

Observed:

- changing payload after signing caused:
  - illegal access / signature mismatch
- modifying the client before signing later produced:
  - backend `param_error`
- backend appears to validate acceptable `pageSize` values
- max accepted value found experimentally was **16**, which is not enough to solve the full problem cleanly

Decision:

- do **not** continue down request-signing / request-integrity modification paths
- use native client flow instead
- auto-load additional dialog pages via scroll nudging

This was an important design decision.

---

## F. Runtime constant discovery

We investigated whether dialog page size came from a global mutable runtime variable.

Findings:

- dialog page size is tied to a module-local export (`Ye.c`)
- `Ye` was visible only in **Closure** scope at breakpoint time
- `Ye.c` is exposed as a getter, not a plain writable global property
- it is not a simple `window` global

Conclusion:

- the value exists in the bundle
- but it is not a convenient public runtime knob

This reinforced the decision to avoid trying to manipulate internal request generation.

---

## Current behavior / capabilities of the script

As of the latest working baseline:

- wishlist item membership is detected and cached
- default wishlist items are visibly labeled
- filters work in normal mode
- filters work in edit mode
- `All visible` works
- manual deselection works correctly
- switching filters in edit mode behaves correctly
- product-card badges are clickable:
  - custom wishlist badges open the native `detail.html` wishlist page
  - `Shift+click` opens that page in a new tab
  - the default badge switches `All` to `Default wishlist`
- move dialog rows are color-coded and compact
- current list is highlighted in the move dialog
- additional move dialog pages can be loaded automatically, including after closing and reopening the dialog
- palette slots are stable across sessions

---

## What we still want to do later

## 1. CONFIG block expansion

The script already has a `CONFIG` block, but it can still be extended and cleaned up as the single place for tunables such as:

- palette settings
- compact dialog layout
- auto-load behavior
- future warm-up / metadata-loading behavior
- maybe badge click behavior
- *possibly inject UI in the page for user's changes to the in-script configuration*

---

## 2. Optional "Load wishlists' info" / warm-up action

Still desirable:

- explicit user action to load metadata for all wishlists
- useful for:
  - filling missing group info
  - stabilizing palette assignment
  - ensuring dialog/filter counts are more complete

Even though auto-loading exists for the move dialog, a dedicated metadata action may still be useful.

---

## 3. Better immediate UI update after moving items

Still desirable, but not yet fully solved:

When items are moved between wishlists, ideally the script should immediately update:

- badge text/color
- filter counts
- visibility under active filter
- selection state if the item no longer belongs in the current filtered view

A likely future approach is:

- optimistic local update of `state.items[itemId].g`
- adjust relevant counts
- rerender toolbar/cards immediately
- then let later native API payloads confirm/correct state

This was considered useful, but not yet implemented because it is more invasive.

---

## 4. Possibly improve data completeness from other native flows

Potential future direction:

- use other already signed/native AliExpress flows (for example My lists page behavior)
- to enrich metadata without touching request integrity

---

## Architecture notes for future work

Useful mental model:

- **state cache** is the source of truth for wishlist membership
- **DOM annotation** is derived from that state
- **edit mode selection** has its own state machine:
  - native UI
  - our `allVisibleMaster`
  - reconciliation / pruning
- **move dialog** is a separate dynamic subsystem:
  - observer-driven
  - context-sensitive
  - paginated

When making changes, avoid mixing these concerns.

---

## Important implementation lessons

1. Do not let `scheduleRefresh()` become a place that mutates too much state.
2. Keep filter changes authoritative in `setFilter()`.
3. Avoid duplicate reconciliation paths.
4. Prefer native AliExpress flows over request rewriting.
5. In dynamic dialogs, always assume:   
   - pagination
   - MutationObserver timing issues
   - repeated rerenders
6. Reserve visual space for dynamic icons to avoid layout jump.
7. Cache aggressively, but render defensively.

---

## Suggested next step in a new chat / with Codex

Recommended immediate next task:

1. double check existing logic for **performance** *(too many hooks, duplicate hooks, big / out of date structures, ...)*
2. improve **post-move immediate UI update**
3. optionally add a manual **Load wishlists' info** action
4. consider using more native signed flows to enrich list metadata proactively

That order should keep risk low while giving visible UX improvements.

---

## Reference

Current uploaded working script baseline:

- `AliExpress Wishlist Helper (Default Wishlist Filter)-0.6.15.user.js`
