require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const leadRoutes = require("./routes/leadRoutes");
const newsletterRoutes = require("./routes/newsletterRoutes");
const contactRoutes = require("./routes/contactRoutes");
const commentRoutes = require("./routes/commentRoutes");
const formRoutes = require("./routes/formRoutes");
const projectsRoutes = require("./routes/projectsRoutes");
const path = require("path");
const teamRoutes = require("./routes/teamRoutes");
const roleRoutes = require("./routes/rolesRoutes");
const userRoutes = require("./routes/usersRoutes");
const adminRoutes = require("./routes/adminRoutes");
const proposalRoutes = require('./routes/proposalRoutes');
const assignedProjectsRoutes = require("./routes/assignedProjectsRoutes");
const assignedLeadRoutes = require("./routes/assignedLeadRoutes");
const newProposalRoutes = require("./routes/newProposalRoutes");
const tenderRoutes = require("./routes/tenderRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const businessProfileRoutes = require("./routes/businessProfileRoutes");
const customerRoutes = require("./routes/customerRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const initAttendance = require("./config/initAttendance");
const holidayRoutes = require("./routes/holidayRoutes");
const initHolidays = require("./config/initHolidays");
const weeklyOffRoutes = require("./routes/weeklyOffRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const initLeaves = require("./config/initLeaves");
const { startLeaveMailer } = require("./services/leaveMailer");
const monthlyWorkRecordRoutes = require("./routes/monthlyWorkRecordRoutes");
const workFromHomeRoutes = require("./routes/workFromHomeRoutes");
const payrollRoutes = require("./routes/payrollRoutes");




const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api", leadRoutes);
app.use("/api", newsletterRoutes);
app.use("/api", contactRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api", formRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api", teamRoutes);

app.use("/api/roles", roleRoutes);
app.use("/api", userRoutes);
app.use("/api/admins", adminRoutes);
app.use('/api', proposalRoutes);
app.use("/api/my-projects", assignedProjectsRoutes);
app.use("/api", assignedLeadRoutes);
app.use("/api/new-proposals", newProposalRoutes);
app.use("/api/tender", tenderRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/business-profile", businessProfileRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/weekly-offs", weeklyOffRoutes);
app.use("/api/monthly-work-records", monthlyWorkRecordRoutes);
app.use("/api/wfh-settings", workFromHomeRoutes);
app.use("/api/payroll", payrollRoutes);





app.get("/", (req, res) => {
  res.send("API Running");
});

async function startServer() {
  await connectDB();

  await initAttendance();
  await initHolidays();
  await initLeaves();
startLeaveMailer();
  console.log("Attendance office configuration initialized");

  const PORT = process.env.PORT;

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server initialization failed:", error.message);
  process.exit(1);
});