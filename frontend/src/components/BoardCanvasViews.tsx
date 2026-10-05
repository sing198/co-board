import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, CalendarDays, GitBranch, ListTodo } from 'lucide-react';
import type { Card } from '../useWebSocket';
import { localDate } from '../boardDates';
import { addDays, buildMindMap, calendarDays, dateKey, includeAncestors, parseDependencies, taskDateRange, timelineBar, timelineWindow } from '../boardFormats';
import type { TimelineScale } from '../boardFormats';
import '../boardFormats.css';

export type CreateTaskDetails = { dueDate?: string; startDate?: string; parentId?: string };
type FormatCard = Card & { StartDate?: string; Dependencies?: string; ParentID?: string };
type Props = {
  mode: 'calendar' | 'timeline' | 'mindmap';
  cards: FormatCard[];
  allCards?: FormatCard[];
  totalCards: number;
  boardName: string;
  canEdit: boolean;
  connected: boolean;
  onOpen: (card: Card) => void;
  onCreate: (details?: CreateTaskDetails) => void;
};
const monthLabel = (date: Date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const fullDate = (date: Date) => date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const taskId = (card: Card) => `TSK-${String(card.ID).padStart(3, '0')}`;
const stateClass = (card: Card) => /done|published|complete/i.test(card.List) ? 'is-done' : /doing|progress|review/i.test(card.List) ? 'is-active' : '';

function TaskButton({ card, onOpen }: { card: Card; onOpen: Props['onOpen'] }) {
  return <button type="button" className={`format-task ${stateClass(card)}`} aria-label={`Open task: ${card.Title}`} onClick={() => onOpen(card)}><small>{taskId(card)}</small><span>{card.Title}</span></button>;
}
function Unscheduled({ cards, onOpen, emptyLabel = 'Every task has a date.' }: { cards: Card[]; onOpen: Props['onOpen']; emptyLabel?: string }) {
  return <aside className="format-unscheduled" aria-label="Unscheduled tasks"><h3><ListTodo size={16} /> Unscheduled <span>{cards.length}</span></h3><p>Add dates in task details to place these tasks on the board.</p>{cards.length ? <div>{cards.map(card => <TaskButton key={card.ID} card={card} onOpen={onOpen} />)}</div> : <small>{emptyLabel}</small>}</aside>;
}

function CalendarView({ cards, canEdit, connected, onOpen, onCreate }: Props) {
  const [month, setMonth] = useState(() => new Date());
  const today = dateKey(new Date());
  const days = calendarDays(month);
  const byDate = useMemo(() => {
    const groups = new Map<string, FormatCard[]>();
    for (const card of cards) {
      const due = localDate(card.DueDate);
      if (due) { const key = dateKey(due); groups.set(key, [...(groups.get(key) || []), card]); }
    }
    return groups;
  }, [cards]);
  const unscheduled = cards.filter(card => !localDate(card.DueDate));
  return <>
    <div className="format-toolbar"><div><CalendarDays size={18} /><h2>{monthLabel(month)}</h2></div><nav aria-label="Calendar navigation"><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><button type="button" onClick={() => setMonth(new Date())}>Today</button><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17} /></button></nav></div>
    <div className="format-calendar-layout"><div className="format-calendar-scroll"><div className="format-calendar" role="table" aria-label={`Calendar for ${monthLabel(month)}`}><div className="format-calendar-weekdays" role="row">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div role="columnheader" key={day}>{day}</div>)}</div><div className="format-calendar-days" role="rowgroup">{Array.from({ length: 6 }, (_, week) => <div role="row" className="format-calendar-week" key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
      const key = dateKey(day);
      return <div role="cell" key={key} className={`format-calendar-day ${day.getMonth() !== month.getMonth() ? 'is-outside' : ''} ${key === today ? 'is-today' : ''}`} aria-label={`${fullDate(day)}: ${byDate.get(key)?.length || 0} tasks`}><div className="format-day-heading"><time dateTime={key}>{day.getDate()}</time><button type="button" aria-label={`Add task due ${fullDate(day)}`} title={!connected ? 'Reconnect to add tasks' : !canEdit ? 'View-only board' : 'Add task on this date'} disabled={!canEdit || !connected} onClick={() => onCreate({ dueDate: key })}><Plus size={13} /></button></div><div className="format-day-tasks">{(byDate.get(key) || []).map(card => <TaskButton key={card.ID} card={card} onOpen={onOpen} />)}</div></div>;
    })}</div>)}</div></div></div><Unscheduled cards={unscheduled} onOpen={onOpen} /></div>
  </>;
}

