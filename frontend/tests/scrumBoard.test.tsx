// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ScrumBoard from "../src/components/ScrumBoard";

afterEach(cleanup);

const cards = [
  { ID: 1, BoardID: "board", Title: "Write spec", List: "BACKLOG", InSprint: false, StoryPoints: 0 },
  { ID: 2, BoardID: "board", Title: "Build feature", List: "IN PROGRESS", InSprint: true, StoryPoints: 5 },
  { ID: 3, BoardID: "board", Title: "Review feature", List: "DONE", InSprint: true, StoryPoints: 3 },
];

function callbacks() {
  return { onOpen: vi.fn(), onMove: vi.fn(), onEdit: vi.fn(), onUpdateSprint: vi.fn(), onCreate: vi.fn() };
}

it("saves a valid sprint setup before allowing the sprint to start", () => {
  const handlers = callbacks();
  const props = { cards, columns: ["BACKLOG", "IN PROGRESS", "DONE"], sprint: { name: "Sprint 1", start: "", end: "", status: "planning" }, canEdit: true, connected: true, ...handlers };
  const view = render(<ScrumBoard {...props} />);
  expect((screen.getByRole("button", { name: "Start sprint" }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(screen.getByLabelText("Sprint start date"), { target: { value: "2026-10-05" } });
  fireEvent.change(screen.getByLabelText("Sprint end date"), { target: { value: "2026-10-12" } });
  expect((screen.getByRole("button", { name: "Start sprint" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save setup" }));
  expect(handlers.onUpdateSprint).toHaveBeenCalledWith({ name: "Sprint 1", start: "2026-10-05", end: "2026-10-12" });

  view.rerender(<ScrumBoard {...props} sprint={{ name: "Sprint 1", start: "2026-10-05", end: "2026-10-12", status: "planning" }} />);
  expect((screen.getByRole("button", { name: "Start sprint" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Start sprint" }));
  expect(handlers.onUpdateSprint).toHaveBeenLastCalledWith({ status: "active" });
});

it("shows backlog and active sprint work with real task actions and progress", () => {
  const handlers = callbacks();
  render(<ScrumBoard cards={cards} columns={["BACKLOG", "IN PROGRESS", "DONE"]} sprint={{ name: "Sprint 1", start: "2026-10-05", end: "2026-10-12", status: "active" }} canEdit connected {...handlers} />);

  expect(screen.getByRole("region", { name: "Product backlog" }).textContent).toContain("Write spec");
  expect(screen.getByRole("region", { name: "Sprint tasks" }).textContent).toContain("Build feature");
  expect(screen.getByText("3 / 8")).toBeTruthy();
  expect(screen.getByText("Progress · 50%")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Add to sprint" }));
  expect(handlers.onEdit).toHaveBeenCalledWith(cards[0], { inSprint: true });
  fireEvent.change(screen.getByLabelText("Move Build feature to column"), { target: { value: "DONE" } });
  expect(handlers.onMove).toHaveBeenCalledWith(cards[1], "DONE");
  fireEvent.change(screen.getByLabelText("Estimate Build feature"), { target: { value: "8" } });
  expect(handlers.onEdit).toHaveBeenCalledWith(cards[1], { storyPoints: 8 });
  fireEvent.click(screen.getByRole("button", { name: "Build feature" }));
  expect(handlers.onOpen).toHaveBeenCalledWith(cards[1]);

  fireEvent.click(screen.getByRole("button", { name: "Complete sprint" }));
  expect(handlers.onUpdateSprint).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm finish" }));
  expect(handlers.onUpdateSprint).toHaveBeenCalledWith({ status: "completed" });
});

it("keeps viewer and disconnected sessions read-only", () => {
  const handlers = callbacks();
  const props = { cards, columns: ["BACKLOG", "DONE"], sprint: { name: "Sprint 1", start: "2026-10-05", end: "2026-10-12", status: "planning" as const }, ...handlers };
  const view = render(<ScrumBoard {...props} canEdit={false} connected />);
  expect((screen.getByLabelText("Sprint name") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Start sprint" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Add to sprint" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "New task" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Write spec" }));
  expect(handlers.onOpen).toHaveBeenCalledWith(cards[0]);
  expect(handlers.onUpdateSprint).not.toHaveBeenCalled();

  view.rerender(<ScrumBoard {...props} canEdit connected={false} />);
  expect((screen.getByRole("button", { name: "Start sprint" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Add to sprint" }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps sprint progress based on every task while a board filter narrows visible tasks", () => {
  const handlers = callbacks();
  render(<ScrumBoard cards={[cards[1]]} allCards={cards} columns={["BACKLOG", "IN PROGRESS", "DONE"]} sprint={{ name: "Sprint 1", start: "2026-10-05", end: "2026-10-12", status: "active" }} canEdit connected {...handlers} />);
  expect(screen.getByText("tasks in sprint").previousElementSibling?.textContent).toBe("2");
  expect(screen.getByText("3 / 8")).toBeTruthy();
  expect(screen.getByText("Progress · 50%")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Sprint tasks" }).textContent).toContain("Build feature");
  expect(screen.getByRole("region", { name: "Sprint tasks" }).textContent).not.toContain("Review feature");
});

it("waits for the sprint save acknowledgement before enabling start", () => {
  render(<ScrumBoard cards={cards} columns={["TODO", "DONE"]} sprint={{ name: "Sprint 1", start: "2026-10-05", end: "2026-10-12", status: "planning" }} canEdit connected saving {...callbacks()} />);
  expect((screen.getByRole("button", { name: "Start sprint" }) as HTMLButtonElement).disabled).toBe(true);
});
