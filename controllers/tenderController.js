const Tender = require("../models/Tender");
const tenderAI = require("../services/tender/TenderAIService");
const path = require("path");
const { extractText } = require("../services/tender/fileExtractor");
const Admin = require("../models/Admin");
const { generateBOQExcel } = require("../services/tender/generateBOQExcel");
const { sendVendorProposalEmail } = require("../utils/mailer");

/* ═══════════════════════════════════════════════════════════════
   GENERAL HELPERS
═══════════════════════════════════════════════════════════════ */

/**
 * Safely parse a generated proposal when it is structured JSON.
 *
 * Current production target:
 * generatedProposal is stored as a JSON string so the existing
 * Tender model/controller string-based flow does not need to change.
 *
 * Legacy Markdown proposals are also supported.
 */
const parseProposalJSON = (proposal) => {
  if (!proposal) {
    return null;
  }

  if (
    typeof proposal === "object" &&
    !Buffer.isBuffer(proposal)
  ) {
    return proposal;
  }

  if (typeof proposal !== "string") {
    return null;
  }

  const trimmed = proposal.trim();

  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (
    !cleaned.startsWith("{") &&
    !cleaned.startsWith("[")
  ) {
    return null;
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
};


/**
 * Extract project title from either:
 *
 * 1. New structured JSON proposal
 * 2. Legacy Markdown proposal
 *
 * This keeps old saved tenders downloadable and usable.
 */
const extractTitleFromBOQ = (proposal) => {
  if (!proposal) {
    return null;
  }

  const parsed = parseProposalJSON(proposal);

  if (parsed) {
    const structuredTitle =
      parsed?.document?.title ||
      parsed?.title ||
      null;

    if (
      typeof structuredTitle === "string" &&
      structuredTitle.trim()
    ) {
      return structuredTitle
        .trim()
        .slice(0, 100);
    }
  }

  if (typeof proposal !== "string") {
    return null;
  }

  /*
   * Legacy Markdown compatibility.
   */
  const match = proposal.match(
    /project\s+title[:\s*]+([^\n\r]+)/i
  );

  if (match?.[1]) {
    return match[1]
      .replace(/\*\*/g, "")
      .replace(/^[-:]\s*/, "")
      .trim()
      .slice(0, 100);
  }

  return null;
};


/**
 * Produce a safe downloadable filename.
 */
const createSafeFileTitle = (
  title,
  fallback = "BOQ"
) => {
  const safe = String(
    title || fallback
  )
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60);

  return safe || fallback;
};


/**
 * Normalise a message before it is stored/sent.
 */
const cleanMessage = (value) => {
  return typeof value === "string"
    ? value.trim()
    : "";
};


/**
 * Generate a useful title fallback from the first
 * user requirement if AI structured title is unavailable.
 */
const createConversationFallbackTitle = (
  conversationHistory
) => {
  if (!Array.isArray(conversationHistory)) {
    return "Untitled BOQ";
  }

  const firstUserMsg =
    conversationHistory.find(
      (message) =>
        message?.role === "user" &&
        typeof message.content === "string" &&
        message.content.trim()
    );

  if (!firstUserMsg) {
    return "Untitled BOQ";
  }

  return firstUserMsg.content
    .trim()
    .slice(0, 100);
};


/**
 * Keep generatedProposal persisted as a string.
 *
 * The new TenderAIService currently returns JSON.stringify(boq),
 * but this helper also protects us if it later returns an object.
 */
const serializeProposal = (proposal) => {
  if (typeof proposal === "string") {
    return proposal;
  }

  if (
    proposal &&
    typeof proposal === "object"
  ) {
    return JSON.stringify(proposal);
  }

  return "";
};


/* ═══════════════════════════════════════════════════════════════
   POST /api/tender/start
═══════════════════════════════════════════════════════════════ */

