import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { localDate } from "../boardDates";
import "./taskPlanning.css";

export type NewTaskDetails = { dueDate?: string; startDate?: string; parentId?: string };
type Props = {
  columns: string[];
  initial: NewTaskDetails;
  parentName?: string;
  idea: boolean;
  connected: boolean;
  onClose: () => void;
  onSave: (title: string, column: string, details: NewTaskDetails) => boolean | void;
};

export default function CreateTaskDialog({ columns, initial, parentName, idea, connected, onClose, onSave }: Props) {
  const [title, setTitle] = useState("");
  const [column, setColumn] = useState(columns[0] || "");
  const [start, setStart] = useState(initial.startDate || "");
  const [end, setEnd] = useState(initial.dueDate || "");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector("input")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="planning-dialog-backdrop" onClick={onClose}>
    <form ref={dialog} className="planning-dialog" role="dialog" aria-modal="true" aria-label={idea ? "New idea" : "New task"} onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)") || []);
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    }} onSubmit={event => {
      event.preventDefault();
      if (!connected || !title.trim() || !column) return;
      if ((start && !localDate(start)) || (end && !localDate(end))) { setError("Enter valid calendar dates."); return; }
      if (start && end && start > end) { setError("The end date must be on or after the start date."); return; }
      if (onSave(title.trim(), column, { ...initial, startDate: start, dueDate: end }) === false) setError("Could not send this task. Your draft is still here; reconnect and try again.");
    }}>
      <div className="planning-dialog-heading"><h2>{idea ? "New idea" : "New task"}</h2><button type="button" aria-label="Close new task" onClick={onClose}><X size={18} /></button></div>
      <p className="planning-hint">{idea ? "Name the idea. You can branch from it on the map." : "A short name is enough. Dates are optional, and you can drag the card into another column later."}</p>
      {parentName && <p className="planning-hint">Branch of <strong>{parentName}</strong></p>}
      <label>{idea ? "Idea" : "Task title"}<input aria-label="New task title" value={title} onChange={event => setTitle(event.target.value)} placeholder={idea ? "What would you like to explore?" : "What needs to be done?"} required maxLength={10000} /></label>
      {!idea && <><label>Status<select aria-label="New task status" value={column} onChange={event => setColumn(event.target.value)}>{columns.map(item => <option key={item}>{item}</option>)}</select></label>
        <div className="planning-date-row"><label>Start date<input aria-label="New task start date" type="date" value={start} onInput={event => setStart(event.currentTarget.value)} onChange={event => setStart(event.target.value)} /></label><label>Due date<input aria-label="New task due date" type="date" value={end} onInput={event => setEnd(event.currentTarget.value)} onChange={event => setEnd(event.target.value)} /></label></div></>}
      {error && <p role="alert" className="planning-error">{error}</p>}
      {!connected && <p role="status" className="planning-error">Reconnect before adding a task.</p>}
      <div className="planning-dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="planning-primary" type="submit" disabled={!title.trim() || !column || !connected}>{idea ? "Add idea" : "Create task"}</button></div>
    </form>
  </div>;
}
