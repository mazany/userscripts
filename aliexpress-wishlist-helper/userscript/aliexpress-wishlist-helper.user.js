// ==UserScript==
// @name         AliExpress Wishlist Helper (Default Wishlist Filter)
// @namespace    https://userscripts.mazy.cc/
// @version      0.6.6
// @description  Adds wishlist badges, filters, edit-mode helpers, and move-dialog enhancements to AliExpress wishlist management.
// @author       mazy
// @homepageURL  https://github.com/mazany/userscripts/tree/main/aliexpress-wishlist-helper
// @supportURL   https://github.com/mazany/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/mazany/userscripts/main/aliexpress-wishlist-helper/userscript/aliexpress-wishlist-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/mazany/userscripts/main/aliexpress-wishlist-helper/userscript/aliexpress-wishlist-helper.user.js
// @match        https://www.aliexpress.com/p/wish-manage/index.html*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const CACHE_KEY = 'ae_wishlist_helper_cache_v5';
  const FILTER_KEY = 'ae_wishlist_helper_filter_v5';
  const DEFAULT_GROUP_ID = '0';


  const CONFIG = {
    badgePaletteStepDegrees: 48,
    badgePaletteStartOffset: 1, // 0 => hue 0; 1 => first custom list starts at hue 48
    badgePaletteSaturationStart: 72,
    badgePaletteSaturationStepPerCycle: 8,
    badgePaletteBgLightnessStart: 96,
    badgePaletteBgLightnessStepPerCycle: 4,
    badgePaletteBorderLightnessStart: 74,
    badgePaletteBorderLightnessStepPerCycle: 6,
    badgePaletteTextLightnessStart: 30,
    badgePaletteTextLightnessStepPerCycle: 4,
    badgePaletteDotLightnessStart: 42,
    badgePaletteDotLightnessStepPerCycle: 4,

    compactMoveDialog: true,
    compactMoveDialogMaxHeightVh: 58,
    compactMoveDialogRowPaddingY: 6,
    compactMoveDialogRowPaddingX: 12,
    compactMoveDialogBadgeMaxWidth: 220,

    autoLoadMoveDialogPages: true,
    moveDialogAutoLoadDelayMs: 450,
    moveDialogAutoLoadMaxRounds: 8,
    moveDialogAutoLoadSpacerPx: 160,
  };

  const FILTERS = {
    ALL: 'all',
    DEFAULT: 'default',
    CUSTOM: 'custom',
    UNKNOWN: 'unknown',
  };

  const SELECTORS = {
    tabsHeader: '.custom-tabs-header',
    editItemWrap: '[class*="editItemWrap--editItemWrap--"]',
    productCard: '[class*="productCardV2--productCard--"]',
    titleRow: '[class*="title--sideTitle--"]',
    operator: '[data-id^="operator_"]',
    activeTab: '[class*="customTabs--tabItemActive--"]',
    activeTabText: '[class*="customTabs--tabItemContent--"]',
    modal: '.comet-v2-modal.custom-modal-list',
    modalTitle: '[class*="modalTitle--modalTitle--"]',
    modalListItem: '[class*="renderList--listItem--"]',
    modalListName: '[class*="renderList--name--"]',
    modalListCount: '[class*="renderList--count--"]',
    modalEmptyCreate: '[class*="renderList--listItemEmpty--"]',
    nativeSelectedIcon: '.comet-icon-selected',
    footerBarCheckboxLabel: 'label.comet-v2-checkbox.edit-checkbox-us',
    moreButton: '[class*="more--more--"]',
    checkboxOverlay: '[class*="editItemWrap--checkDisabled--"]',
    checkboxLabelInCard: '[class*="editItemWrap--checkBox--"] label.comet-v2-checkbox',
  };

  const state = {
    items: Object.create(null),              // itemId -> { g, f, c, m }
    groups: Object.create(null),             // groupId -> { name, itemCount, synthetic? }
    customCountsByName: Object.create(null), // name -> itemCount
    paletteSlots: Object.create(null),       // groupId -> stable palette slot
    nextPaletteSlot: 0,
    totalCount: null,
    pageType: null,
    filter: loadFilter(),
    saveTimer: 0,
    refreshTimer: 0,
    toolbarEl: null,
    loadedOrder: [],                         // itemId order as loaded in All items
    loadedOrderSet: new Set(),
    moveDialogContext: null,                 // { currentGroupId: string|null, selectedItemIds: string[] }
    modalObserver: null,
    moveDialogAutoLoadRunning: false,
    moveDialogAutoLoadQueued: false,
    moveDialogAutoLoadDone: false,
    moveDialogLastRowCount: 0,
    allVisibleMaster: false,
    inMoveDialogAnnotate: false,
    pendingSingleItemId: null,
    applyingAllVisible: false,
    reconcileScheduled: false,
    reconcileAttempts: 0,
  };

  state.groups[DEFAULT_GROUP_ID] = {
    name: 'Default wishlist',
    synthetic: true,
  };

  loadCache();
  installNetworkHooks();
  installGlobalClickTracker();
  initWhenReady();

  function initWhenReady() {
    const start = () => {
      injectStyles();
      installDomObserver();
      scheduleRefresh();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  function injectStyles() {
    if (document.getElementById('ae-wh-style')) return;

    const style = document.createElement('style');
    style.id = 'ae-wh-style';
    style.textContent = `
      .ae-wh-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 0 0 12px 0;
        padding: 12px 24px 16px 24px;
        flex-wrap: wrap;
        background: #fff;
        border-top: 1px solid #f2f2f2;
      }

      .ae-wh-toolbar-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .ae-wh-filter-btn {
        appearance: none;
        border: 1px solid #d9d9d9;
        background: #fff;
        color: #222;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 13px;
        line-height: 1;
        cursor: pointer;
        transition: background-color .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease;
      }

      .ae-wh-filter-btn:hover {
        border-color: #bfbfbf;
        background: #fafafa;
      }

      .ae-wh-filter-btn[data-filter="default"].is-active {
        background: #d93025;
        border-color: #d93025;
        color: #fff;
        box-shadow: 0 0 0 1px rgba(217,48,37,.08);
      }

      .ae-wh-filter-btn.is-active:not([data-filter="default"]) {
        background: #222;
        border-color: #222;
        color: #fff;
      }

      .ae-wh-status {
        font-size: 12px;
        color: #666;
        white-space: nowrap;
      }

      .ae-wh-meta-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
        margin-bottom: 2px;
        flex-wrap: wrap;
      }

      .ae-wh-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 12px;
        line-height: 1.2;
        font-weight: 600;
        border: 1px solid transparent;
        max-width: min(360px, 80vw);
      }

      .ae-wh-badge__dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: 0 0 auto;
        background: currentColor;
        opacity: .9;
      }

      .ae-wh-badge__text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ae-wh-hidden-by-filter {
        display: none !important;
      }

      .ae-wh-modal-current {
        background: color-mix(in srgb, var(--ae-wh-current-bg, #f3f4f6) 55%, white);
      }

      .ae-wh-modal-current-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        color: var(--ae-wh-current-icon, #fd3850);
        flex: 0 0 auto;
      }

      .ae-wh-all-visible-wrap {
        display: inline-flex;
        align-items: center;
      }

      .ae-wh-modal-badge-wrap {
        display: inline-flex;
        align-items: center;
        flex: 0 1 auto;
        min-width: 0;
      }

      .ae-wh-modal-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 11px;
        line-height: 1.2;
        font-weight: 600;
        border: 1px solid transparent;
        max-width: ${CONFIG.compactMoveDialogBadgeMaxWidth}px;
      }

      .ae-wh-modal-badge .ae-wh-badge__dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: 0 0 auto;
      }

      .ae-wh-modal-current {
        outline: 2px solid rgba(253, 56, 79, 0.14);
        outline-offset: -2px;
      }

      .ae-wh-native-check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font: inherit;
        cursor: pointer;
        user-select: none;
        color: #222;
      }

      .ae-wh-all-visible-input {
        width: 16px;
        height: 16px;
        margin: 0;
        accent-color: #e60012;
        cursor: pointer;
      }

      .ae-wh-compact-move-dialog [class*="renderList--listItem--"] {
        padding: ${CONFIG.compactMoveDialogRowPaddingY}px ${CONFIG.compactMoveDialogRowPaddingX}px !important;
        min-height: 0 !important;
      }

      .ae-wh-compact-move-dialog .ae-wh-modal-compact {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        width: 100%;
      }

      .ae-wh-compact-move-dialog .ae-wh-modal-current-slot {
        margin-left: auto;
        width: 24px;
        min-width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 24px;
      }

      .ae-wh-compact-move-dialog .ae-wh-modal-meta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #666;
        font-size: 11px;
        line-height: 1.2;
        white-space: nowrap;
        flex: 0 0 auto;
      }

      .ae-wh-compact-move-dialog .ae-wh-modal-privacy {
        font-size: 12px;
        opacity: 0.9;
      }

      .ae-wh-compact-move-dialog .ae-wh-modal-count {
        font-variant-numeric: tabular-nums;
      }

      .ae-wh-compact-move-dialog [class*="renderList--name--"],
      .ae-wh-compact-move-dialog [class*="renderList--count--"] {
        display: none !important;
      }

      .ae-wh-loadmore-spacer {
        height: ${CONFIG.moveDialogAutoLoadSpacerPx}px;
        opacity: 0;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function installNetworkHooks() {
    hookFetch();
    hookXHR();
  }

  function hookFetch() {
    if (typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = extractUrlFromFetchArgs(args);

      if (!isRelevantWishlistUrl(url)) {
        return originalFetch.apply(this, args);
      }

      const response = await originalFetch.apply(this, args);

      try {
        response.clone().text()
          .then(text => processNetworkPayload(url, text))
          .catch(() => {});
      } catch (_) {}

      return response;
    };
  }

  function hookXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__aeWhUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (isRelevantWishlistUrl(this.__aeWhUrl)) {
        this.addEventListener('load', function () {
          try {
            if (this.responseType && this.responseType !== '' && this.responseType !== 'text') return;
            const url = this.responseURL || this.__aeWhUrl;
            processNetworkPayload(url, this.responseText);
          } catch (_) {}
        });
      }

      return originalSend.apply(this, args);
    };
  }

  function installGlobalClickTracker() {
    document.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const footerAllLabel = target.closest(SELECTORS.footerBarCheckboxLabel);
      if (footerAllLabel && !footerAllLabel.closest('.ae-wh-all-visible-wrap')) {
        const text = (footerAllLabel.textContent || '').trim();
        if (text === 'All') {
          state.allVisibleMaster = false;
          requestAnimationFrame(() => {
            syncAllVisibleControl();
            scheduleRefresh();
          });
        }
      }

      const itemOverlay = target.closest(SELECTORS.checkboxOverlay);
      if (itemOverlay && !state.applyingAllVisible && state.allVisibleMaster) {
        state.allVisibleMaster = false;
        requestAnimationFrame(() => {
          syncAllVisibleControl();
          scheduleRefresh();
        });
      }

      const moreBtn = target.closest(SELECTORS.moreButton);
      if (moreBtn) {
        const cardRoot =
              moreBtn.closest(SELECTORS.editItemWrap) ||
              moreBtn.closest(SELECTORS.productCard)?.closest(SELECTORS.editItemWrap);

        if (cardRoot) {
          ensureCardItemIds([cardRoot]);
          state.pendingSingleItemId = cardRoot.dataset.aeWhItemId || null;
        }
      }

      trackMoveDialogContext(target);
    }, true);
  }

  function queueMoveDialogAnnotate() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        annotateMoveDialog();
      });
    });
  }

  function trackMoveDialogContext(target) {
    // 1) Single item: operator menu entry "Move to another list"
    const singleMoveBtn = closestWithText(target, /^Move to another list$/i);
    if (singleMoveBtn) {
      let itemId = null;

      const cardRoot = singleMoveBtn.closest(SELECTORS.editItemWrap);
      if (cardRoot) {
        ensureCardItemIds([cardRoot]);
        itemId = cardRoot.dataset.aeWhItemId || null;
      }

      if (!itemId) {
        itemId = state.pendingSingleItemId || null;
      }

      const groupId = itemId && state.items[itemId] ? state.items[itemId].g : null;
      state.moveDialogContext = {
        currentGroupId: groupId || null,
        selectedItemIds: itemId ? [itemId] : [],
      };

      queueMoveDialogAnnotate();
      return;
    }

    // 2) Batch move button in edit mode: "Move to a list"
    const batchMoveBtn = closestWithText(target, /^Move to a list$/i);
    if (batchMoveBtn) {
      const selectedRoots = getCardRoots().filter(root => {
        const checked = root.querySelector('input[type="checkbox"]:checked');
        return !!checked;
      });

      ensureCardItemIds(selectedRoots);

      const selectedItemIds = selectedRoots
        .map(root => root.dataset.aeWhItemId || '')
        .filter(Boolean);

      const groupIds = new Set(
        selectedItemIds
          .map(itemId => state.items[itemId]?.g)
          .filter(Boolean)
      );

      state.moveDialogContext = {
        currentGroupId: groupIds.size === 1 ? [...groupIds][0] : null,
        selectedItemIds,
      };

      queueMoveDialogAnnotate();
    }
  }

  function closestWithText(startEl, regex) {
    let el = startEl;
    for (let i = 0; el && i < 7; i++, el = el.parentElement) {
      const text = (el.textContent || '').trim();
      if (regex.test(text)) return el;
    }
    return null;
  }

  function extractUrlFromFetchArgs(args) {
    const input = args?.[0];
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function isRelevantWishlistUrl(rawUrl) {
    if (!rawUrl) return false;

    try {
      const url = new URL(rawUrl, location.href);
      const api = (url.searchParams.get('api') || '').toLowerCase();
      return api === 'mtop.ae.wishlist.allitems.render' ||
             api === 'mtop.ae.wishlist.mylist.render';
    } catch (_) {
      return false;
    }
  }

  function isElementVisible(el) {
    if (!(el instanceof Element)) return false;
    if (el.classList.contains('ae-wh-hidden-by-filter')) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function getVisibleCardRoots() {
    return getCardRoots().filter(root => isElementVisible(root));
  }

  function getCardCheckboxOverlay(cardRoot) {
    return cardRoot.querySelector(SELECTORS.checkboxOverlay);
  }

  function isCardChecked(cardRoot) {
    const label = cardRoot.querySelector(SELECTORS.checkboxLabelInCard);
    return !!label?.classList.contains('comet-v2-checkbox-checked');
  }

  function toggleCardSelection(cardRoot, shouldBeChecked) {
    const overlay = getCardCheckboxOverlay(cardRoot);
    if (!overlay) return false;

    const currentlyChecked = isCardChecked(cardRoot);
    if (currentlyChecked === shouldBeChecked) return false;

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    overlay.click();
    window.scrollTo(scrollX, scrollY);
    return true;
  }

  function isEditModeActive() {
    return !!document.querySelector('.editItemWrap--editItemWrapHiddenEdit--3qzWiN2');
  }

  function findFooterAllLabel() {
    const labels = Array.from(document.querySelectorAll(SELECTORS.footerBarCheckboxLabel));
    for (const label of labels) {
      const text = (label.textContent || '').trim();
      if (text === 'All') return label;
    }
    return null;
  }

  function renderAllVisibleControl() {
    if (!isEditModeActive()) {
      document.querySelectorAll('.ae-wh-all-visible-wrap').forEach(el => el.remove());
      state.allVisibleMaster = false;
      return;
    }

    const nativeAllLabel = findFooterAllLabel();
    if (!nativeAllLabel) return;

    let wrap = document.querySelector('.ae-wh-all-visible-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'ae-wh-all-visible-wrap';
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.style.marginLeft = '16px';

      wrap.innerHTML = `
        <label class="ae-wh-native-check">
          <input type="checkbox" class="ae-wh-all-visible-input">
          <span>All visible</span>
        </label>
      `;

      const input = wrap.querySelector('.ae-wh-all-visible-input');
      input.addEventListener('change', () => {
        const checked = input.checked;

        state.allVisibleMaster = checked;
        input.indeterminate = false;

        if (checked) {
          reconcileAllVisibleSelection();
          scheduleReconcileVerification();
        } else {
          state.applyingAllVisible = true;
          try {
            for (const root of getCardRoots()) {
              toggleCardSelection(root, false);
            }
          } finally {
            state.applyingAllVisible = false;
          }

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              syncAllVisibleControl();
              scheduleRefresh();
            });
          });
        }
      });

      nativeAllLabel.parentElement?.insertAdjacentElement('afterend', wrap);
    }

    syncAllVisibleControl();
  }

  function syncAllVisibleControl() {
    if (state.applyingAllVisible) return;

    const wrap = document.querySelector('.ae-wh-all-visible-wrap');
    if (!wrap) return;

    const input = wrap.querySelector('.ae-wh-all-visible-input');
    if (!input) return;

    if (state.allVisibleMaster) {
      input.checked = true;
      input.indeterminate = false;

      if (!state.reconcileScheduled && getAllVisibleMismatches().length) {
        scheduleReconcileVerification();
      }

      return;
    }

    const visibleRoots = getVisibleCardRoots();
    const total = visibleRoots.length;
    const selected = visibleRoots.filter(isCardChecked).length;

    input.indeterminate = selected > 0 && selected < total;
    input.checked = total > 0 && selected === total;
  }

  function recordMatchesActiveFilter(record) {
    switch (state.filter) {
      case FILTERS.DEFAULT:
        return !!record && record.g === DEFAULT_GROUP_ID;
      case FILTERS.CUSTOM:
        return !!record && record.g !== DEFAULT_GROUP_ID;
      case FILTERS.UNKNOWN:
        return !record;
      case FILTERS.ALL:
      default:
        return true;
    }
  }

  function pruneSelectionToActiveFilter(cardRoots = null) {
    if (state.applyingAllVisible) return false;

    const roots = cardRoots || getCardRoots();
    let changed = false;

    state.applyingAllVisible = true;
    try {
      for (const root of roots) {
        const itemId = root.dataset.aeWhItemId || '';
        const record = itemId ? state.items[itemId] || null : null;

        const matches = recordMatchesActiveFilter(record);
        const checked = isCardChecked(root);

        // Deselect cards that no longer belong to the active filter.
        if (!matches && checked) {
          changed = toggleCardSelection(root, false) || changed;
        }
      }
    } finally {
      state.applyingAllVisible = false;
    }

    return changed;
  }

  function reconcileAllVisibleSelection(cardRoots = null) {
    if (!state.allVisibleMaster || state.applyingAllVisible) return false;

    const roots = cardRoots || getCardRoots();
    let changed = false;

    state.applyingAllVisible = true;
    try {
      for (const root of roots) {
        const itemId = root.dataset.aeWhItemId || '';
        const record = itemId ? state.items[itemId] || null : null;
        const shouldBeChecked = recordMatchesActiveFilter(record);

        changed = toggleCardSelection(root, shouldBeChecked) || changed;
      }
    } finally {
      state.applyingAllVisible = false;
    }

    return changed;
  }

  function getAllVisibleMismatches(cardRoots = null) {
    const roots = cardRoots || getCardRoots();
    const mismatches = [];

    for (const root of roots) {
      const itemId = root.dataset.aeWhItemId || '';
      const record = itemId ? state.items[itemId] || null : null;
      const shouldBeChecked = recordMatchesActiveFilter(record);
      const checked = isCardChecked(root);

      if (shouldBeChecked !== checked) {
        mismatches.push({ root, shouldBeChecked });
      }
    }

    return mismatches;
  }

  function scheduleReconcileVerification() {
    if (state.reconcileScheduled) return;
    state.reconcileScheduled = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        state.reconcileScheduled = false;

        if (!state.allVisibleMaster) {
          state.reconcileAttempts = 0;
          syncAllVisibleControl();
          return;
        }

        const cardRoots = getCardRoots();
        ensureCardItemIds(cardRoots);

        reconcileAllVisibleSelection(cardRoots);
        const stillMismatched = getAllVisibleMismatches(cardRoots).length > 0;

        if (stillMismatched && state.reconcileAttempts < 4) {
          state.reconcileAttempts += 1;
          scheduleReconcileVerification();
        } else {
          state.reconcileAttempts = 0;
          syncAllVisibleControl();
          scheduleRefresh();
        }
      });
    });
  }

  function processNetworkPayload(rawUrl, text) {
    const api = getApiName(rawUrl);
    if (!api) return;

    const json = parsePossiblyWrappedJson(text);
    if (!json) return;

    const changed = processApiPayload(api, json);
    if (changed) {
      scheduleSave();
      scheduleRefresh();
    }
  }

  function getApiName(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      return (url.searchParams.get('api') || '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function parsePossiblyWrappedJson(text) {
    if (!text || typeof text !== 'string') return null;

    const trimmed = text.trim();
    if (!trimmed) return null;

    try {
      return JSON.parse(trimmed);
    } catch (_) {}

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch (_) {}
    }

    return null;
  }

  function processApiPayload(api, json) {
    let changed = false;

    const payload = json?.data?.data;
    const modules = payload?.data;
    const globalData = payload?.global;

    if (!payload) return false;

    if (Number.isFinite(globalData?.itemTotalCount)) {
      state.totalCount = globalData.itemTotalCount;
      changed = true;
    }

    if (typeof globalData?.pageType === 'string' && globalData.pageType !== state.pageType) {
      state.pageType = globalData.pageType;
      changed = true;
    }

    if (api === 'mtop.ae.wishlist.allitems.render') {
      changed = appendLoadedOrder(extractOrderedItemIds(payload)) || changed;
    }

    if (modules && typeof modules === 'object') {
      changed = processProductModules(modules) || changed;

      if (api === 'mtop.ae.wishlist.mylist.render') {
        changed = processGroupModules(modules) || changed;
      }
    }

    return changed;
  }

  function extractOrderedItemIds(payload) {
    const structure = payload?.hierarchy?.structure;
    if (!structure || typeof structure !== 'object') return [];

    for (const [key, value] of Object.entries(structure)) {
      if (!key.startsWith('wln_paging_') || !Array.isArray(value)) continue;

      const itemIds = value
        .map(entry => {
          const match = String(entry).match(/^wln_page_product_I_(\d+)$/);
          return match ? match[1] : null;
        })
        .filter(Boolean);

      if (itemIds.length) return itemIds;
    }

    return [];
  }

  function appendLoadedOrder(itemIds) {
    let changed = false;

    for (const itemId of itemIds) {
      if (state.loadedOrderSet.has(itemId)) continue;
      state.loadedOrder.push(itemId);
      state.loadedOrderSet.add(itemId);
      changed = true;
    }

    return changed;
  }

  function processProductModules(modules) {
    let changed = false;

    for (const node of Object.values(modules)) {
      const dto = node?.fields?.productBaseDTO;
      if (!dto || dto.itemId == null || dto.groupId == null) continue;

      const itemId = String(dto.itemId);
      const next = {
        g: String(dto.groupId),
        f: dto.id != null ? String(dto.id) : '',
        c: toNumberOrZero(dto.gmtCreate),
        m: toNumberOrZero(dto.gmtModified),
      };

      const prev = state.items[itemId];
      if (shouldReplaceItem(prev, next)) {
        state.items[itemId] = next;
        changed = true;
      }
    }

    return changed;
  }

  function processGroupModules(modules) {
    let changed = false;

    for (const node of Object.values(modules)) {
      if (node?.type !== 'wln_group_container') continue;

      const fields = node.fields || {};
      if (fields.groupId == null) continue;

      const groupId = String(fields.groupId);
      const prev = state.groups[groupId] || {};
      const next = {
        name: cleanText(fields.name) || prev.name || `List ${groupId}`,
        itemCount: Number.isFinite(fields.itemCount) ? fields.itemCount : prev.itemCount ?? null,
        synthetic: false,
      };

      if (!shallowEqual(prev, next)) {
        state.groups[groupId] = next;
        changed = true;
      }

      if (next.name && Number.isFinite(next.itemCount)) {
        if (rememberCustomCountByName(next.name, next.itemCount)) {
          changed = true;
        }
      }
    }

    return changed;
  }

  function rememberCustomCountByName(name, count) {
    if (!name || !Number.isFinite(count)) return false;
    if (state.customCountsByName[name] === count) return false;
    state.customCountsByName[name] = count;
    return true;
  }

  function shouldReplaceItem(prev, next) {
    if (!prev) return true;
    if ((next.m || 0) > (prev.m || 0)) return true;
    if ((next.m || 0) === (prev.m || 0) && next.g !== prev.g) return true;
    if ((next.m || 0) === (prev.m || 0) && next.f && next.f !== prev.f) return true;
    return false;
  }

  function toNumberOrZero(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function shallowEqual(a, b) {
    const aKeys = Object.keys(a || {});
    const bKeys = Object.keys(b || {});
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => a[key] === b[key]);
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;

      if (parsed.items && typeof parsed.items === 'object') {
        state.items = parsed.items;
      }

      if (parsed.groups && typeof parsed.groups === 'object') {
        state.groups = {
          ...parsed.groups,
          [DEFAULT_GROUP_ID]: {
            name: 'Default wishlist',
            synthetic: true,
          },
        };
      }

      if (parsed.customCountsByName && typeof parsed.customCountsByName === 'object') {
        state.customCountsByName = parsed.customCountsByName;
      }

      if (parsed.paletteSlots && typeof parsed.paletteSlots === 'object') {
        state.paletteSlots = parsed.paletteSlots;
      }

      if (Number.isFinite(parsed.nextPaletteSlot)) {
        state.nextPaletteSlot = parsed.nextPaletteSlot;
      }

      if (Number.isFinite(parsed.totalCount)) {
        state.totalCount = parsed.totalCount;
      }

      if (typeof parsed.pageType === 'string') {
        state.pageType = parsed.pageType;
      }
    } catch (_) {}
  }

  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);

    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = 0;
      try {
        const payload = {
          items: state.items,
          groups: state.groups,
          customCountsByName: state.customCountsByName,
          paletteSlots: state.paletteSlots,
          nextPaletteSlot: state.nextPaletteSlot,
          totalCount: state.totalCount,
          pageType: state.pageType,
          savedAt: Date.now(),
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      } catch (err) {
        console.warn('[AE Wishlist Helper] Could not save cache:', err);
      }
    }, 250);
  }

  function loadFilter() {
    try {
      const value = localStorage.getItem(FILTER_KEY);
      if (Object.values(FILTERS).includes(value)) return value;
    } catch (_) {}
    return FILTERS.ALL;
  }

  function setFilter(nextFilter) {
    if (!Object.values(FILTERS).includes(nextFilter)) return;
    state.filter = nextFilter;

    try {
      localStorage.setItem(FILTER_KEY, nextFilter);
    } catch (_) {}

    const inEdit = isEditModeActive();
    const cardRoots = inEdit ? getCardRoots() : null;
    if (cardRoots) {
      ensureCardItemIds(cardRoots);
    }

    if (inEdit) {
      if (state.allVisibleMaster) {
        reconcileAllVisibleSelection(cardRoots);
        scheduleReconcileVerification();
      } else {
        pruneSelectionToActiveFilter(cardRoots);
      }
    }

    scheduleRefresh();
  }

  function installDomObserver() {
    const observer = new MutationObserver(mutations => {
      let relevant = false;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (mutation.target instanceof Element) {
            if (
              mutation.target.matches?.(SELECTORS.tabsHeader) ||
              mutation.target.closest?.(SELECTORS.tabsHeader) ||
              mutation.target.matches?.(SELECTORS.editItemWrap) ||
              mutation.target.closest?.(SELECTORS.editItemWrap)
            ) {
              relevant = true;
              break;
            }
          }
        }

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;

          if (
            node.matches?.(SELECTORS.editItemWrap) ||
            node.querySelector?.(SELECTORS.editItemWrap) ||
            node.matches?.(SELECTORS.tabsHeader) ||
            node.querySelector?.(SELECTORS.tabsHeader)
          ) {
            relevant = true;
            break;
          }
        }

        if (relevant) break;
      }

      if (relevant) scheduleRefresh();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  }

  function scheduleRefresh() {
    if (state.refreshTimer) return;

    state.refreshTimer = window.requestAnimationFrame(() => {
      state.refreshTimer = 0;

      const cardRoots = getCardRoots();
      ensureCardItemIds(cardRoots);

      renderToolbar();
      annotateAndFilterCards(cardRoots);
      renderAllVisibleControl();
      syncAllVisibleControl();
      annotateMoveDialog();

      if (state.allVisibleMaster && isEditModeActive() && !state.reconcileScheduled) {
        scheduleReconcileVerification();
      }
    });
  }

  function attachMoveDialogObserver(modal) {
    if (state.modalObserver && state.modalObserver.__aeWhModal === modal) return;

    if (state.modalObserver) {
      state.modalObserver.disconnect();
      state.modalObserver = null;
    }

    state.moveDialogAutoLoadDone = false;

    const observer = new MutationObserver(() => {
      if (state.inMoveDialogAnnotate) return;
      window.requestAnimationFrame(() => {
        if (!state.inMoveDialogAnnotate) {
          annotateMoveDialog();
          queueMoveDialogAutoLoad();
        }
      });
    });

    observer.observe(modal, {
      childList: true,
      subtree: true,
    });

    observer.__aeWhModal = modal;
    state.modalObserver = observer;
  }

  function detachMoveDialogObserverIfNeeded() {
    const modal = document.querySelector(SELECTORS.modal);
    if (modal) return;

    if (state.modalObserver) {
      state.modalObserver.disconnect();
      state.modalObserver = null;
    }

    state.moveDialogAutoLoadRunning = false;
    state.moveDialogAutoLoadQueued = false;
    state.moveDialogAutoLoadDone = false;
    state.moveDialogLastRowCount = 0;
  }

  function getMoveDialogScrollEl(modal = null) {
    const root = modal || document.querySelector(SELECTORS.modal);
    if (!root) return null;

    return root.querySelector(
      '[class*="renderList--listModalScroll--"], [class*="renderList--listModalScrollUS--"], .comet-v2-infinite-scroll'
    );
  }

  function getMoveDialogDataRows(modal = null) {
    const root = modal || document.querySelector(SELECTORS.modal);
    if (!root) return [];

    return Array.from(root.querySelectorAll(SELECTORS.modalListItem))
      .filter(row => !row.querySelector(SELECTORS.modalEmptyCreate));
  }

  function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function queueMoveDialogAutoLoad() {
    if (!CONFIG.autoLoadMoveDialogPages) return;
    if (state.moveDialogAutoLoadRunning || state.moveDialogAutoLoadQueued || state.moveDialogAutoLoadDone) return;

    const modal = document.querySelector(SELECTORS.modal);
    if (!modal) return;

    const title = modal.querySelector(SELECTORS.modalTitle)?.textContent?.trim() || '';
    if (!/move to another list/i.test(title)) return;

    state.moveDialogAutoLoadDone = true;
    state.moveDialogAutoLoadQueued = true;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(async () => {
        state.moveDialogAutoLoadQueued = false;
        await loadAllMoveDialogPages();
      });
    });
  }

  async function loadAllMoveDialogPages() {
    if (!CONFIG.autoLoadMoveDialogPages) return false;
    if (state.moveDialogAutoLoadRunning) return false;

    const modal = document.querySelector(SELECTORS.modal);
    if (!modal) return false;

    const title = modal.querySelector(SELECTORS.modalTitle)?.textContent?.trim() || '';
    if (!/move to another list/i.test(title)) return false;

    const scrollEl = getMoveDialogScrollEl(modal);
    const initialScrollTop = scrollEl ? scrollEl.scrollTop : 0;

    state.moveDialogAutoLoadRunning = true;
    try {
      let loadedAny = false;

      for (let round = 0; round < CONFIG.moveDialogAutoLoadMaxRounds; round++) {
        const loadedMore = await nudgeMoveDialogLoadMore(modal);
        if (!loadedMore) break;

        loadedAny = true;
        annotateMoveDialog();
      }

      return loadedAny;
    } finally {
      if (scrollEl && scrollEl.isConnected) {
        scrollEl.scrollTop = initialScrollTop;
      }
      state.moveDialogAutoLoadRunning = false;
    }
  }

  async function nudgeMoveDialogLoadMore(modal) {
    const scrollEl = getMoveDialogScrollEl(modal);
    if (!scrollEl) return false;

    const beforeTop = scrollEl.scrollTop;
    const beforeCount = getMoveDialogDataRows(modal).length;
    const beforeHeight = scrollEl.scrollHeight;
    const previousScrollBehavior = scrollEl.style.scrollBehavior;
    scrollEl.style.scrollBehavior = 'auto';

    let spacer = null;
    const needsSpacer = scrollEl.scrollHeight <= scrollEl.clientHeight + 2;
    if (needsSpacer) {
      spacer = document.createElement('div');
      spacer.className = 'ae-wh-loadmore-spacer';
      scrollEl.appendChild(spacer);
      void scrollEl.offsetHeight;
    }

    scrollEl.scrollTop = scrollEl.scrollHeight;
    scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));

    await delay(CONFIG.moveDialogAutoLoadDelayMs);

    if (spacer?.isConnected) spacer.remove();

    scrollEl.scrollTop = beforeTop;
    scrollEl.style.scrollBehavior = previousScrollBehavior;

    const afterCount = getMoveDialogDataRows(modal).length;
    const afterHeight = scrollEl.scrollHeight;

    return afterCount > beforeCount || afterHeight > beforeHeight;
  }

  function renderToolbar() {
    const header = document.querySelector(SELECTORS.tabsHeader);
    if (!header) return;

    let toolbar = state.toolbarEl;
    if (!toolbar || !document.contains(toolbar)) {
      toolbar = document.createElement('div');
      toolbar.className = 'ae-wh-toolbar';
      toolbar.innerHTML = `
        <div class="ae-wh-toolbar-left">
          <button type="button" class="ae-wh-filter-btn" data-filter="${FILTERS.ALL}">All</button>
          <button type="button" class="ae-wh-filter-btn" data-filter="${FILTERS.DEFAULT}">Default wishlist</button>
          <button type="button" class="ae-wh-filter-btn" data-filter="${FILTERS.CUSTOM}">Custom lists</button>
          <button type="button" class="ae-wh-filter-btn" data-filter="${FILTERS.UNKNOWN}">Unknown</button>
        </div>
        <div class="ae-wh-status"></div>
      `;

      toolbar.addEventListener('click', event => {
        const btn = event.target.closest('.ae-wh-filter-btn');
        if (!btn) return;
        setFilter(btn.dataset.filter);
      });

      header.insertAdjacentElement('afterend', toolbar);
      state.toolbarEl = toolbar;
    }

    const shouldShow = shouldShowToolbar();
    toolbar.style.display = shouldShow ? 'flex' : 'none';

    for (const btn of toolbar.querySelectorAll('.ae-wh-filter-btn')) {
      btn.classList.toggle('is-active', btn.dataset.filter === state.filter);
    }

    const statusEl = toolbar.querySelector('.ae-wh-status');
    if (statusEl) {
      const mapped = Object.keys(state.items).length;
      const percent = Number.isFinite(state.totalCount) && state.totalCount > 0
        ? Math.floor((mapped / state.totalCount) * 100)
        : null;

      const estimatedDefault = computeEstimatedDefaultTotal();

      let text = `Mapped ${formatNumber(mapped)}`;
      if (percent != null) text += ` (${percent} %)`;
      if (estimatedDefault != null) text += ` • Est. default ${formatNumber(estimatedDefault)}`;

      statusEl.textContent = text;
    }
  }

  function shouldShowToolbar() {
    if (state.pageType === 'GROUP_LIST') return false;
    if (state.pageType === 'PRODUCT_LIST') return true;
    return isAllItemsTabActive();
  }

  function isAllItemsTabActive() {
    const active = document.querySelector(SELECTORS.activeTab);
    if (!active) return true;

    const text = active.querySelector(SELECTORS.activeTabText)?.textContent?.trim()?.toLowerCase() || '';
    return text.startsWith('all items');
  }

  function getCardRoots() {
    const roots = Array.from(document.querySelectorAll(SELECTORS.editItemWrap))
      .filter(root => root.querySelector(SELECTORS.productCard));

    if (roots.length) return roots;

    // fallback
    const cards = Array.from(document.querySelectorAll(SELECTORS.productCard));
    const set = new Set();
    for (const card of cards) {
      const root = card.closest(SELECTORS.editItemWrap) || card;
      set.add(root);
    }
    return [...set];
  }

  function ensureCardItemIds(cardRoots) {
    cardRoots.forEach((root, index) => {
      const operator = root.querySelector(SELECTORS.operator);
      const operatorId = operator ? extractItemIdFromOperator(operator) : null;

      if (operatorId) {
        root.dataset.aeWhItemId = operatorId;
        return;
      }

      if (root.dataset.aeWhItemId) return;

      const byOrder = state.loadedOrder[index];
      if (byOrder) {
        root.dataset.aeWhItemId = byOrder;
      }
    });
  }

  function annotateAndFilterCards(cardRoots = null) {
    const inAllItems = shouldShowToolbar();
    const roots = cardRoots || getCardRoots();

    ensureCardItemIds(roots);

    let defaultCount = 0;
    let customCount = 0;
    let unknownCount = 0;

    for (const cardRoot of roots) {
      const itemId = cardRoot.dataset.aeWhItemId || '';
      const record = itemId ? state.items[itemId] || null : null;

      if (record) {
        if (record.g === DEFAULT_GROUP_ID) defaultCount++;
        else customCount++;
      } else {
        unknownCount++;
      }

      if (inAllItems) {
        if (itemId) {
          upsertBadge(cardRoot, itemId, record);
        }
        applyFilter(cardRoot, record);
      } else {
        removeBadge(cardRoot);
        cardRoot.classList.remove('ae-wh-hidden-by-filter');
      }
    }

    updateButtonCounts({
      defaultCount,
      customCount,
      unknownCount,
      loadedCount: defaultCount + customCount + unknownCount,
    });
  }

  function extractItemIdFromOperator(operator) {
    const raw = operator.getAttribute('data-id') || '';
    const match = raw.match(/^operator_(\d+)$/);
    return match ? match[1] : null;
  }

  function upsertBadge(cardRoot, itemId, record) {
    const titleRow = cardRoot.querySelector(SELECTORS.titleRow);
    if (!titleRow) return;

    const parent = titleRow.parentElement || titleRow;
    let metaRow = parent.querySelector('.ae-wh-meta-row');

    if (!metaRow) {
      metaRow = document.createElement('div');
      metaRow.className = 'ae-wh-meta-row';
      titleRow.insertAdjacentElement('afterend', metaRow);
    }

    let badge = metaRow.querySelector('.ae-wh-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ae-wh-badge';
      badge.innerHTML = `
        <span class="ae-wh-badge__dot"></span>
        <span class="ae-wh-badge__text"></span>
      `;
      metaRow.appendChild(badge);
    }

    let label = 'Unknown';
    let palette = unknownPalette();

    if (record) {
      const groupId = record.g;
      const group = state.groups[groupId];
      label = groupId === DEFAULT_GROUP_ID
        ? 'Default wishlist'
        : (group?.name || `List ${groupId}`);

      palette = paletteForGroup(groupId);
      badge.title = `itemId=${itemId}, groupId=${groupId}`;
    } else {
      badge.title = `itemId=${itemId}, groupId=unknown`;
    }

    badge.querySelector('.ae-wh-badge__text').textContent = label;
    badge.style.backgroundColor = palette.bg;
    badge.style.borderColor = palette.border;
    badge.style.color = palette.color;
    badge.querySelector('.ae-wh-badge__dot').style.backgroundColor = palette.dot;
  }

  function removeBadge(cardRoot) {
    cardRoot.querySelectorAll('.ae-wh-meta-row').forEach(el => el.remove());
  }

  function applyFilter(cardRoot, record) {
    let visible = true;

    switch (state.filter) {
      case FILTERS.DEFAULT:
        visible = !!record && record.g === DEFAULT_GROUP_ID;
        break;
      case FILTERS.CUSTOM:
        visible = !!record && record.g !== DEFAULT_GROUP_ID;
        break;
      case FILTERS.UNKNOWN:
        visible = !record;
        break;
      case FILTERS.ALL:
      default:
        visible = true;
        break;
    }

    cardRoot.classList.toggle('ae-wh-hidden-by-filter', !visible);
  }

  function updateButtonCounts(counts) {
    const toolbar = state.toolbarEl;
    if (!toolbar || !document.contains(toolbar)) return;

    const unknownBtn = toolbar.querySelector(`[data-filter="${FILTERS.UNKNOWN}"]`);

    if (unknownBtn) {
      const showUnknown = counts.unknownCount > 0;
      unknownBtn.style.display = showUnknown ? '' : 'none';

      if (!showUnknown && state.filter === FILTERS.UNKNOWN) {
        state.filter = FILTERS.ALL;
        try {
          localStorage.setItem(FILTER_KEY, FILTERS.ALL);
        } catch (_) {}
      }
    }

    const map = {
      [FILTERS.ALL]: `All (${formatNumber(counts.loadedCount)})`,
      [FILTERS.DEFAULT]: `Default wishlist (${formatNumber(counts.defaultCount)})`,
      [FILTERS.CUSTOM]: `Custom lists (${formatNumber(counts.customCount)})`,
      [FILTERS.UNKNOWN]: `Unknown (${formatNumber(counts.unknownCount)})`,
    };

    for (const btn of toolbar.querySelectorAll('.ae-wh-filter-btn')) {
      const label = map[btn.dataset.filter];
      if (label) btn.textContent = label;
      btn.classList.toggle('is-active', btn.dataset.filter === state.filter);
    }
  }

  function ensurePaletteSlot(groupId) {
    const key = String(groupId);
    if (key === DEFAULT_GROUP_ID) return -1;

    if (state.paletteSlots[key] == null) {
      state.paletteSlots[key] = state.nextPaletteSlot++;
      scheduleSave();
    }

    return state.paletteSlots[key];
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function paletteForSlot(slot) {
    const offsetIndex = slot + CONFIG.badgePaletteStartOffset;
    const degrees = offsetIndex * CONFIG.badgePaletteStepDegrees;
    const hue = ((degrees % 360) + 360) % 360;
    const cycle = Math.floor(degrees / 360);

    const saturation = clamp(
      CONFIG.badgePaletteSaturationStart - cycle * CONFIG.badgePaletteSaturationStepPerCycle,
      48,
      80
    );
    const bgLightness = clamp(
      CONFIG.badgePaletteBgLightnessStart - cycle * CONFIG.badgePaletteBgLightnessStepPerCycle,
      84,
      97
    );
    const borderLightness = clamp(
      CONFIG.badgePaletteBorderLightnessStart - cycle * CONFIG.badgePaletteBorderLightnessStepPerCycle,
      54,
      80
    );
    const textLightness = clamp(
      CONFIG.badgePaletteTextLightnessStart - cycle * CONFIG.badgePaletteTextLightnessStepPerCycle,
      20,
      36
    );
    const dotLightness = clamp(
      CONFIG.badgePaletteDotLightnessStart - cycle * CONFIG.badgePaletteDotLightnessStepPerCycle,
      28,
      48
    );

    return {
      bg: `hsl(${hue} ${saturation}% ${bgLightness}%)`,
      border: `hsl(${hue} ${Math.max(36, saturation - 22)}% ${borderLightness}%)`,
      color: `hsl(${hue} ${Math.max(28, saturation - 28)}% ${textLightness}%)`,
      dot: `hsl(${hue} ${Math.max(34, saturation - 18)}% ${dotLightness}%)`,
    };
  }

  function annotateMoveDialog() {
    const modal = document.querySelector(SELECTORS.modal);
    if (!modal) {
      detachMoveDialogObserverIfNeeded();
      return;
    }

    attachMoveDialogObserver(modal);

    if (CONFIG.compactMoveDialog) {
      modal.classList.add('ae-wh-compact-move-dialog');
      const scrollEl = modal.querySelector('[class*="renderList--listModalScroll--"], [class*="renderList--listModalScrollUS--"], .comet-v2-infinite-scroll');
      if (scrollEl) {
        scrollEl.style.height = `${CONFIG.compactMoveDialogMaxHeightVh}vh`;
      }
    } else {
      modal.classList.remove('ae-wh-compact-move-dialog');
    }

    const title = modal.querySelector(SELECTORS.modalTitle)?.textContent?.trim() || '';
    if (!/move to another list/i.test(title)) return;

    const rows = Array.from(modal.querySelectorAll(SELECTORS.modalListItem))
    .filter(row => !row.querySelector(SELECTORS.modalEmptyCreate));

    if (!rows.length) return;

    if (!state.moveDialogAutoLoadRunning && rows.length < state.moveDialogLastRowCount) {
      // AliExpress appears to reuse the same modal node between openings.
      // When the row count drops back down, treat it as a fresh dialog session
      // so auto-loading can run again on the reset first page.
      state.moveDialogAutoLoadDone = false;
    }
    state.moveDialogLastRowCount = rows.length;

    const currentGroupId = state.moveDialogContext?.currentGroupId || null;

    state.inMoveDialogAnnotate = true;
    try {
      let changed = false;

      for (const row of rows) {
        const nameEl = row.querySelector(SELECTORS.modalListName);
        const countEl = row.querySelector(SELECTORS.modalListCount);
        if (!nameEl) continue;

        const name = cleanText(nameEl.textContent);
        const meta = parseListMeta(countEl?.textContent || '');
        const count = meta.count;

        if (name && Number.isFinite(count)) {
          if (rememberCustomCountByName(name, count)) {
            changed = true;
          }
        }

        const groupId = findGroupIdByName(name);

        const sideEl = nameEl.parentElement || row;
        let compactEl = sideEl.querySelector('.ae-wh-modal-compact');
        if (!compactEl) {
          compactEl = document.createElement('div');
          compactEl.className = 'ae-wh-modal-compact';
          sideEl.insertBefore(compactEl, nameEl);
        }

        let badgeWrap = compactEl.querySelector('.ae-wh-modal-badge-wrap');
        let badge = compactEl.querySelector('.ae-wh-modal-badge');
        let metaEl = compactEl.querySelector('.ae-wh-modal-meta');
        let currentSlotEl = compactEl.querySelector('.ae-wh-modal-current-slot');

        if (!badgeWrap) {
          badgeWrap = document.createElement('div');
          badgeWrap.className = 'ae-wh-modal-badge-wrap';
          compactEl.appendChild(badgeWrap);
        }

        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'ae-wh-modal-badge';
          badge.innerHTML = `
            <span class="ae-wh-badge__dot"></span>
            <span class="ae-wh-badge__text"></span>
          `;
          badgeWrap.appendChild(badge);
        }

        if (!metaEl) {
          metaEl = document.createElement('div');
          metaEl.className = 'ae-wh-modal-meta';
          compactEl.appendChild(metaEl);
        }

        if (!currentSlotEl) {
          currentSlotEl = document.createElement('div');
          currentSlotEl.className = 'ae-wh-modal-current-slot';
          compactEl.appendChild(currentSlotEl);
        }

        row.querySelectorAll('.ae-wh-modal-current-icon').forEach(el => el.remove());

        if (groupId) {
          const palette = paletteForGroup(groupId);

          badge.querySelector('.ae-wh-badge__text').textContent = name;
          badge.style.backgroundColor = palette.bg;
          badge.style.borderColor = palette.border;
          badge.style.color = palette.color;
          badge.querySelector('.ae-wh-badge__dot').style.backgroundColor = palette.dot;

          metaEl.innerHTML = `
            ${meta.visibility === 'private' ? '<span class="ae-wh-modal-privacy" title="Private">🔒</span>' : ''}
            ${meta.visibility === 'public' ? '<span class="ae-wh-modal-privacy" title="Public">🌐</span>' : ''}
            ${Number.isFinite(meta.count) ? `<span class="ae-wh-modal-count" title="${formatNumber(meta.count)} items">${formatNumber(meta.count)}</span>` : ''}
          `;

          nameEl.style.display = 'none';
          if (countEl) countEl.style.display = 'none';

          const nativeSelected = row.querySelector(SELECTORS.nativeSelectedIcon);
          const shouldMarkCurrent =
                !nativeSelected &&
                currentGroupId &&
                String(currentGroupId) === String(groupId);

          let customIcon = currentSlotEl.querySelector('.ae-wh-modal-current-icon');

          if (shouldMarkCurrent) {
            row.classList.add('ae-wh-modal-current');

            if (!customIcon) {
              customIcon = document.createElement('span');
              customIcon.className = 'ae-wh-modal-current-icon';
              customIcon.innerHTML = `
                <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M866.346667 266.432a32 32 0 0 1 49.344 40.618667l-2.090667 2.517333-467.477333 512a32 32 0 0 1-45.610667 1.685333l-2.325333-2.432L131.072 509.162667a32 32 0 0 1 46.336-44.010667l2.24 2.368L423.253333 751.701333l443.093334-485.269333z"></path>
                </svg>
              `;
              currentSlotEl.appendChild(customIcon);
            }
          } else {
            row.classList.remove('ae-wh-modal-current');
            if (customIcon) customIcon.remove();
          }
        } else {
          row.classList.remove('ae-wh-modal-current');
          nameEl.style.display = '';
          if (countEl) countEl.style.display = '';
          if (badgeWrap) badgeWrap.style.display = 'none';
          if (metaEl) metaEl.style.display = 'none';
          if (currentSlotEl) currentSlotEl.replaceChildren();
        }
      }

      if (changed) {
        scheduleSave();
        renderToolbar();
      }
    } finally {
      state.inMoveDialogAnnotate = false;
    }

    queueMoveDialogAutoLoad();
  }

  function parseCountFromText(text) {
    const match = String(text).match(/(\d[\d,]*)\s*item/i);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function parseListMeta(text) {
    const normalized = String(text || '').trim();
    return {
      visibility: /private/i.test(normalized)
        ? 'private'
        : /public/i.test(normalized)
          ? 'public'
          : 'unknown',
      count: parseCountFromText(normalized),
    };
  }

  function findGroupIdByName(name) {
    if (!name) return null;

    for (const [groupId, group] of Object.entries(state.groups)) {
      if (groupId === DEFAULT_GROUP_ID) continue;
      if (cleanText(group?.name) === name) return groupId;
    }

    return null;
  }

  function computeEstimatedDefaultTotal() {
    if (!Number.isFinite(state.totalCount)) return null;

    const customValues = Object.values(state.customCountsByName).filter(Number.isFinite);
    if (!customValues.length) return null;

    const sumCustom = customValues.reduce((sum, value) => sum + value, 0);
    const estimated = state.totalCount - sumCustom;
    return estimated >= 0 ? estimated : null;
  }

  function paletteForGroup(groupId) {
    if (String(groupId) === DEFAULT_GROUP_ID) {
      return {
        bg: '#d93025',
        border: '#d93025',
        color: '#ffffff',
        dot: '#ffffff',
      };
    }

    const slot = ensurePaletteSlot(groupId);
    return paletteForSlot(slot);
  }

  function unknownPalette() {
    return {
      bg: '#f3f4f6',
      border: '#d1d5db',
      color: '#4b5563',
      dot: '#6b7280',
    };
  }

  function formatNumber(value) {
    try {
      return new Intl.NumberFormat().format(value);
    } catch (_) {
      return String(value);
    }
  }
})();
