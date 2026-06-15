const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    comment: {
      type: String,
      required: true,
      trim: true,
      minlength: 15,
      maxlength: 1000,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    acceptedPolicy: {
      type: Boolean,
      required: true,
      default: false,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Spam"],
      default: "Pending",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Comment", commentSchema);