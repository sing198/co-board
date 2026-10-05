import { localDate } from './boardDates';

export type BoardView = 'board' | 'list' | 'due' | 'calendar' | 'timeline' | 'mindmap' | 'scrum';
export type BoardFormat = 'kanban' | 'todo' | 'table' | 'calendar' | 'timeline' | 'mindmap' | 'sprint' | 'content';
const BOARD_VIEWS: BoardView[] = ['board', 'list', 'due', 'calendar', 'timeline', 'mindmap', 'scrum'];

export function isBoardView(value: unknown): value is BoardView {
  return typeof value === 'string' && BOARD_VIEWS.includes(value as BoardView);
}

export function defaultBoardView(format?: string): BoardView {
  if (format === 'calendar' || format === 'content') return 'calendar';
  if (format === 'timeline') return 'timeline';
  if (format === 'mindmap') return 'mindmap';
  if (format === 'sprint') return 'scrum';
  if (format === 'todo' || format === 'table') return 'list';
  return 'board';
}

export function dateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

// Monday-first, six full weeks keep navigation from shifting the calendar height.
export function calendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => addDays(first, index - mondayOffset));
}

export type TimelineScale = 'week' | 'month';
export function timelineWindow(anchor: Date, scale: TimelineScale): { start: Date; days: Date[] } {
  const start = scale === 'week'
    ? addDays(anchor, -((anchor.getDay() + 6) % 7))
    : new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const count = scale === 'week' ? 7 : new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  return { start, days: Array.from({ length: count }, (_, index) => addDays(start, index)) };
}

export type Schedule = { StartDate?: string; DueDate?: string };
export function taskDateRange(card: Schedule): { start: Date; end: Date; invalid: boolean } | null {
  const start = localDate(card.StartDate);
  const due = localDate(card.DueDate);
  if (!start && !due) return null;
  const actualStart = start || due!;
  const actualEnd = due || start!;
  const reversed = dayNumber(actualEnd) < dayNumber(actualStart);
  return { start: actualStart, end: reversed ? actualStart : actualEnd, invalid: reversed || Boolean(card.StartDate && !start) || Boolean(card.DueDate && !due) };
}

export function timelineBar(card: Schedule, start: Date, days: number): { offset: number; span: number; before: boolean; after: boolean; invalid: boolean } | null {
  const range = taskDateRange(card);
  if (!range || days < 1) return null;
  const from = dayNumber(range.start) - dayNumber(start);
  const until = dayNumber(range.end) - dayNumber(start);
  if (until < 0 || from >= days) return null;
  const clippedFrom = Math.max(0, from);
  return { offset: clippedFrom, span: Math.min(days - 1, until) - clippedFrom + 1, before: from < 0, after: until >= days, invalid: range.invalid };
}

export function parseDependencies(value?: string): string[] {
  if (!value) return [];
  let pieces: unknown[];
  try {
    const parsed: unknown = JSON.parse(value);
    pieces = Array.isArray(parsed) ? parsed : value.split(',');
  } catch { pieces = value.split(','); }
  return [...new Set(pieces.map(piece => String(piece).trim()).filter(piece => /^\d+$/.test(piece) && Number(piece) > 0).map(piece => String(Number(piece))))];
}

export type TreeCard = { ID: number; ParentID?: string; Position?: number };
export type MindMapNode<T extends TreeCard> = { card: T; parentId: string | null; depth: number; x: number; y: number };

export function includeAncestors<T extends TreeCard>(cards: T[], allCards: T[]): T[] {
  const byId = new Map(allCards.map(card => [String(card.ID), card]));
  const selected = new Map(cards.map(card => [String(card.ID), card]));
  for (const card of cards) {
    let parent = card.ParentID;
    const visited = new Set([String(card.ID)]);
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      const ancestor = byId.get(parent);
      if (!ancestor) break;
      selected.set(parent, ancestor);
      parent = ancestor.ParentID;
    }
  }
  return [...selected.values()];
}

// Repair orphan/self/cyclic parents for display without changing persisted data.
export function buildMindMap<T extends TreeCard>(cards: T[]): { nodes: MindMapNode<T>[]; rootY: number; width: number; height: number } {
  const ordered = [...cards].sort((a, b) => (a.Position || 0) - (b.Position || 0) || a.ID - b.ID);
  const byId = new Map(ordered.map(card => [String(card.ID), card]));
  const parents = new Map(ordered.map(card => [String(card.ID), card.ParentID && card.ParentID !== String(card.ID) && byId.has(card.ParentID) ? card.ParentID : null]));
  for (const card of ordered) {
    const chain: string[] = [];
    let id: string | null = String(card.ID);
    while (id) {
      const cycleAt = chain.indexOf(id);
      if (cycleAt !== -1) {
        const breakId = chain.slice(cycleAt).sort((a, b) => Number(a) - Number(b))[0];
        parents.set(breakId, null);
        break;
      }
      chain.push(id);
      id = parents.get(id) || null;
    }
  }
  const children = new Map<string | null, T[]>();
  for (const card of ordered) {
    const parent = parents.get(String(card.ID)) || null;
    children.set(parent, [...(children.get(parent) || []), card]);
  }
  const nodes: MindMapNode<T>[] = [];
  let leaf = 0;
  const visit = (card: T, depth: number): number => {
    const childYs = (children.get(String(card.ID)) || []).map(child => visit(child, depth + 1));
    const y = childYs.length ? (childYs[0] + childYs[childYs.length - 1]) / 2 : 58 + leaf++ * 112;
    nodes.push({ card, parentId: parents.get(String(card.ID)) || null, depth, x: 292 + (depth - 1) * 252, y });
    return y;
  };
  const rootYs = (children.get(null) || []).map(card => visit(card, 1));
  const rootY = rootYs.length ? (rootYs[0] + rootYs[rootYs.length - 1]) / 2 : 114;
  return { nodes, rootY, width: Math.max(760, 560 + Math.max(0, ...nodes.map(node => node.depth - 1)) * 252), height: Math.max(340, leaf * 112 + 80) };
}
