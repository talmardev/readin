window.RI = window.RI || {};

RI.boot = function (onReady) {
  "use strict";

  const screen = document.getElementById("setup-screen");
  const titleEl = document.getElementById("setup-title");
  const textEl = document.getElementById("setup-text");
  const actionBtn = document.getElementById("setup-action-btn");
  const altBtn = document.getElementById("setup-alt-btn");
  const errorEl = document.getElementById("setup-error");
  const appShell = document.getElementById("app-shell");

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }

  function clearError() {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  function setStateSetup() {
    titleEl.textContent = "Set up your library";
    textEl.textContent =
      "Pick the folder this app lives in. read.in will create a data/ folder inside it to store your books, covers, and reading logs as real files on disk.";
    actionBtn.textContent = "Choose the read.in folder";
    actionBtn.classList.remove("hidden");
    actionBtn.onclick = handleChooseFolder;
    altBtn.classList.add("hidden");
  }

  function setStateGrant() {
    titleEl.textContent = "Welcome back";
    textEl.textContent =
      "read.in needs permission to read and write your data folder again this session.";
    actionBtn.textContent = "Continue to your library";
    actionBtn.classList.remove("hidden");
    actionBtn.onclick = handleGrantPermission;
    altBtn.textContent = "Choose a different folder";
    altBtn.onclick = handleChooseFolder;
    altBtn.classList.remove("hidden");
  }

  async function proceedWithRoot(rootHandle) {
    try {
      const { dataHandle, coversHandle } = await RI.fs.ensureDataDirs(rootHandle);
      const { library: libraryBase, logs } = await RI.fs.readLibraryAndLogs(dataHandle);
      const library = { books: libraryBase.books, categories: libraryBase.categories, logs };
      const ratingsData = await RI.fs.readRatings(dataHandle);
      screen.classList.add("hidden");
      appShell.classList.remove("hidden");
      onReady({ library, dataHandle, coversHandle, rootHandle, ratingsData });
    } catch (err) {
      console.error(err);
      showError("Could not read your data folder. " + (err && err.message ? err.message : ""));
    }
  }

  async function handleChooseFolder() {
    clearError();
    try {
      const rootHandle = await RI.fs.pickRootFolder();
      await proceedWithRoot(rootHandle);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      console.error(err);
      showError("Could not access that folder. " + (err && err.message ? err.message : ""));
    }
  }

  // requestPermission needs a real click, so this can't fire automatically
  async function handleGrantPermission() {
    clearError();
    try {
      const rootHandle = await RI.fs.getStoredRootHandle();
      const perm = await RI.fs.requestPermission(rootHandle);
      if (perm !== "granted") {
        showError("Access was not granted, so read.in cannot load your library.");
        return;
      }
      await proceedWithRoot(rootHandle);
    } catch (err) {
      console.error(err);
      showError("Something went wrong requesting access. " + (err && err.message ? err.message : ""));
    }
  }

  (async function init() {
    if (!RI.fs.isSupported()) {
      titleEl.textContent = "Browser not supported";
      textEl.textContent =
        "read.in uses the File System Access API to store your library as real files, which only works in Chrome or Edge. Please open this app there.";
      actionBtn.classList.add("hidden");
      altBtn.classList.add("hidden");
      return;
    }

    let rootHandle;
    try {
      rootHandle = await RI.fs.getStoredRootHandle();
    } catch (err) {
      console.error(err);
      rootHandle = null;
    }

    if (!rootHandle) {
      setStateSetup();
      return;
    }

    let perm;
    try {
      perm = await RI.fs.queryPermission(rootHandle);
    } catch (err) {
      console.error(err);
      setStateSetup();
      return;
    }

    if (perm === "granted") {
      await proceedWithRoot(rootHandle);
    } else {
      setStateGrant();
    }
  })();
};

RI.toast = function (message, type) {
  "use strict";
  const container = document.getElementById("toast-container");
  if (!container) {
    console.warn(message);
    return;
  }
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 5000);
};
