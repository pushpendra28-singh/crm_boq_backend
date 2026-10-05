const express = require("express");
const { protect, requirePermission } = require("../middleware/authMiddleware");
const controller = require("../controllers/payrollController");

const router = express.Router();

router.use(protect);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/employees", requirePermission("view_payroll"), controller.employees);

router.get("/salaries/:employeeId", requirePermission("view_payroll"), controller.salaryList);
router.post("/salaries", requirePermission("manage_payroll"), controller.salaryCreate);
router.put("/salaries/:salaryId", requirePermission("manage_payroll"), controller.salaryUpdate);

router.get("/runs", requirePermission("view_payroll"), controller.runs);
router.post("/runs", requirePermission("manage_payroll"), controller.generate);
router.get("/runs/:runId", requirePermission("view_payroll"), controller.detail);
router.get("/runs/:runId/records/:recordId/salary-slip", requirePermission("view_payroll"),controller.salarySlip);
router.post("/runs/:runId/recalculate", requirePermission("manage_payroll"), controller.recalculate);
router.post("/runs/:runId/review", requirePermission("manage_payroll"), controller.review);
router.post("/runs/:runId/finalize", requirePermission("finalize_payroll"), controller.finalize);
router.post("/runs/:runId/records/:recordId/payment", requirePermission("manage_payroll"), controller.recordPayment);
router.post("/runs/:runId/paid", requirePermission("finalize_payroll"), controller.markPaid);

module.exports = router;
