type BenchmarkWindow = Window & { __benchmarkInstrumentBound?: boolean };

function initializeBenchmarkInstruments(): void {
  document.querySelectorAll<HTMLElement>("[data-bench-instrument]").forEach((instrument) => {
    if (instrument.dataset.bound === "true") return;
    instrument.dataset.bound = "true";

    const tabs = Array.from(instrument.querySelectorAll<HTMLButtonElement>("[data-bench-tab]"));
    const panels = Array.from(instrument.querySelectorAll<HTMLElement>("[data-bench-panel]"));
    const select = instrument.querySelector<HTMLSelectElement>("[data-bench-select]");

    const prevButton = instrument.querySelector<HTMLButtonElement>("[data-bench-seq-prev]");
    const nextButton = instrument.querySelector<HTMLButtonElement>("[data-bench-seq-next]");
    const prevName = instrument.querySelector<HTMLElement>("[data-bench-seq-prev-name]");
    const nextName = instrument.querySelector<HTMLElement>("[data-bench-seq-next-name]");

    const labelFor = (index: number) =>
      tabs[index]?.querySelector<HTMLElement>(".tab-label")?.textContent?.trim() ?? "";

    const updateSequence = (index: number) => {
      const prev = tabs[index - 1];
      const next = tabs[index + 1];
      if (prevButton && prevName) {
        prevButton.hidden = !prev;
        prevButton.dataset.target = prev?.dataset.benchTab ?? "";
        prevName.textContent = prev ? labelFor(index - 1) : "";
      }
      if (nextButton && nextName) {
        nextButton.hidden = !next;
        nextButton.dataset.target = next?.dataset.benchTab ?? "";
        nextName.textContent = next ? labelFor(index + 1) : "";
      }
    };

    const activate = (id: string, updateUrl = true) => {
      const index = tabs.findIndex((tab) => tab.dataset.benchTab === id);
      if (index === -1) return;

      tabs.forEach((tab) => {
        const selected = tab.dataset.benchTab === id;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });

      panels.forEach((panel) => {
        panel.hidden = panel.dataset.benchPanel !== id;
      });

      if (select) select.value = id;
      instrument.dataset.activePanel = id;
      updateSequence(index);

      if (updateUrl) {
        const nextUrl = `${window.location.pathname}${window.location.search}#${id}`;
        window.history.replaceState(null, "", nextUrl);
      }
    };

    const step = (button: HTMLButtonElement | null) => {
      const target = button?.dataset.target;
      if (!target) return;
      activate(target);
      instrument.querySelector<HTMLButtonElement>(`[data-bench-tab="${target}"]`)?.focus();
    };

    prevButton?.addEventListener("click", () => step(prevButton));
    nextButton?.addEventListener("click", () => step(nextButton));

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activate(tab.dataset.benchTab ?? "overview"));
      tab.addEventListener("keydown", (event) => {
        let nextIndex = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = tabs.length - 1;
        else return;

        event.preventDefault();
        const nextTab = tabs[nextIndex];
        nextTab.focus();
        activate(nextTab.dataset.benchTab ?? "overview");
      });
    });

    select?.addEventListener("change", () => activate(select.value));
    activate(window.location.hash.slice(1) || "overview", false);
  });
}

export function bindBenchmarkInstruments(): void {
  const benchmarkWindow = window as BenchmarkWindow;
  if (!benchmarkWindow.__benchmarkInstrumentBound) {
    document.addEventListener("astro:page-load", initializeBenchmarkInstruments);
    benchmarkWindow.__benchmarkInstrumentBound = true;
  }
  initializeBenchmarkInstruments();
}
