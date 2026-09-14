const attachOwner = (req, res, next) => {
  /*
    protect middleware isse pehle run hona chahiye.

    protect successful hone ke baad:
    req.admin = logged-in user
  */

  if (!req.admin || !req.admin._id) {
    return res.status(401).json({
      message: "Authenticated user not found",
    });
  }

  /*
    Current authenticated user hi
    is request ka data owner hai.
  */

  req.ownerId = req.admin._id;

  next();
};

module.exports = {
  attachOwner,
};