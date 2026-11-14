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
  const GOALS_FILE = "goals.json";
  const BACKUPS_DIR = "backups";
  const BACKUP_MANIFEST = "manifest.json";
  // only app-generated files are backed up
  const BACKUP_JSON_FILES = [LIBRARY_FILE, LOGS_FILE, READS_FILE, RATINGS_FILE, WISHLIST_FILE, GOALS_FILE];

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
    // a new folder starts with no stamps
    diskStamps.clear();
    // use a picked data folder directly
    const dataHandle = (await looksLikeDataDir(rootHandle))
      ? rootHandle
      : await rootHandle.getDirectoryHandle("data", { create: true });
    const coversHandle = await dataHandle.getDirectoryHandle("covers", { create: true });
    return { dataHandle, coversHandle };
  }

  // per file state, null when absent
  const diskStamps = new Map();

  function stampOf(file, text) {
    return { lastModified: file.lastModified, size: file.size, text };
  }

  function staleError(dataHandle, names) {
    const err = new Error("Changed on disk since it was loaded: " + names.join(", "));
    err.name = "StaleDataError";
    err.files = names;
    err.dataHandle = dataHandle;
    return err;
  }

  function isStaleError(err) {
    return !!err && err.name === "StaleDataError";
  }

  // the current file, or null when missing
  async function currentFile(dataHandle, name) {
    try {
      const fileHandle = await dataHandle.getFileHandle(name, { create: false });
      return await fileHandle.getFile();
    } catch (err) {
      if (err && err.name === "NotFoundError") return null;
      throw err;
    }
  }

  async function matchesStamp(dataHandle, name) {
    const known = diskStamps.get(name);
    // never read in this page, nothing to compare
    if (known === undefined) return true;
    const file = await currentFile(dataHandle, name);
    if (known === null) return file === null;
    if (file === null) return false;
    if (file.lastModified === known.lastModified && file.size === known.size) return true;
    // same size, new date: sync tools do this
    if (file.size === known.size && (await file.text()) === known.text) {
      known.lastModified = file.lastModified;
      return true;
    }
    return false;
  }

  // check all first, never write halfway
  async function assertFresh(dataHandle, names) {
    const stale = [];
    for (const name of names) {
      if (!(await matchesStamp(dataHandle, name))) stale.push(name);
    }
    if (stale.length > 0) throw staleError(dataHandle, stale);
  }

  // adopt the disk state, then retry writes
  async function acceptDiskState(dataHandle, names) {
    for (const name of names) {
      const file = await currentFile(dataHandle, name);
      diskStamps.set(name, file ? stampOf(file, await file.text()) : null);
    }
  }

  async function readJsonText(dataHandle, name) {
    const file = await currentFile(dataHandle, name);
    if (!file) {
      diskStamps.set(name, null);
      return null;
    }
    const text = await file.text();
    diskStamps.set(name, stampOf(file, text));
    return text;
  }

  async function writeJsonText(dataHandle, name, text) {
    const fileHandle = await dataHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    diskStamps.set(name, stampOf(await fileHandle.getFile(), text));
  }

  // check then write, not atomic
  async function writeJsonGuarded(dataHandle, name, text) {
    await assertFresh(dataHandle, [name]);
    await writeJsonText(dataHandle, name, text);
  }

  function jsonText(value) {
    return JSON.stringify(value, null, 2);
  }

  // library.json holds books and categories only
  async function writeLibrary(dataHandle, library) {
    await writeJsonGuarded(dataHandle, LIBRARY_FILE, jsonText({ books: library.books, categories: library.categories }));
  }

  // Logs live in their own file
  async function readLogs(dataHandle) {
    const text = await readJsonText(dataHandle, LOGS_FILE);
    if (text === null || !text.trim()) return { logs: [] };
    const parsed = JSON.parse(text);
    return { logs: Array.isArray(parsed.logs) ? parsed.logs : [] };
  }

  async function writeLogs(dataHandle, logsData) {
    await writeJsonGuarded(dataHandle, LOGS_FILE, jsonText({ logs: logsData.logs }));
  }

  async function writeLibraryAndLogs(dataHandle, library) {
    await assertFresh(dataHandle, [LIBRARY_FILE, LOGS_FILE]);
    await writeJsonText(dataHandle, LIBRARY_FILE, jsonText({ books: library.books, categories: library.categories }));
    await writeJsonText(dataHandle, LOGS_FILE, jsonText({ logs: library.logs }));
  }

  // merges library.json and logs.json in memory
  async function readLibraryAndLogs(dataHandle) {
    let rawParsed = null;
    const text = await readJsonText(dataHandle, LIBRARY_FILE);
    if (text === null) {
      const fresh = RI.store.createDefaultLibrary();
      await writeLibrary(dataHandle, fresh);
      return { library: { books: fresh.books, categories: fresh.categories }, logs: [] };
    }
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
    const text = await readJsonText(dataHandle, READS_FILE);
    if (text === null || !text.trim()) return { reads: [] };
    const parsed = JSON.parse(text);
    return { reads: Array.isArray(parsed.reads) ? parsed.reads : [] };
  }

  async function writeReads(dataHandle, readsData) {
    await writeJsonGuarded(dataHandle, READS_FILE, jsonText(readsData));
  }

  // One row per book that reached 100%
  async function readRatings(dataHandle) {
    const text = await readJsonText(dataHandle, RATINGS_FILE);
    if (text === null || !text.trim()) return { ratings: [] };
    const parsed = JSON.parse(text);
    return { ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [] };
  }

  async function writeRatings(dataHandle, ratingsData) {
    await writeJsonGuarded(dataHandle, RATINGS_FILE, jsonText({ ratings: ratingsData.ratings }));
  }

  // books not owned yet, own file
  async function readWishlist(dataHandle) {
    const text = await readJsonText(dataHandle, WISHLIST_FILE);
    if (text === null || !text.trim()) return { items: [] };
    const parsed = JSON.parse(text);
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  }

  async function writeWishlist(dataHandle, wishlistData) {
    await writeJsonGuarded(dataHandle, WISHLIST_FILE, jsonText({ items: wishlistData.items }));
  }

  function goalOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  // no file means no goals
  async function readGoals(dataHandle) {
    const empty = { dailyPages: null, yearlyBooks: null, updatedAt: null };
    const text = await readJsonText(dataHandle, GOALS_FILE);
    if (text === null || !text.trim()) return empty;
    const parsed = JSON.parse(text);
    return {
      dailyPages: goalOrNull(parsed.dailyPages),
      yearlyBooks: goalOrNull(parsed.yearlyBooks),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  }

  async function writeGoals(dataHandle, goalsData) {
    const toWrite = {
      dailyPages: goalsData.dailyPages,
      yearlyBooks: goalsData.yearlyBooks,
      updatedAt: goalsData.updatedAt,
    };
    await writeJsonGuarded(dataHandle, GOALS_FILE, jsonText(toWrite));
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

  // beside data, or inside if picked
  async function backupLocation(rootHandle, dataHandle) {
    return (await rootHandle.isSameEntry(dataHandle)) ? "inside" : "beside";
  }

  async function backupsParent(rootHandle, dataHandle) {
    return (await backupLocation(rootHandle, dataHandle)) === "inside" ? dataHandle : rootHandle;
  }

  function backupFolderName(now) {
    const p = (n) => String(n).padStart(2, "0");
    const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    return `${day}_${p(now.getHours())}${p(now.getMinutes())}`;
  }

  // streams, so covers stay out of memory
  async function copyFileTo(file, destDir, name) {
    const destHandle = await destDir.getFileHandle(name, { create: true });
    const writable = await destHandle.createWritable();
    try {
      await file.stream().pipeTo(writable);
    } catch (err) {
      // release the file lock so cleanup can run
      try {
        await writable.abort();
      } catch (abortErr) {
        console.error(abortErr);
      }
      throw err;
    }
    const written = await destHandle.getFile();
    if (written.size !== file.size) throw new Error("The copy of " + name + " is incomplete.");
  }

  // always a fresh folder, never reused
  async function createBackupFolder(backupsDir) {
    const base = backupFolderName(new Date());
    let name = base;
    let counter = 1;
    for (;;) {
      try {
        await backupsDir.getDirectoryHandle(name, { create: false });
        counter += 1;
        name = base + "_" + counter;
      } catch (err) {
        if (!err || err.name !== "NotFoundError") throw err;
        return { name, handle: await backupsDir.getDirectoryHandle(name, { create: true }) };
      }
    }
  }

  // copies from disk, never from memory
  async function makeBackup(rootHandle, dataHandle, coversHandle) {
    const parent = await backupsParent(rootHandle, dataHandle);
    const backupsDir = await parent.getDirectoryHandle(BACKUPS_DIR, { create: true });
    const { name, handle: folder } = await createBackupFolder(backupsDir);
    try {
      let fileCount = 0;
      for (const fileName of BACKUP_JSON_FILES) {
        const file = await currentFile(dataHandle, fileName);
        if (!file) continue;
        await copyFileTo(file, folder, fileName);
        fileCount += 1;
      }
      const coversOut = await folder.getDirectoryHandle("covers", { create: true });
      for await (const [coverName, entry] of coversHandle.entries()) {
        if (entry.kind !== "file") continue;
        await copyFileTo(await entry.getFile(), coversOut, coverName);
        fileCount += 1;
      }
      // manifest goes last, marks it complete
      const manifest = { app: "readin", createdAt: new Date().toISOString(), fileCount };
      const manifestHandle = await folder.getFileHandle(BACKUP_MANIFEST, { create: true });
      const writable = await manifestHandle.createWritable();
      try {
        await writable.write(jsonText(manifest));
        await writable.close();
      } catch (err) {
        await writable.abort().catch((abortErr) => console.error(abortErr));
        throw err;
      }
      return { folder: name, fileCount, createdAt: manifest.createdAt };
    } catch (err) {
      // drop only the folder this run created
      try {
        await backupsDir.removeEntry(name, { recursive: true });
      } catch (cleanupErr) {
        console.error(cleanupErr);
      }
      throw err;
    }
  }

  // newest folder with a valid manifest, or null
  async function lastValidBackup(rootHandle, dataHandle) {
    const parent = await backupsParent(rootHandle, dataHandle);
    let backupsDir;
    try {
      backupsDir = await parent.getDirectoryHandle(BACKUPS_DIR, { create: false });
    } catch (err) {
      if (err && err.name === "NotFoundError") return null;
      throw err;
    }
    const names = [];
    for await (const [name, entry] of backupsDir.entries()) {
      if (entry.kind === "directory") names.push(name);
    }
    names.sort().reverse();
    for (const name of names) {
      try {
        const folder = await backupsDir.getDirectoryHandle(name, { create: false });
        const manifestFile = await currentFile(folder, BACKUP_MANIFEST);
        if (!manifestFile) continue;
        const manifest = JSON.parse(await manifestFile.text());
        if (typeof manifest.createdAt === "string" && Number.isInteger(manifest.fileCount)) {
          return { folder: name, createdAt: manifest.createdAt, fileCount: manifest.fileCount };
        }
      } catch (err) {
        // unreadable folder, try the next one
        console.error(err);
      }
    }
    return null;
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
    isStaleError,
    acceptDiskState,
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
    backupLocation,
    makeBackup,
    lastValidBackup,
    saveCover,
    deleteCover,
    readCoverFile,
    readCoverAsURL,
  };
})();
