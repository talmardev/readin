window.RI = window.RI || {};

// classic script, not a module — file:// blocks ES module fetches via CORS

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

  function isSupported() {
    return typeof window.showDirectoryPicker === "function";
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

  async function ensureDataDirs(rootHandle) {
    const dataHandle = await rootHandle.getDirectoryHandle("data", { create: true });
    const coversHandle = await dataHandle.getDirectoryHandle("covers", { create: true });
    return { dataHandle, coversHandle };
  }

  // library.json only holds books + categories now — logs live in logs.json
  // (see readLibraryAndLogs, which also migrates any pre-existing embedded logs)
  async function writeLibrary(dataHandle, library) {
    const fileHandle = await dataHandle.getFileHandle(LIBRARY_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    const toWrite = { books: library.books, categories: library.categories };
    await writable.write(JSON.stringify(toWrite, null, 2));
    await writable.close();
  }

  // logs.json — { logs: [...] }, split out of library.json so books/categories
  // stay small and logs (the fastest-growing data) live on their own
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

  // needs RI.store loaded first, for default categories and book shape.
  // Reads library.json + logs.json and merges them into one in-memory
  // library object ({books, categories, logs}) so store.js can keep treating
  // "library" as a single blob. If library.json still has an embedded `logs`
  // array (pre-split format), those entries are folded into logs.json and
  // stripped from library.json on the spot, silently.
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

  // reads.json — one row per timed Read-page session, separate from library.json
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

  // ratings.json — { ratings: [...] }, one row per book that has ever hit
  // 100%. stars is null until the user actually rates it; the row still
  // exists so lastNudgedDate (the once-a-day nudge-popup throttle) has
  // somewhere to live even before a rating is given.
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

  // one-off exports go through the native Save As dialog rather than the
  // app's own data/ folder handle — this is the user picking a destination
  // outside readin's own storage, not a readin-managed file
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
    saveCsvAs,
    saveCover,
    deleteCover,
    readCoverAsURL,
  };
})();
