window.RI = window.RI || {};

// stale data dialog, shared by every saver
RI.stale = (function () {
  "use strict";

  const t = RI.i18n.t;
  const RELOADED_KEY = "readin-stale-reloaded";
  let redraw = null;
  let queue = Promise.resolve();

  RI.i18n.onChange(() => {
    if (redraw) redraw();
  });

  function makeButton(className) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn " + className;
    return btn;
  }

  // resolves reload or overwrite, one at a time
  function ask(err, reloadNoteKey) {
    const result = queue.then(
      () =>
        new Promise((resolve) => {
          const overlay = document.createElement("div");
          overlay.className = "modal-overlay";
          const modal = document.createElement("div");
          modal.className = "modal";
          modal.setAttribute("role", "alertdialog");
          modal.setAttribute("aria-modal", "true");
          modal.setAttribute("aria-labelledby", "stale-modal-title");

          const header = document.createElement("div");
          header.className = "modal-header";
          const title = document.createElement("h2");
          title.className = "modal-title";
          title.id = "stale-modal-title";
          header.appendChild(title);

          const text = document.createElement("p");
          text.className = "stale-text";
          const note = document.createElement("p");
          note.className = "hint";

          const actions = document.createElement("div");
          actions.className = "modal-actions";
          const reloadBtn = makeButton("btn-primary");
          const overwriteBtn = makeButton("btn-danger");
          actions.appendChild(reloadBtn);
          actions.appendChild(overwriteBtn);

          function render() {
            title.textContent = t("stale.title");
            text.textContent = t("stale.text", { files: err.files.join(", ") });
            note.textContent = t(reloadNoteKey || "stale.reloadNote");
            reloadBtn.textContent = t("stale.reloadBtn");
            overwriteBtn.textContent = t("stale.overwriteBtn");
          }

          function choose(choice) {
            redraw = null;
            overlay.remove();
            resolve(choice);
          }
          reloadBtn.addEventListener("click", () => choose("reload"));
          overwriteBtn.addEventListener("click", () => choose("overwrite"));

          modal.appendChild(header);
          modal.appendChild(text);
          modal.appendChild(note);
          modal.appendChild(actions);
          overlay.appendChild(modal);
          document.body.appendChild(overlay);
          redraw = render;
          render();
          reloadBtn.focus();
        })
    );
    queue = result.catch(() => {});
    return result;
  }

  // reload the page and say what was dropped
  function reloadPage() {
    try {
      sessionStorage.setItem(RELOADED_KEY, "1");
    } catch (err) {
      console.error(err);
    }
    location.reload();
  }

  // guarded write, false when user reloads
  async function run(write, options) {
    const opts = options || {};
    for (;;) {
      try {
        await write();
        return true;
      } catch (err) {
        if (!RI.fs.isStaleError(err)) throw err;
        const choice = await ask(err, opts.reloadNoteKey);
        if (choice === "overwrite") {
          await RI.fs.acceptDiskState(err.dataHandle, err.files);
          continue;
        }
        if (opts.onReload) await opts.onReload(err);
        else reloadPage();
        return false;
      }
    }
  }

  // toast once after a reload this dialog caused
  function announceReload() {
    let flagged = false;
    try {
      flagged = sessionStorage.getItem(RELOADED_KEY) === "1";
      sessionStorage.removeItem(RELOADED_KEY);
    } catch (err) {
      console.error(err);
    }
    if (flagged) RI.toast(t("stale.reloadedToast"));
  }

  return { run, announceReload };
})();

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

  // redraws the setup screen on language change
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
      await onReady({ library, dataHandle, coversHandle, rootHandle, ratingsData, wishlistData });
      RI.stale.announceReload();
    } catch (err) {
      console.error(err);
      // show the setup card with the error
      appShell.classList.add("hidden");
      screen.classList.remove("hidden");
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

  // needs a real click, no auto-run
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
