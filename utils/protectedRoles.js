// utils/protectedRoles.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for "who is a Super Admin" and "who may touch whom".
// Every controller must use these helpers instead of comparing role strings.
// ─────────────────────────────────────────────────────────────────────────────
const Role = require("../models/Role");

const SUPERADMIN_SLUG = "superadmin";

const normalize = (value) => String(value || "").trim().toLowerCase();

/** true if the given role slug / name is the protected Super Admin role */
const isSuperAdminRole = (roleValue) => {
  const v = normalize(roleValue).replace(/[\s_-]+/g, "");
  return v === SUPERADMIN_SLUG;
};

/** true if the given Admin document (or { role }) is a Super Admin */
const isSuperAdmin = (admin) => isSuperAdminRole(admin?.role);

/**
 * Can `actor` modify (edit / delete / (de)activate / reset password of) `target`?
 *  - nobody except a Super Admin may touch a Super Admin
 *  - everyone else is governed by normal permissions (checked in the route)
 */
const canManageUser = (actor, target) => {
  if (!actor || !target) return false;
  if (isSuperAdmin(target)) return isSuperAdmin(actor);
  return true;
};

/**
 * Validate a role value coming from a request body and return the canonical
 * slug stored in the Role collection.
 *  - role must exist in DB (no free-text roles)
 *  - only a Super Admin may assign the Super Admin role
 * Returns { slug } on success, { status, message } on failure.
 */
const resolveAssignableRole = async (actor, requestedRole) => {
  const wanted = normalize(requestedRole);
  if (!wanted) return { status: 400, message: "Role is required" };

  const roleDoc = await Role.findOne({
    $or: [{ slug: wanted }, { name: new RegExp(`^${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }],
  });

  if (!roleDoc) return { status: 400, message: "Selected role does not exist" };

  if (isSuperAdminRole(roleDoc.slug) && !isSuperAdmin(actor)) {
    return { status: 403, message: "Only a Super Admin can assign the Super Admin role" };
  }

  return { slug: roleDoc.slug };
};

/** true if both documents are the same Admin record */
const isSameUser = (a, b) =>
  !!a && !!b && String(a._id || a.id) === String(b._id || b.id);

/**
 * Role NAME reserved for the system Super Admin role.
 * Checks the raw name AND the slug createRole/updateRole would derive from it
 * ("Super Admin" -> "super_admin", "Super@Admin" -> "superadmin").
 */
const toRoleSlug = (name) =>
  String(name || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
const isReservedRoleName = (name) =>
  isSuperAdminRole(name) || isSuperAdminRole(toRoleSlug(name));

const SUPERADMIN_PROTECTED_MESSAGE =
  "Super Admin is a protected account. Only a Super Admin can modify it.";

module.exports = {
  SUPERADMIN_SLUG,
  isSuperAdminRole,
  isSuperAdmin,
  canManageUser,
  isSameUser,
  isReservedRoleName,
  resolveAssignableRole,
  SUPERADMIN_PROTECTED_MESSAGE,
};