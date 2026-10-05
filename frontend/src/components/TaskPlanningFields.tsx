import { useEffect, useState } from "react";
import type { Card } from "../useWebSocket";
import { localDate } from "../boardDates";
import "./taskPlanning.css";

type Props = {
  card: Card;
  cards: Card[];
  canEdit: boolean;
  boardType: string;
  onSave: (changes: Record<string, string>) => boolean | void;
};

export default function TaskPlanningFields({ card, cards, canEdit, boardType, onSave }: Props) {
  const [start, setStart] = useState(card.StartDate || "");
  const [end, setEnd] = useState(card.DueDate || "");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!dirty) { setStart(card.StartDate || ""); setEnd(card.DueDate || ""); }
  }, [card.StartDate, card.DueDate, dirty]);
  const dependencies = (card.Dependencies || "").split(",").filter(Boolean);
  const otherCards = cards.filter(item => item.ID !== card.ID);

  const saveSchedule = () => {
    if ((start && !localDate(start)) || (end && !localDate(end))) { setError("Enter valid calendar dates."); return; }
    if (start && end && start > end) { setError("The end date must be on or after the start date."); return; }
    setError("");
    const accepted = onSave({ startDate: start, dueDate: end });
    if (accepted !== false) setDirty(false);
    else setError("Could not send this change. Reconnect and save again.");
  };

  return <div className="task-planning-fields">
    <section aria-label="Task schedule">
      <h3>Schedule</h3>
      <div className="planning-date-row">
        <label>Start date<input aria-label="Start date" type="date" value={start} disabled={!canEdit} onInput={event => { setStart(event.currentTarget.value); setDirty(true); }} onChange={event => { setStart(event.target.value); setDirty(true); }} /></label>
        <label>Due date<input aria-label="Due date" type="date" value={end} disabled={!canEdit} onInput={event => { setEnd(event.currentTarget.value); setDirty(true); }} onChange={event => { setEnd(event.target.value); setDirty(true); }} /></label>
        {canEdit && <button className="planning-save" disabled={!dirty} onClick={saveSchedule}>Save schedule</button>}
      </div>
      {error && <p role="alert" className="planning-error">{error}</p>}
      <p className="planning-hint">Calendar uses the due date. Timeline uses the start and due dates.</p>
    </section>
    <section aria-label="Task relationships">
      <h3>Relationships</h3>
      <label>Parent idea<select aria-label="Parent idea" disabled={!canEdit} value={card.ParentID || ""} onChange={event => onSave({ parentId: event.target.value })}>
        <option value="">Board root</option>
        {otherCards.map(item => <option key={item.ID} value={String(item.ID)}>{item.Title}</option>)}
      </select></label>
      <p className="planning-hint">Parent ideas connect nodes in the Mind Map.</p>
      <details className="planning-dependencies"><summary>Depends on {dependencies.length ? `(${dependencies.length})` : "other tasks"}</summary>
        {otherCards.length === 0 ? <p className="planning-hint">Add another task to create a dependency.</p> : otherCards.map(item => <label className="planning-checkbox" key={item.ID}>
          <input type="checkbox" disabled={!canEdit} checked={dependencies.includes(String(item.ID))} onChange={event => onSave({ dependencies: (event.target.checked ? [...dependencies, String(item.ID)] : dependencies.filter(id => id !== String(item.ID))).join(",") })} />
          <span>{item.Title}</span>
        </label>)}
      </details>
    </section>
    {boardType === "sprint" && <section aria-label="Sprint task settings">
      <h3>Sprint</h3>
      <label>Story points<input aria-label="Story points" type="number" min="0" max="10000" step="1" disabled={!canEdit} defaultValue={card.StoryPoints || 0} key={`${card.ID}-${card.StoryPoints}`} onBlur={event => {
        const value = Number(event.target.value);
        if (Number.isInteger(value) && value >= 0 && value <= 10000 && value !== (card.StoryPoints || 0)) onSave({ storyPoints: String(value) });
      }} /></label>
      <label className="planning-checkbox"><input type="checkbox" checked={!!card.InSprint} disabled={!canEdit} onChange={event => onSave({ inSprint: String(event.target.checked) })} /><span>Include in the current sprint</span></label>
    </section>}
  </div>;
}
