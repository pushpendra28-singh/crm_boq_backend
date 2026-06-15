const Admin = require("../models/Admin");
const bcrypt = require("bcryptjs");
const Role = require("../models/Role");

// ─── Get all users ─────────────────────────────────────────────────────────────
// exports.getUsers = async (req, res) => {
//   try {
//     const users = await Admin.find()
//       .select("-password")
//       .sort({ createdAt: -1 });
//     res.json(users);
//   } catch (error) {
//     console.error("Get users error:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };
const resolvePermissions = async (admin) => {
  // custom permissions
  if (Array.isArray(admin.permissions) && admin.permissions.length > 0) {
    return admin.permissions;
  }

  // role permissions
  const roleData = await Role.findOne({
    $or: [
      { slug: admin.role },
      { name: new RegExp(`^${admin.role}$`, "i") },
    ],
  });

  if (roleData) {
    return Array.isArray(roleData.permissions)
      ? roleData.permissions
      : [];
  }

  // NEVER return undefined
  return [];
};

exports.getUsers = async (req, res) => {
  try {
    const users = await Admin.find()
      .select("-password")
      .sort({ createdAt: -1 });

    const result = await Promise.all(
      users.map(async (u) => ({
        ...u.toObject(),
        permissions: await resolvePermissions(u),
      }))
    );

    res.json(result);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Create user ───────────────────────────────────────────────────────────────
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    const existing = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new Admin({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: role || "employee",
      isActive: true,
    });

    await user.save();

    const userObj = user.toObject();
    delete userObj.password;

    res.status(201).json({ message: "User created successfully", user: userObj });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Update user ───────────────────────────────────────────────────────────────
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role } = req.body;

    // Prevent editing own record via this endpoint to avoid accidental role downgrade
    if (req.admin._id.toString() === id) {
      return res.status(400).json({ message: "You cannot edit your own account from this panel" });
    }

    const user = await Admin.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name.trim();
    if (email) {
      const emailLower = email.toLowerCase().trim();
      const conflict = await Admin.findOne({ email: emailLower, _id: { $ne: id } });
      if (conflict) return res.status(409).json({ message: "Email is already in use by another user" });
      user.email = emailLower;
    }
    if (role && role !== user.role) {
  user.role = role;

  // clear old custom permissions
  user.permissions = [];
}
    if (password && password.trim()) {
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      user.password = await bcrypt.hash(password, 10);
    }

    await user.save();

    const userObj = user.toObject();
    delete userObj.password;

    res.json({ message: "User updated successfully", user: userObj });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Delete user ───────────────────────────────────────────────────────────────
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.admin._id.toString() === id) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    const user = await Admin.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Prevent deleting the last superadmin
    if (user.role === "superadmin") {
      const superadminCount = await Admin.countDocuments({ role: "superadmin" });
      if (superadminCount <= 1) {
        return res.status(400).json({ message: "Cannot delete the last Super Admin account" });
      }
    }

    await Admin.findByIdAndDelete(id);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Toggle user active status ────────────────────────────────────────────────
exports.toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.admin._id.toString() === id) {
      return res.status(400).json({ message: "You cannot deactivate your own account" });
    }

    const user = await Admin.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.isActive = !user.isActive;
    await user.save();

    const userObj = user.toObject();
    delete userObj.password;

    res.json({
      message: `User ${user.isActive ? "activated" : "deactivated"} successfully`,
      user: userObj,
    });
  } catch (error) {
    console.error("Toggle status error:", error);
    res.status(500).json({ message: "Server error" });
  }
};