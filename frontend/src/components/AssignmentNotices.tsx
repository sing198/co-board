import { Link } from "react-router-dom";
import type { AssignmentNotice } from "../useNotifications";

export default function AssignmentNotices({ items, onOpen }: { items: AssignmentNotice[]; onOpen: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <Link
          key={item.id}
          to={`/b/${item.boardId}?task=${item.cardId}`}
          className={`assignment-notice${item.seen ? "" : " is-unread"}`}
          onClick={() => onOpen(item.id)}
        >
          <span><strong>{item.actorName}</strong> assigned you <strong>{item.cardTitle}</strong></span>
          <small>{item.boardName}</small>
        </Link>
      ))}
    </>
  );
}
