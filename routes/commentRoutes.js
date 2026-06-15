const express = require("express");
const {
  createComment,
  getComments,
  getCommentCount,
  updateCommentStatus,
  deleteComment,
  bulkDeleteComments,
} = require("../controllers/commentController");

const router = express.Router();

router.post("/", createComment);
router.get("/", getComments);
router.get("/count", getCommentCount);
router.put("/:id/status", updateCommentStatus);
router.delete("/:id", deleteComment);
router.delete("/", bulkDeleteComments);

module.exports = router;