import type { Card } from "../useWebSocket";
import { DUE_BUCKETS, dueBucket } from "../boardDates";

type Props = {
  cards: Card[];
  totalCards: number;
  columns: string[];
  swimlanes: string[];
  canEdit: boolean;
  connected: boolean;
  mode: "list" | "due";
  onOpen: (card: Card) => void;
  onMove: (card: Card, column: string) => void;
  onCreate: () => void;
};

export default function BoardTaskViews({ cards, totalCards, columns, swimlanes, canEdit, connected, mode, onOpen, onMove, onCreate }: Props) {
  const [sort, setSort] = useState<{ field: "Title" | "List" | "Swimlane" | "StartDate" | "DueDate"; direction: 1 | -1 }>({ field: "Title", direction: 1 });
  const sorted = [...cards].sort((a, b) => {
    const aValue = String(a[sort.field] || ""), bValue = String(b[sort.field] || "");
    if (sort.field === "StartDate" || sort.field === "DueDate") {
      if (!aValue && bValue) return 1;
      if (aValue && !bValue) return -1;
    }
    return aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: "base" }) * sort.direction || a.ID - b.ID;
  });
  const groups = mode === "list"
    ? [{ name: "All tasks", cards: sorted }]
    : DUE_BUCKETS.map(bucket => ({
      name: bucket.label,
      cards: cards.filter(card => dueBucket(card.DueDate) === bucket.id).sort((a, b) => (a.DueDate || "9999").localeCompare(b.DueDate || "9999") || (a.Position ?? 0) - (b.Position ?? 0)),
    }));

  return <main id="board-content" className="task-views" aria-label={mode === "list" ? "Task list" : "Tasks by due date"}>
    {cards.length === 0 && <div className="task-view-empty"><strong>{totalCards ? "No matching tasks" : "No tasks yet"}</strong><p>{totalCards ? "Try another search or filter." : "Add a task to get this board moving."}</p>{canEdit && connected && !totalCards && <button onClick={onCreate}>Add a task</button>}</div>}
    {cards.length > 0 && groups.filter(group => mode === "list" || group.cards.length > 0).map(group => <section key={group.name} className="task-view-group" aria-label={`${group.name}: ${group.cards.length} tasks`}>
      <h3>{group.name} <span>{group.cards.length}</span></h3>
      {group.cards.length === 0 ? <p className="task-view-empty-group">No tasks here</p> : <div className="task-view-table-wrap"><table className="task-view-table"><thead><tr>{([
        ["Title", "Task"], ["List", "Status"], ["Swimlane", "Swimlane"], ["StartDate", "Start"], ["DueDate", "Due"],
      ] as const).map(([field, label]) => <th key={field} scope="col" aria-sort={mode === "list" && sort.field === field ? sort.direction === 1 ? "ascending" : "descending" : "none"}>{mode === "list" ? <button className="table-sort-button" onClick={() => setSort(current => ({ field, direction: current.field === field && current.direction === 1 ? -1 : 1 }))}>{label}{sort.field === field ? sort.direction === 1 ? " ↑" : " ↓" : " ↕"}</button> : label}</th>)}</tr></thead><tbody>
        {group.cards.map(card => <tr key={card.ID}>
          <td><button className="task-view-title" aria-label={`Open task: ${card.Title}`} onClick={() => onOpen(card)}><small>TSK-{String(card.ID).padStart(3, "0")}</small><span>{card.Title}</span></button>{card.Tags && <span className="task-view-tags">{card.Tags.split(",").map(tag => tag.trim()).filter(Boolean).join(" · ")}</span>}</td>
          <td><select aria-label={`Move ${card.Title} to column`} value={card.List} disabled={!canEdit || !connected} onChange={event => onMove(card, event.target.value)}>{!columns.includes(card.List) && <option value={card.List}>{card.List}</option>}{columns.map(column => <option key={column} value={column}>{column}</option>)}</select></td>
          <td>{swimlanes.length ? card.Swimlane || swimlanes[0] : "—"}</td>
          <td><span className="task-view-due">{card.StartDate || "No date"}</span></td>
          <td><span className={`task-view-due task-view-due-${dueBucket(card.DueDate)}`}>{card.DueDate || "No date"}</span></td>
        </tr>)}
      </tbody></table></div>}
    </section>)}
  </main>;
}
import { useState } from "react";
