const Admin = require("../models/Admin");
const bcrypt = require("bcryptjs");
const generateToken = require("../utils/generateToken");
const Role = require("../models/Role");


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

// ─── Login ─────────────────────────────────────────────────────────────────────
exports.loginAdmin = async (req, res) => {
  try {
    console.log('Login attempt:', req.body.email);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }
    console.log('Attempting login for:', email);
    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });

    if (!admin) {
      return res.status(401).json({ message: "Email not found" });
    }

    if (!admin.isActive) {
      return res.status(403).json({ message: "Account is deactivated. Contact your administrator." });
    }

    

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Password is incorrect" });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    const token = generateToken(admin._id);

    // Resolve permissions
    // const permissions =
    //   admin.permissions && admin.permissions.length > 0
    //     ? admin.permissions
    //     : Admin.getDefaultPermissions(admin.role);
    const permissions = await resolvePermissions(admin);

    res.json({
      message: "Login successful",
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions,
        avatar: admin.avatar,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Get current admin profile ─────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const admin = req.admin;
    // const permissions =
    //   admin.permissions && admin.permissions.length > 0
    //     ? admin.permissions
    //     : Admin.getDefaultPermissions(admin.role);
    const permissions = await resolvePermissions(admin);

    res.json({
      id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      permissions,
      avatar: admin.avatar,
      lastLogin: admin.lastLogin,
      createdAt: admin.createdAt,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Get all admins/users ──────────────────────────────────────────────────────
exports.getAdmins = async (req, res) => {
  try {
    const admins = await Admin.find()
      .select("-password")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });


      const result = await Promise.all(
  admins.map(async (a) => {
    const permissions = await resolvePermissions(a);

    return {
      id: a._id,
      name: a.name,
      email: a.email,
      role: a.role,
      isActive: a.isActive,
      lastLogin: a.lastLogin,
      avatar: a.avatar,
      createdAt: a.createdAt,
      createdBy: a.createdBy,
      permissions,
    };
  })
);

    // const result = admins.map((a) => ({
    //   id: a._id,
    //   name: a.name,
    //   email: a.email,
    //   role: a.role,
    //   isActive: a.isActive,
    //   lastLogin: a.lastLogin,
    //   avatar: a.avatar,
    //   createdAt: a.createdAt,
    //   createdBy: a.createdBy,
    //   permissions:
    //     a.permissions && a.permissions.length > 0
    //       ? a.permissions
    //       : Admin.getDefaultPermissions(a.role),
    // }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Create a new user ─────────────────────────────────────────────────────────
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, permissions } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "Name, email, password, and role are required" });
    }

    const existing = await Admin.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new Admin({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      permissions: permissions || [],
      createdBy: req.admin._id,
    });

    await newUser.save();

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Update a user ─────────────────────────────────────────────────────────────
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, permissions, isActive, password } = req.body;

    const user = await Admin.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Prevent non-superadmin from editing superadmin
    if (user.role === "superadmin" && req.admin.role !== "superadmin") {
      return res.status(403).json({ message: "Cannot edit a superadmin" });
    }

    if (name) user.name = name;
    if (email) user.email = email.toLowerCase();
    if (role && role !== user.role) {
  user.role = role;

  // clear old custom permissions
  user.permissions = [];
}
    // role changed → reset custom permissions
if (role && role !== user.role) {
  user.role = role;

  // ignore old frontend permissions
  user.permissions = [];
} else if (permissions !== undefined) {
  // only update custom permissions if role not changed
  user.permissions = permissions;
}
    if (isActive !== undefined) user.isActive = isActive;
    if (password) user.password = await bcrypt.hash(password, 10);

    await user.save();

    res.json({ message: "User updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Delete a user ─────────────────────────────────────────────────────────────
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.admin._id.toString()) {
      return res.status(400).json({ message: "Cannot delete yourself" });
    }

    const user = await Admin.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "superadmin" && req.admin.role !== "superadmin") {
      return res.status(403).json({ message: "Cannot delete a superadmin" });
    }

    await Admin.findByIdAndDelete(id);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Get all permission definitions ───────────────────────────────────────────
exports.getPermissions = async (req, res) => {
  try {
    const { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } = require("../models/Admin");
    res.json({ permissions: ALL_PERMISSIONS, roleDefaults: DEFAULT_ROLE_PERMISSIONS });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};



// const Admin = require("../models/Admin");
// const bcrypt = require("bcryptjs");
// const generateToken = require("../utils/generateToken");

// exports.loginAdmin = async (req, res) => {
//   try {
//     console.log('Admin found:', req.body.email);
//     const { email, password } = req.body;

//     if (!email || !password) {
//       return res.status(400).json({
//         message: "Email and password required",
//       });
//     }

//     const admin = await Admin.findOne({ email });

//     if (!admin) {
//       return res.status(401).json({
//         message: "Email not found",
//       });
//     }
//    console.log('Admin found:', admin);
//     const isMatch = await bcrypt.compare(password, admin.password);

//     if (!isMatch) {
//       return res.status(401).json({
//         message: "Password is incorrect",
//       });
//     }

//     const token = generateToken(admin._id);

//     res.json({
//       message: "Login successful",
//       token,
//       admin: {
//         id: admin._id,
//         name: admin.name,
//         email: admin.email,
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       message: "Server error",
//     });
//   }
// };

// exports.getAdmins = async (req, res) => {
//   try {
//     const admins = await Admin.find().select("-password");
//     res.json(admins);
//   } catch (error) {
//     res.status(500).json({ message: "Server error" });
//   }
// };
