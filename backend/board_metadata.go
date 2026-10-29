package main

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
)

// Dates are stored as calendar days, not timestamps. A strict format avoids
// shifting a task to another day when collaborators use different time zones.
func validateCalendarDate(value string) error {
	if value == "" {
		return nil
	}
	date, err := time.Parse("2006-01-02", value)
	if err != nil || date.Format("2006-01-02") != value {
		return errors.New("date must use YYYY-MM-DD")
	}
	return nil
}

func validateDateRange(start, end string) error {
	if err := validateCalendarDate(start); err != nil {
		return err
	}
	if err := validateCalendarDate(end); err != nil {
		return err
	}
	if start != "" && end != "" && end < start {
		return errors.New("end date must be on or after start date")
	}
	return nil
}

func parseAssigneeID(value string) (uint, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "0" {
		return 0, nil
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil || parsed == 0 {
		return 0, errors.New("assignee must be a person on this board")
	}
	return uint(parsed), nil
}

// A task can be unassigned, or assigned to the owner or someone already on the board.
func ensureBoardAssignee(tx *gorm.DB, boardID string, assigneeID uint) error {
	if assigneeID == 0 {
		return nil
	}
	var board Board
	if err := tx.Select("id", "owner_id").Where("id = ?", boardID).First(&board).Error; err != nil {
		return err
	}
	if board.OwnerID == assigneeID {
		return nil
	}
	var count int64
	if err := tx.Model(&BoardMember{}).Where("board_id = ? AND user_id = ?", boardID, assigneeID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return errors.New("that person is not on this board")
	}
	return nil
}

func parseCardID(value string) (uint, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, errors.New("missing task ID")
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil || parsed == 0 {
		return 0, errors.New("task IDs must be positive integers")
	}
	return uint(parsed), nil
}

func normalizeDependencies(value string) (string, []uint, error) {
	if strings.TrimSpace(value) == "" {
		return "", nil, nil
	}
	parts := strings.Split(value, ",")
	if len(parts) > 200 {
		return "", nil, errors.New("too many dependencies")
	}
	seen := map[uint]bool{}
	ids := make([]uint, 0, len(parts))
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		id, err := parseCardID(part)
		if err != nil {
			return "", nil, err
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
		clean = append(clean, strconv.FormatUint(uint64(id), 10))
	}
	return strings.Join(clean, ","), ids, nil
}

// validateCardMetadata checks persisted board-local references. Hierarchy and
// prerequisite graphs are separate: a parent summary may legitimately depend
// on one of its own children, while cycles within either graph are invalid.
// Call inside the mutation's transaction after applying proposed fields.
func validateCardMetadata(tx *gorm.DB, candidate *Card) error {
	if err := validateDateRange(candidate.StartDate, candidate.DueDate); err != nil {
		return err
	}
	if candidate.StoryPoints < 0 {
		return errors.New("story points must be non-negative")
	}
	var cards []Card
	if err := tx.Where("board_id = ?", candidate.BoardID).Find(&cards).Error; err != nil {
		return err
	}
	byID := make(map[uint]Card, len(cards)+1)
	for _, card := range cards {
		byID[card.ID] = card
	}
	if candidate.ParentID != "" {
		parent, err := parseCardID(candidate.ParentID)
		if err != nil {
			return err
		}
		candidate.ParentID = strconv.FormatUint(uint64(parent), 10)
	}
	deps, depIDs, err := normalizeDependencies(candidate.Dependencies)
	if err != nil {
		return err
	}
	candidate.Dependencies = deps
	refs := append([]uint(nil), depIDs...)
	if candidate.ParentID != "" {
		parent, _ := parseCardID(candidate.ParentID)
		refs = append(refs, parent)
	}
	for _, id := range refs {
		if id == candidate.ID && candidate.ID != 0 {
			return errors.New("task cannot reference itself")
		}
		if _, ok := byID[id]; !ok {
			return fmt.Errorf("referenced task %d is not on this board", id)
		}
	}
	if candidate.ID == 0 {
		return nil // a new task cannot be part of an existing cycle
	}
	byID[candidate.ID] = *candidate
	checkCycle := func(label string, edges func(Card) ([]uint, error)) error {
		visiting, visited := map[uint]bool{}, map[uint]bool{}
		var visit func(uint) error
		visit = func(id uint) error {
			if visiting[id] {
				return fmt.Errorf("%s cannot contain a cycle", label)
			}
			if visited[id] {
				return nil
			}
			visiting[id] = true
			nextIDs, err := edges(byID[id])
			if err != nil {
				return err
			}
			for _, next := range nextIDs {
				if _, exists := byID[next]; !exists {
					return fmt.Errorf("referenced task %d is not on this board", next)
				}
				if err := visit(next); err != nil {
					return err
				}
			}
			visiting[id] = false
			visited[id] = true
			return nil
		}
		return visit(candidate.ID)
	}
	if err := checkCycle("task hierarchy", func(card Card) ([]uint, error) {
		if card.ParentID == "" {
			return nil, nil
		}
		id, err := parseCardID(card.ParentID)
		if err != nil {
			return nil, err
		}
		return []uint{id}, nil
	}); err != nil {
		return err
	}
	return checkCycle("task dependencies", func(card Card) ([]uint, error) {
		_, ids, err := normalizeDependencies(card.Dependencies)
		return ids, err
	})
}

// Deleting a task also removes incoming relationships, so existing tasks do
// not retain links to missing IDs. The caller broadcasts BOARD_REFRESH after
// committing because multiple cards may have changed.
func clearDeletedCardReferences(tx *gorm.DB, boardID string, deleted map[uint]bool) error {
	if len(deleted) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(deleted))
	for id := range deleted {
		ids = append(ids, id)
	}
	if err := tx.Where("board_id = ? AND card_id IN ?", boardID, ids).Delete(&CardActivity{}).Error; err != nil {
		return err
	}
	if err := tx.Where("board_id = ? AND card_id IN ?", boardID, ids).Delete(&AssignmentNotice{}).Error; err != nil {
		return err
	}
	var cards []Card
	if err := tx.Where("board_id = ?", boardID).Find(&cards).Error; err != nil {
		return err
	}
	for _, card := range cards {
		updates := map[string]interface{}{}
		if card.ParentID != "" {
			if id, err := parseCardID(card.ParentID); err == nil && deleted[id] {
				updates["parent_id"] = ""
			}
		}
		if card.Dependencies != "" {
			remaining := make([]string, 0)
			for _, part := range strings.Split(card.Dependencies, ",") {
				if id, err := parseCardID(part); err == nil && !deleted[id] {
					remaining = append(remaining, strconv.FormatUint(uint64(id), 10))
				}
			}
			clean := strings.Join(remaining, ",")
			if clean != card.Dependencies {
				updates["dependencies"] = clean
			}
		}
		if len(updates) > 0 {
			if err := tx.Model(&Card{}).Where("id = ? AND board_id = ?", card.ID, boardID).Updates(updates).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func addCardWithMetadata(db *gorm.DB, boardID string, msg WsMessage) (Card, error) {
	card := Card{Title: msg.Title, List: msg.ToList, Swimlane: msg.Swimlane, BoardID: boardID,
		Position: msg.Position, Tags: msg.Tags, DueDate: msg.DueDate, StartDate: msg.StartDate, ParentID: msg.ParentID}
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := validateCardMetadata(tx, &card); err != nil {
			return err
		}
		return tx.Create(&card).Error
	})
	return card, err
}

func editCardWithMetadata(db *gorm.DB, boardID string, msg *WsMessage) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var card Card
		if err := tx.Where("id = ? AND board_id = ?", msg.CardId, boardID).First(&card).Error; err != nil {
			return errors.New("task was deleted")
		}
		candidate := card
		updates := map[string]interface{}{}
		if msg.Changes != nil {
			for key, value := range msg.Changes {
				switch key {
				case "title":
					candidate.Title = value
					updates["title"] = value
				case "description":
					candidate.Description = value
					updates["description"] = value
				case "dueDate":
					candidate.DueDate = value
					updates["due_date"] = value
				case "startDate":
					candidate.StartDate = value
					updates["start_date"] = value
				case "checklist":
					candidate.Checklist = value
					updates["checklist"] = value
				case "tags":
					candidate.Tags = value
					updates["tags"] = value
				case "swimlane":
					candidate.Swimlane = value
					updates["swimlane"] = value
				case "dependencies":
					candidate.Dependencies = value
					updates["dependencies"] = value
				case "parentId":
					candidate.ParentID = value
					updates["parent_id"] = value
				case "storyPoints":
					points, _ := strconv.Atoi(value)
					candidate.StoryPoints = points
					updates["story_points"] = points
				case "inSprint":
					included, _ := strconv.ParseBool(value)
					candidate.InSprint = included
					updates["in_sprint"] = included
				case "assigneeId":
					assigneeID, err := parseAssigneeID(value)
					if err != nil {
						return err
					}
					if err := ensureBoardAssignee(tx, boardID, assigneeID); err != nil {
						return err
					}
					candidate.AssigneeID = assigneeID
					updates["assignee_id"] = assigneeID
					msg.Changes[key] = strconv.FormatUint(uint64(assigneeID), 10)
				}
			}
		} else {
			// Older clients omit empty values; preserve this behavior for them.
			for column, value := range map[string]string{"title": msg.Title, "description": msg.Description, "due_date": msg.DueDate, "checklist": msg.Checklist, "tags": msg.Tags, "swimlane": msg.Swimlane} {
				if value == "" {
					continue
				}
				updates[column] = value
				switch column {
				case "title":
					candidate.Title = value
				case "description":
					candidate.Description = value
				case "due_date":
					candidate.DueDate = value
				case "checklist":
					candidate.Checklist = value
				case "tags":
					candidate.Tags = value
				case "swimlane":
					candidate.Swimlane = value
				}
			}
		}
		if len(updates) == 0 {
			return errors.New("no task changes supplied")
		}
		if err := validateCardMetadata(tx, &candidate); err != nil {
			return err
		}
		if _, present := msg.Changes["dependencies"]; present {
			updates["dependencies"] = candidate.Dependencies
			msg.Changes["dependencies"] = candidate.Dependencies
		}
		if _, present := msg.Changes["parentId"]; present {
			updates["parent_id"] = candidate.ParentID
			msg.Changes["parentId"] = candidate.ParentID
		}
		query := tx.Model(&Card{}).Where("id = ? AND board_id = ?", msg.CardId, boardID)
		if msg.Changes != nil {
			columns := map[string]string{"title": "title", "description": "description", "dueDate": "due_date", "startDate": "start_date", "checklist": "checklist", "tags": "tags", "swimlane": "swimlane", "dependencies": "dependencies", "parentId": "parent_id", "assigneeId": "assignee_id"}
			for key := range msg.Changes {
				previous, hasExpected := msg.Expected[key]
				if !hasExpected {
					continue
				}
				switch key {
				case "assigneeId":
					raw := previous
					if raw == "" {
						raw = "0"
					}
					id, err := strconv.ParseUint(raw, 10, 64)
					if err != nil {
						return errors.New("invalid expected assignee")
					}
					query = query.Where("COALESCE(assignee_id, 0) = ?", id)
				case "storyPoints":
					points, err := strconv.Atoi(previous)
					if err != nil {
						return errors.New("invalid expected story points")
					}
					query = query.Where("story_points = ?", points)
				case "inSprint":
					included, err := strconv.ParseBool(previous)
					if err != nil {
						return errors.New("invalid expected sprint membership")
					}
					query = query.Where("in_sprint = ?", included)
				default:
					query = query.Where("COALESCE("+columns[key]+", '') = ?", previous)
				}
			}
		}
		result := query.Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("task changed or was deleted by another user")
		}
		return nil
	})
}

