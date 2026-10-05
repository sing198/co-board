export type DueBucket = "overdue" | "today" | "upcoming" | "later" | "none";

export const DUE_BUCKETS: { id: DueBucket; label: string }[] = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Next 7 days" },
  { id: "later", label: "Later" },
  { id: "none", label: "No due date" },
];

// Date inputs store YYYY-MM-DD. Compare calendar days in the user's local time
// so a due date never shifts to the previous day in a western time zone.
export function localDate(value?: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
}

export function dueBucket(value?: string, today = new Date()): DueBucket {
  const due = localDate(value);
  if (!due) return "none";
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const difference = Math.round((Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000);
  if (difference < 0) return "overdue";
  if (difference === 0) return "today";
  if (difference <= 7) return "upcoming";
  return "later";
}
