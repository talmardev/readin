(function () {
  "use strict";

  const store = RI.store;
  const fs = RI.fs;

  const SESSION_STORAGE_KEY = "readin-active-read-session";
  const TICK_MS = 250;

  let ctx = null;
  let readsData = null;

  let selectedBookId = null;
  let session = null; // { bookId, plannedMinutes, startedAt, pausedSeconds, pauseStartedAt, endedAt, endedEarly, activeSeconds }
  let tickTimer = null;

  let pickerCoverUrls = [];
  let selectedBookCoverUrl = null;
  let selectedBookCoverForId = null;

  const bookGroupsEl = document.getElementById("read-book-groups");
  const noBooksEl = document.getElementById("read-no-books");

  const durationBookEl = document.getElementById("duration-book");
  const durationChipsEl = document.getElementById("duration-chips");
  const durationCustomInput = document.getElementById("duration-custom-input");
  const durationFormError = document.getElementById("duration-form-error");
  const durationBackBtn = document.getElementById("read-duration-back");
  const startBtn = document.getElementById("read-start-btn");

  const timerBookEl = document.getElementById("timer-book");
  const timerRingWrap = document.getElementById("timer-ring-wrap");
  const timerRingProgress = document.getElementById("timer-ring-progress");
  const timerTimeEl = document.getElementById("timer-time");
  const timerStateEl = document.getElementById("timer-state");
  const pauseBtn = document.getElementById("timer-pause-btn");
  const endBtn = document.getElementById("timer-end-btn");

  const finishedCoverImg = document.getElementById("finished-cover-img");
  const finishedCoverPlaceholder = document.getElementById("finished-cover-placeholder");
  const finishedTitleEl = document.getElementById("finished-title");
  const finishedAuthorEl = document.getElementById("finished-author");
  const finishedTimeReadEl = document.getElementById("finished-time-read");
  const finishedStartEl = document.getElementById("finished-start-time");
  const finishedEndEl = document.getElementById("finished-end-time");
  const finishedForm = document.getElementById("finished-form");
  const finishedPagesInput = document.getElementById("finished-pages-input");
  const finishedFormError = document.getElementById("finished-form-error");
  const finishedSaveBtn = document.getElementById("finished-save-btn");

  const savedSummaryEl = document.getElementById("saved-summary");
  const savedReadAgainBtn = document.getElementById("saved-read-again-btn");

  const rateModalOverlay = document.getElementById("rate-modal-overlay");
  const rateModalBookEl = document.getElementById("rate-modal-book");
  const rateModalPicker = document.getElementById("rate-modal-picker");
  const rateModalClose = document.getElementById("rate-modal-close");
  const rateModalSkip = document.getElementById("rate-modal-skip");
  let rateModalBookId = null;
  let pendingSavedSummary = null;

  const RADIUS = timerRingProgress.r.baseVal.value; // derived from the SVG, not hand-copied
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  timerRingProgress.style.strokeDasharray = String(CIRCUMFERENCE);

  const stepEls = {
    book: document.getElementById("read-step-book"),
    duration: document.getElementById("read-step-duration"),
    timer: document.getElementById("read-step-timer"),
    finished: document.getElementById("read-step-finished"),
    saved: document.getElementById("read-step-saved"),
  };

  function showStep(name) {
    Object.keys(stepEls).forEach((key) => {
      stepEls[key].classList.toggle("hidden", key !== name);
    });
  }

  function saveSessionToStorage() {
    if (!session) return;
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        bookId: session.bookId,
        plannedMinutes: session.plannedMinutes,
        startedAt: session.startedAt,
        pausedSeconds: session.pausedSeconds,
        pauseStartedAt: session.pauseStartedAt,
      })
    );
  }

  function clearSessionStorage() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  function loadSessionFromStorage() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.bookId || !parsed.startedAt || !parsed.plannedMinutes) return null;
      return {
        bookId: parsed.bookId,
        plannedMinutes: Number(parsed.plannedMinutes),
        startedAt: parsed.startedAt,
        pausedSeconds: Number(parsed.pausedSeconds) || 0,
        pauseStartedAt: parsed.pauseStartedAt || null,
        endedAt: null,
        endedEarly: false,
        activeSeconds: 0,
      };
    } catch (err) {
      return null;
    }
  }

  function beforeUnloadHandler(e) {
    e.preventDefault();
    e.returnValue = "";
  }

  function formatMMSS(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function formatDurationLong(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
    return `${s}s`;
  }

  function formatClockTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  // ---- cover url helpers ----

  function revokePickerCovers() {
    pickerCoverUrls.forEach((u) => URL.revokeObjectURL(u));
    pickerCoverUrls = [];
  }

  async function getSelectedBookCoverUrl(book) {
    if (selectedBookCoverForId === book.id) return selectedBookCoverUrl;
    if (selectedBookCoverUrl) URL.revokeObjectURL(selectedBookCoverUrl);
    selectedBookCoverUrl = book.coverFile ? await fs.readCoverAsURL(ctx.coversHandle, book.coverFile) : null;
    selectedBookCoverForId = book.id;
    return selectedBookCoverUrl;
  }

  async function renderBookSummary(container, book) {
    container.innerHTML = "";
    const url = await getSelectedBookCoverUrl(book);
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      container.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "book-cover-placeholder";
      ph.textContent = book.title;
      container.appendChild(ph);
    }
    const info = document.createElement("div");
    info.className = "log-modal-book-info";
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = book.title;
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = book.author || "";
    info.appendChild(title);
    info.appendChild(sub);
    container.appendChild(info);
  }

  // ---- step: book picker ----

  function subtextForBook(book, tierKey) {
    const parts = [];
    if (book.author) parts.push(book.author);
    if (tierKey === "inProgress") {
      parts.push(`${store.progressForBook(ctx.library, book).percent}% read`);
    } else if (tierKey === "notStarted") {
      parts.push("Not started");
    } else {
      parts.push("Finished");
    }
    return parts.join(" · ");
  }

  async function buildReadBookRow(book, tier) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "log-row read-book-row" + (tier.disabled ? " is-disabled" : "");
    if (tier.disabled) {
      row.disabled = true;
      row.title = "Rereads aren't supported yet — logging is closed once a book is finished.";
    }

    const url = book.coverFile ? await fs.readCoverAsURL(ctx.coversHandle, book.coverFile) : null;
    if (url) {
      pickerCoverUrls.push(url);
      const img = document.createElement("img");
      img.className = "log-row-cover";
      img.src = url;
      img.alt = "";
      row.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "log-row-cover-placeholder";
      ph.textContent = book.title.charAt(0).toUpperCase() || "?";
      row.appendChild(ph);
    }

    const lines = document.createElement("div");
    lines.className = "log-row-lines";
    const title = document.createElement("p");
    title.className = "log-row-title";
    title.textContent = book.title;
    const sub = document.createElement("p");
    sub.className = "log-row-date";
    sub.textContent = subtextForBook(book, tier.key);
    lines.appendChild(title);
    lines.appendChild(sub);
    row.appendChild(lines);

    if (!tier.disabled) {
      row.addEventListener("click", () => selectBook(book.id));
    }
    return row;
  }

  async function renderBookPicker() {
    revokePickerCovers();
    bookGroupsEl.innerHTML = "";

    const groups = store.groupBooksForReadPicker(ctx.library);
    const tiers = [
      { key: "inProgress", label: "Continue reading", books: groups.inProgress, disabled: false },
      { key: "notStarted", label: "Start something new", books: groups.notStarted, disabled: false },
      { key: "finished", label: "Finished", books: groups.finished, disabled: true },
    ];

    let any = false;
    for (const tier of tiers) {
      if (tier.books.length === 0) continue;
      any = true;
      const section = document.createElement("div");
      section.className = "read-book-group";
      const heading = document.createElement("h2");
      heading.className = "section-title";
      heading.textContent = tier.label;
      section.appendChild(heading);
      for (const book of tier.books) {
        section.appendChild(await buildReadBookRow(book, tier));
      }
      bookGroupsEl.appendChild(section);
    }
    noBooksEl.classList.toggle("hidden", any);
  }

  async function selectBook(bookId) {
    selectedBookId = bookId;
    const book = store.getBookById(ctx.library, bookId);
    if (!book) return;
    await renderDurationStep(book);
    showStep("duration");
  }

  durationBackBtn.addEventListener("click", () => {
    selectedBookId = null;
    showStep("book");
  });

  // ---- step: duration picker ----

  function setActiveChip(minutes) {
    durationChipsEl.querySelectorAll(".duration-chip").forEach((chip) => {
      chip.classList.toggle("is-active", Number(chip.dataset.minutes) === minutes);
    });
  }

  durationChipsEl.querySelectorAll(".duration-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const minutes = Number(chip.dataset.minutes);
      durationCustomInput.value = minutes;
      setActiveChip(minutes);
    });
  });

  durationCustomInput.addEventListener("input", () => {
    setActiveChip(Number(durationCustomInput.value));
  });

  async function renderDurationStep(book) {
    await renderBookSummary(durationBookEl, book);
    durationFormError.textContent = "";
    durationCustomInput.value = 25;
    setActiveChip(25);
  }

  startBtn.addEventListener("click", async () => {
    const minutes = Math.round(Number(durationCustomInput.value));
    if (!minutes || minutes < 1) {
      durationFormError.textContent = "Enter at least 1 minute.";
      return;
    }
    durationFormError.textContent = "";

    const now = Date.now();
    session = {
      bookId: selectedBookId,
      plannedMinutes: minutes,
      startedAt: new Date(now).toISOString(),
      pausedSeconds: 0,
      pauseStartedAt: null,
      endedAt: null,
      endedEarly: false,
      activeSeconds: 0,
    };
    saveSessionToStorage();
    await enterTimerStep();
  });

  // ---- step: timer ----

  function pausedMsSoFar(now) {
    let ms = session.pausedSeconds * 1000;
    if (session.pauseStartedAt) ms += now - Date.parse(session.pauseStartedAt);
    return ms;
  }

  function activeMs(now) {
    return Math.max(0, now - Date.parse(session.startedAt) - pausedMsSoFar(now));
  }

  function remainingMs(now) {
    return session.plannedMinutes * 60000 - activeMs(now);
  }

  function updateRingAndTime(remMs) {
    const totalMs = session.plannedMinutes * 60000;
    const fraction = totalMs > 0 ? Math.max(0, Math.min(1, remMs / totalMs)) : 0;
    timerRingProgress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - fraction));
    timerTimeEl.textContent = formatMMSS(remMs);
  }

  function setPauseUI(isPaused) {
    timerRingWrap.classList.toggle("is-paused", isPaused);
    pauseBtn.textContent = isPaused ? "Continue Reading" : "Bathroom Break";
    pauseBtn.classList.toggle("btn-primary", isPaused);
    pauseBtn.classList.toggle("btn-secondary", !isPaused);
    timerStateEl.textContent = isPaused ? "On a break" : "Reading";
  }

  function tick() {
    const now = Date.now();
    const rem = remainingMs(now);
    updateRingAndTime(Math.max(0, rem));
    if (!session.pauseStartedAt && rem <= 0) {
      finishSession(false, now);
    }
  }

  async function enterTimerStep() {
    const book = store.getBookById(ctx.library, session.bookId);
    if (!book) {
      clearSessionStorage();
      session = null;
      await renderBookPicker();
      showStep("book");
      return;
    }
    await renderBookSummary(timerBookEl, book);
    setPauseUI(!!session.pauseStartedAt);
    showStep("timer");
    window.addEventListener("beforeunload", beforeUnloadHandler);
    if (tickTimer) clearInterval(tickTimer);
    tick();
    tickTimer = setInterval(tick, TICK_MS);
  }

  pauseBtn.addEventListener("click", () => {
    const now = Date.now();
    if (session.pauseStartedAt) {
      session.pausedSeconds += Math.round((now - Date.parse(session.pauseStartedAt)) / 1000);
      session.pauseStartedAt = null;
      setPauseUI(false);
    } else {
      session.pauseStartedAt = new Date(now).toISOString();
      setPauseUI(true);
    }
    saveSessionToStorage();
  });

  endBtn.addEventListener("click", () => {
    finishSession(true, Date.now());
  });

  // ---- step: finished ----

  async function finishSession(endedEarly, now) {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (session.pauseStartedAt) {
      session.pausedSeconds += Math.round((now - Date.parse(session.pauseStartedAt)) / 1000);
      session.pauseStartedAt = null;
    }

    const plannedMs = session.plannedMinutes * 60000;
    let endedAtMs = now;
    let activeSecondsVal = Math.round(activeMs(now) / 1000);
    if (!endedEarly) {
      // natural timeout: anchor to the moment the clock actually hit zero,
      // not to "now" — a backgrounded/throttled tab can call this well after
      // the fact, which would otherwise inflate time-read past the plan
      endedAtMs = Date.parse(session.startedAt) + plannedMs + session.pausedSeconds * 1000;
      activeSecondsVal = Math.round(plannedMs / 1000);
    }

    session.endedAt = new Date(endedAtMs).toISOString();
    session.endedEarly = endedEarly;
    session.activeSeconds = activeSecondsVal;
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    saveSessionToStorage();
    await renderFinishedStep();
    showStep("finished");
  }

  async function renderFinishedStep() {
    const book = store.getBookById(ctx.library, session.bookId);
    if (!book) return;

    finishedTitleEl.textContent = book.title;
    finishedAuthorEl.textContent = book.author || "";
    finishedTimeReadEl.textContent = formatDurationLong(session.activeSeconds * 1000);
    finishedStartEl.textContent = formatClockTime(session.startedAt);
    finishedEndEl.textContent = formatClockTime(session.endedAt);

    const url = await getSelectedBookCoverUrl(book);
    if (url) {
      finishedCoverImg.src = url;
      finishedCoverImg.classList.remove("hidden");
      finishedCoverPlaceholder.classList.add("hidden");
    } else {
      finishedCoverPlaceholder.textContent = book.title;
      finishedCoverPlaceholder.classList.remove("hidden");
      finishedCoverImg.classList.add("hidden");
    }

    const remaining = store.remainingPages(ctx.library, book);
    finishedPagesInput.value = "";
    finishedPagesInput.max = remaining > 0 ? remaining : "";
    finishedFormError.textContent = "";
  }

  // ---- rating modal ----

  async function persistRatings() {
    try {
      await fs.writeRatings(ctx.dataHandle, ctx.ratingsData);
    } catch (err) {
      console.error(err);
      RI.toast("Could not save rating — " + (err && err.message ? err.message : "unknown error"), "error");
    }
  }

  function setStarPickerValue(picker, value) {
    Array.from(picker.querySelectorAll(".star-btn")).forEach((btn) => {
      btn.classList.toggle("is-filled", Number(btn.dataset.value) <= value);
    });
  }

  async function openRateModal(bookId) {
    const book = store.getBookById(ctx.library, bookId);
    if (!book) return;
    rateModalBookId = bookId;
    await renderBookSummary(rateModalBookEl, book);
    setStarPickerValue(rateModalPicker, 0);
    rateModalOverlay.classList.remove("hidden");
  }

  function closeRateModal() {
    rateModalOverlay.classList.add("hidden");
    rateModalBookId = null;
    if (pendingSavedSummary) {
      savedSummaryEl.textContent = pendingSavedSummary;
      pendingSavedSummary = null;
      showStep("saved");
    }
  }

  rateModalClose.addEventListener("click", closeRateModal);
  rateModalSkip.addEventListener("click", closeRateModal);
  rateModalOverlay.addEventListener("click", (e) => {
    if (e.target === rateModalOverlay) closeRateModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !rateModalOverlay.classList.contains("hidden")) closeRateModal();
  });
  rateModalPicker.addEventListener("click", async (e) => {
    const btn = e.target.closest(".star-btn");
    if (!btn || !rateModalBookId) return;
    store.setRating(ctx.ratingsData, rateModalBookId, Number(btn.dataset.value));
    await persistRatings();
    closeRateModal();
  });

  finishedForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const book = store.getBookById(ctx.library, session.bookId);
    if (!book) {
      finishedFormError.textContent = "This book no longer exists.";
      return;
    }
    const pages = Number(finishedPagesInput.value);
    if (!pages || pages < 1) {
      finishedFormError.textContent = "Enter at least 1 page.";
      return;
    }
    const remaining = store.remainingPages(ctx.library, book);
    if (remaining <= 0) {
      finishedFormError.textContent = "This book is already finished.";
      return;
    }
    if (pages > remaining) {
      finishedFormError.textContent = `Only ${remaining} page${remaining === 1 ? "" : "s"} left in this book.`;
      return;
    }
    finishedFormError.textContent = "";
    finishedSaveBtn.disabled = true;

    try {
      const log = store.addLog(ctx.library, {
        bookId: session.bookId,
        pagesRead: pages,
        date: store.todayISODate(),
        isPastRead: false,
      });
      await fs.writeLibraryAndLogs(ctx.dataHandle, ctx.library);

      store.createReadSession(readsData, {
        bookId: session.bookId,
        logId: log.id,
        plannedMinutes: session.plannedMinutes,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        pausedSeconds: session.pausedSeconds,
        activeSeconds: session.activeSeconds,
        endedEarly: session.endedEarly,
        pagesRead: pages,
      });
      await fs.writeReads(ctx.dataHandle, readsData);

      clearSessionStorage();
      const summary = `Logged ${pages} page${pages === 1 ? "" : "s"} for "${book.title}".`;
      const bookId = session.bookId;
      session = null;

      // this log just finished the book (remaining was checked >0 above) —
      // offer the rating modal before showing the plain "saved" screen
      const justFinished = store.isBookFinished(ctx.library, store.getBookById(ctx.library, bookId));
      if (justFinished) {
        const rating = store.getRating(ctx.ratingsData, bookId);
        if (!rating || !rating.stars) {
          store.markRatingNudged(ctx.ratingsData, bookId, store.todayISODate());
          await persistRatings();
          pendingSavedSummary = summary;
          await openRateModal(bookId);
          return;
        }
      }

      savedSummaryEl.textContent = summary;
      showStep("saved");
    } catch (err) {
      console.error(err);
      finishedFormError.textContent = "Could not save: " + (err && err.message ? err.message : "unknown error");
    } finally {
      finishedSaveBtn.disabled = false;
    }
  });

  savedReadAgainBtn.addEventListener("click", async () => {
    selectedBookId = null;
    await renderBookPicker();
    showStep("book");
  });

  // ---- boot ----

  RI.boot(async (bootCtx) => {
    ctx = bootCtx;
    readsData = await fs.readReads(ctx.dataHandle);

    const saved = loadSessionFromStorage();
    if (saved && store.getBookById(ctx.library, saved.bookId)) {
      session = saved;
      await enterTimerStep();
    } else {
      if (saved) clearSessionStorage();
      await renderBookPicker();
      showStep("book");
    }
  });
})();
