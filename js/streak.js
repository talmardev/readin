(function () {
  "use strict";

  const store = RI.store;
  const fs = RI.fs;
  const t = RI.i18n.t;

  const WEEK_COUNT = 53;
  // must match .heatmap-cell's width + gap in css, not derived automatically
  const CELL_STEP = 15;

  let ctx = null;
  let logListCoverUrls = [];

  const streakDaysNum = document.getElementById("streak-days-num");
  const streakDaysWord = document.getElementById("streak-days-word");
  const streakTodayDot = document.getElementById("streak-today-dot");
  const longestStreakNum = document.getElementById("longest-streak-num");
  const miniTotalPages = document.getElementById("mini-total-pages");
  const miniBooksRead = document.getElementById("mini-books-read");
  const miniAvgDays = document.getElementById("mini-avg-days");
  const miniAvgPagesDay = document.getElementById("mini-avg-pages-day");
  const heatmapMonths = document.getElementById("heatmap-months");
  const heatmapGrid = document.getElementById("heatmap-grid");
  const logList = document.getElementById("log-list");
  const logListEmpty = document.getElementById("log-list-empty");

  const SVG_NS = "http://www.w3.org/2000/svg";
  // keep in sync with the ring's viewBox and stroke width in css (.goal-ring-*)
  const RING_RADIUS = 34;

  const goalsSection = document.getElementById("goals-section");
  const goalsEditBtn = document.getElementById("goals-edit-btn");
  const goalsGrid = document.getElementById("goals-grid");
  const goalsEmpty = document.getElementById("goals-empty");
  const goalsModalOverlay = document.getElementById("goals-modal-overlay");
  const goalsModalClose = document.getElementById("goals-modal-close");
  const goalsModalCancel = document.getElementById("goals-modal-cancel");
  const goalsModalSubmit = document.getElementById("goals-modal-submit");
  const goalsForm = document.getElementById("goals-form");
  const goalDailyInput = document.getElementById("goal-daily-input");
  const goalYearlyInput = document.getElementById("goal-yearly-input");
  const goalsFormError = document.getElementById("goals-form-error");

  let goalsData = RI.goals.defaultGoals();
  let goalsLoaded = false;
  // rebuilds the visible form error text so it follows language switches
  let goalsFormErrorBuilder = null;

  function levelForPages(pages) {
    if (!pages) return 0;
    if (pages <= 15) return 1;
    if (pages <= 30) return 2;
    if (pages <= 60) return 3;
    return 4;
  }

  function buildHeatmapWeeks(todayISO, weekCount) {
    const today = store.parseISODate(todayISO);
    const endDow = today.getDay();
    const gridEnd = new Date(today);
    gridEnd.setDate(gridEnd.getDate() + (6 - endDow));
    const gridStart = new Date(gridEnd);
    gridStart.setDate(gridStart.getDate() - (weekCount * 7 - 1));

    const weeks = [];
    const cursor = new Date(gridStart);
    for (let w = 0; w < weekCount; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const iso = store.toISODate(cursor);
        week.push({ date: iso, isFuture: iso > todayISO });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  }

  function formatDateLong(isoDate) {
    const d = store.parseISODate(isoDate);
    return d.toLocaleDateString(RI.i18n.getLocale(), {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatDateDisplay(isoDate) {
    if (!isoDate) return t("common.dash");
    const d = store.parseISODate(isoDate);
    return d.toLocaleDateString(RI.i18n.getLocale(), { month: "short", day: "numeric", year: "numeric" });
  }

  function renderHeatmap() {
    const todayISO = store.todayISODate();
    const weeks = buildHeatmapWeeks(todayISO, WEEK_COUNT);
    const pagesPerDay = store.pagesPerDay(ctx.library);
    const monthNames = RI.i18n.tArray("streak.monthNames");

    heatmapGrid.innerHTML = "";
    heatmapMonths.innerHTML = "";

    let lastMonth = null;

    weeks.forEach((week, w) => {
      const monthOfWeek = store.parseISODate(week[0].date).getMonth();
      if (monthOfWeek !== lastMonth) {
        lastMonth = monthOfWeek;
        const label = document.createElement("span");
        label.textContent = monthNames[monthOfWeek];
        label.style.left = w * CELL_STEP + "px";
        heatmapMonths.appendChild(label);
      }

      week.forEach((day) => {
        const cell = document.createElement("div");
        cell.className = "heatmap-cell";
        if (day.isFuture) {
          cell.classList.add("is-future");
        } else {
          const pages = pagesPerDay.get(day.date) || 0;
          const level = levelForPages(pages);
          if (level > 0) cell.classList.add("lvl-" + level);
          if (day.date === todayISO) cell.classList.add("is-today");
          const pagesLabel = pages > 0 ? t("streak.cellPages", { count: pages, n: pages }) : t("streak.cellNoReading");
          cell.title = t("streak.cellTooltip", { pagesLabel, date: formatDateLong(day.date) });
        }
        heatmapGrid.appendChild(cell);
      });
    });
  }

  function renderStats() {
    const current = store.currentStreak(ctx.library);
    const longest = store.longestStreak(ctx.library);
    streakDaysNum.textContent = current;
    streakDaysWord.textContent = t("streak.day", { count: current });
    longestStreakNum.textContent = longest;

    const today = store.todayISODate();
    const readToday = store.datedLogDateSet(ctx.library).has(today);
    streakTodayDot.classList.toggle("hidden", !(current > 0 && readToday));

    miniTotalPages.textContent = store.totalPagesRead(ctx.library).toLocaleString(RI.i18n.getLocale());
    miniBooksRead.textContent = store.booksReadCount(ctx.library);

    const avgDays = store.averageDaysToComplete(ctx.library);
    miniAvgDays.textContent = avgDays === null ? t("common.dash") : Math.round(avgDays * 10) / 10;

    const avgPagesDay = store.averagePagesPerDay(ctx.library);
    miniAvgPagesDay.textContent = avgPagesDay === null ? t("common.dash") : Math.round(avgPagesDay * 10) / 10;
  }

  function coverPlaceholder(book) {
    const ph = document.createElement("div");
    ph.className = "log-row-cover-placeholder";
    ph.textContent = book ? book.title.charAt(0).toUpperCase() || "?" : "?";
    return ph;
  }

  async function renderLogList() {
    logListCoverUrls.forEach((u) => URL.revokeObjectURL(u));
    logListCoverUrls = [];
    logList.innerHTML = "";

    const logs = store.sortedLogsNewestFirst(ctx.library);
    if (logs.length === 0) {
      logListEmpty.classList.remove("hidden");
      return;
    }
    logListEmpty.classList.add("hidden");

    for (const log of logs) {
      const book = store.getBookById(ctx.library, log.bookId);
      const row = document.createElement("div");
      row.className = "log-row";

      let coverEl = null;
      if (book && book.coverFile) {
        const url = await fs.readCoverAsURL(ctx.coversHandle, book.coverFile);
        if (url) {
          logListCoverUrls.push(url);
          const img = document.createElement("img");
          img.className = "log-row-cover";
          img.src = url;
          img.alt = "";
          coverEl = img;
        }
      }
      row.appendChild(coverEl || coverPlaceholder(book));

      const lines = document.createElement("div");
      lines.className = "log-row-lines";

      const pages = document.createElement("p");
      pages.className = "log-row-pages";
      pages.textContent = t("streak.rowPages", { count: log.pagesRead, n: log.pagesRead });

      const date = document.createElement("p");
      date.className = "log-row-date";
      date.textContent = log.isPastRead ? t("streak.rowPastRead") : formatDateDisplay(log.date);

      const title = document.createElement("p");
      title.className = "log-row-title";
      title.textContent = book ? book.title : t("streak.rowDeletedBook");

      lines.appendChild(pages);
      lines.appendChild(date);
      lines.appendChild(title);
      row.appendChild(lines);
      logList.appendChild(row);
    }
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach((key) => el.setAttribute(key, attrs[key]));
    return el;
  }

  function textEl(className, text) {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    return p;
  }

  function percentLabel(ratio) {
    const fmt = new Intl.NumberFormat(RI.i18n.getLocale(), { style: "percent", maximumFractionDigits: 0 });
    // floor so 99.6% never reads as 100% before the goal is actually met
    return fmt.format(Math.floor(ratio * 100) / 100);
  }

  function buildCheckIcon() {
    const svg = svgEl("svg", { viewBox: "0 0 24 24", class: "goal-check", "aria-hidden": "true", focusable: "false" });
    svg.appendChild(svgEl("path", { d: "M5 12.5l4.5 4.5L19 7.5" }));
    return svg;
  }

  function buildRing(gradientId, ratio, met) {
    const wrap = document.createElement("div");
    wrap.className = "goal-ring";
    if (met) wrap.title = t("goals.metTitle");

    const svg = svgEl("svg", { viewBox: "0 0 80 80", class: "goal-ring-svg", "aria-hidden": "true", focusable: "false" });
    const gradient = svgEl("linearGradient", { id: gradientId, x1: "0", y1: "0", x2: "1", y2: "1" });
    gradient.appendChild(svgEl("stop", { offset: "0", class: "goal-stop-from" }));
    gradient.appendChild(svgEl("stop", { offset: "1", class: "goal-stop-to" }));
    const defs = svgEl("defs", {});
    defs.appendChild(gradient);
    svg.appendChild(defs);
    svg.appendChild(svgEl("circle", { cx: "40", cy: "40", r: String(RING_RADIUS), class: "goal-ring-track" }));
    if (ratio > 0) {
      svg.appendChild(
        svgEl("circle", {
          cx: "40",
          cy: "40",
          r: String(RING_RADIUS),
          class: "goal-ring-fill",
          stroke: "url(#" + gradientId + ")",
          pathLength: "100",
          "stroke-dasharray": ratio * 100 + " 100",
          transform: "rotate(-90 40 40)",
        })
      );
    }
    wrap.appendChild(svg);

    const center = document.createElement("span");
    center.className = "goal-ring-center";
    if (met) center.appendChild(buildCheckIcon());
    else center.textContent = percentLabel(ratio);
    wrap.appendChild(center);
    return wrap;
  }

  function buildGoalTile(opts) {
    const tile = document.createElement("div");
    tile.className = "goal-tile" + (opts.met ? " is-met" : "");
    tile.appendChild(buildRing(opts.gradientId, opts.ratio, opts.met));

    const text = document.createElement("div");
    text.className = "goal-text";
    text.appendChild(textEl("goal-caption", opts.caption));

    const figure = document.createElement("p");
    figure.className = "goal-figure";
    const num = document.createElement("span");
    num.className = "goal-num";
    num.textContent = opts.figure;
    const unit = document.createElement("span");
    unit.className = "goal-unit";
    unit.textContent = opts.unit;
    figure.appendChild(num);
    figure.appendChild(document.createTextNode(" "));
    figure.appendChild(unit);
    text.appendChild(figure);

    if (opts.note) text.appendChild(textEl("goal-note", opts.note));
    tile.appendChild(text);
    return tile;
  }

  function renderGoals() {
    goalsSection.classList.toggle("hidden", !goalsLoaded);
    if (!goalsLoaded) return;

    const locale = RI.i18n.getLocale();
    const fmt = (n) => n.toLocaleString(locale);
    const todayISO = store.todayISODate();
    const hasAny = RI.goals.hasAnyGoal(goalsData);

    goalsEditBtn.textContent = t(hasAny ? "goals.editBtn" : "goals.setBtn");
    goalsEmpty.classList.toggle("hidden", hasAny);
    goalsGrid.classList.toggle("hidden", !hasAny);
    goalsGrid.innerHTML = "";
    if (!hasAny) return;

    const daily = RI.goals.dailyProgress(ctx.library, goalsData, todayISO);
    if (daily) {
      const recent = RI.goals.dailyGoalDays(ctx.library, goalsData, todayISO);
      goalsGrid.appendChild(
        buildGoalTile({
          gradientId: "goal-grad-daily",
          ratio: daily.ratio,
          met: daily.met,
          caption: t("goals.dailyCaption"),
          figure: fmt(daily.pages) + " / " + fmt(daily.goal),
          unit: t("goals.dailyUnit", { count: daily.goal }),
          note: t("goals.recentDays", { count: recent.met, met: fmt(recent.met), days: recent.days }),
        })
      );
    }

    const yearly = RI.goals.yearlyProgress(ctx.library, goalsData, todayISO);
    if (yearly) {
      goalsGrid.appendChild(
        buildGoalTile({
          gradientId: "goal-grad-yearly",
          ratio: yearly.ratio,
          met: yearly.met,
          caption: t("goals.yearlyCaption"),
          figure: fmt(yearly.count) + " / " + fmt(yearly.goal),
          unit: t("goals.yearlyUnit", { count: yearly.goal, year: yearly.year }),
          note: null,
        })
      );
    }
  }

  // goals render in isolation so a goals bug can never block the streak,
  // heatmap or log list
  function renderGoalsSafe() {
    try {
      renderGoals();
    } catch (err) {
      console.error(err);
    }
  }

  async function loadGoals() {
    try {
      goalsData = RI.goals.normalizeGoals(await fs.readGoals(ctx.dataHandle));
    } catch (err) {
      console.error(err);
      RI.toast(t("goals.errCouldNotLoadPrefix") + (err && err.message ? err.message : t("common.unknownError")), "error");
      goalsData = RI.goals.defaultGoals();
    }
    goalsLoaded = true;
    renderGoalsSafe();
  }

  function isGoalsModalOpen() {
    return !goalsModalOverlay.classList.contains("hidden");
  }

  function setGoalsFormError(builder) {
    goalsFormErrorBuilder = builder;
    goalsFormError.textContent = builder ? builder() : "";
  }

  function openGoalsModal() {
    goalDailyInput.value = goalsData.dailyPages ? String(goalsData.dailyPages) : "";
    goalYearlyInput.value = goalsData.yearlyBooks ? String(goalsData.yearlyBooks) : "";
    setGoalsFormError(null);
    goalsModalSubmit.disabled = false;
    goalsModalOverlay.classList.remove("hidden");
    goalDailyInput.focus();
    goalDailyInput.select();
  }

  function closeGoalsModal() {
    goalsModalOverlay.classList.add("hidden");
    goalsEditBtn.focus();
  }

  async function handleGoalsSubmit(e) {
    e.preventDefault();
    const daily = RI.goals.parseGoalInput(goalDailyInput.value, RI.goals.MAX_DAILY_PAGES);
    if (!daily.valid) {
      setGoalsFormError(() => t("goals.errInvalid", { max: RI.goals.MAX_DAILY_PAGES }));
      goalDailyInput.focus();
      return;
    }
    const yearly = RI.goals.parseGoalInput(goalYearlyInput.value, RI.goals.MAX_YEARLY_BOOKS);
    if (!yearly.valid) {
      setGoalsFormError(() => t("goals.errInvalid", { max: RI.goals.MAX_YEARLY_BOOKS }));
      goalYearlyInput.focus();
      return;
    }
    if (daily.value === goalsData.dailyPages && yearly.value === goalsData.yearlyBooks) {
      closeGoalsModal();
      return;
    }

    const next = RI.goals.buildGoals(daily.value, yearly.value);
    goalsModalSubmit.disabled = true;
    try {
      await fs.writeGoals(ctx.dataHandle, next);
    } catch (err) {
      console.error(err);
      goalsModalSubmit.disabled = false;
      setGoalsFormError(() => t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError")));
      return;
    }
    goalsModalSubmit.disabled = false;
    goalsData = next;
    closeGoalsModal();
    renderGoalsSafe();
    RI.toast(t("goals.toastSaved"));
  }

  goalsEditBtn.addEventListener("click", openGoalsModal);
  goalsModalClose.addEventListener("click", closeGoalsModal);
  goalsModalCancel.addEventListener("click", closeGoalsModal);
  goalsForm.addEventListener("submit", handleGoalsSubmit);
  goalsModalOverlay.addEventListener("click", (e) => {
    if (e.target === goalsModalOverlay) closeGoalsModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isGoalsModalOpen()) closeGoalsModal();
  });
  RI.i18n.onChange(() => {
    if (goalsFormErrorBuilder) goalsFormError.textContent = goalsFormErrorBuilder();
  });

  function renderAll() {
    renderStats();
    renderHeatmap();
    renderLogList();
    renderGoalsSafe();
  }

  function setDocTitle() {
    document.title = "readin' - " + t("nav.stats");
  }

  RI.i18n.onChange(() => {
    setDocTitle();
    if (ctx) renderAll();
  });

  RI.boot((bootCtx) => {
    ctx = bootCtx;
    setDocTitle();
    renderAll();
    loadGoals();
  });
})();
