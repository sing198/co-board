package main

import (
	"errors"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"time"
)

// boardTemplates seed the starting columns of each board type.
// The empty key is the default board (classic kanban columns).
var boardTemplates = map[string]string{
	"":         "TODO,DOING,DONE",
	"kanban":   "TODO,DOING,DONE",
	"todo":     "TO DO,DONE",
	"sprint":   "BACKLOG,TO DO,IN PROGRESS,REVIEW,DONE",
	"content":  "IDEAS,DRAFTING,REVIEW,PUBLISHED",
	"table":    "TODO,DOING,DONE",
	"calendar": "TODO,DOING,DONE",
	"timeline": "TODO,DOING,DONE",
	"mindmap":  "TODO,DOING,DONE",
}

// isValidBoardTemplate reports whether POST /api/boards accepts the key.
func isValidBoardTemplate(template string) bool {
	if template == "demo" {
		return true
	}
	_, ok := boardTemplates[template]
	return ok
}

// createBoard commits the board, owner membership and optional sample cards together.
// template selects the starting columns: "demo" seeds the sample board, "" or
// "kanban" the classic three columns, and the other keys one row of boardTemplates.
func createBoard(db *gorm.DB, ownerID uint, name, template string) (Board, error) {
	board := Board{ID: uuid.New().String(), Name: name, OwnerID: ownerID, Type: "kanban", SprintStatus: "planning"}
	if template == "demo" {
		board.Name = "Product Launch · Demo"
		board.Columns = "TODO,DOING,DONE"
		board.Swimlanes = "Product,Engineering"
		board.Cards = []Card{
			{Title: "Drag this card into DOING", Description: "Move this task to another column. Open the same board in a second tab to watch changes arrive live.", List: "TODO", Swimlane: "Product", Position: 1000, Tags: "Getting started"},
			{Title: "Write the launch announcement", Description: "Click a card to explore its description, tags and checklist.", List: "TODO", Swimlane: "Product", Position: 2000, Tags: "Content"},
			{Title: "Review the mobile layout", Description: "Check the board on a narrow screen before launch.", List: "DOING", Swimlane: "Engineering", Position: 1000, Tags: "UI"},
			{Title: "Test live collaboration", Description: "Share the board link and move a card while both windows are open.", List: "DOING", Swimlane: "Engineering", Position: 2000, Tags: "Testing"},
			{Title: "Define launch milestones", Description: "An example of a completed task. This board contains sample data.", List: "DONE", Swimlane: "Product", Position: 1000, Tags: "Planning"},
		}
	} else if columns, ok := boardTemplates[template]; ok {
		board.Columns = columns
		if template != "" {
			board.Type = template
		}
	} else {
		return Board{}, errors.New("unknown board template")
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&board).Error; err != nil {
			return err
		}
		return tx.Create(&BoardMember{BoardID: board.ID, UserID: ownerID, Role: "owner", LastSeen: time.Now()}).Error
	})
	return board, err
}
