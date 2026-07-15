// Shifts the atmosphere squircle's blend toward whichever journey entry the
// visitor is pointing at or focusing. The color comes from each entry's
// per-type --entry custom property, so the map lives in CSS, not here.
type TintWindow = Window & { __journeyTintBound?: boolean };

function initializeJourneyTint(): void {
  const visual = document.querySelector<HTMLElement>("[data-journey-visual]");
  const list = document.querySelector<HTMLElement>(".journey-entry-list");
  if (!visual || !list || visual.dataset.tintBound === "true") return;
  visual.dataset.tintBound = "true";

  const applyTint = (entry: HTMLElement) => {
    const color = getComputedStyle(entry).getPropertyValue("--entry").trim();
    if (color) visual.style.setProperty("--journey-tint", color);
    visual.classList.add("is-tinted");
  };

  const clearIfLeaving = (related: EventTarget | null) => {
    if (!(related instanceof Node) || !list.contains(related)) {
      visual.classList.remove("is-tinted");
    }
  };

  const entryFrom = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>("[data-journey-entry]") : null;

  list.addEventListener("pointerover", (event) => {
    const entry = entryFrom(event.target);
    if (entry) applyTint(entry);
  });
  list.addEventListener("focusin", (event) => {
    const entry = entryFrom(event.target);
    if (entry) applyTint(entry);
  });
  list.addEventListener("pointerout", (event) => clearIfLeaving(event.relatedTarget));
  list.addEventListener("focusout", (event) => clearIfLeaving(event.relatedTarget));
}

export function bindJourneyTint(): void {
  const tintWindow = window as TintWindow;
  if (!tintWindow.__journeyTintBound) {
    document.addEventListener("astro:page-load", initializeJourneyTint);
    tintWindow.__journeyTintBound = true;
  }
  initializeJourneyTint();
}
