import type { ReactNode } from "react";
import { LayoutDashboard, Layers3, ArrowUpRight, Sparkles, LogOut } from "lucide-react";
import { useLanguage } from "../useLanguage";

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
  const { t } = useLanguage();
  return <button className="workspace-logo" onClick={onClick} aria-label={t("co-board workspace", "พื้นที่ทำงาน co-board")}><KanbanMark /><span>co-board</span></button>;
}

export default function WorkspaceSidebar({ user, activePage, onAllBoards, onOverview, role, boardCount, cardCount, boardFilter, note, children, onLogout }: Props) {
  const { t } = useLanguage();
  const allBoardsActive = activePage === "dashboard" && (boardFilter ?? "all") === "all";
  return (
    <aside className="workspace-sidebar" aria-label={t("Workspace navigation", "เมนูพื้นที่ทำงาน")}>
      <WorkspaceLogo onClick={onOverview} />
      <div className="workspace-switcher"><span className="workspace-avatar">{user?.name?.[0] || "K"}</span><div><strong>{t("My workspace", "พื้นที่ทำงานของฉัน")}</strong><small>{user?.email === "guest@kanban.demo" ? t("Guest session", "โหมดทดลองใช้ (Guest)") : t("Personal workspace", "พื้นที่ทำงานส่วนตัว")}</small></div></div>
      <div className="sidebar-section-label">{t("WORKSPACE", "พื้นที่ทำงาน")}</div>
      <button className={`sidebar-nav ${allBoardsActive ? "active" : ""}`} onClick={onAllBoards} aria-current={allBoardsActive ? "page" : undefined}><LayoutDashboard size={17} /> {t("All boards", "บอร์ดทั้งหมด")} {activePage === "dashboard" ? <span title={t("Number of boards", "จำนวนบอร์ด")}>{boardCount}</span> : <ArrowUpRight size={14} />}</button>
      {activePage === "board" && <button className="sidebar-nav active" onClick={() => document.getElementById("board-content")?.scrollIntoView({ block: "start" })} aria-current="page"><Layers3 size={17} /> {t("Current board", "บอร์ดปัจจุบัน")} <span title={t("Number of tasks", "จำนวนงาน")}>{cardCount}</span></button>}
      {children}
      <div className="sidebar-bottom">
        <div className="workspace-note"><span className="workspace-note-icon"><Sparkles size={16} /></span><strong>{t("Workspace tips", "เคล็ดลับการใช้งาน")}</strong><p>{note || t("Drag a card to move it. Click a card to add details.", "ลากการ์ดเพื่อย้ายคอลัมน์ หรือคลิกที่การ์ดเพื่อดูและแก้ไขรายละเอียด")}</p></div>
        <div className="sidebar-profile"><span className="workspace-avatar">{user?.name?.[0] || "V"}</span><div><strong>{user?.name || t("Visitor", "ผู้เยี่ยมชม")}</strong><small>{role}</small></div>{user && onLogout && <button className="workspace-icon-button sidebar-logout" onClick={onLogout} aria-label={t("Logout", "ออกจากระบบ")} title={t("Logout", "ออกจากระบบ")}><LogOut size={16} /></button>}</div>
      </div>
    </aside>
  );
}
