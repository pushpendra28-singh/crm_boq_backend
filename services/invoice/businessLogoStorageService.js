const path =
  require("path");

const fs =
  require("fs");

const crypto =
  require("crypto");


const BUSINESS_LOGO_DIR =
  path.resolve(
    __dirname,
    "..",
    "uploads",
    "business-logos"
  );


/*
 * Client supplied extension par trust nahi karenge.
 *
 * Actual file bytes se image type detect hogi.
 */
const detectImageExtension =
  (buffer) => {
    if (
      !Buffer.isBuffer(
        buffer
      ) ||
      buffer.length < 12
    ) {
      return null;
    }


    /* PNG */

    const pngSignature =
      Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ]);

    if (
      buffer
        .subarray(0, 8)
        .equals(
          pngSignature
        )
    ) {
      return "png";
    }


    /* JPEG */

    if (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return "jpg";
    }


    /* WebP */

    const riff =
      buffer
        .subarray(0, 4)
        .toString("ascii");

    const webp =
      buffer
        .subarray(8, 12)
        .toString("ascii");


    if (
      riff === "RIFF" &&
      webp === "WEBP"
    ) {
      return "webp";
    }


    return null;
  };


/*
 * Business logo filenames hum khud generate
 * karte hain.
 *
 * User supplied original filename use nahi hota.
 */
const createLogoFilename =
  (
    ownerId,
    extension
  ) => {
    const safeOwnerId =
      String(ownerId);

    const uniqueId =
      crypto.randomUUID();

    return (
      `${safeOwnerId}-` +
      `${Date.now()}-` +
      `${uniqueId}.` +
      `${extension}`
    );
  };


const saveBusinessLogo =
  async ({
    ownerId,
    buffer,
  }) => {
    const extension =
      detectImageExtension(
        buffer
      );


    if (!extension) {
      const error =
        new Error(
          "Uploaded file is not a valid JPG, PNG or WebP image."
        );

      error.code =
        "INVALID_IMAGE_SIGNATURE";

      throw error;
    }


    await fs.promises.mkdir(
      BUSINESS_LOGO_DIR,
      {
        recursive: true,
      }
    );


    const filename =
      createLogoFilename(
        ownerId,
        extension
      );


    const absolutePath =
      path.join(
        BUSINESS_LOGO_DIR,
        filename
      );


    await fs.promises.writeFile(
      absolutePath,
      buffer,
      {
        flag: "wx",
      }
    );


    /*
     * Static /uploads config par depend nahi karenge.
     *
     * Dedicated public business-logo endpoint
     * se image serve hogi.
     */
    const logoUrl =
      `/api/business-profile/logo/${filename}`;


    return {
      filename,
      absolutePath,
      logoUrl,
    };
  };


/*
 * DB update fail hone par newly-created
 * unused file cleanup ke liye.
 */
const deleteBusinessLogoFile =
  async (
    absolutePath
  ) => {
    if (!absolutePath) {
      return;
    }


    try {
      await fs.promises.unlink(
        absolutePath
      );
    } catch (error) {
      if (
        error.code !==
        "ENOENT"
      ) {
        console.error(
          "Business logo cleanup error:",
          error
        );
      }
    }
  };


const isSafeLogoFilename =
  (filename) => {
    return (
      typeof filename ===
        "string" &&
      /^[a-fA-F0-9]{24}-[0-9]+-[a-fA-F0-9-]+\.(jpg|png|webp)$/.test(
        filename
      )
    );
  };


module.exports = {
  BUSINESS_LOGO_DIR,
  saveBusinessLogo,
  deleteBusinessLogoFile,
  isSafeLogoFilename,
};