const startTender = async (req, res) => {
  try {
    /*
     * IMPORTANT:
     * No domain-specific examples here.
     *
     * User can describe ANY project/outcome and the AI service
     * will determine what information is relevant.
     */
    const firstQuestion =
      "Let's get started! 🚀 Describe what you want to create, set up, build, procure, implement, upgrade, renovate, organize, or deliver. Include whatever details you already know — the system will analyse your requirement and guide you from there.";

    const tender = await Tender.create({
      createdBy:
        req.admin?._id || null,

      conversationHistory: [],

      status:
        "in_progress",
    });


    return res.json({
  success: true,

  tenderId:
    tender._id,

  message:
    firstQuestion,

  isReady: false,

  inputType: "text",

  options: [],

  allowCustomInput: true,

  selectionMin: 0,

  selectionMax: 0,
});
    // return res.json({
    //   success: true,

    //   tenderId:
    //     tender._id,

    //   message:
    //     firstQuestion,
    // });
  } catch (err) {
    console.error(
      "startTender error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to start session.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   POST /api/tender/:id/message
═══════════════════════════════════════════════════════════════ */

const sendMessage = async (req, res) => {
  try {
    const { id } = req.params;

    const message =
      cleanMessage(
        req.body?.message
      );

    if (!message) {
      return res.status(400).json({
        success: false,

        error:
          "Message is required.",
      });
    }

    const tender =
      await Tender.findById(id);

    if (!tender) {
      return res.status(404).json({
        success: false,

        error:
          "Tender not found.",
      });
    }

    if (
      tender.status !== "in_progress"
    ) {
      return res.status(400).json({
        success: false,

        error:
          "This tender is already completed.",
      });
    }

    /*
     * Universal requirement-analysis service.
     *
     * No construction/project category logic lives here.
     */
    const {
  aiMessage,
  isReady,
  inputType,
  options,
  allowCustomInput,
  selectionMin,
  selectionMax,
} = await tenderAI.chat(
  tender.conversationHistory || [],
  message
);
    // const {
    //   aiMessage,
    //   isReady,
    // } = await tenderAI.chat(
    //   tender.conversationHistory || [],
    //   message
    // );

    const assistantMessage =
      cleanMessage(aiMessage) ||
      "Understood. Let me proceed.";

    /*
     * Preserve the complete conversation.
     */
    tender.conversationHistory.push(
      {
        role: "user",
        content: message,
      },
      {
        role: "assistant",
        content: assistantMessage,
      }
    );

    /*
     * When AI confirms enough information exists,
     * generate the universal structured BOQ.
     */
    if (isReady) {
      const generatedProposal =
        await tenderAI.generateProposal(
          tender.conversationHistory
        );

      const serializedProposal =
        serializeProposal(
          generatedProposal
        );

      if (!serializedProposal) {
        throw new Error(
          "AI returned an empty generated proposal."
        );
      }

      /*
       * Prefer AI-generated project title.
       *
       * Fallback:
       * first user message.
       */
      const aiTitle =
        extractTitleFromBOQ(
          serializedProposal
        );

      tender.title =
        aiTitle ||
        createConversationFallbackTitle(
          tender.conversationHistory
        );

      tender.generatedProposal =
        serializedProposal;

      tender.status =
        "draft";

      await tender.save();


      return res.json({
  success: true,
  message: assistantMessage,
  isReady: true,

  inputType: "none",
  options: [],
  allowCustomInput: false,
  selectionMin: 0,
  selectionMax: 0,

  proposal: serializedProposal,
  tenderId: tender._id,
});
      // return res.json({
      //   success: true,

      //   message:
      //     assistantMessage,

      //   isReady:
      //     true,

      //   proposal:
      //     serializedProposal,

      //   tenderId:
      //     tender._id,
      // });
    }

    /*
     * Requirements are not complete yet.
     */
    await tender.save();


    return res.json({
  success: true,
  message: assistantMessage,
  isReady: false,

  inputType: inputType || "text",
  options: Array.isArray(options) ? options : [],
  allowCustomInput: Boolean(allowCustomInput),

  selectionMin:
    Number.isInteger(selectionMin)
      ? selectionMin
      : 0,

  selectionMax:
    Number.isInteger(selectionMax)
      ? selectionMax
      : 0,
});
    // return res.json({
    //   success: true,

    //   message:
    //     assistantMessage,

    //   isReady:
    //     false,
    // });
  } catch (err) {
    console.error(
      "sendMessage error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "AI service error. Please try again.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   POST /api/tender/from-doc
═══════════════════════════════════════════════════════════════ */

const createFromDoc = async (
  req,
  res
) => {
  try {
    const prompt =
      cleanMessage(
        req.body?.prompt
      );

    const docFileName =
      req.file?.originalname ||
      null;

    const docFilePath =
      req.file?.path ||
      null;

    let docText = "";

    /*
     * Extract plain text from the uploaded file.
     *
     * fileExtractor remains responsible only
     * for file -> text conversion.
     */
    if (
      docFilePath &&
      docFileName
    ) {
      const {
        text,
        error,
      } = await extractText(
        docFilePath,
        docFileName
      );

      if (error) {
        console.warn(
          "File extraction warning:",
          error
        );
      }

      docText =
        typeof text === "string"
          ? text
          : "";
    }

    const hasPrompt =
      prompt.length > 0;

    /*
     * Do not require an arbitrary 50-character minimum.
     *
     * A short extracted requirement can still be valid.
     */
    const hasDocText =
      docText.trim().length > 0;

    if (
      !hasPrompt &&
      !hasDocText
    ) {
      return res
        .status(400)
        .json({
          success: false,

          error:
            "Please provide a description or upload a readable document (PDF/DOCX/TXT).",
        });
    }

    /*
     * Universal document/prompt BOQ generation.
     *
     * Large-document chunking and project analysis
     * are handled inside TenderAIService.
     */
    const generatedProposal =
      await tenderAI
        .generateProposalFromPrompt(
          prompt,

          docFileName ||
            "uploaded-document",

          docText
        );

    const serializedProposal =
      serializeProposal(
        generatedProposal
      );

    if (!serializedProposal) {
      throw new Error(
        "AI returned an empty generated proposal."
      );
    }

    /*
     * Prefer generated structured title.
     */
    const extractedTitle =
      extractTitleFromBOQ(
        serializedProposal
      ) ||
      (
        docFileName
          ? path.basename(
              docFileName,
              path.extname(
                docFileName
              )
            )
          : null
      ) ||
      (
        prompt
          ? prompt.slice(
              0,
              100
            )
          : null
      ) ||
      "Project Requirements";

    const tender =
      await Tender.create({
        title:
          extractedTitle.slice(
            0,
            100
          ),

        generatedProposal:
          serializedProposal,

        docFileName:
          docFileName || null,

        docPrompt:
          prompt || null,

        status:
          "draft",

        createdBy:
          req.admin?._id || null,
      });

    return res.json({
      success: true,

      proposal:
        serializedProposal,

      tenderId:
        tender._id,
    });
  } catch (err) {
    console.error(
      "createFromDoc error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to generate BOQ from document.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   GET /api/tender/:id/download-xlsx
═══════════════════════════════════════════════════════════════ */

const downloadXlsx = async (
  req,
  res
) => {
  try {
    const tender =
      await Tender.findById(
        req.params.id
      );

    if (
      !tender ||
      !tender.generatedProposal
    ) {
      return res
        .status(404)
        .json({
          success: false,

          error:
            "BOQ not found.",
        });
    }

    /*
     * generateBOQExcel supports:
     *
     * - new structured BOQ JSON string
     * - legacy Markdown BOQ
     *
     * Existing saved proposals therefore remain downloadable.
     */
    const buffer =
      await generateBOQExcel(
        tender.generatedProposal,

        tender.title ||
          "Project BOQ"
      );

    const safeTitle =
      createSafeFileTitle(
        tender.title,
        "BOQ"
      );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeTitle}_BOQ.xlsx"`
    );

    return res.send(buffer);
  } catch (err) {
    console.error(
      "downloadXlsx error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to generate Excel.",
    });
  }
};


/*
 * Keep old route alias for backward compatibility.
 */
const downloadDocx =
  downloadXlsx;


/* ═══════════════════════════════════════════════════════════════
   GET /api/tender
   Only return GENUINE tenders that actually produced a proposal.
═══════════════════════════════════════════════════════════════ */

const getAllTenders = async (
  req,
  res
) => {
  try {
    const tenders =
      await Tender.find({
        generatedProposal: {
          $exists: true,

          $nin: [
            null,
            "",
          ],
        },
      })
        .select(
          "title status docFileName createdAt updatedAt sentTo"
        )
        .sort({
          createdAt: -1,
        });

    return res.json({
      success: true,

      tenders,
    });
  } catch (err) {
    console.error(
      "getAllTenders error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to fetch tenders.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   GET /api/tender/:id
═══════════════════════════════════════════════════════════════ */

const getTenderById = async (
  req,
  res
) => {
  try {
    const tender =
      await Tender.findById(
        req.params.id
      );

    if (!tender) {
      return res.status(404).json({
        success: false,

        error:
          "Not found.",
      });
    }

    return res.json({
      success: true,

      tender,
    });
  } catch (err) {
    console.error(
      "getTenderById error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to fetch tender.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   PATCH /api/tender/:id/status
═══════════════════════════════════════════════════════════════ */

const updateStatus = async (
  req,
  res
) => {
  try {
    const {
      status,
    } = req.body;

    const allowed = [
      "draft",
      "pending",
      "approved",
      "rejected",
    ];

    if (
      !allowed.includes(
        status
      )
    ) {
      return res.status(400).json({
        success: false,

        error:
          "Invalid status.",
      });
    }

    const tender =
      await Tender.findByIdAndUpdate(
        req.params.id,

        {
          status,
        },

        {
          new: true,
        }
      ).select(
        "title status updatedAt"
      );

    if (!tender) {
      return res.status(404).json({
        success: false,

        error:
          "Tender not found.",
      });
    }

    return res.json({
      success: true,

      tender,
    });
  } catch (err) {
    console.error(
      "updateStatus error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to update status.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   GET /api/tender/vendors
═══════════════════════════════════════════════════════════════ */

const getVendors = async (
  req,
  res
) => {
  try {
    const Role =
      require("../models/Role");

    const vendorRoles =
      await Role.find({
        $or: [
          {
            slug:
              /vendor/i,
          },

          {
            name:
              /vendor/i,
          },
        ],
      }).select(
        "slug"
      );

    const vendorSlugs =
      vendorRoles
        .map(
          (role) =>
            role.slug
        )
        .filter(Boolean);

    if (
      !vendorSlugs.includes(
        "vendor"
      )
    ) {
      vendorSlugs.push(
        "vendor"
      );
    }

    const vendors =
      await Admin.find({
        role: {
          $in:
            vendorSlugs,
        },

        isActive: {
          $ne: false,
        },
      }).select(
        "name email role"
      );

    return res.json({
      success: true,

      vendors,
    });
  } catch (err) {
    console.error(
      "getVendors error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to fetch vendors.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   POST /api/tender/:id/send

   Sends a real email via utils/mailer.js.

   Vendor is recorded as sent only after actual email success.
═══════════════════════════════════════════════════════════════ */

const sendToVendor = async (
  req,
  res
) => {
  try {
    const {
      id,
    } = req.params;

    const {
      vendorId,
      docType,
      customDocName,
    } = req.body;

    if (!vendorId) {
      return res.status(400).json({
        success: false,

        error:
          "vendorId is required.",
      });
    }

    const [
      tender,
      vendor,
    ] = await Promise.all([
      Tender.findById(id),

      Admin.findById(
        vendorId
      ).select(
        "name email"
      ),
    ]);

    if (!tender) {
      return res.status(404).json({
        success: false,

        error:
          "Tender not found.",
      });
    }

    if (!vendor) {
      return res.status(404).json({
        success: false,

        error:
          "Vendor not found.",
      });
    }

    if (!vendor.email) {
      return res.status(400).json({
        success: false,

        error:
          "Vendor has no email address on file.",
      });
    }

    if (!tender.sentTo) {
      tender.sentTo = [];
    }

    const alreadySent =
      tender.sentTo.some(
        (sent) =>
          String(
            sent.vendorId
          ) ===
          String(
            vendorId
          )
      );

    const isCustom =
      docType === "custom" &&
      Boolean(req.file);

    const attachments = [];

    /*
     * Custom uploaded document.
     */
    if (isCustom) {
      attachments.push({
        filename:
          customDocName ||
          req.file.originalname,

        path:
          req.file.path,
      });
    } else {
      /*
       * Generated universal BOQ Excel.
       */
      if (
        !tender.generatedProposal
      ) {
        return res.status(400).json({
          success: false,

          error:
            "No generated BOQ available to send.",
        });
      }

      const excelBuffer =
        await generateBOQExcel(
          tender.generatedProposal,

          tender.title ||
            "Project BOQ"
        );

      const safeTitle =
        createSafeFileTitle(
          tender.title,
          "BOQ"
        );

      attachments.push({
        filename:
          `${safeTitle}_BOQ.xlsx`,

        content:
          excelBuffer,
      });
    }

    const htmlBody = `
      <p>Hello ${vendor.name || "Vendor"},</p>

      <p>
        You have received a new tender proposal:
        <strong>${tender.title || "Untitled Tender"}</strong>.
      </p>

      <p>
        Please find the attached document for full details.
        Kindly review and respond at your earliest convenience.
      </p>

      <p>
        Regards,<br/>
        Tender Management Team
      </p>
    `;

    try {
      await sendVendorProposalEmail({
        to:
          vendor.email,

        vendorName:
          vendor.name,

        tenderTitle:
          tender.title,

        htmlBody,

        attachments,
      });
    } catch (mailErr) {
      console.error(
        "sendVendorProposalEmail error:",
        mailErr
      );

      return res.status(502).json({
        success: false,

        error:
          "Failed to send email to vendor. Please check your SMTP configuration (EMAIL_HOST/EMAIL_USER/EMAIL_PASS).",
      });
    }

    /*
     * Only mark as sent after real mail success.
     */
    if (!alreadySent) {
      tender.sentTo.push({
        vendorId:
          vendor._id,

        vendorName:
          vendor.name,

        vendorEmail:
          vendor.email,

        docType:
          docType ||
          "generated",

        customDocName:
          customDocName ||
          null,

        sentAt:
          new Date(),
      });
    }

    if (
      tender.status === "draft"
    ) {
      tender.status =
        "pending";
    }

    await tender.save();

    return res.json({
      success: true,

      message:
        `Proposal emailed to ${vendor.name} (${vendor.email})`,

      vendor: {
        _id:
          vendor._id,

        name:
          vendor.name,

        email:
          vendor.email,
      },

      alreadySent,
    });
  } catch (err) {
    console.error(
      "sendToVendor error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to send to vendor.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   LEGACY / MULTI-WORK ROUTE SUPPORT

   IMPORTANT:
   These routes are retained for backward compatibility,
   but they NO LONGER use a separate hard-coded multiWorkPrompts
   file or direct OpenAI implementation.

   They now use the same universal TenderAIService.
═══════════════════════════════════════════════════════════════ */

const multiSessions =
  new Map();


const generateId = () => {
  return (
    `mw-${Date.now()}-` +
    Math.random()
      .toString(36)
      .slice(2, 7)
  );
};


/**
 * Basic in-memory multi-session object creator.
 *
 * Existing Map-based behaviour is preserved.
 */
const createMultiSession = ({
  history = [],
  proposal = null,
  title = null,
} = {}) => {
  return {
    history:
      Array.isArray(history)
        ? history
        : [],

    proposal:
      proposal || null,

    title:
      title || null,

    createdAt:
      new Date(),
  };
};


/* ═══════════════════════════════════════════════════════════════
   MULTI SESSION START
═══════════════════════════════════════════════════════════════ */

const startMultiSession = async (
  req,
  res
) => {
  try {
    const sessionId =
      generateId();

    /*
     * Keep same multi-route purpose but use the
     * universal requirements engine.
     *
     * No predefined domain/work categories.
     */
    const seedMessage =
      "I want to prepare a BOQ or project proposal. Please help me identify and collect whatever information is necessary for my requirement.";

      const {
  aiMessage,
  isReady,
  inputType,
  options,
  allowCustomInput,
  selectionMin,
  selectionMax,
} = await tenderAI.chat(
  [],
  seedMessage
);
    // const {
    //   aiMessage,
    //   isReady,
    // } = await tenderAI.chat(
    //   [],
    //   seedMessage
    // );

    const displayMessage =
      cleanMessage(aiMessage) ||
      "Please describe your requirement.";

    /*
     * Preserve the seed user requirement in history.
     *
     * Old version stored only assistant response,
     * which meant part of the conversation context
     * was lost.
     */
    multiSessions.set(
      sessionId,

      createMultiSession({
        history: [
          {
            role: "user",
            content:
              seedMessage,
          },

          {
            role: "assistant",
            content:
              displayMessage,
          },
        ],

        proposal:
          null,

        title:
          null,
      })
    );

    /*
     * Normally seedMessage should not immediately
     * produce a proposal, but support it safely.
     */
    if (isReady) {
      const generatedProposal =
        await tenderAI.generateProposal(
          multiSessions.get(
            sessionId
          ).history
        );

      const serializedProposal =
        serializeProposal(
          generatedProposal
        );

      const session =
        multiSessions.get(
          sessionId
        );

      session.proposal =
        serializedProposal;

      session.title =
        extractTitleFromBOQ(
          serializedProposal
        ) ||
        "BOQ Document";

      return res.json({
        success: true,

        sessionId,

        message:
          displayMessage,

        isReady:
          true,

        proposal:
          serializedProposal,
          inputType: "none",
options: [],
allowCustomInput: false,
selectionMin: 0,
selectionMax: 0,
      });
    }


    return res.json({
  success: true,
  sessionId,
  message: displayMessage,

  isReady: false,
  inputType: inputType || "text",
  options: Array.isArray(options) ? options : [],
  allowCustomInput: Boolean(allowCustomInput),

  selectionMin:
    Number.isInteger(selectionMin)
      ? selectionMin
      : 0,

  selectionMax:
    Number.isInteger(selectionMax)
      ? selectionMax
      : 0,
});
    // return res.json({
    //   success: true,

    //   sessionId,

    //   message:
    //     displayMessage,
    // });
  } catch (err) {
    console.error(
      "startMultiSession error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to start session.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   MULTI MESSAGE
═══════════════════════════════════════════════════════════════ */

const multiMessage = async (
  req,
  res
) => {
  const {
    id,
  } = req.params;

  const message =
    cleanMessage(
      req.body?.message
    );

  const session =
    multiSessions.get(id);

  if (!session) {
    return res.status(404).json({
      success: false,

      error:
        "Session not found.",
    });
  }

  if (!message) {
    return res.status(400).json({
      success: false,

      error:
        "Message is required.",
    });
  }

  try {
    /*
     * Send existing history BEFORE storing the
     * new message, exactly like main tender flow.
     */
    const {
  aiMessage,
  isReady,
  inputType,
  options,
  allowCustomInput,
  selectionMin,
  selectionMax,
} = await tenderAI.chat(
  session.history,
  message
);

    const displayMessage =
      cleanMessage(aiMessage) ||
      "Understood. Let me proceed.";

    session.history.push(
      {
        role: "user",

        content:
          message,
      },

      {
        role: "assistant",

        content:
          displayMessage,
      }
    );

    if (isReady) {
      const generatedProposal =
        await tenderAI.generateProposal(
          session.history
        );

      const serializedProposal =
        serializeProposal(
          generatedProposal
        );

      if (!serializedProposal) {
        throw new Error(
          "AI returned an empty generated proposal."
        );
      }

      session.proposal =
        serializedProposal;

      session.title =
        extractTitleFromBOQ(
          serializedProposal
        ) ||
        createConversationFallbackTitle(
          session.history
        ) ||
        "BOQ Document";

      return res.json({
        success: true,

        isReady:
          true,

        message:
          displayMessage,

        proposal:
          serializedProposal,

        sessionId:
          id,
          inputType: "none",
options: [],
allowCustomInput: false,
selectionMin: 0,
selectionMax: 0,
      });
    }


    return res.json({
  success: true,
  isReady: false,
  message: displayMessage,

  inputType: inputType || "text",
  options: Array.isArray(options) ? options : [],
  allowCustomInput: Boolean(allowCustomInput),

  selectionMin:
    Number.isInteger(selectionMin)
      ? selectionMin
      : 0,

  selectionMax:
    Number.isInteger(selectionMax)
      ? selectionMax
      : 0,
});
    // return res.json({
    //   success: true,

    //   isReady:
    //     false,

    //   message:
    //     displayMessage,
    // });
  } catch (err) {
    console.error(
      "multiMessage error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "AI error. Please retry.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   MULTI FROM DOCUMENT
═══════════════════════════════════════════════════════════════ */

const multiFromDoc = async (
  req,
  res
) => {
  const userPrompt =
    cleanMessage(
      req.body?.prompt
    );

  const file =
    req.file;

  let docText = "";

  try {
    if (file) {
      const extracted =
        await extractText(
          file.path,
          file.originalname
        );

      if (extracted.error) {
        console.warn(
          "multiFromDoc extraction warning:",
          extracted.error
        );
      }

      docText =
        typeof extracted.text ===
        "string"
          ? extracted.text
          : "";
    }

    if (
      !userPrompt &&
      !docText.trim()
    ) {
      return res.status(400).json({
        success: false,

        error:
          "Please provide a project description or upload a readable document.",
      });
    }

    /*
     * Same universal document generation engine
     * used by /from-doc.
     */
    const generatedProposal =
      await tenderAI
        .generateProposalFromPrompt(
          userPrompt,

          file?.originalname ||
            "uploaded-document",

          docText
        );

    const serializedProposal =
      serializeProposal(
        generatedProposal
      );

    if (!serializedProposal) {
      throw new Error(
        "AI returned an empty generated proposal."
      );
    }

    const sessionId =
      generateId();

    const title =
      extractTitleFromBOQ(
        serializedProposal
      ) ||
      (
        file?.originalname
          ? path.basename(
              file.originalname,
              path.extname(
                file.originalname
              )
            )
          : null
      ) ||
      (
        userPrompt
          ? userPrompt.slice(
              0,
              100
            )
          : null
      ) ||
      "BOQ Document";

    const history = [];

    if (userPrompt) {
      history.push({
        role: "user",

        content:
          userPrompt,
      });
    }

    multiSessions.set(
      sessionId,

      createMultiSession({
        history,

        proposal:
          serializedProposal,

        title,
      })
    );

    return res.json({
      success: true,

      sessionId,

      proposal:
        serializedProposal,
    });
  } catch (err) {
    console.error(
      "multiFromDoc error:",
      err
    );

    return res.status(500).json({
      success: false,

      error:
        "Failed to generate BOQ.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   MULTI DOCX ALIAS
═══════════════════════════════════════════════════════════════ */

const downloadMultiDocx = async (
  req,
  res
) => {
  /*
   * Backward-compatible route.
   * Output remains XLSX.
   */
  return downloadMultiXlsx(
    req,
    res
  );
};


/* ═══════════════════════════════════════════════════════════════
   MULTI XLSX DOWNLOAD
═══════════════════════════════════════════════════════════════ */

const downloadMultiXlsx = async (
  req,
  res
) => {
  const session =
    multiSessions.get(
      req.params.id
    );

  if (
    !session?.proposal
  ) {
    return res.status(404).json({
      error:
        "BOQ not found.",
    });
  }

  try {
    const title =
      session.title ||
      extractTitleFromBOQ(
        session.proposal
      ) ||
      "Multi-Work BOQ";

    const buffer =
      await generateBOQExcel(
        session.proposal,
        title
      );

    const safeTitle =
      createSafeFileTitle(
        title,
        "MultiWork"
      );

    const filename =
      `BOQ_${safeTitle}_${Date.now()}.xlsx`;

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.send(buffer);
  } catch (err) {
    console.error(
      "downloadMultiXlsx error:",
      err
    );

    return res.status(500).json({
      error:
        "Failed to generate Excel.",
    });
  }
};


/* ═══════════════════════════════════════════════════════════════
   BACKWARD-COMPATIBLE INTERNAL HELPERS

   These names existed conceptually in the old controller.
   They now delegate to the universal AI service.
═══════════════════════════════════════════════════════════════ */

const generateMultiWorkBOQ = async (
  history
) => {
  const generatedProposal =
    await tenderAI.generateProposal(
      history
    );

  return serializeProposal(
    generatedProposal
  );
};


const extractMultiProjectTitle = (
  proposal
) => {
  return (
    extractTitleFromBOQ(
      proposal
    ) ||
    "BOQ Document"
  );
};


/* ═══════════════════════════════════════════════════════════════
   EXPORTS

   Existing exported controller names are preserved so
   existing routes do not need to change.
═══════════════════════════════════════════════════════════════ */

module.exports = {
  startTender,

  sendMessage,

  createFromDoc,

  getAllTenders,

  getTenderById,

  updateStatus,

  downloadDocx,

  downloadXlsx,

  getVendors,

  sendToVendor,

  multiMessage,

  multiFromDoc,

  downloadMultiDocx,

  downloadMultiXlsx,

  startMultiSession,
};




// const Tender = require("../models/Tender");
// const tenderAI = require("../services/tender/TenderAIService");
// const path = require("path");
// const { extractText } = require("../services/tender/fileExtractor");
// const Admin = require("../models/Admin");
// const { generateBOQExcel } = require("../services/tender/generateBOQExcel");
// const { sendVendorProposalEmail } = require("../utils/mailer");
// const OpenAI = require("openai");
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// const extractTitleFromBOQ = (markdown) => {
//   if (!markdown) return null;
//   const match = markdown.match(/project\s+title[:\s*]+([^\n\r]+)/i);
//   if (match?.[1]) {
//     return match[1].replace(/\*\*/g, "").replace(/^[-:]\s*/, "").trim();
//   }
//   return null;
// };

// /* ─── POST /api/tender/start ─── */
// const startTender = async (req, res) => {
//   try {
//     const firstQuestion =
//       "Let's get started! 🚀 Briefly describe your project — what do you need done and what are the major work areas involved? (e.g. 'Office renovation with electrical, CCTV, flooring, furniture & networking for 5000 sq ft', 'Residential construction 3BHK with civil, plumbing & electrical')";

//     const tender = await Tender.create({
//       createdBy: req.admin?._id || null,
//       conversationHistory: [],
//       status: "in_progress",
//     });
//     res.json({ success: true, tenderId: tender._id, message: firstQuestion });
//   } catch (err) {
//     console.error("startTender error:", err);
//     res.status(500).json({ success: false, error: "Failed to start session." });
//   }
// };

// /* ─── POST /api/tender/:id/message ─── */
// const sendMessage = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { message } = req.body;

//     if (!message?.trim())
//       return res.status(400).json({ success: false, error: "Message is required." });

//     const tender = await Tender.findById(id);
//     if (!tender) return res.status(404).json({ success: false, error: "Tender not found." });
//     if (tender.status !== "in_progress")
//       return res.status(400).json({ success: false, error: "This tender is already completed." });

//     const { aiMessage, isReady } = await tenderAI.chat(tender.conversationHistory, message.trim());

//     tender.conversationHistory.push(
//       { role: "user", content: message.trim() },
//       { role: "assistant", content: aiMessage || "Understood. Let me proceed." }
//     );

//     if (isReady) {
//       const boqMarkdown = await tenderAI.generateProposal(tender.conversationHistory);
//       const firstUserMsg = tender.conversationHistory.find(m => m.role === "user");
//       tender.title = firstUserMsg?.content?.slice(0, 100) || "Untitled BOQ";
//       tender.generatedProposal = boqMarkdown;
//       tender.status = "draft";
//       await tender.save();
//       return res.json({ success: true, message: aiMessage || "", isReady: true, proposal: boqMarkdown, tenderId: tender._id });
//     }

//     await tender.save();
//     res.json({ success: true, message: aiMessage, isReady: false });
//   } catch (err) {
//     console.error("sendMessage error:", err);
//     res.status(500).json({ success: false, error: "AI service error. Please try again." });
//   }
// };

// /* ─── POST /api/tender/from-doc ─── */
// const createFromDoc = async (req, res) => {
//   try {
//     const { prompt } = req.body;
//     const docFileName = req.file?.originalname || null;
//     const docFilePath = req.file?.path || null;

//     let docText = "";
//     if (docFilePath && docFileName) {
//       const { text, error } = await extractText(docFilePath, docFileName);
//       if (error) console.warn("File extraction warning:", error);
//       docText = text;
//     }

//     const hasPrompt = prompt?.trim().length > 0;
//     const hasDocText = docText.trim().length > 50;

//     if (!hasPrompt && !hasDocText) {
//       return res.status(400).json({
//         success: false,
//         error: "Please provide a description or upload a readable document (PDF/DOCX/TXT).",
//       });
//     }

//     const boqMarkdown = await tenderAI.generateProposalFromPrompt(
//       prompt?.trim() || "", docFileName || "uploaded-document", docText
//     );

//     const extractedTitle = extractTitleFromBOQ(boqMarkdown)
//       || (docFileName ? path.basename(docFileName, path.extname(docFileName)) : null)
//       || "Project Requirements";

//     const tender = await Tender.create({
//       title: extractedTitle.slice(0, 100),
//       generatedProposal: boqMarkdown,
//       docFileName: docFileName || null,
//       docPrompt: prompt?.trim() || null,
//       status: "draft",
//       createdBy: req.admin?._id || null,
//     });

//     res.json({ success: true, proposal: boqMarkdown, tenderId: tender._id });
//   } catch (err) {
//     console.error("createFromDoc error:", err);
//     res.status(500).json({ success: false, error: "Failed to generate BOQ from document." });
//   }
// };

// /* ─── GET /api/tender/:id/download-xlsx  (was download-docx) ─── */
// const downloadXlsx = async (req, res) => {
//   try {
//     const tender = await Tender.findById(req.params.id);
//     if (!tender || !tender.generatedProposal)
//       return res.status(404).json({ success: false, error: "BOQ not found." });

//     const buffer = await generateBOQExcel(tender.generatedProposal, tender.title);

//     const safeTitle = (tender.title || "BOQ")
//       .replace(/[^a-zA-Z0-9\s]/g, "")
//       .trim()
//       .replace(/\s+/g, "_")
//       .slice(0, 60);

//     res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
//     res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_BOQ.xlsx"`);
//     res.send(buffer);
//   } catch (err) {
//     console.error("downloadXlsx error:", err);
//     res.status(500).json({ success: false, error: "Failed to generate Excel." });
//   }
// };

// // Keep old route alias for backward compat
// const downloadDocx = downloadXlsx;

// /* ─── GET /api/tender ───
//    Only return GENUINE tenders — i.e. ones that actually produced a BOQ.
//    Abandoned "Untitled Tender" sessions (created by /start but never
//    finished / never generated a proposal) are excluded so the list only
//    shows real, completed proposals. No existing creation logic changed —
//    this only filters what the list endpoint returns.
// */
// const getAllTenders = async (req, res) => {
//   try {
//     const tenders = await Tender.find({
//       generatedProposal: { $exists: true, $nin: [null, ""] },
//     })
//       .select("title status docFileName createdAt updatedAt sentTo")
//       .sort({ createdAt: -1 });
//     res.json({ success: true, tenders });
//   } catch (err) {
//     res.status(500).json({ success: false, error: "Failed to fetch tenders." });
//   }
// };

// /* ─── GET /api/tender/:id ─── */
// const getTenderById = async (req, res) => {
//   try {
//     const tender = await Tender.findById(req.params.id);
//     if (!tender) return res.status(404).json({ success: false, error: "Not found." });
//     res.json({ success: true, tender });
//   } catch (err) {
//     res.status(500).json({ success: false, error: "Failed to fetch tender." });
//   }
// };

// /* ─── PATCH /api/tender/:id/status ─── */
// const updateStatus = async (req, res) => {
//   try {
//     const { status } = req.body;
//     const allowed = ["draft", "pending", "approved", "rejected"];
//     if (!allowed.includes(status))
//       return res.status(400).json({ success: false, error: "Invalid status." });
//     const tender = await Tender.findByIdAndUpdate(req.params.id, { status }, { new: true })
//       .select("title status updatedAt");
//     res.json({ success: true, tender });
//   } catch (err) {
//     res.status(500).json({ success: false, error: "Failed to update status." });
//   }
// };

// /* ─── GET /api/tender/vendors ─── */
// const getVendors = async (req, res) => {
//   try {
//     const Role = require("../models/Role");
//     const Admin = require("../models/Admin");
//     const vendorRoles = await Role.find({ $or: [{ slug: /vendor/i }, { name: /vendor/i }] }).select("slug");
//     const vendorSlugs = vendorRoles.map(r => r.slug);
//     if (!vendorSlugs.includes("vendor")) vendorSlugs.push("vendor");
//     const vendors = await Admin.find({ role: { $in: vendorSlugs }, isActive: { $ne: false } }).select("name email role");
//     res.json({ success: true, vendors });
//   } catch (err) {
//     console.error("getVendors error:", err);
//     res.status(500).json({ success: false, error: "Failed to fetch vendors." });
//   }
// };

// /* ─── POST /api/tender/:id/send ───
//    Now actually sends a real email via Nodemailer (utils/mailer.js).
//    The vendor is only recorded as "sent" (and the tender flipped to
//    "pending") if the email genuinely succeeds — so the "Sent" badge
//    on the dashboard reflects reality, not a fake success response.
// */
// const sendToVendor = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { vendorId, docType, customDocName } = req.body;
//     const Admin = require("../models/Admin");

//     if (!vendorId) return res.status(400).json({ success: false, error: "vendorId is required." });

//     const [tender, vendor] = await Promise.all([
//       Tender.findById(id),
//       Admin.findById(vendorId).select("name email"),
//     ]);
//     if (!tender) return res.status(404).json({ success: false, error: "Tender not found." });
//     if (!vendor) return res.status(404).json({ success: false, error: "Vendor not found." });
//     if (!vendor.email) return res.status(400).json({ success: false, error: "Vendor has no email address on file." });

//     if (!tender.sentTo) tender.sentTo = [];
//     const alreadySent = tender.sentTo.some(s => String(s.vendorId) === String(vendorId));

//     const isCustom = docType === "custom" && req.file;
//     const attachments = [];

//     if (isCustom) {
//       attachments.push({
//         filename: customDocName || req.file.originalname,
//         path: req.file.path,
//       });
//     } else {
//       if (!tender.generatedProposal) {
//         return res.status(400).json({ success: false, error: "No generated BOQ available to send." });
//       }
//       const excelBuffer = await generateBOQExcel(tender.generatedProposal, tender.title);
//       const safeTitle = (tender.title || "BOQ")
//         .replace(/[^a-zA-Z0-9\s]/g, "")
//         .trim()
//         .replace(/\s+/g, "_")
//         .slice(0, 60);
//       attachments.push({
//         filename: `${safeTitle}_BOQ.xlsx`,
//         content: excelBuffer,
//       });
//     }

//     const htmlBody = `
//       <p>Hello ${vendor.name || "Vendor"},</p>
//       <p>You have received a new tender proposal: <strong>${tender.title || "Untitled Tender"}</strong>.</p>
//       <p>Please find the attached document for full details. Kindly review and respond at your earliest convenience.</p>
//       <p>Regards,<br/>Tender Management Team</p>
//     `;

//     try {
//       await sendVendorProposalEmail({
//         to: vendor.email,
//         vendorName: vendor.name,
//         tenderTitle: tender.title,
//         htmlBody,
//         attachments,
//       });
//     } catch (mailErr) {
//       console.error("sendVendorProposalEmail error:", mailErr);
//       return res.status(502).json({
//         success: false,
//         error: "Failed to send email to vendor. Please check your SMTP configuration (EMAIL_HOST/EMAIL_USER/EMAIL_PASS).",
//       });
//     }

//     if (!alreadySent) {
//       tender.sentTo.push({
//         vendorId: vendor._id, vendorName: vendor.name, vendorEmail: vendor.email,
//         docType: docType || "generated", customDocName: customDocName || null, sentAt: new Date(),
//       });
//     }
//     if (tender.status === "draft") tender.status = "pending";
//     await tender.save();

//     res.json({
//       success: true,
//       message: `Proposal emailed to ${vendor.name} (${vendor.email})`,
//       vendor: { _id: vendor._id, name: vendor.name, email: vendor.email },
//       alreadySent,
//     });
//   } catch (err) {
//     console.error("sendToVendor error:", err);
//     res.status(500).json({ success: false, error: "Failed to send to vendor." });
//   }
// };

// /* ═══════════════════════════════════════════════════════════════
//    MULTI-WORK HANDLERS (kept for backward compat, same Excel output)
// ═══════════════════════════════════════════════════════════════ */
// const { MULTI_WORK_SYSTEM_PROMPT, buildMultiWorkBOQPrompt, buildMultiWorkDocBOQPrompt } = require("../services/tender/multiWorkPrompts");

// const multiSessions = new Map();
// const generateId = () => `mw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// const startMultiSession = async (req, res) => {
//   try {
//     const sessionId = generateId();
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       messages: [
//         { role: "system", content: MULTI_WORK_SYSTEM_PROMPT },
//         { role: "user", content: "I need to create a multi-work BOQ for my project." },
//       ],
//       temperature: 0.4, max_tokens: 600,
//     });
//     const aiMessage = response.choices[0].message.content.trim();
//     multiSessions.set(sessionId, { history: [{ role: "assistant", content: aiMessage }], proposal: null, title: null });
//     return res.json({ success: true, sessionId, message: aiMessage });
//   } catch (err) {
//     console.error("startMultiSession error:", err);
//     return res.status(500).json({ success: false, error: "Failed to start session." });
//   }
// };

// const multiMessage = async (req, res) => {
//   const { id } = req.params;
//   const { message } = req.body;
//   const session = multiSessions.get(id);
//   if (!session) return res.status(404).json({ success: false, error: "Session not found." });
//   session.history.push({ role: "user", content: message });
//   try {
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       messages: [{ role: "system", content: MULTI_WORK_SYSTEM_PROMPT }, ...session.history],
//       temperature: 0.4, max_tokens: 700,
//     });
//     const aiMessage = response.choices[0].message.content.trim();
//     const isReady = aiMessage.includes("##READY_TO_GENERATE##");
//     const displayMessage = aiMessage.replace("##READY_TO_GENERATE##", "").trim();
//     session.history.push({ role: "assistant", content: displayMessage });
//     if (isReady) {
//       const boqMarkdown = await generateMultiWorkBOQ(session.history);
//       session.proposal = boqMarkdown;
//       session.title = extractMultiProjectTitle(boqMarkdown);
//       return res.json({ success: true, isReady: true, message: displayMessage, proposal: boqMarkdown, sessionId: id });
//     }
//     return res.json({ success: true, isReady: false, message: displayMessage });
//   } catch (err) {
//     console.error("multiMessage error:", err);
//     return res.status(500).json({ success: false, error: "AI error. Please retry." });
//   }
// };

// const multiFromDoc = async (req, res) => {
//   const userPrompt = req.body.prompt || "";
//   const file = req.file;
//   let docText = "";
//   if (file) {
//     const extracted = await extractText(file.path, file.originalname);
//     docText = extracted.text || "";
//   }
//   try {
//     const prompt = buildMultiWorkDocBOQPrompt(userPrompt, file?.originalname || "", docText);
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       messages: [{ role: "user", content: prompt }],
//       temperature: 0.3, max_tokens: 4000,
//     });
//     const boqMarkdown = response.choices[0].message.content.trim();
//     const sessionId = generateId();
//     multiSessions.set(sessionId, { history: [], proposal: boqMarkdown, title: extractMultiProjectTitle(boqMarkdown) });
//     return res.json({ success: true, sessionId, proposal: boqMarkdown });
//   } catch (err) {
//     console.error("multiFromDoc error:", err);
//     return res.status(500).json({ success: false, error: "Failed to generate BOQ." });
//   }
// };


// const downloadMultiDocx = async (req, res) => {
//   // Now outputs Excel instead of Word
//   return downloadMultiXlsx(req, res);
// };

// const downloadMultiXlsx = async (req, res) => {
//   const session = multiSessions.get(req.params.id);
//   if (!session?.proposal) return res.status(404).json({ error: "BOQ not found." });
//   try {
//     const buffer = await generateBOQExcel(session.proposal, session.title || "Multi-Work BOQ");
//     const filename = `BOQ_${(session.title || "MultiWork").replace(/\s+/g, "_").slice(0, 40)}_${Date.now()}.xlsx`;
//     res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
//     res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
//     res.send(buffer);
//   } catch (err) {
//     console.error("downloadMultiXlsx error:", err);
//     res.status(500).json({ error: "Failed to generate Excel." });
//   }
// };

// const generateMultiWorkBOQ = async (history) => {
//   const response = await openai.chat.completions.create({
//     model: "gpt-4o-mini",
//     messages: [{ role: "user", content: buildMultiWorkBOQPrompt(history) }],
//     temperature: 0.3, max_tokens: 4000,
//   });
//   return response.choices[0].message.content.trim();
// };

// const extractMultiProjectTitle = (markdown) => {
//   const match = markdown.match(/Project Title\s*:\s*(.+)/i);
//   return match?.[1]?.trim().slice(0, 60) || "BOQ Document";
// };

// module.exports = {
//   startTender, sendMessage, createFromDoc,
//   getAllTenders, getTenderById, updateStatus,
//   downloadDocx, downloadXlsx, getVendors, sendToVendor,
//   multiMessage, multiFromDoc, downloadMultiDocx, downloadMultiXlsx, startMultiSession,
// };









// const Tender = require("../models/Tender");
// const tenderAI = require("../services/tender/TenderAIService");
// const { generateBOQDocx } = require("../services/tender/BoqDocxGenerator");
// const path = require("path");
// const { extractText } = require("../services/tender/fileExtractor");
// const Admin  = require("../models/Admin");
// const nodemailer = require("nodemailer");
// const { generateBOQExcel } = require("../services/tender/generateBOQExcel");
// const { MULTI_WORK_SYSTEM_PROMPT, buildMultiWorkBOQPrompt, buildMultiWorkDocBOQPrompt } = require("../services/tender/multiWorkPrompts");
// const OpenAI = require("openai");
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });



// /**
//  * Extracts the Project Title from the AI-generated BOQ markdown.
//  * Looks for "Project Title: ..." line inside the ## 1. PROJECT OVERVIEW section.
//  */
// const extractTitleFromBOQ = (markdown) => {
//   if (!markdown) return null;
//   // Match "Project Title: Some Title" or "**Project Title:** Some Title"
//   const match = markdown.match(/project\s+title[:\s*]+([^\n\r]+)/i);
//   if (match?.[1]) {
//     return match[1]
//       .replace(/\*\*/g, "")   // strip bold markers
//       .replace(/^[-:]\s*/, "") // strip leading dash or colon
//       .trim();
//   }
//   return null;
// };

// /* ─────────────────────────────────────────────────────────────
//    POST /api/tender/start  — unchanged
// ───────────────────────────────────────────────────────────── */
// const startTender = async (req, res) => {
//   try {
//     const firstQuestion =
//       "Let's get started! 🚀 Briefly describe your project — what do you need done? (e.g. 'Office interior renovation for 5000 sq ft', 'E-commerce website development', 'Residential construction 3BHK')";

//     const tender = await Tender.create({
//       createdBy: req.admin?._id || null,
//       conversationHistory: [],
//       status: "in_progress",
//     });

//     res.json({ success: true, tenderId: tender._id, message: firstQuestion });
//   } catch (err) {
//     console.error("startTender error:", err);
//     res.status(500).json({ success: false, error: "Failed to start session." });
//   }
// };

// /* ─────────────────────────────────────────────────────────────
//    POST /api/tender/:id/message  — unchanged interface
// ───────────────────────────────────────────────────────────── */
// const sendMessage = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { message } = req.body;

//     if (!message?.trim())
//       return res.status(400).json({ success: false, error: "Message is required." });

//     const tender = await Tender.findById(id);
//     if (!tender)
//       return res.status(404).json({ success: false, error: "Tender not found." });
//     if (tender.status !== "in_progress")
//       return res.status(400).json({ success: false, error: "This tender is already completed." });

//     const { aiMessage, isReady } = await tenderAI.chat(
//       tender.conversationHistory,
//       message.trim()
//     );

//     tender.conversationHistory.push(
//       { role: "user", content: message.trim() },
//       { role: "assistant", content: aiMessage || "Understood. Let me proceed." }
//     );

//     if (isReady) {
//       const boqMarkdown = await tenderAI.generateProposal(tender.conversationHistory);

//       // Extract a clean title from the first user message
//       const firstUserMsg = tender.conversationHistory.find((m) => m.role === "user");
//       tender.title = firstUserMsg?.content?.slice(0, 100) || "Untitled BOQ";
//       tender.generatedProposal = boqMarkdown;
//       tender.status = "draft";
//       await tender.save();

//       return res.json({
//         success: true,
//         message: aiMessage || "",
//         isReady: true,
//         proposal: boqMarkdown,
//         tenderId: tender._id,
//       });
//     }

//     await tender.save();
//     res.json({ success: true, message: aiMessage, isReady: false });
//   } catch (err) {
//     console.error("sendMessage error:", err);
//     res.status(500).json({ success: false, error: "AI service error. Please try again." });
//   }
// };

// /* ─────────────────────────────────────────────────────────────
//    POST /api/tender/from-doc  — unchanged interface
// ───────────────────────────────────────────────────────────── */
// // ─────────────────────────────────────────────────────────────
// // CHANGE IN tenderController.js
// // Only this ONE function changes — replace createFromDoc with this.
// // All other handlers (startTender, sendMessage, getAllTenders,
// // getTenderById, updateStatus, downloadDocx) remain exactly the same.
// // ─────────────────────────────────────────────────────────────

// // ADD this require at the top of tenderController.js (with the other requires):
// // const { extractText } = require("../services/tender/fileExtractor");

// /* ─────────────────────────────────────────────────────────────
//    POST /api/tender/from-doc
//    FIXED: now extracts actual file text and passes it to AI.
// ───────────────────────────────────────────────────────────── */
// const createFromDoc = async (req, res) => {
//   try {
//     const { prompt }    = req.body;
//     const docFileName   = req.file?.originalname || null;
//     const docFilePath   = req.file?.path || null;

//     // Extract text from the uploaded file
//     let docText = "";
//     if (docFilePath && docFileName) {
//       const { text, error } = await extractText(docFilePath, docFileName);
//       if (error) {
//         console.warn("File extraction warning:", error);
//         // Non-fatal — continue with whatever text we got (may be empty)
//       }
//       docText = text;
//     }

//     // Need either a prompt or readable document content
//     const hasPrompt  = prompt?.trim().length > 0;
//     const hasDocText = docText.trim().length > 50; // at least some meaningful content

//     if (!hasPrompt && !hasDocText) {
//       return res.status(400).json({
//         success: false,
//         error: "Please provide a description or upload a readable document (PDF/DOCX/TXT).",
//       });
//     }

//     const boqMarkdown = await tenderAI.generateProposalFromPrompt(
//       prompt?.trim() || "",
//       docFileName || "uploaded-document",
//       docText
//     );

//     const extractedTitle = extractTitleFromBOQ(boqMarkdown) 
//   || (docFileName ? path.basename(docFileName, path.extname(docFileName)) : null)
//   || "Project Requirements";

// const tender = await Tender.create({
//   title: extractedTitle.slice(0, 100),
//       generatedProposal: boqMarkdown,
//       docFileName:       docFileName || null,
//       docPrompt:         prompt?.trim() || null,
//       status:            "draft",
//       createdBy:         req.admin?._id || null,
//     });

//     res.json({ success: true, proposal: boqMarkdown, tenderId: tender._id });
//   } catch (err) {
//     console.error("createFromDoc error:", err);
//     res.status(500).json({ success: false, error: "Failed to generate BOQ from document." });
//   }
// };

// /* ─────────────────────────────────────────────────────────────
//    GET /api/tender/:id/download-docx
//    NEW: Stream the generated BOQ as a .docx file
// ───────────────────────────────────────────────────────────── */
// const downloadDocx = async (req, res) => {
//   try {
//     const tender = await Tender.findById(req.params.id);
//     if (!tender || !tender.generatedProposal)
//       return res.status(404).json({ success: false, error: "BOQ not found." });

//     const buffer = await generateBOQDocx(tender.generatedProposal, tender.title);

//     const safeTitle = (tender.title || "BOQ")
//       .replace(/[^a-zA-Z0-9\s]/g, "")
//       .trim()
//       .replace(/\s+/g, "_")
//       .slice(0, 60);

//     res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
//     res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_BOQ.docx"`);
//     res.send(buffer);
//   } catch (err) {
//     console.error("downloadDocx error:", err);
//     res.status(500).json({ success: false, error: "Failed to generate DOCX." });
//   }
// };

// /* ─────────────────────────────────────────────────────────────
//    GET /api/tender  — unchanged
// ───────────────────────────────────────────────────────────── */
// const getAllTenders = async (req, res) => {
//   try {
//     const tenders = await Tender.find()
//       .select("title status docFileName createdAt updatedAt")
//       .sort({ createdAt: -1 });
//     res.json({ success: true, tenders });
//   } catch (err) {
//     res.status(500).json({ success: false, error: "Failed to fetch tenders." });
//   }
// };

// /* ─────────────────────────────────────────────────────────────
//    GET /api/tender/:id  — unchanged
// ───────────────────────────────────────────────────────────── */
// const getTenderById = async (req, res) => {
//   try {
//     const tender = await Tender.findById(req.params.id);
//     if (!tender) return res.status(404).json({ success: false, error: "Not found." });
//     res.json({ success: true, tender });
//   } catch (err) {
//     res.status(500).json({ success: false, error: "Failed to fetch tender." });
//   }
// };

// /* ─────────────────────────────────────────────────────────────
//    PATCH /api/tender/:id/status  — unchanged
// ───────────────────────────────────────────────────────────── */
// const updateStatus = async (req, res) => {
//   try {
//     const { status } = req.body;
//     const allowed = ["draft", "pending", "approved", "rejected"];
//     if (!allowed.includes(status))
//       return res.status(400).json({ success: false, error: "Invalid status." });

//     const tender = await Tender.findByIdAndUpdate(req.params.id, { status }, { new: true })
//       .select("title status updatedAt");
//     res.json({ success: true, tender });
//   } catch (err) {
//     res.status(500).json({ success: false, error: "Failed to update status." });
//   }
// };


// /* ─────────────────────────────────────────────────────────────
//    GET /api/tender/vendors
//    Returns all users whose role slug === "vendor"
//    Uses the existing Admin/User model + roles lookup
// ───────────────────────────────────────────────────────────── */
// const getVendors = async (req, res) => {
//   try {
//     // Admin model stores role as a slug string (e.g. "vendor")
//     // We find the vendor role slug from the Role collection first,
//     // then query users — this handles both hardcoded and custom role names.
//     const Role  = require("../models/Role");
//     const Admin = require("../models/Admin");
 
//     // Find all roles whose slug or name contains "vendor" (case-insensitive)
//     const vendorRoles = await Role.find({
//       $or: [
//         { slug: /vendor/i },
//         { name: /vendor/i },
//       ],
//     }).select("slug");
 
//     const vendorSlugs = vendorRoles.map((r) => r.slug);
 
//     // Fallback: also include literal "vendor" in case it's a system role not in Role collection
//     if (!vendorSlugs.includes("vendor")) vendorSlugs.push("vendor");
 
//     const vendors = await Admin.find({
//       role: { $in: vendorSlugs },
//       isActive: { $ne: false }, // only active vendors
//     }).select("name email role");
 
//     res.json({ success: true, vendors });
//   } catch (err) {
//     console.error("getVendors error:", err);
//     res.status(500).json({ success: false, error: "Failed to fetch vendors." });
//   }
// };


// /* ─────────────────────────────────────────────────────────────
//    POST /api/tender/:id/send
//    Body: { vendorId: string, docType: "generated" | "custom", customDocName?: string }
//    File: req.file (optional — for custom doc upload)
   
//    Marks the tender as sent to vendor + records dispatch log.
//    Sends email if nodemailer/mailer is configured.
// ───────────────────────────────────────────────────────────── */
// const sendToVendor = async (req, res) => {
//   try {
//     const { id }        = req.params;
//     const { vendorId, docType, customDocName } = req.body;
//     const Admin = require("../models/Admin");
 
//     if (!vendorId) {
//       return res.status(400).json({ success: false, error: "vendorId is required." });
//     }
 
//     const [tender, vendor] = await Promise.all([
//       Tender.findById(id),
//       Admin.findById(vendorId).select("name email"),
//     ]);
 
//     if (!tender) return res.status(404).json({ success: false, error: "Tender not found." });
//     if (!vendor) return res.status(404).json({ success: false, error: "Vendor not found." });
 
//     // ── Record the dispatch in the tender document ──
//     if (!tender.sentTo) tender.sentTo = [];
 
//     const alreadySent = tender.sentTo.some(
//       (s) => String(s.vendorId) === String(vendorId)
//     );
 
//     if (!alreadySent) {
//       tender.sentTo.push({
//         vendorId: vendor._id,
//         vendorName: vendor.name,
//         vendorEmail: vendor.email,
//         docType: docType || "generated",
//         customDocName: customDocName || null,
//         sentAt: new Date(),
//       });
//     }
 
//     // Update status to pending (awaiting vendor response)
//     if (tender.status === "draft") tender.status = "pending";
//     await tender.save();
 
//     // ── Optional email dispatch ──
//     // Uncomment and configure if you have nodemailer set up:
//     //
//     // try {
//     //   const transporter = nodemailer.createTransport({ /* your config */ });
//     //   await transporter.sendMail({
//     //     from: process.env.MAIL_FROM || "noreply@yourapp.com",
//     //     to: vendor.email,
//     //     subject: `BOQ / Requirement Document: ${tender.title}`,
//     //     text: `Dear ${vendor.name},\n\nPlease find the attached BOQ for "${tender.title}".\n\nRegards,\nProcurement Team`,
//     //   });
//     // } catch (mailErr) {
//     //   console.warn("Email send failed (non-fatal):", mailErr.message);
//     // }
 
//     res.json({
//       success: true,
//       message: `Proposal sent to ${vendor.name} (${vendor.email})`,
//       vendor: { _id: vendor._id, name: vendor.name, email: vendor.email },
//       alreadySent,
//     });
//   } catch (err) {
//     console.error("sendToVendor error:", err);
//     res.status(500).json({ success: false, error: "Failed to send to vendor." });
//   }
// };

// // ═══════════════════════════════════════════════
// //  MULTI-WORK BOQ HANDLERS — Added below existing
// // ═══════════════════════════════════════════════

// const multiSessions = new Map();
// const generateId = () => `mw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// const startMultiSession = async (req, res) => {
//   try {
//     const sessionId = generateId();
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       messages: [
//         { role: "system", content: MULTI_WORK_SYSTEM_PROMPT },
//         { role: "user",   content: "I need to create a multi-work BOQ for my project." },
//       ],
//       temperature: 0.4,
//       max_tokens: 600,
//     });
//     const aiMessage = response.choices[0].message.content.trim();
//     multiSessions.set(sessionId, { history: [{ role: "assistant", content: aiMessage }], proposal: null, title: null });
//     return res.json({ success: true, sessionId, message: aiMessage });
//   } catch (err) {
//     console.error("startMultiSession error:", err);
//     return res.status(500).json({ success: false, error: "Failed to start session." });
//   }
// };

// const multiMessage = async (req, res) => {
//   const { id } = req.params;
//   const { message } = req.body;
//   const session = multiSessions.get(id);
//   if (!session) return res.status(404).json({ success: false, error: "Session not found." });
//   session.history.push({ role: "user", content: message });
//   try {
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       messages: [{ role: "system", content: MULTI_WORK_SYSTEM_PROMPT }, ...session.history],
//       temperature: 0.4,
//       max_tokens: 700,
//     });
//     const aiMessage = response.choices[0].message.content.trim();
//     const isReady = aiMessage.includes("##READY_TO_GENERATE##");
//     const displayMessage = aiMessage.replace("##READY_TO_GENERATE##", "").trim();
//     session.history.push({ role: "assistant", content: displayMessage });
//     if (isReady) {
//       const boqMarkdown = await generateMultiWorkBOQ(session.history);
//       session.proposal = boqMarkdown;
//       session.title = extractMultiProjectTitle(boqMarkdown);
//       return res.json({ success: true, isReady: true, message: displayMessage, proposal: boqMarkdown, sessionId: id });
//     }
//     return res.json({ success: true, isReady: false, message: displayMessage });
//   } catch (err) {
//     console.error("multiMessage error:", err);
//     return res.status(500).json({ success: false, error: "AI error. Please retry." });
//   }
// };

// const multiFromDoc = async (req, res) => {
//   const userPrompt = req.body.prompt || "";
//   const file = req.file;
//   let docText = "";
//   if (file) {
//     const extracted = await extractText(file.path, file.originalname);
//     docText = extracted.text || "";
//   }
//   try {
//     const prompt = buildMultiWorkDocBOQPrompt(userPrompt, file?.originalname || "", docText);
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       messages: [{ role: "user", content: prompt }],
//       temperature: 0.3,
//       max_tokens: 4000,
//     });
//     const boqMarkdown = response.choices[0].message.content.trim();
//     const sessionId = generateId();
//     multiSessions.set(sessionId, { history: [], proposal: boqMarkdown, title: extractMultiProjectTitle(boqMarkdown) });
//     return res.json({ success: true, sessionId, proposal: boqMarkdown });
//   } catch (err) {
//     console.error("multiFromDoc error:", err);
//     return res.status(500).json({ success: false, error: "Failed to generate BOQ." });
//   }
// };

// const downloadMultiDocx = async (req, res) => {
//   const session = multiSessions.get(req.params.id);
//   if (!session?.proposal) return res.status(404).json({ error: "BOQ not found." });
//   try {
//     const buffer = await generateBOQDocx(session.proposal, session.title || "Multi-Work BOQ");
//     const filename = `BOQ_${(session.title || "MultiWork").replace(/\s+/g, "_").slice(0, 40)}_${Date.now()}.docx`;
//     res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
//     res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
//     res.send(buffer);
//   } catch (err) {
//     console.error("downloadMultiDocx error:", err);
//     res.status(500).json({ error: "Failed to generate DOCX." });
//   }
// };

// const downloadMultiXlsx = async (req, res) => {
//   const session = multiSessions.get(req.params.id);
//   if (!session?.proposal) return res.status(404).json({ error: "BOQ not found." });
//   try {
//     const buffer = await generateBOQExcel(session.proposal, session.title || "Multi-Work BOQ");
//     const filename = `BOQ_${(session.title || "MultiWork").replace(/\s+/g, "_").slice(0, 40)}_${Date.now()}.xlsx`;
//     res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
//     res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
//     res.send(buffer);
//   } catch (err) {
//     console.error("downloadMultiXlsx error:", err);
//     res.status(500).json({ error: "Failed to generate Excel." });
//   }
// };

// // Helpers
// const generateMultiWorkBOQ = async (history) => {
//   const response = await openai.chat.completions.create({
//     model: "gpt-4o-mini",
//     messages: [{ role: "user", content: buildMultiWorkBOQPrompt(history) }],
//     temperature: 0.3,
//     max_tokens: 4000,
//   });
//   return response.choices[0].message.content.trim();
// };

// const extractMultiProjectTitle = (markdown) => {
//   const match = markdown.match(/Project Title\s*:\s*(.+)/i);
//   return match?.[1]?.trim().slice(0, 60) || "BOQ Document";
// };

// module.exports = {
//   startTender, sendMessage, createFromDoc,
//   getAllTenders, getTenderById, updateStatus,
//   downloadDocx, getVendors, sendToVendor,
//   multiMessage, multiFromDoc, downloadMultiDocx, downloadMultiXlsx, startMultiSession,
// };