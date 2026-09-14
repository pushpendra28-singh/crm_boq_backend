const path = require("path");

const manifestPath = path.join(
  __dirname,
  "..",
  "generated",
  "invoiceTemplates.json"
);

let manifest;

try {
  manifest = require(manifestPath);
} catch (error) {
  console.error(
    "Unable to load generated invoice template manifest:",
    error
  );

  throw new Error(
    "Invoice template manifest is missing. Run the invoice engine build first."
  );
}


const INVOICE_TEMPLATES =
  Object.freeze(
    manifest.templates || {}
  );


const DEFAULT_INVOICE_TEMPLATE =
  Object.freeze({
    ...(manifest.defaultTemplate || {}),
  });


const resolveInvoiceTemplate = (
  template
) => {
  /*
    Template missing:
    fallback to generated default.
  */
  if (
    template === undefined ||
    template === null
  ) {
    return {
      ...DEFAULT_INVOICE_TEMPLATE,
    };
  }


  /*
    Explicit template proper object hona chahiye.
  */
  if (
    typeof template !== "object" ||
    Array.isArray(template)
  ) {
    return null;
  }


  const key =
    typeof template.key === "string"
      ? template.key
          .trim()
          .toLowerCase()
      : "";


  const version =
    Number(
      template.version
    );


  if (!key) {
    return null;
  }


  const templateDefinition =
    INVOICE_TEMPLATES[key];


  if (!templateDefinition) {
    return null;
  }


  if (
    !Number.isInteger(version) ||
    version < 1
  ) {
    return null;
  }


  if (
    !Array.isArray(
      templateDefinition.versions
    ) ||
    !templateDefinition.versions.includes(
      version
    )
  ) {
    return null;
  }


  return {
    key,
    version,
  };
};


module.exports = {
  INVOICE_TEMPLATES,
  DEFAULT_INVOICE_TEMPLATE,
  resolveInvoiceTemplate,
};