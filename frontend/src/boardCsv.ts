import type { Card } from "./useWebSocket";

export type ImportedCsvTask = {
  title: string;
  column: string;
  swimlane: string;
  startDate: string;
  dueDate: string;
  tags: string;
  description: string;
};

export function serializeBoardCsv(
  cards: readonly Card[],
  t: (en: string, th: string) => string,
  getAssigneeName: (id: number) => string = () => "",
): string {
  const escapeCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const headers = [
    t("Task ID", "รหัสงาน"),
    t("Title", "ชื่องาน"),
    t("Column / Status", "คอลัมน์ / สถานะ"),
    t("Group", "กลุ่มงาน"),
    t("Assignee", "ผู้รับผิดชอบ"),
    t("Start Date", "วันเริ่มต้น"),
    t("Due Date", "วันครบกำหนด"),
    t("Tags", "แท็ก"),
    t("Checklist", "รายการย่อย"),
    t("Description", "รายละเอียด"),
  ];
  const rows = cards.map((card) => {
    let checklistSummary = "";
    try {
      const items: unknown = JSON.parse(card.Checklist || "[]");
      if (Array.isArray(items) && items.length) {
        checklistSummary = `${items.filter((item) => item?.done).length}/${items.length}`;
      }
    } catch {
      // Invalid checklist data is left blank, as in the board export.
    }
    return [
      `TSK-${String(card.ID).padStart(3, "0")}`,
      card.Title || "",
      card.List || "",
      card.Swimlane && card.Swimlane !== "Untitled" ? card.Swimlane : "",
      getAssigneeName(Number(card.AssigneeID || 0)),
      card.StartDate || "",
      card.DueDate || "",
      card.Tags || "",
      checklistSummary,
      card.Description || "",
    ];
  });
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

export function parseBoardCsv(
  text: string,
  columns: readonly string[],
  swimlanes: readonly string[],
): ImportedCsvTask[] {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];
  const header = rows[0].map(normalizeHeader);
  const findColumn = (pattern: RegExp) => header.findIndex((name) => pattern.test(name));
  // Match whole header names: "Task ID", "Assignee Name" and "กลุ่มงาน"
  // must never be mistaken for the task title.
  const titleIndex = findColumn(/^(title|task|name|task name|task title|ชื่องาน|ชื่อ|ชื่อเรื่อง|งาน|หัวข้อ)$/);
  const effectiveTitleIndex = titleIndex >= 0 ? titleIndex : (header[0]?.includes("id") || header[0]?.includes("รหัส") ? 1 : 0);
  const statusIndex = findColumn(/column|status|list|คอลัมน์|สถานะ/);
  const groupIndex = findColumn(/group|swimlane|กลุ่มงาน/);
  const startIndex = findColumn(/start|วันเริ่ม/);
  const dueIndex = findColumn(/due|กำหนดส่ง|วันครบกำหนด/);
  const tagsIndex = findColumn(/tag|แท็ก/);
  const descriptionIndex = findColumn(/desc|รายละเอียด/);
  const dateValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

  return rows.slice(1, 51).flatMap((row) => {
    const title = (row[effectiveTitleIndex] || "").trim();
    if (!title) return [];
    const valueAt = (index: number) => (row[index] || "").trim();
    const column = columns.find((name) => name.toLowerCase() === valueAt(statusIndex).toLowerCase()) || columns[0] || "To do";
    const swimlane = swimlanes.find((name) => name.toLowerCase() === valueAt(groupIndex).toLowerCase()) || swimlanes[0] || "Untitled";
    return [{
      title,
      column,
      swimlane,
      startDate: dateValue(valueAt(startIndex)),
      dueDate: dateValue(valueAt(dueIndex)),
      tags: valueAt(tagsIndex),
      description: valueAt(descriptionIndex),
    }];
  });
}
