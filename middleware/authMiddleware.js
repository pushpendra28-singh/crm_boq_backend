const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Role = require("../models/Role");

// ─── Authenticate token ────────────────────────────────────────────────────────
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id).select("-password");

    if (!admin) {
      return res.status(401).json({ message: "User not found" });
    }

    if (!admin.isActive) {
      return res.status(403).json({ message: "Account is deactivated" });
    }

    req.admin = admin;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized, token invalid" });
  }
};

// ─── Require specific role(s) ──────────────────────────────────────────────────
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({
        message: `Access denied. Required role(s): ${roles.join(", ")}`,
      });
    }
    next();
  };
};


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

// ─── Require specific permission(s) ───────────────────────────────────────────
const requirePermission = (...permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.admin) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // superadmin bypass
      if (req.admin.role === "superadmin") {
        return next();
      }

      const adminPerms = await resolvePermissions(req.admin);

      const hasAll = permissions.every((p) =>
        adminPerms.includes(p)
      );

      if (!hasAll) {
        return res.status(403).json({
          message: `Access denied. Missing permission(s): ${permissions
            .filter((p) => !adminPerms.includes(p))
            .join(", ")}`,
        });
      }

      next();
    } catch (error) {
      console.error("Permission middleware error:", error);
      res.status(500).json({ message: "Permission check failed" });
    }
  };
};
// const requirePermission = (...permissions) => {
//   return (req, res, next) => {
//     if (!req.admin) {
//       return res.status(401).json({ message: "Not authenticated" });
//     }

//     const adminPerms =
//       req.admin.permissions && req.admin.permissions.length > 0
//         ? req.admin.permissions
//         : Admin.getDefaultPermissions(req.admin.role);

//     // Superadmin bypasses all permission checks
//     if (req.admin.role === "superadmin") return next();

//     const hasAll = permissions.every((p) => adminPerms.includes(p));
//     if (!hasAll) {
//       return res.status(403).json({
//         message: `Access denied. Missing permission(s): ${permissions.filter(p => !adminPerms.includes(p)).join(", ")}`,
//       });
//     }
//     next();
//   };
// };

// ─── Require any one of given permissions ─────────────────────────────────────
// const requireAnyPermission = (...permissions) => {
//   return (req, res, next) => {
//     if (!req.admin) {
//       return res.status(401).json({ message: "Not authenticated" });
//     }

//     if (req.admin.role === "superadmin") return next();

//     const adminPerms =
//       req.admin.permissions && req.admin.permissions.length > 0
//         ? req.admin.permissions
//         : Admin.getDefaultPermissions(req.admin.role);

//     const hasAny = permissions.some((p) => adminPerms.includes(p));
//     if (!hasAny) {
//       return res.status(403).json({ message: "Access denied. Insufficient permissions." });
//     }
//     next();
//   };
// };
const requireAnyPermission = (...permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.admin) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (req.admin.role === "superadmin") {
        return next();
      }

      const adminPerms = await resolvePermissions(req.admin);

      const hasAny = permissions.some((p) =>
        adminPerms.includes(p)
      );

      if (!hasAny) {
        return res.status(403).json({
          message: "Access denied. Insufficient permissions.",
        });
      }

      next();
    } catch (error) {
      console.error("Permission middleware error:", error);
      res.status(500).json({ message: "Permission check failed" });
    }
  };
};

module.exports = { protect, requireRole, requirePermission, requireAnyPermission };



// const jwt = require("jsonwebtoken");
// const Admin = require("../models/Admin");

// const protect = async (req, res, next) => {
//   let token;

//   if (req.headers.authorization) {
//     token = req.headers.authorization.split(" ")[1];

//     try {
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);

//       req.admin = await Admin.findById(decoded.id).select("-password");

//       next();
//     } catch (error) {
//       res.status(401).json({ message: "Not authorized" });
//     }
//   }

//   if (!token) {
//     res.status(401).json({
//       message: "Token missing",
//     });
//   }
// };

// module.exports = protect;