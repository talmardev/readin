(function () {
  "use strict";

  const store = RI.store;
  const fs = RI.fs;
  const t = RI.i18n.t;

  const PENCIL_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const TRASH_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  const BOOKMARK_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  const LINK_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>';
  const MOVE_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8l4 4-4 4"/><path d="M8 12h8"/></svg>';

  let ctx = null;
  let gridCoverUrls = new Map();
  let selectedCategoryFilter = null;
  let searchQuery = "";

  let editingBookId = null;
  let pendingCoverFile = null;
  let pendingCoverRemoved = false;
  let pendingOwnership = null;
  let bookModalCoverUrl = null;

  let logModalBookId = null;
  let logModalCoverUrl = null;
  // pages already logged for the book in the open log modal: the offset that
  // converts between "pages read this session" and "stopped at page"
  let logModalPagesAlready = 0;
  // which of the two log inputs the user last typed into, so an error can be
  // phrased in their terms ("pages read" vs. "stopped at page")
  let logLastEditedStopped = false;

  const grid = document.getElementById("book-grid");
  const addBookCard = document.getElementById("add-book-card");
  const shelfSubtitle = document.getElementById("shelf-subtitle");
  const categoryFilterRow = document.getElementById("category-filter-row");
  const shelfSearchInput = document.getElementById("shelf-search-input");
  const shelfSearchClear = document.getElementById("shelf-search-clear");

  const bookModalOverlay = document.getElementById("book-modal-overlay");
  const bookModalTitle = document.getElementById("book-modal-title");
  const bookForm = document.getElementById("book-form");
  const bookTitleInput = document.getElementById("book-title-input");
  const bookAuthorInput = document.getElementById("book-author-input");
  const bookPagesInput = document.getElementById("book-pages-input");
  const bookIsbnInput = document.getElementById("book-isbn-input");
  const ownershipToggle = document.getElementById("ownership-toggle");
  const bookCategoryChecklist = document.getElementById("book-category-checklist");
  const bookFormError = document.getElementById("book-form-error");
  const bookModalSubmit = document.getElementById("book-modal-submit");
  const bookModalCancel = document.getElementById("book-modal-cancel");
  const bookModalClose = document.getElementById("book-modal-close");
  const bookModalDeleteRow = document.getElementById("book-modal-delete-row");
  const bookDeleteBtn = document.getElementById("book-delete-btn");

  const coverDrop = document.getElementById("cover-drop");
  const coverDropPlaceholder = document.getElementById("cover-drop-placeholder");
  const coverPreviewImg = document.getElementById("cover-preview");
  const coverInput = document.getElementById("cover-input");
  const coverRemoveBtn = document.getElementById("cover-remove-btn");

  const logModalOverlay = document.getElementById("log-modal-overlay");
  const logModalBookEl = document.getElementById("log-modal-book");
  const logFinishedNote = document.getElementById("log-finished-note");
  const logForm = document.getElementById("log-form");
  const logPagesInput = document.getElementById("log-pages-input");
  const logPagesHint = document.getElementById("log-pages-hint");
  const logStoppedInput = document.getElementById("log-stopped-input");
  const logDateField = document.getElementById("log-date-field");
  const logDateInput = document.getElementById("log-date-input");
  const logPastCheckbox = document.getElementById("log-past-checkbox");
  const logFormError = document.getElementById("log-form-error");
  const logModalCancel = document.getElementById("log-modal-cancel");
  const logModalClose = document.getElementById("log-modal-close");
  const recentLogsList = document.getElementById("recent-logs-list");

  const bookRatingField = document.getElementById("book-rating-field");
  const bookRatingPicker = document.getElementById("book-rating-picker");

  const rateModalOverlay = document.getElementById("rate-modal-overlay");
  const rateModalBookEl = document.getElementById("rate-modal-book");
  const rateModalPicker = document.getElementById("rate-modal-picker");
  const rateModalClose = document.getElementById("rate-modal-close");
  const rateModalSkip = document.getElementById("rate-modal-skip");

  let rateModalBookId = null;
  let rateModalCoverUrl = null;
  let activeNudges = new Map(); // bookId -> { el, timer }

  const wishlistWidget = document.getElementById("wishlist-widget");
  const wishlistToggle = document.getElementById("wishlist-toggle");
  const wishlistCount = document.getElementById("wishlist-count");
  const wishlistPanel = document.getElementById("wishlist-panel");
  const wishlistPanelClose = document.getElementById("wishlist-panel-close");
  const wishlistForm = document.getElementById("wishlist-form");
  const wishlistCoverDrop = document.getElementById("wishlist-cover-drop");
  const wishlistCoverDropPlaceholder = document.getElementById("wishlist-cover-drop-placeholder");
  const wishlistCoverPreview = document.getElementById("wishlist-cover-preview");
  const wishlistCoverInput = document.getElementById("wishlist-cover-input");
  const wishlistTitleInput = document.getElementById("wishlist-title-input");
  const wishlistAuthorInput = document.getElementById("wishlist-author-input");
  const wishlistLinkInput = document.getElementById("wishlist-link-input");
  const wishlistFormError = document.getElementById("wishlist-form-error");
  const wishlistList = document.getElementById("wishlist-list");
  const wishlistItemCoverInput = document.getElementById("wishlist-item-cover-input");

  // set while the "move to library" flow has the Add Book modal open for a
  // wishlist entry: removed from the wishlist on successful submit, left
  // alone on cancel (see closeBookModal)
  let convertingWishlistItemId = null;
  let pendingWishlistCoverFile = null;
  let wishlistCoverPreviewUrl = null;
  let wishlistCoverUrls = new Map();
  // which wishlist item's cover the shared #wishlist-item-cover-input is
  // about to replace, set right before triggering its click()
  let editingWishlistCoverItemId = null;

  async function persist() {
    try {
      await fs.writeLibraryAndLogs(ctx.dataHandle, ctx.library);
    } catch (err) {
      console.error(err);
      RI.toast(t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError")), "error");
    }
  }

  async function persistRatings() {
    try {
      await fs.writeRatings(ctx.dataHandle, ctx.ratingsData);
    } catch (err) {
      console.error(err);
      RI.toast(t("common.couldNotSaveRatingPrefix") + (err && err.message ? err.message : t("common.unknownError")), "error");
    }
  }

  async function persistWishlist() {
    try {
      await fs.writeWishlist(ctx.dataHandle, ctx.wishlistData);
    } catch (err) {
      console.error(err);
      RI.toast(t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError")), "error");
    }
  }

  function formatDateDisplay(isoDate) {
    if (!isoDate) return t("common.dash");
    const d = store.parseISODate(isoDate);
    return d.toLocaleDateString(RI.i18n.getLocale(), { month: "short", day: "numeric", year: "numeric" });
  }

  async function resolveCoverUrl(book) {
    if (!book.coverFile) return null;
    return fs.readCoverAsURL(ctx.coversHandle, book.coverFile);
  }

  function renderCategoryFilterRow() {
    const used = store.categoriesInUse(ctx.library);
    categoryFilterRow.innerHTML = "";

    if (used.length === 0) {
      categoryFilterRow.classList.add("hidden");
      selectedCategoryFilter = null;
      return;
    }
    if (selectedCategoryFilter && !used.some((c) => c.id === selectedCategoryFilter)) {
      selectedCategoryFilter = null;
    }
    categoryFilterRow.classList.remove("hidden");

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "filter-chip" + (selectedCategoryFilter === null ? " is-active" : "");
    allChip.textContent = t("library.filterAll");
    allChip.addEventListener("click", () => {
      selectedCategoryFilter = null;
      renderGrid();
    });
    categoryFilterRow.appendChild(allChip);

    used.forEach((category) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip" + (selectedCategoryFilter === category.id ? " is-active" : "");
      chip.textContent = RI.i18n.categoryName(category);
      chip.addEventListener("click", () => {
        selectedCategoryFilter = selectedCategoryFilter === category.id ? null : category.id;
        renderGrid();
      });
      categoryFilterRow.appendChild(chip);
    });
  }

  function matchesSearch(book, query) {
    if (!query) return true;
    return (book.title || "").toLowerCase().includes(query) || (book.author || "").toLowerCase().includes(query);
  }

  shelfSearchInput.addEventListener("input", () => {
    searchQuery = shelfSearchInput.value.trim().toLowerCase();
    shelfSearchClear.classList.toggle("hidden", !searchQuery);
    renderGrid();
  });

  shelfSearchClear.addEventListener("click", () => {
    shelfSearchInput.value = "";
    searchQuery = "";
    shelfSearchClear.classList.add("hidden");
    renderGrid();
    shelfSearchInput.focus();
  });

  async function renderGrid() {
    renderCategoryFilterRow();

    const allBooks = store.sortedBooksForLibrary(ctx.library);
    const categoryFiltered = selectedCategoryFilter
      ? allBooks.filter((b) => store.bookHasCategory(b, selectedCategoryFilter))
      : allBooks;
    const books = categoryFiltered.filter((b) => matchesSearch(b, searchQuery));

    gridCoverUrls.forEach((url) => URL.revokeObjectURL(url));
    gridCoverUrls = new Map();
    clearAllNudges();

    Array.from(grid.querySelectorAll(".book-card:not(.add-book-card)")).forEach((el) => el.remove());
    const existingEmpty = grid.querySelector(".empty-state");
    if (existingEmpty) existingEmpty.remove();

    if (books.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      if (searchQuery) {
        empty.textContent = t("library.emptySearch", { query: shelfSearchInput.value.trim() });
      } else if (selectedCategoryFilter) {
        empty.textContent = t("library.emptyCategory");
      } else {
        empty.textContent = t("library.emptyShelf");
      }
      grid.appendChild(empty);
    }

    shelfSubtitle.textContent = allBooks.length
      ? t("library.subtitleCount", { count: allBooks.length, n: allBooks.length })
      : "";

    for (const book of books) {
      const card = await buildBookCard(book);
      grid.appendChild(card);
    }

    await applyRatingNudges(allBooks, books);
  }

  // ---- ratings: nudge popups + star pickers ----

  function removeNudge(bookId) {
    const entry = activeNudges.get(bookId);
    if (!entry) return;
    if (entry.timerId) clearTimeout(entry.timerId);
    entry.el.remove();
    activeNudges.delete(bookId);
  }

  function clearAllNudges() {
    Array.from(activeNudges.keys()).forEach(removeNudge);
  }

  // one non-interactive two-layer star glyph (muted background + green
  // foreground, foreground clipped to a 0/50/100% width), used for the
  // read-only card display
  function buildStarGlyph() {
    const cell = document.createElement("span");
    cell.className = "star-cell";
    const bg = document.createElement("span");
    bg.className = "star-bg";
    bg.textContent = "★";
    const fg = document.createElement("span");
    fg.className = "star-fg";
    fg.textContent = "★";
    cell.appendChild(bg);
    cell.appendChild(fg);
    return { cell, fg };
  }

  function buildStarRow(value) {
    const row = document.createElement("div");
    row.className = "book-rating";
    for (let i = 1; i <= 5; i++) {
      const { cell, fg } = buildStarGlyph();
      fg.style.width = store.starFraction(value, i) * 100 + "%";
      row.appendChild(cell);
    }
    return row;
  }

  // one interactive star position: a visual glyph (bg + fg, same as
  // buildStarGlyph) plus two invisible half-width buttons stacked on top.
  // Clicking is a real DOM element hit (dedicated "set to X.5" / "set to X"
  // buttons), not pixel-position math against getBoundingClientRect, so it's
  // reliable regardless of zoom/DPI/click precision. This also makes every
  // half-star reachable by keyboard/Tab, unlike a single click-split button.
  function buildStarSlot(index, onPick, onPreview) {
    const slot = document.createElement("span");
    slot.className = "star-slot";
    const bg = document.createElement("span");
    bg.className = "star-bg";
    bg.textContent = "★";
    const fg = document.createElement("span");
    fg.className = "star-fg";
    fg.textContent = "★";
    slot.appendChild(bg);
    slot.appendChild(fg);

    [index - 0.5, index].forEach((value, half) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "star-half " + (half === 0 ? "star-half-lo" : "star-half-hi");
      btn.setAttribute("aria-label", t("common.starsAria", { count: value, value }));
      btn.addEventListener("mouseenter", () => onPreview(value));
      btn.addEventListener("focus", () => onPreview(value));
      btn.addEventListener("click", () => onPick(value));
      slot.appendChild(btn);
    });

    return { slot, fg };
  }

  // interactive 1-5 star picker in 0.5 increments. Populates `container`
  // (an existing .star-picker element) and returns a controller so the same
  // DOM/listeners can be reused across modal opens instead of rebuilding.
  // setValue() resets the displayed rating, setOnPick() rebinds which book
  // a click should save to.
  function buildStarPicker(container) {
    container.innerHTML = "";
    let current = 0;
    let onPickCb = null;
    const setters = [];

    function render(value) {
      setters.forEach((setFraction, idx) => setFraction(store.starFraction(value, idx + 1)));
    }

    for (let i = 1; i <= 5; i++) {
      const { slot, fg } = buildStarSlot(
        i,
        (value) => {
          current = value;
          render(current);
          if (onPickCb) onPickCb(current);
        },
        (value) => render(value)
      );
      setters.push((fraction) => {
        fg.style.width = fraction * 100 + "%";
      });
      container.appendChild(slot);
    }

    container.addEventListener("mouseleave", () => render(current));
    render(current);

    return {
      setValue(value) {
        current = value || 0;
        render(current);
      },
      setOnPick(cb) {
        onPickCb = cb;
      },
    };
  }

  function positionNudge(bubble, cardEl) {
    const rect = cardEl.getBoundingClientRect();
    const bubbleWidth = 188;
    const gap = 10;
    let left = rect.right + gap + window.scrollX;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - bubbleWidth - 8;
    if (left > maxLeft) left = rect.left - bubbleWidth - gap + window.scrollX;
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(rect.top + window.scrollY)}px`;
  }

  function showRatingNudge(book, cardEl) {
    removeNudge(book.id);
    const bubble = document.createElement("div");
    bubble.className = "rating-nudge";

    const text = document.createElement("p");
    text.textContent = t("library.nudgeText");
    bubble.appendChild(text);

    const pickerEl = document.createElement("div");
    pickerEl.className = "star-picker";
    bubble.appendChild(pickerEl);
    const picker = buildStarPicker(pickerEl);
    picker.setOnPick(async (stars) => {
      store.setRating(ctx.ratingsData, book.id, stars);
      await persistRatings();
      removeNudge(book.id);
      await renderGrid();
    });

    document.body.appendChild(bubble);
    positionNudge(bubble, cardEl);

    const entry = { el: bubble, timerId: null };
    const scheduleDismiss = () => {
      if (entry.timerId) clearTimeout(entry.timerId);
      entry.timerId = setTimeout(() => removeNudge(book.id), 7000);
    };
    bubble.addEventListener("mouseenter", scheduleDismiss);
    bubble.addEventListener("focusin", scheduleDismiss);
    activeNudges.set(book.id, entry);
    scheduleDismiss();
  }

  // finished books always get a ratings.json row (even unrated); the shelf
  // nudge only fires once per calendar day per book, and only for cards
  // actually on screen right now
  async function applyRatingNudges(allBooksList, renderedBooks) {
    let ratingsChanged = false;
    allBooksList.forEach((book) => {
      if (!store.isBookFinished(ctx.library, book)) return;
      const existed = !!store.getRating(ctx.ratingsData, book.id);
      store.ensureRatingEntry(ctx.ratingsData, book.id);
      if (!existed) ratingsChanged = true;
    });

    const todayISO = store.todayISODate();
    const toNudge = renderedBooks.filter(
      (book) => store.isBookFinished(ctx.library, book) && store.shouldShowRatingNudge(ctx.ratingsData, book.id, todayISO)
    );
    if (toNudge.length > 0) {
      toNudge.forEach((book) => store.markRatingNudged(ctx.ratingsData, book.id, todayISO));
      ratingsChanged = true;
    }

    if (ratingsChanged) await persistRatings();

    toNudge.forEach((book) => {
      const cardEl = grid.querySelector(`.book-card[data-book-id="${book.id}"]`);
      if (cardEl) showRatingNudge(book, cardEl);
    });
  }

  async function buildBookCard(book) {
    const progress = store.progressForBook(ctx.library, book);
    const readToday = store.hasLogToday(ctx.library, book.id);

    const card = document.createElement("div");
    card.className = "book-card";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.dataset.bookId = book.id;

    const coverWrap = document.createElement("div");
    coverWrap.className = "book-cover-wrap";

    const url = await resolveCoverUrl(book);
    if (url) {
      gridCoverUrls.set(book.id, url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      coverWrap.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "book-cover-placeholder";
      ph.textContent = book.title;
      coverWrap.appendChild(ph);
    }

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit-affordance";
    editBtn.setAttribute("aria-label", t("library.editAria", { title: book.title }));
    editBtn.innerHTML = PENCIL_SVG;
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditBookModal(book.id);
    });
    coverWrap.appendChild(editBtn);

    if (book.ownership === "library") {
      const badge = document.createElement("span");
      badge.className = "ownership-badge";
      badge.textContent = t("library.libraryOption");
      coverWrap.appendChild(badge);
    }

    if (readToday) {
      const dot = document.createElement("span");
      dot.className = "read-today-dot";
      dot.title = t("library.readTodayTitle");
      coverWrap.appendChild(dot);
    }

    const meta = document.createElement("div");
    meta.className = "book-meta";

    const titleEl = document.createElement("p");
    titleEl.className = "book-title";
    titleEl.textContent = book.title;

    const authorEl = document.createElement("p");
    authorEl.className = "book-author";
    authorEl.textContent = book.author || "";

    const bookCategories = store.categoriesForBook(ctx.library, book);
    let tagsEl = null;
    if (bookCategories.length > 0) {
      tagsEl = document.createElement("div");
      tagsEl.className = "category-tags";
      bookCategories.slice(0, 2).forEach((c) => {
        const tag = document.createElement("span");
        tag.className = "category-tag";
        tag.textContent = RI.i18n.categoryName(c);
        tagsEl.appendChild(tag);
      });
      if (bookCategories.length > 2) {
        const more = document.createElement("span");
        more.className = "category-tag";
        more.textContent = `+${bookCategories.length - 2}`;
        tagsEl.appendChild(more);
      }
    }

    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = progress.percent + "%";
    track.appendChild(fill);

    const stats = document.createElement("div");
    stats.className = "progress-stats";
    const pagesSpan = document.createElement("span");
    pagesSpan.textContent = t("library.pagesOfTotal", { read: progress.pagesRead, total: progress.totalPages });
    const percentSpan = document.createElement("span");
    percentSpan.className = "progress-percent";
    percentSpan.textContent = progress.percent + "%";
    stats.appendChild(pagesSpan);
    stats.appendChild(percentSpan);

    meta.appendChild(titleEl);
    meta.appendChild(authorEl);
    if (tagsEl) meta.appendChild(tagsEl);
    meta.appendChild(track);
    meta.appendChild(stats);

    const rating = store.getRating(ctx.ratingsData, book.id);
    if (rating && rating.stars) {
      meta.appendChild(buildStarRow(rating.stars));
    }

    card.appendChild(coverWrap);
    card.appendChild(meta);

    attachCardInteractions(card, book.id);

    return card;
  }

  // short delay tells a single click apart from a double click's first half
  function attachCardInteractions(card, bookId) {
    let clickTimer = null;

    card.addEventListener("click", () => {
      if (clickTimer) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        openLogModal(bookId);
      }, 240);
    });

    card.addEventListener("dblclick", () => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      openEditBookModal(bookId);
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openLogModal(bookId);
      }
    });
  }

  function showOverlay(overlay) {
    overlay.classList.remove("hidden");
  }

  function isOverlayOpen(overlay) {
    return !overlay.classList.contains("hidden");
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isOverlayOpen(rateModalOverlay)) closeRateModal();
    else if (isOverlayOpen(logModalOverlay)) closeLogModal();
    else if (isOverlayOpen(bookModalOverlay)) closeBookModal();
    else if (!wishlistPanel.classList.contains("hidden")) closeWishlistPanel();
  });

  bookModalOverlay.addEventListener("click", (e) => {
    if (e.target === bookModalOverlay) closeBookModal();
  });
  logModalOverlay.addEventListener("click", (e) => {
    if (e.target === logModalOverlay) closeLogModal();
  });
  rateModalOverlay.addEventListener("click", (e) => {
    if (e.target === rateModalOverlay) closeRateModal();
  });

  async function openRateModal(bookId) {
    const book = store.getBookById(ctx.library, bookId);
    if (!book) return;
    rateModalBookId = bookId;
    if (rateModalCoverUrl) {
      URL.revokeObjectURL(rateModalCoverUrl);
      rateModalCoverUrl = null;
    }
    rateModalBookEl.innerHTML = "";
    const url = await resolveCoverUrl(book);
    if (url) {
      rateModalCoverUrl = url;
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      rateModalBookEl.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "book-cover-placeholder";
      ph.textContent = book.title;
      rateModalBookEl.appendChild(ph);
    }
    const info = document.createElement("div");
    info.className = "log-modal-book-info";
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = book.title;
    info.appendChild(title);
    rateModalBookEl.appendChild(info);

    rateModalStarPicker.setValue(0);
    showOverlay(rateModalOverlay);
  }

  function closeRateModal() {
    rateModalOverlay.classList.add("hidden");
    rateModalBookId = null;
    if (rateModalCoverUrl) {
      URL.revokeObjectURL(rateModalCoverUrl);
      rateModalCoverUrl = null;
    }
  }

  rateModalClose.addEventListener("click", closeRateModal);
  rateModalSkip.addEventListener("click", closeRateModal);

  const rateModalStarPicker = buildStarPicker(rateModalPicker);
  rateModalStarPicker.setOnPick(async (value) => {
    if (!rateModalBookId) return;
    store.setRating(ctx.ratingsData, rateModalBookId, value);
    await persistRatings();
    closeRateModal();
    await renderGrid();
  });

  const bookRatingStarPicker = buildStarPicker(bookRatingPicker);
  bookRatingStarPicker.setOnPick(async (value) => {
    if (!editingBookId) return;
    store.setRating(ctx.ratingsData, editingBookId, value);
    await persistRatings();
    bookRatingStarPicker.setValue(value);
    // the modal stays open, but refresh the card underneath so its star row
    // isn't stale if the user closes without hitting "Save changes"
    await renderGrid();
  });

  function setCoverPreview(url) {
    if (bookModalCoverUrl && bookModalCoverUrl !== url) {
      URL.revokeObjectURL(bookModalCoverUrl);
    }
    bookModalCoverUrl = url;
    if (url) {
      coverPreviewImg.src = url;
      coverPreviewImg.classList.remove("hidden");
      coverDropPlaceholder.classList.add("hidden");
      coverRemoveBtn.classList.remove("hidden");
    } else {
      coverPreviewImg.src = "";
      coverPreviewImg.classList.add("hidden");
      coverDropPlaceholder.classList.remove("hidden");
      coverRemoveBtn.classList.add("hidden");
    }
  }

  function setOwnership(value) {
    pendingOwnership = value;
    Array.from(ownershipToggle.querySelectorAll(".ownership-option")).forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.ownership === value);
    });
  }

  ownershipToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".ownership-option");
    if (!btn) return;
    setOwnership(pendingOwnership === btn.dataset.ownership ? null : btn.dataset.ownership);
  });

  function renderCategoryChecklist(selectedIds) {
    const selected = new Set(selectedIds || []);
    const groups = store.groupedCategories(ctx.library);
    bookCategoryChecklist.innerHTML = "";

    [["Non-Fiction", groups["Non-Fiction"]], ["Fiction", groups.Fiction], ["Custom", groups.Custom]].forEach(
      ([groupKey, categories]) => {
        if (categories.length === 0) return;
        const heading = document.createElement("div");
        heading.className = "category-group-label";
        heading.textContent = RI.i18n.categoryGroupLabel(groupKey);
        bookCategoryChecklist.appendChild(heading);

        categories.forEach((category) => {
          const row = document.createElement("label");
          row.className = "category-check-row";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.value = category.id;
          checkbox.checked = selected.has(category.id);
          const text = document.createElement("span");
          text.textContent = RI.i18n.categoryName(category);
          row.appendChild(checkbox);
          row.appendChild(text);
          bookCategoryChecklist.appendChild(row);
        });
      }
    );

    if (!bookCategoryChecklist.hasChildNodes()) {
      const note = document.createElement("p");
      note.className = "no-categories-note";
      note.textContent = t("library.noCategoriesNote");
      bookCategoryChecklist.appendChild(note);
    }
  }

  function selectedCategoryIds() {
    return Array.from(bookCategoryChecklist.querySelectorAll('input[type="checkbox"]:checked')).map(
      (cb) => cb.value
    );
  }

  function openAddBookModal(prefill) {
    editingBookId = null;
    pendingCoverFile = null;
    pendingCoverRemoved = false;
    bookModalTitle.textContent = t("library.modalTitleAdd");
    bookModalSubmit.textContent = t("library.submitAdd");
    bookForm.reset();
    setCoverPreview(null);
    setOwnership(null);
    renderCategoryChecklist([]);
    bookRatingField.classList.add("hidden");
    bookModalDeleteRow.classList.add("hidden");
    bookFormError.textContent = "";
    showOverlay(bookModalOverlay);
    if (prefill) {
      bookTitleInput.value = prefill.title || "";
      bookAuthorInput.value = prefill.author || "";
      bookPagesInput.focus();
    } else {
      bookTitleInput.focus();
    }
  }

  async function openEditBookModal(bookId) {
    const book = store.getBookById(ctx.library, bookId);
    if (!book) return;
    editingBookId = bookId;
    pendingCoverFile = null;
    pendingCoverRemoved = false;
    bookModalTitle.textContent = t("library.modalTitleEdit");
    bookModalSubmit.textContent = t("library.submitEdit");
    bookTitleInput.value = book.title;
    bookAuthorInput.value = book.author || "";
    bookPagesInput.value = book.totalPages;
    bookIsbnInput.value = book.isbn || "";
    const url = await resolveCoverUrl(book);
    setCoverPreview(url);
    setOwnership(book.ownership || null);
    renderCategoryChecklist(book.categoryIds);
    const finished = store.isBookFinished(ctx.library, book);
    bookRatingField.classList.toggle("hidden", !finished);
    if (finished) {
      const rating = store.getRating(ctx.ratingsData, book.id);
      bookRatingStarPicker.setValue(rating ? rating.stars || 0 : 0);
    }
    bookModalDeleteRow.classList.remove("hidden");
    bookFormError.textContent = "";
    showOverlay(bookModalOverlay);
    bookTitleInput.focus();
  }

  function closeBookModal() {
    bookModalOverlay.classList.add("hidden");
    if (bookModalCoverUrl) {
      URL.revokeObjectURL(bookModalCoverUrl);
      bookModalCoverUrl = null;
    }
    pendingCoverFile = null;
    pendingCoverRemoved = false;
    pendingOwnership = null;
    coverInput.value = "";
    convertingWishlistItemId = null;
  }

  addBookCard.addEventListener("click", () => openAddBookModal());
  bookModalCancel.addEventListener("click", closeBookModal);
  bookModalClose.addEventListener("click", closeBookModal);

  coverDrop.addEventListener("click", () => coverInput.click());
  coverDrop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      coverInput.click();
    }
  });

  coverInput.addEventListener("change", () => {
    const file = coverInput.files && coverInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      bookFormError.textContent = t("library.errChooseImage");
      return;
    }
    bookFormError.textContent = "";
    pendingCoverFile = file;
    pendingCoverRemoved = false;
    setCoverPreview(URL.createObjectURL(file));
  });

  coverRemoveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    pendingCoverFile = null;
    pendingCoverRemoved = true;
    coverInput.value = "";
    setCoverPreview(null);
  });

  bookForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = bookTitleInput.value.trim();
    const author = bookAuthorInput.value.trim();
    const totalPages = Number(bookPagesInput.value);
    const isbn = bookIsbnInput.value.trim();
    const ownership = pendingOwnership;
    const categoryIds = selectedCategoryIds();

    if (!title) {
      bookFormError.textContent = t("library.errTitleRequired");
      return;
    }
    if (!totalPages || totalPages < 1) {
      bookFormError.textContent = t("library.errTotalPagesMin");
      return;
    }
    bookFormError.textContent = "";
    bookModalSubmit.disabled = true;

    try {
      if (editingBookId) {
        const book = store.getBookById(ctx.library, editingBookId);
        if (pendingCoverRemoved && book.coverFile) {
          await fs.deleteCover(ctx.coversHandle, book.coverFile);
          store.updateBook(ctx.library, editingBookId, { coverFile: null });
        }
        if (pendingCoverFile) {
          const oldCover = book.coverFile;
          const newPath = await fs.saveCover(ctx.coversHandle, editingBookId, pendingCoverFile);
          if (oldCover && oldCover !== newPath) await fs.deleteCover(ctx.coversHandle, oldCover);
          store.updateBook(ctx.library, editingBookId, { coverFile: newPath });
        }
        store.updateBook(ctx.library, editingBookId, { title, author, totalPages, isbn, ownership, categoryIds });
      } else {
        const book = store.createBook(ctx.library, {
          title,
          author,
          totalPages,
          coverFile: null,
          isbn,
          ownership,
          categoryIds,
        });
        if (pendingCoverFile) {
          const path = await fs.saveCover(ctx.coversHandle, book.id, pendingCoverFile);
          store.updateBook(ctx.library, book.id, { coverFile: path });
        }
      }
      await persist();
      if (!editingBookId && convertingWishlistItemId) {
        const removedWishlistItem = store.deleteWishlistItem(ctx.wishlistData, convertingWishlistItemId);
        if (removedWishlistItem && removedWishlistItem.coverFile) {
          await fs.deleteCover(ctx.coversHandle, removedWishlistItem.coverFile);
        }
        await persistWishlist();
        await renderWishlistPanel();
      }
      closeBookModal();
      await renderGrid();
    } catch (err) {
      console.error(err);
      bookFormError.textContent = t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError"));
    } finally {
      bookModalSubmit.disabled = false;
    }
  });

  bookDeleteBtn.addEventListener("click", async () => {
    if (!editingBookId) return;
    const book = store.getBookById(ctx.library, editingBookId);
    if (!book) return;
    const ok = confirm(t("library.confirmDeleteBook", { title: book.title }));
    if (!ok) return;
    try {
      if (book.coverFile) await fs.deleteCover(ctx.coversHandle, book.coverFile);
      store.deleteBook(ctx.library, editingBookId);
      await persist();
      closeBookModal();
      await renderGrid();
    } catch (err) {
      console.error(err);
      bookFormError.textContent = t("library.errCouldNotDeletePrefix") + (err && err.message ? err.message : t("common.unknownError"));
    }
  });

  async function renderLogModalBookInfo(book) {
    if (logModalCoverUrl) {
      URL.revokeObjectURL(logModalCoverUrl);
      logModalCoverUrl = null;
    }
    const progress = store.progressForBook(ctx.library, book);
    logModalBookEl.innerHTML = "";

    const url = await resolveCoverUrl(book);
    if (url) {
      logModalCoverUrl = url;
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      logModalBookEl.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "book-cover-placeholder";
      ph.textContent = book.title;
      logModalBookEl.appendChild(ph);
    }

    const info = document.createElement("div");
    info.className = "log-modal-book-info";
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = book.title;
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = `${t("library.pagesOfTotal", { read: progress.pagesRead, total: progress.totalPages })} · ${progress.percent}%`;
    info.appendChild(title);
    info.appendChild(sub);
    logModalBookEl.appendChild(info);
  }

  function renderRecentLogs(bookId) {
    const logs = store
      .logsForBook(ctx.library, bookId)
      .slice()
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

    recentLogsList.innerHTML = "";

    if (logs.length === 0) {
      const note = document.createElement("p");
      note.className = "no-logs-note";
      note.textContent = t("library.noLogsYet");
      recentLogsList.appendChild(note);
      return;
    }

    logs.slice(0, 6).forEach((log) => {
      const row = document.createElement("div");
      row.className = "recent-log-row";

      const amount = document.createElement("span");
      amount.className = "amount";
      amount.textContent = t("library.logAmountPages", { count: log.pagesRead, n: log.pagesRead });

      const date = document.createElement("span");
      date.className = "date";
      date.textContent = log.isPastRead ? t("library.pastReadLabel") : formatDateDisplay(log.date);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-log";
      removeBtn.setAttribute("aria-label", t("library.deleteLogAria"));
      removeBtn.innerHTML = TRASH_SVG;
      removeBtn.addEventListener("click", async () => {
        const ok = confirm(t("library.confirmDeleteLog"));
        if (!ok) return;
        store.deleteLog(ctx.library, log.id);
        await persist();
        renderRecentLogs(bookId);
        const book = store.getBookById(ctx.library, bookId);
        if (book) {
          await renderLogModalBookInfo(book);
          applyRemainingPagesState(book);
        }
        await renderGrid();
      });

      row.appendChild(amount);
      row.appendChild(date);
      row.appendChild(removeBtn);
      recentLogsList.appendChild(row);
    });
  }

  // toggles the log form vs. the "finished" note based on pages left to read
  function applyRemainingPagesState(book) {
    const progress = store.progressForBook(ctx.library, book);
    logModalPagesAlready = progress.pagesRead;
    const remaining = store.remainingPages(ctx.library, book);
    const finished = remaining <= 0;
    logFinishedNote.classList.toggle("hidden", !finished);
    logForm.classList.toggle("hidden", finished);
    if (!finished) {
      logPagesInput.max = remaining;
      logPagesHint.textContent = t("library.pagesReadHintWithRemaining", { count: remaining, n: remaining });
      // "stopped at page" is the same log expressed as an absolute page: it can
      // land anywhere past what's already been read, up to the last page
      logStoppedInput.min = progress.pagesRead + 1;
      logStoppedInput.max = progress.totalPages;
    }
    return { remaining, finished };
  }

  // the two log inputs are two views of one value:
  //   stoppedAtPage = pagesAlreadyRead + pagesReadThisSession
  // editing either one recomputes the other. Setting .value in JS doesn't fire
  // an "input" event, so these handlers can't bounce off each other.
  function syncStoppedFromPages() {
    logLastEditedStopped = false;
    if (logPagesInput.value === "") {
      logStoppedInput.value = "";
      return;
    }
    const pages = Math.round(Number(logPagesInput.value));
    if (!Number.isFinite(pages)) return;
    logStoppedInput.value = logModalPagesAlready + pages;
  }

  function syncPagesFromStopped() {
    logLastEditedStopped = true;
    if (logStoppedInput.value === "") {
      logPagesInput.value = "";
      return;
    }
    const stopped = Math.round(Number(logStoppedInput.value));
    if (!Number.isFinite(stopped)) return;
    logPagesInput.value = stopped - logModalPagesAlready;
  }

  logPagesInput.addEventListener("input", syncStoppedFromPages);
  logStoppedInput.addEventListener("input", syncPagesFromStopped);

  async function openLogModal(bookId) {
    const book = store.getBookById(ctx.library, bookId);
    if (!book) return;
    logModalBookId = bookId;
    logFormError.textContent = "";
    logPastCheckbox.checked = false;
    logDateInput.max = store.todayISODate();
    logDateInput.value = store.todayISODate();
    logDateField.classList.remove("hidden");
    logDateInput.disabled = false;
    logPagesInput.value = "";
    logStoppedInput.value = "";
    logLastEditedStopped = false;
    await renderLogModalBookInfo(book);
    const { finished } = applyRemainingPagesState(book);
    renderRecentLogs(bookId);
    showOverlay(logModalOverlay);
    if (!finished) logPagesInput.focus();
  }

  function closeLogModal() {
    logModalOverlay.classList.add("hidden");
    if (logModalCoverUrl) {
      URL.revokeObjectURL(logModalCoverUrl);
      logModalCoverUrl = null;
    }
  }

  logModalCancel.addEventListener("click", closeLogModal);
  logModalClose.addEventListener("click", closeLogModal);

  logPastCheckbox.addEventListener("change", () => {
    if (logPastCheckbox.checked) {
      logDateField.classList.add("hidden");
      logDateInput.disabled = true;
    } else {
      logDateField.classList.remove("hidden");
      logDateInput.disabled = false;
      if (!logDateInput.value) logDateInput.value = store.todayISODate();
    }
  });

  logForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pages = Number(logPagesInput.value);
    if (!pages || pages < 1) {
      logFormError.textContent = logLastEditedStopped
        ? t("library.errStoppedMustBePast")
        : t("library.errEnterAtLeast1Page");
      return;
    }
    const bookBefore = store.getBookById(ctx.library, logModalBookId);
    const remaining = bookBefore ? store.remainingPages(ctx.library, bookBefore) : 0;
    if (remaining <= 0) {
      logFormError.textContent = t("library.errAlreadyFinished");
      return;
    }
    if (pages > remaining) {
      logFormError.textContent = t("library.errOnlyNPagesLeft", { count: remaining, n: remaining });
      return;
    }
    const isPastRead = logPastCheckbox.checked;
    const date = isPastRead ? null : logDateInput.value || store.todayISODate();
    if (!isPastRead && date > store.todayISODate()) {
      logFormError.textContent = t("library.errDateFuture");
      return;
    }
    logFormError.textContent = "";

    try {
      store.addLog(ctx.library, { bookId: logModalBookId, pagesRead: pages, date, isPastRead });
      await persist();
      const book = store.getBookById(ctx.library, logModalBookId);
      await renderLogModalBookInfo(book);
      const { finished } = applyRemainingPagesState(book);
      renderRecentLogs(logModalBookId);
      logPagesInput.value = "";
      logStoppedInput.value = "";
      logPastCheckbox.checked = false;
      logDateField.classList.remove("hidden");
      logDateInput.disabled = false;
      logDateInput.value = store.todayISODate();
      if (!finished) logPagesInput.focus();

      // if this log just finished the book, the rate-modal is about to take
      // over the "nudge" job for today, so mark it nudged now, otherwise
      // renderGrid()'s nudge pass would also pop the corner bubble underneath it
      let willOpenRateModal = false;
      if (finished) {
        const rating = store.getRating(ctx.ratingsData, logModalBookId);
        if (!rating || !rating.stars) {
          willOpenRateModal = true;
          store.markRatingNudged(ctx.ratingsData, logModalBookId, store.todayISODate());
          await persistRatings();
        }
      }

      await renderGrid();

      if (willOpenRateModal) {
        closeLogModal();
        await openRateModal(logModalBookId);
      }
    } catch (err) {
      console.error(err);
      logFormError.textContent = t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError"));
    }
  });

  // ---- wishlist: small "corner" panel for books not owned/tracked yet ----

  async function renderWishlistPanel() {
    const items = store.sortedWishlistItems(ctx.wishlistData);
    wishlistCount.textContent = String(items.length);
    wishlistCount.classList.toggle("hidden", items.length === 0);

    wishlistCoverUrls.forEach((url) => URL.revokeObjectURL(url));
    wishlistCoverUrls = new Map();
    wishlistList.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "no-logs-note";
      empty.textContent = t("wishlist.empty");
      wishlistList.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "wishlist-item";

      const coverWrap = document.createElement("div");
      coverWrap.className = "wishlist-item-cover-wrap";

      const coverUrl = await resolveCoverUrl(item);
      let coverEl;
      if (coverUrl) {
        wishlistCoverUrls.set(item.id, coverUrl);
        coverEl = document.createElement("img");
        coverEl.className = "wishlist-item-cover";
        coverEl.src = coverUrl;
        coverEl.alt = "";
      } else {
        coverEl = document.createElement("div");
        coverEl.className = "wishlist-item-cover-placeholder";
        coverEl.textContent = item.title;
      }
      coverEl.setAttribute("role", "button");
      coverEl.tabIndex = 0;
      coverEl.setAttribute("aria-label", t("wishlist.changeCoverAria", { title: item.title }));
      coverEl.addEventListener("click", () => triggerWishlistCoverChange(item.id));
      coverEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          triggerWishlistCoverChange(item.id);
        }
      });
      coverWrap.appendChild(coverEl);

      if (item.coverFile) {
        const removeCoverBtn = document.createElement("button");
        removeCoverBtn.type = "button";
        removeCoverBtn.className = "wishlist-item-cover-remove";
        removeCoverBtn.setAttribute("aria-label", t("wishlist.removeCoverAria", { title: item.title }));
        removeCoverBtn.innerHTML = "&times;";
        removeCoverBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await fs.deleteCover(ctx.coversHandle, item.coverFile);
          store.updateWishlistItem(ctx.wishlistData, item.id, { coverFile: null });
          await persistWishlist();
          await renderWishlistPanel();
        });
        coverWrap.appendChild(removeCoverBtn);
      }

      row.appendChild(coverWrap);

      const info = document.createElement("div");
      info.className = "wishlist-item-info";
      const titleEl = document.createElement("p");
      titleEl.className = "wishlist-item-title";
      titleEl.textContent = item.title;
      info.appendChild(titleEl);
      if (item.author) {
        const authorEl = document.createElement("p");
        authorEl.className = "wishlist-item-author";
        authorEl.textContent = item.author;
        info.appendChild(authorEl);
      }
      row.appendChild(info);

      const actions = document.createElement("div");
      actions.className = "wishlist-item-actions";

      if (item.link) {
        const link = document.createElement("a");
        link.className = "wishlist-item-action";
        link.href = item.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", t("wishlist.openLinkAria", { title: item.title }));
        link.innerHTML = LINK_SVG;
        actions.appendChild(link);
      }

      const convertBtn = document.createElement("button");
      convertBtn.type = "button";
      convertBtn.className = "wishlist-item-action";
      convertBtn.title = t("wishlist.moveToLibraryTitle");
      convertBtn.setAttribute("aria-label", t("wishlist.moveToLibraryAria", { title: item.title }));
      convertBtn.innerHTML = MOVE_SVG;
      convertBtn.addEventListener("click", () => {
        convertingWishlistItemId = item.id;
        closeWishlistPanel();
        openAddBookModal({ title: item.title, author: item.author });
      });
      actions.appendChild(convertBtn);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "wishlist-item-action wishlist-item-remove";
      removeBtn.setAttribute("aria-label", t("wishlist.removeAria", { title: item.title }));
      removeBtn.innerHTML = TRASH_SVG;
      removeBtn.addEventListener("click", async () => {
        if (item.coverFile) await fs.deleteCover(ctx.coversHandle, item.coverFile);
        store.deleteWishlistItem(ctx.wishlistData, item.id);
        await persistWishlist();
        await renderWishlistPanel();
      });
      actions.appendChild(removeBtn);

      row.appendChild(actions);
      wishlistList.appendChild(row);
    }
  }

  function openWishlistPanel() {
    wishlistPanel.classList.remove("hidden");
    wishlistToggle.setAttribute("aria-expanded", "true");
  }

  function closeWishlistPanel() {
    wishlistPanel.classList.add("hidden");
    wishlistToggle.setAttribute("aria-expanded", "false");
  }

  wishlistToggle.addEventListener("click", () => {
    if (wishlistPanel.classList.contains("hidden")) openWishlistPanel();
    else closeWishlistPanel();
  });
  wishlistPanelClose.addEventListener("click", closeWishlistPanel);

  document.addEventListener("click", (e) => {
    if (wishlistPanel.classList.contains("hidden")) return;
    if (wishlistWidget.contains(e.target)) return;
    closeWishlistPanel();
  });

  function setWishlistCoverPreview(url) {
    if (wishlistCoverPreviewUrl && wishlistCoverPreviewUrl !== url) {
      URL.revokeObjectURL(wishlistCoverPreviewUrl);
    }
    wishlistCoverPreviewUrl = url;
    if (url) {
      wishlistCoverPreview.src = url;
      wishlistCoverPreview.classList.remove("hidden");
      wishlistCoverDropPlaceholder.classList.add("hidden");
    } else {
      wishlistCoverPreview.src = "";
      wishlistCoverPreview.classList.add("hidden");
      wishlistCoverDropPlaceholder.classList.remove("hidden");
    }
  }

  wishlistCoverDrop.addEventListener("click", () => wishlistCoverInput.click());
  wishlistCoverDrop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      wishlistCoverInput.click();
    }
  });

  wishlistCoverInput.addEventListener("change", () => {
    const file = wishlistCoverInput.files && wishlistCoverInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      wishlistFormError.textContent = t("library.errChooseImage");
      return;
    }
    wishlistFormError.textContent = "";
    pendingWishlistCoverFile = file;
    setWishlistCoverPreview(URL.createObjectURL(file));
  });

  // shared by every rendered wishlist item's cover: clicking one sets this
  // and reuses the single hidden #wishlist-item-cover-input rather than
  // building a per-item file input
  function triggerWishlistCoverChange(itemId) {
    editingWishlistCoverItemId = itemId;
    wishlistItemCoverInput.click();
  }

  wishlistItemCoverInput.addEventListener("change", async () => {
    const file = wishlistItemCoverInput.files && wishlistItemCoverInput.files[0];
    const itemId = editingWishlistCoverItemId;
    editingWishlistCoverItemId = null;
    wishlistItemCoverInput.value = "";
    if (!file || !itemId) return;
    if (!file.type.startsWith("image/")) {
      RI.toast(t("library.errChooseImage"), "error");
      return;
    }
    const item = ctx.wishlistData.items.find((i) => i.id === itemId);
    if (!item) return;
    try {
      const oldCover = item.coverFile;
      const newPath = await fs.saveCover(ctx.coversHandle, itemId, file);
      if (oldCover && oldCover !== newPath) await fs.deleteCover(ctx.coversHandle, oldCover);
      store.updateWishlistItem(ctx.wishlistData, itemId, { coverFile: newPath });
      await persistWishlist();
      await renderWishlistPanel();
    } catch (err) {
      console.error(err);
      RI.toast(t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError")), "error");
    }
  });

  wishlistForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = wishlistTitleInput.value.trim();
    const author = wishlistAuthorInput.value.trim();
    const link = wishlistLinkInput.value.trim();
    if (!title) {
      wishlistFormError.textContent = t("wishlist.errTitleRequired");
      return;
    }
    wishlistFormError.textContent = "";
    try {
      const item = store.createWishlistItem(ctx.wishlistData, { title, author, link });
      if (pendingWishlistCoverFile) {
        const path = await fs.saveCover(ctx.coversHandle, item.id, pendingWishlistCoverFile);
        store.updateWishlistItem(ctx.wishlistData, item.id, { coverFile: path });
      }
      await persistWishlist();
      wishlistForm.reset();
      pendingWishlistCoverFile = null;
      setWishlistCoverPreview(null);
      await renderWishlistPanel();
      wishlistTitleInput.focus();
    } catch (err) {
      console.error(err);
      wishlistFormError.textContent = t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError"));
    }
  });

  RI.i18n.onChange(() => {
    if (!ctx) return;
    renderGrid();
    renderWishlistPanel();
    if (isOverlayOpen(bookModalOverlay)) {
      bookModalTitle.textContent = editingBookId ? t("library.modalTitleEdit") : t("library.modalTitleAdd");
      bookModalSubmit.textContent = editingBookId ? t("library.submitEdit") : t("library.submitAdd");
      renderCategoryChecklist(selectedCategoryIds());
    }
    if (isOverlayOpen(logModalOverlay) && logModalBookId) {
      const book = store.getBookById(ctx.library, logModalBookId);
      if (book) applyRemainingPagesState(book);
    }
  });

  RI.boot((bootCtx) => {
    ctx = bootCtx;
    wishlistWidget.classList.remove("hidden");
    renderGrid();
    renderWishlistPanel();
  });
})();