func updateSprintMetadata(db *gorm.DB, boardID string, msg *WsMessage) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var board Board
		if err := tx.Where("id = ?", boardID).First(&board).Error; err != nil {
			return err
		}
		if board.Type != "sprint" {
			return errors.New("sprint settings require a sprint board")
		}
		previousStatus := board.SprintStatus
		if previousStatus == "" {
			previousStatus = "planning"
		}
		if previousStatus != "planning" {
			for key := range msg.Changes {
				if key != "status" {
					return errors.New("sprint setup can only change while planning")
				}
			}
		}
		updates := map[string]interface{}{}
		for key, value := range msg.Changes {
			switch key {
			case "name":
				board.SprintName = value
				updates["sprint_name"] = value
			case "start":
				board.SprintStart = value
				updates["sprint_start"] = value
			case "end":
				board.SprintEnd = value
				updates["sprint_end"] = value
			case "status":
				board.SprintStatus = value
				updates["sprint_status"] = value
			}
		}
		if err := validateDateRange(board.SprintStart, board.SprintEnd); err != nil {
			return err
		}
		if board.SprintStatus != previousStatus {
			if !((previousStatus == "planning" && board.SprintStatus == "active") || (previousStatus == "active" && board.SprintStatus == "completed")) {
				return errors.New("invalid sprint lifecycle transition")
			}
		}
		if board.SprintStatus == "active" && (strings.TrimSpace(board.SprintName) == "" || board.SprintStart == "" || board.SprintEnd == "") {
			return errors.New("save a sprint name and date range before starting")
		}
		query := tx.Model(&Board{}).Where("id = ?", boardID)
		columns := map[string]string{"name": "sprint_name", "start": "sprint_start", "end": "sprint_end", "status": "sprint_status"}
		for key := range msg.Changes {
			if previous, ok := msg.Expected[key]; ok {
				query = query.Where("COALESCE("+columns[key]+", '') = ?", previous)
			}
		}
		result := query.Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("sprint changed by another user")
		}
		msg.SprintName, msg.SprintStart, msg.SprintEnd, msg.SprintStatus = board.SprintName, board.SprintStart, board.SprintEnd, board.SprintStatus
		return nil
	})
}

