type BenchmarkWindow = Window & { __benchmarkInstrumentBound?: boolean };

function initializeBenchmarkInstruments(): void {
  document.querySelectorAll<HTMLElement>("[data-bench-instrument]").forEach((instrument) => {
    if (instrument.dataset.bound === "true") return;
    instrument.dataset.bound = "true";

    const tabs = Array.from(instrument.querySelectorAll<HTMLButtonElement>("[data-bench-tab]"));
    const panels = Array.from(instrument.querySelectorAll<HTMLElement>("[data-bench-panel]"));
    const select = instrument.querySelector<HTMLSelectElement>("[data-bench-select]");

    const activate = (id: string, updateUrl = true) => {
      if (!tabs.some((tab) => tab.dataset.benchTab === id)) return;

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

      if (updateUrl) {
        const nextUrl = `${window.location.pathname}${window.location.search}#${id}`;
        window.history.replaceState(null, "", nextUrl);
      }
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activate(tab.dataset.benchTab ?? "evidence"));
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
        activate(nextTab.dataset.benchTab ?? "evidence");
      });
    });

    select?.addEventListener("change", () => activate(select.value));
    activate(window.location.hash.slice(1) || "evidence", false);
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
