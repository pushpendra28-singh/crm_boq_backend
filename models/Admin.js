const mongoose = require("mongoose");

// ─── Permission definitions ───────────────────────────────────────────────────
const ALL_PERMISSIONS = [
  // Dashboard
  "view_dashboard",
  // Leads
  "view_leads", "create_leads", "edit_leads", "delete_leads", "export_leads",
  // Contacts
  "view_contacts", "create_contacts", "edit_contacts", "delete_contacts",
  // Newsletter
  "view_newsletters", "delete_newsletters", "export_newsletters",
  // Comments
  "view_comments", "delete_comments",
  // Users & Roles
  "view_users", "create_users", "edit_users", "delete_users",
  "view_roles", "create_roles", "edit_roles", "delete_roles",
  // Settings
  "view_settings", "edit_settings",
  // Analytics
  "view_analytics",
  // Projects
  "view_projects", "create_projects", "edit_projects", "delete_projects",
  // Assigned Projects  (personal "my projects" module)
  "view_assigned_projects", "edit_assigned_projects", "delete_assigned_projects",

   // Assigned Projects  (personal "my projects" module)
  "view_assigned_leads", "edit_assigned_leads", "delete_assigned_leads",
];

// const formatPermissions = (permissions) => {
//   return permissions.map((perm) => {
//     const [action, ...rest] = perm.split("_");
//     const group = rest[0];

//     return {
//       key: perm,
//       label: `${action.charAt(0).toUpperCase() + action.slice(1)} ${rest.join(" ")}`,
//       group: group.charAt(0).toUpperCase() + group.slice(1),
//     };
//   });
// };



/*
 * formatPermissions
 * ─────────────────
 * Converts a flat permission string into { key, label, group }.
 *
 * Rule:  first token  = action  (view / create / edit / delete / export)
 *        remaining    = resource words
 *        group        = ALL resource words title-cased and joined with space
 *
 * Examples
 *   "view_leads"              →  group "Leads"
 *   "view_projects"           →  group "Projects"
 *   "view_assigned_projects"  →  group "Assigned Projects"   ← FIXED
 *   "edit_assigned_projects"  →  group "Assigned Projects"
 *   "delete_assigned_projects"→  group "Assigned Projects"
 *
 * Previous bug: used only rest[0] as group, so "view_assigned_projects"
 * produced group "Assigned" instead of "Assigned Projects", which meant
 * the three assigned-project permissions each landed in a separate
 * single-item group ("Assigned", "Assigned", "Assigned") that looked
 * identical and confused the ViewRoles permission picker.
 */
const formatPermissions = (permissions) => {
  return permissions.map((perm) => {
    const parts     = perm.split("_");          // ["view","assigned","projects"]
    const action    = parts[0];                 // "view"
    const restParts = parts.slice(1);           // ["assigned","projects"]
 
    // label  →  "View assigned projects"
    const label = `${action.charAt(0).toUpperCase() + action.slice(1)} ${restParts.join(" ")}`;
 
    // group  →  ALL resource words title-cased  →  "Assigned Projects"
    const group = restParts
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
 
    return { key: perm, label, group };
  });
};
// ─── Default role → permissions map ──────────────────────────────────────────
const DEFAULT_ROLE_PERMISSIONS = {
  superadmin: ALL_PERMISSIONS,
  admin: [
    "view_dashboard",
    "view_leads", "create_leads", "edit_leads", "delete_leads", "export_leads",
    "view_contacts", "create_contacts", "edit_contacts", "delete_contacts",
    "view_newsletters", "delete_newsletters", "export_newsletters",
    "view_comments", "delete_comments",
    "view_users", "create_users", "edit_users",
    "view_roles",
    "view_settings",
    "view_analytics",
    "view_projects", "create_projects", "edit_projects",
    "view_assigned_projects", "edit_assigned_projects", 
    "view_assigned_leads", "edit_assigned_leads",
  ],
  manager: [
    "view_dashboard",
    "view_leads", "create_leads", "edit_leads", "export_leads",
    "view_contacts", "create_contacts", "edit_contacts",
    "view_newsletters",
    "view_comments",
    "view_users",
    "view_analytics",
    "view_projects", "create_projects", "edit_projects",
    "view_assigned_projects", "edit_assigned_projects",
      "view_assigned_leads", "edit_assigned_leads",
  ],
  hr: [
    "view_dashboard",
    "view_users", "create_users", "edit_users",
    "view_settings",
    "view_analytics",
  ],
  sales: [
    "view_dashboard",
    "view_leads", "create_leads", "edit_leads",
    "view_contacts", "create_contacts",
    "view_newsletters",
    "view_analytics",
  ],
  project_manager: [
    "view_dashboard",
    "view_projects", "create_projects", "edit_projects", "delete_projects",
    "view_leads",
    "view_users",
    "view_analytics",
     "view_assigned_projects", "edit_assigned_projects", "delete_assigned_projects",
     "view_assigned_leads", "edit_assigned_leads", "delete_assigned_leads",
  ],
  employee: [
    "view_dashboard",
    "view_leads",
    "view_projects",
    "view_assigned_projects",
    "view_assigned_leads",
  ],
};

// ─── Admin Schema ─────────────────────────────────────────────────────────────
const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
   role: {
  type: String,
  required: true,
  default: "employee",
},
    // For custom roles or overrides — null means "use role defaults"
    permissions: {
      type: [String],
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    avatar: {
      type: String,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

// ─── Virtual: resolved permissions ────────────────────────────────────────────
adminSchema.virtual("resolvedPermissions").get(function () {
  if (this.permissions && this.permissions.length > 0) return this.permissions;
  return DEFAULT_ROLE_PERMISSIONS[this.role] || [];
});

// ─── Method: check permission ──────────────────────────────────────────────────
adminSchema.methods.hasPermission = async function (permission) {
  if (this.permissions && this.permissions.length > 0) {
    return this.permissions.includes(permission);
  }

  const Role = require("./Role");
  const role = await Role.findOne({ slug: this.role });

  if (!role) return false;

  return role.permissions.includes(permission);
};

// ─── Static: get all permission definitions ────────────────────────────────────
adminSchema.statics.getAllPermissions = function () {
 return ALL_PERMISSIONS;
};


adminSchema.statics.getDefaultPermissions = function (role) {
  return DEFAULT_ROLE_PERMISSIONS[role] || [];
};

module.exports = mongoose.model("Admin", adminSchema);
module.exports.ALL_PERMISSIONS = formatPermissions(ALL_PERMISSIONS);
module.exports.DEFAULT_ROLE_PERMISSIONS = DEFAULT_ROLE_PERMISSIONS;



// const mongoose = require("mongoose");

// const adminSchema = new mongoose.Schema(
//   {
//     name: String,

//     email: {
//       type: String,
//       required: true,
//       unique: true,
//     },

//     password: {
//       type: String,
//       required: true,
//     },
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("Admin", adminSchema);