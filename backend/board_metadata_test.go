package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

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