function TimelineView({ cards, allCards = cards, canEdit, connected, onOpen, onCreate }: Props) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [scale, setScale] = useState<TimelineScale>('month');
  const window = timelineWindow(anchor, scale);
  const cellWidth = scale === 'week' ? 110 : 34;
  const rowHeight = 62;
  const dated = cards.filter(card => taskDateRange(card)).sort((a, b) => (a.StartDate || a.DueDate || '').localeCompare(b.StartDate || b.DueDate || '') || (a.Position || 0) - (b.Position || 0));
  const visible = dated.map(card => ({ card, bar: timelineBar(card, window.start, window.days.length) })).filter(item => item.bar !== null);
  const unscheduled = cards.filter(card => !taskDateRange(card));
  const byId = new Map(allCards.map(card => [String(card.ID), card]));
  const rowById = new Map(visible.map((item, index) => [String(item.card.ID), { ...item, index }]));
  const edges = visible.flatMap((item, index) => parseDependencies(item.card.Dependencies).map(id => {
    const source = rowById.get(id);
    if (!source?.bar || !item.bar || id === String(item.card.ID)) return null;
    const fromX = (source.bar.offset + source.bar.span) * cellWidth - 6;
    const toX = item.bar.offset * cellWidth + 6;
    const fromY = source.index * rowHeight + rowHeight / 2;
    const toY = index * rowHeight + rowHeight / 2;
    const bend = fromX <= toX ? (fromX + toX) / 2 : Math.max(fromX, toX) + 12;
    return <path key={`${id}-${item.card.ID}`} d={`M ${fromX} ${fromY} H ${bend} V ${toY} H ${toX}`} markerEnd="url(#timeline-dependency-arrow)" />;
  }));
  const move = (direction: number) => setAnchor(scale === 'week' ? addDays(anchor, direction * 7) : new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
  const label = scale === 'month' ? monthLabel(anchor) : `${window.days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${window.days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return <>
    <div className="format-toolbar"><div><GitBranch size={18} /><h2>{label}</h2></div><div className="format-timeline-controls"><div className="format-segment" role="group" aria-label="Timeline zoom"><button type="button" aria-pressed={scale === 'week'} onClick={() => setScale('week')}>Week</button><button type="button" aria-pressed={scale === 'month'} onClick={() => setScale('month')}>Month</button></div><nav aria-label="Timeline navigation"><button type="button" aria-label={`Previous ${scale}`} onClick={() => move(-1)}><ChevronLeft size={17} /></button><button type="button" onClick={() => setAnchor(new Date())}>Today</button><button type="button" aria-label={`Next ${scale}`} onClick={() => move(1)}><ChevronRight size={17} /></button></nav><button type="button" className="format-primary" disabled={!canEdit || !connected} onClick={() => onCreate({ startDate: dateKey(window.start), dueDate: dateKey(window.days[window.days.length - 1]) })}><Plus size={14} /> Schedule task</button></div></div>
    <p className="format-hint">Click a task to edit dates and dependencies. Arrows connect a task to the work it depends on.</p>
    <div className="format-timeline-scroll"><div className="format-timeline" style={{ minWidth: 224 + window.days.length * cellWidth }}><div className="format-timeline-labels"><div className="format-timeline-label-heading">Task / Dependencies</div>{visible.map(({ card, bar }) => <div className="format-timeline-label" key={card.ID} style={{ height: rowHeight }}><button type="button" onClick={() => onOpen(card)} aria-label={`Open task: ${card.Title}`}><small>{taskId(card)} · {card.List}</small><strong>{card.Title}</strong></button><span>{bar?.invalid ? 'Check task dates' : parseDependencies(card.Dependencies).length ? `After ${parseDependencies(card.Dependencies).map(id => byId.has(id) ? `TSK-${id.padStart(3, '0')}` : `missing #${id}`).join(', ')}` : 'No dependencies'}</span></div>)}</div><div className="format-timeline-chart" style={{ width: window.days.length * cellWidth }}><div className="format-timeline-axis" style={{ gridTemplateColumns: `repeat(${window.days.length}, ${cellWidth}px)` }}>{window.days.map(day => <div key={dateKey(day)} className={dateKey(day) === dateKey(new Date()) ? 'is-today' : ''}><span>{day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1)}</span><strong>{day.getDate()}</strong></div>)}</div><div className="format-timeline-plot" style={{ backgroundSize: `${cellWidth}px 100%`, minHeight: Math.max(rowHeight, visible.length * rowHeight) }}><svg className="format-dependencies" aria-hidden="true" width="100%" height="100%"><defs><marker id="timeline-dependency-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" /></marker></defs>{edges}</svg>{visible.map(({ card, bar }) => <div className="format-timeline-row" style={{ height: rowHeight }} key={card.ID}><button type="button" className={`format-timeline-bar ${stateClass(card)} ${bar?.invalid ? 'has-invalid-dates' : ''}`} style={{ left: bar!.offset * cellWidth + 4, width: Math.max(24, bar!.span * cellWidth - 8) }} aria-label={`Open task: ${card.Title}, ${card.StartDate || card.DueDate} to ${card.DueDate || card.StartDate}`} title={`${card.Title} · ${card.StartDate || card.DueDate} → ${card.DueDate || card.StartDate}`} onClick={() => onOpen(card)}><span>{bar!.before ? '‹ ' : ''}{card.Title}{bar!.after ? ' ›' : ''}</span></button></div>)}</div></div></div></div>
    {!visible.length && <div className="format-empty">No scheduled tasks in this {scale}. Use the date arrows or add a task with dates.</div>}
    {dated.length > visible.length && <p className="format-hint">{dated.length - visible.length} scheduled {dated.length - visible.length === 1 ? 'task is' : 'tasks are'} outside this range.</p>}
    <Unscheduled cards={unscheduled} onOpen={onOpen} />
  </>;
}

function MindMapView({ cards, allCards = cards, totalCards, boardName, canEdit, connected, onOpen, onCreate }: Props) {
  const contextCards = useMemo(() => includeAncestors(cards, allCards), [cards, allCards]);
  const graph = useMemo(() => buildMindMap(contextCards), [contextCards]);
  const visibleIds = new Set(cards.map(card => card.ID));
  const byId = new Map(graph.nodes.map(node => [String(node.card.ID), node]));
  return <><div className="format-toolbar"><div><GitBranch size={18} /><h2>Mind map</h2></div><button type="button" className="format-primary" disabled={!canEdit || !connected} onClick={() => onCreate()}><Plus size={14} /> Add idea</button></div><p className="format-hint">Build ideas from the board root. Click a node to open its details or add a child to extend a branch.</p><div className="format-mindmap-scroll"><div className="format-mindmap" style={{ width: graph.width, height: graph.height }}><svg className="format-mindmap-lines" aria-hidden="true" width={graph.width} height={graph.height}>{graph.nodes.map(node => {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    const fromX = parent ? parent.x + 216 : 240;
    const fromY = parent ? parent.y : graph.rootY;
    const middle = (fromX + node.x) / 2;
    return <path key={node.card.ID} d={`M ${fromX} ${fromY} C ${middle} ${fromY}, ${middle} ${node.y}, ${node.x} ${node.y}`} />;
  })}</svg><div className="format-mindmap-root" style={{ top: graph.rootY - 44 }}><small>BOARD ROOT</small><strong>{boardName}</strong><button type="button" disabled={!canEdit || !connected} aria-label={`Add idea to ${boardName}`} onClick={() => onCreate()}><Plus size={13} /> Add idea</button></div>{graph.nodes.map(node => <div key={node.card.ID} className={`format-mindmap-node ${stateClass(node.card)} ${visibleIds.has(node.card.ID) ? '' : 'is-context'}`} style={{ left: node.x, top: node.y - 44 }}><button type="button" className="format-mindmap-open" aria-label={`Open task: ${node.card.Title}`} onClick={() => onOpen(node.card)}><small>{taskId(node.card)} · {visibleIds.has(node.card.ID) ? node.card.List : 'Parent context'}</small><strong>{node.card.Title}</strong></button><button type="button" className="format-mindmap-add" aria-label={`Add child to ${node.card.Title}`} title={!connected ? 'Reconnect to add ideas' : !canEdit ? 'View-only board' : 'Add child idea'} disabled={!canEdit || !connected} onClick={() => onCreate({ parentId: String(node.card.ID) })}><Plus size={14} /></button></div>)}</div></div>{!totalCards && <div className="format-empty">Start with an idea, then add child nodes to connect your thinking.</div>}</>;
}

export default function BoardCanvasViews(props: Props) {
  return <main id="board-content" className={`board-canvas-views view-${props.mode}`} aria-label={props.mode === 'calendar' ? 'Calendar board' : props.mode === 'timeline' ? 'Timeline board' : 'Mind map board'}>{props.cards.length === 0 && props.totalCards > 0 && <div className="format-filter-notice" role="status">No tasks match the current filters.</div>}{props.mode === 'calendar' ? <CalendarView {...props} /> : props.mode === 'timeline' ? <TimelineView {...props} /> : <MindMapView {...props} />}</main>;
}

// Tiny handcrafted diagrams show the structure of each format in the picker.
export function BoardFormatPreview({ format }: { format: string }) {
  if (format === 'calendar' || format === 'content') return <div className="board-format-preview preview-calendar" aria-hidden="true"><div className="preview-calendar-top" /><div>{Array.from({ length: 21 }, (_, index) => <i key={index}>{[3, 9, 11, 17].includes(index) && <b />}</i>)}</div></div>;
  if (format === 'timeline') return <div className="board-format-preview preview-timeline" aria-hidden="true"><div><i /><i /><i /></div><span style={{ left: '31%', width: '30%', top: '27%' }} /><span style={{ left: '44%', width: '39%', top: '48%' }} /><span style={{ left: '67%', width: '24%', top: '69%' }} /></div>;
  if (format === 'mindmap') return <div className="board-format-preview preview-mindmap" aria-hidden="true"><svg viewBox="0 0 200 100"><path d="M51 50 C83 50 83 22 108 22 M51 50 C83 50 83 76 108 76 M134 22 H167" /><rect x="14" y="38" width="42" height="24" rx="5" /><rect x="106" y="12" width="35" height="21" rx="4" /><rect x="106" y="66" width="35" height="21" rx="4" /><rect x="164" y="12" width="26" height="21" rx="4" /></svg></div>;
  if (format === 'todo' || format === 'table') return <div className={`board-format-preview preview-rows ${format === 'table' ? 'preview-table' : ''}`} aria-hidden="true">{Array.from({ length: 3 }, (_, index) => <div key={index}><i /><b /><span /></div>)}</div>;
  return <div className={`board-format-preview preview-columns ${format === 'sprint' ? 'preview-scrum' : ''}`} aria-hidden="true">{Array.from({ length: format === 'sprint' ? 4 : 3 }, (_, column) => <div key={column}><i />{Array.from({ length: column % 2 ? 1 : 2 }, (_, index) => <span key={index}><b /><em /></span>)}</div>)}</div>;
}
