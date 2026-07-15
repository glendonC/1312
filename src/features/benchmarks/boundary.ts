type BoundaryWindow = Window & { __benchmarkBoundaryBound?: boolean };

function initializeBenchmarkBoundary(): void {
  document.querySelectorAll<HTMLElement>("[data-bench-boundary]").forEach((root) => {
    if (root.dataset.bound === "true") return;
    root.dataset.bound = "true";

    const trigger = root.querySelector<HTMLButtonElement>("[data-bench-boundary-trigger]");
    const panel = root.querySelector<HTMLElement>("#bench-boundary-panel");
    const closeButton = root.querySelector<HTMLButtonElement>("[data-bench-boundary-close]");
    if (!trigger || !panel) return;

    const isOpen = () => root.classList.contains("is-open");

    const setOpen = (open: boolean, restoreFocus = true) => {
      root.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", String(open));
      panel.setAttribute("aria-hidden", String(!open));
      if (open) {
        closeButton?.focus();
      } else if (restoreFocus) {
        trigger.focus();
      }
    };

    trigger.addEventListener("click", () => setOpen(!isOpen()));
    closeButton?.addEventListener("click", () => setOpen(false));

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) setOpen(false);
    });

    // Light dismiss: any click outside the trigger + panel closes it.
    document.addEventListener("click", (event) => {
      if (!isOpen()) return;
      if (root.contains(event.target as Node)) return;
      setOpen(false, false);
    });
  });
}

export function bindBenchmarkBoundary(): void {
  const boundaryWindow = window as BoundaryWindow;
  if (!boundaryWindow.__benchmarkBoundaryBound) {
    document.addEventListener("astro:page-load", initializeBenchmarkBoundary);
    boundaryWindow.__benchmarkBoundaryBound = true;
  }
  initializeBenchmarkBoundary();
}
