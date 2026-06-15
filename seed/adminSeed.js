const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const Admin = require("../models/Admin");
const Role = require("../models/Role");
const { DEFAULT_ROLE_PERMISSIONS } = require("../models/Admin");

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://devclientg:SCpLNaejWusV7mcR@cluster0.vyinynw.mongodb.net/savorka";

mongoose.connect(MONGO_URI).then(() => {
  console.log("✅ Connected to MongoDB");
  seedAll();
});

const seedAll = async () => {
  try {

    // ─── Seed roles into DB ───────────────────────────────────────────────────
    const rolesToSeed = [
      { name: "Super Admin",    slug: "superadmin",       color: "#ef4444", description: "Full system access",           permissions: DEFAULT_ROLE_PERMISSIONS.superadmin },
      { name: "Admin",          slug: "admin",             color: "#f97316", description: "Administrative access",        permissions: DEFAULT_ROLE_PERMISSIONS.admin },
      { name: "Manager",        slug: "manager",           color: "#8b5cf6", description: "Management access",            permissions: DEFAULT_ROLE_PERMISSIONS.manager },
      { name: "HR",             slug: "hr",                color: "#06b6d4", description: "Human resources access",       permissions: DEFAULT_ROLE_PERMISSIONS.hr },
      { name: "Sales",          slug: "sales",             color: "#10b981", description: "Sales team access",            permissions: DEFAULT_ROLE_PERMISSIONS.sales },
      { name: "Project Manager",slug: "project_manager",   color: "#f59e0b", description: "Project management access",    permissions: DEFAULT_ROLE_PERMISSIONS.project_manager },
      { name: "Employee",       slug: "employee",          color: "#6366f1", description: "Basic employee access",        permissions: DEFAULT_ROLE_PERMISSIONS.employee },
    ];

    for (const roleData of rolesToSeed) {
      const exists = await Role.findOne({ slug: roleData.slug });
      if (!exists) {
        await Role.create({
          name:        roleData.name,
          slug:        roleData.slug,
          color:       roleData.color,
          description: roleData.description,
          permissions: roleData.permissions,
          createdBy:   null,
        });
        console.log(`✅ Role seeded: ${roleData.name}`);
      } else {
        console.log(`ℹ️  Role already exists: ${roleData.name}`);
      }
    }

    // ─── Seed superadmin user ─────────────────────────────────────────────────
    const superadminExists = await Admin.findOne({ email: "superadmin@savorka.com" });
    if (!superadminExists) {
      const hashedPassword = await bcrypt.hash("SuperAdmin@123", 10);
      await Admin.create({
        name: "Super Admin",
        email: "superadmin@savorka.com",
        password: hashedPassword,
        role: "superadmin",
        permissions: [],
        isActive: true,
      });
      console.log("✅ Superadmin created: superadmin@savorka.com / SuperAdmin@123");
    } else {
      console.log("ℹ️  Superadmin already exists");
    }

    // ─── Seed default admin ───────────────────────────────────────────────────
    const adminExists = await Admin.findOne({ email: "admin@123.com" });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash("123456", 10);
      await Admin.create({
        name: "Admin",
        email: "admin@123.com",
        password: hashedPassword,
        role: "admin",
        permissions: [],
        isActive: true,
      });
      console.log("✅ Admin created: admin@123.com / 123456");
    } else {
      if (!adminExists.role || adminExists.role === "employee") {
        adminExists.role = "admin";
        adminExists.name = adminExists.name || "Admin";
        await adminExists.save();
        console.log("✅ Existing admin updated with role: admin");
      } else {
        console.log("ℹ️  Admin already exists");
      }
    }

    // ─── Seed demo users ──────────────────────────────────────────────────────
    const demoUsers = [
      { name: "John Manager", email: "manager@savorka.com",  role: "manager",        password: "Manager@123" },
      { name: "Sarah HR",     email: "hr@savorka.com",       role: "hr",              password: "Hr@123456"  },
      { name: "Mike Sales",   email: "sales@savorka.com",    role: "sales",           password: "Sales@123"  },
      { name: "Emily PM",     email: "pm@savorka.com",       role: "project_manager", password: "Pm@123456"  },
      { name: "Tom Employee", email: "employee@savorka.com", role: "employee",        password: "Emp@123456" },
    ];

    for (const user of demoUsers) {
      const exists = await Admin.findOne({ email: user.email });
      if (!exists) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        await Admin.create({
          name: user.name,
          email: user.email,
          password: hashedPassword,
          role: user.role,
          permissions: [],
          isActive: true,
        });
        console.log(`✅ Demo user created: ${user.email} / ${user.password}`);
      }
    }

    console.log("\n🎉 Seed complete!");
    console.log("─────────────────────────────────────────");
    console.log("  superadmin@savorka.com  /  SuperAdmin@123  (superadmin)");
    console.log("  admin@123.com           /  123456           (admin)");
    console.log("  manager@savorka.com     /  Manager@123      (manager)");
    console.log("  hr@savorka.com          /  Hr@123456        (hr)");
    console.log("  sales@savorka.com       /  Sales@123        (sales)");
    console.log("  pm@savorka.com          /  Pm@123456        (project_manager)");
    console.log("  employee@savorka.com    /  Emp@123456       (employee)");
    console.log("─────────────────────────────────────────");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed error:", error);
    process.exit(1);
  }
};





// const mongoose = require("mongoose");
// const bcrypt = require("bcryptjs");
// require("dotenv").config();

// const Admin = require("../models/Admin");
// console.log('MONGO_URI:', "mongodb+srv://devclientg:SCpLNaejWusV7mcR@cluster0.vyinynw.mongodb.net/savorka");
// mongoose.connect("mongodb+srv://devclientg:SCpLNaejWusV7mcR@cluster0.vyinynw.mongodb.net/savorka");

// const seedAdmin = async () => {
//   try {

//     const adminExists = await Admin.findOne({ email: "admin@123.com" });

//     if (adminExists) {
//       console.log("Admin already exists");
//       process.exit();
//     }

//     const hashedPassword = await bcrypt.hash("123456", 10);

//     const admin = new Admin({
     
//       email: "admin@123.com",
//       password: hashedPassword
//     });

//     await admin.save();

//     console.log("Admin inserted successfully");
//     process.exit();

//   } catch (error) {
//     console.error(error);
//     process.exit(1);
//   }
// };

// seedAdmin();