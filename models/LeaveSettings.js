const mongoose = require('mongoose');
const typeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  paid: { type: Boolean, required: true },
  halfDay: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
});
const schema = new mongoose.Schema({
  key: { type: String, default: 'company', unique: true },
  types: { type: [typeSchema], default: [] },
  reviewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }],
  allowPast: { type: Boolean, default: false },
  audit: [{ actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }, at: Date, reason: String, before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed }],
}, { timestamps: true, optimisticConcurrency: true });
module.exports = mongoose.model('LeaveSettings', schema);
