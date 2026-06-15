const mongoose = require("mongoose");

const newsletterSchema = new mongoose.Schema(
  {
    name: String,
    email: String,
     status: {
    type: String,
    enum: ["Pending", "Connected", "Rejected"],
    default: "Pending"
  }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Newsletter", newsletterSchema);