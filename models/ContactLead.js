const mongoose = require("mongoose");

const contactLeadSchema = new mongoose.Schema(
{
  fullName: {
    type: String,
    required: true
  },

  companyName: String,

  phone: {
    type: String,
    required: true
  },

  email: String,

  subject: String,

  message: String,

  status: {
    type: String,
    enum: ["Pending", "Replied", "Closed"],
    default: "Pending"
  }

},
{ timestamps: true }
);

module.exports = mongoose.model("ContactLead", contactLeadSchema);