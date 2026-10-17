const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Account = require('../models/LeaveAccount');
const Settings = require('../models/LeaveSettings');
const Holiday = require('../models/Holiday');
const Policy = require('../models/WeeklyOffPolicy');
const leaveRoutes = require('../routes/leaveRoutes');

const superadminId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const employeeId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const reviewerId = 'cccccccccccccccccccccccc';
const typeId = 'dddddddddddddddddddddddd';
const users = new Map([
  [superadminId, { _id: superadminId, name: 'Super Admin', role: 'superadmin', isActive: true }],
  [employeeId, { _id: employeeId, name: 'Employee', role: 'employee', isActive: true, permissions: ['apply_leaves'] }],
  [reviewerId, { _id: reviewerId, name: 'Reviewer', role: 'employee', isActive: true, permissions: ['approve_leaves'] }],
]);
const accounts = new Map();
let authenticatedUserId = employeeId;
let configuredReviewerIds = [reviewerId];
let server;
let port;
const originalJwtSecret = process.env.JWT_SECRET;
const originals = {
  adminFindById: Admin.findById,
  adminFindOne: Admin.findOne,
  adminFind: Admin.find,
  accountFindOne: Account.findOne,
  accountUpdateOne: Account.updateOne,
  settingsFindOne: Settings.findOne,
  holidayFind: Holiday.find,
  policyFindOne: Policy.findOne,
  policyFind: Policy.find,
};

const from = '2090-01-03';
const leaveBody = (overrides = {}) => ({
  from,
  to: from,
  typeId,
  portion: 'full',
  reason: 'Family appointment',
  ...overrides,
});

function accountFor(employee, year) {
  const key = `${employee}:${year}`;
  if (!accounts.has(key)) {
    accounts.set(key, {
      _id: `${employee.slice(0, 20)}${String(year).slice(-4)}`,
      employee,
      year,
      allocations: [{ typeId, units: 5 }],
      requests: [],
      mail: [],
      adjustments: [],
      save: async function save() { return this; },
    });
  }
  return accounts.get(key);
}

function authToken() {
  return jwt.sign({ id: authenticatedUserId }, process.env.JWT_SECRET);
}

async function post(path, body) {
  return fetch(`http://127.0.0.1:${port}/api/leaves${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${authToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('leave application endpoints', () => {
  before(async () => {
    process.env.JWT_SECRET = 'leave-application-test-secret';
    Admin.findById = (id) => ({ select: async () => users.get(String(id)) || null });
    Admin.findOne = async (filter) => {
      const user = users.get(String(filter._id));
      return user?.isActive && filter.isActive === true ? user : null;
    };
    Admin.find = () => ({ select: async () => configuredReviewerIds.map((id) => users.get(id)) });
    Account.findOne = async (filter) => accounts.get(`${filter.employee}:${filter.year}`) || null;
    Account.updateOne = async (filter) => { accountFor(filter.employee, filter.year); };
    Settings.findOne = async () => ({
      types: [{ _id: typeId, name: 'Annual', paid: true, halfDay: true, active: true }],
      allowPast: false,
      reviewers: [reviewerId],
    });
    Holiday.find = () => ({ select: () => ({ lean: async () => [] }) });
    Policy.findOne = () => ({ sort: () => ({ select: () => ({
      lean: async () => ({ effectiveFrom: '2089-01-01', rules: [] }),
    }) }) });
    Policy.find = () => ({ sort: () => ({ select: () => ({ lean: async () => [] }) }) });

    const app = express();
    app.use(express.json());
    app.use('/api/leaves', leaveRoutes);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    Admin.findById = originals.adminFindById;
    Admin.findOne = originals.adminFindOne;
    Admin.find = originals.adminFind;
    Account.findOne = originals.accountFindOne;
    Account.updateOne = originals.accountUpdateOne;
    Settings.findOne = originals.settingsFindOne;
    Holiday.find = originals.holidayFind;
    Policy.findOne = originals.policyFindOne;
    Policy.find = originals.policyFind;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  beforeEach(() => {
    accounts.clear();
    authenticatedUserId = employeeId;
    configuredReviewerIds = [reviewerId];
  });

  it('keeps employee preview and submission scoped to the authenticated employee', async () => {
    accountFor(employeeId, 2090);
    const preview = await post('/preview', leaveBody());
    assert.equal(preview.status, 200);
    assert.deepEqual(await preview.json(), {
      units: 1,
      excludedDays: 0,
      paid: true,
      balance: { allocated: 5, used: 0, reserved: 0, available: 5 },
    });

    const response = await post('/requests', leaveBody({ key: 'employee-request-key-1' }));
    assert.equal(response.status, 201);
    assert.equal((await response.json()).message, 'Leave request submitted. Email notifications are queued.');
    const account = accounts.get(`${employeeId}:2090`);
    assert.equal(account.employee, employeeId);
    assert.equal(account.requests[0].status, 'pending');
    assert.equal(account.requests[0].history[0].actor, employeeId);
  });

  it('lets a superadmin preview and submit for an active selected employee', async () => {
    authenticatedUserId = superadminId;
    configuredReviewerIds = [reviewerId, superadminId, employeeId];
    accountFor(employeeId, 2090);
    const preview = await post('/preview', leaveBody({ employee: employeeId }));
    assert.equal(preview.status, 200);
    assert.deepEqual(await preview.json(), {
      units: 1,
      excludedDays: 0,
      paid: true,
      balance: { allocated: 5, used: 0, reserved: 0, available: 5 },
    });

    const response = await post('/requests', leaveBody({ employee: employeeId, key: 'superadmin-request-key-1' }));
    assert.equal(response.status, 201);
    assert.equal((await response.json()).message, 'Leave request submitted. Email notifications are queued.');
    const account = accounts.get(`${employeeId}:2090`);
    const request = account.requests[0];
    assert.equal(account.employee, employeeId);
    assert.equal(request.status, 'pending');
    assert.equal(request.history[0].actor, superadminId);
    assert.deepEqual(request.reviewers.map(String), [reviewerId]);
    assert.deepEqual(account.mail.map((item) => item.recipient).sort(), [employeeId, reviewerId, superadminId].sort());
  });

  it('rejects non-superadmins that provide an employee field', async () => {
    const preview = await post('/preview', leaveBody({ employee: employeeId }));
    assert.equal(preview.status, 403);

    const response = await post('/requests', leaveBody({ employee: employeeId, key: 'employee-request-key-2' }));
    assert.equal(response.status, 403);
    assert.equal(accounts.size, 0);
  });

  it('rejects malformed and inactive selected employee IDs', async () => {
    authenticatedUserId = superadminId;
    const malformed = await post('/preview', leaveBody({ employee: 'not-an-id' }));
    assert.equal(malformed.status, 400);

    const inactive = await post('/requests', leaveBody({ employee: 'eeeeeeeeeeeeeeeeeeeeeeee', key: 'superadmin-request-key-2' }));
    assert.equal(inactive.status, 404);
    assert.equal(accounts.size, 0);
  });
});