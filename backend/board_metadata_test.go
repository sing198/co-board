package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
)

func TestAssigneeMustBelongToTheBoard(t *testing.T) {
	db := newTestDB(t)
	seedBoard(t, db, testBoardID, []Card{{Title: "Task", List: "TODO"}})
	if err := db.Create(&BoardMember{BoardID: testBoardID, UserID: 2, Role: "edit"}).Error; err != nil {
		t.Fatal(err)
	}
	var card Card
	if err := db.Where("board_id = ?", testBoardID).First(&card).Error; err != nil {
		t.Fatal(err)
	}
	cardID := fmt.Sprint(card.ID)
	if _, reason := validateCardMutation(WsMessage{Type: "EDIT_CARD", CardId: cardID, Changes: map[string]string{"assigneeId": "nope"}}); reason == "" {
		t.Fatal("invalid assignee accepted")
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: cardID, Changes: map[string]string{"assigneeId": "2"}, Expected: map[string]string{"assigneeId": "0"}}); err != nil {
		t.Fatal(err)
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: cardID, Changes: map[string]string{"assigneeId": "1"}, Expected: map[string]string{"assigneeId": "0"}}); err == nil {
		t.Fatal("stale assignee accepted")
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: cardID, Changes: map[string]string{"assigneeId": "1"}, Expected: map[string]string{"assigneeId": "2"}}); err != nil {
		t.Fatal(err)
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: cardID, Changes: map[string]string{"assigneeId": "99"}, Expected: map[string]string{"assigneeId": "1"}}); err == nil {
		t.Fatal("stranger accepted")
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: cardID, Changes: map[string]string{"assigneeId": "0"}, Expected: map[string]string{"assigneeId": "1"}}); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&card, card.ID).Error; err != nil {
		t.Fatal(err)
	}
	if card.AssigneeID != 0 {
		t.Fatalf("assignee = %d", card.AssigneeID)
	}
}

