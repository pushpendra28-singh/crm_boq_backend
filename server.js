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

const app = express();

connectDB();

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



app.get("/", (req, res) => {
  res.send("API Running");
});

const PORT = process.env.PORT 
console.log('PORT:', PORT);
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});