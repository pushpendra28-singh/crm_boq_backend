const mongoose = require('mongoose');
const { Schema } = mongoose;
const event = new Schema({ actor: { type: Schema.Types.ObjectId, ref: 'Admin' }, at: Date, status: String, note: String }, { _id: false });
const request = new Schema({
  key: String,
  typeId: Schema.Types.ObjectId,
  typeName: String,
  paid: Boolean,
  from: String,
  to: String,
  portion: { type: String, enum: ['full', 'first_half', 'second_half'] },
  days: [{ date: String, units: Number, _id: false }],
  units: Number,
  reason: String,
  status: { type: String, enum: ['pending', 'under_review', 'approved', 'rejected', 'cancel_requested', 'cancelled'], default: 'pending' },
  version: { type: Number, default: 0 },
  reviewers: [{ type: Schema.Types.ObjectId, ref: 'Admin' }],
  history: [event],
  createdAt: Date,
});
const mail = new Schema({
  requestId: Schema.Types.ObjectId,
  recipient: { type: Schema.Types.ObjectId, ref: 'Admin' },
  subject: String, text: String,
  status: { type: String, enum: ['queued', 'sending', 'sent', 'failed'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  nextAt: { type: Date, default: Date.now },
  leaseUntil: Date, claim: String, sentAt: Date,
  error: String,
});
const schema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
  year: { type: Number, required: true, min: 2000, max: 2099 },
  allocations: [{ typeId: Schema.Types.ObjectId, units: Number, _id: false }],
  adjustments: [{ typeId: Schema.Types.ObjectId, before: Number, after: Number, reason: String, actor: { type: Schema.Types.ObjectId, ref: 'Admin' }, at: Date }],
  requests: [request],
  mail: [mail],
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ employee: 1, year: 1 }, { unique: true });
schema.index({ year: 1, 'requests.reviewers': 1 });
schema.index({ 'mail.status': 1, 'mail.nextAt': 1 });
module.exports = mongoose.model('LeaveAccount', schema);
