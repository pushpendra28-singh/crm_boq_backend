const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadTeamImage");

const {
  getTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
} = require("../controllers/teamController");

router.get("/team-members", getTeamMembers);

router.post("/team-members", upload.single("image"), createTeamMember);

router.patch("/team-members/:id", upload.single("image"), updateTeamMember);

router.delete("/team-members/:id", deleteTeamMember);

module.exports = router;