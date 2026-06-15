/**
 * proposalChatController.js
 * Handles all API endpoints for the AI Interview + Document Proposal system.
 *
 * Routes handled:
 *   POST   /proposal-chat/start
 *   POST   /proposal-chat/message/:id
 *   GET    /proposal-chat/:id
 *   POST   /proposal-chat/upload/:id
 *   POST   /proposal-chat/complete/:id
 *   GET    /proposal-chat/list
 *
 * This controller does NOT modify existing newproposalcontroller.js.
 * It calls into the existing aigenerator.js pipeline for final generation.
 */

const path = require("path");
const ProposalConversation = require("../models/ProposalConversation");
const NewProposal = require("../models/NewProposal");
const {
  getOpeningMessage,
  processInterviewMessage,
  processDocumentMessage,
  runFullExtraction,
} = require("../services/newproposal/chatinterview");
const { parseUploadedFile } = require("../services/newproposal/documentParser");
const {
  mergeExtractedData,
  checkCompletion,
} = require("../services/newproposal/extractionPrompt");
const {
  buildDocumentContext,
  recalculateTokenCount,
} = require("../services/newproposal/conversationManager");
const { deleteUploadedFile } = require("../middleware/uploadMiddleware");
const { generateProposalAI } = require("../services/newproposal/aiGenerator");
const { generateGraphs } = require("../services/newproposal/graphGenerator");

// ── Text limits (configurable) ────────────────────────────────────────────────

const TEXT_LIMITS = {
  normal: { min: 1, max: 1000 },
  withDocument: { min: 1, max: 500 },
};

// ── POST /proposal-chat/start ─────────────────────────────────────────────────

/**
 * Create a new conversation session.
 * Returns the session ID and AI's opening message.
 */
