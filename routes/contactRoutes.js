const express = require("express");
const router = express.Router();

const {
  createContactLead,
  getContactLeads,
  updateContactStatus,
  deleteContactLead
} = require("../controllers/contactController");

router.post("/contact-leads",createContactLead);
router.get("/contact-leads",getContactLeads);
router.patch("/contact-leads/:id/status",updateContactStatus);
router.delete("/contact-leads/:id",deleteContactLead);

module.exports = router;