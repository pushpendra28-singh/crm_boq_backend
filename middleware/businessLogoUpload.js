const multer = require("multer");


const ALLOWED_LOGO_MIME_TYPES =
  new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);


const MAX_LOGO_SIZE =
  2 * 1024 * 1024; // 2 MB


/*
 * Memory storage intentionally use kar rahe hain.
 *
 * File disk par save karne se pehle actual
 * image signature validate hogi.
 */
const uploader =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      fileSize:
        MAX_LOGO_SIZE,

      files: 1,
    },

    fileFilter:
      (
        req,
        file,
        callback
      ) => {
        if (
          !ALLOWED_LOGO_MIME_TYPES.has(
            file.mimetype
          )
        ) {
          return callback(
            new Error(
              "Only JPG, PNG and WebP logo files are allowed."
            )
          );
        }

        callback(
          null,
          true
        );
      },
  }).single("logo");


/*
 * Multer errors ko centralized JSON response
 * me convert karta hai.
 */
const uploadBusinessLogo =
  (
    req,
    res,
    next
  ) => {
    uploader(
      req,
      res,
      (error) => {
        if (!error) {
          return next();
        }


        if (
          error instanceof
            multer.MulterError
        ) {
          if (
            error.code ===
            "LIMIT_FILE_SIZE"
          ) {
            return res
              .status(413)
              .json({
                message:
                  "Business logo cannot exceed 2 MB.",

                code:
                  "BUSINESS_LOGO_TOO_LARGE",
              });
          }


          return res
            .status(400)
            .json({
              message:
                "Unable to upload business logo.",

              code:
                "BUSINESS_LOGO_UPLOAD_ERROR",
            });
        }


        return res
          .status(400)
          .json({
            message:
              error.message ||
              "Invalid business logo.",

            code:
              "INVALID_BUSINESS_LOGO",
          });
      }
    );
  };


module.exports = {
  uploadBusinessLogo,
};