// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import BoardTaskViews from "../src/components/BoardTaskViews";
import { dueBucket } from "../src/boardDates";
import type { Card } from "../src/useWebSocket";

afterEach(cleanup);

const task: Card = { ID: 7, BoardID: "test", Title: "Review draft", List: "DRAFTING", Swimlane: "Editorial", DueDate: "2026-10-04", Position: 1000 };

it("groups date-only values by local calendar day", () => {
  const today = new Date(2026, 9, 4, 23, 30);
  expect(dueBucket("2026-10-03", today)).toBe("overdue");
  expect(dueBucket("2026-10-04", today)).toBe("today");
  expect(dueBucket("2026-10-11", today)).toBe("upcoming");
  expect(dueBucket("2026-10-12", today)).toBe("later");
  expect(dueBucket("2026-02-30", today)).toBe("none");
});

it("lets an editor move a task from the list and lets a viewer open it without moving it", () => {
  const onMove = vi.fn(), onOpen = vi.fn();
  const props = { cards: [task], totalCards: 1, columns: ["DRAFTING", "REVIEW"], swimlanes: ["Editorial"], connected: true, mode: "list" as const, onOpen, onMove, onCreate: vi.fn() };
  const view = render(<BoardTaskViews {...props} canEdit />);
  fireEvent.change(screen.getByLabelText("Move Review draft to column"), { target: { value: "REVIEW" } });
  expect(onMove).toHaveBeenCalledWith(task, "REVIEW");
  fireEvent.click(screen.getByRole("button", { name: "Open task: Review draft" }));
  expect(onOpen).toHaveBeenCalledWith(task);
  view.rerender(<BoardTaskViews {...props} canEdit={false} />);
  expect((screen.getByLabelText("Move Review draft to column") as HTMLSelectElement).disabled).toBe(true);
});

it("sorts the table by due date across statuses and keeps undated tasks last", () => {
  render(<BoardTaskViews cards={[task, { ...task, ID: 8, Title: "No deadline", List: "REVIEW", DueDate: "" }, { ...task, ID: 9, Title: "Earlier", List: "REVIEW", DueDate: "2026-10-02" }]} totalCards={3} columns={["DRAFTING", "REVIEW"]} swimlanes={[]} connected canEdit mode="list" onOpen={vi.fn()} onMove={vi.fn()} onCreate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Due ↕" }));
  expect(screen.getAllByRole("button", { name: /^Open task:/ }).map(button => button.getAttribute("aria-label"))).toEqual(["Open task: Earlier", "Open task: Review draft", "Open task: No deadline"]);
  fireEvent.click(screen.getByRole("button", { name: "Due ↑" }));
  expect(screen.getAllByRole("button", { name: /^Open task:/ }).map(button => button.getAttribute("aria-label"))).toEqual(["Open task: Review draft", "Open task: Earlier", "Open task: No deadline"]);
});
