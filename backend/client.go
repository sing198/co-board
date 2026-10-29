package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"gorm.io/gorm"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 65536
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		return allowedOriginsMap["*"] || isOriginAllowed(origin) || len(allowedOriginsMap) == 0
	},
}

type Client struct {
	requestID   string
	hub         *Hub
	conn        *websocket.Conn
	send        chan []byte
	db          *gorm.DB
	userID      uint
	userName    string
	avatarUrl   string
	boardID     string
	lastMsgTime time.Time
	msgCount    int
}

type WsMessage struct {
	Changes      map[string]string `json:"changes,omitempty"`
	Expected     map[string]string `json:"expected,omitempty"`
	RequestID    string            `json:"requestId,omitempty"`
	Type         string            `json:"type"`
	CardId       string            `json:"cardId,omitempty"`
	BoardId      string            `json:"boardId,omitempty"`
	Title        string            `json:"title,omitempty"`
	ToList       string            `json:"toList,omitempty"`
	Swimlane     string            `json:"swimlane,omitempty"`
	Position     float64           `json:"position,omitempty"`
	Card         *Card             `json:"card,omitempty"`
	Cards        []Card            `json:"cards,omitempty"`
	ColumnName   string            `json:"columnName,omitempty"`
	OldColumn    string            `json:"oldColumn,omitempty"`
	Columns      string            `json:"columns,omitempty"`
	Swimlanes    string            `json:"swimlanes,omitempty"`
	OldSwimlane  string            `json:"oldSwimlane,omitempty"`
	BoardName    string            `json:"boardName,omitempty"`
	AccessLevel  string            `json:"accessLevel,omitempty"`
	InviteToken  string            `json:"inviteToken,omitempty"`
	Tags         string            `json:"tags,omitempty"`
	Description  string            `json:"description,omitempty"`
	DueDate      string            `json:"dueDate,omitempty"`
	StartDate    string            `json:"startDate,omitempty"`
	ParentID     string            `json:"parentId,omitempty"`
	Checklist    string            `json:"checklist,omitempty"`
	Background   string            `json:"background,omitempty"`
	SprintName   string            `json:"sprintName,omitempty"`
	SprintStart  string            `json:"sprintStart,omitempty"`
	SprintEnd    string            `json:"sprintEnd,omitempty"`
	SprintStatus string            `json:"sprintStatus,omitempty"`
	Text         string            `json:"text,omitempty"`
	Notes        []CardActivity    `json:"notes,omitempty"`
}

// sendError is a small helper that pushes an ERROR frame back to this client.
func (c *Client) sendError(text string) {
	errMsg, _ := json.Marshal(WsMessage{
		Type:      "ERROR",
		RequestID: c.requestID,
		Title:     text,
		BoardId:   c.boardID,
	})
	select {
	case c.send <- errMsg:
	default:
	}
}

