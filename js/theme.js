window.RI = window.RI || {};

// classic script, loaded early in head

RI.theme = (function () {
  "use strict";

  const STORAGE_KEY = "readin-theme";
  const DEFAULT_THEME = "light";
  const THEMES = ["light", "dark"];

  const SUN_SVG =
    '<svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"></circle>' +
    '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>' +
    "</svg>";
  const MOON_SVG =
    '<svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">' +
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path>' +
    "</svg>";

  const switches = [];

  // storage can throw, light is the fallback
  function readStored() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return THEMES.includes(value) ? value : DEFAULT_THEME;
    } catch (err) {
      return DEFAULT_THEME;
    }
  }

  let current = readStored();

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    switches.forEach((el) => el.setAttribute("aria-checked", String(theme === "dark")));
  }

  function get() {
    return current;
  }

  function set(theme) {
    if (!THEMES.includes(theme)) return;
    current = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (err) {
      console.error(err);
    }
    apply(theme);
  }

  function toggle() {
    set(current === "dark" ? "light" : "dark");
  }

  function buildSwitch() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-switch";
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", String(current === "dark"));
    btn.setAttribute("data-i18n-aria-label", "common.darkMode");
    btn.setAttribute("data-i18n-title", "common.darkMode");
    const knob = document.createElement("span");
    knob.className = "theme-switch-knob";
    knob.innerHTML = SUN_SVG + MOON_SVG;
    btn.appendChild(knob);
    btn.addEventListener("click", toggle);
    switches.push(btn);
    return btn;
  }

  // one switch beside each language switcher
  function mount() {
    document.querySelectorAll(".lang-switcher").forEach((langEl) => {
      const group = document.createElement("div");
      group.className = "lang-theme-group";
      if (langEl.classList.contains("lang-switcher-setup")) group.classList.add("is-setup");
      langEl.parentNode.insertBefore(group, langEl);
      group.appendChild(langEl);
      group.appendChild(buildSwitch());
      if (RI.i18n) RI.i18n.applyTranslations(group);
    });
  }

  // runs now, before first paint
  apply(current);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  return { get, set, toggle };
})();
