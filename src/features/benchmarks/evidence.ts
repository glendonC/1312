export const outcomeStates = [
  {
    id: "correct",
    label: "Shown & right",
    definition: "The line was shown and its meaning passed human review.",
  },
  {
    id: "wrong",
    label: "Shown & wrong",
    definition: "The line was shown but its meaning failed human review.",
  },
  {
    id: "withheld",
    label: "Held back",
    definition: "The system stayed silent instead of guessing on a line it wasn’t sure of.",
  },
  {
    id: "missing",
    label: "Missed",
    definition: "A line that mattered was dropped, with no decision explaining the gap.",
  },
] as const;
