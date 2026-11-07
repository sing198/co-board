import { describe, expect, it } from "vitest";
import { parseBoardCsv, serializeBoardCsv } from "../src/boardCsv";
import type { Card } from "../src/useWebSocket";

const columns = ["To do", "Doing", "Done"];
const swimlanes = ["Product", "Engineering"];

describe("board CSV export and import", () => {
  it.each(["en", "th"] as const)("keeps task titles and supported fields when importing a %s export", (language) => {
    const cards: Card[] = [{
      ID: 42,
      BoardID: "board",
      Title: 'เตรียมงาน, "launch"\nรอบสอง',
      List: "Doing",
      Swimlane: "Engineering",
      StartDate: "2026-11-07",
      DueDate: "2026-11-10",
      Tags: "review,เปิดตัว",
      Description: 'รายละเอียด, "quoted"\r\nบรรทัดถัดไป',
      AssigneeID: 7,
      Checklist: JSON.stringify([{ id: "one", text: "Review", done: true }]),
    }];
    const csv = serializeBoardCsv(cards, (en, th) => language === "th" ? th : en, () => 'Tester, "Name"');

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"TSK-042"');
    expect(csv).toContain(language === "th" ? '"รหัสงาน","ชื่องาน"' : '"Task ID","Title"');
    expect(parseBoardCsv(csv, columns, swimlanes)).toEqual([{
      title: cards[0].Title,
      column: "Doing",
      swimlane: "Engineering",
      startDate: "2026-11-07",
      dueDate: "2026-11-10",
      tags: "review,เปิดตัว",
      description: cards[0].Description,
    }]);
  });

  it("recognizes shuffled English columns without using the task ID or assignee name as the title", () => {
    const csv = "Task ID,Assignee Name,Description,Task Title,Status,Group,Start Date,Due Date,Tags\nTSK-009,Someone,Details,Actual title,doing,engineering,2026-11-07,2026-11-08,review";

    expect(parseBoardCsv(csv, columns, swimlanes)).toEqual([{
      title: "Actual title",
      column: "Doing",
      swimlane: "Engineering",
      startDate: "2026-11-07",
      dueDate: "2026-11-08",
      tags: "review",
      description: "Details",
    }]);
  });

  it("recognizes shuffled Thai columns without using the group or task ID as the title", () => {
    const csv = "กลุ่มงาน,รหัสงาน,รายละเอียด,ชื่องาน,คอลัมน์ / สถานะ,วันครบกำหนด,วันเริ่มต้น,แท็ก\nEngineering,TSK-009,รายละเอียดงาน,ชื่อจริง,Doing,2026-11-08,2026-11-07,ทดสอบ";

    expect(parseBoardCsv(csv, columns, swimlanes)).toEqual([{
      title: "ชื่อจริง",
      column: "Doing",
      swimlane: "Engineering",
      startDate: "2026-11-07",
      dueDate: "2026-11-08",
      tags: "ทดสอบ",
      description: "รายละเอียดงาน",
    }]);
  });

  it("preserves imports with decorated status, schedule, tags and description headers", () => {
    const csv = "Task ID,Title,Workflow Status,Team Swimlane,Start Date (YYYY-MM-DD),Due Date (YYYY-MM-DD),Task Tags,Task Description\nTSK-009,Actual title,Doing,Engineering,2026-11-07,2026-11-08,review,Details";

    expect(parseBoardCsv(csv, columns, swimlanes)).toEqual([{
      title: "Actual title",
      column: "Doing",
      swimlane: "Engineering",
      startDate: "2026-11-07",
      dueDate: "2026-11-08",
      tags: "review",
      description: "Details",
    }]);
  });

  it.each(["Title", "Task", "Name", "Task Name", "Task Title", "ชื่องาน", "ชื่อ", "ชื่อเรื่อง", "งาน", "หัวข้อ"])("accepts the explicit title header %s", (header) => {
    expect(parseBoardCsv(`Task ID,${header}\nTSK-001,Actual title`, columns, swimlanes)[0].title).toBe("Actual title");
  });

  it.each(["Task_Name", "Task-Title"])("normalizes separators in the title header %s", (header) => {
    expect(parseBoardCsv(`Task ID,${header}\nTSK-001,Actual title`, columns, swimlanes)[0].title).toBe("Actual title");
  });

  it("matches title headers regardless of capitalization or surrounding whitespace", () => {
    expect(parseBoardCsv("Task ID,  tItLe  \nTSK-001,Actual title", columns, swimlanes)[0].title).toBe("Actual title");
  });

  it.each(["ID", "Task ID", "รหัส", "รหัสงาน"])("keeps positional imports after a leading %s column", (idHeader) => {
    expect(parseBoardCsv(`${idHeader},Summary\nTSK-001,Actual title`, columns, swimlanes)[0].title).toBe("Actual title");
  });

  it("keeps positional imports with an unrecognized first header", () => {
    expect(parseBoardCsv("Summary,Status\nActual title,Done", columns, swimlanes)[0]).toMatchObject({ title: "Actual title", column: "Done" });
  });

  it("skips empty task titles and defaults unknown destinations without altering valid data", () => {
    const csv = 'Title,Status,Group,Start Date,Due Date,Description\r\n"",Doing,Product,,,Skip this row\r\nKept,Missing,Missing,07/11/2026,2026-11-10,Details\r\n\r\n';

    expect(parseBoardCsv(csv, columns, swimlanes)).toEqual([{
      title: "Kept",
      column: "To do",
      swimlane: "Product",
      startDate: "",
      dueDate: "2026-11-10",
      tags: "",
      description: "Details",
    }]);
    expect(parseBoardCsv("Title\nKept", [], [])[0]).toMatchObject({ column: "To do", swimlane: "Untitled" });
  });

  it("imports at most 50 tasks from a larger file", () => {
    const csv = ["Task ID,Title", ...Array.from({ length: 55 }, (_, index) => `TSK-${index + 1},Task ${index + 1}`)].join("\n");
    const tasks = parseBoardCsv(csv, columns, swimlanes);

    expect(tasks).toHaveLength(50);
    expect(tasks[0].title).toBe("Task 1");
    expect(tasks[49].title).toBe("Task 50");
  });

  it("ignores files without data rows", () => {
    expect(parseBoardCsv("", columns, swimlanes)).toEqual([]);
    expect(parseBoardCsv("\uFEFFTitle,Status\r\n", columns, swimlanes)).toEqual([]);
  });
});