// validateCardMutation validates the fields of a client mutation against the
// server-side rules. Returns the (possibly trimmed) message and an error string
// explaining why it was rejected (empty string when valid). Pure logic so it
// can be unit tested without a connection.
func validateCardMutation(msg WsMessage) (WsMessage, string) {
	switch msg.Type {
	case "MOVE_CARD":
		if strings.TrimSpace(msg.ToList) == "" {
			return msg, "Invalid target list."
		}
		if msg.CardId == "" {
			return msg, "Missing cardId."
		}
		if msg.Position < 0 {
			return msg, "Position must be non-negative."
		}
	case "ADD_CARD":
		if strings.TrimSpace(msg.ToList) == "" {
			return msg, "Invalid target list."
		}
		msg.Title = trimTitle(msg.Title)
		if msg.Title == "" {
			return msg, "Card title cannot be empty."
		}
		if msg.Position < 0 {
			return msg, "Position must be non-negative."
		}
		if msg.Swimlane == "" {
			msg.Swimlane = "Untitled"
		}
		if err := validateDateRange(msg.StartDate, msg.DueDate); err != nil {
			return msg, err.Error()
		}
		if msg.ParentID != "" {
			id, err := parseCardID(msg.ParentID)
			if err != nil {
				return msg, err.Error()
			}
			msg.ParentID = strconv.FormatUint(uint64(id), 10)
		}
	case "EDIT_CARD":
		if msg.CardId == "" {
			return msg, "Missing cardId."
		}
		if msg.Changes != nil {
			if len(msg.Changes) == 0 {
				return msg, "No task changes supplied."
			}
			for key, value := range msg.Changes {
				switch key {
				case "title", "description", "dueDate", "startDate", "checklist", "tags", "swimlane", "dependencies", "parentId", "storyPoints", "inSprint", "assigneeId":
				default:
					return msg, "Invalid task field."
				}
				if key == "assigneeId" {
					id, err := parseAssigneeID(value)
					if err != nil {
						return msg, err.Error()
					}
					msg.Changes[key] = strconv.FormatUint(uint64(id), 10)
				}
				if key == "title" {
					value = trimTitle(value)
					if value == "" {
						return msg, "Card title cannot be empty."
					}
					msg.Changes[key] = value
				}
				if key == "startDate" || key == "dueDate" {
					if err := validateCalendarDate(value); err != nil {
						return msg, err.Error()
					}
				}
				if key == "storyPoints" {
					points, err := strconv.Atoi(value)
					if err != nil || points < 0 {
						return msg, "Story points must be a non-negative integer."
					}
					msg.Changes[key] = strconv.Itoa(points)
				}
				if key == "inSprint" {
					included, err := strconv.ParseBool(value)
					if err != nil {
						return msg, "In-sprint must be true or false."
					}
					msg.Changes[key] = strconv.FormatBool(included)
				}
				if key == "parentId" && value != "" {
					id, err := parseCardID(value)
					if err != nil {
						return msg, err.Error()
					}
					msg.Changes[key] = strconv.FormatUint(uint64(id), 10)
				}
				if key == "dependencies" {
					clean, _, err := normalizeDependencies(value)
					if err != nil {
						return msg, err.Error()
					}
					msg.Changes[key] = clean
				}
			}
			return msg, ""
		}
		if msg.Title != "" {
			msg.Title = trimTitle(msg.Title)
		} else if msg.Description == "" && msg.DueDate == "" && msg.Checklist == "" && msg.Tags == "" {
			return msg, "Card title cannot be empty."
		}
		if err := validateCalendarDate(msg.DueDate); err != nil {
			return msg, err.Error()
		}
	case "DELETE_CARD", "UPDATE_CARD_TAGS":
		if msg.CardId == "" {
			return msg, "Missing cardId."
		}
	case "UPDATE_BOARD_NAME":
		msg.BoardName = strings.TrimSpace(msg.BoardName)
		if msg.BoardName == "" {
			return msg, "Board name cannot be empty."
		}
	case "ADD_COLUMN":
		msg.ColumnName = strings.ReplaceAll(strings.TrimSpace(msg.ColumnName), ",", "")
		if msg.ColumnName == "" {
			return msg, "Column name cannot be empty or contain only commas."
		}
	case "DELETE_COLUMN":
		msg.ColumnName = strings.TrimSpace(msg.ColumnName)
		if msg.ColumnName == "" {
			return msg, "Column name cannot be empty."
		}
	case "RENAME_COLUMN":
		msg.OldColumn = strings.TrimSpace(msg.OldColumn)
		msg.ColumnName = strings.ReplaceAll(strings.TrimSpace(msg.ColumnName), ",", "")
		if msg.OldColumn == "" || msg.ColumnName == "" {
			return msg, "Invalid column names."
		}
	case "ADD_SWIMLANE":
		msg.Swimlane = strings.ReplaceAll(strings.TrimSpace(msg.Swimlane), ",", "")
		if msg.Swimlane == "" {
			return msg, "Swimlane name cannot be empty or contain only commas."
		}
	case "DELETE_SWIMLANE":
		msg.Swimlane = strings.TrimSpace(msg.Swimlane)
		if msg.Swimlane == "" {
			return msg, "Swimlane name cannot be empty."
		}
	case "RENAME_SWIMLANE":
		msg.OldSwimlane = strings.TrimSpace(msg.OldSwimlane)
		msg.Swimlane = strings.ReplaceAll(strings.TrimSpace(msg.Swimlane), ",", "")
		if msg.OldSwimlane == "" || msg.Swimlane == "" {
			return msg, "Invalid swimlane names."
		}
	case "UPDATE_BOARD_ACCESS":
		if msg.AccessLevel != "edit" && msg.AccessLevel != "view" && msg.AccessLevel != "private" {
			return msg, "Invalid access level."
		}
	case "UPDATE_BOARD_BACKGROUND":
		msg.Background = strings.TrimSpace(msg.Background)
	case "UPDATE_SPRINT":
		if len(msg.Changes) == 0 {
			return msg, "No sprint changes supplied."
		}
		for key, value := range msg.Changes {
			switch key {
			case "name":
				msg.Changes[key] = strings.TrimSpace(value)
			case "start", "end":
				if err := validateCalendarDate(value); err != nil {
					return msg, err.Error()
				}
			case "status":
				if value != "planning" && value != "active" && value != "completed" {
					return msg, "Invalid sprint status."
				}
			default:
				return msg, "Invalid sprint field."
			}
		}
	case "ADD_CARD_NOTE":
		if msg.CardId == "" {
			return msg, "Missing cardId."
		}
		text, reason := normalizeComment(msg.Text)
		if reason != "" {
			return msg, reason
		}
		msg.Text = text
	default:
		return msg, "Unknown message type."
	}
	return msg, ""
}

