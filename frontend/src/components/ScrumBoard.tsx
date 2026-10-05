import { useEffect, useMemo, useState } from "react";
import type { Card } from "../useWebSocket";
import "./scrumBoard.css";

type ScrumCard = Card & {
  StoryPoints?: number;
  InSprint?: boolean;
};

export type SprintDetails = {
  name: string;
  start: string;
  end: string;
  status: "planning" | "active" | "completed";
};

type Props = {
  cards: ScrumCard[];
  allCards?: ScrumCard[];
  columns: string[];
  sprint: SprintDetails;
  canEdit: boolean;
  connected: boolean;
  saving?: boolean;
  onOpen: (card: Card) => void;
  onMove: (card: Card, column: string) => void;
  onEdit: (card: Card, changes: { inSprint?: boolean; storyPoints?: number }) => void;
  onUpdateSprint: (details: Partial<SprintDetails>) => void;
  onCreate: () => void;
};

const pointOptions = [0, 1, 2, 3, 5, 8, 13, 21];

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidDateRange(start: string, end: string) {
  return isValidDate(start) && isValidDate(end) && start <= end;
}

function pointCount(cards: ScrumCard[]) {
  return cards.reduce((total, card) => total + Math.max(0, card.StoryPoints || 0), 0);
}

export default function ScrumBoard({ cards, allCards = cards, columns, sprint, canEdit, connected, saving = false, onOpen, onMove, onEdit, onUpdateSprint, onCreate }: Props) {
  const [draftName, setDraftName] = useState(sprint.name || "Sprint 1");
  const [draftStart, setDraftStart] = useState(sprint.start || "");
  const [draftEnd, setDraftEnd] = useState(sprint.end || "");
  const [confirmFinish, setConfirmFinish] = useState(false);

  useEffect(() => {
    setDraftName(sprint.name || "Sprint 1");
    setDraftStart(sprint.start || "");
    setDraftEnd(sprint.end || "");
  }, [sprint.name, sprint.start, sprint.end]);

  const status = sprint.status === "active" || sprint.status === "completed" ? sprint.status : "planning";
  const mayEdit = canEdit && connected && !saving;
  const mayChangeTasks = mayEdit && status !== "completed";
  const mayConfigure = mayEdit && status === "planning";
  const isDirty = draftName.trim() !== (sprint.name || "Sprint 1") || draftStart !== (sprint.start || "") || draftEnd !== (sprint.end || "");
  const draftDatesConflict = !!draftStart && !!draftEnd && !isValidDateRange(draftStart, draftEnd);
  const canSaveSetup = mayConfigure && isDirty && !!draftName.trim() && !draftDatesConflict;
  const canStart = mayConfigure && !isDirty && !!sprint.name?.trim() && isValidDateRange(sprint.start || "", sprint.end || "");

  const backlog = useMemo(() => cards.filter(card => !card.InSprint), [cards]);
  const sprintCards = useMemo(() => cards.filter(card => !!card.InSprint), [cards]);
  const allSprintCards = useMemo(() => allCards.filter(card => !!card.InSprint), [allCards]);
  const workflowColumns = columns.length > 0 ? columns : ["TO DO", "IN PROGRESS", "DONE"];
  const statusColumns = [...new Set([...workflowColumns, ...sprintCards.map(card => card.List).filter(Boolean)])];
  const doneColumn = workflowColumns[workflowColumns.length - 1];
  const completedCards = allSprintCards.filter(card => card.List === doneColumn);
  const sprintPoints = pointCount(allSprintCards);
  const completedPoints = pointCount(completedCards);

  const taskRow = (card: ScrumCard, inSprint: boolean) => (
    <li key={card.ID} className="scrum-task">
      <button type="button" className="scrum-task-title" onClick={() => onOpen(card)}>
        {card.Title || "Untitled task"}
      </button>
      <div className="scrum-task-actions">
        {inSprint && (
          <select
            aria-label={`Move ${card.Title} to column`}
            value={card.List}
            disabled={!mayChangeTasks}
            onChange={event => onMove(card, event.target.value)}
          >
            {statusColumns.map(column => <option key={column} value={column}>{column}</option>)}
          </select>
        )}
        <select
          aria-label={`Estimate ${card.Title}`}
          value={card.StoryPoints || 0}
          disabled={!mayChangeTasks}
          onChange={event => onEdit(card, { storyPoints: Number(event.target.value) })}
        >
          {[...new Set([...pointOptions, card.StoryPoints || 0])].sort((a, b) => a - b).map(points => (
            <option key={points} value={points}>{points === 0 ? "No points" : `${points} ${points === 1 ? "point" : "points"}`}</option>
          ))}
        </select>
        <button
          type="button"
          className="scrum-scope-button"
          disabled={!mayChangeTasks}
          onClick={() => onEdit(card, { inSprint: !inSprint })}
        >
          {inSprint ? "Remove from sprint" : "Add to sprint"}
        </button>
      </div>
    </li>
  );

  return (
    <section className="scrum-board" aria-label="Scrum sprint workspace">
      <header className="scrum-heading">
        <div>
          <div className="scrum-eyebrow">SCRUM WORKSPACE</div>
          <h2>{sprint.name || "Sprint 1"}</h2>
          <p>Plan a focused sprint, estimate the work, and move tasks through your workflow.</p>
        </div>
        <span className={`scrum-status scrum-status-${status}`}>{status === "active" ? "Active sprint" : status === "completed" ? "Completed sprint" : "Planning"}</span>
      </header>

      <div className="scrum-summary" aria-label="Sprint progress">
        <div><strong>{allSprintCards.length}</strong><span>tasks in sprint</span></div>
        <div><strong>{completedCards.length}</strong><span>tasks completed</span></div>
        <div><strong>{completedPoints} / {sprintPoints}</strong><span>points completed</span></div>
        <div className="scrum-progress-wrap">
          <label htmlFor="scrum-progress">Progress · {allSprintCards.length ? Math.round(completedCards.length / allSprintCards.length * 100) : 0}%</label>
          <progress id="scrum-progress" max={Math.max(1, allSprintCards.length)} value={completedCards.length} />
        </div>
      </div>

      <section className="scrum-panel scrum-setup" aria-label="Sprint setup">
        <div className="scrum-panel-heading">
          <div><h3>Sprint setup</h3><p>Save the name and dates before starting the sprint.</p></div>
          {status === "completed" && <span className="scrum-finished-note">This sprint is complete.</span>}
        </div>
        <div className="scrum-fields">
          <label>Sprint name
            <input aria-label="Sprint name" value={draftName} disabled={!mayConfigure} onChange={event => setDraftName(event.target.value)} maxLength={100} />
          </label>
          <label>Start date
            <input aria-label="Sprint start date" type="date" value={draftStart} disabled={!mayConfigure} onInput={event => setDraftStart(event.currentTarget.value)} onChange={event => setDraftStart(event.target.value)} />
          </label>
          <label>End date
            <input aria-label="Sprint end date" type="date" value={draftEnd} disabled={!mayConfigure} onInput={event => setDraftEnd(event.currentTarget.value)} onChange={event => setDraftEnd(event.target.value)} />
          </label>
        </div>
        {draftDatesConflict && <p role="alert" className="scrum-field-error">End date must be on or after the start date.</p>}
        {status === "planning" && (
          <div className="scrum-setup-actions">
            <button type="button" className="scrum-button scrum-button-secondary" disabled={!canSaveSetup} onClick={() => onUpdateSprint({ name: draftName.trim(), start: draftStart, end: draftEnd })}>Save setup</button>
            <button type="button" className="scrum-button scrum-button-primary" disabled={!canStart} onClick={() => onUpdateSprint({ status: "active" })}>Start sprint</button>
            {!isValidDateRange(sprint.start || "", sprint.end || "") && <span className="scrum-help">Save a valid date range to start.</span>}
            {isDirty && isValidDateRange(sprint.start || "", sprint.end || "") && <span className="scrum-help">Save changes before starting.</span>}
          </div>
        )}
        {status === "active" && (
          <div className="scrum-setup-actions">
            {confirmFinish ? (
              <div className="scrum-finish-confirm" role="group" aria-label="Confirm sprint completion">
                <span>Finish this sprint?</span>
                <button type="button" className="scrum-button scrum-button-primary" disabled={!mayEdit} onClick={() => { onUpdateSprint({ status: "completed" }); setConfirmFinish(false); }}>Confirm finish</button>
                <button type="button" className="scrum-button scrum-button-secondary" onClick={() => setConfirmFinish(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="scrum-button scrum-button-secondary" disabled={!mayEdit} onClick={() => setConfirmFinish(true)}>Complete sprint</button>
            )}
          </div>
        )}
      </section>

      <div className="scrum-columns">
        <section className="scrum-panel" aria-label="Product backlog">
          <div className="scrum-panel-heading">
            <div><h3>Product backlog <span className="scrum-count">{backlog.length}</span></h3><p>Tasks waiting outside the current sprint.</p></div>
            <button type="button" className="scrum-button scrum-button-secondary" disabled={!mayEdit} onClick={onCreate}>New task</button>
          </div>
          {backlog.length ? <ul className="scrum-task-list">{backlog.map(card => taskRow(card, false))}</ul> : <p className="scrum-empty">No tasks in the backlog.</p>}
        </section>

        <section className="scrum-panel scrum-sprint-panel" aria-label="Sprint tasks">
          <div className="scrum-panel-heading"><div><h3>Sprint scope <span className="scrum-count">{sprintCards.length}</span></h3><p>{status === "active" ? "Move work across the sprint columns." : status === "completed" ? "Final state of this sprint." : "Choose tasks from the backlog to plan this sprint."}</p></div></div>
          {sprintCards.length === 0 ? <p className="scrum-empty">Add tasks from the backlog to build this sprint.</p> : status === "active" ? (
            <div className="scrum-status-grid">
              {statusColumns.map(column => {
                const columnCards = sprintCards.filter(card => card.List === column);
                return <section key={column} className="scrum-status-column" aria-label={`${column} tasks`}>
                  <h4>{column} <span>{columnCards.length}</span></h4>
                  {columnCards.length ? <ul className="scrum-task-list">{columnCards.map(card => taskRow(card, true))}</ul> : <p className="scrum-column-empty">No tasks</p>}
                </section>;
              })}
            </div>
          ) : <ul className="scrum-task-list">{sprintCards.map(card => taskRow(card, true))}</ul>}
        </section>
      </div>
    </section>
  );
}
