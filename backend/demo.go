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
	"":         "To do,Doing,Done",
	"kanban":   "To do,Doing,Done",
	"todo":     "To do,Done",
	"sprint":   "Backlog,To do,In progress,Review,Done",
	"content":  "Ideas,Drafting,Review,Published",
	"table":    "To do,Doing,Done",
	"calendar": "To do,Doing,Done",
	"timeline": "To do,Doing,Done",
	"mindmap":  "To do,Doing,Done",
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
		board.Columns = "To do,Doing,Done"
		board.Swimlanes = "Product,Engineering"
		board.Cards = []Card{
			{Title: "Drag this card into Doing", Description: "Move this task to another column. Open the same board in a second tab to watch changes arrive live.", List: "To do", Swimlane: "Product", Position: 1000, Tags: "Getting started"},
			{Title: "Write the launch announcement", Description: "Click a card to explore its description, tags and checklist.", List: "To do", Swimlane: "Product", Position: 2000, Tags: "Content"},
			{Title: "Review the mobile layout", Description: "Check the board on a narrow screen before launch.", List: "Doing", Swimlane: "Engineering", Position: 1000, Tags: "UI"},
			{Title: "Test live collaboration", Description: "Share the board link and move a card while both windows are open.", List: "Doing", Swimlane: "Engineering", Position: 2000, Tags: "Testing"},
			{Title: "Define launch milestones", Description: "An example of a completed task. This board contains sample data.", List: "Done", Swimlane: "Product", Position: 1000, Tags: "Planning"},
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

// duplicateBoard clones an existing board's structure, columns, swimlanes, and cards
// into a new board owned by ownerID.
func duplicateBoard(db *gorm.DB, ownerID uint, sourceBoardID, customName string) (Board, error) {
	var source Board
	if err := db.Preload("Cards", func(tx *gorm.DB) *gorm.DB {
		return tx.Order("position ASC, id ASC")
	}).Where("id = ?", sourceBoardID).First(&source).Error; err != nil {
		return Board{}, err
	}

	role := resolveBoardRole(db, source.ID, source.OwnerID, ownerID)
	if source.AccessLevel == "private" && role != "owner" && role != "edit" && role != "view" {
		return Board{}, errors.New("access denied")
	}

	name := customName
	if name == "" {
		name = source.Name + " (Copy)"
	}

	clonedCards := make([]Card, 0, len(source.Cards))
	for _, c := range source.Cards {
		clonedCards = append(clonedCards, Card{
			Title:       c.Title,
			Description: c.Description,
			DueDate:     c.DueDate,
			StartDate:   c.StartDate,
			StoryPoints: c.StoryPoints,
			InSprint:    c.InSprint,
			Checklist:   c.Checklist,
			List:        c.List,
			Swimlane:    c.Swimlane,
			Position:    c.Position,
			Tags:        c.Tags,
		})
	}

	board := Board{
		ID:           uuid.New().String(),
		Name:         name,
		OwnerID:      ownerID,
		Columns:      source.Columns,
		Swimlanes:    source.Swimlanes,
		AccessLevel:  "edit",
		Background:   source.Background,
		Type:         source.Type,
		SprintName:   source.SprintName,
		SprintStart:  source.SprintStart,
		SprintEnd:    source.SprintEnd,
		SprintStatus: source.SprintStatus,
		Cards:        clonedCards,
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&board).Error; err != nil {
			return err
		}
		return tx.Create(&BoardMember{BoardID: board.ID, UserID: ownerID, Role: "owner", LastSeen: time.Now()}).Error
	})
	return board, err
}
