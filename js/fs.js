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

  // needs RI.store loaded first, for default categories and book shape
  async function readLibrary(dataHandle) {
    let fileHandle;
    try {
      fileHandle = await dataHandle.getFileHandle(LIBRARY_FILE, { create: false });
    } catch (err) {
      if (err && err.name === "NotFoundError") {
        const fresh = RI.store.createDefaultLibrary();
        await writeLibrary(dataHandle, fresh);
        return fresh;
      }
      throw err;
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return RI.store.createDefaultLibrary();
    const parsed = JSON.parse(text);
    return {
      books: Array.isArray(parsed.books) ? parsed.books.map(RI.store.normalizeBook) : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : RI.store.defaultCategories(),
    };
  }

  async function writeLibrary(dataHandle, library) {
    const fileHandle = await dataHandle.getFileHandle(LIBRARY_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(library, null, 2));
    await writable.close();
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
    readLibrary,
    writeLibrary,
    readReads,
    writeReads,
    saveCover,
    deleteCover,
    readCoverAsURL,
  };
})();
