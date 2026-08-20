(function () {
  "use strict";

  const store = RI.store;
  const fs = RI.fs;

  const TRASH_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  let ctx = null;

  const addCategoryForm = document.getElementById("add-category-form");
  const newCategoryName = document.getElementById("new-category-name");
  const newCategoryGroup = document.getElementById("new-category-group");
  const categoryFormError = document.getElementById("category-form-error");
  const categoryGroups = document.getElementById("category-groups");

  async function persist() {
    try {
      await fs.writeLibraryAndLogs(ctx.dataHandle, ctx.library);
    } catch (err) {
      console.error(err);
      RI.toast("Could not save — " + (err && err.message ? err.message : "unknown error"), "error");
    }
  }

  function renderCategoryGroups() {
    const grouped = store.groupedCategories(ctx.library);
    categoryGroups.innerHTML = "";

    [["Non-Fiction", grouped["Non-Fiction"]], ["Fiction", grouped.Fiction], ["Custom", grouped.Custom]].forEach(
      ([label, categories]) => {
        if (categories.length === 0) return;

        const section = document.createElement("div");
        section.className = "category-manage-group";

        const heading = document.createElement("h3");
        heading.textContent = label;
        section.appendChild(heading);

        categories.forEach((category) => {
          const row = document.createElement("div");
          row.className = "category-manage-row";

          const nameInput = document.createElement("input");
          nameInput.type = "text";
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
          removeBtn.setAttribute("aria-label", `Delete ${category.name}`);
          removeBtn.innerHTML = TRASH_SVG;
          removeBtn.addEventListener("click", async () => {
            const ok = confirm(`Delete "${category.name}"? It will be removed from any books that have it.`);
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
      note.textContent = "No categories yet. Add your first one above.";
      categoryGroups.appendChild(note);
    }
  }

  addCategoryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = newCategoryName.value.trim();
    if (!name) {
      categoryFormError.textContent = "Category name is required.";
      return;
    }
    categoryFormError.textContent = "";
    store.createCategory(ctx.library, name, newCategoryGroup.value);
    await persist();
    addCategoryForm.reset();
    renderCategoryGroups();
    newCategoryName.focus();
  });

  RI.boot((bootCtx) => {
    ctx = bootCtx;
    renderCategoryGroups();
  });
})();
