import { createContext } from "react";

/**
 * The DOM seat inside the result workspace's command baseline. When a composing surface provides
 * it, the learning workspace portals its Saved / Tune toggles down into the baseline — the
 * focus-panel rule that commands live at the composition's foot, not in a toolbar over the
 * content. Surfaces that provide no seat (the production results region) keep the toggles
 * in the workspace bar unchanged.
 */
export const ResultCommandSeat = createContext<HTMLElement | null>(null);
