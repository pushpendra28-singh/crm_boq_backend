const mongoose = require("mongoose");
const { Schema } = mongoose;
const finite = { validator: Number.isFinite, message: "Value must be finite." };
const locationSchema = new Schema({
  latitude: { type: Number, required: true, min: -90, max: 90, validate: finite },
  longitude: { type: Number, required: true, min: -180, max: 180, validate: finite },
  accuracy: { type: Number, required: true, min: Number.EPSILON, validate: finite },
  distanceMeters: { type: Number, required: true, min: 0, validate: finite },
}, { _id: false });
const eventSchema = new Schema({
  at: { type: Date, required: true },
  originalAt: { type: Date, default: null, immutable: true },
  location: { type: locationSchema, default: null },
}, { _id: false });
const auditSchema = new Schema({
  editedBy: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
  editedAt: { type: Date, required: true, default: Date.now },
  field: { type: String, enum: ["checkIn.at", "checkOut.at"], required: true },
  previousValue: { type: Date, required: true },
  newValue: { type: Date, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
}, { _id: false });
const schema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: "Admin", required: true, immutable: true },
  officeId: { type: Schema.Types.ObjectId, ref: "AttendanceOffice", required: true, immutable: true },
  attendanceDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  // Preserve the policy used on this day, even if office settings change later.
  shiftSnapshot: {
    timezone: { type: String, required: true, enum: ["Asia/Kolkata"] },
    scheduledCheckIn: { type: Date, required: true },
    scheduledCheckOut: { type: Date, required: true },
    graceEndsAt: { type: Date, required: true },
    latitude: { type: Number, required: true, min: -90, max: 90, validate: finite },
    longitude: { type: Number, required: true, min: -180, max: 180, validate: finite },
    radiusMeters: { type: Number, required: true, min: 1, validate: finite },
    maxAccuracyMeters: { type: Number, required: true, min: 1, validate: finite },
  },
  checkIn: { type: eventSchema, required: true },
  checkOut: { type: eventSchema, default: null },
  arrivalStatus: { type: String, required: true, enum: ["on_time", "late"] },
  attendanceStatus: { type: String, enum: ["present","half_day", "absent"], default: "present" },
  workMode: {
    type: String,
    enum: ["office", "wfh"],
    default: "office",
  },
  wfhType: {
    type: String,
    enum: ["full_day", "half_day", null],
    default: null,
  },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  corrections: [{
    action: { type: String, enum: ["edit", "delete"], required: true },
    actor: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
    at: { type: Date, default: Date.now },
    reason: { type: String, required: true, maxlength: 1000 },
    before: { type: Schema.Types.Mixed, required: true },
    after: { type: Schema.Types.Mixed, required: true },
  }],
  auditHistory: { type: [auditSchema], default: [] },
}, { timestamps: true, optimisticConcurrency: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });
schema.index({ employeeId: 1, attendanceDate: 1 }, { unique: true });
schema.index({ attendanceDate: -1, _id: -1 });
schema.virtual("workingMinutes").get(function () {
  return this.attendanceStatus === "absent" ? 0 : this.checkOut ? Math.max(0, Math.floor((this.checkOut.at - this.checkIn.at) / 60000)) : null;
});
schema.virtual("completionStatus").get(function () {
  return this.attendanceStatus === "absent" ? "absent" : this.checkOut ? "completed" : "incomplete";
});
schema.pre("validate", function () {
  if (this.checkOut && this.checkIn && this.checkOut.at < this.checkIn.at) {
    this.invalidate("checkOut.at", "Check-out cannot be before check-in.");
  }
});
module.exports = mongoose.model("Attendance", schema);




// const mongoose = require("mongoose");
// const { Schema } = mongoose;
// const finite = { validator: Number.isFinite, message: "Value must be finite." };
// const locationSchema = new Schema({
//   latitude: { type: Number, required: true, min: -90, max: 90, validate: finite },
//   longitude: { type: Number, required: true, min: -180, max: 180, validate: finite },
//   accuracy: { type: Number, required: true, min: Number.EPSILON, validate: finite },
//   distanceMeters: { type: Number, required: true, min: 0, validate: finite },
// }, { _id: false });
// const eventSchema = new Schema({
//   at: { type: Date, required: true },
//   originalAt: { type: Date, default: null, immutable: true },
//   location: { type: locationSchema, default: null },
// }, { _id: false });
// const auditSchema = new Schema({
//   editedBy: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
//   editedAt: { type: Date, required: true, default: Date.now },
//   field: { type: String, enum: ["checkIn.at", "checkOut.at"], required: true },
//   previousValue: { type: Date, required: true },
//   newValue: { type: Date, required: true },
//   reason: { type: String, required: true, trim: true, maxlength: 1000 },
// }, { _id: false });
// const schema = new Schema({
//   employeeId: { type: Schema.Types.ObjectId, ref: "Admin", required: true, immutable: true },
//   officeId: { type: Schema.Types.ObjectId, ref: "AttendanceOffice", required: true, immutable: true },
//   attendanceDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
//   // Preserve the policy used on this day, even if office settings change later.
//   shiftSnapshot: {
//     timezone: { type: String, required: true, enum: ["Asia/Kolkata"] },
//     scheduledCheckIn: { type: Date, required: true },
//     scheduledCheckOut: { type: Date, required: true },
//     graceEndsAt: { type: Date, required: true },
//     latitude: { type: Number, required: true, min: -90, max: 90, validate: finite },
//     longitude: { type: Number, required: true, min: -180, max: 180, validate: finite },
//     radiusMeters: { type: Number, required: true, min: 1, validate: finite },
//     maxAccuracyMeters: { type: Number, required: true, min: 1, validate: finite },
//   },
//   checkIn: { type: eventSchema, required: true },
//   checkOut: { type: eventSchema, default: null },
//   arrivalStatus: { type: String, required: true, enum: ["on_time", "late"] },
//   attendanceStatus: { type: String, enum: ["present", "absent"], default: "present" },
//   deletedAt: { type: Date, default: null },
//   deletedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
//   corrections: [{
//     action: { type: String, enum: ["edit", "delete"], required: true },
//     actor: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
//     at: { type: Date, default: Date.now },
//     reason: { type: String, required: true, maxlength: 1000 },
//     before: { type: Schema.Types.Mixed, required: true },
//     after: { type: Schema.Types.Mixed, required: true },
//   }],
//   auditHistory: { type: [auditSchema], default: [] },
// }, { timestamps: true, optimisticConcurrency: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });
// schema.index({ employeeId: 1, attendanceDate: 1 }, { unique: true });
// schema.index({ attendanceDate: -1, _id: -1 });
// schema.virtual("workingMinutes").get(function () {
//   return this.attendanceStatus === "absent" ? 0 : this.checkOut ? Math.max(0, Math.floor((this.checkOut.at - this.checkIn.at) / 60000)) : null;
// });
// schema.virtual("completionStatus").get(function () {
//   return this.attendanceStatus === "absent" ? "absent" : this.checkOut ? "completed" : "incomplete";
// });
// schema.pre("validate", function () {
//   if (this.checkOut && this.checkIn && this.checkOut.at < this.checkIn.at) {
//     this.invalidate("checkOut.at", "Check-out cannot be before check-in.");
//   }
// });
// module.exports = mongoose.model("Attendance", schema);
