// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BoardCanvasViews from '../src/components/BoardCanvasViews';
import type { Card } from '../src/useWebSocket';

const card: Card = { ID: 1, BoardID: 'board', Title: 'Design the landing page', List: 'DOING', DueDate: '2026-10-05' };
const common = { cards: [card], totalCards: 1, boardName: 'Product ideas', canEdit: true, connected: true, onOpen: vi.fn(), onCreate: vi.fn() };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 5, 12)); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('creates a calendar task on the selected date and prevents offline/viewer creation', () => {
  const view = render(<BoardCanvasViews {...common} mode="calendar" />);
  const name = `Add task due ${new Date(2026, 9, 5).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  fireEvent.click(screen.getByRole('button', { name }));
  expect(common.onCreate).toHaveBeenCalledWith({ dueDate: '2026-10-05' });
  fireEvent.click(screen.getByRole('button', { name: 'Open task: Design the landing page' }));
  expect(common.onOpen).toHaveBeenCalledWith(card);
  view.rerender(<BoardCanvasViews {...common} mode="calendar" connected={false} />);
  expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<BoardCanvasViews {...common} mode="calendar" canEdit={false} />);
  expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
});

it('uses real ranges and dependency labels on the timeline without assigning fake dates', () => {
  const next = { ...card, ID: 2, Title: 'Build the landing page', StartDate: '2026-10-06', DueDate: '2026-10-12', Dependencies: '1' };
  const undated = { ...card, ID: 3, Title: 'Explore another idea', DueDate: '' };
  render(<BoardCanvasViews {...common} cards={[card, next, undated]} totalCards={3} mode="timeline" />);
  expect(screen.getByText('After TSK-001')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Open task: Explore another idea' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Schedule task' }));
  expect(common.onCreate).toHaveBeenCalledWith({ startDate: '2026-10-01', dueDate: '2026-10-31' });
  fireEvent.click(screen.getByRole('button', { name: 'Week' }));
  expect(screen.getByRole('button', { name: 'Next week' })).toBeTruthy();
});

it('creates a child from its actual parent and shows filtered ancestor context', () => {
  const child = { ...card, ID: 2, Title: 'Hero section', ParentID: '1' };
  const view = render(<BoardCanvasViews {...common} cards={[child]} allCards={[card, child]} totalCards={2} mode="mindmap" />);
  expect(screen.getByText('Product ideas')).toBeTruthy();
  expect(screen.getByText('TSK-001 · Parent context')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add child to Hero section' }));
  expect(common.onCreate).toHaveBeenCalledWith({ parentId: '2' });
  view.rerender(<BoardCanvasViews {...common} cards={[child]} allCards={[card, child]} totalCards={2} mode="mindmap" canEdit={false} />);
  expect((screen.getByRole('button', { name: 'Add child to Hero section' }) as HTMLButtonElement).disabled).toBe(true);
});
