const mongoose = require("mongoose");

const teamMemberSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    role: { type: String, required: true },
    image: { type: String, required: true },
    isTopMember: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TeamMember", teamMemberSchema);