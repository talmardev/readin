window.RI = window.RI || {};

// classic script, never a module

RI.fs = (function () {
  "use strict";

  const DB_NAME = "readin-fs";
  const DB_VERSION = 1;
  const STORE_NAME = "handles";
  const HANDLE_KEY = "root";
  const LIBRARY_FILE = "library.json";
  const READS_FILE = "reads.json";
  const LOGS_FILE = "logs.json";
  const RATINGS_FILE = "ratings.json";
  const WISHLIST_FILE = "wishlist.json";

  function isSupported() {
    return typeof window.showDirectoryPicker === "function";
  }

  // Brave ships the API flag off
  async function isBrave() {
    return !!(navigator.brave && (await navigator.brave.isBrave()));
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getStoredRootHandle() {
    return idbGet(HANDLE_KEY);
  }

  async function pickRootFolder() {
    const handle = await window.showDirectoryPicker({
      mode: "readwrite",
      id: "readin-project-root",
    });
    await idbSet(HANDLE_KEY, handle);
    return handle;
  }

  async function forgetRootFolder() {
    await idbDelete(HANDLE_KEY);
  }

  function queryPermission(handle) {
    return handle.queryPermission({ mode: "readwrite" });
  }

  function requestPermission(handle) {
    return handle.requestPermission({ mode: "readwrite" });
  }

  // is this folder already a data dir
  async function looksLikeDataDir(handle) {
    if (handle.name && handle.name.toLowerCase() === "data") return true;
    const markers = [LIBRARY_FILE, LOGS_FILE, READS_FILE, RATINGS_FILE, WISHLIST_FILE];
    for (const name of markers) {
      try {
        await handle.getFileHandle(name, { create: false });
        return true;
      } catch (err) {
        if (!err || err.name !== "NotFoundError") throw err;
      }
    }
    return false;
  }

  async function ensureDataDirs(rootHandle) {
    // use a picked data folder directly
    const dataHandle = (await looksLikeDataDir(rootHandle))
      ? rootHandle
      : await rootHandle.getDirectoryHandle("data", { create: true });
    const coversHandle = await dataHandle.getDirectoryHandle("covers", { create: true });
    return { dataHandle, coversHandle };
  }

  // library.json holds books and categories only
  async function writeLibrary(dataHandle, library) {
    const fileHandle = await dataHandle.getFileHandle(LIBRARY_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    const toWrite = { books: library.books, categories: library.categories };
    await writable.write(JSON.stringify(toWrite, null, 2));
    await writable.close();
  }

  // Logs live in their own file
  async function readLogs(dataHandle) {
    let fileHandle;
    try {
      fileHandle = await dataHandle.getFileHandle(LOGS_FILE, { create: false });
    } catch (err) {
      if (err && err.name === "NotFoundError") return { logs: [] };
      throw err;
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return { logs: [] };
    const parsed = JSON.parse(text);
    return { logs: Array.isArray(parsed.logs) ? parsed.logs : [] };
  }

  async function writeLogs(dataHandle, logsData) {
    const fileHandle = await dataHandle.getFileHandle(LOGS_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ logs: logsData.logs }, null, 2));
    await writable.close();
  }

  async function writeLibraryAndLogs(dataHandle, library) {
    await writeLibrary(dataHandle, library);
    await writeLogs(dataHandle, { logs: library.logs });
  }

  // merges library.json and logs.json in memory
  async function readLibraryAndLogs(dataHandle) {
    let fileHandle;
    let rawParsed = null;
    try {
      fileHandle = await dataHandle.getFileHandle(LIBRARY_FILE, { create: false });
    } catch (err) {
      if (err && err.name === "NotFoundError") {
        const fresh = RI.store.createDefaultLibrary();
        await writeLibrary(dataHandle, fresh);
        return { library: { books: fresh.books, categories: fresh.categories }, logs: [] };
      }
      throw err;
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (text.trim()) rawParsed = JSON.parse(text);

    const books =
      rawParsed && Array.isArray(rawParsed.books) ? rawParsed.books.map(RI.store.normalizeBook) : [];
    const categories =
      rawParsed && Array.isArray(rawParsed.categories) ? rawParsed.categories : RI.store.defaultCategories();

    const { logs: existingLogs } = await readLogs(dataHandle);

    if (rawParsed && Array.isArray(rawParsed.logs)) {
      const seen = new Set(existingLogs.map((l) => l.id));
      const merged = existingLogs.slice();
      rawParsed.logs.forEach((l) => {
        if (!seen.has(l.id)) {
          merged.push(l);
          seen.add(l.id);
        }
      });
      await writeLogs(dataHandle, { logs: merged });
      await writeLibrary(dataHandle, { books, categories });
      return { library: { books, categories }, logs: merged };
    }

    return { library: { books, categories }, logs: existingLogs };
  }

  // one row per timed Read session
  async function readReads(dataHandle) {
    let fileHandle;
    try {
      fileHandle = await dataHandle.getFileHandle(READS_FILE, { create: false });
    } catch (err) {
      if (err && err.name === "NotFoundError") return { reads: [] };
      throw err;
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return { reads: [] };
    const parsed = JSON.parse(text);
    return { reads: Array.isArray(parsed.reads) ? parsed.reads : [] };
  }

  async function writeReads(dataHandle, readsData) {
    const fileHandle = await dataHandle.getFileHandle(READS_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(readsData, null, 2));
    await writable.close();
  }

  // One row per book that reached 100%
  async function readRatings(dataHandle) {
    let fileHandle;
    try {
      fileHandle = await dataHandle.getFileHandle(RATINGS_FILE, { create: false });
    } catch (err) {
      if (err && err.name === "NotFoundError") return { ratings: [] };
      throw err;
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return { ratings: [] };
    const parsed = JSON.parse(text);
    return { ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [] };
  }

  async function writeRatings(dataHandle, ratingsData) {
    const fileHandle = await dataHandle.getFileHandle(RATINGS_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ ratings: ratingsData.ratings }, null, 2));
    await writable.close();
  }

  // books not owned yet, own file
  async function readWishlist(dataHandle) {
    let fileHandle;
    try {
      fileHandle = await dataHandle.getFileHandle(WISHLIST_FILE, { create: false });
    } catch (err) {
      if (err && err.name === "NotFoundError") return { items: [] };
      throw err;
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return { items: [] };
    const parsed = JSON.parse(text);
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  }

  async function writeWishlist(dataHandle, wishlistData) {
    const fileHandle = await dataHandle.getFileHandle(WISHLIST_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ items: wishlistData.items }, null, 2));
    await writable.close();
  }

  const GOALS_FILE = "goals.json";

  function goalOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  // no file means no goals
  async function readGoals(dataHandle) {
    const empty = { dailyPages: null, yearlyBooks: null, updatedAt: null };
    let fileHandle;
    try {
      fileHandle = await dataHandle.getFileHandle(GOALS_FILE, { create: false });
    } catch (err) {
      if (err && err.name === "NotFoundError") return empty;
      throw err;
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return empty;
    const parsed = JSON.parse(text);
    return {
      dailyPages: goalOrNull(parsed.dailyPages),
      yearlyBooks: goalOrNull(parsed.yearlyBooks),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  }

  async function writeGoals(dataHandle, goalsData) {
    const fileHandle = await dataHandle.getFileHandle(GOALS_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    const toWrite = {
      dailyPages: goalsData.dailyPages,
      yearlyBooks: goalsData.yearlyBooks,
      updatedAt: goalsData.updatedAt,
    };
    await writable.write(JSON.stringify(toWrite, null, 2));
    await writable.close();
  }

  // exports use Save As, not data/
  async function saveCsvAs(suggestedName, csvText) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: "CSV file", accept: { "text/csv": [".csv"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(csvText);
    await writable.close();
  }

  function extensionFromFile(file) {
    const dotIdx = file.name.lastIndexOf(".");
    if (dotIdx > 0 && dotIdx < file.name.length - 1) {
      const ext = file.name.slice(dotIdx + 1).toLowerCase();
      if (/^[a-z0-9]{1,5}$/.test(ext)) return ext;
    }
    const map = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    return map[file.type] || "jpg";
  }

  async function saveCover(coversHandle, bookId, file) {
    const ext = extensionFromFile(file);
    const filename = `${bookId}.${ext}`;
    const fileHandle = await coversHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    return `covers/${filename}`;
  }

  async function deleteCover(coversHandle, coverFile) {
    if (!coverFile) return;
    const filename = coverFile.replace(/^covers\//, "");
    try {
      await coversHandle.removeEntry(filename);
    } catch (err) {
      if (!err || err.name !== "NotFoundError") throw err;
    }
  }

  // cover as a File, or null
  async function readCoverFile(coversHandle, coverFile) {
    if (!coverFile) return null;
    const filename = coverFile.replace(/^covers\//, "");
    try {
      const fileHandle = await coversHandle.getFileHandle(filename, { create: false });
      return await fileHandle.getFile();
    } catch (err) {
      return null;
    }
  }

  async function readCoverAsURL(coversHandle, coverFile) {
    if (!coverFile) return null;
    const filename = coverFile.replace(/^covers\//, "");
    try {
      const fileHandle = await coversHandle.getFileHandle(filename, { create: false });
      const file = await fileHandle.getFile();
      return URL.createObjectURL(file);
    } catch (err) {
      return null;
    }
  }

  return {
    isSupported,
    isBrave,
    getStoredRootHandle,
    pickRootFolder,
    forgetRootFolder,
    queryPermission,
    requestPermission,
    ensureDataDirs,
    readLibraryAndLogs,
    writeLibrary,
    writeLibraryAndLogs,
    readLogs,
    writeLogs,
    readReads,
    writeReads,
    readRatings,
    writeRatings,
    readWishlist,
    writeWishlist,
    readGoals,
    writeGoals,
    saveCsvAs,
    saveCover,
    deleteCover,
    readCoverFile,
    readCoverAsURL,
  };
})();
