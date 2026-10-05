// Server-owned defaults. Phase 2 will insert these once using $setOnInsert.
module.exports = Object.freeze({
  key: "main-office",
  name: "Main Office",
  latitude: 28.590749,
  longitude: 77.449526,
  radiusMeters: 300,
  timezone: "Asia/Kolkata",
  checkInTime: "10:00:00",
  checkOutTime: "18:30:00",
  graceMinutes: 10,
  maxAccuracyMeters: 100,
  isActive: true,
});
