# AliExpress Wishlist Helper

Tampermonkey userscript for the AliExpress wishlist management page.

It makes the hidden/default wishlist manageable on the web UI by showing wishlist membership directly on item cards, adding filters, improving edit mode behavior, and enhancing the **Move to another list** dialog.

## What it does

- shows a badge on each item in **All items**
- detects items that belong to the **default wishlist** (`groupId = 0`)
- adds filters for:
  - All
  - Default wishlist
  - Custom lists
  - Unknown
- supports AliExpress **edit mode**
- adds an **All visible** selection control
- highlights the current list in the **Move to another list** dialog
- shows compact, color-coded wishlist rows in that dialog
- auto-loads additional dialog pages using native infinite-scroll behavior
- caches discovered wishlist metadata locally for better continuity

## Current baseline

Working baseline: **v0.6.10**

## Supported page

- `https://www.aliexpress.com/p/wish-manage/index.html*`

## Installation

1. Install a userscript manager such as **Tampermonkey**
2. Install directly from the raw userscript URL:
   [aliexpress-wishlist-helper.user.js](https://raw.githubusercontent.com/mazany/userscripts/main/aliexpress-wishlist-helper/userscript/aliexpress-wishlist-helper.user.js)
3. Or create a new userscript manually and paste the contents of `userscript/aliexpress-wishlist-helper.user.js`
4. Save
5. Open the AliExpress wishlist management page

## How it works

The script observes AliExpress wishlist-related XHR/fetch responses and extracts:

- item-to-wishlist mapping
- wishlist names
- wishlist counts
- ordering of loaded items

It then annotates the DOM and keeps its own lightweight local cache.

## Main features

### Item badges

In **All items**, each loaded item gets a badge showing:

- **Default wishlist** for `groupId = 0`
- custom wishlist name when known
- neutral fallback when mapping is not yet known
- custom-list badges open the native custom-list detail page
- the default badge switches to the **Default wishlist** filter when clicked from **All**
- `Shift+click` on a custom-list badge opens the detail page in a new tab

### Filters

A custom toolbar adds these filters:

- **All**
- **Default wishlist**
- **Custom lists**
- **Unknown**

### Edit mode support

The script adds **All visible**, which selects only the currently visible items under the active filter.

Behavior:

- when enabled, visible items are selected to match the active filter
- newly loaded visible items are also selected
- manual deselection exits master mode
- when filters change:
  - selected items are reconciled if `All visible` is active
  - otherwise selection is pruned to the active filter

### Move dialog enhancements

In **Move to another list**:

- each row gets a compact colored badge
- current list is highlighted
- privacy and item count are shown compactly
- additional pages are auto-loaded via native scrolling behavior
- repeated dialog openings re-arm auto-loading correctly

## Data model

The script mainly tracks:

- `items`: `itemId -> groupId` plus relation metadata
- `groups`: `groupId -> { name, itemCount }`
- cached counts by name
- palette slot assignments for stable badge colors

## Local storage

The script stores cache in `localStorage` to avoid losing discovered metadata between page loads.

Keys currently used:

- `ae_wishlist_helper_cache_v5`
- `ae_wishlist_helper_filter_v5`

## Known limitations

- The default wishlist has no standalone web detail page
- Not all wishlist metadata is always available immediately
- Some data only appears after relevant native UI flows are opened
- Immediate optimistic UI refresh after moving items between wishlists is not fully implemented yet
- The script depends on AliExpress DOM and response structures, which may change over time

## Design choices

- prefer native AliExpress flows over request rewriting
- keep edit mode stable above all
- use small, isolated DOM enhancements
- avoid modifying request signing/integrity mechanisms

## Planned / future work

- explicit **Load wishlists' info** action
- better immediate UI refresh after moving items between lists
- additional cleanup and documentation improvements

## Development notes

See:

- `docs/PROJECT_CONTEXT.md`
- `docs/TEST_CHECKLIST.md`
- `AGENTS.md`

## License / usage

Personal utility script. Review and adapt as needed for your own use.
