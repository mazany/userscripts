// ==UserScript==
// @name         Generic Browser Font Override
// @namespace    https://example.com/
// @version      0.5.1
// @description  Safely override font-family in CSS variables and normal CSS rules, with @font-face-aware classification.
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    debug: true,

    fonts: {
      mono: `'Maple Mono NF', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace`,
      sans: `'Google Sans Flex Rounded', 'Inter', 'Segoe UI', system-ui, sans-serif`,
      serif: `'Google Sans Flex Rounded', 'Inter', 'Segoe UI', system-ui, sans-serif`,
      //serif: `'Source Serif 4', 'Georgia', 'Times New Roman', serif`,
    },

    maxResolveDepth: 12,
    rescanDelaysMs: [300, 1200, 3000],
    periodicRescanMs: 10000,

    addMonoTuning: true,

    enableVariableOverrides: true,
    enableRuleFontFamilyOverrides: true,

    maxSelectorLength: 500,
    skipSelectorsMatching: [
      /@/i,
    ],
  };

  const STATE = {
    styleEl: null,
    lastCss: '',
    allVars: new Map(),          // --name -> { rawValue, source, selectors:Set }
    fontFaceIndex: new Map(),    // familyLower -> [{ family, src, fontStyle, fontWeight, source }]
    varAnalysis: [],
    ruleAnalysis: [],
  };

  function log(...args) {
    if (CONFIG.debug) {
      console.log('[font-override]', ...args);
    }
  }

  function norm(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function stripQuotes(value) {
    return norm(value).replace(/^["']|["']$/g, '').trim();
  }

  function ensureStyleEl() {
    if (STATE.styleEl && document.contains(STATE.styleEl)) {
      return STATE.styleEl;
    }

    const el = document.createElement('style');
    el.id = 'tm-generic-font-override';
    (document.head || document.documentElement).appendChild(el);
    STATE.styleEl = el;
    return el;
  }

  function shouldUseSelector(selector) {
    selector = norm(selector);
    if (!selector) return false;
    if (selector.length > CONFIG.maxSelectorLength) return false;

    for (const re of CONFIG.skipSelectorsMatching) {
      if (re.test(selector)) return false;
    }
    return true;
  }

  function addVar(map, name, value, source, selectorText = '') {
    name = norm(name);
    value = norm(value);
    selectorText = norm(selectorText);

    if (!name.startsWith('--') || !value) return;

    if (!map.has(name)) {
      map.set(name, {
        rawValue: value,
        source,
        selectors: new Set(selectorText ? [selectorText] : []),
      });
    } else if (selectorText) {
      map.get(name).selectors.add(selectorText);
    }
  }

  function addFontFace(fontFaceIndex, family, meta) {
    const familyKey = stripQuotes(family).toLowerCase();
    if (!familyKey) return;

    if (!fontFaceIndex.has(familyKey)) {
      fontFaceIndex.set(familyKey, []);
    }
    fontFaceIndex.get(familyKey).push(meta);
  }

  function looksLikeColor(value) {
    const v = lower(value);
    return (
      /^#([0-9a-f]{3,8})$/.test(v) ||
      /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/.test(v) ||
      /^(transparent|currentcolor|inherit|initial|unset)$/.test(v)
    );
  }

  function looksLikeSimpleMetric(value) {
    const v = lower(value);
    return (
      /^-?\d+(\.\d+)?$/.test(v) ||
      /^-?\d+(\.\d+)?(px|r?em|%|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc)$/.test(v) ||
      /^(normal|bold|bolder|lighter|italic|oblique)$/.test(v) ||
      /^(calc|min|max|clamp)\(/.test(v)
    );
  }

  function containsGenericFamily(value) {
    const v = lower(value);
    return [
      'monospace',
      'sans-serif',
      'serif',
      'system-ui',
      'ui-monospace',
      'ui-sans-serif',
      'ui-serif',
      'emoji',
      'math',
      'fangsong',
      'cursive',
      'fantasy',
    ].some(token => v.includes(token));
  }

  function containsQuotedFamily(value) {
    return /(["']).+?\1/.test(value);
  }

  function containsFontSizeToken(value) {
    const v = lower(value);
    return /\b\d+(\.\d+)?(px|pt|pc|em|rem|%)\b/.test(v);
  }

  function looksLikeFontShorthand(value) {
    value = norm(value);
    if (!value) return false;
    if (looksLikeColor(value)) return false;

    const hasVarRefs = /var\(--[\w-]+\)/.test(value);
    const hasFontishSignal = containsGenericFamily(value) || containsQuotedFamily(value) || hasVarRefs;

    if (!hasFontishSignal) return false;
    if (value.includes('/')) return true;
    if (containsFontSizeToken(value)) return true;
    if (/var\(--[\w-]+\).*var\(--[\w-]+\)/.test(value)) return true;

    return false;
  }

  function looksLikePureFontFamilyList(value) {
    value = norm(value);
    if (!value) return false;
    if (looksLikeColor(value)) return false;
    if (looksLikeSimpleMetric(value)) return false;
    if (value.includes('/')) return false;
    if (containsFontSizeToken(value)) return false;
    if (/^var\(--[\w-]+\)$/.test(value)) return false;
    if (/var\(--[\w-]+\)/.test(value)) return false;
    if (/^(none|auto)$/.test(lower(value))) return false;
    if (/^url\(/i.test(value)) return false;
    if (/[{}]/.test(value)) return false;

    if (containsGenericFamily(value)) return true;
    if (containsQuotedFamily(value)) return true;
    if (value.includes(',') && !/[;:]/.test(value)) return true;

    return false;
  }

  function splitFontFamilies(value) {
    return norm(value)
      .split(',')
      .map(part => stripQuotes(part))
      .filter(Boolean);
  }

  function classifyFromKnownNames(value) {
    if (/(maple mono|jetbrains mono|fira code|cascadia code|consolas|menlo|monaco|source code pro|ibm plex mono|sfmono|berkeley mono)/i.test(value)) {
      return 'mono';
    }

    if (/(google sans|inter|segoe ui|arial|helvetica|calibri|roboto|open sans|noto sans|ubuntu|sf pro|geist|geist-fallback)/i.test(value)) {
      return 'sans';
    }

    if (/(source serif|georgia|times new roman|garamond|cambria|palatino|merriweather|baskerville)/i.test(value)) {
      return 'serif';
    }

    return null;
  }

  function classifyFromGenericFamilies(value) {
    const v = lower(value);

    if (
      v.includes('monospace') ||
      v.includes('ui-monospace')
    ) {
      return 'mono';
    }

    if (
      v.includes('sans')
      //v.includes('sans-serif') ||
      //v.includes('system-ui') ||
      //v.includes('ui-sans-serif')
    ) {
      return 'sans';
    }

    if (
      v.includes('ui-serif') ||
      (/\bserif\b/.test(v) && !v.includes('sans-serif'))
    ) {
      return 'serif';
    }


    return null;
  }

  function classifyFromFontFaceFamily(family, fontFaceIndex) {
    const faces = fontFaceIndex.get(stripQuotes(family).toLowerCase());
    if (!faces || !faces.length) return null;

    let mono = 0;
    let sans = 0;
    let serif = 0;

    for (const face of faces) {
      const src = lower(face.src);
      const familyName = lower(face.family);

      if (/\bmono\b|monospace|code|console|terminal/.test(src) || /\bmono\b|monospace|code|console|terminal/.test(familyName)) {
        mono += 4;
      }
      if (/\bsans\b/.test(src) || /\bsans\b/.test(familyName)) {
        sans += 3;
      }
      if (/\bserif\b/.test(src) || /\bserif\b/.test(familyName)) {
        serif += 3;
      }
    }

    if (mono > sans && mono > serif) return 'mono';
    if (sans > mono && sans > serif) return 'sans';
    if (serif > mono && serif > sans) return 'serif';

    return null;
  }

  function classifyFontCategory(value, fontFaceIndex) {
    const families = splitFontFamilies(value);

    const directKnown = classifyFromKnownNames(value);
    if (directKnown === 'mono' || directKnown === 'serif') {
      return directKnown;
    }

    for (const family of families) {
      const fromFace = classifyFromFontFaceFamily(family, fontFaceIndex);
      if (fromFace) return fromFace;
    }

    const generic = classifyFromGenericFamilies(value);
    if (generic) return generic;

    if (directKnown) return directKnown;

    return null;
  }

  function resolveValue(rawValue, allVars, depth = 0, seen = new Set()) {
    rawValue = norm(rawValue);
    if (!rawValue) return { value: rawValue, unresolved: false };
    if (depth > CONFIG.maxResolveDepth) return { value: rawValue, unresolved: true };

    const exactVarMatch = rawValue.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
    if (!exactVarMatch) {
      return { value: rawValue, unresolved: /var\(--[\w-]+\)/.test(rawValue) };
    }

    const ref = exactVarMatch[1];
    const fallback = exactVarMatch[2] ? norm(exactVarMatch[2]) : '';

    if (seen.has(ref)) {
      return { value: fallback || rawValue, unresolved: true };
    }
    seen.add(ref);

    const refMeta = allVars.get(ref);
    if (!refMeta) {
      return { value: fallback || rawValue, unresolved: true };
    }

    return resolveValue(refMeta.rawValue, allVars, depth + 1, seen);
  }

  function collectFromStyleSheets() {
    const vars = new Map();
    const fontRules = [];
    const fontFaceIndex = new Map();

    function walkRules(rules, source) {
      if (!rules) return;

      for (const rule of Array.from(rules)) {
        try {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            const family = norm(rule.style.getPropertyValue('font-family'));
            const src = norm(rule.style.getPropertyValue('src'));
            const fontStyle = norm(rule.style.getPropertyValue('font-style'));
            const fontWeight = norm(rule.style.getPropertyValue('font-weight'));

            if (family) {
              addFontFace(fontFaceIndex, family, {
                family: stripQuotes(family),
                src,
                fontStyle,
                fontWeight,
                source,
              });
            }
          }

          if (rule.style && rule.selectorText) {
            const selectorText = norm(rule.selectorText);

            for (let i = 0; i < rule.style.length; i++) {
              const prop = rule.style[i];

              if (prop.startsWith('--')) {
                addVar(vars, prop, rule.style.getPropertyValue(prop), source, selectorText);
                continue;
              }

              if (
                CONFIG.enableRuleFontFamilyOverrides &&
                prop === 'font-family'
              ) {
                const rawValue = norm(rule.style.getPropertyValue(prop));
                if (rawValue) {
                  fontRules.push({
                    selectorText,
                    rawValue,
                    source,
                  });
                }
              }
            }
          }

          if (rule.cssRules) {
            walkRules(rule.cssRules, source);
          }
        } catch {
          // Ignore per-rule failures.
        }
      }
    }

    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walkRules(sheet.cssRules, sheet.href || 'inline-stylesheet');
      } catch {
        // Cross-origin stylesheet access may fail.
      }
    }

    return { vars, fontRules, fontFaceIndex };
  }

  function collectVarsFromComputedRoot() {
    const vars = new Map();
    const root = getComputedStyle(document.documentElement);

    for (let i = 0; i < root.length; i++) {
      const prop = root[i];
      if (!prop.startsWith('--')) continue;
      addVar(vars, prop, root.getPropertyValue(prop), 'computed-root', ':root');
    }

    return vars;
  }

  function mergeFontFaceIndexes(indexA, indexB) {
    const result = new Map();

    for (const index of [indexA, indexB]) {
      for (const [family, faces] of index.entries()) {
        if (!result.has(family)) result.set(family, []);
        result.get(family).push(...faces);
      }
    }

    return result;
  }

  function collectAll() {
    const stylesheetData = collectFromStyleSheets();
    const computedVars = collectVarsFromComputedRoot();

    const allVars = new Map();

    for (const sourceMap of [stylesheetData.vars, computedVars]) {
      for (const [name, meta] of sourceMap.entries()) {
        if (!allVars.has(name)) {
          allVars.set(name, {
            rawValue: meta.rawValue,
            source: meta.source,
            selectors: new Set(meta.selectors || []),
          });
        } else {
          const target = allVars.get(name);
          for (const sel of meta.selectors || []) {
            target.selectors.add(sel);
          }
        }
      }
    }

    STATE.allVars = allVars;
    STATE.fontFaceIndex = mergeFontFaceIndexes(stylesheetData.fontFaceIndex, new Map());

    return {
      allVars,
      fontRules: stylesheetData.fontRules,
      fontFaceIndex: STATE.fontFaceIndex,
    };
  }

  function analyzeVariables() {
    if (!CONFIG.enableVariableOverrides) {
      STATE.varAnalysis = [];
      return [];
    }

    const rows = [];

    for (const [name, meta] of STATE.allVars.entries()) {
      const rawValue = norm(meta.rawValue);
      const resolved = resolveValue(rawValue, STATE.allVars);
      const resolvedValue = norm(resolved.value);

      let action = 'skip';
      let reason = 'non-font';
      let category = null;

      if (looksLikeFontShorthand(rawValue) || looksLikeFontShorthand(resolvedValue)) {
        action = 'skip';
        reason = 'shorthand';
      } else if (resolved.unresolved && /var\(--[\w-]+\)/.test(resolvedValue)) {
        action = 'skip';
        reason = 'unresolved';
      } else if (looksLikePureFontFamilyList(resolvedValue)) {
        category = classifyFontCategory(resolvedValue, STATE.fontFaceIndex);
        if (category) {
          action = 'override';
          reason = 'pure-font-family';
        }
      }

      rows.push({
        kind: 'var',
        name,
        source: meta.source,
        selectors: new Set(meta.selectors || []),
        rawValue,
        resolvedValue,
        unresolved: resolved.unresolved,
        action,
        reason,
        category,
      });
    }

    STATE.varAnalysis = rows;
    return rows;
  }

  function analyzeFontRules(fontRules) {
    if (!CONFIG.enableRuleFontFamilyOverrides) {
      STATE.ruleAnalysis = [];
      return [];
    }

    const rows = [];

    for (const rule of fontRules) {
      const rawValue = norm(rule.rawValue);

      let action = 'skip';
      let reason = 'non-font';
      let category = null;

      if (!shouldUseSelector(rule.selectorText)) {
        action = 'skip';
        reason = 'invalid-selector';
      } else if (looksLikeFontShorthand(rawValue)) {
        action = 'skip';
        reason = 'shorthand';
      } else if (looksLikePureFontFamilyList(rawValue)) {
        category = classifyFontCategory(rawValue, STATE.fontFaceIndex);
        if (category) {
          action = 'override';
          reason = 'font-family';
        }
      }

      rows.push({
        kind: 'rule',
        selectorText: rule.selectorText,
        rawValue,
        source: rule.source,
        action,
        reason,
        category,
      });
    }

    STATE.ruleAnalysis = rows;
    return rows;
  }

  function buildOverrideCss() {
    const blocks = new Map();

    function addLine(selector, line) {
      selector = norm(selector);
      if (!shouldUseSelector(selector)) return;

      if (!blocks.has(selector)) blocks.set(selector, new Set());
      blocks.get(selector).add(line);
    }

    for (const row of STATE.varAnalysis) {
      if (row.action !== 'override') continue;

      const line = `  ${row.name}: ${CONFIG.fonts[row.category]} !important;`;
      //const line = `  ${row.name}: ${CONFIG.fonts[row.category]};`;

      addLine(':root, html, body', line);

      for (const selector of row.selectors || []) {
        addLine(selector, line);
      }
    }

    for (const row of STATE.ruleAnalysis) {
      if (row.action !== 'override') continue;

      addLine(
        row.selectorText,
        //`  font-family: ${CONFIG.fonts[row.category]} !important;`
        `  font-family: ${CONFIG.fonts[row.category]};`
      );
    }

    const cssBlocks = [];
    for (const [selector, lines] of blocks.entries()) {
      cssBlocks.push(`${selector} {\n${Array.from(lines).join('\n')}\n}`);
    }

    let css = cssBlocks.join('\n\n');

    if (CONFIG.addMonoTuning) {
      css += (css ? '\n\n' : '') + `code, kbd, pre, samp,
.font-mono, [class*="font-mono"], [style*="monospace"] {
  font-variant-ligatures: normal !important;
  font-feature-settings: "calt" 1, "liga" 1 !important;
}`;
    }

    return css;
  }

  function printDebugSummary() {
    if (!CONFIG.debug) return;

    const fontFaceSummary = Array.from(STATE.fontFaceIndex.entries()).map(([family, faces]) => ({
      family,
      faces: faces.map(face => ({
        src: face.src,
        fontStyle: face.fontStyle,
        fontWeight: face.fontWeight,
      })),
    }));

    const varsOverride = STATE.varAnalysis.filter(x => x.action === 'override');
    const varsShorthand = STATE.varAnalysis.filter(x => x.reason === 'shorthand');
    const varsNonFont = STATE.varAnalysis.filter(x => x.reason === 'non-font');
    const varsUnresolved = STATE.varAnalysis.filter(x => x.reason === 'unresolved');

    const rulesOverride = STATE.ruleAnalysis.filter(x => x.action === 'override');
    const rulesShorthand = STATE.ruleAnalysis.filter(x => x.reason === 'shorthand');
    const rulesNonFont = STATE.ruleAnalysis.filter(x => x.reason === 'non-font');

    log('font-face index', fontFaceSummary);

    log('vars override', varsOverride.map(x => ({
      name: x.name,
      category: x.category,
      selectors: Array.from(x.selectors || []),
      resolvedValue: x.resolvedValue,
    })));

    log('vars skip: shorthand', varsShorthand.map(x => ({
      name: x.name,
      rawValue: x.rawValue,
      resolvedValue: x.resolvedValue,
    })));

    log('vars skip: non-font', varsNonFont.map(x => ({
      name: x.name,
      rawValue: x.rawValue,
      resolvedValue: x.resolvedValue,
    })));

    log('vars skip: unresolved', varsUnresolved.map(x => ({
      name: x.name,
      rawValue: x.rawValue,
      resolvedValue: x.resolvedValue,
    })));

    log('rules override', rulesOverride.map(x => ({
      selector: x.selectorText,
      category: x.category,
      rawValue: x.rawValue,
    })));

    log('rules skip: shorthand', rulesShorthand.map(x => ({
      selector: x.selectorText,
      rawValue: x.rawValue,
    })));

    log('rules skip: non-font', rulesNonFont.map(x => ({
      selector: x.selectorText,
      rawValue: x.rawValue,
    })));
  }

  function applyOverrides() {
    const { fontRules } = collectAll();

    analyzeVariables();
    analyzeFontRules(fontRules);

    const css = buildOverrideCss();
    printDebugSummary();

    if (css === STATE.lastCss) return;

    ensureStyleEl().textContent = css;
    STATE.lastCss = css;

    log('applied css', css || '(empty)');
  }

  function installObservers() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;

            if (
              node.tagName === 'STYLE' ||
              node.tagName === 'LINK' ||
              node.querySelector?.('style, link[rel="stylesheet"]')
            ) {
              queueMicrotask(applyOverrides);
              return;
            }
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const wrapHistory = (obj, methodName) => {
      const original = obj[methodName];
      if (typeof original !== 'function') return;

      obj[methodName] = function (...args) {
        const result = original.apply(this, args);
        setTimeout(applyOverrides, 50);
        setTimeout(applyOverrides, 500);
        return result;
      };
    };

    wrapHistory(history, 'pushState');
    wrapHistory(history, 'replaceState');

    window.addEventListener('popstate', () => {
      setTimeout(applyOverrides, 50);
      setTimeout(applyOverrides, 500);
    });
  }

  function init() {
    applyOverrides();

    for (const delay of CONFIG.rescanDelaysMs) {
      setTimeout(applyOverrides, delay);
    }

    if (CONFIG.periodicRescanMs > 0) {
      setInterval(applyOverrides, CONFIG.periodicRescanMs);
    }

    installObservers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();