type JourneyWindow = Window & { __journeyArticleBound?: boolean };

let dockFrame = 0;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function prepareJourneyArticle(): void {
  const article = document.querySelector<HTMLElement>("[data-journey-article]");
  if (!article || article.dataset.railsReady === "true") return;

  const body = article.querySelector<HTMLElement>(".journey-reading-body");
  const toc = article.querySelector<HTMLElement>("[data-journey-toc]");
  const references = article.querySelector<HTMLOListElement>("[data-journey-references]");
  if (!body || !toc || !references) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const headingIds = new Set<string>();

  body.querySelectorAll<HTMLHeadingElement>("h2").forEach((heading) => {
    const baseId = heading.id || slugify(heading.textContent ?? "section") || "section";
    let headingId = baseId;
    let suffix = 2;
    while (headingIds.has(headingId)) headingId = `${baseId}-${suffix++}`;
    headingIds.add(headingId);
    heading.id = headingId;

    const link = document.createElement("a");
    link.href = `#${headingId}`;
    link.textContent = heading.textContent;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      history.replaceState(null, "", `#${headingId}`);
    });
    toc.append(link);
  });

  const sourceNumbers = new Map<string, number>();
  body.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((source) => {
    source.target = "_blank";
    source.rel = "noopener noreferrer";

    let citationNumber = sourceNumbers.get(source.href);
    if (!citationNumber) {
      citationNumber = sourceNumbers.size + 1;
      sourceNumbers.set(source.href, citationNumber);

      const item = document.createElement("li");
      const link = document.createElement("a");
      const number = document.createElement("span");
      const sourceTitle = document.createElement("span");
      const host = document.createElement("span");
      link.href = source.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      number.className = "journey-reference-number";
      sourceTitle.className = "journey-reference-title";
      host.className = "journey-reference-source";
      number.textContent = `[${citationNumber}]`;
      sourceTitle.textContent = source.textContent?.replace(/[.;]$/, "") || "Source";
      host.textContent = new URL(source.href).hostname.replace(/^www\./, "");
      link.append(number, sourceTitle, host);
      item.append(link);
      references.append(item);
    }

    const marker = document.createElement("sup");
    marker.className = "journey-citation-ref";
    marker.textContent = `[${citationNumber}]`;
    source.after(marker);
  });

  article.dataset.railsReady = "true";
}

function syncJourneyBackDock(): void {
  if (dockFrame) return;
  dockFrame = window.requestAnimationFrame(() => {
    const article = document.querySelector<HTMLElement>("[data-journey-article]");
    const back = article?.querySelector<HTMLElement>(".journey-back");
    back?.classList.toggle(
      "is-docked",
      Boolean(article && article.getBoundingClientRect().bottom <= window.innerHeight),
    );
    dockFrame = 0;
  });
}

function initializeJourneyArticle(): void {
  prepareJourneyArticle();
  syncJourneyBackDock();
}

export function bindJourneyArticleEnhancements(): void {
  const journeyWindow = window as JourneyWindow;
  if (!journeyWindow.__journeyArticleBound) {
    window.addEventListener("scroll", syncJourneyBackDock, { passive: true });
    window.addEventListener("resize", syncJourneyBackDock);
    document.addEventListener("astro:page-load", initializeJourneyArticle);
    journeyWindow.__journeyArticleBound = true;
  }
  initializeJourneyArticle();
}
