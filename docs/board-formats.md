# Board formats

The format selected in **New board** controls the initial workspace, rather than just renaming Kanban columns. All formats share task data, permissions, save feedback and live collaboration. Changing the view does not copy or delete tasks.

| Format | Initial workspace | Main workflow |
| --- | --- | --- |
| Kanban | Status columns and swimlanes | Drag tasks through a continuous workflow. |
| Table / To-do | Sortable rows | Sort by title, status, swimlane, start or due date; move a task with its status selector. |
| Calendar / Content | Month grid | Navigate months and add a task on a specific due date. Tasks without due dates stay in Unscheduled. |
| Timeline / Gantt | Date axis and duration bars | Set start and due dates, switch week/month scale, and connect prerequisite tasks with dependency arrows. |
| Mind Map | Board root with branching nodes | Add an idea, add a child idea, or choose a parent in task details. |
| Scrum | Sprint setup, backlog and sprint scope | Save sprint name/dates, select tasks, estimate points, start the sprint, move work through statuses and confirm completion. |

## Scheduling and relationships

Open a task to edit its schedule. **Save schedule** sends both dates together so moving an entire range does not temporarily produce an invalid end-before-start value. Clearing dates returns the task to Unscheduled. A task with only one date is shown as a single-day item in Timeline.

Choose **Parent idea** to connect a Mind Map node. Choose **Depends on** to connect a prerequisite in Timeline. The backend rejects missing references, references to another board, self references and circular relationships. Deleting a task clears references to that task and refreshes connected clients.

## Sprint behavior

Sprint setup is editable while planning. The start action requires a saved name and valid date range. Tasks outside the sprint stay in the product backlog. Progress counts and story points include the entire sprint; search only filters the displayed tasks. Completed sprints disable scope and estimate controls in the sprint workspace.

This version stores one sprint per board. It does not provide a multi-sprint archive, velocity or burndown reports. Tasks remain ordinary shared tasks and can still be edited in the other views; completing a sprint does not lock the entire board.

## Current limits

- Dependency links show ordering relationships; they do not automatically move dates or calculate a critical path.
- Calendar uses a task's due date, rather than rendering a multi-day event.
- Mind Map supports a single parent per idea. It is a branching plan rather than a freeform whiteboard.
- Creating a board starts with empty tasks. The existing demo remains a separate populated example.
- New fields are added through the existing GORM migration. Run the updated backend before testing the updated frontend; a frontend-only deploy cannot persist the new planning fields.

## Local validation — 5 October 2026

- Frontend: 45 regression tests passed with `npm test -- --maxWorkers=1`; TypeScript and the production build passed. A single worker avoids test timeouts on the local machine while browser previews are running.
- Backend: `go test ./...` passed, including metadata validation, permission checks, sprint lifecycle, REST payloads and WebSocket broadcasts.
- Browser: created Calendar, Timeline, Mind Map, Scrum, Table and Content boards and confirmed their initial views. Checked date-based creation, cross-status table sorting, parent/child ideas, dependencies, sprint progress and completion, and persistence after page reload.
- Collaboration: a second tab received a schedule change without reloading; a viewer could open details but could not edit planning fields.
- Responsive checks: Calendar, Timeline, Mind Map and Scrum were checked at a 390-pixel viewport; Calendar's page overflow was corrected. Desktop layouts were checked at 1280 pixels.

These checks used the local backend with SQLite. They do not verify the new fields on the hosted PostgreSQL deployment or data persistence after a backend restart.

The visual formats follow the distinctions described in [Kanban Tool's visual management examples](https://kanbantool.com/visual-management-board-examples).
