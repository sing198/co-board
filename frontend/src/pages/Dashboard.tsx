import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../useAuth";
import { useTheme } from "../useTheme";
import { useLanguage } from "../useLanguage";
import { Link, useNavigate } from "react-router-dom";
import {
  LogOut,
  Plus,
  Sparkles,
  Edit2,
  Trash2,
  Search,
  Star,
  FolderKanban,
  Layers3,
  LayoutGrid,
  List as ListIcon,
  Sun,
  Moon,
  Bell,
  X,
  Check,
  Calendar,
  GanttChart,
  Network,
  Timer,
  Zap,
  ArrowRight,
  FileText,
  CheckCircle2,
  LayoutDashboard
} from "lucide-react";
import { API_URL } from "../config";
import WorkspaceSidebar, { KanbanMark } from "../components/WorkspaceSidebar";
import { BoardFormatPreview } from "../components/BoardCanvasViews";
import { useNotifications } from "../useNotifications";
import AssignmentNotices from "../components/AssignmentNotices";
import { dueBucket } from "../boardDates";

type UserPresence = {
  id: number;
  name: string;
  avatarUrl: string;
  email?: string;
};

type Board = {
  ID: string;
  Name: string;
  Type?: string;
  Cards: any[];
  OwnerID?: number;
  IsOwner?: boolean;
  OnlineUsers?: UserPresence[];
};

export const BOARD_TYPES = [
  { id: "kanban", label: "Kanban", labelTh: "บอร์ดแคนบาน", hint: "Move work through visual stages", hintTh: "ย้ายการ์ดงานตามขั้นตอนอย่างชัดเจน", category: "Agile & Flow", categoryTh: "งานทีม & ขั้นตอน", defaultName: "Team Kanban Flow", icon: LayoutDashboard },
  { id: "sprint", label: "Scrum", labelTh: "สปรินต์ (Scrum)", hint: "Plan a backlog and track a sprint", hintTh: "วางแผน Backlog และติดตามงานในแต่ละรอบสปรินต์", category: "Agile & Flow", categoryTh: "งานทีม & ขั้นตอน", defaultName: "Sprint 1", icon: Timer },
  { id: "timeline", label: "Timeline", labelTh: "ไทม์ไลน์ (Gantt)", hint: "Plan work across date ranges & dependencies", hintTh: "วางแผนช่วงเวลาของงานและความเชื่อมโยง", category: "Roadmap & Planning", categoryTh: "แผนงาน & ปฏิทิน", defaultName: "Product Roadmap", icon: GanttChart },
  { id: "calendar", label: "Calendar", labelTh: "ปฏิทิน", hint: "See work on its due date", hintTh: "ดูตารางงานตามวันครบกำหนดส่ง", category: "Roadmap & Planning", categoryTh: "แผนงาน & ปฏิทิน", defaultName: "Project Milestones", icon: Calendar },
  { id: "content", label: "Content", labelTh: "ตารางคอนเทนต์", hint: "Plan an editorial calendar", hintTh: "วางแผนตารางโพสต์และผลิตคอนเทนต์", category: "Roadmap & Planning", categoryTh: "แผนงาน & ปฏิทิน", defaultName: "Editorial Calendar", icon: Calendar },
  { id: "mindmap", label: "Mind Map", labelTh: "แผนผังความคิด", hint: "Explore connected ideas & branches", hintTh: "ระดมสมองและเชื่อมโยงไอเดียเป็นกิ่งก้าน", category: "Ideation & Notes", categoryTh: "ระดมสมอง & โน้ต", defaultName: "Product Brainstorm", icon: Network },
  { id: "table", label: "Table", labelTh: "ตารางข้อมูล", hint: "Scan and sort task details in rows", hintTh: "ดูและจัดเรียงรายละเอียดงานทั้งหมดในรูปแบบตาราง", category: "Structured Lists", categoryTh: "รายการ & ตาราง", defaultName: "Task Inventory", icon: FileText },
  { id: "todo", label: "To-do", labelTh: "รายการสิ่งที่ต้องทำ", hint: "A focused list for everyday tasks", hintTh: "เช็กลิสต์เรียบง่ายสำหรับงานประจำวัน", category: "Structured Lists", categoryTh: "รายการ & ตาราง", defaultName: "Daily To-do List", icon: CheckCircle2 },
];

const boardTypeLabel = (type?: string, lang: "th" | "en" = "en") => {
  const found = BOARD_TYPES.find((t) => t.id === (type || "kanban"));
  if (!found) return "Kanban";
  return lang === "th" ? found.labelTh : found.label;
};

const getBoardTypeIcon = (type?: string) => {
  const match = BOARD_TYPES.find(b => b.id === (type || "kanban"));
  const IconComp = match?.icon || LayoutDashboard;
  return <IconComp size={12} />;
};



function AvatarImage({ src, name, className, title }: { src: string; name: string; className: string; title?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <div
        className={`${className} bg-gradient-to-br from-[#4f63ef] to-[#818cf8] text-white font-extrabold flex items-center justify-center uppercase shadow-xs text-[10px]`}
        title={title || name}
      >
        {name ? name[0].toUpperCase() : "U"}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
      title={title || name}
    />
  );
}

