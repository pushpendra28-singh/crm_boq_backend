const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true,
    unique: true,
    index: true,
  },
  enabled: {
    type: Boolean,
    default: false,
  },
  dayType: {
    type: String,
    enum: ["full_day", "half_day"],
    default: "full_day",
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model("WorkFromHomeSetting", schema);
