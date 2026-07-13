/** The dock's glyphs. Drawn at one size, coloured by whatever they sit inside. */

export function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      className="chevron"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      style={up ? { transform: "rotate(180deg)" } : undefined}
    >
      <path
        d="M4 6.5 8 10.5l4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The hold and the release: one control, two moods, the same box so nothing shifts. */
export function Hold({ paused }: { paused: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      {paused ? (
        <path
          d="M5 3.4 12.4 8 5 12.6z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <rect x="4.6" y="3.6" width="2.4" height="8.8" rx="1" fill="currentColor" />
          <rect x="9" y="3.6" width="2.4" height="8.8" rx="1" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function Cross() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M2.6 8h10.2M8.6 3.4 13.4 8l-4.8 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
