window.RI = window.RI || {};

RI.boot = function (onReady) {
  "use strict";

  const t = RI.i18n.t;
  const screen = document.getElementById("setup-screen");
  const titleEl = document.getElementById("setup-title");
  const textEl = document.getElementById("setup-text");
  const actionBtn = document.getElementById("setup-action-btn");
  const altBtn = document.getElementById("setup-alt-btn");
  const errorEl = document.getElementById("setup-error");
  const appShell = document.getElementById("app-shell");

  // setStateSetup/setStateGrant/the unsupported-browser branch all set button
  // text via textContent once, outside the data-i18n scan, so a live language
  // switch needs to explicitly re-run whichever one is currently on screen
  let currentSetupState = null;
  RI.i18n.onChange(() => {
    if (currentSetupState) currentSetupState();
  });

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }

  function clearError() {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  function setStateSetup() {
    currentSetupState = setStateSetup;
    titleEl.textContent = t("setup.setupTitle");
    textEl.textContent = t("setup.setupText");
    actionBtn.textContent = t("setup.chooseFolderBtn");
    actionBtn.classList.remove("hidden");
    actionBtn.onclick = handleChooseFolder;
    altBtn.classList.add("hidden");
  }

  function setStateGrant() {
    currentSetupState = setStateGrant;
    titleEl.textContent = t("setup.welcomeBack");
    textEl.textContent = t("setup.grantText");
    actionBtn.textContent = t("setup.continueBtn");
    actionBtn.classList.remove("hidden");
    actionBtn.onclick = handleGrantPermission;
    altBtn.textContent = t("setup.chooseDifferentFolderBtn");
    altBtn.onclick = handleChooseFolder;
    altBtn.classList.remove("hidden");
  }

  async function proceedWithRoot(rootHandle) {
    try {
      const { dataHandle, coversHandle } = await RI.fs.ensureDataDirs(rootHandle);
      const { library: libraryBase, logs } = await RI.fs.readLibraryAndLogs(dataHandle);
      const library = { books: libraryBase.books, categories: libraryBase.categories, logs };
      const ratingsData = await RI.fs.readRatings(dataHandle);
      const wishlistData = await RI.fs.readWishlist(dataHandle);
      screen.classList.add("hidden");
      appShell.classList.remove("hidden");
      onReady({ library, dataHandle, coversHandle, rootHandle, ratingsData, wishlistData });
    } catch (err) {
      console.error(err);
      showError(t("setup.errCouldNotRead") + (err && err.message ? err.message : ""));
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
      showError(t("setup.errCouldNotAccess") + (err && err.message ? err.message : ""));
    }
  }

  // requestPermission needs a real click, so this can't fire automatically
  async function handleGrantPermission() {
    clearError();
    try {
      const rootHandle = await RI.fs.getStoredRootHandle();
      const perm = await RI.fs.requestPermission(rootHandle);
      if (perm !== "granted") {
        showError(t("setup.errAccessNotGranted"));
        return;
      }
      await proceedWithRoot(rootHandle);
    } catch (err) {
      console.error(err);
      showError(t("setup.errRequestFailed") + (err && err.message ? err.message : ""));
    }
  }

  function setStateUnsupported() {
    currentSetupState = setStateUnsupported;
    titleEl.textContent = t("setup.unsupportedTitle");
    textEl.textContent = t("setup.unsupportedText");
    actionBtn.classList.add("hidden");
    altBtn.classList.add("hidden");
  }

  function setStateUnsupportedBrave() {
    currentSetupState = setStateUnsupportedBrave;
    titleEl.textContent = t("setup.unsupportedBraveTitle");
    textEl.textContent = t("setup.unsupportedBraveText");
    actionBtn.classList.add("hidden");
    altBtn.classList.add("hidden");
  }

  (async function init() {
    if (!RI.fs.isSupported()) {
      if (await RI.fs.isBrave()) {
        setStateUnsupportedBrave();
      } else {
        setStateUnsupported();
      }
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
