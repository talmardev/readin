window.RI = window.RI || {};

// search widget, mount it outside any form

RI.olsearch = (function () {
  "use strict";

  const ol = RI.openlibrary;
  const t = RI.i18n.t;
  const DEBOUNCE_MS = 400;
  const SKELETON_COUNT = 10;
  const SEARCH_SVG =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7.5"/><path d="M21 21l-4.6-4.6"/></svg>';
  let instanceCount = 0;

  // options: onPick, onCover, needsPages, loadSuggestions
  function mount(container, options) {
    const opts = options || {};
    const needsPages = opts.needsPages !== false;

    const root = document.createElement("div");
    root.className = "ol-search";

    instanceCount += 1;
    const inputId = "ol-search-input-" + instanceCount;
    const label = document.createElement("label");
    label.className = "ol-search-label";
    label.htmlFor = inputId;

    const row = document.createElement("div");
    row.className = "ol-search-row";
    const icon = document.createElement("span");
    icon.className = "ol-search-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = SEARCH_SVG;
    const input = document.createElement("input");
    input.type = "text";
    input.id = inputId;
    input.className = "ol-search-input";
    input.maxLength = 120;
    input.autocomplete = "off";
    input.spellcheck = false;
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "ol-search-clear hidden";
    clearBtn.innerHTML = "&times;";
    row.appendChild(icon);
    row.appendChild(input);
    row.appendChild(clearBtn);

    const statusEl = document.createElement("p");
    statusEl.className = "ol-status";
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");

    const list = document.createElement("ul");
    list.className = "ol-results hidden";

    const suggestEl = document.createElement("div");
    suggestEl.className = "ol-suggest hidden";
    const suggestTitle = document.createElement("p");
    suggestTitle.className = "ol-suggest-title";
    const suggestGrid = document.createElement("ul");
    suggestGrid.className = "ol-suggest-grid";
    suggestEl.appendChild(suggestTitle);
    suggestEl.appendChild(suggestGrid);

    const hint = document.createElement("a");
    hint.className = "ol-hint";
    hint.href = ol.SITE_URL;
    hint.target = "_blank";
    hint.rel = "noopener noreferrer";

    root.appendChild(label);
    root.appendChild(row);
    root.appendChild(statusEl);
    root.appendChild(list);
    root.appendChild(suggestEl);
    root.appendChild(hint);
    container.appendChild(root);

    let searchSeq = 0;
    let searchCtrl = null;
    let debounceTimer = null;
    let pickSeq = 0;
    let pickCtrl = null;
    let pickPromise = Promise.resolve();
    let coverLoading = false;
    // last pick status, for cancelled covers
    let pickBase = null;
    let currentResults = [];
    let suggestions = [];
    let suggestActive = false;
    let suggestLoading = false;
    let suggestSeq = 0;
    // status keys survive language switches
    let statusKeys = null;
    let statusKind = "info";

    function renderStatus() {
      statusEl.textContent = statusKeys ? statusKeys.map((key) => t(key)).join(" ") : "";
      statusEl.classList.toggle("hidden", !statusKeys);
      statusEl.classList.toggle("is-error", statusKind === "error");
      statusEl.classList.toggle("is-ok", statusKind === "ok");
    }

    function setStatus(keys, kind) {
      statusKeys = keys;
      statusKind = kind || "info";
      renderStatus();
    }

    function buildThumb(result) {
      const wrap = document.createElement("span");
      wrap.className = "ol-result-thumb";
      if (!result.coverId) return wrap;
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => img.remove());
      img.src = ol.thumbUrl(result.coverId);
      wrap.appendChild(img);
      return wrap;
    }

    function metaText(result) {
      const parts = [];
      if (result.author) parts.push(result.author);
      if (result.year) parts.push(String(result.year));
      if (result.pages) parts.push(t("openlibrary.resultPages", { count: result.pages, n: result.pages }));
      return parts.join(" · ");
    }

    function renderResults() {
      list.innerHTML = "";
      list.classList.toggle("hidden", currentResults.length === 0);
      currentResults.forEach((result) => {
        const item = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ol-result";
        const text = document.createElement("span");
        text.className = "ol-result-text";
        const title = document.createElement("span");
        title.className = "ol-result-title";
        title.textContent = result.title;
        const meta = document.createElement("span");
        meta.className = "ol-result-meta";
        meta.textContent = metaText(result);
        text.appendChild(title);
        if (meta.textContent) text.appendChild(meta);
        btn.appendChild(buildThumb(result));
        btn.appendChild(text);
        btn.addEventListener("click", () => pick(result));
        item.appendChild(btn);
        list.appendChild(item);
      });
      renderSuggestions();
    }

    function buildSuggestItem(result) {
      const item = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ol-suggest-item";
      // tooltip shows the clamped title
      btn.title = result.author ? result.title + " · " + result.author : result.title;
      const cover = document.createElement("span");
      cover.className = "ol-suggest-cover";
      if (result.coverId) {
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => img.remove());
        img.src = ol.thumbUrl(result.coverId, "M");
        cover.appendChild(img);
      }
      const name = document.createElement("span");
      name.className = "ol-suggest-name";
      name.textContent = result.title;
      btn.appendChild(cover);
      btn.appendChild(name);
      if (result.author) {
        const author = document.createElement("span");
        author.className = "ol-suggest-author";
        author.textContent = result.author;
        btn.appendChild(author);
      }
      btn.addEventListener("click", () => pick(result));
      item.appendChild(btn);
      return item;
    }

    // only while empty with no results
    function renderSuggestions() {
      const idle = !input.value.trim() && currentResults.length === 0;
      const show = suggestActive && idle && (suggestLoading || suggestions.length > 0);
      suggestEl.classList.toggle("hidden", !show);
      if (!show) return;
      suggestTitle.textContent = t("openlibrary.suggestionsTitle");
      suggestGrid.innerHTML = "";
      if (suggestLoading) {
        for (let i = 0; i < SKELETON_COUNT; i += 1) {
          const placeholder = document.createElement("li");
          placeholder.className = "ol-suggest-skeleton";
          suggestGrid.appendChild(placeholder);
        }
        return;
      }
      suggestions.forEach((result) => suggestGrid.appendChild(buildSuggestItem(result)));
    }

    // failure just hides the section
    function showSuggestions() {
      if (!opts.loadSuggestions) return;
      suggestSeq += 1;
      const seq = suggestSeq;
      suggestActive = true;
      suggestLoading = true;
      suggestions = [];
      renderSuggestions();
      Promise.resolve()
        .then(() => opts.loadSuggestions())
        .then(
          (list) => (seq === suggestSeq ? list : null),
          () => (seq === suggestSeq ? [] : null)
        )
        .then((list) => {
          if (list === null) return;
          suggestions = Array.isArray(list) ? list : [];
          suggestLoading = false;
          renderSuggestions();
        });
    }

    function renderStatic() {
      label.textContent = t("openlibrary.searchLabel");
      input.placeholder = t("openlibrary.placeholder");
      input.setAttribute("aria-label", t("openlibrary.searchAria"));
      clearBtn.setAttribute("aria-label", t("openlibrary.clearAria"));
      hint.textContent = t("openlibrary.hint");
      renderStatus();
      renderResults();
    }

    function cancelSearch() {
      clearTimeout(debounceTimer);
      searchSeq += 1;
      if (searchCtrl) searchCtrl.abort();
      searchCtrl = null;
      root.classList.remove("is-loading");
    }

    // stops a running cover download
    function cancelCover() {
      pickSeq += 1;
      if (pickCtrl) pickCtrl.abort();
      pickCtrl = null;
      pickPromise = Promise.resolve();
      if (coverLoading) {
        coverLoading = false;
        setStatus([pickBase], "ok");
      }
    }

    function errorKey(err) {
      if (err && err.code === "offline") return "openlibrary.errOffline";
      if (err && err.code === "timeout") return "openlibrary.errTimeout";
      return "openlibrary.errGeneric";
    }

    async function run(query) {
      cancelSearch();
      const seq = searchSeq;
      const ctrl = new AbortController();
      searchCtrl = ctrl;
      root.classList.add("is-loading");
      setStatus(["openlibrary.searching"], "info");
      try {
        const found = await ol.search(query, { signal: ctrl.signal, lang: RI.i18n.getLanguage() });
        if (seq !== searchSeq) return;
        currentResults = found;
        renderResults();
        setStatus(found.length ? null : ["openlibrary.noResults"], "info");
      } catch (err) {
        if (seq !== searchSeq || (err && err.code === "abort")) return;
        currentResults = [];
        renderResults();
        setStatus([errorKey(err)], "error");
      } finally {
        if (seq === searchSeq) root.classList.remove("is-loading");
      }
    }

    // true when ready to send
    function checkQuery(query, explicit) {
      if (query.kind === "empty") {
        currentResults = [];
        renderResults();
        setStatus(null);
        return false;
      }
      if (query.kind === "invalidIsbn") {
        currentResults = [];
        renderResults();
        setStatus(["openlibrary.invalidIsbn"], "error");
        return false;
      }
      if (query.kind === "text" && query.value.length < ol.MIN_QUERY_LENGTH) {
        currentResults = [];
        renderResults();
        setStatus(explicit ? ["openlibrary.tooShort"] : null, "info");
        return false;
      }
      return true;
    }

    function pick(result) {
      cancelCover();
      const seq = pickSeq;
      const ctrl = new AbortController();
      pickCtrl = ctrl;
      if (opts.onPick) opts.onPick(result);
      currentResults = [];
      renderResults();

      const base = needsPages && !result.pages ? "openlibrary.pickedNoPages" : "openlibrary.pickedOk";
      pickBase = base;
      if (!result.coverId) {
        setStatus([base, "openlibrary.noCover"], "ok");
        return;
      }
      coverLoading = true;
      setStatus(["openlibrary.gettingCover"], "info");
      pickPromise = ol.fetchCover(result.coverId, { signal: ctrl.signal }).then(
        (file) => {
          if (seq !== pickSeq) return;
          coverLoading = false;
          if (opts.onCover) opts.onCover(file, result);
          setStatus([base], "ok");
        },
        (err) => {
          if (seq !== pickSeq || (err && err.code === "abort")) return;
          coverLoading = false;
          setStatus([base, err && err.code === "nocover" ? "openlibrary.noCover" : "openlibrary.coverFailed"], "ok");
        }
      );
    }

    input.addEventListener("input", () => {
      clearBtn.classList.toggle("hidden", !input.value);
      renderSuggestions();
      cancelSearch();
      const query = ol.classifyQuery(input.value);
      if (!checkQuery(query, false)) return;
      debounceTimer = setTimeout(() => run(query), DEBOUNCE_MS);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cancelSearch();
        const query = ol.classifyQuery(input.value);
        if (checkQuery(query, true)) run(query);
      } else if (e.key === "ArrowDown") {
        const first = list.querySelector(".ol-result");
        if (first) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const buttons = Array.from(list.querySelectorAll(".ol-result"));
      const idx = buttons.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      if (e.key === "ArrowDown") {
        if (buttons[idx + 1]) buttons[idx + 1].focus();
      } else if (idx === 0) {
        input.focus();
      } else {
        buttons[idx - 1].focus();
      }
    });

    clearBtn.addEventListener("click", () => {
      reset();
      input.focus();
    });

    function reset() {
      cancelSearch();
      cancelCover();
      coverLoading = false;
      input.value = "";
      clearBtn.classList.add("hidden");
      currentResults = [];
      statusKeys = null;
      renderStatic();
    }

    RI.i18n.onChange(renderStatic);
    renderStatic();

    return {
      reset,
      showSuggestions,
      cancelCover,
      focus: () => input.focus(),
      // never rejects, resolves when done
      whenIdle: () => pickPromise,
    };
  }

  return { mount };
})();
