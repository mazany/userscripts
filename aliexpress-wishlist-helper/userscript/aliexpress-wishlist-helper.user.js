// ==UserScript==
// @name         AliExpress Wishlist Helper (Default Wishlist Filter)
// @namespace    https://userscripts.mazy.cc/
// @version      0.6.30
// @description  Adds clickable wishlist badges, filters, edit-mode helpers, and move-dialog enhancements to AliExpress wishlist management.
// @author       mazy
// @homepageURL  https://github.com/mazany/userscripts/tree/main/aliexpress-wishlist-helper
// @supportURL   https://github.com/mazany/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/mazany/userscripts/main/aliexpress-wishlist-helper/userscript/aliexpress-wishlist-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/mazany/userscripts/main/aliexpress-wishlist-helper/userscript/aliexpress-wishlist-helper.user.js
// @match        https://www.aliexpress.com/p/wish-manage/index.html*
// @match        https://www.aliexpress.com/p/wish-manage/detail.html*
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
    preferredMoveDialogPageSize: 16,
    itemGroupListFallbackPageSize: 10,
    backgroundItemGroupHydration: true,
    backgroundItemGroupHydrationDelayMs: 1200,
    backgroundItemGroupHydrationRetryDelayMs: 1800,
    backgroundItemGroupHydrationMaxAttempts: 6,
    backgroundItemGroupHydrationStaleMs: 1000 * 60 * 60 * 6,

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
    groups: Object.create(null),             // groupId -> { name, itemCount, visibility?, synthetic? }
    customCountsByName: Object.create(null), // name -> itemCount
    paletteSlots: Object.create(null),       // groupId -> stable palette slot
    nextPaletteSlot: 0,
    totalCount: null,
    pageType: null,
    filter: loadFilter(),
    saveTimer: 0,
    refreshTimer: 0,
    refreshNeedsFullCardScan: true,
    pendingRefreshCardRoots: new Set(),
    toolbarEl: null,
    loadedOrder: [],                         // itemId order as loaded in All items
    loadedOrderSet: new Set(),
    loadedCardStats: {
      defaultCount: 0,
      customCount: 0,
      unknownCount: 0,
      loadedCount: 0,
    },
    moveDialogContext: null,                 // { currentGroupId: string|null, selectedItemIds: string[] }
    itemGroupListRequest: null,              // last observed itemgroup.list request payload
    itemGroupListTotalCount: null,
    itemGroupListHydratedAt: null,
    itemGroupListHydrationPromise: null,
    wishlistRequestTemplates: Object.create(null),
    mtopItemGroupListPatchInstalled: false,
    backgroundItemGroupHydrationTimer: 0,
    backgroundItemGroupHydrationAttempts: 0,
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
      installMtopItemGroupListPatch();
      installDomObserver();
      scheduleRefresh();
      scheduleBackgroundItemGroupHydration();
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

      .ae-wh-badge--button {
        appearance: none;
        font: inherit;
        text-align: left;
        cursor: default;
        opacity: 1;
        user-select: none;
        -webkit-user-select: none;
      }

      .ae-wh-badge--clickable {
        cursor: pointer;
      }

      .ae-wh-badge--clickable:hover {
        filter: brightness(.98);
      }

      .ae-wh-badge--clickable:focus-visible {
        outline: 2px solid rgba(230, 0, 18, 0.24);
        outline-offset: 2px;
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
    hookXHR();
  }

  function installMtopItemGroupListPatch() {
    if (state.mtopItemGroupListPatchInstalled) return;

    const tryInstall = () => {
      const mtop = window.lib?.mtop;
      if (!mtop) return false;

      let patchedAny = false;

      if (typeof mtop.request === 'function' && !mtop.request.__aeWhItemGroupPatch) {
        const originalRequest = mtop.request;
        mtop.request = function patchedMtopRequest(params, success, failure) {
          return originalRequest.call(this, adjustItemGroupListRequestParams(params), success, failure);
        };
        mtop.request.__aeWhItemGroupPatch = true;
        patchedAny = true;
      }

      if (typeof mtop.H5Request === 'function' && !mtop.H5Request.__aeWhItemGroupPatch) {
        const originalH5Request = mtop.H5Request;
        mtop.H5Request = function patchedMtopH5Request(params, success, failure) {
          return originalH5Request.call(this, adjustItemGroupListRequestParams(params), success, failure);
        };
        mtop.H5Request.__aeWhItemGroupPatch = true;
        patchedAny = true;
      }

      if (patchedAny) {
        state.mtopItemGroupListPatchInstalled = true;
        return true;
      }

      return false;
    };

    if (tryInstall()) return;

    let attempts = 0;
    const maxAttempts = 120;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (tryInstall() || attempts >= maxAttempts) {
        window.clearInterval(timer);
      }
    }, 250);
  }

  function adjustItemGroupListRequestParams(params) {
    if (!params || typeof params !== 'object') return params;
    if (params.api !== 'mtop.aliexpress.wishlist.itemgroup.list') return params;

    const nextPageSize = Math.max(CONFIG.preferredMoveDialogPageSize, 1);
    const parsedData = normalizeItemGroupListRequestData(params.data);
    if (!parsedData || typeof parsedData !== 'object') return params;

    const previousPageSize = toFiniteOrNull(parsedData.pageSize);
    if (previousPageSize != null && previousPageSize >= nextPageSize) return params;

    return {
      ...params,
      data: JSON.stringify({
        ...parsedData,
        pageSize: nextPageSize,
      }),
    };
  }

  function normalizeItemGroupListRequestData(data) {
    if (!data) return null;
    if (typeof data === 'string') return parsePossiblyWrappedJson(data);
    if (typeof data === 'object') return data;
    return null;
  }

  function hookXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__aeWhMethod = method;
      this.__aeWhUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      observeWishlistRequest(
        this.__aeWhUrl,
        this.__aeWhMethod,
        args?.[0] ?? null
      );

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

      if (
        target.closest('.ae-wh-toolbar, .ae-wh-all-visible-wrap') ||
        footerAllLabel ||
        itemOverlay ||
        moreBtn
      ) {
        return;
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

  function isRelevantWishlistUrl(rawUrl) {
    if (!rawUrl) return false;

    try {
      const url = new URL(rawUrl, location.href);
      const api = (url.searchParams.get('api') || '').toLowerCase();
      return api === 'mtop.ae.wishlist.allitems.render' ||
             api === 'mtop.ae.wishlist.mylist.render' ||
             api === 'mtop.aliexpress.wishlist.itemgroup.list';
    } catch (_) {
      return false;
    }
  }

  function observeWishlistRequest(rawUrl, method, body) {
    const api = getApiName(rawUrl);
    if (!api || !api.includes('wishlist')) return;

    const data = extractRequestDataPayload(body);
    rememberWishlistRequestTemplate(api, rawUrl, method, data);

    if (api === 'mtop.aliexpress.wishlist.itemgroup.list' && data && typeof data === 'object') {
      state.itemGroupListRequest = {
        method: typeof method === 'string' ? method.toUpperCase() : '',
        api,
        url: rawUrl,
        data,
        capturedAt: Date.now(),
      };
    }
  }

  function rememberWishlistRequestTemplate(api, rawUrl, method, data) {
    state.wishlistRequestTemplates[api] = {
      method: typeof method === 'string' ? method.toUpperCase() : '',
      api,
      url: rawUrl,
      data,
      capturedAt: Date.now(),
    };
  }

  function buildItemGroupListRequest(pageNum = 1, overrides = {}) {
    const template =
      state.itemGroupListRequest ||
      state.wishlistRequestTemplates['mtop.aliexpress.wishlist.itemgroup.list'];

    const baseData = template?.data || getFallbackItemGroupListRequestData();
    if (!baseData) return null;

    const nextData = {
      ...baseData,
      ...overrides,
      pageNum,
      pageSize: toFiniteOrNull(overrides?.pageSize) || toFiniteOrNull(baseData.pageSize) || CONFIG.preferredMoveDialogPageSize,
      wishGroupId: null,
      onlyGroup: true,
    };

    return {
      api: 'mtop.aliexpress.wishlist.itemgroup.list',
      v: '2.0',
      type: 'post',
      dataType: 'originaljson',
      needLogin: true,
      data: JSON.stringify(nextData),
    };
  }

  function fetchItemGroupPage(pageNum = 1, overrides = {}) {
    const request = buildItemGroupListRequest(pageNum, overrides);
    if (!request) {
      return Promise.reject(new Error('No captured itemgroup.list request template available yet.'));
    }

    const mtopRequest = window.lib?.mtop?.H5Request;
    if (typeof mtopRequest !== 'function') {
      return Promise.reject(new Error('window.lib.mtop.H5Request is not available.'));
    }

    return new Promise((resolve, reject) => {
      try {
        mtopRequest(
          request,
          response => resolve(response),
          error => reject(error)
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async function fetchAllItemGroupPages(overrides = {}) {
    if (state.itemGroupListHydrationPromise) {
      return state.itemGroupListHydrationPromise;
    }

    const pageSize = getItemGroupListPageSize(overrides);
    const totalCount = toFiniteOrNull(state.itemGroupListTotalCount);
    const totalPages = totalCount != null
      ? Math.max(1, Math.ceil(totalCount / Math.max(pageSize, 1)))
      : 1;

    state.itemGroupListHydrationPromise = (async () => {
      let changed = false;
      const responses = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const response = await fetchItemGroupPage(pageNum, overrides);
        responses.push(response);
        changed = processFetchedItemGroupListResponse(response) || changed;
      }

      const hydratedAt = Date.now();
      if (state.itemGroupListHydratedAt !== hydratedAt) {
        state.itemGroupListHydratedAt = hydratedAt;
        changed = true;
      }

      if (changed) {
        scheduleSave();
        scheduleRefresh();
      }

      return {
        pageSize,
        totalCount,
        totalPages,
        changed,
        responses,
      };
    })();

    try {
      return await state.itemGroupListHydrationPromise;
    } finally {
      state.itemGroupListHydrationPromise = null;
    }
  }

  function processFetchedItemGroupListResponse(response) {
    if (!response || typeof response !== 'object') return false;
    return processApiPayload('mtop.aliexpress.wishlist.itemgroup.list', response);
  }

  function getItemGroupListPageSize(overrides = {}) {
    return Math.max(
      1,
      toFiniteOrNull(
        firstDefined(
          overrides?.pageSize,
          state.itemGroupListRequest?.data?.pageSize,
          state.wishlistRequestTemplates['mtop.aliexpress.wishlist.itemgroup.list']?.data?.pageSize,
          getFallbackItemGroupListRequestData()?.pageSize,
          CONFIG.itemGroupListFallbackPageSize,
        )
      ) || CONFIG.itemGroupListFallbackPageSize
    );
  }

  function getFallbackItemGroupListRequestData() {
    const candidates = [
      state.wishlistRequestTemplates['mtop.ae.wishlist.allitems.render']?.data,
      state.wishlistRequestTemplates['mtop.ae.wishlist.mylist.render']?.data,
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;

      const locale = cleanText(candidate.locale);
      const shipToCountry = cleanText(candidate.shipToCountry);
      const deviceType = cleanText(candidate.deviceType) || 'PC';
      const lang = cleanText(candidate._lang);
      const currency = cleanText(candidate._currency);

      if (!locale || !shipToCountry || !lang || !currency) continue;

      return {
        pageNum: 1,
        pageSize: CONFIG.preferredMoveDialogPageSize,
        locale,
        shipToCountry,
        deviceType,
        _lang: lang,
        _currency: currency,
        wishGroupId: null,
        onlyGroup: true,
      };
    }

    return null;
  }

  function scheduleBackgroundItemGroupHydration(delayMs = CONFIG.backgroundItemGroupHydrationDelayMs) {
    if (!CONFIG.backgroundItemGroupHydration) return;
    if (state.backgroundItemGroupHydrationTimer) return;

    state.backgroundItemGroupHydrationTimer = window.setTimeout(() => {
      state.backgroundItemGroupHydrationTimer = 0;
      runBackgroundItemGroupHydration();
    }, delayMs);
  }

  function runBackgroundItemGroupHydration() {
    runWhenBrowserIdle(() => {
      hydrateItemGroupListsInBackground().catch(() => {});
    }, 1500);
  }

  async function hydrateItemGroupListsInBackground(options = {}) {
    const { force = false } = options;

    if (!force && !shouldHydrateItemGroupListsInBackground()) {
      return { started: false, reason: 'not-needed' };
    }

    const request = buildItemGroupListRequest(1, {
      pageSize: CONFIG.preferredMoveDialogPageSize,
    });

    if (!request) {
      state.backgroundItemGroupHydrationAttempts += 1;

      if (state.backgroundItemGroupHydrationAttempts < CONFIG.backgroundItemGroupHydrationMaxAttempts) {
        scheduleBackgroundItemGroupHydration(CONFIG.backgroundItemGroupHydrationRetryDelayMs);
      }

      return { started: false, reason: 'request-unavailable' };
    }

    state.backgroundItemGroupHydrationAttempts = 0;
    const result = await fetchAllItemGroupPages({
      pageSize: CONFIG.preferredMoveDialogPageSize,
    });

    return {
      started: true,
      reason: 'hydrated',
      ...result,
    };
  }

  function shouldHydrateItemGroupListsInBackground() {
    const customGroupEntries = Object.entries(state.groups)
      .filter(([groupId, group]) => (
        groupId !== DEFAULT_GROUP_ID &&
        !group?.synthetic &&
        cleanText(group?.name)
      ));
    const customGroupCount = customGroupEntries.length;
    const totalCount = toFiniteOrNull(state.itemGroupListTotalCount);
    const hydratedAt = toFiniteOrNull(state.itemGroupListHydratedAt);

    if (customGroupCount === 0) return true;
    if (totalCount != null && customGroupCount < totalCount) return true;
    if (hydratedAt == null) return true;

    return Date.now() - hydratedAt > CONFIG.backgroundItemGroupHydrationStaleMs;
  }

  function runWhenBrowserIdle(callback, timeout = 1000) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => callback(), { timeout });
      return;
    }

    window.setTimeout(callback, 0);
  }

  function extractRequestDataPayload(body) {
    if (!body) return null;

    let rawData = '';

    if (typeof body === 'string') {
      rawData = new URLSearchParams(body).get('data') || '';
    } else if (body instanceof URLSearchParams) {
      rawData = body.get('data') || '';
    } else {
      return null;
    }

    if (!rawData) return null;

    try {
      return JSON.parse(rawData);
    } catch (_) {
      return null;
    }
  }

  function isElementVisible(el) {
    if (!(el instanceof Element)) return false;
    if (el.classList.contains('ae-wh-hidden-by-filter')) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function getVisibleCardRoots(cardRoots = null) {
    const roots = cardRoots || getCardRoots();
    return roots.filter(root => isElementVisible(root));
  }

  function isWishlistDetailPage() {
    return /\/p\/wish-manage\/detail\.html$/i.test(location.pathname);
  }

  function getWishlistViewMode() {
    if (isWishlistDetailPage()) return 'detail';
    if (state.pageType === 'GROUP_LIST') return 'group-list';
    if (state.pageType === 'PRODUCT_LIST') return 'all-items';
    return isAllItemsTabActive() ? 'all-items' : 'group-list';
  }

  function getCardCheckboxOverlay(cardRoot) {
    return cardRoot.querySelector(SELECTORS.checkboxOverlay);
  }

  function isCardChecked(cardRoot) {
    const label = cardRoot.querySelector(SELECTORS.checkboxLabelInCard);
    return !!label?.classList.contains('comet-v2-checkbox-checked');
  }

  function restoreWindowScroll(snapshot) {
    if (!snapshot) return;
    if (window.scrollX === snapshot.x && window.scrollY === snapshot.y) return;
    window.scrollTo(snapshot.x, snapshot.y);
  }

  function toggleCardSelection(cardRoot, shouldBeChecked, scrollSnapshot = null) {
    const overlay = getCardCheckboxOverlay(cardRoot);
    if (!overlay) return false;

    const currentlyChecked = isCardChecked(cardRoot);
    if (currentlyChecked === shouldBeChecked) return false;
    const fallbackSnapshot = scrollSnapshot || { x: window.scrollX, y: window.scrollY };

    // The disabled-looking overlay is the most reliable native click target in edit mode.
    // Clicking other checkbox descendants can miss the toggle or produce scroll jumps.
    overlay.click();

    if (!scrollSnapshot) restoreWindowScroll(fallbackSnapshot);
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

  function renderAllVisibleControl(options = {}) {
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
          const scrollSnapshot = { x: window.scrollX, y: window.scrollY };
          state.applyingAllVisible = true;
          try {
            for (const root of getCardRoots()) {
              toggleCardSelection(root, false, scrollSnapshot);
            }
          } finally {
            state.applyingAllVisible = false;
            restoreWindowScroll(scrollSnapshot);
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

    syncAllVisibleControl(options);
  }

  function syncAllVisibleControl(options = {}) {
    if (state.applyingAllVisible) return;
    const { cardRoots = null, skipMismatchCheck = false } = options;

    const wrap = document.querySelector('.ae-wh-all-visible-wrap');
    if (!wrap) return;

    const input = wrap.querySelector('.ae-wh-all-visible-input');
    if (!input) return;

    if (state.allVisibleMaster) {
      input.checked = true;
      input.indeterminate = false;

      if (!skipMismatchCheck && !state.reconcileScheduled && getAllVisibleMismatches(cardRoots).length) {
        scheduleReconcileVerification();
      }

      return;
    }

    const visibleRoots = getVisibleCardRoots(cardRoots);
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
    const scrollSnapshot = { x: window.scrollX, y: window.scrollY };
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
          changed = toggleCardSelection(root, false, scrollSnapshot) || changed;
        }
      }
    } finally {
      state.applyingAllVisible = false;
      restoreWindowScroll(scrollSnapshot);
    }

    return changed;
  }

  function reconcileAllVisibleSelection(cardRoots = null) {
    if (!state.allVisibleMaster || state.applyingAllVisible) return false;

    const roots = cardRoots || getCardRoots();
    const scrollSnapshot = { x: window.scrollX, y: window.scrollY };
    let changed = false;

    state.applyingAllVisible = true;
    try {
      for (const root of roots) {
        const itemId = root.dataset.aeWhItemId || '';
        const record = itemId ? state.items[itemId] || null : null;
        const shouldBeChecked = recordMatchesActiveFilter(record);

        changed = toggleCardSelection(root, shouldBeChecked, scrollSnapshot) || changed;
      }
    } finally {
      state.applyingAllVisible = false;
      restoreWindowScroll(scrollSnapshot);
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

    if (api === 'mtop.aliexpress.wishlist.itemgroup.list') {
      changed = processItemGroupListPayload(json, payload) || changed;
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

      changed = rememberGroupMeta(String(fields.groupId), {
        name: fields.name,
        itemCount: fields.itemCount,
      }) || changed;
    }

    return changed;
  }

  function processItemGroupListPayload(json, payload) {
    let changed = false;
    const totalCount = toFiniteOrNull(payload?.groupTotalCount);
    if (totalCount != null && totalCount !== state.itemGroupListTotalCount) {
      state.itemGroupListTotalCount = totalCount;
      changed = true;
    }

    const seenGroupIds = new Set();
    const exactEntries = extractExactItemGroupListEntries(payload);

    for (const entry of exactEntries) {
      if (!entry?.groupId || seenGroupIds.has(entry.groupId)) continue;
      seenGroupIds.add(entry.groupId);
      changed = rememberGroupMeta(entry.groupId, entry) || changed;
    }

    const roots = [payload, json?.data, json];

    for (const root of roots) {
      const entries = extractGroupEntries(root);
      for (const entry of entries) {
        if (!entry?.groupId || seenGroupIds.has(entry.groupId)) continue;
        seenGroupIds.add(entry.groupId);

        changed = rememberGroupMeta(entry.groupId, entry) || changed;
      }

      if (seenGroupIds.size) break;
    }

    return changed;
  }

  function extractExactItemGroupListEntries(payload) {
    const list = Array.isArray(payload?.groupList)
      ? payload.groupList
      : [];

    return list
      .map(entry => ({
        groupId: entry?.id != null ? String(entry.id) : '',
        name: entry?.name || entry?.groupName || '',
        itemCount: firstDefined(entry?.itemCount, entry?.itemNum, entry?.goodsNum, entry?.itemList?.length),
        visibility: entry?.isPublic,
      }))
      .filter(entry => entry.groupId && cleanText(entry.name));
  }

  function rememberGroupMeta(groupId, fields) {
    if (!groupId) return false;

    const prev = state.groups[groupId] || {};
    const next = {
      name: cleanText(fields?.name) || prev.name || `List ${groupId}`,
      itemCount: toFiniteOrNull(
        firstDefined(fields?.itemCount, fields?.count, fields?.itemNum, fields?.goodsNum)
      ) ?? prev.itemCount ?? null,
      visibility: cleanVisibility(
        firstDefined(fields?.visibility, fields?.privacy, fields?.groupVisibility, fields?.groupType)
      ) || prev.visibility || 'unknown',
      synthetic: false,
    };

    let changed = false;
    if (!shallowEqual(prev, next)) {
      state.groups[groupId] = next;
      changed = true;
    }

    if (next.name && Number.isFinite(next.itemCount)) {
      changed = rememberCustomCountByName(next.name, next.itemCount) || changed;
    }

    return changed;
  }

  function extractGroupEntries(root) {
    const entries = [];
    const seen = new Set();

    function visit(value, depth) {
      if (!value || depth > 6) return;

      if (Array.isArray(value)) {
        value.forEach(item => visit(item, depth + 1));
        return;
      }

      if (typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);

      const groupId = firstDefined(value.groupId, value.wishGroupId);
      const name = firstDefined(value.name, value.groupName, value.title, value.wishGroupName);
      if (groupId != null && typeof name === 'string' && cleanText(name)) {
        entries.push({
          groupId: String(groupId),
          name,
          itemCount: firstDefined(value.itemCount, value.count, value.itemNum, value.goodsNum),
          visibility: firstDefined(value.visibility, value.privacy, value.groupVisibility, value.groupType),
        });
      }

      for (const child of Object.values(value)) {
        visit(child, depth + 1);
      }
    }

    visit(root, 0);
    return entries;
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

  function toFiniteOrNull(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function firstDefined(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null) return value;
    }
    return null;
  }

  function cleanVisibility(value) {
    const normalized = cleanText(String(value || '')).toLowerCase();
    if (!normalized) return '';
    if (normalized === '1' || normalized.includes('private')) return 'private';
    if (normalized === '0' || normalized.includes('public')) return 'public';
    return normalized;
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

      if (Number.isFinite(parsed.itemGroupListTotalCount)) {
        state.itemGroupListTotalCount = parsed.itemGroupListTotalCount;
      }

      if (Number.isFinite(parsed.itemGroupListHydratedAt)) {
        state.itemGroupListHydratedAt = parsed.itemGroupListHydratedAt;
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
          itemGroupListTotalCount: state.itemGroupListTotalCount,
          itemGroupListHydratedAt: state.itemGroupListHydratedAt,
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

  function isHelperUiNode(node) {
    if (!(node instanceof Element)) return false;

    if (node.id === 'ae-wh-style') return true;

    return !!node.closest(
      '.ae-wh-toolbar, .ae-wh-meta-row, .ae-wh-all-visible-wrap, .ae-wh-modal-compact, .ae-wh-loadmore-spacer'
    );
  }

  function isMoveDialogNode(node) {
    return node instanceof Element &&
      (node.matches(SELECTORS.modal) || !!node.closest(SELECTORS.modal));
  }

  function isRelevantGlobalMutationTarget(node) {
    if (!(node instanceof Element) || isHelperUiNode(node)) return false;

    if (isMoveDialogNode(node)) {
      return node.matches(SELECTORS.modal);
    }

    return !!(
      node.matches?.(SELECTORS.tabsHeader) ||
      node.closest?.(SELECTORS.tabsHeader) ||
      node.matches?.(SELECTORS.editItemWrap) ||
      node.closest?.(SELECTORS.editItemWrap) ||
      node.matches?.(SELECTORS.footerBarCheckboxLabel) ||
      node.closest?.(SELECTORS.footerBarCheckboxLabel)
    );
  }

  function isRelevantGlobalMutationNode(node) {
    if (!(node instanceof Element) || isHelperUiNode(node)) return false;

    if (node.matches?.(SELECTORS.modal) || node.querySelector?.(SELECTORS.modal)) {
      return true;
    }

    if (isMoveDialogNode(node)) {
      return false;
    }

    return !!(
      node.matches?.(SELECTORS.editItemWrap) ||
      node.querySelector?.(SELECTORS.editItemWrap) ||
      node.matches?.(SELECTORS.productCard) ||
      node.querySelector?.(SELECTORS.productCard) ||
      node.matches?.(SELECTORS.tabsHeader) ||
      node.querySelector?.(SELECTORS.tabsHeader) ||
      node.matches?.(SELECTORS.footerBarCheckboxLabel) ||
      node.querySelector?.(SELECTORS.footerBarCheckboxLabel)
    );
  }

  function collectCardRootsFromNode(node, cardRoots) {
    if (!(node instanceof Element) || isHelperUiNode(node)) return;

    if (node.matches?.(SELECTORS.editItemWrap)) {
      cardRoots.add(node);
    }

    if (node.querySelectorAll) {
      node.querySelectorAll(SELECTORS.editItemWrap).forEach(root => cardRoots.add(root));
    }

    if (node.matches?.(SELECTORS.productCard)) {
      cardRoots.add(node.closest(SELECTORS.editItemWrap) || node);
    }

    if (node.querySelectorAll) {
      node.querySelectorAll(SELECTORS.productCard).forEach(card => {
        cardRoots.add(card.closest(SELECTORS.editItemWrap) || card);
      });
    }

    const ancestorRoot = node.closest?.(SELECTORS.editItemWrap);
    if (ancestorRoot) {
      cardRoots.add(ancestorRoot);
    }
  }

  function installDomObserver() {
    const observer = new MutationObserver(mutations => {
      let relevant = false;
      let needsFullRefresh = false;
      const affectedCardRoots = new Set();

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (isRelevantGlobalMutationTarget(mutation.target)) {
            relevant = true;

            if (
              mutation.target instanceof Element &&
              (
                mutation.target.matches?.(SELECTORS.tabsHeader) ||
                mutation.target.closest?.(SELECTORS.tabsHeader) ||
                mutation.target.matches?.(SELECTORS.footerBarCheckboxLabel) ||
                mutation.target.closest?.(SELECTORS.footerBarCheckboxLabel) ||
                mutation.target.matches?.(SELECTORS.modal)
              )
            ) {
              needsFullRefresh = true;
            } else {
              collectCardRootsFromNode(mutation.target, affectedCardRoots);
            }

            break;
          }
        }

        for (const node of mutation.addedNodes) {
          if (isRelevantGlobalMutationNode(node)) {
            relevant = true;

            if (
              node instanceof Element &&
              (
                node.matches?.(SELECTORS.tabsHeader) ||
                node.querySelector?.(SELECTORS.tabsHeader) ||
                node.matches?.(SELECTORS.footerBarCheckboxLabel) ||
                node.querySelector?.(SELECTORS.footerBarCheckboxLabel) ||
                node.matches?.(SELECTORS.modal) ||
                node.querySelector?.(SELECTORS.modal)
              )
            ) {
              needsFullRefresh = true;
            } else {
              collectCardRootsFromNode(node, affectedCardRoots);
            }

            break;
          }
        }

        if (relevant) break;

        for (const node of mutation.removedNodes) {
          if (isRelevantGlobalMutationNode(node)) {
            relevant = true;

            if (
              node instanceof Element &&
              (
                node.matches?.(SELECTORS.tabsHeader) ||
                node.querySelector?.(SELECTORS.tabsHeader) ||
                node.matches?.(SELECTORS.footerBarCheckboxLabel) ||
                node.querySelector?.(SELECTORS.footerBarCheckboxLabel) ||
                node.matches?.(SELECTORS.modal) ||
                node.querySelector?.(SELECTORS.modal)
              )
            ) {
              needsFullRefresh = true;
            } else {
              collectCardRootsFromNode(node, affectedCardRoots);
            }

            break;
          }
        }

        if (relevant) break;
      }

      if (relevant) {
        if (!needsFullRefresh && affectedCardRoots.size > 0) {
          scheduleRefresh({ cardRoots: [...affectedCardRoots] });
        } else {
          scheduleRefresh();
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  }

  function scheduleRefresh(options = null) {
    const cardRoots = Array.isArray(options?.cardRoots) ? options.cardRoots : null;

    if (cardRoots && cardRoots.length && !state.refreshNeedsFullCardScan) {
      cardRoots.forEach(root => {
        if (root instanceof Element) {
          state.pendingRefreshCardRoots.add(root);
        }
      });
    } else {
      state.refreshNeedsFullCardScan = true;
    }

    if (state.refreshTimer) return;

    state.refreshTimer = window.requestAnimationFrame(() => {
      state.refreshTimer = 0;

      const fullCardScan =
        state.refreshNeedsFullCardScan || state.pendingRefreshCardRoots.size === 0;
      const roots = fullCardScan
        ? getCardRoots()
        : [...state.pendingRefreshCardRoots];

      state.refreshNeedsFullCardScan = false;
      state.pendingRefreshCardRoots.clear();

      ensureCardItemIds(roots.filter(root => root instanceof Element && root.isConnected));
      const editModeActive = isEditModeActive();

      renderToolbar();
      annotateAndFilterCards(roots, { fullScan: fullCardScan });
      renderAllVisibleControl({
        cardRoots: fullCardScan ? roots : null,
        skipMismatchCheck: state.allVisibleMaster && editModeActive,
      });
      annotateMoveDialog();

      if (state.allVisibleMaster && editModeActive && !state.reconcileScheduled) {
        scheduleReconcileVerification();
      }
    });
  }

  function attachMoveDialogObserver(modal) {
    if (state.modalObserver && state.modalObserver.__aeWhModal === modal) return;

    detachMoveDialogObserver();

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

  function detachMoveDialogObserver() {
    if (state.modalObserver) {
      state.modalObserver.disconnect();
      state.modalObserver = null;
    }

    state.moveDialogAutoLoadRunning = false;
    state.moveDialogAutoLoadQueued = false;
    state.moveDialogAutoLoadDone = false;
    state.moveDialogLastRowCount = 0;
  }

  function detachMoveDialogObserverIfNeeded() {
    const modal = document.querySelector(SELECTORS.modal);
    if (modal && isMoveDialogVisible(modal)) return;
    detachMoveDialogObserver();
  }

  function isMoveDialogVisible(modal = null) {
    const root = modal || document.querySelector(SELECTORS.modal);
    if (!root || !document.contains(root)) return false;

    const style = window.getComputedStyle(root);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false;
    }

    return root.getClientRects().length > 0;
  }

  function isMoveDialogTitleMatch(modal = null) {
    const root = modal || document.querySelector(SELECTORS.modal);
    if (!root) return false;

    const title = root.querySelector(SELECTORS.modalTitle)?.textContent?.trim() || '';
    return /move to another list/i.test(title);
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
    if (!shouldFallbackMoveDialogAutoLoad()) return;

    const modal = document.querySelector(SELECTORS.modal);
    if (!isMoveDialogVisible(modal) || !isMoveDialogTitleMatch(modal)) return;

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
    if (!shouldFallbackMoveDialogAutoLoad()) return false;

    const modal = document.querySelector(SELECTORS.modal);
    if (!isMoveDialogVisible(modal) || !isMoveDialogTitleMatch(modal)) return false;

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

  function shouldFallbackMoveDialogAutoLoad() {
    const totalCount = toFiniteOrNull(state.itemGroupListTotalCount);
    if (totalCount == null) return true;
    return totalCount > CONFIG.preferredMoveDialogPageSize;
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
    return getWishlistViewMode() === 'all-items';
  }

  function isAllItemsTabActive() {
    const active = document.querySelector(SELECTORS.activeTab);
    if (!active) return true;

    const text = active.querySelector(SELECTORS.activeTabText)?.textContent?.trim()?.toLowerCase() || '';
    return text.startsWith('all items');
  }

  function getCardRoots() {
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
      if (root.dataset.aeWhItemId) return;

      const operator = root.querySelector(SELECTORS.operator);
      const operatorId = operator ? extractItemIdFromOperator(operator) : null;

      if (operatorId) {
        root.dataset.aeWhItemId = operatorId;
        return;
      }

      const byOrder = state.loadedOrder[index];
      if (byOrder) {
        root.dataset.aeWhItemId = byOrder;
      }
    });
  }

  function updateLoadedCardStats(counts, category, delta) {
    if (!category || !delta) return;

    if (category === FILTERS.DEFAULT) {
      counts.defaultCount += delta;
    } else if (category === FILTERS.CUSTOM) {
      counts.customCount += delta;
    } else if (category === FILTERS.UNKNOWN) {
      counts.unknownCount += delta;
    }
  }

  function getRecordCategory(record) {
    if (!record) return FILTERS.UNKNOWN;
    return record.g === DEFAULT_GROUP_ID ? FILTERS.DEFAULT : FILTERS.CUSTOM;
  }

  function annotateAndFilterCards(cardRoots = null, options = {}) {
    const inAllItems = shouldShowToolbar();
    const roots = cardRoots || getCardRoots();
    const fullScan = options.fullScan !== false;

    let counts = fullScan
      ? {
          defaultCount: 0,
          customCount: 0,
          unknownCount: 0,
          loadedCount: 0,
        }
      : { ...state.loadedCardStats };

    for (const cardRoot of roots) {
      if (!(cardRoot instanceof Element)) continue;

      const previousCategory = cardRoot.dataset.aeWhCategory || '';

      if (
        !cardRoot.isConnected ||
        !(cardRoot.matches?.(SELECTORS.productCard) || cardRoot.querySelector(SELECTORS.productCard))
      ) {
        if (!fullScan && previousCategory) {
          updateLoadedCardStats(counts, previousCategory, -1);
          delete cardRoot.dataset.aeWhCategory;
        }
        continue;
      }

      const itemId = cardRoot.dataset.aeWhItemId || '';
      const record = itemId ? state.items[itemId] || null : null;
      const nextCategory = getRecordCategory(record);

      if (fullScan) {
        updateLoadedCardStats(counts, nextCategory, 1);
      } else if (previousCategory !== nextCategory) {
        updateLoadedCardStats(counts, previousCategory, -1);
        updateLoadedCardStats(counts, nextCategory, 1);
      }
      cardRoot.dataset.aeWhCategory = nextCategory;

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

    counts.loadedCount = counts.defaultCount + counts.customCount + counts.unknownCount;
    state.loadedCardStats = counts;

    updateButtonCounts(counts);
  }

  function extractItemIdFromOperator(operator) {
    const raw = operator.getAttribute('data-id') || '';
    const match = raw.match(/^operator_(\d+)$/);
    return match ? match[1] : null;
  }

  function upsertBadge(cardRoot, itemId, record) {
    const titleRow = cardRoot.querySelector(SELECTORS.titleRow);
    if (!titleRow) return;

    // Keep the badge anchored just below the title row because this survives card rerenders
    // more consistently than deeper product-card subtrees with hashed class names.
    const parent = titleRow.parentElement || titleRow;
    let metaRow = parent.querySelector('.ae-wh-meta-row');

    if (!metaRow) {
      metaRow = document.createElement('div');
      metaRow.className = 'ae-wh-meta-row';
      titleRow.insertAdjacentElement('afterend', metaRow);
    }

    let badge = metaRow.querySelector('.ae-wh-badge');
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'ae-wh-badge ae-wh-badge--button';
      badge.innerHTML = `
        <span class="ae-wh-badge__dot"></span>
        <span class="ae-wh-badge__text"></span>
      `;
      badge.addEventListener('click', onProductBadgeClick);
      metaRow.appendChild(badge);
    }

    let label = 'Unknown';
    let palette = unknownPalette();
    let groupId = '';
    let title = '';
    let ariaLabel = '';

    if (record) {
      groupId = record.g;
      const group = state.groups[groupId];
      label = groupId === DEFAULT_GROUP_ID
        ? 'Default wishlist'
        : (group?.name || `List ${groupId}`);

      palette = paletteForGroup(groupId);
    }

    const clickable =
      !!record &&
      (groupId !== DEFAULT_GROUP_ID || state.filter === FILTERS.ALL);

    if (clickable && groupId !== DEFAULT_GROUP_ID) {
      title = `Open wishlist "${label}"\nCtrl+click to open in a new tab\nShift+click to open in a new window`;
      ariaLabel = `Open wishlist ${label}`;
    } else if (clickable) {
      title = 'Show only Default wishlist items';
      ariaLabel = 'Filter to Default wishlist';
    }

    const badgeSignature = [
      label,
      palette.bg,
      palette.border,
      palette.color,
      palette.dot,
      clickable ? '1' : '0',
      groupId,
      title,
      ariaLabel,
    ].join('|');

    if (badge.dataset.aeWhBadgeSig === badgeSignature) {
      return;
    }
    badge.dataset.aeWhBadgeSig = badgeSignature;

    badge.dataset.aeWhGroupId = groupId;
    badge.querySelector('.ae-wh-badge__text').textContent = label;
    badge.style.backgroundColor = palette.bg;
    badge.style.borderColor = palette.border;
    badge.style.color = palette.color;
    badge.querySelector('.ae-wh-badge__dot').style.backgroundColor = palette.dot;
    badge.disabled = !clickable;
    badge.classList.toggle('ae-wh-badge--clickable', clickable);

    if (title) {
      badge.title = title;
    } else {
      badge.removeAttribute('title');
    }

    if (ariaLabel) {
      badge.setAttribute('aria-label', ariaLabel);
    } else {
      badge.removeAttribute('aria-label');
    }
  }

  function removeBadge(cardRoot) {
    cardRoot.querySelectorAll('.ae-wh-meta-row').forEach(el => el.remove());
  }

  function onProductBadgeClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const badge = event.currentTarget;
    if (!(badge instanceof HTMLButtonElement) || badge.disabled) return;

    const groupId = badge.dataset.aeWhGroupId || '';
    if (!groupId) return;

    if (groupId === DEFAULT_GROUP_ID) {
      if (state.filter === FILTERS.ALL) {
        setFilter(FILTERS.DEFAULT);
      }
      return;
    }

    const url = buildWishlistGroupUrl(groupId);
    if (event.ctrlKey || event.metaKey) {
      openUrlInNewTab(url);
      return;
    }

    if (event.shiftKey) {
      openUrlInNewWindow(url);
      return;
    }

    location.assign(url);
  }

  function openUrlInNewTab(url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function openUrlInNewWindow(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function buildWishlistGroupUrl(groupId) {
    const url = new URL('/p/wish-manage/detail.html', location.origin);
    url.searchParams.set('wishGroupId', String(groupId));
    return url.toString();
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
    if (!isMoveDialogVisible(modal)) {
      detachMoveDialogObserver();
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

    if (!isMoveDialogTitleMatch(modal)) return;

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
        const nativeSelected = row.querySelector(SELECTORS.nativeSelectedIcon);
        const rowSignature = [
          name,
          groupId || '',
          meta.visibility,
          Number.isFinite(meta.count) ? String(meta.count) : '',
          currentGroupId || '',
          nativeSelected ? '1' : '0',
        ].join('|');

        if (row.dataset.aeWhModalSig === rowSignature) {
          continue;
        }

        // The name/count container is the most stable insertion point we have found for dialog
        // row augmentation across rerenders and pagination updates.
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
        row.dataset.aeWhModalSig = rowSignature;

        if (groupId) {
          const palette = paletteForGroup(groupId);

          badge.querySelector('.ae-wh-badge__text').textContent = name;
          badge.style.backgroundColor = palette.bg;
          badge.style.borderColor = palette.border;
          badge.style.color = palette.color;
          badge.querySelector('.ae-wh-badge__dot').style.backgroundColor = palette.dot;
          badgeWrap.style.display = '';
          metaEl.style.display = '';

          let privacyEl = metaEl.querySelector('.ae-wh-modal-privacy');
          if (!privacyEl) {
            privacyEl = document.createElement('span');
            privacyEl.className = 'ae-wh-modal-privacy';
            metaEl.appendChild(privacyEl);
          }

          let countValueEl = metaEl.querySelector('.ae-wh-modal-count');
          if (!countValueEl) {
            countValueEl = document.createElement('span');
            countValueEl.className = 'ae-wh-modal-count';
            metaEl.appendChild(countValueEl);
          }

          if (meta.visibility === 'private') {
            privacyEl.textContent = '🔒';
            privacyEl.title = 'Private';
            privacyEl.style.display = '';
          } else if (meta.visibility === 'public') {
            privacyEl.textContent = '🌐';
            privacyEl.title = 'Public';
            privacyEl.style.display = '';
          } else {
            privacyEl.style.display = 'none';
            privacyEl.removeAttribute('title');
          }

          if (Number.isFinite(meta.count)) {
            countValueEl.textContent = formatNumber(meta.count);
            countValueEl.title = `${formatNumber(meta.count)} items`;
            countValueEl.style.display = '';
          } else {
            countValueEl.textContent = '';
            countValueEl.style.display = 'none';
            countValueEl.removeAttribute('title');
          }

          nameEl.style.display = 'none';
          if (countEl) countEl.style.display = 'none';

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
          badgeWrap.style.display = 'none';
          metaEl.style.display = 'none';
          currentSlotEl.replaceChildren();
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
