window.RI = window.RI || {};

// classic script, needs store and i18n

RI.stars = (function () {
  "use strict";

  // star slot: glyph plus two half buttons
  function buildSlot(index, onPick, onPreview) {
    const t = RI.i18n.t;
    const slot = document.createElement("span");
    slot.className = "star-slot";
    const bg = document.createElement("span");
    bg.className = "star-bg";
    bg.textContent = "★";
    const fg = document.createElement("span");
    fg.className = "star-fg";
    fg.textContent = "★";
    slot.appendChild(bg);
    slot.appendChild(fg);

    [index - 0.5, index].forEach((value, half) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "star-half " + (half === 0 ? "star-half-lo" : "star-half-hi");
      btn.setAttribute("aria-label", t("common.starsAria", { count: value, value }));
      btn.addEventListener("mouseenter", () => onPreview(value));
      btn.addEventListener("focus", () => onPreview(value));
      btn.addEventListener("click", () => onPick(value));
      slot.appendChild(btn);
    });

    return { slot, fg };
  }

  // star picker in half steps, reusable
  function buildPicker(container) {
    container.innerHTML = "";
    let current = 0;
    let onPickCb = null;
    const setters = [];

    function render(value) {
      setters.forEach((setFraction, idx) => setFraction(RI.store.starFraction(value, idx + 1)));
    }

    for (let i = 1; i <= 5; i++) {
      const { slot, fg } = buildSlot(
        i,
        (value) => {
          current = value;
          render(current);
          if (onPickCb) onPickCb(current);
        },
        (value) => render(value)
      );
      setters.push((fraction) => {
        fg.style.width = fraction * 100 + "%";
      });
      container.appendChild(slot);
    }

    container.addEventListener("mouseleave", () => render(current));
    render(current);

    return {
      setValue(value) {
        current = value || 0;
        render(current);
      },
      setOnPick(cb) {
        onPickCb = cb;
      },
    };
  }

  return { buildPicker };
})();
