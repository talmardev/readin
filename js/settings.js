(function () {
  "use strict";

  const store = RI.store;
  const fs = RI.fs;
  const t = RI.i18n.t;

  const TRASH_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  let ctx = null;

  const addCategoryForm = document.getElementById("add-category-form");
  const newCategoryName = document.getElementById("new-category-name");
  const newCategoryGroup = document.getElementById("new-category-group");
  const categoryFormError = document.getElementById("category-form-error");
  const categoryGroups = document.getElementById("category-groups");
  const exportCsvBtn = document.getElementById("export-csv-btn");

  async function persist() {
    try {
      await fs.writeLibraryAndLogs(ctx.dataHandle, ctx.library);
    } catch (err) {
      console.error(err);
      RI.toast(t("common.couldNotSavePrefix") + (err && err.message ? err.message : t("common.unknownError")), "error");
    }
  }

  function renderCategoryGroups() {
    const grouped = store.groupedCategories(ctx.library);
    categoryGroups.innerHTML = "";

    [["Non-Fiction", grouped["Non-Fiction"]], ["Fiction", grouped.Fiction], ["Custom", grouped.Custom]].forEach(
      ([groupKey, categories]) => {
        if (categories.length === 0) return;

        const section = document.createElement("div");
        section.className = "category-manage-group";

        const heading = document.createElement("h3");
        heading.textContent = RI.i18n.categoryGroupLabel(groupKey);
        section.appendChild(heading);

        categories.forEach((category) => {
          const row = document.createElement("div");
          row.className = "category-manage-row";
          const displayName = RI.i18n.categoryName(category);

          const nameInput = document.createElement("input");
          nameInput.type = "text";
          // raw stored name, never the translated display name: this input
          // writes back to library.json on change, so showing a translation
          // here would risk persisting it as if the user renamed the category
          nameInput.value = category.name;
          nameInput.maxLength = 60;
          nameInput.addEventListener("change", async () => {
            store.renameCategory(ctx.library, category.id, nameInput.value);
            await persist();
            renderCategoryGroups();
          });

          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "remove-log";
          removeBtn.setAttribute("aria-label", t("settings.deleteCategoryAria", { name: displayName }));
          removeBtn.innerHTML = TRASH_SVG;
          removeBtn.addEventListener("click", async () => {
            const ok = confirm(t("settings.confirmDeleteCategory", { name: displayName }));
            if (!ok) return;
            store.deleteCategory(ctx.library, category.id);
            await persist();
            renderCategoryGroups();
          });

          row.appendChild(nameInput);
          row.appendChild(removeBtn);
          section.appendChild(row);
        });

        categoryGroups.appendChild(section);
      }
    );

    if (!categoryGroups.hasChildNodes()) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = t("settings.noCategoriesYet");
      categoryGroups.appendChild(note);
    }
  }

  addCategoryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = newCategoryName.value.trim();
    if (!name) {
      categoryFormError.textContent = t("settings.errCategoryNameRequired");
      return;
    }
    categoryFormError.textContent = "";
    store.createCategory(ctx.library, name, newCategoryGroup.value);
    await persist();
    addCategoryForm.reset();
    renderCategoryGroups();
    newCategoryName.focus();
  });

  exportCsvBtn.addEventListener("click", async () => {
    exportCsvBtn.disabled = true;
    try {
      const csv = store.libraryToCSV(ctx.library, ctx.ratingsData);
      const filename = `readin-library-${store.todayISODate()}.csv`;
      await fs.saveCsvAs(filename, csv);
      RI.toast(t("settings.toastExported"));
    } catch (err) {
      if (err && err.name === "AbortError") return; // user closed the save dialog
      console.error(err);
      RI.toast(t("settings.errCouldNotExportPrefix") + (err && err.message ? err.message : t("common.unknownError")), "error");
    } finally {
      exportCsvBtn.disabled = false;
    }
  });

  function setDocTitle() {
    document.title = "readin' - " + t("nav.settings");
  }

  RI.i18n.onChange(() => {
    setDocTitle();
    if (ctx) renderCategoryGroups();
  });

  RI.boot((bootCtx) => {
    ctx = bootCtx;
    setDocTitle();
    renderCategoryGroups();
  });
})();