// trimTitle clips a title to maxTitleLength and strips surrounding whitespace.
func trimTitle(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > maxTitleLength {
		s = s[:maxTitleLength]
	}
	return s
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	c.lastMsgTime = time.Now()
	c.msgCount = 0

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		var request WsMessage
		_ = json.Unmarshal(message, &request)
		c.requestID = request.RequestID
		now := time.Now()
		if now.Sub(c.lastMsgTime) > time.Second {
			c.lastMsgTime = now
			c.msgCount = 1
		} else {
			c.msgCount++
			if c.msgCount > 15 {
				c.sendError("Rate limit exceeded. Slow down!")
				// Repeatedly hammering the server past the rate limit is almost
				// always abusive (a well-behaved client backs off after the
				// first warning). Keep counting; if they keep going, drop the
				// connection so they can't pin the DB/CPU indefinitely.
				if c.msgCount > 30 {
					break
				}
				continue
			}
		}

		var msg WsMessage
		if err := json.Unmarshal(message, &msg); err == nil {
			msg, reason := validateCardMutation(msg)
			if reason != "" {
				c.sendError(reason)
				continue
			}

			// AIRTIGHT BACKEND SECURITY: Enforce Board Access Permissions
			var board Board
			if err := c.db.First(&board, "id = ?", c.boardID).Error; err == nil {
				isOwner := c.userID != 0 && c.userID == board.OwnerID

				hasEditInvite := false
				hasViewInvite := false
				if msg.InviteToken != "" {
					bID, role, err := VerifyBoardInviteToken(msg.InviteToken)
					if err == nil && bID == c.boardID {
						if role == "edit" {
							hasEditInvite = true
						} else if role == "view" {
							hasViewInvite = true
						}
					}
				}

				if msg.Type == "UPDATE_BOARD_ACCESS" || msg.Type == "UPDATE_BOARD_NAME" {
					if !isOwner {
						c.sendError("Only the board owner can modify board settings.")
						continue
					}
				} else {
					isLoggedIn := c.userID != 0
					userRole := resolveBoardRole(c.db, c.boardID, board.OwnerID, c.userID)
					hasExplicitEdit := userRole == "owner" || userRole == "edit"
					hasExplicitView := userRole == "view"

					canEdit := isLoggedIn && (isOwner || hasExplicitEdit || hasEditInvite || (board.AccessLevel == "edit" && !hasViewInvite && !hasExplicitView))
					if !canEdit {
						if !isLoggedIn {
							c.sendError("You must log in to edit this board.")
						} else {
							c.sendError("This board is currently in View-Only mode.")
						}
						continue
					}
					if !isOwner && !hasExplicitEdit && !hasEditInvite && !hasViewInvite && board.AccessLevel == "private" {
						c.sendError("This board is private.")
						continue
					}
				}
			}

			refreshBoard := false
			switch msg.Type {
			case "MOVE_CARD":
				updates := map[string]interface{}{
					"list":     msg.ToList,
					"position": msg.Position,
				}
				if msg.Swimlane != "" {
					updates["swimlane"] = msg.Swimlane
				}
				result := c.db.Model(&Card{}).Where("id = ? AND board_id = ?", msg.CardId, c.boardID).Updates(updates)
				if result.Error != nil || result.RowsAffected == 0 {
					c.sendError("Could not move card. Refreshing board.")
					continue
				}
				if note := c.recordActivity(msg.CardId, "moved", "moved this to "+clipRunes(msg.ToList, 40)); note != nil {
					msg.Notes = append(msg.Notes, *note)
				}
				if needs, err := c.needsRenormalize(msg.ToList); err != nil {
					log.Println("renormalize check failed:", err)
				} else if needs {
					if cards, err := renormalizePositions(c.db, c.boardID, msg.ToList); err != nil {
						log.Println("renormalize failed:", err)
					} else {
						c.broadcastReorder(msg.ToList, cards)
						// The move broadcast is skipped after a rebalance, so the
						// note rides on its own frame. REORDER still carries the
						// card, including LatestNote, from the database.
						c.publishCardNote(msg.CardId, msg.RequestID, msg.Notes)
						ack, _ := json.Marshal(WsMessage{Type: "ACK", RequestID: msg.RequestID, BoardId: c.boardID})
						c.send <- ack
						continue
					}
				}
			case "ADD_CARD":
				newCard, err := addCardWithMetadata(c.db, c.boardID, msg)
				if err != nil {
					c.sendError("Could not create task: " + err.Error())
					continue
				}
				msg.Card = &newCard
				if note := c.recordActivity(strconv.FormatUint(uint64(newCard.ID), 10), "added", "added this task"); note != nil {
					msg.Notes = append(msg.Notes, *note)
					msg.Card.LatestNote = note.Text
				}
			case "EDIT_CARD":
				if err := editCardWithMetadata(c.db, c.boardID, &msg); err != nil {
					c.sendError("Could not update task: " + err.Error() + ". Refresh and review before editing again.")
					continue
				}
				for _, change := range editActivityBodies(c.db, msg.Changes) {
					if note := c.recordActivity(msg.CardId, change.Kind, change.Body); note != nil {
						msg.Notes = append(msg.Notes, *note)
					}
				}
				if recipient, ok := assignmentRecipient(msg.Changes, msg.Expected, c.userID); ok {
					var assigned Card
					if err := c.db.Select("id", "title").Where("id = ? AND board_id = ?", msg.CardId, c.boardID).First(&assigned).Error; err == nil {
						if err := recordAssignmentNotice(c.db, c.boardID, assigned, c.userID, c.userName, recipient); err != nil {
							log.Println("assignment notice failed:", err)
						}
					}
				}
			case "ADD_CARD_NOTE":
				note, err := saveCardActivity(c.db, c.boardID, msg.CardId, c.userID, c.userName, "comment", msg.Text)
				if err != nil {
					c.sendError("Could not add note. It may have been deleted. Refresh and try again.")
					continue
				}
				msg.Notes = append(msg.Notes, note)
				msg.Text = ""
			case "UPDATE_CARD_TAGS":
				if result := c.db.Model(&Card{}).Where("id = ? AND board_id = ?", msg.CardId, c.boardID).Update("tags", msg.Tags); result.Error != nil || result.RowsAffected == 0 {
					c.sendError("Could not save task. It may have been deleted. Refresh and try again.")
					continue
				}
			case "DELETE_CARD":
				if err := deleteCardWithReferences(c.db, c.boardID, msg.CardId); err != nil {
					c.sendError("Could not save task. It may have been deleted. Refresh and try again.")
					continue
				}
				refreshBoard = true
			case "UPDATE_BOARD_NAME":
				c.db.Model(&Board{}).Where("id = ?", c.boardID).Update("name", msg.BoardName)
			case "UPDATE_BOARD_BACKGROUND":
				c.db.Model(&Board{}).Where("id = ?", c.boardID).Update("background", msg.Background)
			case "UPDATE_SPRINT":
				if err := updateSprintMetadata(c.db, c.boardID, &msg); err != nil {
					c.sendError("Could not update sprint: " + err.Error())
					continue
				}
			case "ADD_COLUMN":
				var b Board
				if err := c.db.Where("id = ?", c.boardID).First(&b).Error; err == nil {
					cols := strings.Split(b.Columns, ",")
					if b.Columns == "" {
						cols = []string{}
					}
					cols = append(cols, msg.ColumnName)
					newCols := strings.Join(cols, ",")
					c.db.Model(&Board{}).Where("id = ?", c.boardID).Update("columns", newCols)
					msg.Columns = newCols
				}
			case "DELETE_COLUMN":
				var b Board
				if err := c.db.Where("id = ?", c.boardID).First(&b).Error; err == nil {
					cols := strings.Split(b.Columns, ",")
					var newColList []string
					for _, col := range cols {
						// Exact match — column names are canonicalized (trimmed)
						// at creation/rename time, so a loose TrimSpace comparison
						// here would risk deleting the wrong column when two
						// columns differ only by surrounding whitespace, and
						// would diverge from the card `list = ?` query below.
						if col != msg.ColumnName {
							newColList = append(newColList, col)
						}
					}
					newCols := strings.Join(newColList, ",")
					err := c.db.Transaction(func(tx *gorm.DB) error {
						var deleted []Card
						if err := tx.Where("board_id = ? AND list = ?", c.boardID, msg.ColumnName).Find(&deleted).Error; err != nil {
							return err
						}
						if err := tx.Model(&Board{}).Where("id = ?", c.boardID).Update("columns", newCols).Error; err != nil {
							return err
						}
						if err := tx.Where("board_id = ? AND list = ?", c.boardID, msg.ColumnName).Delete(&Card{}).Error; err != nil {
							return err
						}
						ids := make(map[uint]bool, len(deleted))
						for _, card := range deleted {
							ids[card.ID] = true
						}
						return clearDeletedCardReferences(tx, c.boardID, ids)
					})
					if err != nil {
						c.sendError("Could not delete column. Please try again.")
						continue
					}
					msg.Columns = newCols
					refreshBoard = true
				}
			case "RENAME_COLUMN":
				var b Board
				if err := c.db.Where("id = ?", c.boardID).First(&b).Error; err == nil {
					cols := strings.Split(b.Columns, ",")
					for i, col := range cols {
						if col == msg.OldColumn {
							cols[i] = msg.ColumnName
						}
					}
					newCols := strings.Join(cols, ",")
					c.db.Model(&Board{}).Where("id = ?", c.boardID).Update("columns", newCols)
					c.db.Model(&Card{}).Where("board_id = ? AND list = ?", c.boardID, msg.OldColumn).Update("list", msg.ColumnName)
					msg.Columns = newCols
				}
			case "ADD_SWIMLANE":
				var b Board
				if err := c.db.Where("id = ?", c.boardID).First(&b).Error; err == nil {
					swims := strings.Split(b.Swimlanes, ",")
					if b.Swimlanes == "" {
						swims = []string{}
						c.db.Model(&Card{}).Where("board_id = ? AND (swimlane = '' OR swimlane = 'Untitled')", c.boardID).Update("swimlane", msg.Swimlane)
					}
					swims = append(swims, msg.Swimlane)
					newSwims := strings.Join(swims, ",")
					c.db.Model(&Board{}).Where("id = ?", c.boardID).Update("swimlanes", newSwims)
					msg.Swimlanes = newSwims
				}
			case "DELETE_SWIMLANE":
				var b Board
				if err := c.db.Where("id = ?", c.boardID).First(&b).Error; err == nil {
					swims := strings.Split(b.Swimlanes, ",")
					var newSwimList []string
					for _, swim := range swims {
						// Exact match — same rationale as DELETE_COLUMN above.
						if swim != msg.Swimlane {
							newSwimList = append(newSwimList, swim)
						}
					}
					newSwims := strings.Join(newSwimList, ",")
					c.db.Model(&Board{}).Where("id = ?", c.boardID).Update("swimlanes", newSwims)

					fallbackSwim := "Untitled"
					if len(newSwimList) > 0 {
						fallbackSwim = newSwimList[0]
					}
					c.db.Model(&Card{}).Where("board_id = ? AND swimlane = ?", c.boardID, msg.Swimlane).Update("swimlane", fallbackSwim)

					msg.Swimlanes = newSwims
				}
			case "RENAME_SWIMLANE":
				var b Board
				if err := c.db.Where("id = ?", c.boardID).First(&b).Error; err == nil {
					swims := strings.Split(b.Swimlanes, ",")
					for i, swim := range swims {
						if swim == msg.OldSwimlane {
							swims[i] = msg.Swimlane
						}
					}
					newSwims := strings.Join(swims, ",")
					c.db.Model(&Board{}).Where("id = ?", c.boardID).Update("swimlanes", newSwims)
					c.db.Model(&Card{}).Where("board_id = ? AND (swimlane = ? OR swimlane = '' OR swimlane IS NULL OR swimlane = 'Untitled')", c.boardID, msg.OldSwimlane).Update("swimlane", msg.Swimlane)
					msg.Swimlanes = newSwims
				}
			case "UPDATE_BOARD_ACCESS":
				c.db.Model(&Board{}).Where("id = ?", c.boardID).Update("access_level", msg.AccessLevel)
			}

			// Never echo the sender's invite token back out to the whole room —
			// that would leak one client's access token to every other
			// connected client. Tokens are inbound-only credentials.
			msg.InviteToken = ""
			msg.BoardId = c.boardID
			message, _ = json.Marshal(msg)
			c.hub.publish <- message
			if refreshBoard {
				refresh, _ := json.Marshal(WsMessage{Type: "BOARD_REFRESH", BoardId: c.boardID})
				c.hub.publish <- refresh
			}
			continue
		}

		c.hub.publish <- message
	}
}

