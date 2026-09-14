const express = require("express");

const router = express.Router();

const {
  protect,
  requirePermission,
} = require("../middleware/authMiddleware");

const {
  attachOwner,
} = require("../middleware/ownershipMiddleware");

const {
  requireCompleteBusinessProfile,
} = require("../middleware/requireCompleteBusinessProfile");


const {
  createInvoice,
  getInvoices,
  getInvoiceById,
  updateInvoice,
  deleteInvoice,
  sendInvoiceByEmail,
} = require("../controllers/invoiceController");



/* Generate and save invoice */
router.post("/", protect, attachOwner, requirePermission("view_invoices"), requireCompleteBusinessProfile, createInvoice);

router.get("/", protect, attachOwner, requirePermission("view_invoices"), getInvoices);
router.get("/:id", protect, attachOwner, requirePermission("view_invoices"), getInvoiceById);

router.put("/:id", protect, attachOwner, requirePermission("view_invoices"), updateInvoice);
router.delete("/:id", protect, attachOwner, requirePermission("view_invoices"), deleteInvoice);
router.post("/:id/send", protect, attachOwner, requirePermission("view_invoices"),sendInvoiceByEmail);

module.exports = router;