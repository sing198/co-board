package main

import "testing"

func TestDemoBoardIsIndependentAndPersisted(t *testing.T) {
	db := newTestDB(t)
	first, err := createBoard(db, 1, "", "demo")
	if err != nil {
		t.Fatal(err)
	}
	second, err := createBoard(db, 2, "", "demo")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatal("demos must have independent board IDs")
	}
	var stored Board
	if err := db.Preload("Cards").First(&stored, "id = ?", first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if len(stored.Cards) != 5 {
		t.Fatalf("want 5 sample cards, got %d", len(stored.Cards))
	}
	for _, card := range stored.Cards {
		if card.BoardID != first.ID {
			t.Fatal("sample card belongs to another board")
		}
	}
	var member BoardMember
	if err := db.First(&member, "board_id = ?", first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if member.UserID != 1 || member.Role != "owner" {
		t.Fatal("missing owner membership")
	}
}

func TestBlankBoardRemainsBlank(t *testing.T) {
	db := newTestDB(t)
	board, err := createBoard(db, 1, "My Board", "")
	if err != nil {
		t.Fatal(err)
	}
	if board.Name != "My Board" || len(board.Cards) != 0 {
		t.Fatal("blank board changed")
	}
}

func TestTemplateBoardSeedsColumnsAndType(t *testing.T) {
	db := newTestDB(t)
	board, err := createBoard(db, 1, "Sprint board", "sprint")
	if err != nil {
		t.Fatal(err)
	}
	if board.Columns != "BACKLOG,TO DO,IN PROGRESS,REVIEW,DONE" {
		t.Fatalf("unexpected sprint columns: %q", board.Columns)
	}
	if board.Type != "sprint" {
		t.Fatalf("want board type sprint, got %q", board.Type)
	}
	if len(board.Cards) != 0 {
		t.Fatal("template board must not carry sample cards")
	}
	blank, err := createBoard(db, 1, "Kanban board", "")
	if err != nil {
		t.Fatal(err)
	}
	if blank.Type != "kanban" || blank.Columns != "TODO,DOING,DONE" {
		t.Fatalf("default template wrong: type %q columns %q", blank.Type, blank.Columns)
	}
	if _, err := createBoard(db, 1, "", "nonsense"); err == nil {
		t.Fatal("expected unknown template to fail")
	}
}

func TestDemoCreationRollsBackOnMembershipFailure(t *testing.T) {
	db := newTestDB(t)
	if err := db.Migrator().DropTable(&BoardMember{}); err != nil {
		t.Fatal(err)
	}
	if _, err := createBoard(db, 1, "", "demo"); err == nil {
		t.Fatal("expected membership failure")
	}
	var boards, cards int64
	db.Model(&Board{}).Count(&boards)
	db.Model(&Card{}).Count(&cards)
	if boards != 0 || cards != 0 {
		t.Fatal("failed creation left partial data")
	}
}
