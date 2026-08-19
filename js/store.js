window.RI = window.RI || {};

RI.store = (function () {
  "use strict";

  const DEFAULT_CATEGORIES = [
    { id: "nf-finance-investing", name: "Finance & Investing", group: "Non-Fiction" },
    { id: "nf-business", name: "Business", group: "Non-Fiction" },
    { id: "nf-economics", name: "Economics", group: "Non-Fiction" },
    { id: "nf-self-help", name: "Self-Help", group: "Non-Fiction" },
    { id: "nf-productivity", name: "Productivity", group: "Non-Fiction" },
    { id: "nf-psychology", name: "Psychology", group: "Non-Fiction" },
    { id: "nf-philosophy", name: "Philosophy", group: "Non-Fiction" },
    { id: "nf-history", name: "History", group: "Non-Fiction" },
    { id: "nf-biography-memoir", name: "Biography & Memoir", group: "Non-Fiction" },
    { id: "nf-politics", name: "Politics", group: "Non-Fiction" },
    { id: "nf-science", name: "Science", group: "Non-Fiction" },
    { id: "nf-technology", name: "Technology", group: "Non-Fiction" },
    { id: "nf-health-wellness", name: "Health & Wellness", group: "Non-Fiction" },
    { id: "nf-parenting-family", name: "Parenting & Family", group: "Non-Fiction" },
    { id: "nf-travel", name: "Travel", group: "Non-Fiction" },
    { id: "nf-true-crime", name: "True Crime", group: "Non-Fiction" },
    { id: "nf-religion-spirituality", name: "Religion & Spirituality", group: "Non-Fiction" },
    { id: "nf-sociology", name: "Sociology", group: "Non-Fiction" },
    { id: "nf-nature-environment", name: "Nature & Environment", group: "Non-Fiction" },
    { id: "nf-art-design", name: "Art & Design", group: "Non-Fiction" },
    { id: "nf-cooking-food", name: "Cooking & Food", group: "Non-Fiction" },
    { id: "nf-sports", name: "Sports", group: "Non-Fiction" },
    { id: "nf-essays-journalism", name: "Essays & Journalism", group: "Non-Fiction" },
    { id: "nf-law", name: "Law", group: "Non-Fiction" },
    { id: "nf-education", name: "Education", group: "Non-Fiction" },
    { id: "nf-reference", name: "Reference", group: "Non-Fiction" },
    { id: "fic-literary-fiction", name: "Literary Fiction", group: "Fiction" },
    { id: "fic-fantasy", name: "Fantasy", group: "Fiction" },
    { id: "fic-science-fiction", name: "Science Fiction", group: "Fiction" },
    { id: "fic-mystery", name: "Mystery", group: "Fiction" },
    { id: "fic-thriller", name: "Thriller", group: "Fiction" },
    { id: "fic-horror", name: "Horror", group: "Fiction" },
    { id: "fic-romance", name: "Romance", group: "Fiction" },
    { id: "fic-historical-fiction", name: "Historical Fiction", group: "Fiction" },
    { id: "fic-crime", name: "Crime", group: "Fiction" },
    { id: "fic-classics", name: "Classics", group: "Fiction" },
    { id: "fic-young-adult", name: "Young Adult", group: "Fiction" },
    { id: "fic-short-stories", name: "Short Stories", group: "Fiction" },
    { id: "fic-poetry", name: "Poetry", group: "Fiction" },
    { id: "fic-graphic-novels-comics", name: "Graphic Novels & Comics", group: "Fiction" },
    { id: "fic-adventure", name: "Adventure", group: "Fiction" },
    { id: "fic-dystopian", name: "Dystopian", group: "Fiction" },
    { id: "fic-satire", name: "Satire", group: "Fiction" },
  ];

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

  function normalizeOwnership(value) {
    return value === "owned" || value === "library" ? value : null;
  }

  function createBook(library, { title, author, totalPages, coverFile, ownership, isbn, categoryIds }) {
    const book = {
      id: generateId(),
      title: title.trim(),
      author: (author || "").trim(),
      totalPages: Math.max(1, Math.round(Number(totalPages) || 0)),
      coverFile: coverFile || null,
      ownership: normalizeOwnership(ownership),
      isbn: (isbn || "").trim() || null,
      categoryIds: Array.isArray(categoryIds) ? categoryIds.slice() : [],
      createdAt: new Date().toISOString(),
    };
    library.books.push(book);
    return book;
  }

  function normalizeBook(b) {
    return {
      id: b.id,
      title: b.title,
      author: b.author,
      totalPages: b.totalPages,
      coverFile: b.coverFile || null,
      ownership: normalizeOwnership(b.ownership),
      isbn: b.isbn || null,
      categoryIds: Array.isArray(b.categoryIds) ? b.categoryIds : [],
      createdAt: b.createdAt,
    };
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
    if (patch.ownership !== undefined) book.ownership = normalizeOwnership(patch.ownership);
    if (patch.isbn !== undefined) book.isbn = (patch.isbn || "").trim() || null;
    if (patch.categoryIds !== undefined) {
      book.categoryIds = Array.isArray(patch.categoryIds) ? patch.categoryIds.slice() : [];
    }
    return book;
  }

  function deleteBook(library, bookId) {
    const idx = library.books.findIndex((b) => b.id === bookId);
    if (idx === -1) return null;
    const [removed] = library.books.splice(idx, 1);
    library.logs = library.logs.filter((l) => l.bookId !== bookId);
    return removed;
  }

  function defaultCategories() {
    return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  }

  function createDefaultLibrary() {
    return { books: [], logs: [], categories: defaultCategories() };
  }

  function getCategoryById(library, categoryId) {
    return library.categories.find((c) => c.id === categoryId) || null;
  }

  function createCategory(library, name, group) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const existing = library.categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const category = {
      id: generateId(),
      name: trimmed,
      group: group === "Fiction" || group === "Non-Fiction" ? group : null,
    };
    library.categories.push(category);
    return category;
  }

  function renameCategory(library, categoryId, name) {
    const category = getCategoryById(library, categoryId);
    if (!category) return null;
    const trimmed = (name || "").trim();
    if (trimmed) category.name = trimmed;
    return category;
  }

  function deleteCategory(library, categoryId) {
    const idx = library.categories.findIndex((c) => c.id === categoryId);
    if (idx === -1) return null;
    const [removed] = library.categories.splice(idx, 1);
    library.books.forEach((b) => {
      b.categoryIds = (b.categoryIds || []).filter((id) => id !== categoryId);
    });
    return removed;
  }

  function categoriesForBook(library, book) {
    const ids = new Set(book.categoryIds || []);
    return library.categories.filter((c) => ids.has(c.id));
  }

  function bookHasCategory(book, categoryId) {
    return (book.categoryIds || []).includes(categoryId);
  }

  function groupedCategories(library) {
    const sorted = library.categories.slice().sort((a, b) => a.name.localeCompare(b.name));
    const groups = { "Non-Fiction": [], Fiction: [], Custom: [] };
    sorted.forEach((c) => {
      const key = c.group === "Fiction" || c.group === "Non-Fiction" ? c.group : "Custom";
      groups[key].push(c);
    });
    return groups;
  }

  function categoriesInUse(library) {
    const used = new Set();
    library.books.forEach((b) => (b.categoryIds || []).forEach((id) => used.add(id)));
    return library.categories.filter((c) => used.has(c.id));
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

  // pages still loggable before the book hits 100% — never negative
  function remainingPages(library, book) {
    const progress = progressForBook(library, book);
    return Math.max(0, progress.totalPages - progress.pagesRead);
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
    normalizeBook,
    getBookById,
    updateBook,
    deleteBook,

    addLog,
    deleteLog,
    logsForBook,

    pagesReadForBook,
    progressForBook,
    remainingPages,
    hasLogToday,

    sortedBooksForLibrary,
    sortedLogsNewestFirst,

    currentStreak,
    longestStreak,
    pagesPerDay,
    datedLogDateSet,

    defaultCategories,
    createDefaultLibrary,
    getCategoryById,
    createCategory,
    renameCategory,
    deleteCategory,
    categoriesForBook,
    bookHasCategory,
    groupedCategories,
    categoriesInUse,
  };
})();
