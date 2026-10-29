package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"gorm.io/gorm"
)

type WSTicket struct {
	UserID uint
	Expiry time.Time
}

var (
	allowedOriginsMap = map[string]bool{}
	ticketStore       = make(map[string]WSTicket)
	ticketMu          sync.Mutex
)

func isOriginAllowed(origin string) bool {
	return allowedOriginsMap[origin]
}

func requestUserID(c *gin.Context) uint {
	tokenString := strings.TrimSpace(c.GetHeader("Authorization"))
	if !strings.HasPrefix(tokenString, "Bearer ") {
		return 0
	}
	tokenString = strings.TrimSpace(strings.TrimPrefix(tokenString, "Bearer "))
	token, err := parseJWT(tokenString)
	if err != nil || token == nil || !token.Valid {
		return 0
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0
	}
	id, ok := claims["sub"].(float64)
	if !ok {
		return 0
	}
	return uint(id)
}

// One response shape for every board format. The live workspace consumes the
// persisted format and sprint settings from this endpoint after reconnects.
func boardDetailsPayload(board Board, userRole string) gin.H {
	return gin.H{
		"ID": board.ID, "Name": board.Name, "OwnerID": board.OwnerID,
		"Columns": board.Columns, "Swimlanes": board.Swimlanes,
		"AccessLevel": board.AccessLevel, "Background": board.Background,
		"Type": board.Type, "SprintName": board.SprintName,
		"SprintStart": board.SprintStart, "SprintEnd": board.SprintEnd,
		"SprintStatus": board.SprintStatus,
		"Cards":        board.Cards, "UserRole": userRole,
	}
}

func createWSTicket(userID uint) string {
	ticketMu.Lock()
	defer ticketMu.Unlock()
	t := uuid.New().String()
	ticketStore[t] = WSTicket{
		UserID: userID,
		Expiry: time.Now().Add(30 * time.Second),
	}
	return t
}

func consumeWSTicket(t string) (uint, bool) {
	ticketMu.Lock()
	defer ticketMu.Unlock()
	item, ok := ticketStore[t]
	if !ok {
		return 0, false
	}
	delete(ticketStore, t) // one-time use
	if time.Now().After(item.Expiry) {
		return 0, false
	}
	return item.UserID, true
}

// cleanupTickets periodically purges expired WS tickets from ticketStore.
// Tickets are single-use but can be abandoned (e.g. the client never opens the
// socket after requesting a ticket), so without this they would accumulate
// forever.
func cleanupTickets() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		ticketMu.Lock()
		now := time.Now()
		for t, item := range ticketStore {
			if now.After(item.Expiry) {
				delete(ticketStore, t)
			}
		}
		ticketMu.Unlock()
	}
}

func startGuestBoardCleanupWorker(db *gorm.DB) {
	ticker := time.NewTicker(1 * time.Hour)
	for range ticker.C {
		cutoff := time.Now().Add(-24 * time.Hour)
		var guestUser User
		if err := db.Where("email = ?", "guest@kanban.demo").First(&guestUser).Error; err != nil {
			continue
		}
		var oldBoards []Board
		if err := db.Where("owner_id = ? AND created_at < ?", guestUser.ID, cutoff).Find(&oldBoards).Error; err != nil {
			// Log instead of silently skipping: a failed listing used to mean
			// expired guest boards piled up forever with no trace in the logs.
			log.Printf("guest board cleanup: failed to list expired boards: %v", err)
			continue
		}
		for _, b := range oldBoards {
			// Delete every board-scoped row. The old version deleted only
			// Card/BoardMember/AccessRequest/Board and left the board's
			// CardActivity and AssignmentNotice rows behind as orphans.
			if err := db.Where("board_id = ?", b.ID).Delete(&Card{}).Error; err != nil {
				log.Printf("guest board cleanup: failed to delete cards for board %s: %v", b.ID, err)
			}
			if err := db.Where("board_id = ?", b.ID).Delete(&BoardMember{}).Error; err != nil {
				log.Printf("guest board cleanup: failed to delete members for board %s: %v", b.ID, err)
			}
			if err := db.Where("board_id = ?", b.ID).Delete(&AccessRequest{}).Error; err != nil {
				log.Printf("guest board cleanup: failed to delete access requests for board %s: %v", b.ID, err)
			}
			if err := db.Where("board_id = ?", b.ID).Delete(&CardActivity{}).Error; err != nil {
				log.Printf("guest board cleanup: failed to delete card activity for board %s: %v", b.ID, err)
			}
			if err := db.Where("board_id = ?", b.ID).Delete(&AssignmentNotice{}).Error; err != nil {
				log.Printf("guest board cleanup: failed to delete assignment notices for board %s: %v", b.ID, err)
			}
			if err := db.Where("id = ?", b.ID).Delete(&Board{}).Error; err != nil {
				log.Printf("guest board cleanup: failed to delete board %s: %v", b.ID, err)
				continue
			}
			log.Printf("🧹 Cleaned up expired guest board %s (older than 24h)\n", b.ID)
		}
	}
}

