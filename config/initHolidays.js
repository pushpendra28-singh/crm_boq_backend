const Holiday = require("../models/Holiday");
const WeeklyOffPolicy = require("../models/WeeklyOffPolicy");

module.exports = async function initHolidays() {
  await Holiday.createIndexes();
  await WeeklyOffPolicy.createIndexes();
};