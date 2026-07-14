const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const panelOpacity = (openness: number) => {
  if (openness <= 0.22) return (openness / 0.22) * 0.08;
  return 0.08 + ((openness - 0.22) / 0.78) * 0.92;
};

export function enhanceMethodProcess(root: HTMLElement) {
  const rail = root.querySelector<HTMLElement>(".process-rail");
  const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-method-card]"));
  const progressBar = root.querySelector<HTMLElement>(".process-progress span");
  const detail = root.querySelector<HTMLElement>(".process-detail");
  const detailIndex = root.querySelector<HTMLElement>(".process-detail-meta > span:first-child");
  const detailPrinciple = root.querySelector<HTMLElement>(".process-detail-principle");
  const detailTitle = root.querySelector<HTMLElement>(".process-detail-title");
  const detailCopy = root.querySelector<HTMLElement>(".process-detail-copy");

  if (!rail || cards.length === 0) return () => {};

  const desktopQuery = window.matchMedia("(min-width: 961px)");
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const abortController = new AbortController();
  const { signal } = abortController;
  let activeIndex = 0;
  let frame = 0;

  const renderDetails = (index: number) => {
    const card = cards[index];
    const headline = card.dataset.headline ?? "";

    if (detailIndex) detailIndex.textContent = `[${String(index + 1).padStart(2, "0")}]`;
    if (detailPrinciple) detailPrinciple.textContent = card.dataset.principle ?? "";
    if (detailTitle) {
      detailTitle.textContent = headline;
      detailTitle.setAttribute("aria-label", headline);
    }
    if (detailCopy) detailCopy.textContent = card.dataset.detail ?? "";

    if (detail && !reducedMotionQuery.matches) {
      detail.animate(
        [
          { opacity: 0.2, transform: "translateY(12px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
  };

  const render = (progress: number, requestedIndex?: number) => {
    const desktop = desktopQuery.matches;
    const nextIndex = requestedIndex
      ?? (desktop ? Math.round(progress * (cards.length - 1)) : activeIndex);

    if (nextIndex !== activeIndex) {
      activeIndex = nextIndex;
      renderDetails(activeIndex);
    }

    cards.forEach((card, index) => {
      const openness = desktop
        ? clamp(1 - Math.abs(progress * (cards.length - 1) - index))
        : index === activeIndex
          ? 1
          : 0;
      const active = index === activeIndex;
      const heading = card.querySelector<HTMLButtonElement>(".card-heading");
      const panel = card.querySelector<HTMLElement>(".card-panel");
      const stateLine = card.querySelector<HTMLElement>(".card-state > span:last-child");

      card.classList.toggle("is-active", active);
      card.style.flexGrow = String(desktop ? Math.max(0.001, openness) : 0);
      heading?.setAttribute("aria-expanded", String(active));
      panel?.setAttribute("aria-hidden", String(!active));

      if (panel) {
        panel.style.opacity = String(desktop ? panelOpacity(openness) : Number(active));
        panel.style.transform = `translateY(${desktop ? 22 * (1 - openness) : active ? 0 : 22}px)`;
      }

      if (stateLine) stateLine.style.transform = `rotate(${active ? 0 : 90}deg)`;
    });

    if (progressBar) progressBar.style.transform = `scaleX(${desktop ? progress : 0})`;
  };

  const getProgress = () => {
    const rect = rail.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    return travel > 0 ? clamp(-rect.top / travel) : 0;
  };

  const update = () => {
    frame = 0;
    render(getProgress());
  };

  const requestUpdate = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };

  cards.forEach((card, index) => {
    card.querySelector<HTMLButtonElement>(".card-heading")?.addEventListener(
      "click",
      () => {
        if (!desktopQuery.matches) {
          activeIndex = index;
          render(0, index);
          renderDetails(index);
          return;
        }

        const rect = rail.getBoundingClientRect();
        const railTop = window.scrollY + rect.top;
        const travel = rect.height - window.innerHeight;
        window.scrollTo({
          top: railTop + travel * (index / (cards.length - 1)),
          behavior: reducedMotionQuery.matches ? "auto" : "smooth",
        });
      },
      { signal },
    );
  });

  const observer = new ResizeObserver(requestUpdate);
  observer.observe(rail);
  window.addEventListener("scroll", requestUpdate, { passive: true, signal });
  window.addEventListener("resize", requestUpdate, { signal });
  desktopQuery.addEventListener("change", requestUpdate, { signal });
  requestUpdate();

  return () => {
    abortController.abort();
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}
