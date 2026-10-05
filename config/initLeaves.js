const Settings = require('../models/LeaveSettings');
const Account = require('../models/LeaveAccount');
module.exports = async function initLeaves() {
  await Settings.createIndexes();
  await Account.createIndexes();
  try { await Settings.updateOne({ key: 'company' }, { $setOnInsert: { key: 'company', types: [], reviewers: [], allowPast: false, audit: [] } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
};