const maxNoteRunes = 280

// normalizeComment trims a short note, collapses whitespace, and rejects an
// empty or overlong body. The limit counts runes so a Thai note is not cut
// short by multi-byte characters.
func normalizeComment(value string) (string, string) {
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return "", "Write a short note first."
	}
	if utf8.RuneCountInString(value) > maxNoteRunes {
		return "", "Keep the note under 280 characters."
	}
	return value, ""
}

func clipRunes(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func activityActor(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "Someone"
	}
	return name
}

func activityText(actor, kind, body string) string {
	if kind == "comment" {
		return actor + ": " + body
	}
	return actor + " " + body
}

type activityChange struct {
	Kind string
	Body string
}

// editActivityBodies returns the log lines for a task edit. Description,
// checklist, dates, tags, and sprint fields stay off the card face.
func editActivityBodies(db *gorm.DB, changes map[string]string) []activityChange {
	if len(changes) == 0 {
		return nil
	}
	var bodies []activityChange
	if _, ok := changes["title"]; ok {
		bodies = append(bodies, activityChange{Kind: "renamed", Body: "renamed this"})
	}
	value, ok := changes["assigneeId"]
	if !ok {
		return bodies
	}
	id, err := parseAssigneeID(value)
	if err != nil || id == 0 {
		return append(bodies, activityChange{Kind: "assigned", Body: "cleared the assignee"})
	}
	var user User
	if err := db.Select("name").First(&user, id).Error; err != nil || strings.TrimSpace(user.Name) == "" {
		return append(bodies, activityChange{Kind: "assigned", Body: "assigned this"})
	}
	return append(bodies, activityChange{Kind: "assigned", Body: "assigned this to " + strings.TrimSpace(user.Name)})
}

