import { useState } from "react";
import type { Card } from "../useWebSocket";
import { DUE_BUCKETS, dueBucket } from "../boardDates";
import { useLanguage } from "../useLanguage";

type Props = {
  cards: Card[];
  totalCards: number;
  columns: string[];
  swimlanes: string[];
  canEdit: boolean;
  connected: boolean;
  mode: "list" | "due";
  assignees?: Record<number, string>;
  onOpen: (card: Card) => void;
  onMove: (card: Card, column: string) => void;
  onCreate: () => void;
};

const BUCKET_LABELS_TH: Record<string, string> = {
  overdue: "เลยกำหนด",
  today: "ครบกำหนดวันนี้",
  upcoming: "ใน 7 วันข้างหน้า",
  later: "หลังจากนั้น",
  none: "ไม่ระบุวันครบกำหนด",
};

export default function BoardTaskViews({ cards, totalCards, columns, swimlanes, canEdit, connected, mode, assignees, onOpen, onMove, onCreate }: Props) {
  const { lang, t } = useLanguage();
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
    ? [{ name: t("All tasks", "งานทั้งหมด"), cards: sorted }]
    : DUE_BUCKETS.map(bucket => ({
      name: lang === "th" ? (BUCKET_LABELS_TH[bucket.id] || bucket.label) : bucket.label,
      cards: cards.filter(card => dueBucket(card.DueDate) === bucket.id).sort((a, b) => (a.DueDate || "9999").localeCompare(b.DueDate || "9999") || (a.Position ?? 0) - (b.Position ?? 0)),
    }));

  return <main id="board-content" className="task-views" aria-label={mode === "list" ? "Task list" : "Tasks by due date"}>
    {cards.length === 0 && <div className="task-view-empty"><strong>{totalCards ? t("No matching tasks", "ไม่พบงานที่ตรงกับเงื่อนไข") : t("No tasks yet", "ยังไม่มีงานในบอร์ดนี้")}</strong><p>{totalCards ? t("Try another search or filter.", "ลองเปลี่ยนคำค้นหาหรือตัวกรอง") : t("Add a task to get this board moving.", "กดเพิ่มงานใหม่เพื่อเริ่มต้นใช้งานบอร์ดนี้")}</p>{canEdit && connected && !totalCards && <button onClick={onCreate}>{t("Add a task", "เพิ่มงานใหม่")}</button>}</div>}
    {cards.length > 0 && groups.filter(group => mode === "list" || group.cards.length > 0).map(group => <section key={group.name} className="task-view-group" aria-label={`${group.name}: ${group.cards.length} tasks`}>
      <h3>{group.name} <span>{group.cards.length}</span></h3>
      {group.cards.length === 0 ? <p className="task-view-empty-group">{t("No tasks here", "ไม่มีงานในหมวดนี้")}</p> : <div className="task-view-table-wrap"><table className="task-view-table"><thead><tr>{([
        ["Title", t("Task", "งาน")], ["List", t("Status", "สถานะ")], ...(swimlanes.length ? [["Swimlane", t("Group", "กลุ่มงาน")] as const] : []), ["StartDate", t("Start", "วันเริ่ม")], ["DueDate", t("Due", "กำหนดส่ง")],
      ] as const).map(([field, label]) => <th key={field} scope="col" aria-sort={mode === "list" && sort.field === field ? sort.direction === 1 ? "ascending" : "descending" : "none"}>{mode === "list" ? <button className="table-sort-button" onClick={() => setSort(current => ({ field, direction: current.field === field && current.direction === 1 ? -1 : 1 }))}>{label}{sort.field === field ? sort.direction === 1 ? " ↑" : " ↓" : " ↕"}</button> : label}</th>)}{assignees && <th scope="col">{t("Assignee", "ผู้รับผิดชอบ")}</th>}</tr></thead><tbody>
        {group.cards.map(card => <tr key={card.ID}>
          <td><button className="task-view-title" aria-label={`Open task: ${card.Title}`} onClick={() => onOpen(card)}><small>TSK-{String(card.ID).padStart(3, "0")}</small><span>{card.Title}</span></button>{card.Tags && <span className="task-view-tags">{card.Tags.split(",").map(tag => tag.trim()).filter(Boolean).join(" · ")}</span>}</td>
          <td><select className={`task-view-status-${/done|published|complete/i.test(card.List) ? "done" : /doing|progress|review/i.test(card.List) ? "active" : "todo"}`} aria-label={`Move ${card.Title} to column`} value={card.List} disabled={!canEdit || !connected} onChange={event => onMove(card, event.target.value)}>{!columns.includes(card.List) && <option value={card.List}>{card.List}</option>}{columns.map(column => <option key={column} value={column}>{column}</option>)}</select></td>
          {swimlanes.length > 0 && <td>{card.Swimlane || swimlanes[0]}</td>}
          <td><span className="task-view-due">{card.StartDate || t("No date", "ไม่ระบุ")}</span></td>
          <td><span className={`task-view-due task-view-due-${dueBucket(card.DueDate)}`}>{card.DueDate || t("No date", "ไม่ระบุ")}</span></td>
          {assignees && <td>{assignees[card.AssigneeID || 0] || (card.AssigneeID ? t("Assigned", "มอบหมายแล้ว") : t("Unassigned", "ยังไม่มอบหมาย"))}</td>}
        </tr>)}
      </tbody></table></div>}
    </section>)}
  </main>;
}
