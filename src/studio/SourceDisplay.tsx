import { useLayoutEffect, useRef, useState } from "react";

import { LinkSource, YouTube } from "./glyphs";
import type { SourcePresentation } from "./previewSession";

interface SourceDisplayProps {
  source: SourcePresentation;
  title?: string;
  className?: string;
}

/** The same provider identity wherever Studio names an input source. */
export default function SourceDisplay({ source, title, className }: SourceDisplayProps) {
  const label = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const element = label.current;
    if (!element) return undefined;

    const sync = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    sync();
    return () => observer.disconnect();
  }, [source.displayUrl]);

  return (
    <span className={`source-display${className ? ` ${className}` : ""}`} title={title}>
      <span className="source-display-glyph" data-kind={source.kind}>
        {source.kind === "youtube" ? <YouTube /> : <LinkSource />}
      </span>
      <span ref={label} className="source-display-url" data-overflow={overflow}>
        <span className={`source-display-url-full${source.compactUrl ? " has-compact" : ""}`}>
          {source.displayUrl}
        </span>
        {source.compactUrl && (
          <span className="source-display-url-compact">{source.compactUrl}</span>
        )}
      </span>
    </span>
  );
}
