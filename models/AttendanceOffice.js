const mongoose = require("mongoose");
const timePattern = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const finite = { validator: Number.isFinite, message: "Value must be finite." };
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  latitude: { type: Number, required: true, min: -90, max: 90, validate: finite },
  longitude: { type: Number, required: true, min: -180, max: 180, validate: finite },
  radiusMeters: { type: Number, required: true, min: 1, validate: finite },
  timezone: { type: String, required: true, enum: ["Asia/Kolkata"] },
  checkInTime: { type: String, required: true, match: timePattern },
  checkOutTime: { type: String, required: true, match: timePattern },
  graceMinutes: { type: Number, required: true, min: 0, max: 120, validate: Number.isInteger },
  maxAccuracyMeters: { type: Number, required: true, min: 1, validate: finite },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
schema.pre("validate", function () {
  if (this.checkOutTime <= this.checkInTime) {
    this.invalidate("checkOutTime", "Check-out must be after check-in for this same-day shift.");
  }
});
module.exports = mongoose.model("AttendanceOffice", schema);
