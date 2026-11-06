import { useState } from "react";
import { Trash2, Copy, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
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
  onDelete?: (cardId: string) => void;
  onDuplicate?: (card: Card) => void;
  onCreate: () => void;
};

const BUCKET_LABELS_TH: Record<string, string> = {
  overdue: "เลยกำหนด",
  today: "ครบกำหนดวันนี้",
  upcoming: "ใน 7 วันข้างหน้า",
  later: "หลังจากนั้น",
  none: "ไม่ระบุวันครบกำหนด",
};

export default function BoardTaskViews({ cards, totalCards, columns, swimlanes, canEdit, connected, mode, assignees, onOpen, onMove, onDelete, onDuplicate, onCreate }: Props) {
  const { lang, t } = useLanguage();
  const [sort, setSort] = useState<{ field: "Title" | "List" | "Swimlane" | "StartDate" | "DueDate" | "Assignee"; direction: 1 | -1 }>({ field: "Title", direction: 1 });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkColumn, setBulkColumn] = useState<string>("");

  const sorted = [...cards].sort((a, b) => {
    const aValue = sort.field === "Assignee"
      ? (assignees?.[a.AssigneeID || 0] || "")
      : String(a[sort.field] || "");
    const bValue = sort.field === "Assignee"
      ? (assignees?.[b.AssigneeID || 0] || "")
      : String(b[sort.field] || "");
    if (sort.field === "StartDate" || sort.field === "DueDate" || sort.field === "Assignee") {
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

  const visibleIdSet = new Set(cards.map(c => String(c.ID)));
  const activeSelectedIds = selectedIds.filter(id => visibleIdSet.has(id));
  const allVisibleSelected = cards.length > 0 && activeSelectedIds.length === cards.length;

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(cards.map(c => String(c.ID)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const handleBulkMove = (targetCol: string) => {
    if (!targetCol || !canEdit || !connected) return;
    const selectedCards = cards.filter(c => activeSelectedIds.includes(String(c.ID)));
    selectedCards.forEach(c => onMove(c, targetCol));
    setSelectedIds([]);
    setBulkColumn("");
  };

  const handleBulkDelete = () => {
    if (!onDelete || !canEdit || !connected || activeSelectedIds.length === 0) return;
    if (!window.confirm(t(`Delete ${activeSelectedIds.length} selected task(s)?`, `ยืนยันลบงานที่เลือกทั้งหมด ${activeSelectedIds.length} รายการหรือไม่?`))) return;
    activeSelectedIds.forEach(id => onDelete(id));
    setSelectedIds([]);
  };

  return <main id="board-content" className="task-views" aria-label={mode === "list" ? "Task list" : "Tasks by due date"}>
    {canEdit && connected && activeSelectedIds.length > 0 && (
      <div className="mb-4 px-4 py-2.5 rounded-2xl border border-[#4f63ef]/30 bg-[#eef2ff] dark:bg-[#172033] text-slate-800 dark:text-slate-100 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className="px-2.5 py-1 rounded-lg bg-[#4f63ef] text-white">
            {activeSelectedIds.length} {t("selected", "รายการที่เลือก")}
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 inline-flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer"
          >
            <X size={13} /> {t("Clear", "ยกเลิก")}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("Bulk move to column", "ย้ายที่เลือกไปคอลัมน์")}
            value={bulkColumn}
            onChange={(e) => {
              const col = e.target.value;
              setBulkColumn(col);
              if (col) handleBulkMove(col);
            }}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold cursor-pointer"
          >
            <option value="">{t("Move selected to…", "ย้ายคอลัมน์ที่เลือกไปที่…")}</option>
            {columns.map(col => <option key={col} value={col}>{col}</option>)}
          </select>

          {onDelete && (
            <button
              type="button"
              onClick={handleBulkDelete}
              className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Trash2 size={13} /> {t("Delete selected", "ลบที่เลือก")}
            </button>
          )}
        </div>
      </div>
    )}
    {cards.length === 0 && <div className="task-view-empty"><strong>{totalCards ? t("No matching tasks", "ไม่พบงานที่ตรงกับเงื่อนไข") : t("No tasks yet", "ยังไม่มีงานในบอร์ดนี้")}</strong><p>{totalCards ? t("Try another search or filter.", "ลองเปลี่ยนคำค้นหาหรือตัวกรอง") : t("Add a task to get this board moving.", "กดเพิ่มงานใหม่เพื่อเริ่มต้นใช้งานบอร์ดนี้")}</p>{canEdit && connected && !totalCards && <button onClick={onCreate}>{t("Add a task", "เพิ่มงานใหม่")}</button>}</div>}
    {cards.length > 0 && groups.filter(group => mode === "list" || group.cards.length > 0).map(group => <section key={group.name} className="task-view-group" aria-label={`${group.name}: ${group.cards.length} tasks`}>
      <h3>{group.name} <span>{group.cards.length}</span></h3>
      {group.cards.length === 0 ? <p className="task-view-empty-group">{t("No tasks here", "ไม่มีงานในหมวดนี้")}</p> : <div className="task-view-table-wrap"><table className="task-view-table"><thead><tr>
        {canEdit && connected && (
          <th scope="col" className="w-9 text-center">
            <input
              type="checkbox"
              aria-label={t("Select all tasks", "เลือกงานทั้งหมด")}
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="w-3.5 h-3.5 rounded accent-[#4f63ef] cursor-pointer"
            />
          </th>
        )}
        {([
          ["Title", t("Task", "งาน")],
          ["List", t("Status", "สถานะ")],
          ...(swimlanes.length ? [["Swimlane", t("Group", "กลุ่มงาน")] as const] : []),
          ["StartDate", t("Start", "วันเริ่ม")],
          ["DueDate", t("Due", "กำหนดส่ง")],
          ...(assignees ? [["Assignee", t("Assignee", "ผู้รับผิดชอบ")] as const] : []),
        ] as const).map(([field, label]) => (
          <th key={field} scope="col" aria-sort={mode === "list" && sort.field === field ? sort.direction === 1 ? "ascending" : "descending" : "none"}>
            {mode === "list" ? (
              <button
                className="table-sort-button inline-flex items-center gap-1"
                onClick={() => setSort(current => ({ field, direction: current.field === field && current.direction === 1 ? -1 : 1 }))}
              >
                <span>{label}</span>
                {sort.field === field ? (sort.direction === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-50" />}
              </button>
            ) : label}
          </th>
        ))}
        {canEdit && connected && (onDuplicate || onDelete) && <th scope="col" className="text-right">{t("Actions", "จัดการ")}</th>}
      </tr></thead><tbody>
        {group.cards.map(card => {
          const isChecked = activeSelectedIds.includes(String(card.ID));
          return (
            <tr key={card.ID} className={isChecked ? "bg-[#eef2ff]/60 dark:bg-indigo-950/30" : undefined}>
              {canEdit && connected && (
                <td className="w-9 text-center">
                  <input
                    type="checkbox"
                    aria-label={`Select ${card.Title}`}
                    checked={isChecked}
                    onChange={() => toggleSelectOne(String(card.ID))}
                    className="w-3.5 h-3.5 rounded accent-[#4f63ef] cursor-pointer"
                  />
                </td>
              )}
              <td><button className="task-view-title" aria-label={`Open task: ${card.Title}`} onClick={() => onOpen(card)}><small>TSK-{String(card.ID).padStart(3, "0")}</small><span>{card.Title}</span></button>{card.Tags && <span className="task-view-tags">{card.Tags.split(",").map(tag => tag.trim()).filter(Boolean).join(" · ")}</span>}</td>
              <td><select className={`task-view-status-${/done|published|complete/i.test(card.List) ? "done" : /doing|progress|review/i.test(card.List) ? "active" : "todo"}`} aria-label={`Move ${card.Title} to column`} value={card.List} disabled={!canEdit || !connected} onChange={event => onMove(card, event.target.value)}>{!columns.includes(card.List) && <option value={card.List}>{card.List}</option>}{columns.map(column => <option key={column} value={column}>{column}</option>)}</select></td>
              {swimlanes.length > 0 && <td>{card.Swimlane || swimlanes[0]}</td>}
              <td><span className="task-view-due">{card.StartDate || t("No date", "ไม่ระบุ")}</span></td>
              <td><span className={`task-view-due task-view-due-${dueBucket(card.DueDate)}`}>{card.DueDate || t("No date", "ไม่ระบุ")}</span></td>
              {assignees && <td>{assignees[card.AssigneeID || 0] || (card.AssigneeID ? t("Assigned", "มอบหมายแล้ว") : t("Unassigned", "ยังไม่มอบหมาย"))}</td>}
              {canEdit && connected && (onDuplicate || onDelete) && (
                <td className="text-right whitespace-nowrap">
                  <div className="inline-flex items-center justify-end gap-1">
                    {onDuplicate && (
                      <button
                        type="button"
                        onClick={() => onDuplicate(card)}
                        title={t("Duplicate Task", "คัดลอกงานนี้")}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-[#4f63ef] dark:hover:text-[#a5b4fc] transition-colors cursor-pointer"
                      >
                        <Copy size={13} />
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(String(card.ID))}
                        title={t("Delete Task", "ลบงานนี้")}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          );
        })}
      </tbody></table></div>}
    </section>)}
  </main>;
}
