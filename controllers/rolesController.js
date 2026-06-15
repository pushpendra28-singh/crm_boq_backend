const Role = require("../models/Role");
const Admin = require("../models/Admin");

// ─── Get all roles ─────────────────────────────────────────────────────────────
exports.getRoles = async (req, res) => {
  try {
    const { ALL_PERMISSIONS } = require("../models/Admin");

    const roles = await Role.find()
      .populate("createdBy", "name email")
      .sort({ createdAt: 1 });

    res.json({
      roles,          // ← single flat array, no system/custom split
      allPermissions: ALL_PERMISSIONS,
    });
  } catch (error) {
    console.error("Get roles error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Create role ───────────────────────────────────────────────────────────────
exports.createRole = async (req, res) => {
  try {
    const { name, description, permissions, color } = req.body;

    if (!name || !permissions || permissions.length === 0) {
      return res.status(400).json({ message: "Name and permissions are required" });
    }

    const slug = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

    const existing = await Role.findOne({ slug });
    if (existing) {
      return res.status(409).json({ message: "A role with this name already exists" });
    }

    const role = new Role({
      name,
      slug,
      description: description || "",
      permissions,
      color: color || "#6366f1",
      createdBy: req.admin._id,
    });

    await role.save();
    res.status(201).json({ message: "Role created successfully", role });
  } catch (error) {
    console.error("Create role error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Update role ───────────────────────────────────────────────────────────────
exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, permissions, color } = req.body;

    const role = await Role.findById(id);
    if (!role) return res.status(404).json({ message: "Role not found" });

    if (name) {
      role.name = name;
      role.slug = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    }
    if (description !== undefined) role.description = description;
    if (permissions && permissions.length > 0) role.permissions = permissions;
    if (color) role.color = color;

    await role.save();
    res.json({ message: "Role updated successfully", role });
  } catch (error) {
    console.error("Update role error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Delete role ───────────────────────────────────────────────────────────────
exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    const role = await Role.findById(id);
    if (!role) return res.status(404).json({ message: "Role not found" });

    const usersWithRole = await Admin.countDocuments({ role: role.slug });
    if (usersWithRole > 0) {
      return res.status(400).json({
        message: `Cannot delete role. ${usersWithRole} user(s) are assigned this role.`,
      });
    }

    await Role.findByIdAndDelete(id);
    res.json({ message: "Role deleted successfully" });
  } catch (error) {
    console.error("Delete role error:", error);
    res.status(500).json({ message: "Server error" });
  }
};