// saveCardActivity writes one log line and the card's latest sentence in the
// same transaction. A missing task returns "task was deleted" and leaves no row.
func saveCardActivity(db *gorm.DB, boardID, cardID string, userID uint, userName, kind, body string) (CardActivity, error) {
	var note CardActivity
	err := db.Transaction(func(tx *gorm.DB) error {
		id, err := parseCardID(cardID)
		if err != nil {
			return errors.New("task was deleted")
		}
		var count int64
		if err := tx.Model(&Card{}).Where("id = ? AND board_id = ?", id, boardID).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return errors.New("task was deleted")
		}
		actor := activityActor(userName)
		note = CardActivity{
			BoardID:  boardID,
			CardID:   id,
			UserID:   userID,
			UserName: actor,
			Kind:     kind,
			Text:     activityText(actor, kind, body),
		}
		if err := tx.Create(&note).Error; err != nil {
			return err
		}
		return tx.Model(&Card{}).Where("id = ? AND board_id = ?", id, boardID).Update("latest_note", note.Text).Error
	})
	return note, err
}

// assignmentRecipient is the person who should hear about this edit.
// Clearing, assigning yourself, or sending the same person again does not.
func assignmentRecipient(changes, expected map[string]string, actorID uint) (uint, bool) {
	raw, ok := changes["assigneeId"]
	if !ok {
		return 0, false
	}
	id, err := parseAssigneeID(raw)
	if err != nil || id == 0 || id == actorID {
		return 0, false
	}
	if previous, ok := expected["assigneeId"]; ok && previous == strconv.FormatUint(uint64(id), 10) {
		return 0, false
	}
	return id, true
}

func recordAssignmentNotice(db *gorm.DB, boardID string, card Card, actorID uint, actorName string, assigneeID uint) error {
	if assigneeID == 0 || assigneeID == actorID {
		return nil
	}
	var board Board
	if err := db.Select("id", "name").Where("id = ?", boardID).First(&board).Error; err != nil {
		return err
	}
	name := strings.TrimSpace(actorName)
	if name == "" {
		name = "Someone"
	}
	return db.Create(&AssignmentNotice{
		BoardID:     boardID,
		BoardName:   board.Name,
		CardID:      card.ID,
		CardTitle:   card.Title,
		RecipientID: assigneeID,
		ActorID:     actorID,
		ActorName:   name,
	}).Error
}

func deleteCardWithReferences(db *gorm.DB, boardID, cardID string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var card Card
		if err := tx.Where("id = ? AND board_id = ?", cardID, boardID).First(&card).Error; err != nil {
			return err
		}
		if err := tx.Delete(&card).Error; err != nil {
			return err
		}
		return clearDeletedCardReferences(tx, boardID, map[uint]bool{card.ID: true})
	})
}
