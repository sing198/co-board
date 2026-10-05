// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TaskPlanningFields from "../src/components/TaskPlanningFields";
import CreateTaskDialog from "../src/components/CreateTaskDialog";
import type { Card } from "../src/useWebSocket";

afterEach(cleanup);
const task: Card = { ID: 1, BoardID: "test", Title: "Plan launch", List: "TODO", StartDate: "2026-10-05", DueDate: "2026-10-09" };

it("rejects reversed dates and sends a schedule as one change", () => {
  const onSave = vi.fn();
  render(<TaskPlanningFields card={task} cards={[task]} canEdit boardType="timeline" onSave={onSave} />);
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-10" } });
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("on or after");
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-12" } });
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  expect(onSave).toHaveBeenCalledWith({ startDate: "2026-10-10", dueDate: "2026-10-12" });
});

it("keeps relationships read-only for viewers and never offers a task as its own parent", () => {
  render(<TaskPlanningFields card={task} cards={[task, { ...task, ID: 2, Title: "Design" }]} canEdit={false} boardType="mindmap" onSave={vi.fn()} />);
  const parent = screen.getByLabelText("Parent idea") as HTMLSelectElement;
  expect(parent.disabled).toBe(true);
  expect(Array.from(parent.options).map(option => option.value)).toEqual(["", "2"]);
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
});

it("creates a task on the clicked calendar date without losing the parent context", () => {
  const onSave = vi.fn();
  render(<CreateTaskDialog columns={["IDEAS", "DRAFTING"]} initial={{ dueDate: "2026-10-07", parentId: "2" }} parentName="Launch" idea={false} connected onClose={vi.fn()} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText("New task title"), { target: { value: "  Publish preview  " } });
  fireEvent.change(screen.getByLabelText("New task status"), { target: { value: "DRAFTING" } });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  expect(onSave).toHaveBeenCalledWith("Publish preview", "DRAFTING", { startDate: "", dueDate: "2026-10-07", parentId: "2" });
});

it("blocks new tasks while disconnected", () => {
  const onSave = vi.fn();
  render(<CreateTaskDialog columns={["TODO"]} initial={{}} idea={false} connected={false} onClose={vi.fn()} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText("New task title"), { target: { value: "A task" } });
  const submit = screen.getByRole("button", { name: "Create task" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.submit(screen.getByRole("dialog"));
  expect(onSave).not.toHaveBeenCalled();
});

it("preserves an unsent schedule so reconnecting can retry it", () => {
  const onSave = vi.fn().mockReturnValue(false);
  render(<TaskPlanningFields card={task} cards={[task]} canEdit boardType="timeline" onSave={onSave} />);
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-12" } });
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  expect((screen.getByRole("button", { name: "Save schedule" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-10-12");
  expect(screen.getByRole("alert").textContent).toContain("Reconnect");
});

it("keeps a new task draft when the socket rejects the send", () => {
  render(<CreateTaskDialog columns={["TODO"]} initial={{}} idea={false} connected onClose={vi.fn()} onSave={vi.fn().mockReturnValue(false)} />);
  fireEvent.change(screen.getByLabelText("New task title"), { target: { value: "Keep my draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  expect((screen.getByLabelText("New task title") as HTMLInputElement).value).toBe("Keep my draft");
  expect(screen.getByRole("alert").textContent).toContain("draft is still here");
});
