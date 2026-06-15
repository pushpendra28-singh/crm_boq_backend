/**
 * proposalChatRoutes.js
 * REST API routes for the AI Interview + Document Proposal system.
 *
 * Mount in your Express app as:
 *   app.use("/proposal-chat", authMiddleware, proposalChatRoutes);
 *
 * All routes require authentication (reuse your existing auth middleware).
 */

const express = require("express");
const router = express.Router();

const controller = require("../controllers/proposalChatController");
const { handleSingleUpload } = require("../middleware/uploadMiddleware");


// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /proposal-chat/start
 * Start a new AI interview or document chat session.
 * Body: { mode: "interview" | "document" }
 */
router.post("/start", controller.startConversation);

/**
 * GET /proposal-chat/list
 * List all conversation sessions for the current user.
 * Query: ?page=1&limit=10
 *
 * NOTE: This route must be declared BEFORE /:id to avoid "list" being treated as an ID.
 */
router.get("/list", controller.listConversations);

/**
 * GET /proposal-chat/:id
 * Fetch a single conversation with full message history.
 */
router.get("/:id", controller.getConversation);

/**
 * POST /proposal-chat/message/:id
 * Send a user message and receive AI reply.
 * Body: { message: "string" }
 */
router.post("/message/:id", controller.sendMessage);

/**
 * POST /proposal-chat/upload/:id
 * Upload a document (PDF/DOC/DOCX/TXT) to an active conversation.
 * Multipart form-data: field name "document"
 */
router.post(
  "/upload/:id",
  handleSingleUpload("document"),
  controller.uploadDocument
);

/**
 * POST /proposal-chat/complete/:id
 * Finalize conversation and generate proposal using existing pipeline.
 * Returns: { proposalId }
 */
router.post("/complete/:id", controller.completeConversation);

module.exports = router;