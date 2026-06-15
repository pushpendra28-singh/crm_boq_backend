// ─── routes/authRoutes.js ─────────────────────────────────────────────────────
const express = require("express");
const router = express.Router();
const {
  loginAdmin,
  getProfile,
  getAdmins,
  createUser,
  updateUser,
  deleteUser,
  getPermissions,
} = require("../controllers/authController");
const { protect, requirePermission, requireRole } = require("../middleware/authMiddleware");

// Public
router.post("/login", loginAdmin);

// Protected
router.get("/profile", protect, getProfile);
router.get("/permissions", protect, requireRole("superadmin", "admin"), getPermissions);

// User management (requires manage_users permissions)
router.get("/users", protect, requirePermission("view_users"), getAdmins);
router.post("/users", protect, requirePermission("create_users"), createUser);
router.put("/users/:id", protect, requirePermission("edit_users"), updateUser);
router.delete("/users/:id", protect, requirePermission("delete_users"), deleteUser);

module.exports = router;


// ─── routes/rolesRoutes.js ────────────────────────────────────────────────────
// Separate file — copy this to routes/rolesRoutes.js
/*
const express = require("express");
const router = express.Router();
const { getRoles, createRole, updateRole, deleteRole } = require("../controllers/rolesController");
const { protect, requirePermission } = require("../middleware/authMiddleware");

router.get("/", protect, requirePermission("view_roles"), getRoles);
router.post("/", protect, requirePermission("create_roles"), createRole);
router.put("/:id", protect, requirePermission("edit_roles"), updateRole);
router.delete("/:id", protect, requirePermission("delete_roles"), deleteRole);

module.exports = router;
*/



// const express = require("express");
// const { loginAdmin, getAdmins } = require("../controllers/authController");

// const router = express.Router();
// console.log(' authRoutes:', router);
// router.post("/register", (req, res) => {
//   res.send("Register route");
// });
// router.post("/login", loginAdmin);
// router.get("/admins", getAdmins);

// module.exports = router;