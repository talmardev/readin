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
  let session = null; // the active timer session
  let tickTimer = null;
  // set when a countdown ends hidden
  let timeUpWhileHidden = false;

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
  const rateModalQuestion = document.getElementById("rate-modal-question");
  let rateModalBookId = null;
  let pendingSavedSummary = null;

  // pages already logged, the stopped-at offset
  let finishedPagesAlready = 0;
  let finishedLastEditedStopped = false;
  // set once this session's log is on disk
  let finishedLogId = null;

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
    updateDocTitle();
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
      // old sessions without mode were countdown
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

  // cover url helpers

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

  // Step: book picker

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
    const readNumber = store.readCountForBook(ctx.library, book.id);
    if (readNumber > 1 && tierKey !== "finished") parts.push(t("reread.readNumber", { n: readNumber }));
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

  // step: duration picker

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

  // Step: timer

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
    updateDocTitle();
  }

  // one place decides the tab title
  function computeDocTitle(now) {
    if (timeUpWhileHidden && document.hidden) return t("read.titleTimeUp") + " · readin'";
    if (!session || stepEls.timer.classList.contains("hidden")) return "readin' - " + t("nav.read");
    const stopwatch = session.mode === "stopwatch";
    const ms = stopwatch ? activeMs(now) : Math.max(0, remainingMs(now));
    // hidden tabs tick slowly, so show minutes
    const clock = document.hidden
      ? t("read.titleMinutes", { n: stopwatch ? Math.floor(ms / 60000) : Math.ceil(ms / 60000) })
      : formatMMSS(ms);
    return session.pauseStartedAt ? clock + " · " + t("read.timerStatePaused") : clock + " · readin'";
  }

  function updateDocTitle(now) {
    const title = computeDocTitle(now || Date.now());
    if (document.title !== title) document.title = title;
  }

  function tick() {
    const now = Date.now();
    if (session.mode === "stopwatch") {
      // stopwatch ring stays lit, only Stop ends it
      timerTimeEl.textContent = formatMMSS(activeMs(now));
      updateDocTitle(now);
      return;
    }
    const rem = remainingMs(now);
    updateRingAndTime(Math.max(0, rem));
    updateDocTitle(now);
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

  // step: finished

  async function finishSession(endedEarly, now) {
    timeUpWhileHidden = !endedEarly && document.hidden;
    finishedLogId = null;
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
      // anchor to when the clock hit zero
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

  // two views of one value, no input loops
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

  // rating modal

  async function persistRatings() {
    try {
      await RI.stale.run(() => fs.writeRatings(ctx.dataHandle, ctx.ratingsData));
    } catch (err) {
      console.error(err);
      RI.toast(t("common.couldNotSaveRatingPrefix") + (err && err.message ? err.message : t("common.unknownError")), "error");
    }
  }

  // Star slot, same as the library picker
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
    // after a reread, prefill the old rating
    const rating = store.getRating(ctx.ratingsData, bookId);
    const previous = rating && rating.stars ? rating.stars : 0;
    rateModalQuestion.setAttribute("data-i18n", previous ? "reread.rateQuestionAgain" : "library.rateModalQuestion");
    rateModalQuestion.textContent = t(previous ? "reread.rateQuestionAgain" : "library.rateModalQuestion");
    rateModalSkip.setAttribute("data-i18n", previous ? "reread.rateKeep" : "library.rateModalSkip");
    rateModalSkip.textContent = t(previous ? "reread.rateKeep" : "library.rateModalSkip");
    rateModalStarPicker.setValue(previous);
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

  // re-read the files, keep the timed session
  async function reloadDataFromDisk() {
    const { library: base, logs } = await fs.readLibraryAndLogs(ctx.dataHandle);
    ctx.library = { books: base.books, categories: base.categories, logs };
    ctx.ratingsData = await fs.readRatings(ctx.dataHandle);
    readsData = await fs.readReads(ctx.dataHandle);
  }

  // reload, then save on top
  async function reloadThenSave() {
    try {
      await reloadDataFromDisk();
    } catch (err) {
      console.error(err);
      finishedFormError.textContent = t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError"));
      return;
    }
    await saveFinishedSession();
  }

  const staleOptions = { reloadNoteKey: "stale.reloadNoteSession", onReload: reloadThenSave };

  // safe to call again after a reload
  async function saveFinishedSession() {
    const book = store.getBookById(ctx.library, session.bookId);
    const pages = Number(finishedPagesInput.value);
    // checks only apply before the log exists
    if (!finishedLogId) {
      if (!book) {
        finishedFormError.textContent = t("read.errBookGone");
        return;
      }
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
    }
    finishedFormError.textContent = "";
    finishedSaveBtn.disabled = true;

    let readRow = null;
    try {
      if (!finishedLogId) {
        const log = store.addLog(ctx.library, {
          bookId: session.bookId,
          pagesRead: pages,
          date: store.todayISODate(),
          isPastRead: false,
        });
        if (!(await RI.stale.run(() => fs.writeLibraryAndLogs(ctx.dataHandle, ctx.library), staleOptions))) return;
        finishedLogId = log.id;
      }

      readRow = store.createReadSession(readsData, {
        bookId: session.bookId,
        logId: finishedLogId,
        mode: session.mode,
        plannedMinutes: session.plannedMinutes,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        pausedSeconds: session.pausedSeconds,
        activeSeconds: session.activeSeconds,
        endedEarly: session.endedEarly,
        pagesRead: pages,
      });
      if (!(await RI.stale.run(() => fs.writeReads(ctx.dataHandle, readsData), staleOptions))) return;

      finishedLogId = null;
      clearSessionStorage();
      const summary = t("read.savedSummary", {
        count: pages,
        n: pages,
        title: book ? book.title : t("streak.rowDeletedBook"),
      });
      const bookId = session.bookId;
      session = null;

      // offer the rating modal after a finish
      if (store.shouldPromptRating(ctx.library, ctx.ratingsData, bookId)) {
        store.markRatingNudged(ctx.ratingsData, bookId, store.todayISODate());
        await persistRatings();
        pendingSavedSummary = summary;
        await openRateModal(bookId);
        return;
      }

      savedSummaryEl.textContent = summary;
      showStep("saved");
    } catch (err) {
      console.error(err);
      // a retry must not push the row twice
      const rowIdx = readRow ? readsData.reads.indexOf(readRow) : -1;
      if (rowIdx !== -1) readsData.reads.splice(rowIdx, 1);
      finishedFormError.textContent = t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError"));
    } finally {
      finishedSaveBtn.disabled = false;
    }
  }

  finishedForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveFinishedSession();
  });

  savedReadAgainBtn.addEventListener("click", async () => {
    selectedBookId = null;
    await renderBookPicker();
    showStep("book");
  });

  // Boot

  // catch up at once, background timers lag
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) timeUpWhileHidden = false;
    if (tickTimer) tick();
    else updateDocTitle();
  });

  RI.i18n.onChange(async () => {
    updateDocTitle();
    if (!ctx) return;
    // re-render the visible step on language change
    if (!stepEls.book.classList.contains("hidden")) await renderBookPicker();
    else if (!stepEls.duration.classList.contains("hidden")) setMode(selectedMode);
    else if (!stepEls.timer.classList.contains("hidden")) {
      setPauseUI(!!session.pauseStartedAt);
      endBtn.textContent = session.mode === "stopwatch" ? t("read.stopReadingBtn") : t("read.endEarlierBtn");
    } else if (!stepEls.finished.classList.contains("hidden")) await renderFinishedStep();
  });

  RI.boot(async (bootCtx) => {
    ctx = bootCtx;
    updateDocTitle();
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
