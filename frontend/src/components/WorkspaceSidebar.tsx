import type { ReactNode } from "react";
import { LayoutDashboard, Layers3, ArrowUpRight, Sparkles, LogOut } from "lucide-react";

type Props = {
  user: { name: string; email: string } | null;
  activePage: "dashboard" | "board";
  onAllBoards: () => void;
  onOverview: () => void;
  role: string;
  onLogout?: () => void;
  boardCount?: number;
  cardCount?: number;
  boardFilter?: "all" | "my" | "shared" | "starred";
  note?: string;
  children?: ReactNode;
};

export function KanbanMark() {
  return <span className="kanban-mark" aria-hidden="true"><span /><span /><span /></span>;
}

export function WorkspaceLogo({ onClick }: { onClick: () => void }) {
  return <button className="workspace-logo" onClick={onClick} aria-label="co-board workspace"><KanbanMark />co-board</button>;
}

export default function WorkspaceSidebar({ user, activePage, onAllBoards, onOverview, role, boardCount, cardCount, boardFilter, note, children, onLogout }: Props) {
  const allBoardsActive = activePage === "dashboard" && (boardFilter ?? "all") === "all";
  return (
    <aside className="workspace-sidebar" aria-label="Workspace navigation">
      <WorkspaceLogo onClick={onOverview} />
      <div className="workspace-switcher"><span className="workspace-avatar">{user?.name?.[0] || "K"}</span><div><strong>My workspace</strong><small>{user?.email === "guest@kanban.demo" ? "Guest session" : "Personal workspace"}</small></div></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <button className={`sidebar-nav ${allBoardsActive ? "active" : ""}`} onClick={onAllBoards} aria-current={allBoardsActive ? "page" : undefined}><LayoutDashboard size={17} /> All boards {activePage === "dashboard" ? <span title="Number of boards">{boardCount} {boardCount === 1 ? "board" : "boards"}</span> : <ArrowUpRight size={14} />}</button>
      {activePage === "board" && <button className="sidebar-nav active" onClick={() => document.getElementById("board-content")?.scrollIntoView({ block: "start" })} aria-current="page"><Layers3 size={17} /> Current board <span title="Number of tasks">{cardCount} {cardCount === 1 ? "task" : "tasks"}</span></button>}
      {children}
      <div className="sidebar-bottom">
        <div className="workspace-note"><Sparkles size={18} /><strong>New here?</strong><p>{note || "Drag a card to move it. Click a card to add details."}</p></div>
        <div className="sidebar-profile"><span className="workspace-avatar">{user?.name?.[0] || "V"}</span><div><strong>{user?.name || "Visitor"}</strong><small>{role}</small></div>{user && onLogout && <button className="workspace-icon-button sidebar-logout" onClick={onLogout} aria-label="Logout" title="Logout"><LogOut size={16} /></button>}</div>
      </div>
    </aside>
  );
}
