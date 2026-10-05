class AttendanceError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = "AttendanceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}
function distanceMeters(lat1, lon1, lat2, lon2) {
  if (!validCoordinates(lat1, lon1) || !validCoordinates(lat2, lon2)) {
    throw new AttendanceError("INVALID_COORDINATES", "Valid numeric latitude and longitude are required.");
  }
  const radians = (value) => value * Math.PI / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
function verifyLocation(location, office) {
  if (!office || !office.isActive) {
    throw new AttendanceError("OFFICE_UNAVAILABLE", "Attendance office is currently unavailable.", 503);
  }
  if (!validCoordinates(office.latitude, office.longitude) ||
      !Number.isFinite(office.radiusMeters) || office.radiusMeters <= 0 ||
      !Number.isFinite(office.maxAccuracyMeters) || office.maxAccuracyMeters <= 0) {
    throw new AttendanceError("OFFICE_CONFIG_INVALID", "Office location settings need administrator attention.", 503);
  }
  if (!location || !validCoordinates(location.latitude, location.longitude) ||
      !Number.isFinite(location.accuracy) || location.accuracy <= 0) {
    throw new AttendanceError("INVALID_LOCATION", "Valid numeric coordinates and positive GPS accuracy are required.");
  }
  if (location.accuracy > office.maxAccuracyMeters) {
    throw new AttendanceError("LOW_LOCATION_ACCURACY", "GPS accuracy is too low. Move near a window or outside and try again.");
  }
  const distance = distanceMeters(office.latitude, office.longitude, location.latitude, location.longitude);
  // Compare the unrounded distance; round only for display/storage.
  if (distance > office.radiusMeters) {
    throw new AttendanceError("OUTSIDE_OFFICE_RADIUS",
      `You are ${Math.ceil(distance)} meters away from the office. Attendance is allowed within ${office.radiusMeters} meters only.`,
      403, { distanceMeters: Math.ceil(distance), radiusMeters: office.radiusMeters });
  }
  return { latitude: location.latitude, longitude: location.longitude,
    accuracy: location.accuracy, distanceMeters: Math.round(distance * 100) / 100 };
}

function verifyWfhLocation(location, maxAccuracyMeters) {
  if (!location || !validCoordinates(location.latitude, location.longitude) ||
      !Number.isFinite(location.accuracy) || location.accuracy <= 0) {
    throw new AttendanceError("INVALID_LOCATION", "Valid numeric coordinates and positive GPS accuracy are required.");
  }

  if (!Number.isFinite(maxAccuracyMeters) || maxAccuracyMeters <= 0) {
    throw new AttendanceError("WFH_CONFIG_INVALID", "WFH location settings need administrator attention.", 503);
  }

  if (location.accuracy > maxAccuracyMeters) {
    throw new AttendanceError("LOW_LOCATION_ACCURACY", "GPS accuracy is too low. Move near a window or outside and try again.");
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    distanceMeters: 0,
  };
}

function getShiftContext(now, office) {
  // Call with a server-created Date, never a request-body timestamp.
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new AttendanceError("INVALID_SERVER_TIME", "Unable to determine attendance time.", 500);
  }
  if (office.timezone !== "Asia/Kolkata") {
    throw new AttendanceError("INVALID_TIMEZONE", "Unsupported office timezone.", 503);
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: office.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const attendanceDate = `${parts.year}-${parts.month}-${parts.day}`;
  const scheduledCheckIn = new Date(`${attendanceDate}T${office.checkInTime}+05:30`);
  const scheduledCheckOut = new Date(`${attendanceDate}T${office.checkOutTime}+05:30`);
  const graceEndsAt = new Date(scheduledCheckIn.getTime() + office.graceMinutes * 60000);
  if (![scheduledCheckIn, scheduledCheckOut, graceEndsAt].every(d => Number.isFinite(d.getTime())) ||
      scheduledCheckOut <= scheduledCheckIn || !Number.isInteger(office.graceMinutes) || office.graceMinutes < 0) {
    throw new AttendanceError("INVALID_SHIFT", "Office shift settings need administrator attention.", 503);
  }
  return { attendanceDate, scheduledCheckIn, scheduledCheckOut, graceEndsAt,
    arrivalStatus: now > graceEndsAt ? "late" : "on_time" };
}
module.exports = { AttendanceError, distanceMeters, verifyLocation, verifyWfhLocation, getShiftContext };
