import { describe, expect, it } from 'vitest';
import { addDays, buildMindMap, calendarDays, dateKey, dayNumber, defaultBoardView, includeAncestors, isBoardView, parseDependencies, taskDateRange, timelineBar, timelineWindow } from '../src/boardFormats';

describe('board format selection', () => {
  it('gives formats their distinct native views and rejects stale preferences', () => {
    expect(['kanban', 'todo', 'table', 'calendar', 'timeline', 'mindmap', 'sprint', 'content'].map(defaultBoardView)).toEqual(['board', 'list', 'list', 'calendar', 'timeline', 'mindmap', 'scrum', 'calendar']);
    expect(defaultBoardView('unknown')).toBe('board');
    expect(isBoardView('calendar')).toBe(true);
    expect(isBoardView('content')).toBe(false);
    expect(isBoardView(null)).toBe(false);
  });
});

describe('calendar and timeline date arithmetic', () => {
  it('makes six Monday-first weeks across month and year boundaries', () => {
    const days = calendarDays(new Date(2026, 2, 1));
    expect(days).toHaveLength(42);
    expect(dateKey(days[0])).toBe('2026-02-23');
    expect(dateKey(days[41])).toBe('2026-04-05');
    expect(days.every((day, index) => !index || dayNumber(day) - dayNumber(days[index - 1]) === 1)).toBe(true);
    const week = timelineWindow(new Date(2027, 0, 1), 'week');
    expect(week.days.map(dateKey)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  });
  it('respects leap days and local calendar days instead of elapsed hours', () => {
    expect(timelineWindow(new Date(2028, 1, 10), 'month').days).toHaveLength(29);
    expect(dateKey(addDays(new Date(2026, 2, 8), 1))).toBe('2026-03-09');
    expect(dayNumber(new Date(2026, 2, 9)) - dayNumber(new Date(2026, 2, 8))).toBe(1);
  });
  it('clips inclusive bars to the visible window and leaves undated work unscheduled', () => {
    const start = new Date(2026, 9, 5);
    expect(timelineBar({ StartDate: '2026-10-03', DueDate: '2026-10-07' }, start, 7)).toEqual({ offset: 0, span: 3, before: true, after: false, invalid: false });
    expect(timelineBar({ StartDate: '2026-10-10', DueDate: '2026-10-20' }, start, 7)).toEqual({ offset: 5, span: 2, before: false, after: true, invalid: false });
    expect(timelineBar({ DueDate: '2026-10-04' }, start, 7)).toBeNull();
    expect(timelineBar({ DueDate: '2026-10-05' }, start, 7)?.span).toBe(1);
    expect(taskDateRange({})).toBeNull();
    expect(taskDateRange({ StartDate: '2026-02-30' })).toBeNull();
    expect(timelineBar({ StartDate: '2026-10-07', DueDate: '2026-10-06' }, start, 7)).toEqual({ offset: 2, span: 1, before: false, after: false, invalid: true });
  });
});

describe('dependencies and mind map graph safety', () => {
  it('accepts CSV and JSON dependency IDs, normalizing duplicates and invalid entries', () => {
    expect(parseDependencies(' 2,02,3,missing,0,-1 ')).toEqual(['2', '3']);
    expect(parseDependencies('[1,"2",2,null,"invalid"]')).toEqual(['1', '2']);
    expect(parseDependencies()).toEqual([]);
  });
  it('keeps ancestor context when filtering a deep branch', () => {
    const all = [{ ID: 1 }, { ID: 2, ParentID: '1' }, { ID: 3, ParentID: '2' }, { ID: 4 }];
    expect(includeAncestors([all[2]], all).map(card => card.ID)).toEqual([3, 2, 1]);
  });
  it('renders every card once when parents are cyclic, missing, or self-referential', () => {
    const graph = buildMindMap([{ ID: 1, ParentID: '2' }, { ID: 2, ParentID: '1' }, { ID: 3, ParentID: '99' }, { ID: 4, ParentID: '4' }]);
    expect(graph.nodes.map(node => node.card.ID).sort()).toEqual([1, 2, 3, 4]);
    expect(graph.nodes.find(node => node.card.ID === 1)?.parentId).toBeNull();
    expect(graph.nodes.find(node => node.card.ID === 2)?.depth).toBe(2);
    expect(graph.nodes.filter(node => [3, 4].includes(node.card.ID)).every(node => node.parentId === null)).toBe(true);
    expect(graph.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    expect(buildMindMap([]).height).toBeGreaterThan(0);
  });
});