func TestCardMetadataValidationAndRelationships(t *testing.T) {
	db := newTestDB(t)
	seedBoard(t, db, testBoardID, []Card{
		{Title: "Parent", List: "TODO"},
		{Title: "Middle", List: "TODO"},
		{Title: "Leaf", List: "TODO"},
	})
	var cards []Card
	if err := db.Where("board_id = ?", testBoardID).Order("id").Find(&cards).Error; err != nil {
		t.Fatal(err)
	}
	parent, middle, leaf := cards[0], cards[1], cards[2]

	if _, err := addCardWithMetadata(db, testBoardID, WsMessage{Title: "Bad dates", ToList: "TODO", StartDate: "2026-02-30"}); err == nil {
		t.Fatal("invalid calendar date accepted")
	}
	if _, err := addCardWithMetadata(db, testBoardID, WsMessage{Title: "Wrong order", ToList: "TODO", StartDate: "2026-10-05", DueDate: "2026-10-04"}); err == nil {
		t.Fatal("due date before start date accepted")
	}
	otherBoardID := "771e1607-e15a-4237-bfcb-518745052979"
	seedBoard(t, db, otherBoardID, []Card{{Title: "Outside", List: "TODO"}})
	var outside Card
	if err := db.Where("board_id = ?", otherBoardID).First(&outside).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := addCardWithMetadata(db, testBoardID, WsMessage{Title: "Cross-board", ToList: "TODO", ParentID: fmt.Sprint(outside.ID)}); err == nil {
		t.Fatal("cross-board parent accepted")
	}
	child, err := addCardWithMetadata(db, testBoardID, WsMessage{Title: "Child", ToList: "TODO", ParentID: fmt.Sprint(parent.ID), StartDate: "2026-10-05", DueDate: "2026-10-07"})
	if err != nil {
		t.Fatal(err)
	}
	if child.ParentID != fmt.Sprint(parent.ID) || child.StartDate != "2026-10-05" {
		t.Fatalf("metadata not persisted: %+v", child)
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: fmt.Sprint(parent.ID), Changes: map[string]string{"dependencies": fmt.Sprint(child.ID)}, Expected: map[string]string{"dependencies": ""}}); err != nil {
		t.Fatalf("parent summary may depend on its child: %v", err)
	}

	// Parent and prerequisite graphs are separate. A parent summary may depend
	// on a child; only cycles within a single graph are invalid.
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: fmt.Sprint(middle.ID), Changes: map[string]string{"dependencies": fmt.Sprint(leaf.ID)}, Expected: map[string]string{"dependencies": ""}}); err != nil {
		t.Fatal(err)
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: fmt.Sprint(leaf.ID), Changes: map[string]string{"parentId": fmt.Sprint(parent.ID)}, Expected: map[string]string{"parentId": ""}}); err != nil {
		t.Fatal(err)
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: fmt.Sprint(parent.ID), Changes: map[string]string{"dependencies": fmt.Sprint(middle.ID)}, Expected: map[string]string{"dependencies": fmt.Sprint(child.ID)}}); err != nil {
		t.Fatalf("valid cross-graph relationship rejected: %v", err)
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: fmt.Sprint(leaf.ID), Changes: map[string]string{"dependencies": fmt.Sprint(parent.ID)}, Expected: map[string]string{"dependencies": ""}}); err == nil {
		t.Fatal("indirect dependency cycle accepted")
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: fmt.Sprint(parent.ID), Changes: map[string]string{"parentId": fmt.Sprint(child.ID)}, Expected: map[string]string{"parentId": ""}}); err == nil {
		t.Fatal("indirect parent cycle accepted")
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: fmt.Sprint(child.ID), Changes: map[string]string{"storyPoints": "-2"}}); err == nil {
		t.Fatal("negative story points accepted")
	}
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: fmt.Sprint(child.ID), Changes: map[string]string{"dependencies": fmt.Sprint(outside.ID)}}); err == nil {
		t.Fatal("cross-board dependency accepted")
	}

	// Removing the parent must detach children and links in the same transaction.
	if err := editCardWithMetadata(db, testBoardID, &WsMessage{CardId: fmt.Sprint(child.ID), Changes: map[string]string{"dependencies": fmt.Sprint(parent.ID)}, Expected: map[string]string{"dependencies": ""}}); err != nil {
		t.Fatal(err)
	}
	if err := deleteCardWithReferences(db, testBoardID, fmt.Sprint(parent.ID)); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&child, child.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&middle, middle.ID).Error; err != nil {
		t.Fatal(err)
	}
	if child.ParentID != "" || child.Dependencies != "" || middle.Dependencies != fmt.Sprint(leaf.ID) {
		t.Fatalf("dangling references after deletion: child=%+v middle=%+v", child, middle)
	}
}

func TestBoardDetailsPayloadIncludesFormatAndSprint(t *testing.T) {
	board := Board{ID: testBoardID, Type: "sprint", SprintName: "Iteration 1", SprintStart: "2026-10-05", SprintEnd: "2026-10-18", SprintStatus: "active"}
	response := boardDetailsPayload(board, "owner")
	for key, want := range map[string]string{"Type": "sprint", "SprintName": "Iteration 1", "SprintStart": "2026-10-05", "SprintEnd": "2026-10-18", "SprintStatus": "active", "UserRole": "owner"} {
		if response[key] != want {
			t.Fatalf("GET board response %s=%v, want %q", key, response[key], want)
		}
	}
}

func TestSprintMetadataValidationAndConflict(t *testing.T) {
	db := newTestDB(t)
	seedBoard(t, db, testBoardID, nil)
	if err := db.Model(&Board{}).Where("id = ?", testBoardID).Updates(map[string]interface{}{"board_type": "sprint", "sprint_status": "planning"}).Error; err != nil {
		t.Fatal(err)
	}
	msg := WsMessage{Type: "UPDATE_SPRINT", Changes: map[string]string{"name": "Iteration 1", "start": "2026-10-05", "end": "2026-10-18", "status": "active"}, Expected: map[string]string{"name": "", "start": "", "end": "", "status": "planning"}}
	if err := updateSprintMetadata(db, testBoardID, &msg); err != nil {
		t.Fatal(err)
	}
	var board Board
	if err := db.First(&board, "id = ?", testBoardID).Error; err != nil {
		t.Fatal(err)
	}
	if board.SprintName != "Iteration 1" || board.SprintEnd != "2026-10-18" || board.SprintStatus != "active" {
		t.Fatalf("sprint not persisted: %+v", board)
	}
	stale := WsMessage{Changes: map[string]string{"name": "Overwritten"}, Expected: map[string]string{"name": ""}}
	if err := updateSprintMetadata(db, testBoardID, &stale); err == nil {
		t.Fatal("stale sprint edit accepted")
	}
	badRange := WsMessage{Changes: map[string]string{"end": "2026-10-04"}}
	if err := updateSprintMetadata(db, testBoardID, &badRange); err == nil {
		t.Fatal("invalid sprint range accepted")
	}
}

