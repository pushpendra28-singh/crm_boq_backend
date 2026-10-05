const express = require("express");

const {
  protect,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/authMiddleware");

const {
  getPolicies,
  createPolicy,
  getPreview,
} = require("../controllers/weeklyOffController");

const router = express.Router();

router.use(protect);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get(
  "/",
  requireAnyPermission("view_holidays", "manage_weekly_offs"),
  getPolicies
);

router.get(
  "/preview",
  requireAnyPermission("view_holidays", "manage_weekly_offs"),
  getPreview
);

router.post(
  "/",
  requirePermission("manage_weekly_offs"),
  createPolicy
);

module.exports = router;