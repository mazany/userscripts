# TEST CHECKLIST

Manual regression checklist for `AliExpress Wishlist Helper`.

---

## 1. Basic load

- Open `https://www.aliexpress.com/p/wish-manage/index.html`
- Confirm the page loads without script errors in console
- Confirm the custom toolbar appears under the main tabs
- Confirm no obvious layout breakage

Expected:
- toolbar visible
- filters visible
- status text visible
- no repeated flicker / runaway refresh loop

---

## 2. All items badges

On **All items**:

- verify loaded cards receive wishlist badges
- verify default wishlist items are red
- verify custom lists are color-coded
- verify unknown items, when present, render correctly

Expected:
- badges are attached to item cards
- badge text is readable
- colors are stable across reloads for already known lists

---

## 3. Filters

Test each filter:

- All
- Default wishlist
- Custom lists
- Unknown

Expected:
- cards are shown/hidden correctly
- counts in the toolbar look reasonable
- Unknown filter is hidden when its count is zero
- switching filters does not duplicate badges or break layout

---

## 4. Edit mode entry / exit

- Enter edit mode using native AliExpress UI
- Exit edit mode again

Expected:
- custom toolbar remains stable
- `All visible` appears only in edit mode
- `All visible` disappears when edit mode ends
- no stale selected state remains in custom UI

---

## 5. All visible — basic behavior

In edit mode:

- activate `All visible`
- verify all currently visible items under the active filter become selected
- verify the custom checkbox becomes checked

Expected:
- selected count matches visible filtered items
- native Delete button count matches expected selection count

---

## 6. All visible — manual deselection

With `All visible` active:

- manually deselect one selected item

Expected:
- `All visible` leaves master mode
- checkbox becomes `indeterminate`
- manually deselected item stays deselected
- other selected items remain selected

---

## 7. All visible — reselect

After manual deselection:

- manually reselect the item

Expected:
- if all visible items are now selected again, checkbox becomes checked
- no `+1 / -1` mismatch in Delete count

---

## 8. Filter switch in edit mode

### Case A: `All visible` active

- on `All`, activate `All visible`
- switch to `Default wishlist`
- switch to `Custom lists`
- switch back to `All`

Expected:
- selection reconciles to the currently active filter
- no off-by-one count mismatch
- newly visible items under the filter are selected as expected

### Case B: `All visible` inactive / indeterminate

- activate `All visible`
- manually deselect one item so checkbox becomes indeterminate
- switch filters

Expected:
- selection is pruned to the active filter
- items not belonging to the new filter lose selection
- when switching back, only the retained intersection remains selected

---

## 9. Infinite-scroll interaction in edit mode

- Activate `All visible`
- scroll to load additional item pages

Expected:
- newly loaded visible items get selected when master mode is active
- viewport does not jump unexpectedly
- no runaway selection loop
- no browser freeze / excessive CPU usage

---

## 10. Move dialog — single item

From a single product overflow menu:

- open **Move to another list**

Expected:
- dialog rows are color-coded
- current list is highlighted
- current-row checkmark appears correctly
- previously highlighted row does not stay highlighted incorrectly
- row heights stay stable when switching selected target list

---

## 11. Move dialog — batch selection

In edit mode:

- select one item
- open **Move to a list**
- then repeat with multiple items from the same list

Expected:
- current list highlight works when selection source is unambiguous
- no bogus highlight when source list is ambiguous
- dialog remains usable

---

## 12. Move dialog — auto-load

Open **Move to another list** when there are more lists than initially visible.

Expected:
- additional pages load automatically
- dialog does not get stuck
- dialog does not continuously force-scroll after loading finishes
- user can scroll normally afterward
- scroll position is restored or remains usable

---

## 13. Move dialog — compact layout

Expected:
- badge + privacy + count are readable
- current-row highlight is visible but not oversized
- no row height inflation after changing selected target
- all rows align consistently

---

## 14. Metadata persistence

- reload the page
- reopen All items and/or move dialog

Expected:
- previously discovered group names and colors persist
- palette colors remain stable for known groups
- cache reuse works without requiring full rediscovery every time

---

## 15. Post-move behavior

Move one or more items between lists.

Current expectation:
- no crash
- no broken dialog
- native move completes

Known gap:
- immediate optimistic UI refresh after move is not fully implemented yet

Observe:
- whether badges/counts update immediately
- whether a later native refresh fixes state

---

## 16. Console / error regression

During all tests, watch DevTools console.

Expected:
- no repeated uncaught exceptions
- no infinite observer loops
- no React crash caused by script behavior
- no repeated auto-load loop after dialog settles

---

## 17. Visual regression quick pass

Check:

- toolbar spacing
- badge spacing
- dialog compactness
- current-row highlight
- no duplicated icons
- no hidden stuck elements

---

## 18. Smoke test after any code change

Minimum quick pass after each change:

- open page
- verify toolbar
- verify badges
- verify one filter switch
- enter edit mode
- toggle `All visible`
- open move dialog
- verify current-row highlight

---

## Notes

When debugging:
- prefer testing on real live wishlist data
- test both small and large custom-list sets
- retest edit mode after any DOM-related change
- retest move dialog after any observer / scroll / annotation change