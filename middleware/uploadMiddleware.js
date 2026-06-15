/**
 * uploadMiddleware.js
 * Handles multer file upload configuration, MIME validation,
 * size limits, and filename sanitization.
 */

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ── Constants ─────────────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, "../uploads");
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Allowed MIME types mapped to extensions
const ALLOWED_MIME_TYPES = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/plain": ".txt",
};

// ── Ensure upload directory exists ────────────────────────────────────────────

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Storage engine ────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // Sanitize: strip path components and dangerous characters
    const ext = ALLOWED_MIME_TYPES[file.mimetype] || path.extname(file.originalname).toLowerCase();
    const safeName = crypto.randomBytes(16).toString("hex") + ext;
    cb(null, safeName);
  },
});

// ── MIME type filter ──────────────────────────────────────────────────────────

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        `Unsupported file type: ${file.mimetype}. Allowed: PDF, DOC, DOCX, TXT`
      ),
      false
    );
  }
};

// ── Multer instance ───────────────────────────────────────────────────────────

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1, // One file per upload request
  },
});

// ── Error handler middleware ──────────────────────────────────────────────────

/**
 * Wraps multer single-file upload and normalizes errors to JSON responses.
 * Usage: router.post("/upload/:id", handleSingleUpload("document"), controller)
 */
const handleSingleUpload = (fieldName = "document") => {
  return (req, res, next) => {
    const handler = upload.single(fieldName);

    handler(req, res, (err) => {
      if (!err) return next();

      // Multer-specific errors
      if (err instanceof multer.MulterError) {
        let message = "File upload error";
        if (err.code === "LIMIT_FILE_SIZE") {
          message = `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB`;
        } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
          message = err.message || "Unsupported file type";
        } else if (err.code === "LIMIT_FILE_COUNT") {
          message = "Only one file allowed per upload";
        }
        return res.status(400).json({ success: false, message });
      }

      // Generic errors
      return res.status(400).json({
        success: false,
        message: err.message || "File upload failed",
      });
    });
  };
};

// ── Cleanup helper ────────────────────────────────────────────────────────────

/**
 * Deletes a file from disk (for cleanup on error or when session is abandoned).
 */
const deleteUploadedFile = (filename) => {
  try {
    const filePath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error("[uploadMiddleware] Failed to delete file:", filename, err.message);
  }
};

module.exports = {
  handleSingleUpload,
  deleteUploadedFile,
  UPLOAD_DIR,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_MB,
};