// Retention limits for append-only rows. These are the only tables that grow
// without a user deleting something, so capping them bounds total database
// size no matter how long the app runs on a small (1 GB) database.
const (
	// Keep at most this many activity rows per card; the card face only shows
	// the latest note, and the activity feed is recent history, not an audit log.
	retentionActivityMaxPerCard = 50
	// Activity older than this is deleted even if the card has fewer rows.
	retentionActivityMaxAge = 90 * 24 * time.Hour
	// A notice the recipient has already seen has served its purpose.
	retentionSeenNoticeMaxAge = 30 * 24 * time.Hour
	// Pending requests are never deleted here; only decided ones age out.
	retentionResolvedRequestMaxAge = 30 * 24 * time.Hour
)

// startRetentionCleanupWorker prunes append-only rows on the same hourly
// cadence as the guest-board cleanup. It deliberately never touches boards,
// cards, members, or pending access requests.
func startRetentionCleanupWorker(db *gorm.DB) {
	ticker := time.NewTicker(1 * time.Hour)
	for range ticker.C {
		now := time.Now()

		// Card activity older than 90 days.
		if err := db.Where("created_at < ?", now.Add(-retentionActivityMaxAge)).Delete(&CardActivity{}).Error; err != nil {
			log.Printf("retention cleanup: failed to delete old card activity: %v", err)
		}
		// Cap activity at the latest 50 rows per card (newest first by
		// created_at, id breaks ties). Works on both PostgreSQL and SQLite.
		if err := db.Exec(`DELETE FROM card_activities WHERE id NOT IN (SELECT id FROM card_activities AS keep WHERE keep.card_id = card_activities.card_id ORDER BY keep.created_at DESC, keep.id DESC LIMIT ?)`, retentionActivityMaxPerCard).Error; err != nil {
			log.Printf("retention cleanup: failed to cap card activity per card: %v", err)
		}
		// Assignment notices the recipient has already seen, older than 30 days.
		// Unseen notices are kept indefinitely so nobody loses an unread bell item.
		if err := db.Where("seen = ? AND created_at < ?", true, now.Add(-retentionSeenNoticeMaxAge)).Delete(&AssignmentNotice{}).Error; err != nil {
			log.Printf("retention cleanup: failed to delete old seen assignment notices: %v", err)
		}
		// Decided (approved/dismissed) access requests older than 30 days.
		if err := db.Where("status != ? AND created_at < ?", "pending", now.Add(-retentionResolvedRequestMaxAge)).Delete(&AccessRequest{}).Error; err != nil {
			log.Printf("retention cleanup: failed to delete old resolved access requests: %v", err)
		}
	}
}

type IPRateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

