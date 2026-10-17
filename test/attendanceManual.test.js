const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Attendance = require('../models/Attendance');
const Role = require('../models/Role');
const attendanceRoutes = require('../routes/attendanceRoutes');

const adminId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const employeeId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const allPermissions = ['view_all_attendance', 'mark_attendance_for_others'];
const attendanceRecords = [];
let grantedPermissions = [];
let employeeExists = true;
let server;
let port;
const originalJwtSecret = process.env.JWT_SECRET;
const originals = {
  adminFindById: Admin.findById,
  adminFindOne: Admin.findOne,
  attendanceFindOne: Attendance.findOne,
  attendanceFindOneAndUpdate: Attendance.findOneAndUpdate,
  attendanceCreate: Attendance.create,
  roleFindOne: Role.findOne,
};

function istDateOffset(days) {
  return new Date(Date.now() + 19800000 + days * 86400000).toISOString().slice(0, 10);
}

async function postManual(body) {
  const token = jwt.sign({ id: adminId }, process.env.JWT_SECRET);
  return fetch(`http://127.0.0.1:${port}/api/attendance/manual`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/attendance/manual', () => {
  before(async () => {
    process.env.JWT_SECRET = 'attendance-test-secret';
    Admin.findById = () => ({
      select: async () => ({ _id: adminId, role: 'admin', isActive: true, permissions: [] }),
    });
    Admin.findOne = (filter) => ({
      select: async () => employeeExists && String(filter._id) === employeeId &&
        filter.isActive === true ? { _id: employeeId } : null,
    });
    Role.findOne = async () => ({ permissions: grantedPermissions });
    Attendance.findOne = (filter) => ({
      lean: async () => attendanceRecords.find((record) =>
        String(record.employeeId) === String(filter.employeeId) &&
        record.attendanceDate === filter.attendanceDate) || null,
    });
    Attendance.findOneAndUpdate = async (filter, update) => {
      const record = attendanceRecords.find((current) =>
        String(current._id) === String(filter._id) &&
        current.__v === filter.__v &&
        current.deletedAt &&
        current.manualMark?.action === filter['manualMark.action']);
      if (!record) return null;
      Object.assign(record, update.$set);
      record.__v += update.$inc.__v;
      record.corrections.push(update.$push.corrections);
      return record;
    };
    Attendance.create = async (record) => {
      if (attendanceRecords.some((existing) =>
        String(existing.employeeId) === String(record.employeeId) &&
        existing.attendanceDate === record.attendanceDate)) {
        throw Object.assign(new Error('Duplicate record'), { code: 11000 });
      }
      const saved = { ...record, _id: 'cccccccccccccccccccccccc' };
      attendanceRecords.push(saved);
      return saved;
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
    Admin.findOne = originals.adminFindOne;
    Attendance.findOne = originals.attendanceFindOne;
    Attendance.findOneAndUpdate = originals.attendanceFindOneAndUpdate;
    Attendance.create = originals.attendanceCreate;
    Role.findOne = originals.roleFindOne;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  beforeEach(() => {
    grantedPermissions = [...allPermissions];
    employeeExists = true;
    attendanceRecords.length = 0;
  });

  it('marks an active employee present without fabricated punch or location data', async () => {
    const attendanceDate = istDateOffset(-1);
    const response = await postManual({ employeeId, attendanceDate });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.match(body.message, /marked present/i);
    assert.equal(attendanceRecords.length, 1);
    assert.equal(attendanceRecords[0].attendanceStatus, 'present');
    assert.equal(attendanceRecords[0].checkIn, undefined);
    assert.equal(attendanceRecords[0].officeId, undefined);
    assert.equal(attendanceRecords[0].workMode, null);
    assert.deepEqual(attendanceRecords[0].manualMark, {
      actor: adminId,
      at: attendanceRecords[0].manualMark.at,
      action: 'mark_present',
    });
    assert.equal(attendanceRecords[0].corrections[0].action, 'manual_mark');
    assert.equal(String(attendanceRecords[0].corrections[0].actor), adminId);
  });

  for (const permission of allPermissions) {
    it(`forbids a direct API request missing ${permission}`, async () => {
      grantedPermissions = allPermissions.filter((candidate) => candidate !== permission);
      const response = await postManual({ employeeId, attendanceDate: istDateOffset(-1) });
      assert.equal(response.status, 403);
      assert.equal(attendanceRecords.length, 0);
    });
  }

  it('rejects malformed employee IDs and nonexistent employees', async () => {
    const invalidIdResponse = await postManual({ employeeId: 'not-an-id', attendanceDate: istDateOffset(-1) });
    assert.equal(invalidIdResponse.status, 400);
    assert.match((await invalidIdResponse.clone().json()).message, /employee ID/i);

    employeeExists = false;
    const missingResponse = await postManual({ employeeId, attendanceDate: istDateOffset(-1) });
    assert.equal(missingResponse.status, 404);
    assert.equal(attendanceRecords.length, 0);
  });

  it('rejects invalid and future calendar dates', async () => {
    const invalidResponse = await postManual({ employeeId, attendanceDate: '2026-02-30' });
    assert.equal(invalidResponse.status, 400);

    const futureResponse = await postManual({ employeeId, attendanceDate: istDateOffset(1) });
    assert.equal(futureResponse.status, 400);
    assert.equal(attendanceRecords.length, 0);
  });

  it('rejects duplicates without overwriting the existing record', async () => {
    const original = {
      employeeId,
      attendanceDate: istDateOffset(-1),
      attendanceStatus: 'absent',
      note: 'keep this record unchanged',
    };
    attendanceRecords.push(original);

    const response = await postManual({ employeeId, attendanceDate: original.attendanceDate });
    assert.equal(response.status, 409);
    assert.equal(attendanceRecords.length, 1);
    assert.equal(attendanceRecords[0], original);
    assert.equal(attendanceRecords[0].attendanceStatus, 'absent');
  });

  it('allows a deleted manual mark to be marked again while preserving its audit history', async () => {
    const deletedAt = new Date('2026-10-06T12:00:00Z');
    const previousMarkAt = new Date('2026-10-05T12:00:00Z');
    const previousMark = {
      actor: adminId,
      at: previousMarkAt,
      action: 'mark_present',
    };
    const deletedRecord = {
      _id: 'cccccccccccccccccccccccc',
      employeeId,
      attendanceDate: istDateOffset(-1),
      attendanceStatus: 'present',
      workMode: null,
      wfhType: null,
      manualMark: previousMark,
      deletedAt,
      deletedBy: adminId,
      __v: 2,
      corrections: [
        {
          action: 'manual_mark',
          actor: adminId,
          at: previousMarkAt,
          reason: 'Attendance marked present manually.',
          before: {},
          after: { attendanceDate: istDateOffset(-1), attendanceStatus: 'present' },
        },
        {
          action: 'delete',
          actor: adminId,
          at: deletedAt,
          reason: 'Removed from calendar.',
          before: { attendanceDate: istDateOffset(-1), attendanceStatus: 'present' },
          after: { deletedAt },
        },
      ],
    };
    attendanceRecords.push(deletedRecord);

    const response = await postManual({
      employeeId,
      attendanceDate: deletedRecord.attendanceDate,
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(body, {
      success: true,
      message: 'Attendance marked present successfully.',
    });
    assert.equal(attendanceRecords.length, 1);
    assert.equal(deletedRecord.deletedAt, null);
    assert.equal(deletedRecord.deletedBy, null);
    assert.equal(deletedRecord.attendanceStatus, 'present');
    assert.equal(deletedRecord.__v, 3);
    assert.equal(deletedRecord.corrections.length, 3);
    assert.equal(deletedRecord.corrections[1].action, 'delete');
    assert.equal(deletedRecord.corrections[2].action, 'manual_mark');
    assert.deepEqual(deletedRecord.corrections[2].before.deletedAt, deletedAt);
    assert.equal(deletedRecord.manualMark.action, 'mark_present');
    assert.notEqual(deletedRecord.manualMark.at, previousMark.at);
  });

  it('allows only explicitly manual records to omit check-in and shift fields', async () => {
    const manual = new Attendance({
      employeeId,
      attendanceDate: istDateOffset(-1),
      attendanceStatus: 'present',
      workMode: null,
      manualMark: { actor: adminId, at: new Date(), action: 'mark_present' },
      corrections: [{
        action: 'manual_mark',
        actor: adminId,
        reason: 'Attendance marked present manually.',
        before: {},
        after: { attendanceDate: istDateOffset(-1), attendanceStatus: 'present' },
      }],
    });
    await assert.doesNotReject(manual.validate());

    const ordinary = new Attendance({ employeeId, attendanceDate: istDateOffset(-1) });
    await assert.rejects(ordinary.validate(), (error) => {
      assert.ok(error.errors.checkIn);
      assert.ok(error.errors.shiftSnapshot);
      assert.ok(error.errors.officeId);
      return true;
    });
  });

  it('publishes the permission with the expected label and Attendance group', () => {
    const permission = Admin.ALL_PERMISSIONS.find((entry) => entry.key === 'mark_attendance_for_others');
    assert.deepEqual(permission, {
      key: 'mark_attendance_for_others',
      label: 'Mark attendance for others',
      group: 'Attendance',
    });
  });
});