// writeMessage writes a single message as its own WebSocket text frame.
// The previous implementation concatenated the outbound message with the rest
// of the send buffer into ONE frame (newline-separated), which produced an
// invalid JSON document ("msg1\nmsg2") that the browser's JSON.parse would
// reject, silently dropping every queued message after the first.
func (c *Client) writeMessage(message []byte) error {
	c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	w, err := c.conn.NextWriter(websocket.TextMessage)
	if err != nil {
		return err
	}
	if _, err := w.Write(message); err != nil {
		w.Close()
		return err
	}
	return w.Close()
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				c.conn.SetWriteDeadline(time.Now().Add(writeWait))
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			// Each message is its own frame — never concatenate frames.
			if err := c.writeMessage(message); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// needsRenormalize reports whether the cards in (boardID, list) have any
// adjacent positions closer than positionGapThreshold, which would make future
// midpoint insertions unreliable.
func (c *Client) needsRenormalize(list string) (bool, error) {
	var positions []float64
	if err := c.db.Model(&Card{}).
		Where("board_id = ? AND list = ?", c.boardID, list).
		Pluck("position", &positions).Error; err != nil {
		return false, err
	}
	return minPositionGap(positions) < positionGapThreshold, nil
}

// broadcastReorder publishes a REORDER message carrying the renormalized cards
// for a list so every connected client resyncs their positions.
// recordActivity keeps a failed log line from rolling back the move or edit
// that already succeeded.
func (c *Client) recordActivity(cardID, kind, body string) *CardActivity {
	note, err := saveCardActivity(c.db, c.boardID, cardID, c.userID, c.userName, kind, body)
	if err != nil {
		log.Println("activity note failed:", err)
		return nil
	}
	return &note
}

func (c *Client) publishCardNote(cardID, requestID string, notes []CardActivity) {
	if len(notes) == 0 {
		return
	}
	payload, _ := json.Marshal(WsMessage{
		Type:      "CARD_NOTE",
		BoardId:   c.boardID,
		CardId:    cardID,
		Notes:     notes,
		RequestID: requestID,
	})
	c.hub.publish <- payload
}

func (c *Client) broadcastReorder(list string, cards []Card) {
	msg := WsMessage{
		Type:    "REORDER",
		BoardId: c.boardID,
		ToList:  list,
		Cards:   cards,
	}
	payload, _ := json.Marshal(msg)
	c.hub.publish <- payload
}

func serveWs(hub *Hub, db *gorm.DB, w http.ResponseWriter, r *http.Request) {
	boardID := r.URL.Query().Get("boardId")

	// Board IDs are UUID primary keys; reject anything that isn't a valid UUID
	if _, err := uuid.Parse(boardID); err != nil {
		http.Error(w, "Invalid or missing boardId", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	ticket := r.URL.Query().Get("ticket")
	var userID uint = 0

	// Consume WS ticket
	if ticket != "" {
		if uID, ok := consumeWSTicket(ticket); ok {
			userID = uID
		}
	}

	// Ensure the board actually exists. We never auto-create a board from a
	// WebSocket connection anymore: letting an arbitrary authenticated user
	// mint a brand-new board (and become its owner) by supplying any random
	// UUID was surprising behavior and an unintended creation path. Boards are
	// only created through POST /api/boards. Unknown boardId → connection
	// closed.
	var count int64
	db.Model(&Board{}).Where("id = ?", boardID).Count(&count)
	if count == 0 {
		_ = conn.Close()
		return
	}

	var userName string = "Guest"
	var avatarUrl string = ""
	if userID != 0 {
		var u User
		if err := db.First(&u, userID).Error; err == nil {
			userName = u.Name
			avatarUrl = u.AvatarURL
		}

		var b Board
		if err := db.First(&b, "id = ?", boardID).Error; err == nil && b.OwnerID != userID {
			var member BoardMember
			if err := db.Where("board_id = ? AND user_id = ?", boardID, userID).First(&member).Error; err != nil {
				db.Create(&BoardMember{
					BoardID:  boardID,
					UserID:   userID,
					Role:     "shared",
					LastSeen: time.Now(),
				})
			} else {
				db.Model(&member).Update("last_seen", time.Now())
			}
		}
	}

	var accessibleBoard Board
	if db.First(&accessibleBoard, "id = ?", boardID).Error != nil {
		conn.Close()
		return
	}
	role := resolveBoardRole(db, boardID, accessibleBoard.OwnerID, userID)
	if accessibleBoard.AccessLevel == "private" && role != "owner" && role != "edit" && role != "view" {
		inviteBoard, _, err := VerifyBoardInviteToken(r.URL.Query().Get("inviteToken"))
		if err != nil || inviteBoard != boardID {
			conn.Close()
			return
		}
	}

	client := &Client{
		hub:       hub,
		conn:      conn,
		send:      make(chan []byte, 256),
		db:        db,
		userID:    userID,
		userName:  userName,
		avatarUrl: avatarUrl,
		boardID:   boardID,
	}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}