func newIPRateLimiter(limit int, window time.Duration) *IPRateLimiter {
	limiter := &IPRateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}

	go func() {
		ticker := time.NewTicker(2 * time.Minute)
		for range ticker.C {
			limiter.mu.Lock()
			now := time.Now()
			for ip, times := range limiter.requests {
				var valid []time.Time
				for _, t := range times {
					if now.Sub(t) < limiter.window {
						valid = append(valid, t)
					}
				}
				if len(valid) == 0 {
					delete(limiter.requests, ip)
				} else {
					limiter.requests[ip] = valid
				}
			}
			limiter.mu.Unlock()
		}
	}()

	return limiter
}

func (l *IPRateLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	times, exists := l.requests[ip]
	if !exists {
		l.requests[ip] = []time.Time{now}
		return true
	}

	var valid []time.Time
	for _, t := range times {
		if now.Sub(t) < l.window {
			valid = append(valid, t)
		}
	}

	if len(valid) >= l.limit {
		l.requests[ip] = valid
		return false
	}

	l.requests[ip] = append(valid, now)
	return true
}

func rateLimiterMiddleware(limiter *IPRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		if p == "/ws" || p == "/api/notifications" || c.Request.Method == "OPTIONS" {
			c.Next()
			return
		}

		ip := c.ClientIP()
		if !limiter.allow(ip) {
			c.Header("Retry-After", "60")
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       "Rate limit exceeded. Too many requests.",
				"retry_after": 60,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

func main() {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	// Fail fast if required secrets/config are missing.
	initJWTSecret()

	// Reap expired WS tickets so abandoned entries don't leak memory.
	go cleanupTickets()

	// Initialize Database
	db := InitDB()

	// Start 24-hour Guest Board Garbage Collection Worker
	go startGuestBoardCleanupWorker(db)

	// Prune append-only activity, notice, and resolved-request rows so the
	// database cannot grow without bound on a small free-tier database.
	go startRetentionCleanupWorker(db)

	// Initialize OAuth
	InitOAuth()

	// Initialize WebSocket Hub
	hub := newHub()
	go hub.run()

	r := gin.Default()

	// 1. CORS middleware MUST BE FIRST so OPTIONS preflights always receive headers and 204.
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		} else {
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		}
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Origin, Accept")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// 2. Rate Limiting Middleware (after CORS headers are attached)
	ipLimiter := newIPRateLimiter(300, time.Minute)
	r.Use(rateLimiterMiddleware(ipLimiter))

	// Auth Routes
	r.GET("/auth/google/login", GoogleLogin)
	r.GET("/auth/google/callback", GoogleCallback(db))
	r.POST("/api/auth/guest", GuestLogin(db))

	r.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "pong"})
	})

	// Fetch Initial Board State (sorted by position ASC)
	r.GET("/api/boards/:id", func(c *gin.Context) {
		id := c.Param("id")
		var board Board
		err := db.Preload("Cards", func(tx *gorm.DB) *gorm.DB {
			return tx.Order("position ASC, id ASC")
		}).Where("id = ?", id).First(&board).Error

		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "Board not found"})
			} else {
				c.JSON(500, gin.H{"error": "Could not load board"})
			}
			return
		}

		// Resolve the caller's role on this board so the frontend can render the
		// correct editor/viewer UI. The board's AccessLevel alone is not enough:
		// a user may have been granted "edit" via a BoardMember record or an
		// approved AccessRequest even when the board is otherwise view/private.
		userRole := ""
		tokenString := c.GetHeader("Authorization")
		if strings.HasPrefix(tokenString, "Bearer ") {
			tokenString = strings.TrimSpace(strings.TrimPrefix(tokenString, "Bearer "))
			if token, err := parseJWT(tokenString); err == nil && token.Valid {
				if claims, ok := token.Claims.(jwt.MapClaims); ok {
					if floatID, ok := claims["sub"].(float64); ok {
						uID := uint(floatID)
						userRole = resolveBoardRole(db, id, board.OwnerID, uID)

						// Optional history record for authenticated visitor (only if not owner AND not guest@kanban.demo)
						var guestUser User
						isGuestVisitor := false
						if err := db.Where("email = ?", "guest@kanban.demo").First(&guestUser).Error; err == nil && guestUser.ID == uID {
							isGuestVisitor = true
						}

						if !isGuestVisitor && board.OwnerID != uID {
							var member BoardMember
							if err := db.Where("board_id = ? AND user_id = ?", id, uID).First(&member).Error; err != nil {
								if userRole == "edit" || userRole == "view" {
									db.Create(&BoardMember{BoardID: id, UserID: uID, Role: userRole, LastSeen: time.Now()})
								}
							} else if member.Role != "owner" {
								db.Model(&member).Update("last_seen", time.Now())
							}
						}
					}
				}
			}
		}

		if board.AccessLevel == "private" && userRole != "owner" && userRole != "edit" && userRole != "view" {
			inviteBoard, role, err := VerifyBoardInviteToken(c.Query("inviteToken"))
			if err != nil || inviteBoard != id {
				c.JSON(403, gin.H{"error": "Access denied"})
				return
			}
			userRole = role
		}

		c.JSON(200, boardDetailsPayload(board, userRole))
	})

	// Recent activity for one task. Public boards stay readable without a
	// login, matching GET /api/boards/:id. Private boards need the same role
	// or invite token as the board itself.
	r.GET("/api/boards/:id/cards/:cardId/notes", func(c *gin.Context) {
		id := c.Param("id")
		var board Board
		if err := db.Select("id", "owner_id", "access_level").Where("id = ?", id).First(&board).Error; err != nil {
			c.JSON(404, gin.H{"error": "Board not found"})
			return
		}
		userRole := resolveBoardRole(db, id, board.OwnerID, requestUserID(c))
		if board.AccessLevel == "private" && userRole != "owner" && userRole != "edit" && userRole != "view" {
			inviteBoard, _, err := VerifyBoardInviteToken(c.Query("inviteToken"))
			if err != nil || inviteBoard != id {
				c.JSON(403, gin.H{"error": "Access denied"})
				return
			}
		}
		var card Card
		if err := db.Select("id").Where("id = ? AND board_id = ?", c.Param("cardId"), id).First(&card).Error; err != nil {
			c.JSON(404, gin.H{"error": "Task not found"})
			return
		}
		var notes []CardActivity
		if err := db.Where("board_id = ? AND card_id = ?", id, card.ID).Order("id DESC").Limit(20).Find(&notes).Error; err != nil {
			c.JSON(500, gin.H{"error": "Could not load notes"})
			return
		}
		if notes == nil {
			notes = []CardActivity{}
		}
		c.JSON(200, notes)
	})

	// Auth Middleware
	authMiddleware := func(c *gin.Context) {
		tokenString := c.GetHeader("Authorization")
		if tokenString == "" {
			c.AbortWithStatusJSON(401, gin.H{"error": "Missing token"})
			return
		}

		// Remove "Bearer " prefix if present (use HasPrefix to avoid index bugs)
		tokenString = strings.TrimSpace(tokenString)
		if strings.HasPrefix(tokenString, "Bearer ") {
			tokenString = strings.TrimSpace(strings.TrimPrefix(tokenString, "Bearer "))
		}

		token, err := parseJWT(tokenString)
		if err == nil && token.Valid {
			if claims, ok := token.Claims.(jwt.MapClaims); ok {
				if floatID, ok := claims["sub"].(float64); ok {
					c.Set("userID", uint(floatID))
					c.Next()
					return
				}
			}
		}
		c.AbortWithStatusJSON(401, gin.H{"error": "Invalid token"})
	}

	// Invite tokens grant edit/view access, so only the board owner may
	// mint them. Previously this endpoint was unauthenticated, letting anyone
	// fetch an edit invite token for any board (including private ones) and
	// escalate themselves to editor — a critical privilege escalation.
	r.GET("/api/boards/:id/invite-tokens", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		id := c.Param("id")

		var b Board
		if err := db.Where("id = ?", id).First(&b).Error; err != nil {
			c.JSON(404, gin.H{"error": "Board not found"})
			return
		}
		if b.OwnerID != userID {
			c.JSON(403, gin.H{"error": "Only the board owner can view invite tokens"})
			return
		}

		editToken, err1 := GenerateBoardInviteToken(id, "edit")
		viewToken, err2 := GenerateBoardInviteToken(id, "view")
		if err1 != nil || err2 != nil {
			c.JSON(500, gin.H{"error": "Failed generating invite tokens"})
			return
		}
		c.JSON(200, gin.H{
			"editToken": editToken,
			"viewToken": viewToken,
		})
	})

	// Request short-lived WS ticket (Item 8)
	r.POST("/api/ws-ticket", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		ticket := createWSTicket(userID)
		c.JSON(200, gin.H{"ticket": ticket})
	})

	r.GET("/api/me/boards", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)

		var memberBoardIDs []string
		db.Model(&BoardMember{}).Where("user_id = ? AND role != 'owner'", userID).Pluck("board_id", &memberBoardIDs)

		// Never leak/attach shared boards of other users to guest@kanban.demo demo account
		var guestUser User
		if err := db.Where("email = ?", "guest@kanban.demo").First(&guestUser).Error; err == nil && guestUser.ID == userID {
			memberBoardIDs = nil
		}

		var boards []Board
		if len(memberBoardIDs) > 0 {
			db.Preload("Cards").Where("owner_id = ? OR (id IN ? AND owner_id != ?)", userID, memberBoardIDs, userID).Find(&boards)
		} else {
			db.Preload("Cards").Where("owner_id = ?", userID).Find(&boards)
		}

		type BoardResponse struct {
			Board
			IsOwner     bool           `json:"IsOwner"`
			OnlineUsers []UserPresence `json:"OnlineUsers"`
		}

		res := make([]BoardResponse, 0, len(boards))
		for _, b := range boards {
			online := hub.GetOnlineUsers(b.ID)
			res = append(res, BoardResponse{
				Board:       b,
				IsOwner:     b.OwnerID == userID,
				OnlineUsers: online,
			})
		}
		c.JSON(200, res)
	})

	r.POST("/api/boards", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		var req struct {
			Name     string `json:"name"`
			Template string `json:"template"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid payload"})
			return
		}
		if !isValidBoardTemplate(req.Template) {
			c.JSON(400, gin.H{"error": "Unknown board template"})
			return
		}
		board, err := createBoard(db, userID, req.Name, req.Template)
		if err != nil {
			c.JSON(500, gin.H{"error": "Could not create board"})
			return
		}

		c.JSON(200, board)
	})

	r.PUT("/api/boards/:id", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		id := c.Param("id")
		var req struct {
			Name string `json:"name"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid payload"})
			return
		}
		var board Board
		if err := db.Where("id = ? AND owner_id = ?", id, userID).First(&board).Error; err != nil {
			c.JSON(403, gin.H{"error": "Unauthorized or not found"})
			return
		}
		board.Name = req.Name
		db.Save(&board)
		c.JSON(200, board)
	})

	r.DELETE("/api/boards/:id", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		id := c.Param("id")

		err := db.Transaction(func(tx *gorm.DB) error {
			var board Board
			if err := tx.Where("id = ? AND owner_id = ?", id, userID).First(&board).Error; err != nil {
				return err
			}
			if err := tx.Where("board_id = ?", id).Delete(&Card{}).Error; err != nil {
				return err
			}
			if err := tx.Where("board_id = ?", id).Delete(&BoardMember{}).Error; err != nil {
				return err
			}
			if err := tx.Where("board_id = ?", id).Delete(&AccessRequest{}).Error; err != nil {
				return err
			}
			if err := tx.Where("board_id = ?", id).Delete(&AssignmentNotice{}).Error; err != nil {
				return err
			}
			if err := tx.Where("board_id = ?", id).Delete(&CardActivity{}).Error; err != nil {
				return err
			}
			return tx.Where("id = ?", id).Delete(&Board{}).Error
		})

		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "Board not found"})
			} else {
				log.Println("Failed to delete board:", err)
				c.JSON(500, gin.H{"error": "Failed to delete board"})
			}
			return
		}
		c.JSON(200, gin.H{"message": "deleted"})
	})

	// Request Edit Permission for a board
	r.POST("/api/boards/:id/request-access", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		boardID := c.Param("id")

		var b Board
		if err := db.Where("id = ?", boardID).First(&b).Error; err != nil {
			c.JSON(404, gin.H{"error": "Board not found"})
			return
		}

		if b.OwnerID == userID {
			c.JSON(400, gin.H{"error": "You are the owner of this board"})
			return
		}

		var u User
		if err := db.First(&u, userID).Error; err != nil {
			c.JSON(404, gin.H{"error": "User not found"})
			return
		}

		var mb BoardMember
		if err := db.Where("board_id = ? AND user_id = ?", boardID, userID).First(&mb).Error; err == nil {
			if mb.Role == "edit" {
				c.JSON(200, gin.H{"status": "approved"})
				return
			}
		}

		var req AccessRequest
		if err := db.Where("board_id = ? AND user_id = ?", boardID, userID).First(&req).Error; err == nil {
			req.Status = "pending"
			req.CreatedAt = time.Now()
			db.Save(&req)
		} else {
			req = AccessRequest{
				BoardID:   boardID,
				BoardName: b.Name,
				UserID:    userID,
				UserName:  u.Name,
				UserEmail: u.Email,
				AvatarURL: u.AvatarURL,
				Status:    "pending",
				CreatedAt: time.Now(),
			}
			if err := db.Create(&req).Error; err != nil {
				c.JSON(500, gin.H{"error": "Failed creating access request"})
				return
			}
		}

		// Broadcast real-time notification to WS room
		wsMsg, _ := json.Marshal(gin.H{
			"type":      "ACCESS_REQUESTED",
			"boardId":   boardID,
			"requestId": req.ID,
			"userName":  u.Name,
		})
		hub.publish <- wsMsg

		c.JSON(200, req)
	})

	// Fetch Notifications for Board Owner
	r.GET("/api/notifications", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)

		var ownedBoardIDs []string
		db.Model(&Board{}).Where("owner_id = ?", userID).Pluck("id", &ownedBoardIDs)

		var requests []AccessRequest
		var unreadCount int64
		if len(ownedBoardIDs) > 0 {
			db.Where("board_id IN ?", ownedBoardIDs).Order("created_at DESC").Limit(50).Find(&requests)
			db.Model(&AccessRequest{}).Where("board_id IN ? AND status = 'pending'", ownedBoardIDs).Count(&unreadCount)
		}
		if requests == nil {
			requests = []AccessRequest{}
		}

		var assignments []AssignmentNotice
		db.Where("recipient_id = ?", userID).Order("id DESC").Limit(20).Find(&assignments)
		if assignments == nil {
			assignments = []AssignmentNotice{}
		}
		var unseen int64
		db.Model(&AssignmentNotice{}).Where("recipient_id = ? AND seen = ?", userID, false).Count(&unseen)

		c.JSON(200, gin.H{
			"notifications": requests,
			"assignments":   assignments,
			"unreadCount":   unreadCount + unseen,
		})
	})

	r.POST("/api/assignments/:id/seen", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		result := db.Model(&AssignmentNotice{}).Where("id = ? AND recipient_id = ?", c.Param("id"), userID).Update("seen", true)
		if result.Error != nil {
			c.JSON(500, gin.H{"error": "Could not update the notice"})
			return
		}
		if result.RowsAffected == 0 {
			c.JSON(404, gin.H{"error": "Notice not found"})
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})

	// Respond to Access Request (Approve / Dismiss)
	r.POST("/api/notifications/:id/respond", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		reqID := c.Param("id")

		var payload struct {
			Action string `json:"action"` // "approve" or "dismiss"
		}
		if err := c.BindJSON(&payload); err != nil {
			c.JSON(400, gin.H{"error": "Invalid payload"})
			return
		}

		var accessReq AccessRequest
		if err := db.First(&accessReq, reqID).Error; err != nil {
			c.JSON(404, gin.H{"error": "Access request not found"})
			return
		}

		var b Board
		if err := db.Where("id = ? AND owner_id = ?", accessReq.BoardID, userID).First(&b).Error; err != nil {
			c.JSON(403, gin.H{"error": "Only the board owner can respond to access requests"})
			return
		}

		if payload.Action == "approve" {
			accessReq.Status = "approved"
			db.Save(&accessReq)

			// Add/Update BoardMember with "edit" role
			res := db.Model(&BoardMember{}).Where("board_id = ? AND user_id = ?", accessReq.BoardID, accessReq.UserID).Updates(map[string]interface{}{
				"role":      "edit",
				"last_seen": time.Now(),
			})
			if res.RowsAffected == 0 {
				db.Create(&BoardMember{
					BoardID:  accessReq.BoardID,
					UserID:   accessReq.UserID,
					Role:     "edit",
					LastSeen: time.Now(),
				})
			}

			// Broadcast live approval
			wsMsg, _ := json.Marshal(gin.H{
				"type":    "ACCESS_GRANTED",
				"boardId": accessReq.BoardID,
				"userId":  accessReq.UserID,
				"role":    "edit",
			})
			hub.publish <- wsMsg
		} else {
			accessReq.Status = "dismissed"
			db.Save(&accessReq)
		}

		c.JSON(200, accessReq)
	})

	// Get Board Members for Manage Access View
	r.GET("/api/boards/:id/members", authMiddleware, func(c *gin.Context) {
		boardID := c.Param("id")

		var b Board
		if err := db.Where("id = ?", boardID).First(&b).Error; err != nil {
			c.JSON(404, gin.H{"error": "Board not found"})
			return
		}

		type MemberItem struct {
			ID         uint   `json:"id"`
			Name       string `json:"name"`
			Email      string `json:"email"`
			AvatarURL  string `json:"avatarUrl"`
			Role       string `json:"role"` // "owner", "edit", "view"
			IsOwner    bool   `json:"isOwner"`
			Assignable bool   `json:"assignable"`
		}

		assignable := map[uint]bool{b.OwnerID: true}

		// Collect all relevant user IDs for this board
		userIDsSet := make(map[uint]bool)
		userIDsSet[b.OwnerID] = true

		var bmUserIDs []uint
		db.Model(&BoardMember{}).Where("board_id = ?", boardID).Pluck("user_id", &bmUserIDs)
		for _, uID := range bmUserIDs {
			userIDsSet[uID] = true
			assignable[uID] = true
		}

		var reqUserIDs []uint
		db.Model(&AccessRequest{}).Where("board_id = ? AND status != 'dismissed'", boardID).Pluck("user_id", &reqUserIDs)
		for _, uID := range reqUserIDs {
			userIDsSet[uID] = true
		}

		var userIDs []uint
		for uID := range userIDsSet {
			userIDs = append(userIDs, uID)
		}

		var users []User
		if len(userIDs) > 0 {
			db.Where("id IN ?", userIDs).Find(&users)
		}

		var members []MemberItem
		for _, u := range users {
			role := resolveBoardRole(db, boardID, b.OwnerID, u.ID)
			if role == "" {
				role = "view"
			}
			members = append(members, MemberItem{
				ID:         u.ID,
				Name:       u.Name,
				Email:      u.Email,
				AvatarURL:  u.AvatarURL,
				Role:       role,
				IsOwner:    (u.ID == b.OwnerID),
				Assignable: assignable[u.ID],
			})
		}

		c.JSON(200, members)
	})

	// Update Board Member Role
	r.POST("/api/boards/:id/members/:userId", authMiddleware, func(c *gin.Context) {
		userID := c.MustGet("userID").(uint)
		boardID := c.Param("id")
		targetUserIDStr := c.Param("userId")

		var targetUserID uint
		if _, err := fmt.Sscanf(targetUserIDStr, "%d", &targetUserID); err != nil || targetUserID == 0 {
			c.JSON(400, gin.H{"error": "Invalid userId"})
			return
		}

		var b Board
		if err := db.Where("id = ? AND owner_id = ?", boardID, userID).First(&b).Error; err != nil {
			c.JSON(403, gin.H{"error": "Only board owner can update member roles"})
			return
		}

		// IDOR guard: the owner must only be able to change the role of someone
		// who is actually associated with this board (an existing BoardMember or
		// an AccessRequest). Previously any user ID was accepted and a brand-new
		// BoardMember record was silently created, letting an owner grant edit
		// access on their board to arbitrary users who never visited it.
		var member BoardMember
		hasMember := db.Where("board_id = ? AND user_id = ?", boardID, targetUserID).First(&member).Error == nil
		var accessReq AccessRequest
		hasAccessReq := db.Where("board_id = ? AND user_id = ?", boardID, targetUserID).First(&accessReq).Error == nil
		if !hasMember && !hasAccessReq {
			c.JSON(404, gin.H{"error": "Target user is not a member of this board"})
			return
		}

		var payload struct {
			Role string `json:"role"` // "edit" or "view"
		}
		if err := c.BindJSON(&payload); err != nil {
			c.JSON(400, gin.H{"error": "Invalid payload"})
			return
		}

		newRole := "view"
		if payload.Role == "edit" || payload.Role == "Editor" {
			newRole = "edit"
		}

		// Upsert the BoardMember role. The IDOR guard above already loaded
		// `member` when one exists; reuse it instead of querying again.
		if hasMember {
			// Never downgrade the board owner.
			if member.Role == "owner" {
				c.JSON(400, gin.H{"error": "Cannot change the board owner's role"})
				return
			}
			db.Model(&member).Updates(map[string]interface{}{
				"role":      newRole,
				"last_seen": time.Now(),
			})
		} else {
			db.Create(&BoardMember{
				BoardID:  boardID,
				UserID:   targetUserID,
				Role:     newRole,
				LastSeen: time.Now(),
			})
		}

		// Also update any AccessRequest
		// *** เพิ่ม/เช็คจุดนี้: อัปเดตตาราง AccessRequest ให้สอดคล้องกันเสมอ ***
		if newRole == "edit" {
			db.Model(&AccessRequest{}).
				Where("board_id = ? AND user_id = ?", boardID, targetUserID).
				Update("status", "approved") // ต้องเปลี่ยนเป็น approved เพื่อไม่ให้หลุดไปเป็น view ตอน GET
		} else {
			db.Model(&AccessRequest{}).
				Where("board_id = ? AND user_id = ?", boardID, targetUserID).
				Update("status", "dismissed")
		}

		// Broadcast real-time permission update
		wsMsg, _ := json.Marshal(gin.H{
			"type":    "ACCESS_GRANTED",
			"boardId": boardID,
			"userId":  targetUserID,
			"role":    newRole,
		})
		hub.publish <- wsMsg

		c.JSON(200, gin.H{"message": "Role updated successfully", "role": newRole})
	})

	// WebSocket endpoint
	r.GET("/ws", func(c *gin.Context) {
		serveWs(hub, db, c.Writer, c.Request)
	})

	// --- HTTP server with graceful shutdown ---
	srv := &http.Server{
		Addr:              ":8080",
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Println("Server running on http://localhost:8080")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Println("Server forced to shutdown:", err)
	}
	log.Println("Server exiting")
}
