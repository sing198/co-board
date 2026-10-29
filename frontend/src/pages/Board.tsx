import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Link as LinkIcon, Edit2, Trash2, LogOut, AlertCircle, Wifi, WifiOff, X, ChevronDown, ChevronRight, Sun, Moon, UserPlus, Globe, Bell, Check, Search, Tag, FileText, Image, Calendar, Clock, CheckSquare, LayoutDashboard, GanttChart, Network, Timer, MoreHorizontal } from "lucide-react";

import { toPng } from "html-to-image";

import { useWebSocket } from "../useWebSocket";
import type { Card, CardNote } from "../useWebSocket";
import { useAuth } from "../useAuth";
import { useTheme } from "../useTheme";
import { useNotifications } from "../useNotifications";
import AssignmentNotices from "../components/AssignmentNotices";
import { API_URL } from "../config";
import WorkspaceSidebar, { KanbanMark } from "../components/WorkspaceSidebar";
import BoardTaskViews from "../components/BoardTaskViews";
import BoardCanvasViews from "../components/BoardCanvasViews";
import ScrumBoard from "../components/ScrumBoard";
import TaskPlanningFields from "../components/TaskPlanningFields";
import CreateTaskDialog from "../components/CreateTaskDialog";
import type { NewTaskDetails } from "../components/CreateTaskDialog";
import { defaultBoardView, isBoardView } from "../boardFormats";
import type { BoardView } from "../boardFormats";
import { dueBucket, localDate } from "../boardDates";

const VIEW_HINTS: Record<BoardView, string> = {
  board: "Drag a card between columns. Click it when you want to add details.",
  list: "Click a task to open it. Use the status menu to move it.",
  due: "Tasks are grouped by when they are due. Click one to change the date.",
  calendar: "Tasks appear on their due date. Click one to open it.",
  timeline: "Each bar is a task from its start date to its due date.",
  mindmap: "Click an idea to open it, or add a branch from it.",
  scrum: "Choose tasks for this sprint, then start it when you are ready.",
};

