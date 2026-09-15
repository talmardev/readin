(function () {
  "use strict";

  const store = RI.store;
  const fs = RI.fs;
  const t = RI.i18n.t;

  const SESSION_STORAGE_KEY = "readin-active-read-session";
  const TICK_MS = 250;

  let ctx = null;
  let readsData = null;

  let selectedBookId = null;
  let selectedMode = "countdown"; // "countdown" | "stopwatch"
  let session = null; // { bookId, mode, plannedMinutes, startedAt, pausedSeconds, pauseStartedAt, endedAt, endedEarly, activeSeconds }
  let tickTimer = null;

  let pickerCoverUrls = [];
  let selectedBookCoverUrl = null;
  let selectedBookCoverForId = null;

  const bookGroupsEl = document.getElementById("read-book-groups");
  const noBooksEl = document.getElementById("read-no-books");

  const durationBookEl = document.getElementById("duration-book");
  const durationHeadingEl = document.getElementById("duration-heading");
  const modeToggleEl = document.getElementById("read-mode-toggle");
  const durationPickerFieldsEl = document.getElementById("duration-picker-fields");
  const stopwatchNoteEl = document.getElementById("stopwatch-note");
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
  const finishedStoppedInput = document.getElementById("finished-stopped-input");
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

  // pages already logged for the finished session's book: the offset that
  // converts between "pages read this session" and "stopped at page"
  let finishedPagesAlready = 0;
  let finishedLastEditedStopped = false;

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
        mode: session.mode,
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
      if (!parsed || !parsed.bookId || !parsed.startedAt) return null;
      // sessions saved before stopwatch mode existed have no `mode` field;
      // they were always countdown sessions, so default them to that
      const mode = parsed.mode === "stopwatch" ? "stopwatch" : "countdown";
      if (mode === "countdown" && !parsed.plannedMinutes) return null;
      return {
        bookId: parsed.bookId,
        mode,
        plannedMinutes: mode === "stopwatch" ? null : Number(parsed.plannedMinutes),
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
    return new Date(iso).toLocaleTimeString(RI.i18n.getLocale(), { hour: "numeric", minute: "2-digit" });
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
      parts.push(t("read.percentRead", { percent: store.progressForBook(ctx.library, book).percent }));
    } else if (tierKey === "notStarted") {
      parts.push(t("read.notStarted"));
    } else {
      parts.push(t("read.finishedTag"));
    }
    return parts.join(" · ");
  }

  async function buildReadBookRow(book, tier) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "log-row read-book-row" + (tier.disabled ? " is-disabled" : "");
    if (tier.disabled) {
      row.disabled = true;
      row.title = t("read.disabledRowTitle");
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
      { key: "inProgress", label: t("read.tierContinue"), books: groups.inProgress, disabled: false },
      { key: "notStarted", label: t("read.tierStartNew"), books: groups.notStarted, disabled: false },
      { key: "finished", label: t("read.tierFinished"), books: groups.finished, disabled: true },
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

  function setMode(mode) {
    selectedMode = mode;
    modeToggleEl.querySelectorAll(".mode-toggle-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });
    durationPickerFieldsEl.classList.toggle("hidden", mode === "stopwatch");
    stopwatchNoteEl.classList.toggle("hidden", mode !== "stopwatch");
    durationHeadingEl.textContent = mode === "stopwatch" ? t("read.durationHeadingStopwatch") : t("read.durationHeadingCountdown");
    durationFormError.textContent = "";
  }

  modeToggleEl.querySelectorAll(".mode-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  async function renderDurationStep(book) {
    await renderBookSummary(durationBookEl, book);
    durationFormError.textContent = "";
    durationCustomInput.value = 25;
    setActiveChip(25);
    setMode("countdown");
  }

  startBtn.addEventListener("click", async () => {
    let minutes = null;
    if (selectedMode === "countdown") {
      minutes = Math.round(Number(durationCustomInput.value));
      if (!minutes || minutes < 1) {
        durationFormError.textContent = t("read.errAtLeast1Minute");
        return;
      }
    }
    durationFormError.textContent = "";

    const now = Date.now();
    session = {
      bookId: selectedBookId,
      mode: selectedMode,
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
    pauseBtn.textContent = isPaused ? t("read.resumeBtn") : t("read.pauseBtn");
    pauseBtn.classList.toggle("btn-primary", isPaused);
    pauseBtn.classList.toggle("btn-secondary", !isPaused);
    timerStateEl.textContent = isPaused ? t("read.timerStatePaused") : t("read.timerStateReading");
  }

  function tick() {
    const now = Date.now();
    if (session.mode === "stopwatch") {
      // stopwatch has no total to count down against, so the ring just
      // stays fully lit (set once in enterTimerStep) as a "running" cue;
      // only the elapsed time counts up, and only "Stop Reading" ends it
      timerTimeEl.textContent = formatMMSS(activeMs(now));
      return;
    }
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
    if (session.mode === "stopwatch") {
      timerRingProgress.style.strokeDashoffset = "0";
    }
    endBtn.textContent = session.mode === "stopwatch" ? t("read.stopReadingBtn") : t("read.endEarlierBtn");
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
      // not to "now": a backgrounded/throttled tab can call this well after
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

    const progress = store.progressForBook(ctx.library, book);
    finishedPagesAlready = progress.pagesRead;
    finishedLastEditedStopped = false;
    const remaining = store.remainingPages(ctx.library, book);
    finishedPagesInput.value = "";
    finishedPagesInput.max = remaining > 0 ? remaining : "";
    finishedStoppedInput.value = "";
    finishedStoppedInput.min = progress.pagesRead + 1;
    finishedStoppedInput.max = progress.totalPages;
    finishedFormError.textContent = "";
  }

  // the two finish-screen inputs are two views of one value:
  //   stoppedAtPage = pagesAlreadyRead + pagesReadThisSession
  // editing either recomputes the other. Setting .value in JS doesn't fire an
  // "input" event, so these handlers can't bounce off each other.
  finishedPagesInput.addEventListener("input", () => {
    finishedLastEditedStopped = false;
    if (finishedPagesInput.value === "") {
      finishedStoppedInput.value = "";
      return;
    }
    const pages = Math.round(Number(finishedPagesInput.value));
    if (!Number.isFinite(pages)) return;
    finishedStoppedInput.value = finishedPagesAlready + pages;
  });

  finishedStoppedInput.addEventListener("input", () => {
    finishedLastEditedStopped = true;
    if (finishedStoppedInput.value === "") {
      finishedPagesInput.value = "";
      return;
    }
    const stopped = Math.round(Number(finishedStoppedInput.value));
    if (!Number.isFinite(stopped)) return;
    finishedPagesInput.value = stopped - finishedPagesAlready;
  });

  // ---- rating modal ----

  async function persistRatings() {
    try {
      await fs.writeRatings(ctx.dataHandle, ctx.ratingsData);
    } catch (err) {
      console.error(err);
      RI.toast(t("common.couldNotSaveRatingPrefix") + (err && err.message ? err.message : t("common.unknownError")), "error");
    }
  }

  // one interactive star position: a visual glyph (bg + fg) plus two
  // invisible half-width buttons stacked on top: clicking is a real DOM
  // element hit (dedicated "set to X.5" / "set to X" buttons), not
  // pixel-position math against getBoundingClientRect, so it's reliable
  // regardless of zoom/DPI/click precision, and every half-star is reachable
  // by keyboard/Tab. Same approach as js/library.js's picker, kept
  // duplicated per this codebase's per-page style rather than factored into
  // a shared file.
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

  const rateModalStarPicker = buildStarPicker(rateModalPicker);

  async function openRateModal(bookId) {
    const book = store.getBookById(ctx.library, bookId);
    if (!book) return;
    rateModalBookId = bookId;
    await renderBookSummary(rateModalBookEl, book);
    rateModalStarPicker.setValue(0);
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
  rateModalStarPicker.setOnPick(async (value) => {
    if (!rateModalBookId) return;
    store.setRating(ctx.ratingsData, rateModalBookId, value);
    await persistRatings();
    closeRateModal();
  });

  finishedForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const book = store.getBookById(ctx.library, session.bookId);
    if (!book) {
      finishedFormError.textContent = t("read.errBookGone");
      return;
    }
    const pages = Number(finishedPagesInput.value);
    if (!pages || pages < 1) {
      finishedFormError.textContent = finishedLastEditedStopped
        ? t("read.errStoppedMustBePast")
        : t("read.errEnterAtLeast1Page");
      return;
    }
    const remaining = store.remainingPages(ctx.library, book);
    if (remaining <= 0) {
      finishedFormError.textContent = t("read.errAlreadyFinished");
      return;
    }
    if (pages > remaining) {
      finishedFormError.textContent = t("read.errOnlyNPagesLeft", { count: remaining, n: remaining });
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
        mode: session.mode,
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
      const summary = t("read.savedSummary", { count: pages, n: pages, title: book.title });
      const bookId = session.bookId;
      session = null;

      // this log just finished the book (remaining was checked >0 above):
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
      finishedFormError.textContent = t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError"));
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

  function setDocTitle() {
    document.title = "readin' - " + t("nav.read");
  }

  RI.i18n.onChange(async () => {
    setDocTitle();
    if (!ctx) return;
    // re-render whichever step is currently visible so a language switch
    // mid-flow updates instantly instead of only on the next navigation
    if (!stepEls.book.classList.contains("hidden")) await renderBookPicker();
    else if (!stepEls.duration.classList.contains("hidden")) setMode(selectedMode);
    else if (!stepEls.timer.classList.contains("hidden")) {
      setPauseUI(!!session.pauseStartedAt);
      endBtn.textContent = session.mode === "stopwatch" ? t("read.stopReadingBtn") : t("read.endEarlierBtn");
    } else if (!stepEls.finished.classList.contains("hidden")) await renderFinishedStep();
  });

  RI.boot(async (bootCtx) => {
    ctx = bootCtx;
    setDocTitle();
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
