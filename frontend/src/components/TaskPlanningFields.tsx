import { useEffect, useState } from "react";
import type { Card } from "../useWebSocket";
import { localDate } from "../boardDates";
import { useLanguage } from "../useLanguage";
import "./taskPlanning.css";

type Props = {
  card: Card;
  cards: Card[];
  canEdit: boolean;
  boardType: string;
  onSave: (changes: Record<string, string>) => boolean | void;
};

export default function TaskPlanningFields({ card, cards, canEdit, boardType, onSave }: Props) {
  const { t } = useLanguage();
  const [start, setStart] = useState(card.StartDate || "");
  const [end, setEnd] = useState(card.DueDate || "");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!dirty) { setStart(card.StartDate || ""); setEnd(card.DueDate || ""); }
  }, [card.StartDate, card.DueDate, dirty]);
  const dependencies = (card.Dependencies || "").split(",").filter(Boolean);
  const otherCards = cards.filter(item => item.ID !== card.ID);

  const saveSchedule = () => {
    if ((start && !localDate(start)) || (end && !localDate(end))) { setError(t("Enter valid calendar dates.", "กรุณาระบุวันที่ให้ถูกต้อง")); return; }
    if (start && end && start > end) { setError(t("The end date must be on or after the start date.", "วันครบกำหนดต้องไม่ก่อนวันเริ่มต้น")); return; }
    setError("");
    const accepted = onSave({ startDate: start, dueDate: end });
    if (accepted !== false) setDirty(false);
    else setError(t("Could not send this change. Reconnect and save again.", "ไม่สามารถบันทึกได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่"));
  };

  return <div className="task-planning-fields">
    <section aria-label="Task schedule">
      <h3>{t("Schedule", "กำหนดเวลา")}</h3>
      <div className="planning-date-row">
        <label>{t("Start date", "วันเริ่มต้น")}<input aria-label="Start date" type="date" value={start} disabled={!canEdit} onInput={event => { setStart(event.currentTarget.value); setDirty(true); }} onChange={event => { setStart(event.target.value); setDirty(true); }} /></label>
        <label>{t("Due date", "วันครบกำหนด")}<input aria-label="Due date" type="date" value={end} disabled={!canEdit} onInput={event => { setEnd(event.currentTarget.value); setDirty(true); }} onChange={event => { setEnd(event.target.value); setDirty(true); }} /></label>
        {canEdit && <button className="planning-save" disabled={!dirty} onClick={saveSchedule}>{t("Save schedule", "บันทึกวันที่")}</button>}
      </div>
      {error && <p role="alert" className="planning-error">{error}</p>}
      <p className="planning-hint">{t("Calendar uses the due date. Timeline uses the start and due dates.", "มุมมองปฏิทินใช้วันครบกำหนด ส่วนไทม์ไลน์ใช้วันเริ่มต้นถึงวันครบกำหนด")}</p>
    </section>
    <section aria-label="Task relationships">
      <h3>{t("Relationships", "ความเชื่อมโยง")}</h3>
      <label>{t("Parent idea", "หัวข้อหลัก (Parent)")}<select aria-label="Parent idea" disabled={!canEdit} value={card.ParentID || ""} onChange={event => onSave({ parentId: event.target.value })}>
        <option value="">{t("Board root", "ระดับบนสุดของบอร์ด")}</option>
        {otherCards.map(item => <option key={item.ID} value={String(item.ID)}>{item.Title}</option>)}
      </select></label>
      <p className="planning-hint">{t("Parent ideas connect nodes in the Mind Map.", "ใช้เชื่อมโยงกิ่งก้านในมุมมองแผนผังความคิด (Mind Map)")}</p>
      <details className="planning-dependencies"><summary>{t("Depends on", "ต้องรอให้งานอื่นเสร็จก่อน")} {dependencies.length ? `(${dependencies.length})` : t("other tasks", "")}</summary>
        {otherCards.length === 0 ? <p className="planning-hint">{t("Add another task to create a dependency.", "เพิ่มงานอื่นในบอร์ดก่อนเพื่อผูกความเชื่อมโยง")}</p> : otherCards.map(item => <label className="planning-checkbox" key={item.ID}>
          <input type="checkbox" disabled={!canEdit} checked={dependencies.includes(String(item.ID))} onChange={event => onSave({ dependencies: (event.target.checked ? [...dependencies, String(item.ID)] : dependencies.filter(id => id !== String(item.ID))).join(",") })} />
          <span>{item.Title}</span>
        </label>)}
      </details>
    </section>
    {boardType === "sprint" && <section aria-label="Sprint task settings">
      <h3>{t("Sprint", "สปรินต์")}</h3>
      <label>{t("Story points", "แต้มงาน (Story Points)")}<input aria-label="Story points" type="number" min="0" max="10000" step="1" disabled={!canEdit} defaultValue={card.StoryPoints || 0} key={`${card.ID}-${card.StoryPoints}`} onBlur={event => {
        const value = Number(event.target.value);
        if (Number.isInteger(value) && value >= 0 && value <= 10000 && value !== (card.StoryPoints || 0)) onSave({ storyPoints: String(value) });
      }} /></label>
      <label className="planning-checkbox"><input type="checkbox" checked={!!card.InSprint} disabled={!canEdit} onChange={event => onSave({ inSprint: String(event.target.checked) })} /><span>{t("Include in the current sprint", "นำเข้าสปรินต์ปัจจุบัน")}</span></label>
    </section>}
  </div>;
}
