const express = require("express");
const router = express.Router();
const { getRoles, createRole, updateRole, deleteRole } = require("../controllers/rolesController");
const { protect, requirePermission } = require("../middleware/authMiddleware");

router.get("/", protect, requirePermission("view_roles"), getRoles);
router.post("/", protect, requirePermission("create_roles"), createRole);
router.put("/:id", protect, requirePermission("edit_roles"), updateRole);
router.delete("/:id", protect, requirePermission("delete_roles"), deleteRole);

module.exports = router;