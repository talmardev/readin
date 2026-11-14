window.RI = window.RI || {};

// classic script, never a module

RI.i18n = (function () {
  "use strict";

  const STORAGE_KEY = "readin-lang";
  const DEFAULT_LANG = "pt";
  const FALLBACK_LANG = "en";
  const LOCALE_TAGS = { en: "en-US", pt: "pt-PT", fr: "fr-FR", es: "es-ES", de: "de-DE", zh: "zh-CN" };

  const languages = {}; // code -> meta and dict
  const changeListeners = [];
  const switcherInstances = [];
  let switcherMounted = false;

  function getStoredLang() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  // reads storage each time, no cache
  function currentLang() {
    return getStoredLang() || DEFAULT_LANG;
  }

  function getLocale() {
    return LOCALE_TAGS[currentLang()] || LOCALE_TAGS[FALLBACK_LANG];
  }

  function resolveDictValue(dict, path) {
    const parts = path.split(".");
    let node = dict;
    for (const part of parts) {
      if (node == null || typeof node !== "object") return undefined;
      node = node[part];
    }
    return typeof node === "string" ? node : undefined;
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? vars[name] : m));
  }

  function pluralCategory(count, locale) {
    try {
      return new Intl.PluralRules(locale).select(count);
    } catch (err) {
      return count === 1 ? "one" : "other";
    }
  }

  function lookup(lang, key, vars) {
    const dict = languages[lang] && languages[lang].dict;
    if (!dict) return undefined;
    if (vars && typeof vars.count === "number") {
      const category = pluralCategory(vars.count, getLocale());
      const byCategory = resolveDictValue(dict, `${key}_${category}`);
      if (byCategory !== undefined) return byCategory;
      const byOther = resolveDictValue(dict, `${key}_other`);
      if (byOther !== undefined) return byOther;
    }
    return resolveDictValue(dict, key);
  }

  // falls back to English, then the raw key
  function t(key, vars) {
    const lang = currentLang();
    let value = lookup(lang, key, vars);
    if (value === undefined && lang !== FALLBACK_LANG) {
      value = lookup(FALLBACK_LANG, key, vars);
    }
    if (value === undefined) value = key;
    return interpolate(value, vars);
  }

  function resolveArrayValue(dict, path) {
    const parts = path.split(".");
    let node = dict;
    for (const part of parts) {
      if (node == null || typeof node !== "object") return undefined;
      node = node[part];
    }
    return Array.isArray(node) ? node : undefined;
  }

  // array values, same fallback chain as t()
  function tArray(key) {
    const lang = currentLang();
    let value = resolveArrayValue(languages[lang] && languages[lang].dict, key);
    if (value === undefined && lang !== FALLBACK_LANG) {
      value = resolveArrayValue(languages[FALLBACK_LANG] && languages[FALLBACK_LANG].dict, key);
    }
    return value || [];
  }

  function applyTranslations(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
    });
    scope.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.getAttribute("data-i18n-title"));
    });
    document.documentElement.lang = currentLang();
  }

  function onChange(cb) {
    changeListeners.push(cb);
  }

  // custom and renamed categories are never translated
  function categoryName(category) {
    if (!category) return "";
    const key = "category." + category.id;
    // seeded names equal the English entry until renamed
    const seededName = lookup(FALLBACK_LANG, key);
    if (seededName !== undefined && category.name !== seededName) return category.name;
    const translated = t(key);
    return translated === key ? category.name : translated;
  }

  function categoryGroupLabel(group) {
    const key = "categoryGroup." + (group || "Custom");
    const translated = t(key);
    return translated === key ? group || "Custom" : translated;
  }

  function setLanguage(code) {
    if (!languages[code]) return;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch (err) {
      console.error(err);
    }
    applyTranslations();
    refreshSwitcherUI();
    changeListeners.forEach((cb) => {
      try {
        cb(code);
      } catch (err) {
        console.error(err);
      }
    });
  }

  // language switcher widget

  // active first, then en and pt
  const PINNED_LANGS = ["en", "pt"];

  function languageCodesSorted() {
    const active = currentLang();
    const all = Object.keys(languages);
    const label = (code) => (languages[code].meta && languages[code].meta.label) || code;
    const head = [active].concat(PINNED_LANGS.filter((code) => code !== active));
    const pinned = head.filter((code) => languages[code]);
    const rest = all
      .filter((code) => !pinned.includes(code))
      .sort((a, b) => label(a).localeCompare(label(b)));
    return pinned.concat(rest);
  }

  // flag png, then svg, then emoji
  function buildFlagEl(code) {
    const wrap = document.createElement("span");
    wrap.className = "lang-flag";
    const entry = languages[code];
    if (!entry) return wrap; // filled in by the next refresh
    const meta = entry.meta || {};
    if (meta.flagPath) {
      const img = document.createElement("img");
      img.alt = "";
      let triedSvg = false;
      img.addEventListener("error", () => {
        if (!triedSvg && /\.png$/i.test(meta.flagPath)) {
          triedSvg = true;
          img.src = meta.flagPath.replace(/\.png$/i, ".svg");
          return;
        }
        img.remove();
        wrap.appendChild(buildEmojiFlag(meta));
      });
      img.src = meta.flagPath;
      wrap.appendChild(img);
    } else {
      wrap.appendChild(buildEmojiFlag(meta));
    }
    return wrap;
  }

  function buildEmojiFlag(meta) {
    const span = document.createElement("span");
    span.className = "lang-flag-emoji";
    span.textContent = meta.flagEmoji || "";
    return span;
  }

  function buildSwitcherInstance() {
    const wrap = document.createElement("div");
    wrap.className = "lang-switcher";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-switcher-btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");

    const menu = document.createElement("div");
    menu.className = "lang-switcher-menu hidden";
    menu.setAttribute("role", "menu");

    function renderBtn() {
      btn.innerHTML = "";
      btn.setAttribute("aria-label", t("common.changeLanguage"));
      btn.appendChild(buildFlagEl(currentLang()));
      const codeSpan = document.createElement("span");
      codeSpan.className = "lang-switcher-code";
      codeSpan.textContent = currentLang().toUpperCase();
      btn.appendChild(codeSpan);
    }

    function renderMenu() {
      menu.innerHTML = "";
      languageCodesSorted().forEach((code) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "lang-switcher-item" + (code === currentLang() ? " is-active" : "");
        item.setAttribute("role", "menuitem");
        item.appendChild(buildFlagEl(code));
        const label = document.createElement("span");
        label.textContent = (languages[code].meta && languages[code].meta.label) || code.toUpperCase();
        item.appendChild(label);
        item.addEventListener("click", () => {
          closeMenu();
          setLanguage(code);
        });
        menu.appendChild(item);
      });
    }

    function openMenu() {
      renderMenu();
      menu.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKeydown, true);
    }

    function closeMenu() {
      menu.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKeydown, true);
    }

    function onDocClick(e) {
      if (!wrap.contains(e.target)) closeMenu();
    }

    function onKeydown(e) {
      if (e.key === "Escape") closeMenu();
    }

    btn.addEventListener("click", () => {
      if (menu.classList.contains("hidden")) openMenu();
      else closeMenu();
    });

    renderBtn();
    wrap.appendChild(btn);
    wrap.appendChild(menu);

    return { wrap, renderBtn };
  }

  function mountSwitcher() {
    if (switcherMounted) return;
    const headerRight = document.querySelector(".header-right");
    if (headerRight) {
      const inst = buildSwitcherInstance();
      const readBtn = headerRight.querySelector(".btn-read");
      if (readBtn) headerRight.insertBefore(inst.wrap, readBtn);
      else headerRight.appendChild(inst.wrap);
      switcherInstances.push(inst);
    }
    const setupCard = document.querySelector(".setup-card");
    if (setupCard) {
      const inst = buildSwitcherInstance();
      inst.wrap.classList.add("lang-switcher-setup");
      setupCard.insertBefore(inst.wrap, setupCard.firstChild);
      switcherInstances.push(inst);
    }
    switcherMounted = switcherInstances.length > 0;
  }

  function refreshSwitcherUI() {
    switcherInstances.forEach((inst) => inst.renderBtn());
  }

  // dict is nested strings, dot-path addressed
  function registerLanguage(code, meta, dict) {
    languages[code] = { meta: meta || {}, dict: dict || {} };
    mountSwitcher();
    refreshSwitcherUI();
    if (code === currentLang()) {
      applyTranslations();
    }
  }

  return {
    registerLanguage,
    t,
    tArray,
    applyTranslations,
    setLanguage,
    getLanguage: currentLang,
    getLocale,
    onChange,
    categoryName,
    categoryGroupLabel,
  };
})();