export default function Dashboard() {
  const { user, login, logout } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const handleWorkspaceLogout = () => {
    if (user?.email === "guest@kanban.demo" && !window.confirm(t("Log out of your guest session? You may lose access to your guest boards. Cancel to keep working or sign in to save them.", "ออกจากระบบโหมดทดลองใช้ (Guest) หรือไม่? บอร์ดที่ยังไม่ได้เข้าสู่ระบบเพื่อบันทึกอาจสูญหายได้"))) return;
    logout();
  };

  const { theme, toggleTheme } = useTheme();
  const { notifications, assignments, markAssignmentSeen, unreadCount, respondToAccess } = useNotifications();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [boards, setBoards] = useState<Board[]>([]);
  const [isLoadingBoards, setIsLoadingBoards] = useState(true);
  const [boardLoadError, setBoardLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "my" | "shared" | "starred">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const starredStorageKey = useMemo(() => `co_board_starred_${user?.id || user?.email || "guest"}`, [user?.id, user?.email]);
  const [starredIds, setStarredIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`co_board_starred_${user?.id || user?.email || "guest"}`);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      const saved = localStorage.getItem(starredStorageKey);
      const parsed = saved ? JSON.parse(saved) : [];
      setStarredIds(Array.isArray(parsed) ? parsed : []);
    } catch {
      setStarredIds([]);
    }
  }, [starredStorageKey]);
  const [heroDemoCols, setHeroDemoCols] = useState<Record<"todo" | "doing" | "done", Array<{ id: string; tag: string; title: string; lift?: boolean }>>>({
    todo: [
      { id: "d1", tag: "Design", title: "Sketch the homepage" },
      { id: "d2", tag: "Write", title: "Draft the announcement" },
    ],
    doing: [
      { id: "d3", tag: "Build", title: "Click a card to move it →", lift: true },
    ],
    done: [
      { id: "d4", tag: "Plan", title: "Pick a board format" },
    ],
  });
  const cycleHeroCard = (from: "todo" | "doing" | "done", cardId: string) => {
    const nextCol: Record<"todo" | "doing" | "done", "todo" | "doing" | "done"> = { todo: "doing", doing: "done", done: "todo" };
    const to = nextCol[from];
    setHeroDemoCols(prev => {
      const moving = prev[from].find(c => c.id === cardId);
      if (!moving) return prev;
      return {
        ...prev,
        [from]: prev[from].filter(c => c.id !== cardId),
        [to]: [...prev[to], { ...moving, lift: to === "doing" }],
      };
    });
  };
  const [renameModalData, setRenameModalData] = useState<{ boardId: string; name: string } | null>(null);
  const [renameInputValue, setRenameInputValue] = useState("");
  const [isSavingRename, setIsSavingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardType, setNewBoardType] = useState("kanban");
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deleteModalData, setDeleteModalData] = useState<{ boardId: string; name: string } | null>(null);
  const [isDeletingBoard, setIsDeletingBoard] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const navigate = useNavigate();

  const renderOnlineAvatars = (users?: UserPresence[], size: "sm" | "md" = "sm") => {
    if (!users || users.length === 0) {
      return null;
    }

    // Filter out lingering Guest User presence if current user is logged in with a real Google account
    const filteredUsers = users.filter((u) => {
      if (!u) return false;
      const isGuestPresence = u.name === "Guest" || u.name === "Guest User" || (u.email && u.email === "guest@kanban.demo") || u.name?.toLowerCase().includes("guest") || u.id === 0;
      if (user && user.email !== "guest@kanban.demo" && isGuestPresence) {
        return false;
      }
      return true;
    });

    if (filteredUsers.length === 0) {
      return null;
    }

    // Strict client-side deduplication by ID, Name, or Guest!
    const seen = new Set<string>();
    const uniqueUsers: UserPresence[] = [];

    for (const u of filteredUsers) {
      if (!u) continue;
      const isGuest = u.name === "Guest" || u.name === "Guest User" || (u.email && u.email === "guest@kanban.demo") || u.name?.toLowerCase().includes("guest") || !u.name || u.id === 0;
      const key = (!isGuest && u.id && u.id > 0)
        ? `user-id:${u.id}`
        : (!isGuest && u.name)
          ? `user-name:${u.name.toLowerCase().trim()}`
          : "guest-visitor";

      if (!seen.has(key)) {
        seen.add(key);
        uniqueUsers.push(u);
      }
    }

    // Deterministic sorting: Users with avatar image first, then initial badges, Guests last
    uniqueUsers.sort((a, b) => {
      const aIsGuest = a.name === "Guest" || a.name === "Guest User" || (a.email && a.email === "guest@kanban.demo") || a.name?.toLowerCase().includes("guest") || !a.name || a.id === 0;
      const bIsGuest = b.name === "Guest" || b.name === "Guest User" || (b.email && b.email === "guest@kanban.demo") || b.name?.toLowerCase().includes("guest") || !b.name || b.id === 0;
      if (aIsGuest !== bIsGuest) return aIsGuest ? 1 : -1;

      const aHasImg = !!a.avatarUrl;
      const bHasImg = !!b.avatarUrl;
      if (aHasImg !== bHasImg) return aHasImg ? -1 : 1;

      return (a.name || "").localeCompare(b.name || "");
    });

    const maxVisible = 3;
    const visibleUsers = uniqueUsers.slice(0, maxVisible);
    const remainingCount = uniqueUsers.length - maxVisible;

    const imgSize = size === "sm" ? "h-6 w-6 text-[10px]" : "h-7 w-7 text-xs";
    const spaceOffset = size === "sm" ? "-space-x-1.5" : "-space-x-2";

    return (
      <div className={`flex items-center ${spaceOffset} overflow-hidden`}>
        {visibleUsers.map((u, i) => {
          const isGuest = u.name === "Guest" || !u.name || u.id === 0;
          return isGuest ? (
            <div
              key={u.id || `guest-${i}`}
              className={`inline-flex ${imgSize} rounded-full ring-2 ring-white dark:ring-[#172033] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-200 items-center justify-center shadow-xs font-bold`}
              title={t("Guest Visitor (Online)", "ผู้เยี่ยมชม (ออนไลน์)")}
            >
              G
            </div>
          ) : (
            <AvatarImage
              key={u.id || `avatar-${i}`}
              src={u.avatarUrl}
              name={u.name || "User"}
              className={`inline-block ${imgSize} rounded-full ring-2 ring-white dark:ring-[#172033] object-cover`}
              title={`${u.name || "User"} (Online)`}
            />
          );
        })}
        {remainingCount > 0 && (
          <div className={`inline-flex ${imgSize} rounded-full ring-2 ring-white dark:ring-[#172033] bg-slate-800 text-white font-bold items-center justify-center text-[10px]`}>
            +{remainingCount}
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    if (user) {
      fetchBoards(true);

      // Delayed fetch to capture WS unregisters right after route changes
      const timer = setTimeout(() => fetchBoards(false), 400);

      // Live polling interval so online profile avatars update automatically without F5
      const interval = setInterval(() => fetchBoards(false), 2500);

      // Refetch on tab/window focus
      const handleFocus = () => fetchBoards(false);
      window.addEventListener("focus", handleFocus);
      document.addEventListener("visibilitychange", handleFocus);

      return () => {
        clearTimeout(timer);
        clearInterval(interval);
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleFocus);
      };
    } else {
      setIsLoadingBoards(false);
    }
  }, [user]);

  const fetchBoards = async (showLoading = false) => {
    try {
      if (showLoading) setIsLoadingBoards(true);
      const res = await fetch(`${API_URL}/api/me/boards`, {
        headers: {
          Authorization: `Bearer ${(localStorage.getItem("kanban_jwt") || sessionStorage.getItem("kanban_jwt"))}`,
        },
      });
      if (!res.ok) throw new Error("Could not load boards. Check your connection and try again.");
      const data = await res.json();
      setBoards(data || []);
      setBoardLoadError(null);
    } catch (err) {
      console.error("Failed to fetch boards", err);
      setBoardLoadError(err instanceof Error ? err.message : "Could not load boards. Please try again.");
    } finally {
      setIsLoadingBoards(false);
    }
  };

  const [isStartingDemo, setIsStartingDemo] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const startDemo = async () => {
    if (isStartingDemo) return;
    setIsStartingDemo(true);
    setDemoError(null);
    try {
      const demoToken = await login("guest");
      const res = await fetch(`${API_URL}/api/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoToken}` },
        body: JSON.stringify({ template: "demo" }),
      });
      if (!res.ok) throw new Error("Could not create the demo board. Please try again.");
      const board = await res.json();
      navigate(`/b/${board.ID}`);
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : "Could not start demo.");
    } finally {
      setIsStartingDemo(false);
    }
  };

  const createNewBoard = async () => {
    if (isCreatingBoard) return;
    setIsCreatingBoard(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_URL}/api/boards`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(localStorage.getItem("kanban_jwt") || sessionStorage.getItem("kanban_jwt"))}`,
        },
        body: JSON.stringify({ name: newBoardName.trim() || "Untitled board", template: newBoardType }),
      });
      if (!res.ok) throw new Error("Could not create the board. Please try again.");
      const newBoard = await res.json();
      setBoards((prev) => [newBoard, ...prev]);
      setShowCreateModal(false);
      setNewBoardName("");
      setNewBoardType("kanban");
      navigate(`/b/${newBoard.ID}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create board");
    } finally {
      setIsCreatingBoard(false);
    }
  };

  const openRenameModal = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setRenameModalData({ boardId: id, name });
    setRenameInputValue(name);
    setRenameError(null);
  };

  const handleSaveRename = async () => {
    if (!renameModalData || !renameInputValue.trim() || isSavingRename) return;

    try {
      setIsSavingRename(true);
      setRenameError(null);
      const res = await fetch(`${API_URL}/api/boards/${renameModalData.boardId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(localStorage.getItem("kanban_jwt") || sessionStorage.getItem("kanban_jwt"))}`,
        },
        body: JSON.stringify({ name: renameInputValue.trim() }),
      });
      if (!res.ok) throw new Error("Could not rename this board. Please try again.");
      setBoards(prev => prev.map(b => b.ID === renameModalData.boardId ? { ...b, Name: renameInputValue.trim() } : b));
      setRenameModalData(null);
    } catch (err) {
      console.error("Failed to rename board", err);
      setRenameError(err instanceof Error ? err.message : "Could not rename this board. Please try again.");
    } finally {
      setIsSavingRename(false);
    }
  };

  const openDeleteModal = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteModalData({ boardId: id, name });
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalData || isDeletingBoard) return;

    try {
      setIsDeletingBoard(true);
      setDeleteError(null);
      const res = await fetch(`${API_URL}/api/boards/${deleteModalData.boardId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${(localStorage.getItem("kanban_jwt") || sessionStorage.getItem("kanban_jwt"))}`,
        },
      });
      if (!res.ok) throw new Error("Could not delete this board. Please try again.");
      setBoards(prev => prev.filter(b => b.ID !== deleteModalData.boardId));
      setDeleteModalData(null);
    } catch (err) {
      console.error("Failed to delete board", err);
      setDeleteError(err instanceof Error ? err.message : "Could not delete this board. Please try again.");
    } finally {
      setIsDeletingBoard(false);
    }
  };

  const toggleStar = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setStarredIds(prev => {
      const next = prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id];
      try { localStorage.setItem(starredStorageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const attention = useMemo(() => {
    const items: { key: string; boardId: string; boardName: string; title: string; bucket: "overdue" | "today"; cardId: number }[] = [];
    for (const board of boards) {
      for (const card of board.Cards || []) {
        const bucket = dueBucket(card?.DueDate);
        if (bucket !== "overdue" && bucket !== "today") continue;
        items.push({
          key: `${board.ID}-${card.ID}`,
          boardId: board.ID,
          boardName: board.Name || "Untitled board",
          title: card.Title || "Untitled task",
          bucket,
          cardId: card.ID,
        });
      }
    }
    items.sort((a, b) => (a.bucket === b.bucket ? a.title.localeCompare(b.title) : a.bucket === "overdue" ? -1 : 1));
    return items;
  }, [boards]);

  const assignedToYou = useMemo(() => {
    const me = Number(user?.id);
    if (!me) return [];
    const items: { key: string; boardId: string; boardName: string; title: string; cardId: number }[] = [];
    for (const board of boards) {
      for (const card of board.Cards || []) {
        if (!card?.ID || Number(card.AssigneeID) !== me) continue;
        items.push({
          key: `${board.ID}-${card.ID}`,
          boardId: board.ID,
          boardName: board.Name || "Untitled board",
          title: card.Title || "Untitled task",
          cardId: card.ID,
        });
      }
    }
    items.sort((a, b) => a.title.localeCompare(b.title) || a.boardName.localeCompare(b.boardName));
    return items;
  }, [boards, user?.id]);

  const filteredBoards = useMemo(() => {
    return boards.filter(board => {
      const matchesSearch = board.Name.toLowerCase().includes(searchQuery.toLowerCase());
      let matchesTab = true;
      if (activeTab === "starred") matchesTab = starredIds.includes(board.ID);
      else if (activeTab === "my") matchesTab = !!board.IsOwner;
      else if (activeTab === "shared") matchesTab = !board.IsOwner;
      return matchesSearch && matchesTab;
    });
  }, [boards, searchQuery, activeTab, starredIds]);

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f8fafc] via-[#f1f5f9] to-[#eef2ff] dark:from-[#0b0f19] dark:via-[#0f172a] dark:to-[#172033] text-[#172033] dark:text-slate-100 flex flex-col font-sans selection:bg-[#4f63ef]/20 transition-colors">
        {/* Top Minimal Navbar */}
        <header className="landing-top">
          <div className="landing-brand">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#4051d6] via-[#6366f1] to-[#a5b4fc] p-[2px] shadow-md shadow-[#4f63ef]/20">
              <div className="w-full h-full bg-[#0f172a] rounded-[14px] flex items-center justify-center p-2 gap-1">
                <div className="w-1.5 h-full rounded-xs bg-gradient-to-b from-[#60a5fa] to-[#4051d6]" />
                <div className="w-1.5 h-4/5 rounded-xs bg-gradient-to-b from-[#818cf8] to-[#6366f1]" />
                <div className="w-1.5 h-3/5 rounded-xs bg-gradient-to-b from-[#818cf8] to-[#8b5cf6]" />
              </div>
            </div>
            <div>
              <span className="text-lg font-black tracking-tight text-slate-900 dark:text-white">co-board</span>
            </div>
          </div>

          <div className="landing-top-actions">
            <div
              role="group"
              aria-label="Language"
              className={`inline-flex items-center rounded-xl p-0.5 border text-[11px] font-extrabold tracking-wider ${
                theme === "dark"
                  ? "bg-[#0f172a] border-[#334155]"
                  : "bg-slate-100 border-slate-200"
              }`}
            >
              <button
                type="button"
                onClick={() => setLang("en")}
                aria-pressed={lang === "en"}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  lang === "en"
                    ? "bg-[#4f63ef] text-white shadow-2xs"
                    : theme === "dark"
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-slate-500 hover:text-slate-800"
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang("th")}
                aria-pressed={lang === "th"}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  lang === "th"
                    ? "bg-[#4f63ef] text-white shadow-2xs"
                    : theme === "dark"
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-slate-500 hover:text-slate-800"
                }`}
              >
                TH
              </button>
            </div>
            <button
              onClick={toggleTheme}
              className="landing-icon"
              title={theme === "dark" ? t("Switch to Light Mode", "เปลี่ยนเป็นโหมดสว่าง") : t("Switch to Dark Mode", "เปลี่ยนเป็นโหมดมืด")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={() => login("default")} className="landing-signin">{t("Sign in", "เข้าสู่ระบบ")}</button>
            <button className="landing-primary landing-demo" onClick={startDemo} disabled={isStartingDemo}>
              <Sparkles size={14} /> {isStartingDemo ? t("Preparing…", "กำลังเตรียมบอร์ด…") : t("Try a demo", "ทดลองใช้ฟรี")}
            </button>
          </div>
        </header>

        <main className="landing">
          <section className="landing-hero">
            <div>
              <p className="landing-kicker"><Sparkles size={14} /> {t("No account needed", "ไม่ต้องสมัครสมาชิกก็ลองใช้ได้ทันที")}</p>
              <h1>{t("A board you can use in the next minute.", "จัดการงานและโปรเจกต์ร่วมกันได้ทันทีในที่เดียว")}</h1>
              <p className="landing-lead">{t("Move tasks across columns, open a card to add details, and see the same change in another window. Start with sample tasks, then make your own board.", "ลากย้ายการ์ดงานข้ามคอลัมน์ คลิกการ์ดเพื่อเพิ่มรายละเอียด เช็กลิสต์ หรือสลับมุมมองเป็นตาราง ปฏิทิน และไทม์ไลน์ อัปเดตแบบเรียลไทม์พร้อมกันทั้งทีม")}</p>
              {demoError && <p role="alert" className="landing-error">{demoError}</p>}
              <div className="landing-actions">
                <button className="landing-primary" onClick={startDemo} disabled={isStartingDemo}>
                  <Sparkles size={16} />
                  {isStartingDemo ? t("Preparing your board…", "กำลังสร้างบอร์ดตัวอย่าง…") : t("Try a demo — no sign-up", "ทดลองใช้งานทันที — ไม่ต้องล็อกอิน")}
                </button>
                <button className="landing-secondary" onClick={() => login("default")}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                  {t("Continue with Google", "เข้าสู่ระบบด้วย Google")}
                </button>
              </div>
              <p className="landing-note">{t("The demo opens a real board with sample tasks. Sign in only if you want to keep it.", "โหมดทดลองใช้จะเปิดบอร์ดจริงพร้อมงานตัวอย่างให้ลองเล่นได้เต็มที่ ค่อยกดเข้าสู่ระบบเมื่อต้องการบันทึกบอร์ดเก็บไว้")}</p>
              <ol className="landing-steps">
                <li><b>1</b> {t("Open the sample board", "เปิดบอร์ดตัวอย่าง")}</li>
                <li><b>2</b> {t("Drag a card to another column", "ลากการ์ดย้ายไปคอลัมน์อื่น")}</li>
                <li><b>3</b> {t("Click the card to edit it", "คลิกที่การ์ดเพื่อแก้ไขรายละเอียด")}</li>
              </ol>
            </div>
            <div className="landing-board">
              <div className="landing-board-top"><i /> {t("Product launch", "เปิดตัวสินค้าใหม่")} <span className="ml-auto text-[11px] text-[#4f63ef] dark:text-[#a5b4fc] font-semibold">{t("Interactive · Click a card to move", "ลองคลิกที่การ์ดเพื่อย้ายช่องได้เลย")}</span></div>
              <div className="landing-board-cols">
                <section>
                  <header><i /> {t("To do", "รอดำเนินการ")} <span>{heroDemoCols.todo.length}</span></header>
                  {heroDemoCols.todo.map(c => (
                    <article key={c.id} onClick={() => cycleHeroCard("todo", c.id)} className={`cursor-pointer transition-all hover:border-[#a5b4fc] hover:-translate-y-0.5 ${c.lift ? "is-lift" : ""}`} title={t("Click to move to Doing", "คลิกเพื่อย้ายไป กำลังทำ")}>
                      <small>{c.tag}</small><strong>{c.title}</strong>
                    </article>
                  ))}
                </section>
                <section>
                  <header><i className="is-doing" /> {t("Doing", "กำลังทำ")} <span>{heroDemoCols.doing.length}</span></header>
                  {heroDemoCols.doing.map(c => (
                    <article key={c.id} onClick={() => cycleHeroCard("doing", c.id)} className={`cursor-pointer transition-all hover:border-[#a5b4fc] hover:-translate-y-0.5 ${c.lift ? "is-lift" : ""}`} title={t("Click to move to Done", "คลิกเพื่อย้ายไป เสร็จสิ้น")}>
                      <small>{c.tag}</small><strong>{c.title}</strong>
                    </article>
                  ))}
                </section>
                <section>
                  <header><i className="is-done" /> {t("Done", "เสร็จสิ้น")} <span>{heroDemoCols.done.length}</span></header>
                  {heroDemoCols.done.map(c => (
                    <article key={c.id} onClick={() => cycleHeroCard("done", c.id)} className={`cursor-pointer transition-all hover:border-[#a5b4fc] hover:-translate-y-0.5 ${c.lift ? "is-lift" : ""}`} title={t("Click to move back to To do", "คลิกเพื่อย้ายกลับไป รอดำเนินการ")}>
                      <small>{c.tag}</small><strong>{c.title}</strong>
                    </article>
                  ))}
                </section>
              </div>
            </div>
          </section>
          <section className="landing-features" aria-label="What you can do">
            <article>
              <LayoutGrid size={18} />
              <h2>{t("Move work visually", "สลับมุมมองได้หลากหลาย")}</h2>
              <p>{t("Start with columns. Switch to a table, calendar, timeline, or mind map when you need another way to look at the same tasks.", "เริ่มต้นด้วยบอร์ด Kanban แล้วสลับดูข้อมูลเดียวกันในรูปแบบตาราง ปฏิทิน ไทม์ไลน์ หรือแผนผังความคิดได้ทันที")}</p>
            </article>
            <article>
              <Zap size={18} />
              <h2>{t("See the same board together", "ทำงานร่วมกันแบบเรียลไทม์")}</h2>
              <p>{t("Open the link in another window. A move on one side shows up on the other without refreshing.", "แชร์ลิงก์ให้ทีมเข้ามาทำงานพร้อมกัน เมื่อมีคนย้ายการ์ดหรือแก้ไขงาน หน้าจอของทุกคนจะอัปเดตทันทีโดยไม่ต้องรีเฟรช")}</p>
            </article>
            <article>
              <Timer size={18} />
              <h2>{t("Plan a sprint", "วางแผนสปรินต์อย่างเป็นระบบ")}</h2>
              <p>{t("Keep a backlog, choose what belongs in this sprint, and mark the sprint done when the work is finished.", "จัดการ Backlog เลือกงานเข้าสปรินต์ กำหนดแต้มงาน (Story Points) และปิดสปรินต์เมื่องานเสร็จสมบูรณ์")}</p>
            </article>
            <article>
              <Sparkles size={18} />
              <h2>{t("Try it before you sign in", "ทดลองใช้ก่อนตัดสินใจล็อกอิน")}</h2>
              <p>{t("One click opens sample tasks. You can sign in later if you want to save the board or invite someone.", "คลิกเดียวเปิดบอร์ดพร้อมใช้งานทันที และสามารถกดเข้าสู่ระบบภายหลังเพื่อบันทึกบอร์ดเก็บไว้ในบัญชีของคุณได้")}</p>
            </article>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className={`board-workspace dashboard-workspace min-h-screen font-sans flex flex-col transition-colors duration-200 selection:bg-[#4f63ef]/20 ${theme === "dark" ? "bg-[#0f172a] text-[#f8fafc]" : "bg-[#f8fafc] text-slate-900"
      }`}>

      <WorkspaceSidebar onLogout={handleWorkspaceLogout} user={user} activePage="dashboard" boardCount={boards.length} role={t("Personal workspace", "พื้นที่ทำงานส่วนตัว")}
        boardFilter={activeTab}
        note={t("Star a board to pin it under Starred.", "กดรูปดาวที่การ์ดบอร์ดเพื่อปักหมุดไว้ในหมวดหมู่ ติดดาว")}
        onOverview={() => window.scrollTo({ top: 0 })} onAllBoards={() => { setActiveTab("all"); setSearchQuery(""); }}>
        <div className="sidebar-section-label">{t("QUICK ACCESS", "ทางลัดเข้าถึงด่วน")}</div>
        <button className={`sidebar-stream ${activeTab === "my" ? "active" : ""}`} aria-pressed={activeTab === "my"} onClick={() => setActiveTab("my")}><FolderKanban size={15} /> {t("My boards", "บอร์ดของฉัน")}</button>
        <button className={`sidebar-stream ${activeTab === "shared" ? "active" : ""}`} aria-pressed={activeTab === "shared"} onClick={() => setActiveTab("shared")}><Layers3 size={15} /> {t("Shared with me", "แชร์กับฉัน")}</button>
        <button className={`sidebar-stream ${activeTab === "starred" ? "active" : ""}`} aria-pressed={activeTab === "starred"} onClick={() => setActiveTab("starred")}><Star size={15} /> {t("Starred", "ติดดาว")}</button>
        {boards.some(b => starredIds.includes(b.ID)) && (
          <>
            <div className="sidebar-section-label">{t("STARRED BOARDS", "บอร์ดที่ปักหมุดดาว")}</div>
            {boards.filter(b => starredIds.includes(b.ID)).slice(0, 6).map(b => (
              <Link key={b.ID} to={`/b/${b.ID}`} className="sidebar-stream">
                <Star size={13} className="text-amber-500 fill-amber-500 flex-shrink-0" />
                <span className="truncate">{b.Name || t("Untitled board", "บอร์ดไม่มีชื่อ")}</span>
              </Link>
            ))}
          </>
        )}
      </WorkspaceSidebar>
      {demoError && <div role="alert" className="bg-rose-100 text-rose-900 p-4">{demoError} <button onClick={startDemo} disabled={isStartingDemo} className="underline">{t("Retry demo", "ลองใหม่อีกครั้ง")}</button></div>}
      {isStartingDemo && <div role="status" className="bg-[#eef2ff] text-[#172033] p-4">{t("Preparing your demo board…", "กำลังเตรียมบอร์ดตัวอย่างของคุณ…")}</div>}
      {/* HEADER */}
      <header className={`board-topbar dashboard-topbar px-8 py-4 border-b flex items-center justify-between backdrop-blur-md sticky top-0 z-20 transition-colors ${theme === "dark" ? "bg-[#0f172a]/95 border-[#334155]" : "bg-white border-slate-200 shadow-xs"
        }`}>
        <div className="board-brand flex items-center gap-3"><span className="mobile-workspace-symbol"><KanbanMark /></span><h1 className="board-title">{t("All boards", "บอร์ดทั้งหมด")}</h1></div>
        <div className="dashboard-top-actions flex items-center gap-3">
          {/* Language Switcher Pill (EN / TH) */}
          <div
            role="group"
            aria-label="Language"
            className={`inline-flex items-center rounded-xl p-0.5 border text-[11px] font-extrabold tracking-wider ${
              theme === "dark"
                ? "bg-[#172033] border-[#334155]"
                : "bg-slate-100 border-slate-200"
            }`}
          >
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                lang === "en"
                  ? "bg-[#4f63ef] text-white shadow-2xs"
                  : theme === "dark"
                    ? "text-slate-400 hover:text-slate-200"
                    : "text-slate-500 hover:text-slate-800"
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLang("th")}
              aria-pressed={lang === "th"}
              className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                lang === "th"
                  ? "bg-[#4f63ef] text-white shadow-2xs"
                  : theme === "dark"
                    ? "text-slate-400 hover:text-slate-200"
                    : "text-slate-500 hover:text-slate-800"
              }`}
            >
              TH
            </button>
          </div>

          {/* Theme Switcher Button */}
          <button
            onClick={toggleTheme}
            className={`p-2.5 rounded-xl border transition-colors cursor-pointer ${theme === "dark"
              ? "bg-[#172033] text-[#a5b4fc] hover:bg-[#334155] border-[#334155]"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
              }`}
            title={theme === "dark" ? t("Switch to Light Mode", "เปลี่ยนเป็นโหมดสว่าง") : t("Switch to Dark Mode", "เปลี่ยนเป็นโหมดมืด")}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <div className={`workspace-mobile-account flex items-center gap-3 px-3.5 py-1.5 rounded-xl border ${theme === "dark" ? "bg-[#172033] border-[#334155]" : "bg-slate-50 border-slate-200"
            }`}>
            <AvatarImage
              src={user.avatarUrl}
              name={user.name}
              className="w-6 h-6 rounded-full object-cover"
            />
            <span className={`text-xs font-semibold ${theme === "dark" ? "text-slate-200" : "text-slate-700"}`}>
              {user.name}
            </span>
          </div>

          {/* Notifications Bell Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              className={`p-2 rounded-xl border transition-all cursor-pointer relative ${theme === "dark"
                ? "bg-[#172033] text-slate-200 hover:bg-[#334155] border-[#334155]"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
                }`}
              title={t("Notifications", "การแจ้งเตือน")}
              aria-label="Notifications"
            >
              <Bell size={17} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#4051d6] text-white text-[10px] font-extrabold w-4.5 h-4.5 rounded-full flex items-center justify-center border-2 border-white dark:border-[#0f172a] shadow-xs">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Dropdown Panel (Miro Screenshot 4 & 5) */}
            {isNotificationsOpen && (
              <div className={`notice-panel absolute right-0 mt-2 w-80 md:w-96 rounded-2xl border shadow-xl p-4 z-50 animate-in fade-in slide-in-from-top-2 duration-150 ${theme === "dark" ? "bg-[#172033] border-[#334155] text-slate-100" : "bg-white border-slate-200 text-slate-800"
                }`}>
                <div className="flex items-center justify-between border-b pb-3 mb-3 border-slate-100 dark:border-[#334155]">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    {t("Notifications", "การแจ้งเตือน")}
                    {unreadCount > 0 && (
                      <span className="bg-[#eef2ff] text-[#4051d6] dark:bg-[#172033]/60 dark:text-[#a5b4fc] text-[10px] px-2 py-0.5 rounded-full font-bold">
                        {unreadCount} {t("unread", "ใหม่")}
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => setIsNotificationsOpen(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
                  {notifications.length === 0 && assignments.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      {t("No notifications yet", "ยังไม่มีการแจ้งเตือน")}
                    </div>
                  ) : (
                    <>
                    <AssignmentNotices items={assignments} onOpen={(id) => { void markAssignmentSeen(id); setIsNotificationsOpen(false); }} />
                    {notifications.map((item) => (
                      <div
                        key={item.id}
                        className={`p-3 rounded-xl border transition-all ${item.status === "pending"
                          ? theme === "dark" ? "bg-[#243052]/20 border-[#4f63ef]/40" : "bg-[#f8fafc]/50 border-[#eef2ff]"
                          : theme === "dark" ? "bg-slate-900/40 border-slate-800" : "bg-slate-50 border-slate-100"
                          }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <AvatarImage
                            src={item.avatarUrl}
                            name={item.userName}
                            className="w-7 h-7 rounded-full flex-shrink-0 mt-0.5 object-cover"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs leading-snug">
                              <span className="font-bold">{item.userName}</span> {t("asked to edit", "ขอสิทธิ์แก้ไขบอร์ด")} <span className="font-semibold text-[#4f63ef] dark:text-[#a5b4fc]">{item.boardName}</span>
                            </p>

                            {/* Notification Actions */}
                            <div className="mt-2.5 flex items-center gap-2">
                              {item.status === "pending" ? (
                                <>
                                  <button
                                    onClick={() => respondToAccess(item.id, "approve")}
                                    className="px-3 py-1 bg-[#4f63ef] hover:bg-[#4051d6] text-white text-xs font-bold rounded-lg transition-all cursor-pointer shadow-xs"
                                  >
                                    {t("Allow editing", "อนุญาตให้แก้ไข")}
                                  </button>
                                  <button
                                    onClick={() => respondToAccess(item.id, "dismiss")}
                                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-lg transition-all cursor-pointer"
                                  >
                                    {t("Dismiss", "ปฏิเสธ")}
                                  </button>
                                </>
                              ) : item.status === "approved" ? (
                                <span className="text-xs font-bold text-[#16a34a] dark:text-[#22c55e] flex items-center gap-1">
                                  <Check size={14} /> {t("Editing allowed", "อนุญาตให้แก้ไขแล้ว")}
                                </span>
                              ) : (
                                <span className="text-xs font-medium text-slate-400">
                                  {t("Request dismissed", "ปฏิเสธคำขอแล้ว")}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              handleWorkspaceLogout();
            }}
            className={`workspace-mobile-account p-2 rounded-xl border transition-colors ${theme === "dark"
              ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-transparent"
              : "bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border-slate-200"
              }`}
            title={t("Logout", "ออกจากระบบ")}
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <section className="board-overview" aria-label="Workspace overview">
        <div className="overview-copy">
          {boards.length === 0 && <div className="board-eyebrow"><span /> {t("START HERE", "เริ่มต้นใช้งาน")}</div>}
          <h2>{t("My workspace", "พื้นที่ทำงานของฉัน")}</h2>
          <p>{boards.length === 0 ? t("Open a board to move tasks, or create one from a template. Kanban is the easiest place to begin.", "เปิดบอร์ดเพื่อจัดการงาน หรือสร้างบอร์ดใหม่จากเทมเพลต แนะนำให้เริ่มจากบอร์ดแคนบาน (Kanban) จะใช้งานง่ายที่สุด") : t("Open a board to move tasks, or create one from a template.", "เลือกบอร์ดเพื่อเข้าจัดการงาน หรือกดสร้างบอร์ดใหม่จากเทมเพลตด้านล่าง")}</p>
          <div className="overview-meta">
            <span><Layers3 size={14} /> {boards.length} {t(boards.length === 1 ? "board" : "boards", "บอร์ด")}</span>
            <span><Star size={14} /> {boards.filter(b => starredIds.includes(b.ID)).length} {t("starred", "ติดดาว")}</span>
            <span>{boards.reduce((n, b) => n + (b.Cards?.length || 0), 0)} {t(boards.reduce((n, b) => n + (b.Cards?.length || 0), 0) === 1 ? "task across your boards" : "tasks across your boards", "งานในทุกบอร์ดรวมกัน")}</span>
            {user?.email === "guest@kanban.demo" && (
              <span className="overview-access font-bold">{t("Guest session", "โหมดทดลองใช้ (Guest)")}</span>
            )}
          </div>
        </div>
        <div className="overview-action">
          <button className="new-task-button" onClick={() => { setNewBoardName(""); setShowCreateModal(true); }}>
            <Plus size={17} /> {t("New board", "สร้างบอร์ดใหม่")}
          </button>
        </div>
      </section>

      {attention.length > 0 && (
        <section className="due-soon" aria-label="Tasks that need attention">
          <div className="due-soon-counts">
            <strong>{attention.filter((item) => item.bucket === "overdue").length} {t("overdue", "เลยกำหนด")}</strong>
            <strong>{attention.filter((item) => item.bucket === "today").length} {t("due today", "ครบกำหนดวันนี้")}</strong>
          </div>
          <ul>
            {attention.slice(0, 4).map((item) => (
              <li key={item.key}>
                <Link to={`/b/${item.boardId}?due=${item.bucket}&task=${item.cardId}`}>
                  <span className={`due-soon-${item.bucket}`}>{item.bucket === "overdue" ? t("Overdue", "เลยกำหนด") : t("Today", "วันนี้")}</span>
                  <b>{item.title}</b>
                  <small>{item.boardName}</small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {assignedToYou.length > 0 && (
        <section className="assigned-you" aria-label="Assigned to you">
          <h3>{t("Assigned to you", "งานที่มอบหมายให้คุณ")} <span>{assignedToYou.length}</span></h3>
          <ul>
            {assignedToYou.slice(0, 6).map((item) => (
              <li key={item.key}>
                <Link to={`/b/${item.boardId}?task=${item.cardId}`}>
                  <b>{item.title}</b>
                  <small>{item.boardName}</small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* MAIN CONTAINER */}
      <main className="dashboard-main max-w-7xl w-full mx-auto px-8 py-6 flex-1 space-y-6">

        {/* ACTION BAR: SEARCH, TABS, VIEW TOGGLE */}
        <div className={`dashboard-controls flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b ${theme === "dark" ? "border-[#334155]" : "border-slate-200"
          }`}>

          {/* Tabs */}
          <div className={`dashboard-tabs flex items-center gap-2 w-fit flex-wrap p-1.5 rounded-2xl border ${theme === "dark" ? "bg-[#0f172a] border-[#334155]" : "bg-slate-100/80 border-slate-200"
            }`}>
            <button
              aria-pressed={activeTab === "all"}
              onClick={() => setActiveTab("all")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeTab === "all"
                ? theme === "dark" ? "bg-[#4051d6] text-white shadow-md shadow-[#4f63ef]/20" : "bg-[#4f63ef] text-white shadow-md shadow-[#4f63ef]/20"
                : theme === "dark" ? "bg-[#172033] border border-[#334155] text-slate-300 hover:bg-[#334155]" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
            >
              {t("All boards", "บอร์ดทั้งหมด")} ({boards.length})
            </button>
            <button
              aria-pressed={activeTab === "my"}
              onClick={() => setActiveTab("my")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeTab === "my"
                ? theme === "dark" ? "bg-[#4051d6] text-white shadow-md shadow-[#4f63ef]/20" : "bg-[#4f63ef] text-white shadow-md shadow-[#4f63ef]/20"
                : theme === "dark" ? "bg-[#172033] border border-[#334155] text-slate-300 hover:bg-[#334155]" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
            >
              {t("My boards", "บอร์ดของฉัน")} ({boards.filter(b => b.IsOwner).length})
            </button>
            <button
              aria-pressed={activeTab === "shared"}
              onClick={() => setActiveTab("shared")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeTab === "shared"
                ? theme === "dark" ? "bg-[#4051d6] text-white shadow-md shadow-[#4f63ef]/20" : "bg-[#4f63ef] text-white shadow-md shadow-[#4f63ef]/20"
                : theme === "dark" ? "bg-[#172033] border border-[#334155] text-slate-300 hover:bg-[#334155]" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
            >
              {t("Shared with me", "แชร์กับฉัน")} ({boards.filter(b => !b.IsOwner).length})
            </button>
            <button
              aria-pressed={activeTab === "starred"}
              onClick={() => setActiveTab("starred")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === "starred"
                ? theme === "dark" ? "bg-[#4051d6] text-white shadow-md shadow-[#4f63ef]/20" : "bg-[#4f63ef] text-white shadow-md shadow-[#4f63ef]/20"
                : theme === "dark" ? "bg-[#172033] border border-[#334155] text-slate-300 hover:bg-[#334155]" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
            >
              <Star size={14} className={activeTab === "starred" ? "fill-current" : ""} />
              {t("Starred", "ติดดาว")} ({starredIds.length})
            </button>
          </div>

          {/* Controls: Search + View Toggle */}
          <div className="flex items-center gap-3">

            {/* Search Input */}
            <div className="relative w-64">
              <Search className={`absolute left-3.5 top-2.5 ${theme === "dark" ? "text-slate-400" : "text-slate-400"}`} size={16} />
              <input
                type="text"
                aria-label="Search boards"
                placeholder={t("Search boards…", "ค้นหาชื่อบอร์ด…")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full rounded-xl pl-10 pr-8 py-2 text-xs focus:outline-none transition-colors ${theme === "dark"
                  ? "bg-[#0f172a] border border-[#334155] text-slate-200 focus:border-[#4051d6] placeholder:text-slate-500"
                  : "bg-white border border-slate-200 text-slate-800 focus:border-[#4f63ef] placeholder:text-slate-400 shadow-xs"
                  }`}
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>


            {/* Grid / List Switcher */}
            <div className={`flex items-center rounded-xl p-1 shadow-xs border ${theme === "dark" ? "bg-[#0f172a] border-[#334155]" : "bg-white border-slate-200"
              }`}>
              <button
                aria-pressed={viewMode === "grid"}
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer ${viewMode === "grid"
                  ? theme === "dark" ? "bg-[#172033] text-[#a5b4fc] font-bold" : "bg-slate-100 text-[#4f63ef] dark:text-[#a5b4fc] font-bold"
                  : ""
                  }`}
                title={t("Grid View", "มุมมองตารางการ์ด")}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer ${viewMode === "list"
                  ? theme === "dark" ? "bg-[#172033] text-[#a5b4fc] font-bold" : "bg-slate-100 text-[#4f63ef] dark:text-[#a5b4fc] font-bold"
                  : ""
                  }`}
                title={t("List View", "มุมมองรายการ")}
              >
                <ListIcon size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* BOARD LISTING */}
        {boardLoadError && (
          <div role="alert" className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${theme === "dark" ? "border-rose-800 bg-rose-950/30 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
            <span>{boardLoadError}{boards.length > 0 ? t(" Showing the last loaded boards.", " แสดงข้อมูลบอร์ดล่าสุดที่โหลดไว้") : ""}</span>
            <button type="button" onClick={() => fetchBoards(true)} disabled={isLoadingBoards} className="rounded-lg border border-current px-3 py-1.5 font-bold disabled:opacity-50">{isLoadingBoards ? t("Retrying…", "กำลังลองใหม่…") : t("Retry", "ลองใหม่")}</button>
          </div>
        )}
        {isLoadingBoards ? (
          <div className="dashboard-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(n => (
              <div key={n} className={`h-56 rounded-2xl p-5 border animate-pulse flex flex-col justify-between ${theme === "dark" ? "bg-[#172033]/60 border-[#334155]" : "bg-white border-slate-200"
                }`}>
                <div className={`h-28 rounded-xl ${theme === "dark" ? "bg-slate-800/80" : "bg-slate-100"}`} />
                <div className="space-y-2 pt-3">
                  <div className={`h-4 w-2/3 rounded ${theme === "dark" ? "bg-slate-800" : "bg-slate-200"}`} />
                  <div className={`h-3 w-1/3 rounded ${theme === "dark" ? "bg-slate-800" : "bg-slate-200"}`} />
                </div>
              </div>
            ))}
          </div>
        ) : boardLoadError && boards.length === 0 ? null : filteredBoards.length === 0 ? (
          <div className={`dashboard-empty text-center py-20 border-2 border-dashed rounded-3xl ${theme === "dark" ? "border-[#334155] bg-[#0f172a]/50" : "border-slate-200 bg-white/60"
            }`}>
            <FolderKanban className={`mx-auto mb-3 ${theme === "dark" ? "text-slate-500" : "text-slate-400"}`} size={48} />
            <h3 className={`text-lg font-bold mb-1 ${theme === "dark" ? "text-slate-200" : "text-slate-800"}`}>{t("Nothing in this list yet", "ยังไม่มีบอร์ดในหมวดหมู่นี้")}</h3>
            <p className={`text-sm max-w-sm mx-auto mb-6 leading-relaxed ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
              {searchQuery
                ? t("No boards match that name. Clear the search to see everything.", "ไม่พบบอร์ดที่ตรงกับชื่อที่ค้นหา ลองล้างคำค้นหาเพื่อดูบอร์ดทั้งหมด")
                : activeTab === "starred"
                  ? t("Star a board from its card, and it will show up here.", "กดรูปดาวที่การ์ดบอร์ดเพื่อปักหมุดบอร์ดที่ใช้บ่อยไว้ที่นี่")
                  : activeTab === "shared"
                    ? t("When someone shares a board with you, it will show up here.", "เมื่อเพื่อนร่วมทีมแชร์บอร์ดให้คุณ บอร์ดเหล่านั้นจะแสดงในหน้านี้")
                    : t("Create a board to begin. Kanban uses columns such as To do, Doing, and Done.", "เริ่มต้นด้วยการสร้างบอร์ดใหม่ แนะนำรูปแบบ Kanban ที่แบ่งงานเป็นคอลัมน์เข้าใจง่าย")}
            </p>
            <button
              onClick={searchQuery || activeTab !== "all" ? () => { setSearchQuery(""); setActiveTab("all"); } : () => setShowCreateModal(true)}
              className={`px-5 py-2.5 rounded-xl text-white text-xs font-bold transition-all hover:scale-105 active:scale-95 ${theme === "dark" ? "bg-[#4051d6] hover:bg-[#4051d6] shadow-md shadow-[#4f63ef]/20" : "bg-[#4f63ef] hover:bg-[#4051d6] shadow-md shadow-[#4f63ef]/20"
                }`}
            >
              {searchQuery || activeTab !== "all" ? t("View all boards", "ดูบอร์ดทั้งหมด") : t("+ Create New Board", "+ สร้างบอร์ดใหม่")}
            </button>
          </div>
        ) : viewMode === "grid" ? (
          /* GRID VIEW */
          <div className="dashboard-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredBoards.map(board => {
              const isStarred = starredIds.includes(board.ID);
              return (
                <Link key={board.ID} to={`/b/${board.ID}`} className="block group">
                  <div className={`dashboard-board-card h-56 rounded-2xl p-5 flex flex-col justify-between border transition-all duration-200 hover:-translate-y-1 hover:shadow-lg relative overflow-hidden shadow-xs ${theme === "dark"
                    ? "bg-[#172033] border-[#334155] group-hover:border-[#4f63ef]/50"
                    : "bg-white border-slate-200 group-hover:border-[#4f63ef]/50"
                    }`}>

                    {/* Top Card Thumbnail Header */}
                    <div className={`dashboard-board-preview h-28 rounded-xl p-3 border relative flex items-center justify-center overflow-hidden ${theme === "dark"
                      ? "bg-gradient-to-br from-slate-900 via-[#0f172a] to-[#243052]/30 border-[#334155]"
                      : "bg-gradient-to-br from-[#eef2ff] via-[#f8fafc] to-white border-[#e2e8f0]"
                      }`}>
                      <div className={`w-full h-full rounded-lg shadow-xs border p-2 opacity-90 group-hover:scale-105 transition-transform ${theme === "dark" ? "bg-[#0f172a]/90 border-[#334155]" : "bg-white/80 border-slate-200/60"
                        }`}>
                        <BoardFormatPreview format={board.Type || "kanban"} />
                      </div>

                      {/* Action buttons overlay */}
                      <div className={`absolute top-2 right-2 flex items-center gap-1 transition-opacity z-20 ${isStarred ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
                        <button
                          onClick={(e) => toggleStar(e, board.ID)}
                          className={`p-1.5 rounded-lg transition-colors border shadow-xs ${theme === "dark" ? "bg-[#0f172a]/90 border-[#334155]" : "bg-white/90 border-slate-200"
                            } ${isStarred ? "text-amber-500 dark:text-amber-400" : "text-slate-400 hover:text-[#4f63ef] dark:hover:text-[#a5b4fc]"}`}
                          title={t("Star Board", "ติดดาวบอร์ด")}
                        >
                          <Star size={13} fill={isStarred ? "currentColor" : "none"} />
                        </button>
                        {board.IsOwner && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => openRenameModal(e, board.ID, board.Name)}
                              className={`p-1.5 rounded-lg transition-colors border shadow-xs ${theme === "dark" ? "bg-[#0f172a]/90 border-[#334155] text-slate-400 hover:text-[#a5b4fc]" : "bg-white/90 border-slate-200 text-slate-500 hover:text-[#4051d6]"
                                }`}
                              title={t("Rename", "เปลี่ยนชื่อบอร์ด")}
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={(e) => openDeleteModal(e, board.ID, board.Name)}
                              className={`p-1.5 rounded-lg transition-colors border shadow-xs ${theme === "dark" ? "bg-[#0f172a]/90 border-[#334155] text-slate-400 hover:text-rose-400" : "bg-white/90 border-slate-200 text-slate-500 hover:text-rose-600"
                                }`}
                              title={t("Delete", "ลบบอร์ด")}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Title & Badges */}
                    <div className="pt-3">
                      <div className="dashboard-card-details flex flex-col items-start gap-2 mb-2">
                        <h3 className={`text-sm font-bold transition-colors ${theme === "dark" ? "text-slate-100 group-hover:text-[#a5b4fc]" : "text-slate-900 group-hover:text-[#4f63ef]"
                          }`}>
                          {board.Name || t("Untitled Board", "บอร์ดไม่มีชื่อ")}
                        </h3>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1 ${theme === "dark" ? "bg-[#243052] text-[#c7d2fe]" : "bg-[#eef2ff] text-[#4051d6]"
                            }`}>
                            {getBoardTypeIcon(board.Type)}
                            {boardTypeLabel(board.Type, lang)}
                          </span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex-shrink-0 ${board.IsOwner
                            ? theme === "dark" ? "bg-[#4f63ef]/20 text-[#a5b4fc] border border-[#4f63ef]/30" : "bg-[#f8fafc] text-[#4051d6] border border-[#c7d2fe]"
                            : theme === "dark" ? "bg-violet-500/15 text-violet-300 border border-violet-500/30" : "bg-violet-50 text-violet-700 border border-violet-200"
                            }`}>
                            {board.IsOwner ? t("Yours", "ของคุณ") : t("Shared", "แชร์ร่วมกัน")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className={`flex items-center justify-between text-xs pt-2 border-t ${theme === "dark" ? "border-[#334155] text-slate-400" : "border-slate-100 text-slate-500"
                      }`}>
                      <span className="text-[13px] font-semibold">
                        {board.Cards?.length || 0} {t((board.Cards?.length || 0) === 1 ? "task" : "tasks", "งาน")}
                      </span>
                      <span className="flex items-center gap-3">
                        {renderOnlineAvatars(board.OnlineUsers, "sm")}
                        <span className="dashboard-open-cue">{t("Open", "เปิดบอร์ด")}</span>
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          /* LIST VIEW */
          <div className={`dashboard-list border rounded-2xl overflow-hidden shadow-xs ${theme === "dark" ? "bg-[#172033] border-[#334155]" : "bg-white border-slate-200"
            }`}>
            {/* Table Header */}
            <div className={`dashboard-list-heading grid grid-cols-12 px-6 py-3 border-b text-xs font-bold ${theme === "dark" ? "bg-[#0f172a]/60 border-[#334155] text-slate-400" : "bg-slate-50 border-slate-100 text-slate-500"
              }`}>
              <div className="col-span-5">{t("Name", "ชื่อบอร์ด")}</div>
              <div className="col-span-3 text-center">{t("Online users", "ผู้ใช้ออนไลน์")}</div>
              <div className="col-span-2 text-center">{t("Access", "สิทธิ์การเข้าถึง")}</div>
              <div className="col-span-2 text-right">{t("Actions", "จัดการ")}</div>
            </div>

            <div className={`divide-y ${theme === "dark" ? "divide-[#334155]" : "divide-slate-100"}`}>
              {filteredBoards.map(board => {
                const isStarred = starredIds.includes(board.ID);
                return (
                  <Link key={board.ID} to={`/b/${board.ID}`} className={`dashboard-list-row px-6 py-4 grid grid-cols-12 items-center transition-colors group ${theme === "dark" ? "hover:bg-[#0f172a]" : "hover:bg-[#f8fafc]/40"
                    }`}>
                    {/* Name Column */}
                    <div className="col-span-5 flex items-center gap-3">
                      <div className={`p-2 rounded-xl border flex-shrink-0 ${theme === "dark" ? "bg-[#4f63ef]/10 border-[#4f63ef]/20 text-[#a5b4fc]" : "bg-[#f8fafc] border-[#eef2ff] text-[#4f63ef] dark:text-[#a5b4fc]"
                        }`}>
                        <FolderKanban size={18} />
                      </div>
                      <div className="min-w-0">
                        <h4 className={`text-sm font-bold truncate transition-colors ${theme === "dark" ? "text-slate-100 group-hover:text-[#a5b4fc]" : "text-slate-900 group-hover:text-[#4f63ef]"
                          }`}>
                          {board.Name || t("Untitled Board", "บอร์ดไม่มีชื่อ")}
                        </h4>
                        <p className={`text-[11px] ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>{(board.Cards?.length || 0)} {t((board.Cards?.length || 0) === 1 ? "task" : "tasks", "งาน")} · {boardTypeLabel(board.Type, lang)}</p>
                      </div>
                    </div>

                    {/* Online Users Column (Miro Style Avatar Stack) */}
                    <div className="col-span-3 flex items-center justify-center">
                      {renderOnlineAvatars(board.OnlineUsers, "md")}
                    </div>

                    {/* Owner Column */}
                    <div className="col-span-2 flex items-center justify-center">
                      <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold ${board.IsOwner
                        ? theme === "dark" ? "bg-[#4f63ef]/20 text-[#a5b4fc] border border-[#4f63ef]/30" : "bg-[#f8fafc] text-[#4051d6] border border-[#c7d2fe]"
                        : theme === "dark" ? "bg-violet-500/15 text-violet-300 border border-violet-500/30" : "bg-violet-50 text-violet-700 border border-violet-200"
                        }`}>
                        {board.IsOwner ? t("Yours", "ของคุณ") : t("Shared", "แชร์ร่วมกัน")}
                      </span>
                    </div>

                    {/* Actions Column */}
                    <div className="col-span-2 flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => toggleStar(e, board.ID)}
                        className={`p-1.5 rounded-lg transition-colors border ${theme === "dark" ? "border-[#334155]" : "border-slate-200"
                          } ${isStarred ? "text-[#4f63ef] dark:text-[#a5b4fc]" : "text-slate-400 hover:text-[#4f63ef] dark:hover:text-[#a5b4fc]"}`}
                        title={t("Star Board", "ติดดาวบอร์ด")}
                      >
                        <Star size={14} fill={isStarred ? "currentColor" : "none"} />
                      </button>
                      {board.IsOwner && (
                        <>
                          <button
                            onClick={(e) => openRenameModal(e, board.ID, board.Name)}
                            className={`p-1.5 transition-colors ${theme === "dark" ? "text-slate-400 hover:text-[#a5b4fc]" : "text-slate-400 hover:text-[#4051d6]"}`}
                            title={t("Rename", "เปลี่ยนชื่อบอร์ด")}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={(e) => openDeleteModal(e, board.ID, board.Name)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                            title={t("Delete", "ลบบอร์ด")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <section className="start-templates" aria-label="Quick templates">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Sparkles size={14} className="text-[#4f63ef] dark:text-[#a5b4fc]" /> {t("Start from a template", "เริ่มต้นด่วนจากเทมเพลต")}
          </span>
          <span className="text-[12px] text-slate-500 hidden sm:inline">{t("You can rename it and switch views later", "สามารถเปลี่ยนชื่อและสลับมุมมองได้ตลอดเวลา")}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {BOARD_TYPES.slice(0, 6).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setNewBoardType(item.id);
                setNewBoardName(item.defaultName || "");
                setShowCreateModal(true);
              }}
              className={`start-template p-3 rounded-xl border text-left transition-all duration-150 cursor-pointer group flex flex-col justify-between shadow-2xs hover:shadow-md ${
                theme === "dark"
                  ? "bg-[#172033]/90 hover:bg-[#1e293b] border-[#334155] hover:border-[#4f63ef]/60"
                  : "bg-white hover:bg-[#f8fafc] border-slate-200 hover:border-[#4f63ef]/60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-slate-800 dark:text-slate-100 group-hover:text-[#4f63ef] dark:group-hover:text-[#a5b4fc] transition-colors flex items-center gap-1.5 flex-wrap">
                  <item.icon size={14} className="text-[#4f63ef] dark:text-[#a5b4fc]" />
                  {lang === "th" ? item.labelTh : item.label}
                </span>
                <Plus size={14} className="text-slate-400 group-hover:text-[#4f63ef] dark:group-hover:text-[#a5b4fc] transition-colors flex-shrink-0" />
              </div>
              <span className="start-badge-row">{item.id === "kanban" && <span className="start-badge">{t("Easiest start", "เริ่มต้นง่ายที่สุด")}</span>}</span>
              <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-snug line-clamp-2">
                {lang === "th" ? item.hintTh : item.hint}
              </p>
              <span className="text-[12px] font-bold text-[#4f63ef] dark:text-[#a5b4fc] flex items-center gap-0.5">
                {t("Use this", "ใช้เทมเพลตนี้")} <ArrowRight size={12} />
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Centered Glassmorphic Create Board Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create a new board"
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-50 flex items-center justify-center overflow-y-auto p-4 animate-in fade-in duration-150"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className={`create-board-sheet w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-3xl border shadow-2xl flex flex-col animate-in zoom-in-95 duration-150 ${theme === "dark" ? "bg-[#172033] border-[#334155] text-slate-100" : "bg-white border-slate-200 text-slate-800"
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-[#4f63ef]/10 text-[#4f63ef] dark:text-[#a5b4fc] border border-[#4f63ef]/20">
                  <Plus size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold">{t("New board", "สร้างบอร์ดใหม่")}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t("Name it, then pick a layout. Not sure? Choose Kanban. You can switch views later.", "ตั้งชื่อบอร์ดแล้วเลือกรูปแบบที่ต้องการ (สามารถสลับมุมมองภายหลังได้ตลอดเวลา)")}</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1 cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="create-board-scroll">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="new-board-name" className="text-[13px] font-semibold text-slate-500">{t("Board name", "ชื่อบอร์ด")}</label>
                <span className="text-xs text-slate-400">{t("Press Enter to create", "กด Enter เพื่อสร้างทันที")}</span>
              </div>
              <input
                id="new-board-name"
                type="text"
                autoFocus
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createNewBoard();
                  if (e.key === "Escape") setShowCreateModal(false);
                }}
                className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#4f63ef] font-semibold transition-all ${theme === "dark" ? "bg-[#0f172a] border-[#334155] text-slate-100 placeholder:text-slate-600" : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400"
                  }`}
                placeholder={t("For example, Product launch", "เช่น เปิดตัวสินค้าใหม่, แผนงานประจำสัปดาห์")}
              />
              {/* Quick suggestions chips */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-xs text-slate-400 font-medium">{t("Suggestions:", "ชื่อแนะนำ:")}</span>
                {(lang === "th"
                  ? ["สปรินต์ที่ 1", "แผนพัฒนาสินค้า", "งานทีม Kanban", "เป้าหมายประจำสัปดาห์", "ระดมสมองไอเดีย"]
                  : ["Sprint 1", "Product Roadmap", "Team Kanban", "Weekly Milestones", "Brainstorm Ideas"]
                ).map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => setNewBoardName(sug)}
                    className="text-xs px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:border-[#4f63ef] text-slate-600 dark:text-slate-300 hover:text-[#4f63ef] dark:hover:text-[#a5b4fc] transition-colors cursor-pointer"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-slate-500">{t("Choose a layout", "เลือกรูปแบบบอร์ด")}</span>
                <span className="text-xs text-slate-400">{t("You can switch views anytime", "สลับมุมมองได้ทุกเมื่อ")}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {BOARD_TYPES.map((bt) => {
                  const selected = newBoardType === bt.id;
                  return (
                    <button
                      key={bt.id}
                      onClick={() => {
                        setNewBoardType(bt.id);
                        if (!newBoardName.trim()) setNewBoardName(bt.defaultName || "");
                      }}
                      aria-pressed={selected}
                      className={`text-left p-3 rounded-xl border transition-all cursor-pointer ${selected
                        ? theme === "dark" ? "border-[#4f63ef] bg-[#4f63ef]/15 ring-1 ring-[#4f63ef]/50" : "border-[#4f63ef] bg-[#eef2ff] ring-1 ring-[#4f63ef]/30"
                        : theme === "dark" ? "border-[#334155] bg-[#0f172a] hover:border-[#4f63ef]" : "border-slate-200 bg-[#f8fafc] hover:border-[#c7d2fe]"
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold flex items-center gap-1.5 flex-wrap">
                          {lang === "th" ? bt.labelTh : bt.label}
                          {bt.id === "kanban" && <span className="start-badge">{t("Easiest start", "เริ่มต้นง่ายที่สุด")}</span>}
                          <span className="text-[11px] font-medium text-slate-400 px-1.5 py-0.5 rounded bg-slate-200/50 dark:bg-slate-800">
                            {lang === "th" ? bt.categoryTh : bt.category}
                          </span>
                        </span>
                        {selected && <Check size={14} className="text-[#4f63ef] dark:text-[#a5b4fc]" />}
                      </div>
                      <p className={`text-[13px] mt-1 leading-snug ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>{lang === "th" ? bt.hintTh : bt.hint}</p>
                      <div className="h-16 mt-2 overflow-hidden rounded-lg border border-[#e2e8f0] dark:border-[#334155] bg-white dark:bg-[#0f172a] pointer-events-none">
                        <BoardFormatPreview format={bt.id} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {createError && <p role="alert" className="text-xs text-rose-500">{createError}</p>}
            </div>

            <div className="create-board-actions flex items-center justify-end gap-2.5">
              <button
                onClick={() => setShowCreateModal(false)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${theme === "dark" ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }`}
              >
                {t("Cancel", "ยกเลิก")}
              </button>
              <button
                onClick={createNewBoard}
                disabled={isCreatingBoard}
                className="px-5 py-2.5 bg-[#4f63ef] hover:bg-[#4051d6] text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-[#4f63ef]/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isCreatingBoard ? t("Creating...", "กำลังสร้าง...") : t("Create board", "สร้างบอร์ด")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Centered Glassmorphic Rename Board Modal */}
      {renameModalData && (
        <div
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setRenameModalData(null)}
        >
          <div
            className={`w-full max-w-md rounded-3xl border shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150 ${theme === "dark" ? "bg-[#172033] border-[#334155] text-slate-100" : "bg-white border-slate-200 text-slate-800"
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-[#4f63ef]/10 text-[#4f63ef] dark:text-[#a5b4fc] border border-[#4f63ef]/20">
                  <Edit2 size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold">{t("Rename Board", "เปลี่ยนชื่อบอร์ด")}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t("Enter a new name for your board", "ระบุชื่อใหม่สำหรับบอร์ดของคุณ")}</p>
                </div>
              </div>
              <button
                onClick={() => setRenameModalData(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1 cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("Board Name", "ชื่อบอร์ด")}</label>
              <input
                type="text"
                autoFocus
                value={renameInputValue}
                onChange={(e) => setRenameInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveRename();
                  if (e.key === "Escape") setRenameModalData(null);
                }}
                className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#4f63ef] font-semibold transition-all ${theme === "dark" ? "bg-[#0f172a] border-[#334155] text-slate-100 placeholder:text-slate-600" : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400"
                  }`}
                placeholder={t("Board name...", "ชื่อบอร์ด...")}
              />
            </div>

            {renameError && <p role="alert" className="text-xs text-rose-500">{renameError}</p>}

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setRenameModalData(null)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${theme === "dark" ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }`}
              >
                {t("Cancel", "ยกเลิก")}
              </button>
              <button
                onClick={handleSaveRename}
                disabled={!renameInputValue.trim() || isSavingRename}
                className="px-5 py-2.5 bg-[#4f63ef] hover:bg-[#4051d6] text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-[#4f63ef]/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSavingRename ? t("Saving...", "กำลังบันทึก...") : t("Save Changes", "บันทึกการเปลี่ยนแปลง")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Centered Glassmorphic Delete Confirm Modal */}
      {deleteModalData && (
        <div
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setDeleteModalData(null)}
        >
          <div
            className={`w-full max-w-md rounded-3xl border shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150 ${theme === "dark" ? "bg-[#172033] border-[#334155] text-slate-100" : "bg-white border-slate-200 text-slate-800"
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-rose-500">{t("Delete Board?", "ยืนยันการลบบอร์ด?")}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t("This action cannot be undone", "การดำเนินการนี้ไม่สามารถย้อนกลับได้")}</p>
                </div>
              </div>
              <button
                onClick={() => setDeleteModalData(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1 cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed bg-rose-500/5 p-3.5 rounded-xl border border-rose-500/10">
              {t("Are you sure you want to delete", "คุณแน่ใจหรือไม่ว่าต้องการลบบอร์ด")} <strong className="text-slate-800 dark:text-slate-100 font-bold">"{deleteModalData.name}"</strong>? {t("All columns, tasks, and data inside this board will be permanently removed.", "คอลัมน์ การ์ดงาน และข้อมูลทั้งหมดในบอร์ดนี้จะถูกลบอย่างถาวร")}
            </p>

            {deleteError && <p role="alert" className="text-xs text-rose-500">{deleteError}</p>}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setDeleteModalData(null)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${theme === "dark" ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }`}
              >
                {t("Cancel", "ยกเลิก")}
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeletingBoard}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-rose-500/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isDeletingBoard ? t("Deleting...", "กำลังลบ...") : t("Delete Board", "ลบบอร์ด")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