exports.startConversation = async (req, res) => {
  try {
    const userId = req.user._id; // from auth middleware
    const mode = req.body.mode || "interview"; // "interview" | "document"

    // Validate mode
    if (!["interview", "document"].includes(mode)) {
      return res.status(400).json({ success: false, message: "Invalid mode. Use 'interview' or 'document'" });
    }

    // Get AI opening message
    const opening = await getOpeningMessage();

    // Create session
    const conversation = await ProposalConversation.create({
      userId,
      mode,
      messages: [
        {
          role: "assistant",
          content: opening.reply,
        },
      ],
      extractedData: opening.extracted || {},
      missingFields: opening.missingFields || [],
      completed: false,
      title: "New Proposal Chat",
      lastActivityAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Conversation started",
      conversationId: conversation._id,
      reply: opening.reply,
      extracted: opening.extracted,
      completed: false,
      missingFields: opening.missingFields,
    });
  } catch (err) {
    console.error("[proposalChatController] startConversation:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /proposal-chat/message/:id ──────────────────────────────────────────

/**
 * Send a message and get AI reply.
 * Handles both interview mode and document mode.
 */
exports.sendMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userId = req.user._id;

    // Validate message
    if (!message || typeof message !== "string") {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    // Find session
    const conversation = await ProposalConversation.findOne({
      _id: id,
      userId,
      status: "active",
    });

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found or already completed" });
    }

    if (conversation.completed) {
      return res.status(400).json({ success: false, message: "Conversation already completed. Generate your proposal." });
    }

    // Message length validation
    const hasDocuments = conversation.documents.length > 0;
    const limit = hasDocuments ? TEXT_LIMITS.withDocument.max : TEXT_LIMITS.normal.max;

    if (message.trim().length > limit) {
      return res.status(400).json({
        success: false,
        message: `Message too long. ${hasDocuments ? "With a document attached, " : ""}maximum ${limit} characters allowed.`,
      });
    }

    // Add user message to history
    conversation.messages.push({ role: "user", content: message.trim() });

    // Process with AI based on mode
    let aiResult;

    if (conversation.mode === "document" || hasDocuments) {
      // Flow 2: Document + Chat
      aiResult = await processDocumentMessage(
        conversation.messages,
        message.trim(),
        conversation.documents,
        conversation.extractedData || {}
      );
    } else {
      // Flow 1: Interview chat
      aiResult = await processInterviewMessage(
        conversation.messages,
        message.trim(),
        conversation.extractedData || {}
      );
    }

    // Add AI reply to history
    conversation.messages.push({ role: "assistant", content: aiResult.reply });

    // Merge extracted data
    conversation.extractedData = mergeExtractedData(
      conversation.extractedData || {},
      aiResult.extracted || {}
    );

    // Auto-generate title from first meaningful user message
    if (conversation.title === "New Proposal Chat" && conversation.messages.length <= 4) {
      const firstUserMsg = conversation.messages.find((m) => m.role === "user");
      if (firstUserMsg) {
        conversation.title = firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? "..." : "");
      }
    }

    conversation.completed = aiResult.completed;
    conversation.missingFields = aiResult.missingFields || [];
    conversation.lastActivityAt = new Date();
    conversation.totalTokensEstimate = recalculateTokenCount(
      conversation.messages,
      conversation.documents
    );

    await conversation.save();

    return res.json({
      success: true,
      reply: aiResult.reply,
      extracted: aiResult.extracted,
      completed: aiResult.completed,
      missingFields: aiResult.missingFields,
      conversationId: conversation._id,
    });
  } catch (err) {
    console.error("[proposalChatController] sendMessage:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /proposal-chat/upload/:id ───────────────────────────────────────────

/**
 * Upload a document to an existing conversation session.
 * Parses the document and stores extracted text for future AI calls.
 */
exports.uploadDocument = async (req, res) => {
  let uploadedFilename = null;

  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    uploadedFilename = req.file.filename;

    const conversation = await ProposalConversation.findOne({
      _id: id,
      userId,
      status: "active",
    });

    if (!conversation) {
      deleteUploadedFile(uploadedFilename);
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    // Parse document text
    let extractedText = "";
    try {
      extractedText = await parseUploadedFile(req.file);
    } catch (parseErr) {
      deleteUploadedFile(uploadedFilename);
      return res.status(422).json({
        success: false,
        message: `Could not read document: ${parseErr.message}`,
      });
    }

    // Store document in conversation
    conversation.documents.push({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      extractedText,
    });

    // Switch to document mode
    conversation.mode = "document";
    conversation.lastActivityAt = new Date();
    await conversation.save();

    return res.status(200).json({
      success: true,
      message: "Document uploaded and processed successfully",
      document: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        textLength: extractedText.length,
      },
    });
  } catch (err) {
    // Clean up file on error
    if (uploadedFilename) deleteUploadedFile(uploadedFilename);
    console.error("[proposalChatController] uploadDocument:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /proposal-chat/complete/:id ─────────────────────────────────────────

/**
 * Finalize the conversation and generate a proposal.
 *
 * Flow:
 *  1. Run a final full extraction pass over the entire conversation
 *  2. Convert extractedData → proposal form object
 *  3. Create a NewProposal draft (reusing existing model)
 *  4. Call existing generateProposalAI (reusing existing service)
 *  5. Return the generated proposal ID
 */
exports.completeConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const conversation = await ProposalConversation.findOne({ _id: id, userId });

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    if (conversation.generatedProposalId) {
      return res.json({
        success: true,
        message: "Proposal already generated",
        proposalId: conversation.generatedProposalId,
      });
    }

    // Final extraction pass
    const docContext = buildDocumentContext(conversation.documents);
    const finalExtracted = await runFullExtraction(conversation.messages, docContext);
    const mergedData = mergeExtractedData(conversation.extractedData || {}, finalExtracted);

    // Convert extracted data → NewProposal form format
    const proposalFormData = convertExtractedToProposalForm(mergedData, conversation);

    // ── Reuse EXISTING proposal creation + generation pipeline ──────────────
    const proposal = await NewProposal.create(proposalFormData);

    const aiContent = await generateProposalAI(proposal);
    const graphs = generateGraphs(proposal);

    proposal.generatedContent = aiContent;
    proposal.graphs = graphs;
    proposal.status = "generated";
    proposal.aiGeneratedAt = new Date();
    await proposal.save();
    // ────────────────────────────────────────────────────────────────────────

    // Link back to conversation
    conversation.generatedProposalId = proposal._id;
    conversation.status = "completed";
    conversation.completed = true;
    await conversation.save();

    return res.status(200).json({
      success: true,
      message: "Proposal generated successfully",
      proposalId: proposal._id,
      proposal,
    });
  } catch (err) {
    console.error("[proposalChatController] completeConversation:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /proposal-chat/:id ────────────────────────────────────────────────────

/**
 * Fetch a conversation session with full message history.
 */
exports.getConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const conversation = await ProposalConversation.findOne({ _id: id, userId })
      .select("-documents.extractedText") // Don't send full doc text in listing
      .lean();

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    return res.json({ success: true, conversation });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /proposal-chat/list ───────────────────────────────────────────────────

/**
 * List all conversation sessions for the current user.
 */
exports.listConversations = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      ProposalConversation.find({ userId })
        .sort({ lastActivityAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("_id title mode status completed generatedProposalId lastActivityAt createdAt")
        .lean(),
      ProposalConversation.countDocuments({ userId }),
    ]);

    return res.json({ success: true, page, total, conversations });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Converter: extractedData → NewProposal form ───────────────────────────────

/**
 * Convert the AI-extracted conversation data into a NewProposal-compatible form object.
 * This is the critical bridge between the chat system and the existing proposal generator.
 */
function convertExtractedToProposalForm(extracted, conversation) {
  const now = new Date();
  const validUntil = new Date(now);
  validUntil.setDate(validUntil.getDate() + 30);

  // Build line items from extracted data or create a single budget item
  let lineItems = [];
  if (extracted.lineItems && extracted.lineItems.length > 0) {
    lineItems = extracted.lineItems.map((item) => ({
      description: item.description || "Service",
      qty: item.qty || 1,
      unit: item.unit || "Unit",
      unitPrice: item.unitPrice || 0,
    }));
  } else if (extracted.budgetNumeric) {
    lineItems = [
      {
        description: extracted.projectSummary || extracted.services?.[0] || "Project Services",
        qty: 1,
        unit: "Lump Sum",
        unitPrice: extracted.budgetNumeric,
      },
    ];
  } else {
    lineItems = [{ description: "Project Services", qty: 1, unit: "Unit", unitPrice: 0 }];
  }

  // Build services from extracted services array
  const services =
    (extracted.services || []).length > 0
      ? extracted.services.map((name) => ({ name, description: "" }))
      : [{ name: extracted.businessType || "Professional Services", description: "" }];

  // Append AMC if requested
  if (extracted.amc) {
    services.push({
      name: "Annual Maintenance Contract (AMC)",
      description: "Ongoing support and maintenance services",
    });
  }

  // Parse dates
  const parseDate = (str) => {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  };

  const proposalNumber = `PRO-${Date.now().toString().slice(-6)}`;

  return {
    // Client
    clientName: extracted.clientName || "Client",
    clientEmail: extracted.clientEmail || "",
    clientPhone: extracted.clientPhone || "",
    clientCompany: extracted.clientCompany || "",
    clientAddress: extracted.clientAddress || "",

    // Business
    businessType: extracted.businessType || "Other",
    proposalType: extracted.proposalType || "Sales Proposal",
    proposalTitle:
      extracted.proposalTitle ||
      `${extracted.businessType || "Project"} Proposal - ${extracted.clientName || "Client"}`,
    proposalNumber,
    issueDate: now,
    validUntil,

    // Scope
    projectSummary: extracted.projectSummary || extracted.scope || "",
    services,
    terms: "",
    notes: extracted.tone ? `Tone: ${extracted.tone}` : "",

    // Pricing
    currency: extracted.currency || "INR",
    lineItems,
    discount: extracted.discount || 0,
    taxRate: extracted.taxRate || 0,
    paymentTerms: extracted.paymentTerms || "Net 30",

    // Timeline
    startDate: parseDate(extracted.startDate),
    endDate: parseDate(extracted.endDate),
    milestones:
      (extracted.milestones || []).map((m) => ({
        title: m.title || "",
        dueDate: parseDate(m.dueDate),
        description: m.description || "",
      })),

    // Status
    status: "draft",
  };
}