function AvatarImage({ src, name, className, title }: { src: string; name: string; className: string; title?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <div
        className={`${className} bg-gradient-to-br from-[#4f63ef] to-[#6366f1] text-white font-extrabold flex items-center justify-center uppercase shadow-xs text-[10px]`}
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

const COLUMN_STYLES = [
  {
    // Column 1: TODO (Neutral Grey)
    headerPill: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 font-bold px-3 py-1 rounded-md",
    cardBorder: "border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500",
  },
  {
    // Column 2: DOING (Soft Pastel Blue)
    headerPill: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300 font-bold px-3 py-1 rounded-md",
    cardBorder: "border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500",
  },
  {
    // Column 3: DONE (Soft Pastel Green)
    headerPill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-bold px-3 py-1 rounded-md",
    cardBorder: "border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-500",
  },
  {
    // Column 4: Purple/Violet
    headerPill: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300 font-bold px-3 py-1 rounded-md",
    cardBorder: "border border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-500",
  },
  {
    // Column 5: Warm Yellow/Amber
    headerPill: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 font-bold px-3 py-1 rounded-md",
    cardBorder: "border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-500",
  },
  {
    // Column 6: Coral/Pink
    headerPill: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300 font-bold px-3 py-1 rounded-md",
    cardBorder: "border border-slate-200 dark:border-slate-700 hover:border-rose-300 dark:hover:border-rose-500",
  },
];

const SWIMLANE_TAG_COLORS = [
  "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 font-bold border border-blue-100 dark:border-blue-900",
  "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 font-bold border border-violet-100 dark:border-violet-900",
  "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-bold border border-emerald-100 dark:border-emerald-900",
  "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300 font-bold border border-cyan-100 dark:border-cyan-900",
  "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 font-bold border border-amber-100 dark:border-amber-900",
  "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 font-bold border border-rose-100 dark:border-rose-900",
];

const adjustHeight = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

const TAG_PRESETS = [
  { name: "Testing", bg: "bg-slate-100 dark:bg-slate-800/60", text: "text-slate-600 dark:text-slate-300", border: "border-slate-200 dark:border-slate-700" },
  { name: "Bug", bg: "bg-rose-500/15 dark:bg-rose-950/40", text: "text-rose-600 dark:text-rose-400", border: "border-rose-200 dark:border-rose-800/60" },
  { name: "Feature", bg: "bg-indigo-50 dark:bg-indigo-950/40", text: "text-indigo-600 dark:text-indigo-300", border: "border-indigo-100 dark:border-indigo-800/60" },
  { name: "Urgent", bg: "bg-amber-500/15 dark:bg-amber-950/40", text: "text-amber-600 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800/60" },
  { name: "Design", bg: "bg-violet-50 dark:bg-violet-950/40", text: "text-violet-600 dark:text-violet-300", border: "border-violet-100 dark:border-violet-800/60" },
  { name: "Docs", bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-100 dark:border-emerald-800/60" },
];

const COLOR_PALETTES = [
  { bg: "bg-rose-500/15 dark:bg-rose-950/40", text: "text-rose-600 dark:text-rose-400", border: "border-rose-200 dark:border-rose-800/60" },
  { bg: "bg-indigo-50 dark:bg-indigo-950/40", text: "text-indigo-600 dark:text-indigo-300", border: "border-indigo-100 dark:border-indigo-800/60" },
  { bg: "bg-amber-500/15 dark:bg-amber-950/40", text: "text-amber-600 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800/60" },
  { bg: "bg-violet-50 dark:bg-violet-950/40", text: "text-violet-600 dark:text-violet-300", border: "border-violet-100 dark:border-violet-800/60" },
  { bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-100 dark:border-emerald-800/60" },
  { bg: "bg-cyan-50 dark:bg-cyan-950/40", text: "text-cyan-700 dark:text-cyan-300", border: "border-cyan-100 dark:border-cyan-800/60" },
  { bg: "bg-pink-50 dark:bg-pink-950/40", text: "text-pink-600 dark:text-pink-300", border: "border-pink-100 dark:border-pink-800/60" },
  { bg: "bg-blue-50 dark:bg-blue-950/40", text: "text-blue-600 dark:text-blue-300", border: "border-blue-100 dark:border-blue-800/60" },
];

const getTagColor = (name: string) => {
  const preset = TAG_PRESETS.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (preset) return preset;

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLOR_PALETTES.length;
  return COLOR_PALETTES[index];
};
const BOARD_BACKGROUND_PRESETS: Record<string, { name: string; class: string; previewBg: string }> = {
  default: {
    name: "Clean Slate",
    class: "",
    previewBg: "from-slate-300 to-slate-500",
  },
  cyberpunk: {
    name: "Cyberpunk Midnight",
    class: "bg-gradient-to-br from-indigo-50/80 via-slate-50/60 to-violet-50/70 dark:from-[#0f172a] dark:via-[#172033] dark:to-indigo-950",
    previewBg: "from-indigo-500 to-violet-700",
  },
  sunset: {
    name: "Sunset Amber",
    class: "bg-gradient-to-br from-amber-50/80 via-orange-50/60 to-rose-50/70 dark:from-[#0f172a] dark:via-orange-950 dark:to-rose-950",
    previewBg: "from-amber-400 to-rose-500",
  },
  aurora: {
    name: "Emerald Aurora",
    class: "bg-gradient-to-br from-emerald-50/80 via-slate-50/60 to-teal-50/70 dark:from-emerald-950 dark:via-[#0f172a] dark:to-teal-950",
    previewBg: "from-emerald-400 to-teal-600",
  },
  ocean: {
    name: "Ocean Breeze",
    class: "bg-gradient-to-br from-sky-50/80 via-slate-50/60 to-blue-50/70 dark:from-sky-950 dark:via-[#0f172a] dark:to-blue-950",
    previewBg: "from-sky-400 to-blue-600",
  },
  pastel: {
    name: "Pastel Lavender",
    class: "bg-gradient-to-br from-violet-50/80 via-rose-50/60 to-indigo-50/70 dark:from-violet-950 dark:via-[#0f172a] dark:to-indigo-950",
    previewBg: "from-violet-300 to-indigo-400",
  },
};

const getDueDateBadge = (dueDateStr?: string) => {
  const bucket = dueBucket(dueDateStr);
  const date = localDate(dueDateStr);
  if (!date || bucket === "none") return null;
  const short = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (bucket === "overdue") return { label: `Overdue · ${short}`, tone: "overdue" as const };
  if (bucket === "today") return { label: "Today", tone: "today" as const };
  if (bucket === "upcoming") return { label: `Due ${short}`, tone: "upcoming" as const };
  return { label: short, tone: "later" as const };
};

function DraggableCard({
  id,
  cardData,
  title,
  tags,
  columnIndex,
  swimlaneName,
  swimlaneIndex,
  onEdit,
  onUpdateTags,
  onDelete,
  onOpenDetail,
  canEdit,
  assignee
}: {
  id: string,
  cardData: any,
  title: string,
  tags?: string,
  columnIndex: number,
  swimlaneName?: string,
  swimlaneIndex?: number,
  onEdit: (id: string, newTitle: string, expectedTitle?: string) => void,
  onUpdateTags?: (id: string, newTags: string) => void,
  onDelete: (id: string) => void,
  onOpenDetail?: (card: any) => void,
  canEdit: boolean,
  assignee?: { name: string; avatarUrl?: string } | null
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const editBase = useRef(title);
  const [isTagPopoverOpen, setIsTagPopoverOpen] = useState(false);
  const [customTagInput, setCustomTagInput] = useState("");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : isTagPopoverOpen ? 30 : 1,
  };

  const colStyle = COLUMN_STYLES[columnIndex % COLUMN_STYLES.length];
  const tagColor = swimlaneIndex !== undefined ? SWIMLANE_TAG_COLORS[swimlaneIndex % SWIMLANE_TAG_COLORS.length] : SWIMLANE_TAG_COLORS[0];
  const cardTags = tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [];

  const handleSave = () => {
    if (editTitle.trim() && editTitle.trim() !== title) {
      onEdit(id, editTitle.trim(), editBase.current);
    } else {
      setEditTitle(title);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`bg-white dark:bg-[#172033] border-2 border-[#4f63ef] p-4 rounded-2xl shadow-lg w-full max-w-full flex flex-col gap-3`}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <textarea
          ref={(el) => adjustHeight(el)}
          autoFocus
          rows={1}
          aria-label="Task title"
          value={editTitle}
          onChange={(e) => {
            setEditTitle(e.target.value);
            adjustHeight(e.target);
          }}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            } else if (e.key === "Escape") {
              setEditTitle(title);
              setIsEditing(false);
            }
          }}
          className="w-full bg-transparent border-none text-slate-900 dark:text-slate-100 focus:outline-none text-sm font-semibold leading-relaxed resize-none overflow-hidden [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap pr-6"
        />

        {swimlaneName && (
          <span className={`self-start px-2.5 py-0.5 rounded-lg text-[11px] font-bold tracking-tight shadow-xs ${tagColor}`}>
            {swimlaneName}
          </span>
        )}
      </div>
    );
  }

  const activeListeners = isTagPopoverOpen ? {} : listeners;
  const dueBadge = getDueDateBadge(cardData.DueDate);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...activeListeners}
      onClick={() => {
        if (!isTagPopoverOpen && onOpenDetail) {
          onOpenDetail(cardData);
        }
      }}
      className={`board-task-card bg-white dark:bg-[#172033] border ${colStyle.cardBorder} p-4 rounded-2xl ${isTagPopoverOpen ? "cursor-default" : "cursor-pointer"} group transition-all duration-150 w-full max-w-full flex flex-col gap-2.5 shadow-xs hover:shadow-md relative`}
    >
      <div className="task-eyebrow"><span>TSK-{String(id).padStart(3, "0")}</span><span className="task-status-dot" style={{ background: ["#94a3b8", "#6366f1", "#10b981"][columnIndex % 3] }} /></div>
      <button type="button" aria-label={`Open task: ${title}`} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onOpenDetail?.(cardData); }} className={`task-title-button text-left text-sm font-semibold text-slate-800 dark:text-slate-100 w-full min-w-0 [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap leading-relaxed ${canEdit ? "pr-6" : ""}`}>
        {title}
      </button>

      {cardData.Description && <p className="task-description">{cardData.Description}</p>}
      {canEdit && (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs z-10">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setEditTitle(title);
              editBase.current = title;
              setIsEditing(true);
            }}
            className="p-1 text-slate-400 hover:text-[#4f63ef] dark:hover:text-[#a5b4fc] rounded transition-colors"
            aria-label="Rename Task" title="Rename Task"
          >
            <Edit2 size={13} />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(id);
            }}
            className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded transition-colors"
            aria-label="Delete Task" title="Delete Task"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {(dueBadge || cardData.Checklist || assignee) && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {assignee && (
            <span className="task-assignee" title={assignee.name}>
              {assignee.avatarUrl ? <img src={assignee.avatarUrl} alt="" /> : <span aria-hidden="true">{(assignee.name[0] || "?").toUpperCase()}</span>}
              {assignee.name === "Assigned" ? "Assigned" : (assignee.name.split(" ")[0] || assignee.name)}
            </span>
          )}
          {dueBadge && (
            <span className={`task-due task-due-${dueBadge.tone}`}>
              <Clock size={13} /> {dueBadge.label}
            </span>
          )}

          {cardData.Checklist && (() => {
            try {
              const items = JSON.parse(cardData.Checklist);
              if (Array.isArray(items) && items.length > 0) {
                const done = items.filter((i: any) => i.done).length;
                return (
                  <span className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold border flex items-center gap-1 shadow-2xs ${
                    done === items.length
                      ? "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/20"
                      : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                  }`}>
                    <CheckSquare size={10} /> {done}/{items.length}
                  </span>
                );
              }
            } catch (e) {}
            return null;
          })()}
        </div>
      )}

      {/* Tags & Swimlane Pills */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {swimlaneName && (
          <span className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold tracking-tight shadow-2xs ${tagColor}`}>
            {swimlaneName}
          </span>
        )}

        {cardTags.map((tagName) => {
          const colorObj = getTagColor(tagName);
          return (
            <span key={tagName} className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold border ${colorObj?.bg || ''} ${colorObj?.text || ''} ${colorObj?.border || ''} shadow-2xs transition-all hover:scale-105`}>
              {tagName}
            </span>
          );
        })}

        {canEdit && onUpdateTags && (
          <div className="relative">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setIsTagPopoverOpen(!isTagPopoverOpen);
              }}
              className={`p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-opacity flex items-center gap-0.5 text-[10px] font-bold cursor-pointer ${
                isTagPopoverOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
              title="Add / Edit Tags"
            >
              <Tag size={11} />
              {cardTags.length === 0 && <span className="text-[10px]">+ Tag</span>}
            </button>

            {isTagPopoverOpen && (
              <>
                {/* Fullscreen Backdrop overlay to close popover on outside click */}
                <div
                  className="fixed inset-0 z-40 bg-transparent cursor-default"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsTagPopoverOpen(false);
                  }}
                />

                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="absolute left-0 top-full mt-2 w-48 p-2.5 bg-white dark:bg-[#172033] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl z-50 flex flex-col gap-1.5 text-xs animate-in fade-in zoom-in-95 duration-100 max-h-72 overflow-y-auto"
                >
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 pb-1 border-b border-slate-100 dark:border-slate-800">
                    Select Tags
                  </div>

                  {/* Preset Tags */}
                  {TAG_PRESETS.map((preset) => {
                    const hasTag = cardTags.some(t => t.toLowerCase() === preset.name.toLowerCase());
                    return (
                      <button
                        key={preset.name}
                        onClick={(e) => {
                          e.stopPropagation();
                          let newTags: string[];
                          if (hasTag) {
                            newTags = cardTags.filter(t => t.toLowerCase() !== preset.name.toLowerCase());
                          } else {
                            newTags = [...cardTags, preset.name];
                          }
                          onUpdateTags(id, newTags.join(","));
                        }}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${preset.bg} ${preset.text} ${preset.border} ${hasTag ? "ring-2 ring-[#4f63ef] shadow-xs" : "opacity-80 hover:opacity-100"}`}
                      >
                        <span>{preset.name}</span>
                        {hasTag && <Check size={12} />}
                      </button>
                    );
                  })}

                  {/* Custom Tags currently on this card */}
                  {cardTags.filter(t => !TAG_PRESETS.some(p => p.name.toLowerCase() === t.toLowerCase())).map((customTag) => {
                    const colorObj = getTagColor(customTag);
                    return (
                      <button
                        key={customTag}
                        onClick={(e) => {
                          e.stopPropagation();
                          const newTags = cardTags.filter(t => t.toLowerCase() !== customTag.toLowerCase());
                          onUpdateTags(id, newTags.join(","));
                        }}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ring-2 ring-[#4f63ef] shadow-xs ${colorObj?.bg || ''} ${colorObj?.text || ''} ${colorObj?.border || ''}`}
                      >
                        <span>{customTag}</span>
                        <X size={12} className="hover:text-rose-500" />
                      </button>
                    );
                  })}

                  {/* Add Custom Tag Input Section */}
                  <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
                      Custom Tag
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        placeholder="New tag..."
                        value={customTagInput}
                        onChange={(e) => setCustomTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const trimmed = customTagInput.trim();
                            if (trimmed && !cardTags.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
                              onUpdateTags(id, [...cardTags, trimmed].join(","));
                              setCustomTagInput("");
                            }
                          }
                        }}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#4f63ef]"
                      />
                      <button
                        onClick={() => {
                          const trimmed = customTagInput.trim();
                          if (trimmed && !cardTags.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
                            onUpdateTags(id, [...cardTags, trimmed].join(","));
                            setCustomTagInput("");
                          }
                        }}
                        className="px-2 py-1 bg-[#4f63ef] hover:bg-[#4051d6] text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer flex-shrink-0"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {cardData.LatestNote ? <p className="task-note" title={cardData.LatestNote}>{cardData.LatestNote}</p> : null}
    </div>
  );
}

function SwimlaneDropZone({
  id,
  children,
  isEmpty,
  isDragging
}: {
  id: string;
  children: React.ReactNode;
  isEmpty?: boolean;
  isDragging?: boolean;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className="min-h-[50px] flex flex-col gap-2.5">
      {children}
      {isEmpty && isDragging && <div className="board-empty-drop" aria-hidden="true">Drop here</div>}
      {isEmpty && !isDragging && <div className="board-empty-note" aria-hidden="true">No tasks yet</div>}
    </div>
  );
}

function noteStamp(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const decodeInviteRole = (tokenStr: string | null): "edit" | "view" | null => {
  if (!tokenStr) return null;
  try {
    const base64Url = tokenStr.split(".")[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const parsed = JSON.parse(jsonPayload);
    return parsed.role === "edit" || parsed.role === "view" ? parsed.role : null;
  } catch {
    return null;
  }
};

export function CardDetailModal({
  card,
  cards = [],
  boardType = "kanban",
  canEdit,
  theme,
  swimlanes,
  columns,
  members = [],
  currentUserId = 0,
  shareHint = "member",
  noteFeed = [],
  onAddNote,
  onShare,
  onMove,
  onClose,
  onEditDetail,
  onDeleteCard,
}: {
  card: any;
  cards?: Card[];
  boardType?: string;
  canEdit: boolean;
  theme: string;
  swimlanes: string[];
  columns: string[];
  members?: Array<{ id: number; name: string; avatarUrl?: string; assignable?: boolean }>;
  currentUserId?: number;
  shareHint?: "owner" | "guest" | "member";
  noteFeed?: CardNote[];
  onAddNote?: (cardId: string, text: string) => boolean;
  onShare?: () => void;
  onMove: (cardId: string, column: string) => void;
  onClose: () => void;
  onEditDetail: (cardId: string, details: any, baseline?: Record<string,string>) => boolean | void;
  onDeleteCard: (cardId: string, title: string) => void;
}) {
  const baseline = useRef<Record<string,string>>({title:card.Title || "",description:card.Description || "",dueDate:card.DueDate || "",startDate:card.StartDate || "",dependencies:card.Dependencies || "",parentId:card.ParentID || "",storyPoints:String(card.StoryPoints || 0),inSprint:String(!!card.InSprint),assigneeId:String(card.AssigneeID || 0),checklist:card.Checklist || "",tags:card.Tags || "",swimlane:card.Swimlane || ""});
  const assigneeID = Number(card.AssigneeID || 0);
  const assigneeChoices = members.filter((member) => member.assignable || member.id === assigneeID);
  const onlyYou = canEdit && members.some((member) => member.id === currentUserId) && !members.some((member) => member.assignable && member.id !== currentUserId);
  const saveDetail = (id: string, changes: Record<string,string>) => {
    const accepted = onEditDetail(id, changes, { ...baseline.current });
    if (accepted === false) return false;
    Object.assign(baseline.current, changes);
    return true;
  };
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input, button, select")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const [title, setTitle] = useState(card.Title || "");
  const [description, setDescription] = useState(card.Description || "");
  const [checklist, setChecklist] = useState<Array<{ id: string; text: string; done: boolean }>>(() => {
    try {
      const parsed = card.Checklist ? JSON.parse(card.Checklist) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  });
  const [newItemText, setNewItemText] = useState("");
  const [notes, setNotes] = useState<CardNote[]>([]);
  const [showEarlier, setShowEarlier] = useState(false);
  const [draft, setDraft] = useState("");

  const cardId = card.ID.toString();

  useEffect(() => {
    let cancelled = false;
    setShowEarlier(false);
    setDraft("");
    if (!card.BoardID) {
      setNotes(card.LatestNote ? [{ ID: 0, CardID: Number(card.ID), Text: card.LatestNote }] : []);
      return;
    }
    setNotes([]);
    const jwt = sessionStorage.getItem("kanban_jwt") || localStorage.getItem("kanban_jwt");
    const headers: Record<string, string> = jwt ? { Authorization: `Bearer ${jwt}` } : {};
    const invite = new URLSearchParams(window.location.search).get("inviteToken") || "";
    const query = invite ? `?inviteToken=${encodeURIComponent(invite)}` : "";
    fetch(`${API_URL}/api/boards/${card.BoardID}/cards/${card.ID}/notes${query}`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error("notes unavailable");
        return response.json();
      })
      .then((body: unknown) => {
        if (cancelled) return;
        const fetched = Array.isArray(body) ? body as CardNote[] : [];
        setNotes((prev) => {
          const ids = new Set(fetched.map((note) => note.ID));
          const extras = prev.filter((note) => Number(note.CardID) === Number(card.ID) && !ids.has(note.ID));
          return [...extras, ...fetched].slice(0, 20);
        });
      })
      .catch(() => {
        if (cancelled) return;
        setNotes((prev) => {
          if (prev.some((note) => Number(note.CardID) === Number(card.ID))) return prev;
          return card.LatestNote ? [{ ID: 0, CardID: Number(card.ID), Text: card.LatestNote }] : [];
        });
      });
    return () => { cancelled = true; };
  }, [card.ID, card.BoardID]);

  useEffect(() => {
    const incoming = [...noteFeed].reverse().filter((note) => Number(note.CardID) === Number(card.ID));
    if (incoming.length === 0) return;
    setNotes((prev) => {
      const unseen = incoming.filter((note) => !prev.some((item) => item.ID === note.ID));
      if (unseen.length === 0) return prev;
      return [...unseen, ...prev].slice(0, 20);
    });
  }, [noteFeed, card.ID]);

  const handleSaveTitle = () => {
    if (title.trim() && title.trim() !== card.Title) {
      saveDetail(cardId, { title: title.trim() });
    }
  };

  const handleSaveDescription = () => {
    if (description !== card.Description) {
      saveDetail(cardId, { description });
    }
  };

  const rawSwim = (card.Swimlane || "").trim();
  const effectiveSwimlane = (rawSwim && rawSwim !== "Untitled" && swimlanes.includes(rawSwim)) ? rawSwim : (swimlanes.length > 0 ? swimlanes[0] : "Untitled");

  return (
    <div
      className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-label="Task details"
        onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') || []);
            const first = elements[0], last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
        className={`w-full max-w-2xl rounded-3xl border shadow-2xl p-6 flex flex-col gap-5 my-8 max-h-[90vh] overflow-y-auto ${
          theme === "dark" ? "bg-[#172033] border-[#334155] text-slate-100" : "bg-white border-slate-200 text-slate-800"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b pb-4 border-slate-100 dark:border-slate-800">
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <input
              type="text"
              value={title}
              readOnly={!canEdit}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSaveTitle}
              className={`text-lg font-bold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-[#4f63ef] rounded-lg px-1 py-0.5 w-full ${
                theme === "dark" ? "text-slate-100" : "text-slate-900"
              }`}
              aria-label="Task title" placeholder="Task title..."
            />
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2.5 py-0.5 rounded-lg font-bold ${
                theme === "dark" ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"
              }`}>
                <label>Column: <select aria-label="Move task to column" disabled={!canEdit} value={card.List} onChange={event => onMove(cardId, event.target.value)} className="bg-transparent rounded px-1">{columns.map(column => <option key={column} value={column}>{column}</option>)}</select></label>
              </span>
              {swimlanes.length > 0 ? (
                <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-lg font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-800/50">
                  <span className="opacity-75">Group:</span>
                  <select
                    aria-label="Move task to group"
                    disabled={!canEdit}
                    value={effectiveSwimlane}
                    onChange={(e) => {
                      const newSwim = e.target.value;
                      saveDetail(cardId, { swimlane: newSwim });
                    }}
                    className="bg-transparent font-bold focus:outline-none cursor-pointer"
                  >
                    {swimlanes.map((s) => (
                      <option key={s} value={s} className={theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-800"}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          </div>

          <button
            aria-label="Close task details"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`assignee-${cardId}`} className="text-xs font-bold text-slate-400 uppercase tracking-wider">Assignee</label>
          <select
            id={`assignee-${cardId}`}
            aria-label="Assignee"
            aria-describedby={onlyYou ? "assignee-hint" : undefined}
            disabled={!canEdit}
            value={String(assigneeID)}
            onChange={(event) => saveDetail(cardId, { assigneeId: event.target.value })}
            className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#4f63ef] ${theme === "dark" ? "bg-slate-900/60 border-slate-700 text-slate-100" : "bg-slate-50 border-slate-200 text-slate-800"}`}
          >
            <option value="0">Unassigned</option>
            {assigneeChoices.map((member) => <option key={member.id} value={String(member.id)}>{member.name}</option>)}
          </select>
          {onlyYou && (
            <p className="assignee-hint" id="assignee-hint">
              <span>
                {shareHint === "guest"
                  ? "Sign in to share this board and assign someone else."
                  : shareHint === "owner"
                    ? "Share this board to assign someone else."
                    : "Ask the owner to share this board before you can assign someone else."}
              </span>
              {shareHint !== "member" && (
                <button type="button" onClick={onShare}>
                  {shareHint === "guest" ? "Sign in" : "Share"}
                </button>
              )}
            </p>
          )}
        </div>

        <section className="task-notes" aria-label="Notes">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Notes</div>
          {notes.length === 0 ? <p>Moves and short notes show up here.</p> : (
            <ul>
              {(showEarlier ? notes : notes.slice(0, 8)).map((note) => {
                const when = noteStamp(note.CreatedAt);
                return (
                  <li key={note.ID} className={note.Kind === "comment" ? "is-comment" : undefined}>
                    <span>{note.Text}</span>
                    {when ? <time dateTime={note.CreatedAt}>{when}</time> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {notes.length > 8 && !showEarlier ? <button type="button" onClick={() => setShowEarlier(true)}>Show earlier</button> : null}
          {canEdit ? (
            <form onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              if (!text || !onAddNote) return;
              if (onAddNote(cardId, text)) setDraft("");
            }}>
              <input aria-label="Short note" placeholder="Add a short note" maxLength={280} value={draft} onChange={(event) => setDraft(event.target.value)} />
              <button type="submit" disabled={!draft.trim()}>Add note</button>
            </form>
          ) : null}
        </section>

        <TaskPlanningFields card={card} cards={cards} boardType={boardType} canEdit={canEdit} onSave={changes => saveDetail(cardId, changes)} />

        {/* Description */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
            <FileText size={14} className="text-[#4f63ef] dark:text-[#a5b4fc]" /> Description
          </div>
          <textarea
            rows={3}
            readOnly={!canEdit}
            aria-label="Task description" placeholder="Add a more detailed description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleSaveDescription}
            className={`w-full p-3 rounded-2xl border text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#4f63ef] leading-relaxed resize-y ${
              theme === "dark" ? "bg-slate-900/60 border-slate-700 text-slate-100 placeholder:text-slate-500" : "bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400"
            }`}
          />
        </div>

        {/* Checklist */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <CheckSquare size={14} className="text-[#10b981]" /> Checklist
            </div>
            {checklist.length > 0 && (
              <span className="text-xs font-bold text-[#10b981]">
                {Math.round((checklist.filter((i) => i.done).length / checklist.length) * 100)}%
              </span>
            )}
          </div>

          {checklist.length > 0 && (
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#10b981] transition-all duration-300 rounded-full"
                style={{ width: `${(checklist.filter((i) => i.done).length / checklist.length) * 100}%` }}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {checklist.map((item, idx) => (
              <div key={item.id || idx} className="flex items-center gap-2.5 group">
                <input
                  aria-label={`Complete ${item.text}`} type="checkbox"
                  disabled={!canEdit}
                  checked={item.done}
                  onChange={(e) => {
                    const updated = checklist.map((i, iIdx) => (iIdx === idx ? { ...i, done: e.target.checked } : i));
                    setChecklist(updated);
                    saveDetail(cardId, { checklist: JSON.stringify(updated) });
                  }}
                  className="w-4 h-4 rounded text-[#4051d6] accent-[#4051d6] cursor-pointer"
                />
                <span className={`text-xs font-medium flex-1 ${item.done ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-200"}`}>
                  {item.text}
                </span>
                {canEdit && (
                  <button
                    aria-label={`Remove checklist item: ${item.text}`}
                    onClick={() => {
                      const updated = checklist.filter((_, iIdx) => iIdx !== idx);
                      setChecklist(updated);
                      saveDetail(cardId, { checklist: JSON.stringify(updated) });
                    }}
                    className="text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}

            {canEdit && (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  aria-label="New checklist item" placeholder="Add a checklist item..."
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newItemText.trim()) {
                      e.preventDefault();
                      const updated = [...checklist, { id: Date.now().toString(), text: newItemText.trim(), done: false }];
                      setChecklist(updated);
                      setNewItemText("");
                      saveDetail(cardId, { checklist: JSON.stringify(updated) });
                    }
                  }}
                  className={`flex-1 px-3 py-1.5 rounded-xl border text-xs focus:outline-none ${
                    theme === "dark" ? "bg-slate-900/60 border-slate-700 text-slate-100" : "bg-slate-50 border-slate-200 text-slate-800"
                  }`}
                />
                <button
                  onClick={() => {
                    if (newItemText.trim()) {
                      const updated = [...checklist, { id: Date.now().toString(), text: newItemText.trim(), done: false }];
                      setChecklist(updated);
                      setNewItemText("");
                      saveDetail(cardId, { checklist: JSON.stringify(updated) });
                    }
                  }}
                  className="px-3 py-1.5 bg-[#4f63ef] hover:bg-[#4051d6] text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-4 border-slate-100 dark:border-slate-800 mt-2">
          {canEdit && (
            <button
              onClick={() => onDeleteCard(cardId, card.Title)}
              className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold rounded-xl border border-rose-500/20 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 size={14} /> Delete Task
            </button>
          )}

          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#4f63ef] hover:bg-[#4051d6] text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-[#4f63ef]/20 cursor-pointer ml-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Board() {
  const { boardId } = useParams();
  const [searchParams] = useSearchParams();
  const { user, login, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const token = (sessionStorage.getItem("kanban_jwt") || localStorage.getItem("kanban_jwt"));

  const {
    cards,
    boardName,
    boardType,
    sprint,
    updateSprint,
    columns,
    swimlanes,
    accessLevel,
    boardBackground,
    ownerId,
    editInviteToken,
    viewInviteToken,
    status,
    errorToast,
    boardError, retryBoard,
    onlineUsers,
    operations, pendingDeletes, undoDelete, retryOperation, refreshBoard, applyGrantedRole, dismissOperation,
    moveCard,
    addCard,
    editCard,
    editCardDetail,
    addCardNote,
    noteFeed,
    updateCardTags,
    deleteCard,
    updateBoardName,
    updateBoardBackground,
    addColumn,
    deleteColumn,
    renameColumn,
    addSwimlane,
    deleteSwimlane,
    renameSwimlane,
    updateBoardAccess,
    userRole
  } = useWebSocket(boardId || "", token);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>("All");
  const [selectedDueFilter, setSelectedDueFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const [boardView, setBoardView] = useState<BoardView>(() => {
    try {
      const saved = localStorage.getItem(`co_board_view_v2_${boardId}`);
      return isBoardView(saved) ? saved : "board";
    } catch { return "board"; }
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!boardType) return;
    try {
      const saved = localStorage.getItem(`co_board_view_v2_${boardId}`);
      setBoardView(isBoardView(saved) && (saved !== "scrum" || boardType === "sprint") ? saved : defaultBoardView(boardType));
    } catch { setBoardView(defaultBoardView(boardType)); }
  }, [boardId, boardType]);
  const chooseBoardView = (view: BoardView) => {
    setBoardView(view);
    try { localStorage.setItem(`co_board_view_v2_${boardId}`, view); } catch { /* Local preferences are optional. */ }
  };
  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || element?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  const [isExporting, setIsExporting] = useState(false);

  // Card Detail Modal states
  const [selectedCardDetail, setSelectedCardDetail] = useState<any | null>(null);

  const currentCardDetail = useMemo(() => {
    if (!selectedCardDetail) return null;
    return cards.find((c) => c.ID.toString() === selectedCardDetail.ID.toString()) || selectedCardDetail;
  }, [selectedCardDetail, cards]);

  const handleOpenCardDetail = useCallback((card: any) => {
    setSelectedCardDetail(card);
  }, []);
  const openedFromLink = useRef("");
  useEffect(() => {
    const due = searchParams.get("due");
    if (due === "overdue" || due === "today" || due === "upcoming" || due === "later" || due === "none") {
      setSelectedDueFilter(due);
      if (boardType) setBoardView("due");
    }
  }, [searchParams, boardType]);
  useEffect(() => {
    const taskId = searchParams.get("task");
    if (!taskId || openedFromLink.current === taskId) return;
    const card = cards.find((item) => String(item.ID) === taskId);
    if (!card) return;
    openedFromLink.current = taskId;
    setSelectedCardDetail(card);
  }, [searchParams, cards]);
  const boardContainerRef = useRef<HTMLDivElement | null>(null);

  const handleExportPNG = async () => {
    if (!boardContainerRef.current) return;
    try {
      setIsExporting(true);
      const dataUrl = await toPng(boardContainerRef.current, { cacheBust: true, quality: 0.95 });
      const link = document.createElement("a");
      link.download = `${boardName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${boardView}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Export PNG failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = () => {
    window.print();
  };

  const filteredCards = cards.filter((c) => {
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch = !query || `${c.Title} ${c.Description || ""} TSK-${String(c.ID).padStart(3, "0")}`.toLowerCase().includes(query);
    const cardTags = c.Tags ? c.Tags.split(",").map(t => t.trim().toLowerCase()) : [];
    const matchesTag = selectedTagFilter === "All" || cardTags.includes(selectedTagFilter.toLowerCase());
    const matchesDue = selectedDueFilter === "all" || dueBucket(c.DueDate) === selectedDueFilter;
    const matchesMine = !mineOnly || Number(c.AssigneeID) === Number(user?.id);
    return matchesSearch && matchesTag && matchesDue && matchesMine;
  });

  const allBoardTags = React.useMemo(() => {
    const tagSet = new Set<string>();
    cards.forEach(c => {
      if (c.Tags) {
        c.Tags.split(",").forEach(t => {
          const trimmed = t.trim();
          if (trimmed) tagSet.add(trimmed);
        });
      }
    });
    return Array.from(tagSet);
  }, [cards]);

  const [addingToKey, setAddingToKey] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creatingTask, setCreatingTask] = useState<NewTaskDetails | null>(null);
  const quickAddSubmittedRef = useRef(false);
  const submitQuickTask = (title: string, column: string, position: number, swimlane: string) => {
    if (quickAddSubmittedRef.current) return;
    quickAddSubmittedRef.current = true;
    if (title.trim()) addCard(title.trim(), column, position, swimlane);
    setNewTaskTitle("");
    setAddingToKey(null);
  };
  const openFormatTask = (details: NewTaskDetails = {}) => {
    if (!columns.length || !canEdit || status !== "connected") return;
    setCreatingTask(details);
  };
  const openQuickAdd = () => {
    if (!columns.length || !canEdit || status !== "connected") return;
    if (boardView !== "board") { openFormatTask(); return; }
    quickAddSubmittedRef.current = false;
    setSearchQuery(""); setSelectedTagFilter("All"); setSelectedDueFilter("all"); setMineOnly(false);
    const swim = swimlanes[0] || "Untitled";
    setCollapsedSwimlanes(prev => ({ ...prev, [swim]: false }));
    setAddingToKey(`${columns[0]}:::${swim}`);
    setNewTaskTitle("");
  };
  const openColumnQuickAdd = (columnName: string) => {
    if (!columns.length || !canEdit || status !== "connected") return;
    quickAddSubmittedRef.current = false;
    const swim = swimlanes[0] || "Untitled";
    setCollapsedSwimlanes(prev => ({ ...prev, [swim]: false }));
    setAddingToKey(`${columnName}:::${swim}`);
    setNewTaskTitle("");
  };
  const moveFromAlternateView = (card: Card, column: string) => {
    if (column === card.List || status !== "connected" || !canEdit) return;
    const position = Math.max(0, ...cards.filter(item => item.List === column && (item.Swimlane || "Untitled") === (card.Swimlane || "Untitled")).map(item => item.Position || 0)) + 1000;
    moveCard(String(card.ID), column, position, card.Swimlane || "Untitled");
  };
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnPointer = (event: MouseEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewsMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewsOpen) return;
    const closeOnPointer = (event: MouseEvent) => {
      if (!viewsMenuRef.current?.contains(event.target as Node)) setViewsOpen(false);
    };
    document.addEventListener("mousedown", closeOnPointer);
    return () => document.removeEventListener("mousedown", closeOnPointer);
  }, [viewsOpen]);
  const [showGuestShareModal, setShowGuestShareModal] = useState(false);
  const [showGuestExitModal, setShowGuestExitModal] = useState(false);
  const [guestLogoutRequested, setGuestLogoutRequested] = useState(false);
  const [guestExitError, setGuestExitError] = useState("");
  const [isDiscardingGuestBoard, setIsDiscardingGuestBoard] = useState(false);
  const [isEditingBoardName, setIsEditingBoardName] = useState(false);
  const [tempBoardName, setTempBoardName] = useState("");
  const [collapsedSwimlanes, setCollapsedSwimlanes] = useState<Record<string, boolean>>({});
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [copySuccessToast, setCopySuccessToast] = useState(false);
  const [shareLinkRole, setShareLinkRole] = useState<"edit" | "view">("edit");
  useEffect(() => {
    if (!isShareModalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsShareModalOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isShareModalOpen]);
  const shareToken = shareLinkRole === "edit" ? editInviteToken : viewInviteToken;
  const shareUrl = shareToken && boardId ? `${window.location.origin}/b/${boardId}?inviteToken=${shareToken}` : "";
  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopySuccessToast(true);
      window.setTimeout(() => setCopySuccessToast(false), 3000);
    } catch {
      setCopySuccessToast(false);
    }
  };
  const chooseShareRole = (role: "edit" | "view") => {
    setShareLinkRole(role);
    setCopySuccessToast(false);
  };
  const [boardMembers, setBoardMembers] = useState<Array<{
    id: number;
    name: string;
    email: string;
    avatarUrl: string;
    role: string;
    isOwner: boolean;
    assignable?: boolean;
  }>>([]);
  const memberById = useMemo(() => {
    const map = new Map<number, { id: number; name: string; avatarUrl: string }>();
    for (const member of boardMembers) map.set(member.id, { id: member.id, name: member.name, avatarUrl: member.avatarUrl });
    return map;
  }, [boardMembers]);

  const fetchBoardMembers = useCallback(async () => {
    if (!boardId) return;
    const token = (sessionStorage.getItem("kanban_jwt") || localStorage.getItem("kanban_jwt"));
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/boards/${boardId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBoardMembers(data || []);
      }
    } catch (err) {
      console.error("Failed fetching board members:", err);
    }
  }, [boardId]);

  useEffect(() => {
    if (boardType || isShareModalOpen) fetchBoardMembers();
  }, [boardType, isShareModalOpen, fetchBoardMembers]);

  const isLoggingInRef = useRef(false);
  const handleLogin = useCallback((bId: string) => {
    isLoggingInRef.current = true;
    login(bId);
  }, [login]);



  // Access Request & Notifications System
  const { notifications, assignments, markAssignmentSeen, unreadCount, requestAccess, respondToAccess } = useNotifications();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [accessRequestStatus, setAccessRequestStatus] = useState<"none" | "pending" | "approved">("none");

  const handleRequestAccess = async () => {
    if (!boardId) return;
    setIsRequestingAccess(true);
    const res = await requestAccess(boardId);
    setIsRequestingAccess(false);
    if (!res) return;
    // The server only returns approved when this person is already an editor.
    if (res.status === "approved") {
      applyGrantedRole("edit");
      void refreshBoard();
      return;
    }
    setAccessRequestStatus("pending");
  };

  useEffect(() => {
    if (userRole === "edit" || userRole === "owner") setAccessRequestStatus("none");
  }, [userRole]);

  const urlParams = new URLSearchParams(window.location.search);
  const currentInviteToken = urlParams.get("inviteToken");
  const inviteRole = decodeInviteRole(currentInviteToken);

  const isLoggedIn = !!user;
  const isOwner = isLoggedIn && ownerId !== null && user.id === ownerId;
  const isGrantedEditor = userRole === "edit" || (userRole !== "view" && accessRequestStatus === "approved");

  const canEditIfLoggedIn =
    isGrantedEditor ||
    inviteRole === "edit" ||
    (accessLevel === "edit" && inviteRole !== "view");

  const canEdit =
    isLoggedIn && (
      isOwner ||
      canEditIfLoggedIn
    );
  const showViewOnlyNote = user ? !canEdit : !canEditIfLoggedIn;
  const signedInViewer = !!user && user.email !== "guest@kanban.demo";

  // Intercept Browser Back Button (<) and Tab Closing (X) for Guest Owners
  useEffect(() => {
    if (!user || user.email !== "guest@kanban.demo" || !isOwner) return;

    window.history.pushState(null, "", window.location.href);

    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
      setShowGuestExitModal(true);
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isLoggingInRef.current) return;
      e.preventDefault();
      e.returnValue = "You have unsaved changes in Guest Mode. Sign in to save your board permanently.";
      return e.returnValue;
    };

    // Reloading a guest board must preserve it. Explicit exit/logout handles deletion.
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [user, isOwner, boardId]);

  const toggleSwimlane = (swim: string) => setCollapsedSwimlanes((prev) => ({ ...prev, [swim]: !prev[swim] }));

  // Custom Dark Glassmorphism Modal Card Box States
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    type: "confirm" | "rename";
    title: string;
    description?: string;
    initialValue?: string;
    onConfirm?: (val?: string) => void;
  }>({
    isOpen: false,
    type: "confirm",
    title: "",
  });
  const [modalInputVal, setModalInputVal] = useState("");

  const openConfirmModal = (title: string, description: string, onConfirm: () => void) => {
    setModalConfig({
      isOpen: true,
      type: "confirm",
      title,
      description,
      onConfirm: () => {
        onConfirm();
        closeModal();
      }
    });
  };

  const openRenameModal = (title: string, initialValue: string, onSave: (val: string) => void) => {
    setModalInputVal(initialValue);
    setModalConfig({
      isOpen: true,
      type: "rename",
      title,
      initialValue,
      onConfirm: (val) => {
        if (val && val.trim() && val.trim() !== initialValue) {
          onSave(val.trim());
        }
        closeModal();
      }
    });
  };

  const closeModal = () => {
    setModalConfig(prev => ({ ...prev, isOpen: false }));
    setModalInputVal("");
  };

  const confirmationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modalConfig.isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = confirmationRef.current;
    dialog?.querySelector<HTMLElement>('input, [data-cancel]')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeModal(); }
      if (event.key === "Tab") {
        const elements = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || []);
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    dialog?.addEventListener("keydown", handleKey);
    return () => { dialog?.removeEventListener("keydown", handleKey); if (previous?.isConnected) previous.focus(); };
  }, [modalConfig.isOpen]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!canEdit) return;
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId === overId) return;

    const activeCard = cards.find((c: any) => c.ID.toString() === activeId);
    if (!activeCard) return;

    let targetList = activeCard.List;
    let targetSwimlane = activeCard.Swimlane || "Untitled";

    if (overId.includes(":::")) {
      const parts = overId.split(":::");
      targetList = parts[0];
      targetSwimlane = parts[1] || "Untitled";
    } else if (columns.includes(overId)) {
      targetList = overId;
      targetSwimlane = activeCard.Swimlane || "Untitled";
    } else {
      const overCard = cards.find((c: any) => c.ID.toString() === overId);
      if (overCard) {
        targetList = overCard.List;
        targetSwimlane = overCard.Swimlane || "Untitled";
      }
    }

    const targetCards = cards
      .filter((c: any) => c.List === targetList && (swimlanes.length === 0 || (c.Swimlane || "Untitled") === targetSwimlane))
      .sort((a: any, b: any) => (a.Position ?? 0) - (b.Position ?? 0));

    let newPosition = 1000;

    if (activeCard.List === targetList && (activeCard.Swimlane || "Untitled") === targetSwimlane) {
      const oldIndex = targetCards.findIndex((c: any) => c.ID.toString() === activeId);
      const newIndex = overId.includes(":::")
        ? targetCards.length - 1
        : targetCards.findIndex((c: any) => c.ID.toString() === overId);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered: any[] = arrayMove(targetCards, oldIndex, newIndex);
        const finalIdx = reordered.findIndex((c: any) => c.ID.toString() === activeId);

        if (finalIdx === 0) {
          const nextPos = reordered[1]?.Position ?? 2000;
          newPosition = nextPos > 0 ? nextPos / 2 : 500;
        } else if (finalIdx === reordered.length - 1) {
          const prevPos = reordered[reordered.length - 2]?.Position ?? 0;
          newPosition = prevPos + 1000;
        } else {
          const prevPos = reordered[finalIdx - 1]?.Position ?? 0;
          const nextPos = reordered[finalIdx + 1]?.Position ?? 2000;
          newPosition = (prevPos + nextPos) / 2;
        }
      } else {
        return;
      }
    } else {
      const otherCards = targetCards.filter((c: any) => c.ID.toString() !== activeId);
      const overIdx = overId.includes(":::")
        ? otherCards.length
        : otherCards.findIndex((c: any) => c.ID.toString() === overId);

      if (overIdx <= 0) {
        const firstPos = otherCards[0]?.Position ?? 2000;
        newPosition = firstPos > 0 ? firstPos / 2 : 500;
      } else if (overIdx >= otherCards.length) {
        const lastPos = otherCards[otherCards.length - 1]?.Position ?? 0;
        newPosition = lastPos + 1000;
      } else {
        const prevPos = otherCards[overIdx - 1]?.Position ?? 0;
        const nextPos = otherCards[overIdx]?.Position ?? 2000;
        newPosition = (prevPos + nextPos) / 2;
      }
    }

    moveCard(activeId, targetList, newPosition, targetSwimlane);
  };





  const handleWorkspaceLogout = () => {
    if (user?.email === "guest@kanban.demo" && boardId && isOwner) {
      setGuestLogoutRequested(true);
      setGuestExitError("");
      setShowGuestExitModal(true);
      return;
    }
    if (user?.email === "guest@kanban.demo" && !window.confirm("Log out of your guest session? You may lose access to your guest boards.")) return;
    isLoggingInRef.current = true;
    logout();
  };

  if (!boardId) return null;
  if (boardError) return <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6"><section className="max-w-md text-center space-y-4 dark:text-white"><h1 className="text-2xl font-bold">{boardError === "missing" ? "Board not found" : "You don’t have access to this board"}</h1><p>{boardError === "missing" ? "This board may have been deleted or the link is incorrect." : "Sign in with an account that has access, or ask the owner for an invitation."}</p><div className="flex justify-center gap-4"><button className="new-task-button" onClick={() => navigate("/")}>Back to dashboard</button><button onClick={retryBoard}>Try again</button>{boardError === "forbidden" && <button onClick={() => handleLogin(boardId)}>Sign in</button>}</div></section></main>;
  if (!boardType) return <main className="app-loading"><section className="text-center space-y-4"><p role={errorToast ? "alert" : "status"}>{errorToast || "Loading your board…"}</p>{errorToast && <button className="new-task-button" onClick={retryBoard}>Try again</button>}<button onClick={() => navigate("/")}>Back to dashboard</button></section></main>;


  const bgPresetClass = BOARD_BACKGROUND_PRESETS[boardBackground]?.class || "";

  return (
    <div className={`board-workspace min-h-screen font-sans relative selection:bg-[#4f63ef]/20 transition-all duration-300 ${
      bgPresetClass || (theme === "dark" ? "bg-[#0f172a] text-slate-100" : "bg-[#f8fafc] text-[#172033]")
    }`}>

      <div className="mutation-feedback" aria-label="Task save status">
        {pendingDeletes.map(id => <div key={id} className="mutation-notice"><span role="status">This task will be deleted in a few seconds.</span><button onClick={() => undoDelete(id)}>Undo</button></div>)}
        {operations.map(op => <div key={op.id} className={`mutation-notice mutation-${op.state}`}><span role={op.state === "error" || op.state === "unknown" ? "alert" : "status"}>{op.label}: {op.state === "saving" ? "Saving…" : op.state === "saved" ? "Saved" : op.message}</span>{op.state === "error" && <button disabled={status !== "connected"} onClick={() => retryOperation(op.id)}>Retry</button>}{op.state === "unknown" && <button onClick={refreshBoard}>Refresh board</button>}{op.state !== "saving" && <button aria-label={`Dismiss ${op.label} status`} onClick={() => dismissOperation(op.id)}><X size={14} /></button>}</div>)}
      </div>
      <WorkspaceSidebar onLogout={handleWorkspaceLogout} user={user} activePage="board" cardCount={cards.length}
        note={VIEW_HINTS[boardView]}
        role={isOwner ? "Full access" : canEdit ? "Can edit" : "View only"}
        onOverview={() => document.getElementById("board-overview")?.scrollIntoView({ block: "start" })}
        onAllBoards={() => navigate("/")}>
        {swimlanes.length > 1 && <>
          <div className="sidebar-section-label">GROUPS</div>
          {swimlanes.map((name, index) => (
            <button key={name} onClick={() => document.getElementById(`workstream-${index}`)?.scrollIntoView({ block: "start" })} className="sidebar-stream"><i style={{ background: ["#818cf8", "#7dd3fc", "#6ee7b7"][index % 3] }} />{name}</button>
          ))}
        </>}
      </WorkspaceSidebar>
      {status !== "connected" && (
        <div role="status" className="bg-amber-100 text-amber-950 px-4 py-3 text-center text-sm">
          {status === "connecting" ? "Connecting…" : "Connection lost. Reconnecting…"}
          {" "}You can keep looking. Edits wait until the connection is back.
        </div>
      )}
      {/* Toast Alert Banner */}
      {errorToast && (
        <div role="alert" className="bg-rose-50 text-rose-900 px-4 py-3 flex items-center justify-center gap-2 border-b border-rose-200">
          <AlertCircle size={18} />
          <span className="text-sm font-semibold">{errorToast}</span>
        </div>
      )}

      {/* Sleek Top Navigation Header */}
      <header className={`board-topbar px-6 py-3.5 border-b flex items-center justify-between backdrop-blur-md sticky top-0 z-40 transition-colors ${theme === "dark" ? "bg-[#0f172a]/95 border-[#334155]" : "bg-white border-slate-200 shadow-xs"
        }`}>

        {/* Header Left: Brand Logo & Board Title */}
        <div className="board-brand flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 group cursor-pointer select-none"
            aria-label="Go to dashboard"
            title="Go to Dashboard"
          >
            <span className="mobile-workspace-symbol"><KanbanMark /></span>
          </button>

          <div className={`h-4 w-px ${theme === "dark" ? "bg-[#172033]" : "bg-slate-200"}`} />

          {isEditingBoardName ? (
            <input
              type="text"
              value={tempBoardName}
              onChange={(e) => setTempBoardName(e.target.value)}
              onBlur={() => {
                if (tempBoardName.trim() && tempBoardName !== boardName) {
                  updateBoardName(tempBoardName.trim());
                }
                setIsEditingBoardName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (tempBoardName.trim() && tempBoardName !== boardName) {
                    updateBoardName(tempBoardName.trim());
                  }
                  setIsEditingBoardName(false);
                }
              }}
              autoFocus
              className={`border text-sm font-extrabold px-2 py-1 rounded-lg focus:outline-none shadow-xs ${theme === "dark" ? "bg-[#172033] border-[#4f63ef] text-slate-100" : "bg-white border-[#4f63ef] text-slate-900"
                }`}
            />
          ) : (
            <h1
              onClick={() => {
                if (isOwner) {
                  setTempBoardName(boardName);
                  setIsEditingBoardName(true);
                }
              }}
              className={`board-title text-sm font-extrabold transition-colors flex items-center gap-2 ${theme === "dark" ? "text-slate-100" : "text-slate-900"
                } ${isOwner ? "hover:text-[#4f63ef] dark:hover:text-[#a5b4fc] cursor-pointer" : ""}`}
            >
              {boardName}
              {isOwner && <span className="text-[10px] font-normal text-slate-400 opacity-0 group-hover:opacity-100">(click to edit)</span>}
            </h1>
          )}
        </div>

        {/* Header Right Status & User */}
        <div className="board-top-actions flex items-center gap-3">
          {status === "connected" && onlineUsers.length > 0 && <div className="board-presence" aria-label={`${onlineUsers.length} users on this board`}>
            <div className="presence-avatars">{onlineUsers.slice(0, 4).map(person => <span key={person.id} tabIndex={0} aria-label={`${person.name || "Visitor"}${String(person.id) === String(user?.id) ? " (you)" : ""} — online`} title={`${person.name || "Visitor"}${String(person.id) === String(user?.id) ? " (you)" : ""}`}><AvatarImage src={person.avatarUrl} name={person.name || "Visitor"} className="presence-avatar" /><i aria-hidden="true" /></span>)}{onlineUsers.length > 4 && <span className="presence-overflow" title={onlineUsers.slice(4).map(p => p.name).join(", ")}>+{onlineUsers.length - 4}</span>}</div>
            <span className="presence-count">{onlineUsers.length} online</span>
          </div>}

          <button
            onClick={toggleTheme}
            className={`p-1.5 rounded-xl border transition-colors cursor-pointer ${theme === "dark"
              ? "bg-[#172033] text-amber-400 hover:bg-[#334155] border-[#334155]"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
              }`}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <div role="status" className={`workspace-connection px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border transition-all ${status === "connected"
            ? theme === "dark" ? "bg-[#022c22]/60 border-[#064e3b]/80 text-[#6ee7b7]" : "bg-[#ecfdf5] border-[#a7f3d0] text-[#047857]"
            : status === "connecting"
              ? "bg-amber-50 border-amber-200 text-amber-700 animate-pulse"
              : "bg-rose-50 border-rose-200 text-rose-700 animate-pulse"
            }`}>
            {status === "connected" ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span className="capitalize">{status}</span>
          </div>

          {/* Notifications Bell Dropdown (Miro Screenshot 3, 4 & 5) */}
          {user && (
            <div className="relative">
              <button
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className={`p-1.5 rounded-xl border transition-all cursor-pointer relative ${theme === "dark"
                  ? "bg-[#172033] text-slate-200 hover:bg-[#334155] border-[#334155]"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
                  }`}
                aria-label="Notifications" title="Notifications"
              >
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-[#4051d6] text-white text-[10px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center border-2 border-white dark:border-[#0f172a] shadow-xs">
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
                      Notifications
                      {unreadCount > 0 && (
                        <span className="bg-[#e0e7ff] text-[#4338ca] dark:bg-[#243052]/60 dark:text-[#a5b4fc] text-[10px] px-2 py-0.5 rounded-full font-bold">
                          {unreadCount} unread
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
                        No notifications yet
                      </div>
                    ) : (
                      <>
                      <AssignmentNotices items={assignments} onOpen={(id) => { void markAssignmentSeen(id); setIsNotificationsOpen(false); }} />
                      {notifications.map((item) => (
                        <div
                          key={item.id}
                          className={`p-3 rounded-xl border transition-all ${item.status === "pending"
                            ? theme === "dark" ? "bg-[#172033]/20 border-[#3730a3]/40" : "bg-[#eef2ff]/50 border-[#e0e7ff]"
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
                                <span className="font-bold">{item.userName}</span> asked to edit <span className="font-semibold text-[#4f63ef] dark:text-[#a5b4fc]">{item.boardName}</span>
                              </p>

                              {/* Notification Actions */}
                              <div className="mt-2.5 flex items-center gap-2">
                                {item.status === "pending" ? (
                                  <>
                                    <button
                                      onClick={() => respondToAccess(item.id, "approve")}
                                      className="px-3 py-1 bg-[#4f63ef] hover:bg-[#4051d6] text-white text-xs font-bold rounded-lg transition-all cursor-pointer shadow-xs"
                                    >
                                      Allow editing
                                    </button>
                                    <button
                                      onClick={() => respondToAccess(item.id, "dismiss")}
                                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-lg transition-all cursor-pointer"
                                    >
                                      Dismiss
                                    </button>
                                  </>
                                ) : item.status === "approved" ? (
                                  <span className="text-xs font-bold text-[#059669] dark:text-[#6ee7b7] flex items-center gap-1">
                                    <Check size={14} /> Editing allowed
                                  </span>
                                ) : (
                                  <span className="text-xs font-medium text-slate-400">
                                    Request dismissed
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
          )}

          <button
            onClick={() => {
              if (!user || user.email === "guest@kanban.demo") {
                setShowGuestShareModal(true);
              } else {
                setIsShareModalOpen(true);
              }
            }}
            className={`workspace-share px-4 py-1.5 rounded-xl text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${theme === "dark" ? "bg-[#4f63ef] hover:bg-[#4051d6] shadow-md shadow-[#4f63ef]/20" : "bg-[#4f63ef] hover:bg-[#4051d6] shadow-md shadow-[#4f63ef]/20"
              }`}
          >
            <LinkIcon size={13} /> Share
          </button>

          {user ? (
            <div className={`workspace-mobile-account flex items-center gap-2.5 px-3 py-1 rounded-xl border ${theme === "dark" ? "bg-[#172033] border-[#334155]" : "bg-slate-50 border-slate-200"
              }`}>
              <AvatarImage
                src={user.avatarUrl}
                name={user.name}
                className="w-6 h-6 rounded-full object-cover"
              />
              <span className={`text-xs font-semibold ${theme === "dark" ? "text-slate-200" : "text-slate-700"}`}>{user.name}</span>
              <button
                onClick={handleWorkspaceLogout}
                className="text-slate-400 hover:text-rose-600 transition-colors ml-1 cursor-pointer"
                aria-label="Logout" title="Logout"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleLogin(boardId || "")}
              className="px-3.5 py-1.5 bg-[#4f63ef] hover:bg-[#4051d6] text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-[#4f63ef]/20"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {user?.email === "guest@kanban.demo" && isOwner && <div className="guest-session-notice" role="note"><span><strong>Guest session</strong> · Logging out of this board deletes it. Sign in to keep it.</span><button onClick={() => handleLogin(boardId || "")}>Sign in to save</button></div>}
      {showViewOnlyNote && (
        <div className="view-only-note" role="note">
          <p>
            {signedInViewer
              ? accessRequestStatus === "pending"
                ? "You can look at this board. Your request is with the owner."
                : "You can look at this board. Ask the owner if you need to change it."
              : "You can look at this board. Sign in to ask the owner if you need to change it."}
          </p>
          {signedInViewer && accessRequestStatus === "none" && (
            <button type="button" onClick={handleRequestAccess} disabled={isRequestingAccess}>
              {isRequestingAccess ? "Sending request..." : "Request editor rights"}
            </button>
          )}
          {!signedInViewer && (
            <button type="button" onClick={() => handleLogin(boardId || "")}>Sign in</button>
          )}
        </div>
      )}
      <section id="board-overview" className="board-overview" aria-label="Board overview">
        <div className="overview-copy">

          <h2>{boardName}</h2>

          <div className="overview-meta">{(boardView === "board" || boardView === "scrum") && swimlanes.length > 1 && <span><UserPlus size={14} /> {swimlanes.length} groups</span>}<span className="overview-access">{isOwner ? "Full access" : canEdit ? "Can edit" : "View only"}</span><span><strong>{cards.length}</strong> {cards.length === 1 ? "task on this board" : "tasks on this board"}</span></div>
        </div>
        <div className="overview-action">
          {canEdit && columns.length > 0 && <button className="new-task-button" disabled={status !== "connected"} onClick={openQuickAdd}><Plus size={17} /> {boardView === "mindmap" ? "New idea" : "New task"}</button>}
        </div>
      </section>
      <div className="board-view-tabs">
        <div className="board-view-switch" role="group" aria-label="Board view">
          <button aria-pressed={boardView === "board"} title="Drag cards between columns" onClick={() => chooseBoardView("board")}><LayoutDashboard size={15} /> Board</button>
          <button aria-pressed={boardView === "list"} title="Every task in a list" onClick={() => chooseBoardView("list")}><FileText size={15} /> List</button>
          <div className="board-view-extra">
            <button aria-pressed={boardView === "calendar"} title="Tasks on their due dates" onClick={() => chooseBoardView("calendar")}><Calendar size={15} /> Calendar</button>
            <button aria-pressed={boardView === "timeline"} title="Tasks across a date range" onClick={() => chooseBoardView("timeline")}><GanttChart size={15} /> Timeline</button>
            <button aria-pressed={boardView === "mindmap"} title="Ideas connected as branches" onClick={() => chooseBoardView("mindmap")}><Network size={15} /> Mind map</button>
            {boardType === "sprint" && <button aria-pressed={boardView === "scrum"} title="Backlog and the current sprint" onClick={() => chooseBoardView("scrum")}><Timer size={15} /> Sprint</button>}
            <button aria-pressed={boardView === "due"} title="What is overdue, due today, or later" onClick={() => chooseBoardView("due")}><Clock size={15} /> Due</button>
          </div>
          <div className="board-view-more-wrap" ref={viewsMenuRef}>
            <button
              type="button"
              className="board-view-more"
              aria-expanded={viewsOpen}
              aria-haspopup="menu"
              aria-pressed={boardView !== "board" && boardView !== "list"}
              onClick={() => setViewsOpen((open) => !open)}
            >
              {boardView === "calendar" ? "Calendar" : boardView === "timeline" ? "Timeline" : boardView === "mindmap" ? "Mind map" : boardView === "scrum" ? "Sprint" : boardView === "due" ? "Due" : "Views"}
            </button>
            {viewsOpen && (
              <div className="board-view-menu" role="menu">
                <button type="button" role="menuitem" aria-pressed={boardView === "calendar"} onClick={() => { chooseBoardView("calendar"); setViewsOpen(false); }}><Calendar size={15} /> Calendar</button>
                <button type="button" role="menuitem" aria-pressed={boardView === "timeline"} onClick={() => { chooseBoardView("timeline"); setViewsOpen(false); }}><GanttChart size={15} /> Timeline</button>
                <button type="button" role="menuitem" aria-pressed={boardView === "mindmap"} onClick={() => { chooseBoardView("mindmap"); setViewsOpen(false); }}><Network size={15} /> Mind map</button>
                {boardType === "sprint" && <button type="button" role="menuitem" aria-pressed={boardView === "scrum"} onClick={() => { chooseBoardView("scrum"); setViewsOpen(false); }}><Timer size={15} /> Sprint</button>}
                <button type="button" role="menuitem" aria-pressed={boardView === "due"} onClick={() => { chooseBoardView("due"); setViewsOpen(false); }}><Clock size={15} /> Due</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Search stays in view. Background, export, and shortcuts live in More. */}
      <div className={`board-toolbar px-6 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 ${
        theme === "dark" ? "bg-[#0f172a]/80 border-[#334155]" : "bg-slate-50 border-slate-200"
      }`}>
        {/* Left: Search input & Tag filters */}
        <div className="board-filter-group flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <div className={`board-search flex items-center gap-2 border rounded-xl px-3 py-1.5 min-w-[200px] md:min-w-[260px] ${
            theme === "dark" ? "bg-[#172033] border-[#334155]" : "bg-white border-slate-200 shadow-2xs"
          }`}>
            <Search size={14} className="text-slate-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label="Search tasks"
              placeholder="Find a task"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full bg-transparent text-xs focus:outline-none placeholder:text-slate-400 ${
                theme === "dark" ? "text-slate-100" : "text-slate-800"
              }`}
            />
            {searchQuery && (
              <button aria-label="Clear search" onClick={() => setSearchQuery("")} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X size={13} />
              </button>
            )}
          </div>

          <select aria-label="Filter by due date" value={selectedDueFilter} onChange={event => setSelectedDueFilter(event.target.value)} className="board-due-filter">
            <option value="all">Any time</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="upcoming">Next 7 days</option>
            <option value="later">Later</option>
            <option value="none">No due date</option>
          </select>
          {user && <button type="button" className="board-mine-filter" aria-pressed={mineOnly} title={mineOnly ? "Showing only tasks assigned to me" : "Show only tasks assigned to me"} onClick={() => setMineOnly((current) => !current)}>{mineOnly ? "✓ Mine" : "Mine"}</button>}

          <div className="board-filter-chips flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full">
            <button
              aria-pressed={selectedTagFilter === "All"}
              onClick={() => setSelectedTagFilter("All")}
              className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all border cursor-pointer ${
                selectedTagFilter === "All"
                  ? "bg-[#4f63ef] text-white border-[#4f63ef] shadow-2xs"
                  : theme === "dark" ? "bg-[#172033] text-slate-300 border-[#334155] hover:bg-slate-800" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              All tasks
            </button>
            {allBoardTags.map((tagName) => {
              const colorObj = getTagColor(tagName);
              const active = selectedTagFilter.toLowerCase() === tagName.toLowerCase();
              return (
                <button
                  key={tagName}
                  aria-pressed={active}
                  onClick={() => setSelectedTagFilter(active ? "All" : tagName)}
                  className={`px-2.5 py-1 rounded-full text-xs font-extrabold border transition-all cursor-pointer ${colorObj?.bg || ''} ${colorObj?.text || ''} ${
                    active ? "ring-2 ring-[#4f63ef] shadow-2xs" : (colorObj?.border || '') + " opacity-80 hover:opacity-100"
                  }`}
                >
                  {tagName}
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative" ref={moreMenuRef}>
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((open) => !open)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer ${
              theme === "dark"
                ? "bg-[#172033] hover:bg-[#334155] text-slate-200 border-[#334155]"
                : "bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-2xs"
            }`}
          >
            <MoreHorizontal size={16} />
            <span>More</span>
          </button>
          {moreOpen && (
            <div role="menu" className={`board-more-menu absolute right-0 mt-2 w-72 rounded-2xl border shadow-xl p-3 z-50 ${theme === "dark" ? "bg-[#172033] border-[#334155] text-slate-100" : "bg-white border-slate-200 text-slate-800"}`}>
              <p className="board-more-label">Background</p>
              <div className="flex flex-col gap-1 mb-3">
                {Object.entries(BOARD_BACKGROUND_PRESETS).map(([bgKey, bgItem]) => (
                  <button
                    key={bgKey}
                    type="button"
                    role="menuitem"
                    onClick={() => { updateBoardBackground(bgKey); setMoreOpen(false); }}
                    className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      boardBackground === bgKey
                        ? "bg-[#4f63ef]/10 text-[#4f63ef] dark:text-[#a5b4fc]"
                        : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full bg-gradient-to-tr ${bgItem.previewBg} border border-white/20`} />
                    <span>{bgItem.name}</span>
                    {boardBackground === bgKey && <Check size={12} className="ml-auto" />}
                  </button>
                ))}
              </div>
              <p className="board-more-label">Save a copy</p>
              <button type="button" role="menuitem" disabled={isExporting} onClick={() => { setMoreOpen(false); handleExportPNG(); }} className="board-more-action"><Image size={15} /> {isExporting ? "Saving…" : "Save as image"}</button>
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); handleExportPDF(); }} className="board-more-action"><FileText size={15} /> Print this board</button>
              <p className="board-more-label">Handy keys</p>
              <div className="board-more-keys">
                <span>Find a task <kbd>/</kbd></span>
                <span>Add the task <kbd>Enter</kbd></span>
                <span>Close or cancel <kbd>Esc</kbd></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MIRO KANBAN CANVAS */}
      {(searchQuery || selectedTagFilter !== "All" || selectedDueFilter !== "all" || mineOnly) && (
        <div className="board-results" aria-live="polite">
          <span>Showing {filteredCards.length} of {cards.length}</span>
          <button onClick={() => { setSearchQuery(""); setSelectedTagFilter("All"); setSelectedDueFilter("all"); setMineOnly(false); }}>Show all tasks</button>
        </div>
      )}
      {boardView === "board" && filteredCards.length === 0 && cards.length > 0 && (
        <div className="board-no-results" role="status">Nothing matches. Choose Show all tasks to see everything again.</div>
      )}
      {boardView === "board" ? <div className="board-scroll" role="region" aria-label="Task board, scroll horizontally to see more columns" tabIndex={0}>
      <main id="board-content" ref={boardContainerRef} className="board-canvas p-6 md:p-8 w-full max-w-[1920px] mx-auto relative z-10 flex flex-col gap-6" style={{ minWidth: Math.max(columns.length * 290 + 64, 354) }}>

        {/* Unauthenticated Edit Prompt Banner (Shown ONLY if logging in will grant edit access) */}
        {!user && canEditIfLoggedIn && (
          <div className={`border rounded-2xl p-4 flex items-center justify-between shadow-xs ${theme === "dark" ? "bg-[#172033]/40 border-[#3730a3]/60 text-slate-100" : "bg-[#eef2ff] border-[#c7d2fe] text-slate-800"
            }`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#e0e7ff] dark:bg-[#243052]/60 text-[#4f63ef] dark:text-[#a5b4fc] flex items-center justify-center font-bold text-sm">
                🔐
              </div>
              <div>
                <p className="text-xs font-bold">Sign in to make changes</p>
                <p className="text-[13px] opacity-75">You can look around now. Sign in when you want to add or move tasks.</p>
              </div>
            </div>
            <button
              onClick={() => handleLogin(boardId || "")}
              className="px-4 py-2 bg-[#4f63ef] hover:bg-[#4051d6] text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-[#4f63ef]/20 flex-shrink-0 cursor-pointer"
            >
              Sign in
            </button>
          </div>
        )}

        {/* View-Only Mode Indicator Badge (Shown when accessing via an explicit View-Only link) */}
        {(inviteRole === "view" || (!canEditIfLoggedIn && !canEdit)) && (
          <div className={`border rounded-2xl p-3.5 flex items-center justify-between shadow-xs ${theme === "dark" ? "bg-slate-900/60 border-slate-800 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-600"
            }`}>
            <div className="flex items-center gap-2.5">
              <span className="text-sm">👁️</span>
              <p className="text-xs font-semibold">
                You can look at this board, but not change it.
              </p>
            </div>
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={() => setIsDraggingCard(true)} onDragCancel={() => setIsDraggingCard(false)} onDragEnd={(event) => { setIsDraggingCard(false); handleDragEnd(event); }}>

          {/* Top Column Headers Row */}
          <div className="flex gap-6 items-center w-full px-1">
            {columns.map((col, colIdx) => {
              const totalColCards = cards.filter((c: any) => c.List === col).length;
              const colStyle = COLUMN_STYLES[colIdx % COLUMN_STYLES.length];

              return (
                <div key={col} className="board-column-heading flex-1 min-w-0 flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-xl text-xs font-bold ${colStyle.headerPill}`}>
                      {col}
                    </span>
                    <span className={`text-xs font-semibold ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>{totalColCards}</span>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openColumnQuickAdd(col)}
                        className="p-1 text-slate-400 hover:text-[#4f63ef] dark:hover:text-[#a5b4fc] rounded transition-colors cursor-pointer"
                        aria-label={`Add task to ${col}`} title={`Add task to ${col}`}
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        onClick={() => openRenameModal("Rename Column", col, (newName) => renameColumn(col, newName))}
                        className="p-1 text-slate-400 hover:text-[#4f63ef] dark:hover:text-[#a5b4fc] rounded transition-colors"
                        aria-label="Rename Column" title="Rename Column"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={() => openConfirmModal("Delete Column?", `Are you sure you want to delete column "${col}" and all its tasks?`, () => deleteColumn(col))}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                        aria-label="Delete Column" title="Delete Column"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  let name = "Column 1";
                  let count = 1;
                  while (columns.includes(name)) {
                    name = `Column ${++count}`;
                  }
                  addColumn(name);
                }}
                disabled={status !== "connected"}
                title="Add a column, such as Review"
                className="board-add-column-trailing"
              >
                <Plus size={14} /> Add column
              </button>
            )}
          </div>

          {/* Unified Swimlane Rows Section */}
          <div className="flex flex-col gap-6 w-full">
            {(swimlanes.length > 0 ? swimlanes : [""]).map((swim, swimIdx) => {
              const isCollapsed = !!collapsedSwimlanes[swim];
              const isFirstSwimlane = swimIdx === 0;
              const tagColor = SWIMLANE_TAG_COLORS[swimIdx % SWIMLANE_TAG_COLORS.length];
              const totalSwimCards = cards.filter((c: any) => {
                if (swimlanes.length === 0) return true;
                const cardSwim = (c.Swimlane || "").trim();
                if (cardSwim === swim) return true;
                if (isFirstSwimlane && (!cardSwim || cardSwim === "Untitled" || !swimlanes.includes(cardSwim))) return true;
                return false;
              }).length;

              return (
                <div id={`workstream-${swimIdx}`} key={swim || "default"} className="board-workstream flex flex-col gap-3 w-full">

                  {/* Swimlane Section Title Row with Collapsible Chevron */}
                  {swimlanes.length > 0 && (
                    <div className="workstream-heading flex items-center gap-2.5 py-1 group/swim">
                      <button
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-0.5 cursor-pointer"
                        onClick={() => toggleSwimlane(swim)}
                        title={isCollapsed ? "Expand group" : "Collapse group"}
                      >
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>

                      <span
                        onClick={() => {
                          if (canEdit) openRenameModal("Rename group", swim, (newName) => renameSwimlane(swim, newName));
                        }}
                        className={`px-3 py-1 rounded-xl text-xs font-bold shadow-xs cursor-pointer hover:scale-105 transition-all ${tagColor}`}
                        title="Click to rename this group"
                      >
                        {swim}
                      </span>

                      <span className={`text-xs font-semibold ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
                        ({totalSwimCards})
                      </span>

                      {canEdit && (
                        <div className="flex items-center gap-1 opacity-0 group-hover/swim:opacity-100 transition-opacity ml-1">
                          <button
                            onClick={() => openRenameModal("Rename group", swim, (newName) => renameSwimlane(swim, newName))}
                            className={`p-1 text-slate-400 hover:text-[#4f63ef] dark:hover:text-[#a5b4fc] rounded transition-colors cursor-pointer ${theme === "dark" ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
                            aria-label="Rename group" title="Rename group"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => openConfirmModal("Delete this group?", `Delete the group "${swim}"? Tasks in it stay on the board.`, () => deleteSwimlane(swim))}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-500/10 transition-colors cursor-pointer"
                            aria-label="Delete group" title="Delete group"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Swimlane Columns Grid */}
                  {!isCollapsed && (
                    <div className="flex gap-6 items-stretch w-full">
                      {columns.map((col, colIdx) => {
                        const rowSwim = swim || "Untitled";
                        const swimCards = filteredCards
                          .filter((c: any) => {
                            if (c.List !== col) return false;
                            if (swimlanes.length === 0) return true;
                            const cardSwim = (c.Swimlane || "").trim();
                            if (cardSwim === swim) return true;
                            if (isFirstSwimlane && (!cardSwim || cardSwim === "Untitled" || !swimlanes.includes(cardSwim))) return true;
                            return false;
                          })
                          .sort((a: any, b: any) => (a.Position ?? 0) - (b.Position ?? 0));
                        const swimCardIds = swimCards.map((c: any) => c.ID.toString());
                        const dropKey = `${col}:::${rowSwim}`;
                        const isAdding = addingToKey === dropKey;

                        return (
                          <div key={col} className="board-column flex-1 min-w-0 flex flex-col justify-between min-h-[100px] group/col">
                            <div className="flex flex-col">
                              <SortableContext items={swimCardIds} strategy={verticalListSortingStrategy}>
                                <SwimlaneDropZone id={dropKey} isEmpty={swimCards.length === 0 && !searchQuery && selectedTagFilter === "All" && selectedDueFilter === "all" && !mineOnly} isDragging={isDraggingCard}>
                                  {swimCards.map((c: any) => (
                                    <DraggableCard
                                      key={c.ID}
                                      id={c.ID.toString()}
                                      cardData={c}
                                      title={c.Title}
                                      tags={c.Tags}
                                      columnIndex={colIdx}
                                      swimlaneName={swimlanes.length > 0 ? ((c.Swimlane && c.Swimlane !== "Untitled") ? c.Swimlane : (swim || "Untitled")) : undefined}
                                      swimlaneIndex={swimIdx}
                                      onEdit={(id, title, expectedTitle) => editCard(id, title, undefined, expectedTitle)}
                                      onUpdateTags={updateCardTags}
                                      onDelete={(cardId) => openConfirmModal("Delete Task?", `Are you sure you want to delete task "${c.Title}"?`, () => deleteCard(cardId))}
                                      onOpenDetail={handleOpenCardDetail}
                                      canEdit={canEdit}
                                      assignee={Number(c.AssigneeID) ? (memberById.get(Number(c.AssigneeID)) || { name: "Assigned", avatarUrl: "" }) : null}
                                    />
                                  ))}
                                </SwimlaneDropZone>
                              </SortableContext>
                            </div>

                            {/* Full-width "+ Add task" button (Only visible on hover matching user mockups) */}
                            {canEdit && !isAdding && (
                              <button
                                onClick={() => {
                                  quickAddSubmittedRef.current = false;
                                  setAddingToKey(dropKey);
                                  setNewTaskTitle("");
                                }}
                                className={`mt-3 w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer opacity-100 ${
                                  theme === "dark"
                                    ? "bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60"
                                    : "bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200/80 shadow-2xs"
                                }`}
                              >
                                <Plus size={14} /> Add task
                              </button>
                            )}

                            {/* Inline Draft Card Creation Box (Clean Auto-Save on Blur/Enter, No Buttons) */}
                            {canEdit && isAdding && (
                              <div className={`mt-3 border-2 p-4 rounded-2xl flex flex-col gap-3 shadow-md w-full transition-all ${
                                theme === "dark" ? "bg-[#172033] border-[#4f63ef]" : "bg-white border-[#a5b4fc]"
                              }`}>
                                <textarea
                                  ref={(el) => adjustHeight(el)}
                                  autoFocus
                                  rows={2}
                                  placeholder="Task name, then Enter"
                                  value={newTaskTitle}
                                  onChange={(e) => {
                                    setNewTaskTitle(e.target.value);
                                    adjustHeight(e.target);
                                  }}
                                  onBlur={() => submitQuickTask(newTaskTitle, col, (swimCards[swimCards.length - 1]?.Position ?? 0) + 1000, swim || "Untitled")}
                                  className={`w-full bg-transparent border-none focus:outline-none text-xs font-semibold leading-relaxed resize-none overflow-hidden [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap ${
                                    theme === "dark" ? "text-slate-100 placeholder:text-slate-500" : "text-slate-900 placeholder:text-slate-400"
                                  }`}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                      e.preventDefault();
                                      submitQuickTask(newTaskTitle, col, (swimCards[swimCards.length - 1]?.Position ?? 0) + 1000, swim || "Untitled");
                                    } else if (e.key === "Escape") {
                                      quickAddSubmittedRef.current = true;
                                      setAddingToKey(null);
                                      setNewTaskTitle("");
                                    }
                                  }}
                                />

                                <div className="quick-add-actions">
                                  <span>Enter adds it. Esc cancels.</span>
                                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { quickAddSubmittedRef.current = true; setAddingToKey(null); setNewTaskTitle(""); }}>Cancel</button>
                                  <button type="button" className="quick-add-save" onMouseDown={(event) => event.preventDefault()} onClick={() => submitQuickTask(newTaskTitle, col, (swimCards[swimCards.length - 1]?.Position ?? 0) + 1000, swim || "Untitled")}>Add</button>
                                </div>
                                {swimlanes.length > 1 && (
                                  <div className="flex items-center justify-between pt-1">
                                    <span className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold tracking-tight shadow-2xs ${
                                      SWIMLANE_TAG_COLORS[swimIdx % SWIMLANE_TAG_COLORS.length]
                                    }`}>
                                      {swim || "Untitled"}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Soft Separator Line Between Swimlanes */}
                  {swimlanes.length > 0 && swimIdx < swimlanes.length - 1 && (
                    <div className={`border-b my-2 w-full ${theme === "dark" ? "border-[#334155]" : "border-slate-200"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </DndContext>
      </main>
      </div> : <div ref={boardContainerRef} className="task-view-export">
        {(boardView === "list" || boardView === "due") ? <BoardTaskViews cards={filteredCards} totalCards={cards.length} columns={columns} swimlanes={swimlanes} assignees={Object.fromEntries([...memberById].map(([id, person]) => [id, person.name]))} canEdit={canEdit} connected={status === "connected"} mode={boardView} onOpen={handleOpenCardDetail} onMove={moveFromAlternateView} onCreate={openQuickAdd} />
        : boardView === "scrum" ? <ScrumBoard cards={filteredCards} allCards={cards} columns={columns} sprint={sprint} saving={operations.some(operation => operation.label === "Update sprint" && operation.state === "saving")} canEdit={canEdit} connected={status === "connected"} onOpen={handleOpenCardDetail} onMove={moveFromAlternateView} onEdit={(card, changes) => editCardDetail(String(card.ID), changes)} onUpdateSprint={updateSprint} onCreate={openQuickAdd} />
        : <BoardCanvasViews cards={filteredCards} allCards={cards} totalCards={cards.length} boardName={boardName} mode={boardView} canEdit={canEdit} connected={status === "connected"} onOpen={handleOpenCardDetail} onCreate={openFormatTask} />}
      </div>}

      {creatingTask && <CreateTaskDialog columns={columns} initial={creatingTask} parentName={cards.find(card => String(card.ID) === creatingTask.parentId)?.Title} idea={boardView === "mindmap"} connected={status === "connected"} onClose={() => setCreatingTask(null)} onSave={(title, column, details) => {
        if (!canEdit || status !== "connected") return false;
        if (!addCard(title, column, Math.max(0, ...cards.filter(card => card.List === column).map(card => card.Position || 0)) + 1000, swimlanes[0] || "Untitled", details)) return false;
        setSearchQuery(""); setSelectedTagFilter("All"); setSelectedDueFilter("all"); setMineOnly(false);
        setCreatingTask(null);
        return true;
      }} />}

      {/* Miro Floating Toolbar at Bottom Center */}
      {canEdit && boardView === "board" && (
        <div className={`board-create-toolbar mx-auto mb-8 w-fit backdrop-blur-xl px-3 py-1.5 rounded-2xl border shadow-xl flex items-center gap-1.5 ${theme === "dark" ? "bg-[#0f172a]/95 border-[#334155] text-slate-200" : "bg-white/95 border-slate-200 text-slate-700"
          }`}>
          <button
            onClick={() => {
              const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];
              let letterIdx = 0;
              let name = `Team ${letters[letterIdx]}`;
              while (swimlanes.includes(name)) {
                letterIdx++;
                if (letterIdx < letters.length) {
                  name = `Team ${letters[letterIdx]}`;
                } else {
                  name = `Team ${letterIdx + 1}`;
                }
              }
              addSwimlane(name);
            }}
            className={`p-2 rounded-xl transition-all flex items-center gap-2 font-semibold text-xs group cursor-pointer ${theme === "dark" ? "hover:bg-[#172033] text-slate-300 hover:text-white" : "hover:bg-slate-100 text-slate-600 hover:text-slate-900"
              }`}
            disabled={status !== "connected"}
            title="Add a row to group tasks, for example by team"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="12" y1="12" x2="12" y2="20" />
              <line x1="8" y1="16" x2="16" y2="16" />
            </svg>
            <span>Add group</span>
          </button>

          <div className={`h-5 w-[1px] ${theme === "dark" ? "bg-[#172033]" : "bg-slate-200"}`} />

          <button
            onClick={() => {
              let name = "Column 1";
              let count = 1;
              while (columns.includes(name)) {
                name = `Column ${++count}`;
              }
              addColumn(name);
            }}
            className={`p-2 rounded-xl transition-all flex items-center gap-2 font-semibold text-xs group cursor-pointer ${theme === "dark" ? "hover:bg-[#172033] text-slate-300 hover:text-white" : "hover:bg-slate-100 text-slate-600 hover:text-slate-900"
              }`}
            disabled={status !== "connected"}
            title="Add a column, such as Review"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
              <line x1="6" y1="4" x2="6" y2="20" />
              <line x1="12" y1="12" x2="20" y2="12" />
              <line x1="16" y1="8" x2="16" y2="16" />
            </svg>
            <span>Add column</span>
          </button>
        </div>
      )}

      {/* Custom Light Glassmorphic Modal Card Box (Centered on screen) */}
      {modalConfig.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4">
          <div ref={confirmationRef} role="dialog" aria-modal="true" aria-label={modalConfig.title} className={`rounded-2xl shadow-2xl p-6 w-full max-w-sm flex flex-col gap-4 relative border animate-in fade-in zoom-in-95 duration-150 ${theme === "dark" ? "bg-[#0f172a] border-[#334155] text-slate-100" : "bg-white border-slate-200 text-slate-900"
            }`}>

            {/* Modal Header */}
            <div className={`flex items-center justify-between border-b pb-3 ${theme === "dark" ? "border-[#334155]" : "border-slate-100"}`}>
              <h3 className="text-sm font-bold flex items-center gap-2">
                {modalConfig.type === "confirm" ? (
                  <AlertCircle size={17} className="text-rose-500" />
                ) : (
                  <Edit2 size={17} className="text-[#4f63ef] dark:text-[#a5b4fc]" />
                )}
                {modalConfig.title}
              </h3>
              <button
                aria-label="Close confirmation" onClick={closeModal}
                className={`transition-colors p-1 rounded-lg ${theme === "dark" ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`}
              >
                <X size={15} />
              </button>
            </div>

            {/* Modal Content Body */}
            {modalConfig.type === "confirm" ? (
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {modalConfig.description}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Name</label>
                <input
                  aria-label="Name" autoFocus
                  type="text"
                  value={modalInputVal}
                  onChange={(e) => setModalInputVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      modalConfig.onConfirm?.(modalInputVal);
                    } else if (e.key === "Escape") {
                      closeModal();
                    }
                  }}
                  className="w-full bg-white dark:bg-[#172033] border border-slate-300 dark:border-slate-700 focus:border-[#4f63ef] rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none transition-colors shadow-xs"
                />
              </div>
            )}

            {/* Modal Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                data-cancel onClick={closeModal}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors"
              >
                Cancel
              </button>

              <button
                onClick={() => {
                  if (modalConfig.type === "confirm") {
                    modalConfig.onConfirm?.();
                  } else {
                    modalConfig.onConfirm?.(modalInputVal);
                  }
                }}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm ${modalConfig.type === "confirm"
                  ? "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20"
                  : "bg-[#4f63ef] hover:bg-[#4051d6] text-white shadow-[#4f63ef]/20"
                  }`}
              >
                {modalConfig.type === "confirm" ? "Delete" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isShareModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setIsShareModalOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            onClick={(event) => event.stopPropagation()}
            className={`rounded-2xl border shadow-2xl p-6 max-w-md w-full flex flex-col gap-5 relative transition-colors ${theme === "dark" ? "bg-[#0f172a] border-[#334155] text-slate-100" : "bg-white border-slate-200 text-slate-900"
            }`}
          >

            <button
              type="button"
              aria-label="Close share"
              onClick={() => setIsShareModalOpen(false)}
              className={`absolute top-5 right-5 p-1.5 rounded-xl transition-colors cursor-pointer ${theme === "dark" ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                }`}
            >
              <X size={18} />
            </button>
            <div>
              <h2 id="share-title" className="text-lg font-extrabold tracking-tight pr-8">Share this board</h2>
              <p className={`mt-1 text-[13px] leading-relaxed ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
                {isOwner ? "Pick what this link allows, then copy it." : "Only the owner can create a share link."}
              </p>
            </div>

            {isOwner && (
              <>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="What this link allows">
                  <button
                    type="button"
                    aria-label="Can edit"
                    aria-pressed={shareLinkRole === "edit"}
                    onClick={() => chooseShareRole("edit")}
                    className={`rounded-xl border px-3 py-3 text-left cursor-pointer ${shareLinkRole === "edit"
                      ? "border-[#4f63ef] bg-[#eef2ff] text-[#312e81] dark:bg-[#172033] dark:text-[#e0e7ff]"
                      : theme === "dark" ? "border-[#334155] text-slate-300" : "border-slate-200 text-slate-700"}`}
                  >
                    <strong className="block text-[13px]">Can edit</strong>
                    <span className="mt-1 block text-[12px] leading-snug opacity-80">They can add and move tasks.</span>
                  </button>
                  <button
                    type="button"
                    aria-label="View only"
                    aria-pressed={shareLinkRole === "view"}
                    onClick={() => chooseShareRole("view")}
                    className={`rounded-xl border px-3 py-3 text-left cursor-pointer ${shareLinkRole === "view"
                      ? "border-[#4f63ef] bg-[#eef2ff] text-[#312e81] dark:bg-[#172033] dark:text-[#e0e7ff]"
                      : theme === "dark" ? "border-[#334155] text-slate-300" : "border-slate-200 text-slate-700"}`}
                  >
                    <strong className="block text-[13px]">View only</strong>
                    <span className="mt-1 block text-[12px] leading-snug opacity-80">They can look, but not change the board.</span>
                  </button>
                </div>
                <label className="flex flex-col gap-1.5 text-[12px] font-bold text-slate-400 uppercase tracking-wider">
                  Share link
                  <input
                    id="share-link"
                    readOnly
                    value={shareUrl}
                    placeholder="Preparing the link…"
                    onFocus={(event) => event.currentTarget.select()}
                    className={`w-full rounded-xl border px-3 py-2 text-[13px] font-medium normal-case tracking-normal ${theme === "dark" ? "bg-[#172033] border-[#334155] text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  />
                </label>
                <button
                  type="button"
                  aria-label="Copy link"
                  disabled={!shareUrl}
                  onClick={() => void copyShareLink()}
                  className="w-full py-2.5 bg-[#4f63ef] hover:bg-[#4051d6] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-[#4f63ef]/20 cursor-pointer"
                >
                  {copySuccessToast ? "Copied" : "Copy link"}
                </button>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="board-address-access" className="text-[12px] font-bold text-slate-400 uppercase tracking-wider">Board address</label>
                  <select
                    id="board-address-access"
                    aria-label="Board address access"
                    aria-describedby="board-address-help"
                    value={accessLevel}
                    onChange={(event) => updateBoardAccess(event.target.value as "edit" | "view" | "private")}
                    className={`w-full rounded-xl border px-3 py-2 text-[13px] font-semibold focus:outline-none cursor-pointer ${theme === "dark" ? "bg-[#172033] border-[#334155] text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}
                  >
                    <option value="edit">Can edit</option>
                    <option value="view">View only</option>
                    <option value="private">No access</option>
                  </select>
                  <p id="board-address-help" className={`text-[12px] font-medium normal-case tracking-normal leading-relaxed ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
                    People who open the board address, without an invite, get this access.
                  </p>
                </div>
                {boardMembers.some((member) => !member.isOwner) && (
                  <div className={`flex flex-col gap-3 border-t pt-4 ${theme === "dark" ? "border-[#334155]" : "border-slate-200"}`}>
                    <h3 className="text-[13px] font-bold">People on this board</h3>
                    <div className="max-h-52 overflow-y-auto space-y-3">
                      {boardMembers.filter((member) => !member.isOwner).map((member) => (
                        <div key={member.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[13px] font-bold truncate">{member.name}</p>
                            <p className="text-[12px] text-slate-400 truncate">{member.email}</p>
                          </div>
                          <select
                            aria-label={`Access for ${member.name}`}
                            value={member.role === "edit" ? "Editor" : "Viewer"}
                            onChange={async (event) => {
                              const newRole = event.target.value === "Editor" ? "edit" : "view";
                              setBoardMembers((prev) => prev.map((item) => item.id === member.id ? { ...item, role: newRole } : item));
                              const token = sessionStorage.getItem("kanban_jwt") || localStorage.getItem("kanban_jwt");
                              if (!token) return;
                              try {
                                const res = await fetch(`${API_URL}/api/boards/${boardId}/members/${member.id}`, {
                                  method: "POST",
                                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                                  body: JSON.stringify({ role: newRole }),
                                });
                                if (!res.ok) fetchBoardMembers();
                              } catch {
                                fetchBoardMembers();
                              }
                            }}
                            className={`border text-xs font-bold rounded-xl px-3 py-1.5 focus:outline-none cursor-pointer ${theme === "dark" ? "bg-[#172033] border-[#334155] text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}
                          >
                            <option value="Editor">Can edit</option>
                            <option value="Viewer">View only</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

          </div>
        </div>
      )}

      {/* Rich Glassmorphic Card Detail Modal */}
      {currentCardDetail && (
        <CardDetailModal
          card={currentCardDetail}
          cards={cards}
          boardType={boardType}
          canEdit={canEdit && status === "connected"}
          theme={theme}
          columns={columns}
          members={boardMembers}
          currentUserId={Number(user?.id) || 0}
          shareHint={!user || user.email === "guest@kanban.demo" ? "guest" : isOwner ? "owner" : "member"}
          noteFeed={noteFeed}
          onShare={() => {
            if (!user || user.email === "guest@kanban.demo") setShowGuestShareModal(true);
            else setIsShareModalOpen(true);
          }}
          onAddNote={addCardNote}
          onMove={(id, column) => moveCard(id, column, Math.max(0, ...cards.filter(c => c.List === column).map(c => c.Position || 0)) + 1000)}
          swimlanes={swimlanes}
          onClose={() => setSelectedCardDetail(null)}
          onEditDetail={editCardDetail}
          onDeleteCard={(cardId, title) => {
            openConfirmModal("Delete Task?", `Are you sure you want to delete task "${title}"?`, () => {
              deleteCard(cardId);
              setSelectedCardDetail(null);
            });
          }}
        />
      )}

      {/* Guest Share Prompt Modal */}
      {showGuestShareModal && (
        <div role="dialog" aria-modal="true" aria-label="Keep or delete guest board" className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`max-w-md w-full rounded-3xl p-6 border shadow-2xl relative overflow-hidden ${
            theme === "dark"
              ? "bg-[#172033]/95 border-[#334155] text-slate-100 shadow-[#172033]/40"
              : "bg-white/95 border-slate-200 text-slate-900 shadow-slate-400/20"
          }`}>
            <div className="absolute -top-16 -right-16 w-36 h-36 bg-[#4f63ef]/20 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-center justify-between mb-4 relative z-10">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#4051d6] to-[#818cf8] p-[1.5px] shadow-lg shadow-[#4f63ef]/20">
                <div className="w-full h-full bg-[#0f172a] rounded-[14px] flex items-center justify-center text-[#a5b4fc]">
                  <UserPlus size={20} />
                </div>
              </div>
              <button
                onClick={() => setShowGuestShareModal(false)}
                className="p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <h3 className="text-lg font-extrabold tracking-tight mb-2">
              Sign in to Share Board
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              You are currently exploring in <strong className="text-[#4f63ef] dark:text-[#a5b4fc] font-semibold">Guest Mode</strong>. Sign in with your Google account to invite collaborators, manage editor rights, and generate real-time share links.
            </p>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => handleLogin(boardId || "")}
                className="w-full py-2.5 bg-[#4f63ef] hover:bg-[#4051d6] text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Globe size={15} /> Continue with Google
              </button>
              <button
                onClick={() => setShowGuestShareModal(false)}
                className="w-full py-2 bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                {isOwner || userRole === "editor" ? "Keep Editing as Guest" : "Keep Viewing as Guest"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guest Exit & Save Prompt Modal */}
      {showGuestExitModal && (
        <div role="dialog" aria-modal="true" aria-label="Keep or delete guest board" className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`max-w-md w-full rounded-3xl p-6 border shadow-2xl relative overflow-hidden ${
            theme === "dark"
              ? "bg-[#172033]/95 border-[#334155] text-slate-100 shadow-rose-950/30"
              : "bg-white/95 border-slate-200 text-slate-900 shadow-slate-400/20"
          }`}>
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div className="w-10 h-10 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center text-amber-700 dark:text-amber-300">
                <AlertCircle size={20} />
              </div>
              <button
                disabled={isDiscardingGuestBoard}
                onClick={() => { setShowGuestExitModal(false); setGuestLogoutRequested(false); }}
                className="p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <h3 className="text-lg font-extrabold tracking-tight mb-2">
              Keep this board before leaving?
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              This board belongs to your <strong>Guest session</strong>. Sign in to keep it. Choosing “Delete board & leave” permanently deletes this board and all its tasks.
            </p>

            {guestExitError && <p role="alert" className="text-sm text-rose-500 mb-3">{guestExitError}</p>}
            <div className="flex flex-col gap-2.5">
              <button
                disabled={isDiscardingGuestBoard}
                onClick={() => handleLogin(boardId || "")}
                className="w-full py-2.5 bg-[#4f63ef] hover:bg-[#4051d6] text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check size={15} /> Sign In to Save Board
              </button>
              <button
                disabled={isDiscardingGuestBoard}
                onClick={async () => {
                  setIsDiscardingGuestBoard(true);
                  setGuestExitError("");
                  try {
                    const token = sessionStorage.getItem("kanban_jwt") || localStorage.getItem("kanban_jwt");
                    if (!token || !boardId) throw new Error("Missing session");
                    const response = await fetch(`${API_URL}/api/boards/${boardId}`, {
                      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
                    });
                    if (!response.ok && response.status !== 404) throw new Error("Delete failed");
                    setShowGuestExitModal(false);
                    if (guestLogoutRequested) {
                      isLoggingInRef.current = true;
                      logout();
                    } else navigate("/", { replace: true });
                  } catch {
                    setGuestExitError("Could not delete the board. You are still signed in. Please try again.");
                  } finally { setIsDiscardingGuestBoard(false); }
                }}
                className="w-full py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold rounded-xl border border-rose-500/30 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Trash2 size={13} /> {isDiscardingGuestBoard ? "Deleting…" : "Delete board & leave"}
              </button>
              <button
                disabled={isDiscardingGuestBoard}
                onClick={() => { setShowGuestExitModal(false); setGuestLogoutRequested(false); }}
                className="w-full py-1.5 bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-medium rounded-xl transition-all cursor-pointer"
              >
                Stay on Board
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
