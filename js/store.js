window.RI = window.RI || {};

RI.store = (function () {
  "use strict";

  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toISODate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function todayISODate() {
    return toISODate(new Date());
  }

  function addDaysISO(isoDate, delta) {
    const [y, m, d] = isoDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    return toISODate(dt);
  }

  function parseISODate(isoDate) {
    const [y, m, d] = isoDate.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function createBook(library, { title, author, totalPages, coverFile }) {
    const book = {
      id: generateId(),
      title: title.trim(),
      author: (author || "").trim(),
      totalPages: Math.max(1, Math.round(Number(totalPages) || 0)),
      coverFile: coverFile || null,
      createdAt: new Date().toISOString(),
    };
    library.books.push(book);
    return book;
  }

  function getBookById(library, bookId) {
    return library.books.find((b) => b.id === bookId) || null;
  }

  function updateBook(library, bookId, patch) {
    const book = getBookById(library, bookId);
    if (!book) return null;
    if (patch.title !== undefined) book.title = patch.title.trim();
    if (patch.author !== undefined) book.author = patch.author.trim();
    if (patch.totalPages !== undefined) {
      book.totalPages = Math.max(1, Math.round(Number(patch.totalPages) || 0));
    }
    if (patch.coverFile !== undefined) book.coverFile = patch.coverFile;
    return book;
  }

  function deleteBook(library, bookId) {
    const idx = library.books.findIndex((b) => b.id === bookId);
    if (idx === -1) return null;
    const [removed] = library.books.splice(idx, 1);
    library.logs = library.logs.filter((l) => l.bookId !== bookId);
    return removed;
  }

  // pagesRead is pages read since the last log, not the current page number
  function addLog(library, { bookId, pagesRead, date, isPastRead }) {
    const log = {
      id: generateId(),
      bookId,
      pagesRead: Math.max(0, Math.round(Number(pagesRead) || 0)),
      date: isPastRead ? null : date || todayISODate(),
      isPastRead: !!isPastRead,
      createdAt: new Date().toISOString(),
    };
    library.logs.push(log);
    return log;
  }

  function deleteLog(library, logId) {
    const idx = library.logs.findIndex((l) => l.id === logId);
    if (idx === -1) return null;
    const [removed] = library.logs.splice(idx, 1);
    return removed;
  }

  function logsForBook(library, bookId) {
    return library.logs.filter((l) => l.bookId === bookId);
  }

  function pagesReadForBook(library, bookId) {
    return logsForBook(library, bookId).reduce((sum, l) => sum + (Number(l.pagesRead) || 0), 0);
  }

  function progressForBook(library, book) {
    const pagesRead = pagesReadForBook(library, book.id);
    const totalPages = Math.max(1, book.totalPages || 1);
    const percent = Math.max(0, Math.min(100, Math.round((pagesRead / totalPages) * 100)));
    return { pagesRead, totalPages, percent };
  }

  function hasLogToday(library, bookId) {
    const today = todayISODate();
    return logsForBook(library, bookId).some((l) => !l.isPastRead && l.date === today);
  }

  function lastActivityMap(library) {
    const map = new Map();
    for (const log of library.logs) {
      const t = Date.parse(log.createdAt) || 0;
      const cur = map.get(log.bookId);
      if (cur === undefined || t > cur) map.set(log.bookId, t);
    }
    return map;
  }

  function sortedBooksForLibrary(library) {
    const lastActivity = lastActivityMap(library);
    return library.books.slice().sort((a, b) => {
      const aT = lastActivity.has(a.id) ? lastActivity.get(a.id) : null;
      const bT = lastActivity.has(b.id) ? lastActivity.get(b.id) : null;
      if (aT !== null && bT !== null) return bT - aT;
      if (aT !== null) return -1;
      if (bT !== null) return 1;
      return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    });
  }

  function sortedLogsNewestFirst(library) {
    return library.logs.slice().sort((a, b) => {
      return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    });
  }

  // only dated logs count here — past-read entries have no date
  function datedLogDateSet(library) {
    const set = new Set();
    for (const log of library.logs) {
      if (!log.isPastRead && log.date) set.add(log.date);
    }
    return set;
  }

  function currentStreak(library, todayISO) {
    const today = todayISO || todayISODate();
    const dates = datedLogDateSet(library);
    if (dates.size === 0) return 0;
    let cursor;
    if (dates.has(today)) {
      cursor = today;
    } else {
      const yesterday = addDaysISO(today, -1);
      if (dates.has(yesterday)) {
        cursor = yesterday;
      } else {
        return 0;
      }
    }
    let streak = 0;
    while (dates.has(cursor)) {
      streak += 1;
      cursor = addDaysISO(cursor, -1);
    }
    return streak;
  }

  function longestStreak(library) {
    const dates = Array.from(datedLogDateSet(library)).sort();
    if (dates.length === 0) return 0;
    let longest = 1;
    let run = 1;
    for (let i = 1; i < dates.length; i++) {
      if (addDaysISO(dates[i - 1], 1) === dates[i]) {
        run += 1;
      } else {
        run = 1;
      }
      if (run > longest) longest = run;
    }
    return longest;
  }

  function pagesPerDay(library) {
    const map = new Map();
    for (const log of library.logs) {
      if (log.isPastRead || !log.date) continue;
      map.set(log.date, (map.get(log.date) || 0) + (Number(log.pagesRead) || 0));
    }
    return map;
  }

  return {
    generateId,
    toISODate,
    todayISODate,
    addDaysISO,
    parseISODate,

    createBook,
    getBookById,
    updateBook,
    deleteBook,

    addLog,
    deleteLog,
    logsForBook,

    pagesReadForBook,
    progressForBook,
    hasLogToday,

    sortedBooksForLibrary,
    sortedLogsNewestFirst,

    currentStreak,
    longestStreak,
    pagesPerDay,
    datedLogDateSet,
  };
})();
