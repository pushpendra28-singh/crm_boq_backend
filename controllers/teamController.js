const TeamMember = require("../models/TeamMember");

const buildImagePath = (req) => {
  if (req.file) return `/uploads/team/${req.file.filename}`;
  return "";
};

// GET
exports.getTeamMembers = async (req, res) => {
  try {
    const members = await TeamMember.find().sort({ createdAt: -1 });
    res.json(members);
  } catch {
    res.status(500).json({ message: "Failed to fetch team members" });
  }
};

// POST
exports.createTeamMember = async (req, res) => {
  try {
    const member = new TeamMember({
      name: req.body.name,
      role: req.body.role,
      isTopMember: req.body.isTopMember === "true",
      image: buildImagePath(req),
    });

    await member.save();

    res.status(201).json({ message: "Member added", member });
  } catch {
    res.status(500).json({ message: "Failed to create member" });
  }
};

// UPDATE
exports.updateTeamMember = async (req, res) => {
  try {
    const existing = await TeamMember.findById(req.params.id);

    if (!existing) {
      return res.status(404).json({ message: "Member not found" });
    }

    existing.name = req.body.name || existing.name;
    existing.role = req.body.role || existing.role;
    existing.isTopMember =
      req.body.isTopMember === "true" ? true : existing.isTopMember;

    if (req.file) {
      existing.image = `/uploads/team/${req.file.filename}`;
    }

    await existing.save();

    res.json({ message: "Member updated", member: existing });
  } catch {
    res.status(500).json({ message: "Update failed" });
  }
};

// DELETE
exports.deleteTeamMember = async (req, res) => {
  try {
    await TeamMember.findByIdAndDelete(req.params.id);
    res.json({ message: "Member deleted" });
  } catch {
    res.status(500).json({ message: "Delete failed" });
  }
};