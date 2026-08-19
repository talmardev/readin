(function () {
  "use strict";

  const store = RI.store;
  const fs = RI.fs;

  const PENCIL_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const TRASH_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  let ctx = null;
  let gridCoverUrls = new Map();

  let editingBookId = null;
  let pendingCoverFile = null;
  let pendingCoverRemoved = false;
  let bookModalCoverUrl = null;

  let logModalBookId = null;
  let logModalCoverUrl = null;

  const grid = document.getElementById("book-grid");
  const addBookCard = document.getElementById("add-book-card");
  const shelfSubtitle = document.getElementById("shelf-subtitle");

  const bookModalOverlay = document.getElementById("book-modal-overlay");
  const bookModalTitle = document.getElementById("book-modal-title");
  const bookForm = document.getElementById("book-form");
  const bookTitleInput = document.getElementById("book-title-input");
  const bookAuthorInput = document.getElementById("book-author-input");
  const bookPagesInput = document.getElementById("book-pages-input");
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
  const logForm = document.getElementById("log-form");
  const logPagesInput = document.getElementById("log-pages-input");
  const logDateField = document.getElementById("log-date-field");
  const logDateInput = document.getElementById("log-date-input");
  const logPastCheckbox = document.getElementById("log-past-checkbox");
  const logFormError = document.getElementById("log-form-error");
  const logModalCancel = document.getElementById("log-modal-cancel");
  const logModalClose = document.getElementById("log-modal-close");
  const recentLogsList = document.getElementById("recent-logs-list");

  async function persist() {
    try {
      await fs.writeLibrary(ctx.dataHandle, ctx.library);
    } catch (err) {
      console.error(err);
      RI.toast("Could not save — " + (err && err.message ? err.message : "unknown error"), "error");
    }
  }

  function formatDateDisplay(isoDate) {
    if (!isoDate) return "—";
    const d = store.parseISODate(isoDate);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  async function resolveCoverUrl(book) {
    if (!book.coverFile) return null;
    return fs.readCoverAsURL(ctx.coversHandle, book.coverFile);
  }

  async function renderGrid() {
    const books = store.sortedBooksForLibrary(ctx.library);

    gridCoverUrls.forEach((url) => URL.revokeObjectURL(url));
    gridCoverUrls = new Map();

    Array.from(grid.querySelectorAll(".book-card:not(.add-book-card)")).forEach((el) => el.remove());
    const existingEmpty = grid.querySelector(".empty-state");
    if (existingEmpty) existingEmpty.remove();

    if (books.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Your shelf is empty. Add your first book to start tracking.";
      grid.appendChild(empty);
    }

    shelfSubtitle.textContent = books.length
      ? `${books.length} book${books.length === 1 ? "" : "s"} on your shelf`
      : "";

    for (const book of books) {
      const card = await buildBookCard(book);
      grid.appendChild(card);
    }
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
    editBtn.setAttribute("aria-label", `Edit ${book.title}`);
    editBtn.innerHTML = PENCIL_SVG;
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditBookModal(book.id);
    });
    coverWrap.appendChild(editBtn);

    if (readToday) {
      const dot = document.createElement("span");
      dot.className = "read-today-dot";
      dot.title = "You read this today";
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

    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = progress.percent + "%";
    track.appendChild(fill);

    const stats = document.createElement("div");
    stats.className = "progress-stats";
    const pagesSpan = document.createElement("span");
    pagesSpan.textContent = `${progress.pagesRead} / ${progress.totalPages} pages`;
    const percentSpan = document.createElement("span");
    percentSpan.className = "progress-percent";
    percentSpan.textContent = progress.percent + "%";
    stats.appendChild(pagesSpan);
    stats.appendChild(percentSpan);

    meta.appendChild(titleEl);
    meta.appendChild(authorEl);
    meta.appendChild(track);
    meta.appendChild(stats);

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
    if (isOverlayOpen(logModalOverlay)) closeLogModal();
    else if (isOverlayOpen(bookModalOverlay)) closeBookModal();
  });

  bookModalOverlay.addEventListener("click", (e) => {
    if (e.target === bookModalOverlay) closeBookModal();
  });
  logModalOverlay.addEventListener("click", (e) => {
    if (e.target === logModalOverlay) closeLogModal();
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

  function openAddBookModal() {
    editingBookId = null;
    pendingCoverFile = null;
    pendingCoverRemoved = false;
    bookModalTitle.textContent = "Add book";
    bookModalSubmit.textContent = "Add book";
    bookForm.reset();
    setCoverPreview(null);
    bookModalDeleteRow.classList.add("hidden");
    bookFormError.textContent = "";
    showOverlay(bookModalOverlay);
    bookTitleInput.focus();
  }

  async function openEditBookModal(bookId) {
    const book = store.getBookById(ctx.library, bookId);
    if (!book) return;
    editingBookId = bookId;
    pendingCoverFile = null;
    pendingCoverRemoved = false;
    bookModalTitle.textContent = "Edit book";
    bookModalSubmit.textContent = "Save changes";
    bookTitleInput.value = book.title;
    bookAuthorInput.value = book.author || "";
    bookPagesInput.value = book.totalPages;
    const url = await resolveCoverUrl(book);
    setCoverPreview(url);
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
    coverInput.value = "";
  }

  addBookCard.addEventListener("click", openAddBookModal);
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
      bookFormError.textContent = "Please choose an image file.";
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

    if (!title) {
      bookFormError.textContent = "Title is required.";
      return;
    }
    if (!totalPages || totalPages < 1) {
      bookFormError.textContent = "Total pages must be at least 1.";
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
        store.updateBook(ctx.library, editingBookId, { title, author, totalPages });
      } else {
        const book = store.createBook(ctx.library, { title, author, totalPages, coverFile: null });
        if (pendingCoverFile) {
          const path = await fs.saveCover(ctx.coversHandle, book.id, pendingCoverFile);
          store.updateBook(ctx.library, book.id, { coverFile: path });
        }
      }
      await persist();
      closeBookModal();
      await renderGrid();
    } catch (err) {
      console.error(err);
      bookFormError.textContent = "Could not save: " + (err && err.message ? err.message : "unknown error");
    } finally {
      bookModalSubmit.disabled = false;
    }
  });

  bookDeleteBtn.addEventListener("click", async () => {
    if (!editingBookId) return;
    const book = store.getBookById(ctx.library, editingBookId);
    if (!book) return;
    const ok = confirm(
      `Delete "${book.title}"? This removes its cover and all its reading logs. This can't be undone.`
    );
    if (!ok) return;
    try {
      if (book.coverFile) await fs.deleteCover(ctx.coversHandle, book.coverFile);
      store.deleteBook(ctx.library, editingBookId);
      await persist();
      closeBookModal();
      await renderGrid();
    } catch (err) {
      console.error(err);
      bookFormError.textContent = "Could not delete: " + (err && err.message ? err.message : "unknown error");
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
    sub.textContent = `${progress.pagesRead} / ${progress.totalPages} pages · ${progress.percent}%`;
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
      note.textContent = "No logs yet for this book.";
      recentLogsList.appendChild(note);
      return;
    }

    logs.slice(0, 6).forEach((log) => {
      const row = document.createElement("div");
      row.className = "recent-log-row";

      const amount = document.createElement("span");
      amount.className = "amount";
      amount.textContent = `${log.pagesRead} pages`;

      const date = document.createElement("span");
      date.className = "date";
      date.textContent = log.isPastRead ? "Past read" : formatDateDisplay(log.date);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-log";
      removeBtn.setAttribute("aria-label", "Delete this log");
      removeBtn.innerHTML = TRASH_SVG;
      removeBtn.addEventListener("click", async () => {
        const ok = confirm("Delete this log entry?");
        if (!ok) return;
        store.deleteLog(ctx.library, log.id);
        await persist();
        renderRecentLogs(bookId);
        const book = store.getBookById(ctx.library, bookId);
        if (book) await renderLogModalBookInfo(book);
        await renderGrid();
      });

      row.appendChild(amount);
      row.appendChild(date);
      row.appendChild(removeBtn);
      recentLogsList.appendChild(row);
    });
  }

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
    await renderLogModalBookInfo(book);
    renderRecentLogs(bookId);
    showOverlay(logModalOverlay);
    logPagesInput.focus();
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
      logFormError.textContent = "Enter at least 1 page.";
      return;
    }
    const isPastRead = logPastCheckbox.checked;
    const date = isPastRead ? null : logDateInput.value || store.todayISODate();
    if (!isPastRead && date > store.todayISODate()) {
      logFormError.textContent = "Date can't be in the future.";
      return;
    }
    logFormError.textContent = "";

    try {
      store.addLog(ctx.library, { bookId: logModalBookId, pagesRead: pages, date, isPastRead });
      await persist();
      const book = store.getBookById(ctx.library, logModalBookId);
      await renderLogModalBookInfo(book);
      renderRecentLogs(logModalBookId);
      logPagesInput.value = "";
      logPastCheckbox.checked = false;
      logDateField.classList.remove("hidden");
      logDateInput.disabled = false;
      logDateInput.value = store.todayISODate();
      logPagesInput.focus();
      await renderGrid();
    } catch (err) {
      console.error(err);
      logFormError.textContent = "Could not save: " + (err && err.message ? err.message : "unknown error");
    }
  });

  RI.boot((bootCtx) => {
    ctx = bootCtx;
    renderGrid();
  });
})();
