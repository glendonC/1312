/** Studio glyphs. Drawn at one size and coloured by their control. */

export function Play() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M5 3.4 12.5 8 5 12.6z" fill="currentColor" />
    </svg>
  );
}

/** Pause and resume share one footprint so the control never shifts when its state changes. */
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

export function YouTube() {
  return (
    <svg viewBox="0 0 24 17" width="24" height="17" aria-hidden="true">
      <rect x="0.5" y="0.5" width="23" height="16" rx="5" fill="#ff0033" />
      <path d="m10 5 6 3.5-6 3.5z" fill="#fff" />
    </svg>
  );
}

export function LinkSource() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="m6.4 9.6 3.2-3.2M5.2 11.9 4.1 13a2.1 2.1 0 0 1-3-3l2.5-2.5a2.1 2.1 0 0 1 3 0M10.8 4.1 11.9 3a2.1 2.1 0 0 1 3 3l-2.5 2.5a2.1 2.1 0 0 1-3 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Edit() {
  return (
    <svg className="edit" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="m4 10.7-.5 2.1 2.1-.5 6.7-6.7-1.6-1.6zM9.8 4.9l1.6 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