func TestSprintWebSocketPermissionsAndRealtimeMetadata(t *testing.T) {
	db := newTestDB(t)
	seedBoard(t, db, testBoardID, []Card{{Title: "Root", List: "TODO"}})
	if err := db.Model(&Board{}).Where("id = ?", testBoardID).Update("board_type", "sprint").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&BoardMember{BoardID: testBoardID, UserID: 2, Role: "view"}).Error; err != nil {
		t.Fatal(err)
	}
	var root Card
	if err := db.Where("board_id = ?", testBoardID).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	hub := newTestHub(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { serveWs(hub, db, w, r) }))
	defer server.Close()
	dial := func(user uint) *websocket.Conn {
		conn, _, err := websocket.DefaultDialer.Dial("ws"+server.URL[4:]+"?boardId="+testBoardID+"&ticket="+createWSTicket(user), nil)
		if err != nil {
			t.Fatal(err)
		}
		conn.SetReadDeadline(time.Now().Add(4 * time.Second))
		return conn
	}
	owner, viewer := dial(1), dial(2)
	defer owner.Close()
	defer viewer.Close()
	if err := viewer.WriteJSON(WsMessage{Type: "UPDATE_SPRINT", RequestID: "forbidden", Changes: map[string]string{"status": "active"}}); err != nil {
		t.Fatal(err)
	}
	var event WsMessage
	if err := readMutation(viewer, &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "ERROR" || event.RequestID != "forbidden" {
		t.Fatalf("viewer changed sprint: %+v", event)
	}
	if err := owner.WriteJSON(WsMessage{Type: "ADD_CARD", RequestID: "add", Title: "Child", ToList: "TODO", ParentID: fmt.Sprint(root.ID), StartDate: "2026-10-05", DueDate: "2026-10-07"}); err != nil {
		t.Fatal(err)
	}
	if err := readMutation(viewer, &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "ADD_CARD" || event.Card == nil || event.Card.ParentID != fmt.Sprint(root.ID) || event.Card.StartDate != "2026-10-05" {
		t.Fatalf("new metadata not broadcast: %+v", event)
	}
	childID := fmt.Sprint(event.Card.ID)
	if err := readMutation(owner, &event); err != nil {
		t.Fatal(err)
	}
	if err := owner.WriteJSON(WsMessage{Type: "EDIT_CARD", RequestID: "edit", CardId: childID, Changes: map[string]string{"storyPoints": "5", "inSprint": "true", "dependencies": fmt.Sprint(root.ID)}, Expected: map[string]string{"storyPoints": "0", "inSprint": "false", "dependencies": ""}}); err != nil {
		t.Fatal(err)
	}
	if err := readMutation(viewer, &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "EDIT_CARD" || event.Changes["storyPoints"] != "5" || event.Changes["inSprint"] != "true" {
		t.Fatalf("edit metadata not broadcast: %+v", event)
	}
	if err := readMutation(owner, &event); err != nil {
		t.Fatal(err)
	}
	var saved Card
	if err := db.First(&saved, event.CardId).Error; err != nil {
		t.Fatal(err)
	}
	if saved.StoryPoints != 5 || !saved.InSprint || saved.Dependencies != fmt.Sprint(root.ID) {
		t.Fatalf("edit metadata not persisted: %+v", saved)
	}
	if err := owner.WriteJSON(WsMessage{Type: "UPDATE_SPRINT", RequestID: "sprint", Changes: map[string]string{"name": "Sprint 1", "start": "2026-10-05", "end": "2026-10-18", "status": "active"}, Expected: map[string]string{"name": "", "status": "planning"}}); err != nil {
		t.Fatal(err)
	}
	if err := readMutation(viewer, &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "UPDATE_SPRINT" || event.SprintName != "Sprint 1" || event.SprintStatus != "active" {
		t.Fatalf("sprint metadata not broadcast: %+v", event)
	}
}

func TestSprintLifecycleRequiresDatesAndFreezesSetup(t *testing.T) {
	db := newTestDB(t)
	board, err := createBoard(db, 1, "Iteration", "sprint")
	if err != nil {
		t.Fatal(err)
	}
	if err := updateSprintMetadata(db, board.ID, &WsMessage{Changes: map[string]string{"status": "active"}}); err == nil {
		t.Fatal("undated sprint was started")
	}
	if err := updateSprintMetadata(db, board.ID, &WsMessage{Changes: map[string]string{"status": "completed"}}); err == nil {
		t.Fatal("unstarted sprint was completed")
	}
	if err := updateSprintMetadata(db, board.ID, &WsMessage{Changes: map[string]string{"name": "Iteration 1", "start": "2026-10-05", "end": "2026-10-12", "status": "active"}}); err != nil {
		t.Fatal(err)
	}
	if err := updateSprintMetadata(db, board.ID, &WsMessage{Changes: map[string]string{"start": "2026-10-06"}}); err == nil {
		t.Fatal("active sprint setup changed")
	}
	if err := updateSprintMetadata(db, board.ID, &WsMessage{Changes: map[string]string{"status": "completed"}}); err != nil {
		t.Fatal(err)
	}
	if err := updateSprintMetadata(db, board.ID, &WsMessage{Changes: map[string]string{"status": "planning"}}); err == nil {
		t.Fatal("completed sprint history overwritten")
	}
}

func TestShortActivityNotes(t *testing.T) {
	db := newTestDB(t)
	seedBoard(t, db, testBoardID, []Card{{Title: "Ship it", List: "TODO"}, {Title: "Other", List: "TODO"}})
	if err := db.Create(&User{ID: 2, GoogleID: "sam-google", Email: "sam@example.com", Name: "Sam Lee"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&BoardMember{BoardID: testBoardID, UserID: 2, Role: "edit"}).Error; err != nil {
		t.Fatal(err)
	}
	var cards []Card
	if err := db.Where("board_id = ?", testBoardID).Order("id").Find(&cards).Error; err != nil {
		t.Fatal(err)
	}
	cardID := fmt.Sprint(cards[0].ID)

	if _, reason := validateCardMutation(WsMessage{Type: "ADD_CARD_NOTE", CardId: "", Text: "hello"}); reason != "Missing cardId." {
		t.Fatalf("missing card: %q", reason)
	}
	if _, reason := validateCardMutation(WsMessage{Type: "ADD_CARD_NOTE", CardId: cardID, Text: " \n\t "}); reason != "Write a short note first." {
		t.Fatalf("empty note: %q", reason)
	}
	tooLong := strings.Repeat("ก", 281)
	if _, reason := validateCardMutation(WsMessage{Type: "ADD_CARD_NOTE", CardId: cardID, Text: tooLong}); reason != "Keep the note under 280 characters." {
		t.Fatalf("long note: %q", reason)
	}
	ok, reason := validateCardMutation(WsMessage{Type: "ADD_CARD_NOTE", CardId: cardID, Text: "  hello\nthere  " + strings.Repeat("ก", 268)})
	if reason != "" || utf8.RuneCountInString(ok.Text) != 280 || !strings.HasPrefix(ok.Text, "hello there ") {
		t.Fatalf("normalized note %q (%s)", ok.Text, reason)
	}

	if bodies := editActivityBodies(db, map[string]string{"description": "Only the description"}); len(bodies) != 0 {
		t.Fatalf("description created a note: %+v", bodies)
	}
	renamed := editActivityBodies(db, map[string]string{"title": "New name"})
	if len(renamed) != 1 || renamed[0].Kind != "renamed" || renamed[0].Body != "renamed this" {
		t.Fatalf("rename: %+v", renamed)
	}
	cleared := editActivityBodies(db, map[string]string{"assigneeId": "0"})
	if len(cleared) != 1 || cleared[0].Body != "cleared the assignee" {
		t.Fatalf("clear: %+v", cleared)
	}
	named := editActivityBodies(db, map[string]string{"title": "New name", "assigneeId": "2", "description": "skip"})
	if len(named) != 2 || named[0].Body != "renamed this" || named[1].Body != "assigned this to Sam Lee" {
		t.Fatalf("named assign: %+v", named)
	}
	missing := editActivityBodies(db, map[string]string{"assigneeId": "99"})
	if len(missing) != 1 || missing[0].Body != "assigned this" {
		t.Fatalf("missing person: %+v", missing)
	}
	if got := clipRunes(strings.Repeat("ก", 41), 40); utf8.RuneCountInString(got) != 40 {
		t.Fatalf("column clip %d", utf8.RuneCountInString(got))
	}

	moved, err := saveCardActivity(db, testBoardID, cardID, 7, "Alex", "moved", "moved this to Doing")
	if err != nil {
		t.Fatal(err)
	}
	if moved.Text != "Alex moved this to Doing" {
		t.Fatalf("move text %q", moved.Text)
	}
	guest, err := saveCardActivity(db, testBoardID, cardID, 0, "Guest", "added", "added this task")
	if err != nil || guest.Text != "Guest added this task" {
		t.Fatalf("guest text %q %v", guest.Text, err)
	}
	someone, err := saveCardActivity(db, testBoardID, cardID, 0, "  ", "comment", "ship it")
	if err != nil || someone.Text != "Someone: ship it" {
		t.Fatalf("someone text %q %v", someone.Text, err)
	}
	var saved Card
	if err := db.First(&saved, cards[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if saved.LatestNote != "Someone: ship it" {
		t.Fatalf("latest note %q", saved.LatestNote)
	}
	if _, err := saveCardActivity(db, testBoardID, "999999", 7, "Alex", "moved", "moved this to Doing"); err == nil || err.Error() != "task was deleted" {
		t.Fatalf("missing task: %v", err)
	}
	other, err := saveCardActivity(db, testBoardID, fmt.Sprint(cards[1].ID), 7, "Alex", "renamed", "renamed this")
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteCardWithReferences(db, testBoardID, cardID); err != nil {
		t.Fatal(err)
	}
	var left int64
	if err := db.Model(&CardActivity{}).Where("card_id = ?", cards[0].ID).Count(&left).Error; err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("deleted task kept %d notes", left)
	}
	if err := db.First(&other, other.ID).Error; err != nil {
		t.Fatal("other task note was removed")
	}
}

func TestAssignmentNoticeReachesTheOtherPerson(t *testing.T) {
	db := newTestDB(t)
	seedBoard(t, db, testBoardID, []Card{{Title: "Ship it", List: "TODO"}})
	var card Card
	if err := db.Where("board_id = ?", testBoardID).First(&card).Error; err != nil {
		t.Fatal(err)
	}
	if _, ok := assignmentRecipient(map[string]string{"description": "Later"}, nil, 7); ok {
		t.Fatal("description created a notice")
	}
	if _, ok := assignmentRecipient(map[string]string{"assigneeId": "7"}, nil, 7); ok {
		t.Fatal("self assignment created a notice")
	}
	if _, ok := assignmentRecipient(map[string]string{"assigneeId": "0"}, nil, 7); ok {
		t.Fatal("clearing the assignee created a notice")
	}
	if _, ok := assignmentRecipient(map[string]string{"assigneeId": "2"}, map[string]string{"assigneeId": "2"}, 7); ok {
		t.Fatal("unchanged assignee created a notice")
	}
	recipient, ok := assignmentRecipient(map[string]string{"assigneeId": "2"}, map[string]string{"assigneeId": "0"}, 7)
	if !ok || recipient != 2 {
		t.Fatalf("recipient %d %v", recipient, ok)
	}
	if err := recordAssignmentNotice(db, testBoardID, card, 7, "  ", recipient); err != nil {
		t.Fatal(err)
	}
	var notice AssignmentNotice
	if err := db.Where("recipient_id = ?", 2).First(&notice).Error; err != nil {
		t.Fatal(err)
	}
	if notice.ActorName != "Someone" || notice.CardTitle != "Ship it" || notice.BoardName != "Test Board" || notice.Seen {
		t.Fatalf("notice %+v", notice)
	}
	if err := recordAssignmentNotice(db, testBoardID, card, 7, "Alex", 7); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&AssignmentNotice{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("notices %d", count)
	}
	if err := deleteCardWithReferences(db, testBoardID, fmt.Sprint(card.ID)); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&AssignmentNotice{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("deleted task kept %d notices", count)
	}
}
