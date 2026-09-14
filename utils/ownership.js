const isSuperAdmin = (req) => {
  return req.admin?.role === "superadmin";
};


/*
  List, search, count, reports etc.

  Normal User:
  { ownerId: userId }

  Superadmin:
  {}
*/
const getOwnershipFilter = (req) => {
  if (isSuperAdmin(req)) {
    return {};
  }

  return {
    ownerId: req.ownerId,
  };
};


/*
  Single resource ke liye.

  Normal user:
  {
    _id: resourceId,
    ownerId: userId
  }

  Superadmin:
  {
    _id: resourceId
  }
*/
const getOwnedResourceFilter = (
  req,
  resourceId
) => {
  return {
    _id: resourceId,
    ...getOwnershipFilter(req),
  };
};


module.exports = {
  isSuperAdmin,
  getOwnershipFilter,
  getOwnedResourceFilter,
};