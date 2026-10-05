const Attendance = require('../models/Attendance');
const Admin = require('../models/Admin');
const { AttendanceError } = require('../utils/attendance');
const { day, istDay, reason, correction, snapshot } = require('../utils/attendanceCorrection');
const fail = (res, error) => {
  if (error instanceof AttendanceError) return res.status(error.statusCode).json({ success:false, message:error.message, code:error.code });
  if (error.code === 11000) return res.status(409).json({ success:false, message:'An attendance record already exists for this user and date, including removed records. Choose another date.' });
  console.error('Attendance management failed:', error.name);
  return res.status(500).json({ success:false, message:'Unable to save or load attendance. Refresh records before retrying.' });
};
function validateId(id) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AttendanceError('INVALID_ID','Invalid attendance ID.');
}
function revision(body) {
  if (!Number.isInteger(body?.version) || body.version < 0) throw new AttendanceError('INVALID_VERSION','Refresh the record before making changes.');
}
function output(r) {
  const absent = r.attendanceStatus === 'absent';
  return { id:r._id, version:r.__v, employeeId:r.employeeId?._id || null,
    employeeName:r.employeeId?.name || 'Deleted user', employeeEmail:r.employeeId?.email || '',
    attendanceDate:r.attendanceDate, attendanceStatus:r.attendanceStatus || 'present',
    workMode:r.workMode || 'office', wfhType:r.workMode === 'wfh' ? r.wfhType || 'full_day' : null,
    arrivalStatus:absent ? null : r.arrivalStatus, checkInAt:absent ? null : r.checkIn?.at,
    checkOutAt:absent ? null : r.checkOut?.at,
    checkInLocation:absent ? null : r.checkIn?.location || null,
    checkOutLocation:absent ? null : r.checkOut?.location || null,
    workingMinutes:absent ? 0 : r.checkOut ? Math.max(0,Math.floor((new Date(r.checkOut.at)-new Date(r.checkIn.at))/60000)) : null };
}
exports.list = async (req,res) => {
  try {
    // Calendar dropdown: minimal user details.
// Protected by the existing view_all_attendance permission.
if (req.query.directory === "1") {
  const employees = await Admin.find({})
    .select("_id name email isActive")
    .sort({ name: 1, _id: 1 })
    .lean();

  return res.json({
    success: true,
    employees: employees.map((employee) => ({
      id: employee._id,
      name: employee.name,
      email: employee.email,
      isActive: employee.isActive,
    })),
  });
}
    const today = istDay();
    const from = day(req.query.from || today.slice(0,7)+'-01');
    const to = day(req.query.to || today);
    if (from > to || new Date(to)-new Date(from) > 366*86400000) throw new AttendanceError('INVALID_RANGE','Choose a date range of up to 366 days.');
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AttendanceError('INVALID_PAGE','Invalid page number.');
    const filter = { deletedAt:null, attendanceDate:{$gte:from,$lte:to} };
    if (req.query.employeeId !== undefined) {
  validateId(req.query.employeeId);
  filter.employeeId = req.query.employeeId;
}
    if (
  req.query.employeeId === undefined &&
  req.query.search !== undefined
) {
      if (typeof req.query.search !== 'string' || req.query.search.length > 100) throw new AttendanceError('INVALID_SEARCH','Search must be at most 100 characters.');
      const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if (escaped) {
        const users = await Admin.find({$or:[{name:{$regex:escaped,$options:'i'}},{email:{$regex:escaped,$options:'i'}}]}).select('_id').limit(1001).lean();
        if (users.length > 1000) throw new AttendanceError('BROAD_SEARCH','Please narrow your employee search.');
        filter.employeeId = {$in:users.map(u=>u._id)};
      }
    }
    const [total,rows] = await Promise.all([
      Attendance.countDocuments(filter),
      Attendance.find(filter).select('employeeId attendanceDate attendanceStatus arrivalStatus workMode wfhType checkIn checkOut __v')
        .populate('employeeId','name email').sort({attendanceDate:-1,_id:-1}).skip((page-1)*20).limit(20).lean(),
    ]);
    res.json({success:true,records:rows.map(output),page,total,pages:Math.max(1,Math.ceil(total/20))});
  } catch(e) { fail(res,e); }
};
exports.edit = async (req,res) => {
  try {
    validateId(req.params.id); revision(req.body);
    const record = await Attendance.findOne({_id:req.params.id,deletedAt:null}).lean();
    if (!record) throw new AttendanceError('NOT_FOUND','Attendance record not found.',404);
    const {update,reason:why} = correction(record,req.body);
    const result = await Attendance.findOneAndUpdate(
      {_id:record._id,__v:req.body.version,deletedAt:null},
      {$set:update,$inc:{__v:1},$push:{corrections:{action:'edit',actor:req.admin._id,at:new Date(),reason:why,before:snapshot(record),after:snapshot({...record,...update})}}},
      {new:true,runValidators:true}
    );
    if (!result) throw new AttendanceError('CONFLICT','This record changed while you were editing. Refresh and try again.',409);
    res.json({success:true,message:'Attendance updated successfully.'});
  } catch(e) { fail(res,e); }
};
exports.remove = async (req,res) => {
  try {
    validateId(req.params.id); revision(req.body);
    const why = reason(req.body.reason);
    const record = await Attendance.findOne({_id:req.params.id,deletedAt:null}).lean();
    if (!record) throw new AttendanceError('NOT_FOUND','Attendance record not found.',404);
    const at = new Date();
    const result = await Attendance.findOneAndUpdate({_id:record._id,__v:req.body.version,deletedAt:null},
      {$set:{deletedAt:at,deletedBy:req.admin._id},$inc:{__v:1},$push:{corrections:{action:'delete',actor:req.admin._id,at,reason:why,before:snapshot(record),after:{deletedAt:at}}}},
      {new:true,runValidators:true});
    if (!result) throw new AttendanceError('CONFLICT','This record changed. Refresh before deleting.',409);
    res.json({success:true,message:'Attendance removed successfully. Audit history has been retained.'});
  } catch(e) { fail(res,e); }
};






