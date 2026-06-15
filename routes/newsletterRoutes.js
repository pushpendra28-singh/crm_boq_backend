const express = require("express");
const router = express.Router();

const {
  getNewsletters,
  createNewsletter,
  deleteNewsletter,
    updateNewsletterStatus,
} = require("../controllers/newsletterController");

router.get("/newsletters", getNewsletters);
router.post("/newsletters", createNewsletter);
router.delete("/newsletters/:id", deleteNewsletter);
router.patch("/newsletters/:id/status", updateNewsletterStatus);

module.exports = router;