const express = require("express");
const router = express.Router();
const {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  toggleUserStatus,
} = require("../controllers/usersController");
const { protect, requirePermission } = require("../middleware/authMiddleware");

// GET    /api/users          — list all users
router.get("/users", protect, requirePermission("view_users"), getUsers);

// POST   /api/users          — create a new user
router.post("/users", protect, requirePermission("create_users"), createUser);

// PUT    /api/users/:id      — update a user
router.put("/users/:id", protect, requirePermission("edit_users"), updateUser);

// DELETE /api/users/:id      — delete a user
router.delete("/users/:id", protect, requirePermission("delete_users"), deleteUser);

// PATCH  /api/users/:id/toggle-status — activate / deactivate
router.patch("/users/:id/toggle-status", protect, requirePermission("edit_users"), toggleUserStatus);

module.exports = router;    