// const Attendance = require('../models/Attendance');
// const Admin = require('../models/Admin');
// const { AttendanceError } = require('../utils/attendance');
// const { day, istDay, reason, correction, snapshot } = require('../utils/attendanceCorrection');

// const fail = (res, error) => {
//   if (error instanceof AttendanceError) return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
//   if (error.code === 11000) return res.status(409).json({ success: false, message: 'An attendance record already exists for this user and date, including removed records. Choose another date.' });
//   console.error('Attendance management failed:', error.name);
//   return res.status(500).json({ success: false, message: 'Unable to save or load attendance. Refresh records before retrying.' });
// };

// function validateId(id) {
//   if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new AttendanceError('INVALID_ID', 'Invalid attendance ID.');
// }

// function revision(body) {
//   if (!Number.isInteger(body?.version) || body.version < 0) throw new AttendanceError('INVALID_VERSION', 'Refresh the record before making changes.');
// }
// function output(r) {
//   const absent = r.attendanceStatus === 'absent';
//   return {
//     id: r._id, version: r.__v, employeeId: r.employeeId?._id || null,
//     employeeName: r.employeeId?.name || 'Deleted user', employeeEmail: r.employeeId?.email || '',
//     attendanceDate: r.attendanceDate, attendanceStatus: r.attendanceStatus || 'present',
//     arrivalStatus: absent ? null : r.arrivalStatus, checkInAt: absent ? null : r.checkIn?.at,
//     checkOutAt: absent ? null : r.checkOut?.at,
//     workingMinutes: absent ? 0 : r.checkOut ? Math.max(0, Math.floor((new Date(r.checkOut.at) - new Date(r.checkIn.at)) / 60000)) : null
//   };
// }
// exports.list = async (req, res) => {
//   try {
//     // Calendar dropdown: minimal user details.
//     // Protected by the existing view_all_attendance permission.
//     if (req.query.directory === "1") {
//       const employees = await Admin.find({})
//         .select("_id name email isActive")
//         .sort({ name: 1, _id: 1 })
//         .lean();

