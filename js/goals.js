window.RI = window.RI || {};

// classic script, not a module: file:// blocks ES module fetches via CORS
// Pure goal logic, no DOM. Needs RI.store loaded first.

RI.goals = (function () {
  "use strict";

  const MAX_DAILY_PAGES = 9999;
  const MAX_YEARLY_BOOKS = 999;
  const RECENT_WINDOW_DAYS = 30;

  function defaultGoals() {
    return { dailyPages: null, yearlyBooks: null, updatedAt: null };
  }

  function positiveIntOrNull(value) {
    return Number.isSafeInteger(value) && value >= 1 ? value : null;
  }

  // Coerces whatever was read from disk into a valid goals object
  function normalizeGoals(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return {
      dailyPages: positiveIntOrNull(src.dailyPages),
      yearlyBooks: positiveIntOrNull(src.yearlyBooks),
      updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : null,
    };
  }

  function buildGoals(dailyPages, yearlyBooks, nowISO) {
    return {
      dailyPages: positiveIntOrNull(dailyPages),
      yearlyBooks: positiveIntOrNull(yearlyBooks),
      updatedAt: nowISO || new Date().toISOString(),
    };
  }

  function hasAnyGoal(goals) {
    return !!(goals && (goals.dailyPages || goals.yearlyBooks));
  }

  // Form text -> { valid, value }. Empty means "remove this goal" (value null).
  function parseGoalInput(text, max) {
    const trimmed = String(text === null || text === undefined ? "" : text).trim();
    if (trimmed === "") return { valid: true, value: null };
    if (!/^\d+$/.test(trimmed)) return { valid: false, value: null };
    const n = Number(trimmed);
    if (n < 1 || n > max) return { valid: false, value: null };
    return { valid: true, value: n };
  }

  function ratio(done, goal) {
    return goal > 0 ? Math.min(1, done / goal) : 0;
  }

  // Pages logged today. Past reads have no date, so pagesPerDay skips them.
  function dailyProgress(library, goals, todayISO) {
    const goal = goals.dailyPages;
    if (!goal) return null;
    const pages = RI.store.pagesPerDay(library).get(todayISO) || 0;
    return { goal, pages, ratio: ratio(pages, goal), met: pages >= goal };
  }

  // Days in the trailing window (today included) that reached the goal.
  // Uses the current goal for every day, since goals keep no history.
  function dailyGoalDays(library, goals, todayISO, windowDays) {
    const goal = goals.dailyPages;
    if (!goal) return null;
    const days = windowDays || RECENT_WINDOW_DAYS;
    const perDay = RI.store.pagesPerDay(library);
    let met = 0;
    for (let i = 0; i < days; i += 1) {
      if ((perDay.get(RI.store.addDaysISO(todayISO, -i)) || 0) >= goal) met += 1;
    }
    return { met, days };
  }

  // Own implementation, used until RI.store.completedReads exists: one entry
  // per finished book, dated by its last dated log (null if it has none).
  function fallbackCompletedReads(library) {
    const reads = [];
    library.books.forEach((book) => {
      if (!RI.store.isBookFinished(library, book)) return;
      let finishedDate = null;
      RI.store.logsForBook(library, book.id).forEach((log) => {
        if (log.isPastRead || !log.date) return;
        if (finishedDate === null || log.date > finishedDate) finishedDate = log.date;
      });
      reads.push({ bookId: book.id, cycle: 1, finishedDate });
    });
    return reads;
  }

  // Looked up on every call so the store's cycle-aware version takes over
  // as soon as it is defined, with no change needed here.
  function completedReads(library) {
    if (typeof RI.store.completedReads === "function") {
      const reads = RI.store.completedReads(library);
      if (Array.isArray(reads)) return reads;
    }
    return fallbackCompletedReads(library);
  }

  // Completed reads in the calendar year of todayISO. Entries without a
  // finished date count for no year.
  function yearlyProgress(library, goals, todayISO) {
    const goal = goals.yearlyBooks;
    if (!goal) return null;
    const year = todayISO.slice(0, 4);
    const count = completedReads(library).filter(
      (r) => r && typeof r.finishedDate === "string" && r.finishedDate.slice(0, 4) === year
    ).length;
    return { goal, count, year: Number(year), ratio: ratio(count, goal), met: count >= goal };
  }

  return {
    MAX_DAILY_PAGES,
    MAX_YEARLY_BOOKS,
    RECENT_WINDOW_DAYS,
    defaultGoals,
    normalizeGoals,
    buildGoals,
    hasAnyGoal,
    parseGoalInput,
    dailyProgress,
    dailyGoalDays,
    completedReads,
    yearlyProgress,
  };
})();
