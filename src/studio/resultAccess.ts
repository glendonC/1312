export const RECORDED_RESULTS_ID = "studio-recorded-results";
export const PRODUCTION_CAPTION_RESULTS_ID = "studio-production-caption-results";

/** Move the current Studio composition to a real result region and hand it focus. */
export function focusResultTarget(id: string): boolean {
  if (typeof document === "undefined") return false;
  const target = document.getElementById(id);
  if (!(target instanceof HTMLElement)) return false;

  target.focus({ preventScroll: true });
  target.scrollIntoView({
    block: "start",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
  return true;
}