//       return res.json({
//         success: true,
//         employees: employees.map((employee) => ({
//           id: employee._id,
//           name: employee.name,
//           email: employee.email,
//           isActive: employee.isActive,
//         })),
//       });
//     }
//     const today = istDay();
//     const from = day(req.query.from || today.slice(0, 7) + '-01');
//     const to = day(req.query.to || today);
//     if (from > to || new Date(to) - new Date(from) > 366 * 86400000) throw new AttendanceError('INVALID_RANGE', 'Choose a date range of up to 366 days.');
//     const page = Number(req.query.page || 1);
//     if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AttendanceError('INVALID_PAGE', 'Invalid page number.');
//     const filter = { deletedAt: null, attendanceDate: { $gte: from, $lte: to } };
//     if (req.query.employeeId !== undefined) {
//       validateId(req.query.employeeId);
//       filter.employeeId = req.query.employeeId;
//     }
//     if (
//       req.query.employeeId === undefined &&
//       req.query.search !== undefined
//     ) {
//       if (typeof req.query.search !== 'string' || req.query.search.length > 100) throw new AttendanceError('INVALID_SEARCH', 'Search must be at most 100 characters.');
//       const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//       if (escaped) {
//         const users = await Admin.find({ $or: [{ name: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } }] }).select('_id').limit(1001).lean();
//         if (users.length > 1000) throw new AttendanceError('BROAD_SEARCH', 'Please narrow your employee search.');
//         filter.employeeId = { $in: users.map(u => u._id) };
//       }
//     }
//     const [total, rows] = await Promise.all([
//       Attendance.countDocuments(filter),
//       Attendance.find(filter).select('employeeId attendanceDate attendanceStatus arrivalStatus checkIn.at checkOut.at __v')
//         .populate('employeeId', 'name email').sort({ attendanceDate: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
//     ]);
//     res.json({ success: true, records: rows.map(output), page, total, pages: Math.max(1, Math.ceil(total / 20)) });
//   } catch (e) { fail(res, e); }
// };
// exports.edit = async (req, res) => {
//   try {
//     validateId(req.params.id); revision(req.body);
//     const record = await Attendance.findOne({ _id: req.params.id, deletedAt: null }).lean();
//     if (!record) throw new AttendanceError('NOT_FOUND', 'Attendance record not found.', 404);
//     const { update, reason: why } = correction(record, req.body);
//     const result = await Attendance.findOneAndUpdate(
//       { _id: record._id, __v: req.body.version, deletedAt: null },
//       { $set: update, $inc: { __v: 1 }, $push: { corrections: { action: 'edit', actor: req.admin._id, at: new Date(), reason: why, before: snapshot(record), after: snapshot({ ...record, ...update }) } } },
//       { new: true, runValidators: true }
//     );
//     if (!result) throw new AttendanceError('CONFLICT', 'This record changed while you were editing. Refresh and try again.', 409);
//     res.json({ success: true, message: 'Attendance updated successfully.' });
//   } catch (e) { fail(res, e); }
// };
// exports.remove = async (req, res) => {
//   try {
//     validateId(req.params.id); revision(req.body);
//     const why = reason(req.body.reason);
//     const record = await Attendance.findOne({ _id: req.params.id, deletedAt: null }).lean();
//     if (!record) throw new AttendanceError('NOT_FOUND', 'Attendance record not found.', 404);
//     const at = new Date();
//     const result = await Attendance.findOneAndUpdate({ _id: record._id, __v: req.body.version, deletedAt: null },
//       { $set: { deletedAt: at, deletedBy: req.admin._id }, $inc: { __v: 1 }, $push: { corrections: { action: 'delete', actor: req.admin._id, at, reason: why, before: snapshot(record), after: { deletedAt: at } } } },
//       { new: true, runValidators: true });
//     if (!result) throw new AttendanceError('CONFLICT', 'This record changed. Refresh before deleting.', 409);
//     res.json({ success: true, message: 'Attendance removed successfully. Audit history has been retained.' });
//   } catch (e) { fail(res, e); }
// };
