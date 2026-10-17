const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Attendance = require('../models/Attendance');
const attendanceRoutes = require('../routes/attendanceRoutes');

const adminId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const recordId = 'cccccccccccccccccccccccc';
const employeeId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const priorDate = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
const attendanceRecords = new Map();
let server;
let port;
const originalJwtSecret = process.env.JWT_SECRET;
const originals = {
  adminFindById: Admin.findById,
  attendanceFindOne: Attendance.findOne,
  attendanceFindOneAndUpdate: Attendance.findOneAndUpdate,
};

function authToken() {
  return jwt.sign({ id: adminId }, process.env.JWT_SECRET);
}

async function patchAttendance(body) {
  return fetch(`http://127.0.0.1:${port}/api/attendance/${recordId}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${authToken()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function manualRecord() {
  return {
    _id: recordId,
    employeeId,
    attendanceDate: priorDate,
    attendanceStatus: 'present',
    manualMark: {
      actor: adminId,
      at: new Date(`${priorDate}T12:00:00Z`),
      action: 'mark_present',
    },
    checkIn: undefined,
    checkOut: null,
    shiftSnapshot: undefined,
    arrivalStatus: undefined,
    __v: 1,
  };
}

function punchedRecord() {
  const checkInAt = new Date(`${priorDate}T10:05:00+05:30`);
  const checkOutAt = new Date(`${priorDate}T18:30:00+05:30`);
  const checkInLocation = {
    latitude: 28.59,
    longitude: 77.44,
    accuracy: 20,
    distanceMeters: 15,
  };
  const checkOutLocation = {
    latitude: 28.591,
    longitude: 77.441,
    accuracy: 18,
    distanceMeters: 22,
  };
  return {
    _id: recordId,
    employeeId,
    attendanceDate: priorDate,
    attendanceStatus: 'present',
    checkIn: { at: checkInAt, originalAt: checkInAt, location: checkInLocation },
    checkOut: { at: checkOutAt, originalAt: checkOutAt, location: checkOutLocation },
    shiftSnapshot: {
      timezone: 'Asia/Kolkata',
      scheduledCheckIn: new Date(`${priorDate}T10:00:00+05:30`),
      scheduledCheckOut: new Date(`${priorDate}T18:30:00+05:30`),
      graceEndsAt: new Date(`${priorDate}T10:10:00+05:30`),
      latitude: 28.59,
      longitude: 77.44,
      radiusMeters: 300,
      maxAccuracyMeters: 100,
    },
    arrivalStatus: 'on_time',
    __v: 1,
  };
}

describe('PATCH /api/attendance/:id when marking absent', () => {
  before(async () => {
    process.env.JWT_SECRET = 'attendance-edit-test-secret';
    Admin.findById = () => ({
      select: async () => ({
        _id: adminId,
        role: 'admin',
        isActive: true,
        permissions: ['view_all_attendance', 'edit_attendance'],
      }),
    });
    Attendance.findOne = (filter) => ({
      lean: async () => attendanceRecords.get(String(filter._id)) || null,
    });
    Attendance.findOneAndUpdate = async (filter, update) => {
      const current = attendanceRecords.get(String(filter._id));
      if (!current || current.__v !== filter.__v) return null;
      const changed = {
        ...current,
        ...update.$set,
        __v: current.__v + update.$inc.__v,
        corrections: [...(current.corrections || []), update.$push.corrections],
      };
      attendanceRecords.set(String(filter._id), changed);
      return changed;
    };

    const app = express();
    app.use(express.json());
    app.use('/api/attendance', attendanceRoutes);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    Admin.findById = originals.adminFindById;
    Attendance.findOne = originals.attendanceFindOne;
    Attendance.findOneAndUpdate = originals.attendanceFindOneAndUpdate;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  beforeEach(() => attendanceRecords.clear());

  it('edits a manual-marked record with no punch or shift fields to absent', async () => {
    const original = manualRecord();
    attendanceRecords.set(recordId, original);

    const response = await patchAttendance({
      attendanceDate: priorDate,
      attendanceStatus: 'absent',
      checkInTime: '',
      checkOutTime: '',
      reason: 'Correct attendance to absent.',
      version: 1,
    });
    const body = await response.json();
    const saved = attendanceRecords.get(recordId);

    assert.equal(response.status, 200);
    assert.deepEqual(body, { success: true, message: 'Attendance updated successfully.' });
    assert.equal(saved.attendanceStatus, 'absent');
    assert.equal(saved.checkIn, undefined);
    assert.equal(saved.checkOut, null);
    assert.equal(saved.shiftSnapshot, undefined);
    assert.equal(saved.arrivalStatus, undefined);
    assert.deepEqual(saved.manualMark, original.manualMark);
    assert.equal(saved.corrections[0].action, 'edit');
    assert.equal(saved.corrections[0].actor, adminId);
    assert.equal(saved.corrections[0].before.checkIn, undefined);
    assert.equal(saved.corrections[0].after.checkIn, undefined);
  });

  it('edits a punched record to absent and preserves punch, location, and audit evidence', async () => {
    const original = punchedRecord();
    attendanceRecords.set(recordId, original);

    const response = await patchAttendance({
      attendanceDate: priorDate,
      attendanceStatus: 'absent',
      checkInTime: '',
      checkOutTime: '',
      reason: 'Correct attendance to absent.',
      version: 1,
    });
    const body = await response.json();
    const saved = attendanceRecords.get(recordId);
    const editAudit = saved.corrections[0];

    assert.equal(response.status, 200);
    assert.deepEqual(body, { success: true, message: 'Attendance updated successfully.' });
    assert.equal(saved.attendanceStatus, 'absent');
    assert.deepEqual(saved.checkIn, original.checkIn);
    assert.deepEqual(saved.checkOut, original.checkOut);
    assert.deepEqual(saved.shiftSnapshot, original.shiftSnapshot);
    assert.equal(editAudit.action, 'edit');
    assert.equal(editAudit.actor, adminId);
    assert.deepEqual(editAudit.before.checkIn, original.checkIn);
    assert.deepEqual(editAudit.before.checkOut, original.checkOut);
    assert.deepEqual(editAudit.before.shiftSnapshot, original.shiftSnapshot);
    assert.deepEqual(editAudit.after.checkIn, original.checkIn);
    assert.deepEqual(editAudit.after.checkOut, original.checkOut);
    assert.deepEqual(editAudit.after.shiftSnapshot, original.shiftSnapshot);
  });

  it('returns validation errors for invalid reason and status, and a conflict-style validation error for invalid version', async () => {
    attendanceRecords.set(recordId, manualRecord());
    const base = {
      attendanceDate: priorDate,
      attendanceStatus: 'absent',
      checkInTime: '',
      checkOutTime: '',
      reason: 'Valid reason for edit.',
      version: 1,
    };

    const invalidReason = await patchAttendance({ ...base, reason: '' });
    assert.equal(invalidReason.status, 400);
    assert.match((await invalidReason.json()).message, /reason/i);

    const invalidVersion = await patchAttendance({ ...base, version: '1' });
    assert.equal(invalidVersion.status, 400);
    assert.deepEqual(await invalidVersion.json(), {
      success: false,
      message: 'Refresh the record before making changes.',
      code: 'INVALID_VERSION',
    });

    const invalidStatus = await patchAttendance({ ...base, attendanceStatus: 'unknown' });
    assert.equal(invalidStatus.status, 400);
    assert.deepEqual(await invalidStatus.json(), {
      success: false,
      message: 'Status must be present, half day, or absent.',
      code: 'INVALID_CORRECTION',
    });
    assert.equal(attendanceRecords.get(recordId).attendanceStatus, 'present');
  });
});
