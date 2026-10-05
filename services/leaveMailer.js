const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Account = require('../models/LeaveAccount');
const Admin = require('../models/Admin');
const { allowed } = require('./leaveService');
let timer, running = false;
function config() {
  const { MAIL_HOST, EMAIL_USERNAME, EMAIL_PASSWORD, MAIL_FROM_ADDRESS, LEAVE_CRM_URL } = process.env;
  if (!MAIL_HOST || !EMAIL_USERNAME || !EMAIL_PASSWORD || !LEAVE_CRM_URL) throw new Error('Leave SMTP / CRM URL configuration is missing.');
  const url = new URL(LEAVE_CRM_URL);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('LEAVE_CRM_URL must use HTTPS (localhost may use HTTP).');
  const port = Number(process.env.MAIL_PORT || 465);
  return { url, from: MAIL_FROM_ADDRESS || EMAIL_USERNAME, options: { host: MAIL_HOST, port, secure: port === 465 || process.env.MAIL_ENCRYPTION === 'ssl', auth: { user: EMAIL_USERNAME, pass: EMAIL_PASSWORD }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 } };
}
async function tick() {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < 20; i++) {
      const now = new Date();
      const due = { $or: [{ status: 'queued', nextAt: { $lte: now } }, { status: 'sending', leaseUntil: { $lte: now } }] };
      const candidate = await Account.findOne({ mail: { $elemMatch: due } }).select({ mail: { $elemMatch: due } }).lean();
      if (!candidate?.mail?.length) break;
      const job = candidate.mail[0], claim = crypto.randomUUID();
      const claimed = await Account.updateOne({ _id: candidate._id, mail: { $elemMatch: { _id: job._id, ...due } } }, { $set: { 'mail.$.status': 'sending', 'mail.$.claim': claim, 'mail.$.leaseUntil': new Date(Date.now() + 120000) }, $inc: { 'mail.$.attempts': 1 } });
      if (!claimed.modifiedCount) continue;
      let update;
      try {
        const c = config();
        const recipient = await Admin.findById(job.recipient).select('email isActive role permissions').lean();
        if (!recipient?.isActive || !recipient.email) throw new Error('Recipient is unavailable.');
        c.url.searchParams.set('module', 'leaves');
        c.url.searchParams.set('leave', String(job.requestId));
        const account = await Account.findById(candidate._id).select('year employee').lean();
        if (String(account.employee) !== String(job.recipient) && !await allowed(recipient, 'approve_leaves')) throw new Error('Approval permission was revoked.');
        c.url.searchParams.set('year', String(account.year));
        const transport = nodemailer.createTransport(c.options);
        try {
          const sent = await transport.sendMail({ from: c.from, to: recipient.email, subject: job.subject,
            messageId: `<leave-${job._id}@${c.url.hostname}>`, text: `${job.text}\n\n${c.url.toString()}` });
          if (!sent.accepted?.length) throw new Error('SMTP did not accept the recipient.');
        } finally { transport.close(); }
        update = { status: 'sent', sentAt: new Date(), error: '', text: '' };
      } catch (e) {
        const attempts = job.attempts + 1;
        update = { status: attempts >= 5 ? 'failed' : 'queued', nextAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** attempts)), error: 'Email could not be delivered. Check SMTP settings and recipient account.' };
        console.error('Leave email attempt failed:', job._id.toString(), e.code || e.name);
      }
      const fields = Object.fromEntries(Object.entries(update).map(([key, value]) => [`mail.$.${key}`, value]));
      await Account.updateOne({ _id: candidate._id, mail: { $elemMatch: { _id: job._id, claim, status: 'sending' } } }, { $set: fields });
    }
  } catch (e) { console.error('Leave email queue unavailable:', e.name); }
  finally { running = false; }
}
function startLeaveMailer() {
  if (timer) return;
  timer = setInterval(tick, 15000); timer.unref(); void tick();
}
module.exports = { startLeaveMailer };
