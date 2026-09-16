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

  function renderAll() {
    renderStats();
    renderHeatmap();
    renderLogList();
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
  });
})();
