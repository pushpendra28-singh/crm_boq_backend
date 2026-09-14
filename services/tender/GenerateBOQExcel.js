/**
 * generateBOQExcel.js
 *
 * Universal, schema-driven BOQ Excel renderer.
 *
 * IMPORTANT:
 * - Excel visual language stays the same: COVER, SUMMARY, green theme, one sheet per section.
 * - Project/domain/work types are never hard-coded.
 * - Columns, rows, calculations and subtotals come from generated BOQ data.
 * - Calculated columns are positioned intelligently beside the fields they depend on.
 * - Legacy Markdown BOQs remain supported for backward compatibility.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/* ═══════════════════════════════════════════════════════════════
   JS HELPERS
═══════════════════════════════════════════════════════════════ */

function slugifyKey(value, fallback = "field") {
    const key = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return key || fallback;
}

function uniqueKey(baseKey, usedKeys) {
    const base = baseKey || "field";

    if (!usedKeys.has(base)) {
        usedKeys.add(base);
        return base;
    }

    let index = 2;

    while (usedKeys.has(`${base}_${index}`)) {
        index += 1;
    }

    const key = `${base}_${index}`;
    usedKeys.add(key);

    return key;
}

function stripMarkdownInline(value) {
    return String(value ?? "")
        .replace(/\*\*/g, "")
        .replace(/__/g, "")
        .replace(/`/g, "")
        .trim();
}

function parseMaybeJSON(input) {
    if (
        input &&
        typeof input === "object" &&
        !Buffer.isBuffer(input)
    ) {
        return input;
    }

    if (typeof input !== "string") {
        return null;
    }

    const value = input
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    if (
        !value ||
        (
            !value.startsWith("{") &&
            !value.startsWith("[")
        )
    ) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function normalizeColumn(
    column,
    index,
    usedKeys,
    calculated = false
) {
    const raw =
        typeof column === "string"
            ? { label: column }
            : column && typeof column === "object"
                ? { ...column }
                : {};

    const label = String(
        raw.label ||
        raw.name ||
        raw.title ||
        `Column ${index + 1}`
    ).trim();

    const key = uniqueKey(
        String(raw.key || "").trim() ||
        slugifyKey(
            label,
            `column_${index + 1}`
        ),
        usedKeys
    );

    const validTypes = new Set([
        "text",
        "integer",
        "decimal",
        "currency",
        "percentage",
        "date",
        "boolean",
    ]);

    const requestedType =
        String(raw.type || "text")
            .toLowerCase()
            .trim();

    const type = validTypes.has(
        requestedType
    )
        ? requestedType
        : "text";

    const validAlignments =
        new Set([
            "left",
            "center",
            "right",
        ]);

    let alignment =
        String(raw.alignment || "")
            .toLowerCase()
            .trim();

    if (
        !validAlignments.has(
            alignment
        )
    ) {
        alignment = [
            "integer",
            "decimal",
            "currency",
            "percentage",
        ].includes(type)
            ? "right"
            : "left";
    }

    const rawWidth =
        Number(raw.width);

    const width =
        Number.isFinite(rawWidth) &&
            rawWidth > 0
            ? Math.max(
                8,
                Math.min(
                    60,
                    rawWidth
                )
            )
            : null;

    return {
        key,
        label,
        type,

        editable:
            typeof raw.editable ===
                "boolean"
                ? raw.editable
                : !calculated,

        alignment,
        width,

        expression:
            calculated &&
                typeof raw.expression ===
                "string"
                ? raw.expression.trim()
                : "",

        calculated,
    };
}

/* ═══════════════════════════════════════════════════════════════
   STRUCTURED BOQ NORMALIZATION
═══════════════════════════════════════════════════════════════ */

function normalizeStructuredBOQ(
    rawInput,
    fallbackTitle
) {
    if (
        !rawInput ||
        typeof rawInput !== "object"
    ) {
        throw new Error(
            "Structured BOQ input must be an object."
        );
    }

    const rawDocument =
        rawInput.document &&
            typeof rawInput.document ===
            "object"
            ? rawInput.document
            : {};

    const metadata = [];

    if (
        Array.isArray(
            rawDocument.metadata
        )
    ) {
        for (
            const item
            of rawDocument.metadata
        ) {
            if (
                !item ||
                typeof item !== "object"
            ) {
                continue;
            }

            const label =
                String(
                    item.label ?? ""
                ).trim();

            if (!label) {
                continue;
            }

            metadata.push({
                label,

                value:
                    item.value === null ||
                        item.value === undefined
                        ? ""
                        : String(
                            item.value
                        ),
            });
        }
    } else if (
        rawDocument.metadata &&
        typeof rawDocument.metadata ===
        "object"
    ) {
        for (
            const [label, value]
            of Object.entries(
                rawDocument.metadata
            )
        ) {
            metadata.push({
                label,

                value:
                    value === null ||
                        value === undefined
                        ? ""
                        : String(value),
            });
        }
    }

    const document = {
        title:
            String(
                rawDocument.title ||
                rawInput.title ||
                fallbackTitle ||
                "Project BOQ"
            ).trim() ||
            "Project BOQ",

        projectType:
            rawDocument.projectType ===
                null ||
                rawDocument.projectType ===
                undefined
                ? ""
                : String(
                    rawDocument.projectType
                ),

        currency:
            rawDocument.currency ===
                null ||
                rawDocument.currency ===
                undefined
                ? ""
                : String(
                    rawDocument.currency
                )
                    .trim()
                    .toUpperCase(),

        preparedDate:
            rawDocument.preparedDate ===
                null ||
                rawDocument.preparedDate ===
                undefined
                ? ""
                : String(
                    rawDocument.preparedDate
                ),

        documentReference:
            rawDocument.documentReference ===
                null ||
                rawDocument.documentReference ===
                undefined
                ? ""
                : String(
                    rawDocument
                        .documentReference
                ),

        summary:
            rawDocument.summary ===
                null ||
                rawDocument.summary ===
                undefined
                ? ""
                : String(
                    rawDocument.summary
                ),

        metadata,

        assumptions:
            Array.isArray(
                rawDocument.assumptions
            )
                ? rawDocument.assumptions
                    .map(String)
                    .filter(Boolean)
                : [],

        notes:
            Array.isArray(
                rawDocument.notes
            )
                ? rawDocument.notes
                    .map(String)
                    .filter(Boolean)
                : [],
    };

    const rawSections =
        Array.isArray(
            rawInput.sections
        )
            ? rawInput.sections
            : Array.isArray(
                rawInput.works
            )
                ? rawInput.works
                : [];

    const sections =
        rawSections
            .map(
                (
                    section,
                    sectionIndex
                ) => {
                    if (
                        !section ||
                        typeof section !==
                        "object"
                    ) {
                        return null;
                    }

                    const title =
                        String(
                            section.title ||
                            section.name ||
                            `Section ${sectionIndex + 1
                            }`
                        ).trim() ||
                        `Section ${sectionIndex + 1
                        }`;

                    const usedKeys =
                        new Set();

                    const authoredColumns =
                        (
                            Array.isArray(
                                section.columns
                            )
                                ? section.columns
                                : []
                        ).map(
                            (
                                column,
                                index
                            ) =>
                                normalizeColumn(
                                    column,
                                    index,
                                    usedKeys,
                                    false
                                )
                        );

                    const calculatedColumns =
                        (
                            Array.isArray(
                                section
                                    .calculatedColumns
                            )
                                ? section
                                    .calculatedColumns
                                : []
                        ).map(
                            (
                                column,
                                index
                            ) =>
                                normalizeColumn(
                                    column,
                                    authoredColumns.length +
                                    index,
                                    usedKeys,
                                    true
                                )
                        );

                    const allKnownKeys =
                        new Set(
                            [
                                ...authoredColumns,
                                ...calculatedColumns,
                            ].map(
                                (column) =>
                                    column.key
                            )
                        );

                    const rawRows =
                        Array.isArray(
                            section.rows
                        )
                            ? section.rows
                            : Array.isArray(
                                section.items
                            )
                                ? section.items
                                : [];

                    /*
                     * Compatibility:
                     * If structured rows exist
                     * but schema is absent,
                     * derive schema from data.
                     */
                    if (
                        authoredColumns.length ===
                        0 &&
                        rawRows.length > 0
                    ) {
                        const discovered =
                            new Set();

                        for (
                            const row
                            of rawRows
                        ) {
                            const values =
                                row?.values &&
                                    typeof row.values ===
                                    "object"
                                    ? row.values
                                    : row &&
                                        typeof row ===
                                        "object"
                                        ? row
                                        : {};

                            for (
                                const key
                                of Object.keys(
                                    values
                                )
                            ) {
                                if (
                                    key ===
                                    "sourceType" ||
                                    key === "values" ||
                                    discovered.has(
                                        key
                                    )
                                ) {
                                    continue;
                                }

                                discovered.add(
                                    key
                                );

                                const normalized =
                                    normalizeColumn(
                                        {
                                            key,

                                            label:
                                                String(
                                                    key
                                                )
                                                    .replace(
                                                        /_/g,
                                                        " "
                                                    )
                                                    .replace(
                                                        /\b\w/g,
                                                        (
                                                            char
                                                        ) =>
                                                            char.toUpperCase()
                                                    ),

                                            type:
                                                "text",
                                        },

                                        authoredColumns.length,

                                        usedKeys,

                                        false
                                    );

                                authoredColumns.push(
                                    normalized
                                );

                                allKnownKeys.add(
                                    normalized.key
                                );
                            }
                        }
                    }

                    const rows =
                        rawRows.map(
                            (row) => {
                                const sourceValues =
                                    row?.values &&
                                        typeof row.values ===
                                        "object"
                                        ? row.values
                                        : row &&
                                            typeof row ===
                                            "object"
                                            ? Object.fromEntries(
                                                Object.entries(
                                                    row
                                                ).filter(
                                                    ([key]) =>
                                                        ![
                                                            "sourceType",
                                                            "values",
                                                        ].includes(
                                                            key
                                                        )
                                                )
                                            )
                                            : {};

                                const values = {};

                                for (
                                    const column
                                    of authoredColumns
                                ) {
                                    if (
                                        Object.prototype
                                            .hasOwnProperty
                                            .call(
                                                sourceValues,
                                                column.key
                                            )
                                    ) {
                                        values[
                                            column.key
                                        ] =
                                            sourceValues[
                                            column.key
                                            ];
                                    } else if (
                                        Object.prototype
                                            .hasOwnProperty
                                            .call(
                                                sourceValues,
                                                column.label
                                            )
                                    ) {
                                        values[
                                            column.key
                                        ] =
                                            sourceValues[
                                            column.label
                                            ];
                                    } else {
                                        values[
                                            column.key
                                        ] = null;
                                    }
                                }

                                return {
                                    values,

                                    sourceType:
                                        row &&
                                            typeof row ===
                                            "object" &&
                                            typeof row.sourceType ===
                                            "string"
                                            ? row.sourceType
                                            : "",
                                };
                            }
                        );

                    let subtotal = null;

                    if (
                        section.subtotal &&
                        typeof section.subtotal ===
                        "object"
                    ) {
                        const requestedKey =
                            section.subtotal
                                .columnKey === null ||
                                section.subtotal
                                    .columnKey ===
                                undefined
                                ? null
                                : String(
                                    section
                                        .subtotal
                                        .columnKey
                                ).trim();

                        subtotal = {
                            columnKey:
                                requestedKey &&
                                    allKnownKeys.has(
                                        requestedKey
                                    )
                                    ? requestedKey
                                    : null,

                            label:
                                String(
                                    section
                                        .subtotal
                                        .label ||
                                    "Subtotal"
                                ).trim() ||
                                "Subtotal",
                        };
                    }

                    return {
                        id:
                            String(
                                section.id ||
                                slugifyKey(
                                    title,
                                    `section_${sectionIndex +
                                    1
                                    }`
                                )
                            ).trim(),

                        title,

                        description:
                            section.description ===
                                null ||
                                section.description ===
                                undefined
                                ? ""
                                : String(
                                    section.description
                                ),

                        columns:
                            authoredColumns,

                        calculatedColumns,

                        rows,

                        subtotal,

                        notes:
                            Array.isArray(
                                section.notes
                            )
                                ? section.notes
                                    .map(String)
                                    .filter(Boolean)
                                : [],
                    };
                }
            )
            .filter(Boolean);

    const summary =
        rawInput.summary &&
            typeof rawInput.summary ===
            "object"
            ? {
                enabled:
                    typeof rawInput
                        .summary.enabled ===
                        "boolean"
                        ? rawInput.summary
                            .enabled
                        : true,

                title:
                    String(
                        rawInput.summary
                            .title ||
                        "Project Summary"
                    ).trim() ||
                    "Project Summary",

                remarks:
                    rawInput.summary
                        .remarks === null ||
                        rawInput.summary
                            .remarks ===
                        undefined
                        ? ""
                        : String(
                            rawInput.summary
                                .remarks
                        ),
            }
            : {
                enabled: true,

                title:
                    "Project Summary",

                remarks: "",
            };

    return {
        formatVersion: 2,
        document,
        sections,
        summary,
    };
}

/* ═══════════════════════════════════════════════════════════════
   LEGACY MARKDOWN SUPPORT
═══════════════════════════════════════════════════════════════ */

function splitPipeRow(line) {
    const raw =
        String(line ?? "").trim();

    if (!raw.includes("|")) {
        return [];
    }

    const cells =
        raw
            .split("|")
            .map(
                (cell) =>
                    cell.trim()
            );

    if (cells[0] === "") {
        cells.shift();
    }

    if (
        cells[
        cells.length - 1
        ] === ""
    ) {
        cells.pop();
    }

    return cells;
}

function isMarkdownDivider(line) {
    const cells =
        splitPipeRow(line);

    return (
        cells.length > 0 &&
        cells.every(
            (cell) =>
                /^:?-{3,}:?$/.test(
                    cell
                )
        )
    );
}

function parseLegacyMarkdown(
    markdown,
    fallbackTitle
) {
    const lines =
        String(markdown ?? "")
            .split(/\r?\n/);

    const document = {
        title:
            fallbackTitle ||
            "Project BOQ",

        projectType: "",

        currency: "",

        preparedDate: "",

        documentReference: "",

        summary: "",

        metadata: [],

        assumptions: [],

        notes: [],
    };

    const sections = [];

    const summaryLines = [];

    let currentMajorHeading = "";

    let currentSection = null;

    let pendingTableHeader = null;

    let summaryCapture = false;

    const createSection =
        (title) => ({
            id:
                slugifyKey(
                    title,
                    `section_${sections.length + 1
                    }`
                ),

            title:
                stripMarkdownInline(
                    title
                ) ||
                `Section ${sections.length + 1
                }`,

            description: "",

            columns: [],

            calculatedColumns: [],

            rows: [],

            subtotal: null,

            notes: [],
        });

    const pushCurrentSection =
        () => {
            if (!currentSection) {
                return;
            }

            if (
                currentSection
                    .columns.length ||
                currentSection
                    .rows.length
            ) {
                sections.push(
                    currentSection
                );
            }

            currentSection = null;

            pendingTableHeader =
                null;
        };

    for (
        const rawLine
        of lines
    ) {
        const line =
            rawLine.trim();

        if (!line) {
            continue;
        }

        if (
            line.startsWith("# ") &&
            !line.startsWith(
                "## "
            )
        ) {
            document.title =
                stripMarkdownInline(
                    line.replace(
                        /^#\s+/,
                        ""
                    )
                ) ||
                document.title;

            continue;
        }

        if (
            line.startsWith(
                "## "
            )
        ) {
            pushCurrentSection();

            currentMajorHeading =
                stripMarkdownInline(
                    line.replace(
                        /^##\s+/,
                        ""
                    )
                );

            summaryCapture =
                /summary/i.test(
                    currentMajorHeading
                ) &&
                !/boq|quantit/i.test(
                    currentMajorHeading
                );

            continue;
        }

        if (
            line.startsWith(
                "### "
            )
        ) {
            pushCurrentSection();

            currentSection =
                createSection(
                    stripMarkdownInline(
                        line.replace(
                            /^###\s+/,
                            ""
                        )
                    )
                );

            summaryCapture = false;

            continue;
        }

        if (
            sections.length === 0 &&
            !currentSection &&
            /^[-*•]\s*/.test(
                line
            ) &&
            line.includes(":")
        ) {
            const cleaned =
                line.replace(
                    /^[-*•]\s*/,
                    ""
                );

            const colonIndex =
                cleaned.indexOf(":");

            const label =
                stripMarkdownInline(
                    cleaned.slice(
                        0,
                        colonIndex
                    )
                );

            const value =
                stripMarkdownInline(
                    cleaned.slice(
                        colonIndex + 1
                    )
                );

            if (label) {
                document.metadata.push({
                    label,
                    value,
                });

                if (
                    /title/i.test(
                        label
                    ) &&
                    value
                ) {
                    document.title =
                        value;
                }

                if (
                    /reference/i.test(
                        label
                    ) &&
                    value
                ) {
                    document.documentReference =
                        value;
                }

                if (
                    /prepared/i.test(
                        label
                    ) &&
                    value
                ) {
                    document.preparedDate =
                        value;
                }

                if (
                    /currency/i.test(
                        label
                    ) &&
                    value
                ) {
                    document.currency =
                        value.toUpperCase();
                }
            }

            continue;
        }

        if (summaryCapture) {
            summaryLines.push(
                stripMarkdownInline(
                    line
                )
            );

            continue;
        }

        if (
            line.includes("|")
        ) {
            if (
                isMarkdownDivider(
                    line
                )
            ) {
                continue;
            }

            const cells =
                splitPipeRow(line);

            if (!cells.length) {
                continue;
            }

            if (!currentSection) {
                const title =
                    currentMajorHeading &&
                        !/project|overview|summary|term|condition|vendor/i.test(
                            currentMajorHeading
                        )
                        ? currentMajorHeading
                        : `BOQ Section ${sections.length +
                        1
                        }`;

                currentSection =
                    createSection(title);
            }

            if (
                !pendingTableHeader
            ) {
                pendingTableHeader =
                    cells;

                const usedKeys =
                    new Set();

                currentSection.columns =
                    cells.map(
                        (
                            label,
                            index
                        ) =>
                            normalizeColumn(
                                {
                                    key:
                                        slugifyKey(
                                            stripMarkdownInline(
                                                label
                                            ),
                                            `column_${index +
                                            1
                                            }`
                                        ),

                                    label:
                                        stripMarkdownInline(
                                            label
                                        ),

                                    type:
                                        "text",
                                },

                                index,

                                usedKeys,

                                false
                            )
                    );

                continue;
            }

            const values = {};

            currentSection.columns.forEach(
                (
                    column,
                    index
                ) => {
                    values[
                        column.key
                    ] =
                        cells[index] !==
                            undefined
                            ? stripMarkdownInline(
                                cells[
                                index
                                ]
                            )
                            : null;
                }
            );

            currentSection.rows.push({
                values,

                sourceType: "",
            });

            continue;
        }

        if (
            line.startsWith(
                "**"
            ) &&
            line.endsWith(
                "**"
            ) &&
            line.length > 4
        ) {
            pushCurrentSection();

            currentSection =
                createSection(
                    stripMarkdownInline(
                        line
                    )
                );

            continue;
        }

        if (currentSection) {
            currentSection.notes.push(
                stripMarkdownInline(
                    line.replace(
                        /^[-*•]\s*/,
                        ""
                    )
                )
            );
        }
    }

    pushCurrentSection();

    document.summary =
        summaryLines
            .join(" ")
            .trim();

    /*
     * Legacy-only calculation support.
     *
     * If old Markdown has quantity + rate
     * but no amount, create calculated Amount.
     */
    for (
        const section
        of sections
    ) {
        const qtyColumn =
            section.columns.find(
                (column) =>
                    /(^|_)(qty|quantity)(_|$)|\bqty\b|\bquantity\b/i.test(
                        `${column.key} ${column.label}`
                    )
            );

        const rateColumn =
            section.columns.find(
                (column) =>
                    /\brate\b|unit.?rate|price.?per|cost.?per/i.test(
                        `${column.key} ${column.label}`
                    )
            );

        const amountColumn =
            section.columns.find(
                (column) =>
                    /\bamount\b|\btotal\b|\bextended.?cost\b/i.test(
                        `${column.key} ${column.label}`
                    )
            );

        if (
            qtyColumn &&
            rateColumn &&
            !amountColumn
        ) {
            const usedKeys =
                new Set(
                    section.columns.map(
                        (column) =>
                            column.key
                    )
                );

            const amountKey =
                uniqueKey(
                    "amount",
                    usedKeys
                );

            section
                .calculatedColumns
                .push({
                    key:
                        amountKey,

                    label:
                        "Amount",

                    type:
                        "currency",

                    editable:
                        false,

                    alignment:
                        "right",

                    width:
                        16,

                    expression:
                        `{{${qtyColumn.key}}} * {{${rateColumn.key}}}`,

                    calculated:
                        true,
                });

            section.subtotal = {
                columnKey:
                    amountKey,

                label:
                    `SUB-TOTAL — ${section.title}`,
            };

            qtyColumn.type =
                "decimal";

            qtyColumn.alignment =
                "right";

            rateColumn.type =
                "currency";

            rateColumn.alignment =
                "right";
        } else if (
            amountColumn
        ) {
            amountColumn.type =
                "currency";

            amountColumn.alignment =
                "right";

            section.subtotal = {
                columnKey:
                    amountColumn.key,

                label:
                    `SUB-TOTAL — ${section.title}`,
            };
        }
    }

    return {
        formatVersion: 1,

        document,

        sections,

        summary: {
            enabled: true,

            title:
                "Project Summary",

            remarks: "",
        },
    };
}

function normalizeBOQInput(
    input,
    fallbackTitle
) {
    const maybeJSON =
        parseMaybeJSON(input);

    if (maybeJSON) {
        return normalizeStructuredBOQ(
            maybeJSON,
            fallbackTitle
        );
    }

    if (
        typeof input ===
        "string"
    ) {
        return parseLegacyMarkdown(
            input,
            fallbackTitle
        );
    }

    throw new Error(
        "generateBOQExcel expected structured BOQ data or legacy BOQ markdown."
    );
}

/* ═══════════════════════════════════════════════════════════════
   PYTHON WORKBOOK GENERATOR
═══════════════════════════════════════════════════════════════ */

function buildPythonScript(
    dataPath,
    outputPath
) {
    return `
import json
import re
import math
import openpyxl

from datetime import datetime
from openpyxl.comments import Comment
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


with open(${JSON.stringify(dataPath)}, "r", encoding="utf-8") as file:
    data = json.load(file)


wb = openpyxl.Workbook()
wb.remove(wb.active)


# ═══════════════════════════════════════════════════════════════
# EXISTING GREEN VISUAL SYSTEM
# ═══════════════════════════════════════════════════════════════

C_PRIMARY = "1B5E20"
C_SECONDARY = "2E7D32"
C_ACCENT = "4CAF50"
C_LIGHT = "E8F5E9"
C_LIGHTER = "F1F8E9"
C_WHITE = "FFFFFF"
C_BODY = "212121"
C_MUTED = "616161"

C_RATE_BG = "FFFDE7"
C_RATE_TXT = "E65100"

C_RATE_OK_BG = "E8F5E9"
C_RATE_OK_TXT = "1B5E20"

C_CALC_BG = "E8F5E9"
C_CALC_TXT = "1B5E20"


def fill(color):
    return PatternFill(
        "solid",
        fgColor=color
    )


def font(
    bold=False,
    size=10,
    color=C_BODY,
    italic=False
):
    return Font(
        name="Arial",
        bold=bold,
        size=size,
        color=color,
        italic=italic
    )


def side(
    style="thin",
    color="BDBDBD"
):
    return Side(
        style=style,
        color=color
    )


def border(
    style="thin",
    color="BDBDBD"
):
    edge = side(
        style,
        color
    )

    return Border(
        left=edge,
        right=edge,
        top=edge,
        bottom=edge
    )


def alignment(
    horizontal="center",
    wrap=True
):
    return Alignment(
        horizontal=horizontal,
        vertical="center",
        wrap_text=wrap
    )


THIN = border()

MEDIUM = border(
    "medium",
    C_PRIMARY
)


# ═══════════════════════════════════════════════════════════════
# GENERIC HELPERS
# ═══════════════════════════════════════════════════════════════

def safe_sheet_name(
    name,
    used_names
):
    raw = re.sub(
        r'[\\\\/*?\\[\\]:]',
        '',
        str(name or "")
    ).strip()

    base = (
        raw or "Section"
    )[:31]

    candidate = base

    counter = 2

    while (
        candidate.lower()
        in used_names
    ):
        suffix = (
            f" ({counter})"
        )

        candidate = (
            base[
                :31 - len(suffix)
            ] +
            suffix
        )

        counter += 1

    used_names.add(
        candidate.lower()
    )

    return candidate


def safe_float(value):
    if (
        value is None
        or isinstance(
            value,
            bool
        )
    ):
        return None

    if isinstance(
        value,
        (int, float)
    ):
        if (
            isinstance(
                value,
                float
            )
            and (
                math.isnan(value)
                or
                math.isinf(value)
            )
        ):
            return None

        return float(value)

    text = str(
        value
    ).strip()

    if not text:
        return None

    cleaned = (
        text
        .replace(",", "")
        .replace("₹", "")
        .replace("$", "")
        .replace("€", "")
        .replace("£", "")
        .replace("Rs.", "")
        .replace("Rs", "")
        .replace("INR", "")
        .replace("USD", "")
        .replace("EUR", "")
        .replace("GBP", "")
        .strip()
    )

    cleaned = re.sub(
        r"\\(\\s*(?:est\\.?|estimated|approx\\.?|indicative)\\s*\\)",
        "",
        cleaned,
        flags=re.IGNORECASE
    ).strip()

    if cleaned.lower() in {
        "-",
        "na",
        "n/a",
        "tbd",
        "unknown",
        "not specified"
    }:
        return None

    try:
        return float(
            cleaned
        )

    except ValueError:
        return None


def coerce_value(
    value,
    column_type
):
    if value is None:
        return None

    ctype = str(
        column_type
        or "text"
    ).lower()

    if ctype == "integer":
        number = safe_float(
            value
        )

        if number is None:
            return value

        return int(
            round(number)
        )

    if ctype in {
        "decimal",
        "currency"
    }:
        number = safe_float(
            value
        )

        if number is None:
            return value

        return number

    if ctype == "percentage":
        if isinstance(
            value,
            (int, float)
        ):
            number = float(
                value
            )

            if abs(number) > 1:
                return (
                    number /
                    100.0
                )

            return number

        text = str(
            value
        ).strip()

        had_percent = (
            "%" in text
        )

        number = safe_float(
            text.replace(
                "%",
                ""
            )
        )

        if number is None:
            return value

        if (
            had_percent
            or abs(number) > 1
        ):
            return (
                number /
                100.0
            )

        return number

    if ctype == "boolean":
        if isinstance(
            value,
            bool
        ):
            return (
                "Yes"
                if value
                else "No"
            )

        text = (
            str(value)
            .strip()
            .lower()
        )

        if text in {
            "true",
            "yes",
            "y",
            "1"
        }:
            return "Yes"

        if text in {
            "false",
            "no",
            "n",
            "0"
        }:
            return "No"

    return value


def currency_number_format(
    currency
):
    code = (
        str(
            currency or ""
        )
        .upper()
        .strip()
    )

    if code == "INR":
        return '₹#,##0.00'

    if code == "USD":
        return '$#,##0.00'

    if code == "EUR":
        return '€#,##0.00'

    if code == "GBP":
        return '£#,##0.00'

    return '#,##0.00'


def apply_number_format(
    cell,
    column_type,
    currency
):
    ctype = str(
        column_type
        or "text"
    ).lower()

    if ctype == "currency":
        cell.number_format = (
            currency_number_format(
                currency
            )
        )

    elif ctype == "integer":
        cell.number_format = (
            "0"
        )

    elif ctype == "decimal":
        cell.number_format = (
            "#,##0.00"
        )

    elif ctype == "percentage":
        cell.number_format = (
            "0.00%"
        )

    elif ctype == "date":
        cell.number_format = (
            "dd-mmm-yyyy"
        )


def resolve_width(
    column
):
    requested = (
        column.get(
            "width"
        )
    )

    try:
        if requested is not None:
            numeric = float(
                requested
            )

            if numeric > 0:
                return max(
                    8,
                    min(
                        60,
                        numeric
                    )
                )

    except (
        TypeError,
        ValueError
    ):
        pass

    ctype = str(
        column.get(
            "type",
            "text"
        )
    ).lower()

    label = str(
        column.get(
            "label",
            ""
        )
    ).lower()

    if any(
        token in label
        for token in [
            "description",
            "specification",
            "notes",
            "scope",
            "details",
            "requirement",
            "configuration"
        ]
    ):
        return 40

    if any(
        token in label
        for token in [
            "brand",
            "make",
            "model",
            "rating",
            "capacity",
            "material",
            "finish",
            "grade"
        ]
    ):
        return 24

    if ctype == "text":
        return 22

    if ctype == "date":
        return 15

    if ctype == "boolean":
        return 11

    if ctype in {
        "integer",
        "decimal",
        "currency",
        "percentage"
    }:
        return 16

    return 18


def expression_keys(
    expression
):
    return re.findall(
        r"\\{\\{([a-zA-Z0-9_\\-]+)\\}\\}",
        str(
            expression or ""
        )
    )


def expression_to_excel_formula(
    expression,
    key_to_letter,
    row_number
):
    if not expression:
        return None

    template = str(
        expression
    ).strip()

    if not template:
        return None

    def replace(match):
        key = match.group(1)

        letter = (
            key_to_letter.get(
                key
            )
        )

        if not letter:
            return "0"

        return (
            f"{letter}"
            f"{row_number}"
        )

    rendered = re.sub(
        r"\\{\\{([a-zA-Z0-9_\\-]+)\\}\\}",
        replace,
        template
    )

    if not rendered:
        return None

    return (
        "=" +
        rendered
    )


def ordered_section_columns(
    section
):
    """
    Keep authored order but insert calculated fields
    immediately after the last field referenced in
    their formula.

    Example:
    Qty | Unit Rate | Amount | Specifications
    """

    authored = []

    for column in (
        section.get(
            "columns",
            []
        ) or []
    ):
        item = dict(
            column
        )

        item[
            "_calculated"
        ] = False

        authored.append(
            item
        )

    result = list(
        authored
    )

    for column in (
        section.get(
            "calculatedColumns",
            []
        ) or []
    ):
        item = dict(
            column
        )

        item[
            "_calculated"
        ] = True

        refs = expression_keys(
            item.get(
                "expression"
            )
        )

        positions = []

        for ref in refs:
            for (
                index,
                existing
            ) in enumerate(
                result
            ):
                if (
                    existing.get(
                        "key"
                    ) ==
                    ref
                ):
                    positions.append(
                        index
                    )

        if positions:
            insert_at = (
                max(
                    positions
                ) +
                1
            )

            while (
                insert_at <
                len(result)
                and
                result[
                    insert_at
                ].get(
                    "_calculated"
                )
            ):
                insert_at += 1

            result.insert(
                insert_at,
                item
            )

        else:
            result.append(
                item
            )

    return result


def first_text_column_letter(
    columns,
    letters
):
    for (
        index,
        column
    ) in enumerate(
        columns
    ):
        if (
            str(
                column.get(
                    "type",
                    "text"
                )
            ).lower()
            ==
            "text"
        ):
            return (
                letters[
                    index
                ]
            )

    return (
        letters[0]
        if letters
        else "B"
    )


def subtotal_target(
    section,
    columns
):
    subtotal = (
        section.get(
            "subtotal"
        ) or {}
    )

    key = subtotal.get(
        "columnKey"
    )

    if not key:
        return (
            None,
            None
        )

    for (
        index,
        column
    ) in enumerate(
        columns
    ):
        if (
            column.get(
                "key"
            )
            ==
            key
        ):
            return (
                index,
                column
            )

    return (
        None,
        None
    )


def is_rate_like(
    column
):
    text = (
        str(
            column.get(
                "key",
                ""
            )
        )
        +
        " "
        +
        str(
            column.get(
                "label",
                ""
            )
        )
    ).lower()

    return bool(
        re.search(
            r"\\b(rate|unit rate|unit cost|price|cost per|hourly rate|monthly cost|license cost|commercial rate)\\b",
            text
        )
    )


def best_source_comment_column(
    columns
):
    for (
        index,
        column
    ) in enumerate(
        columns
    ):
        label = str(
            column.get(
                "label",
                ""
            )
        ).lower()

        if any(
            token in label
            for token in [
                "item",
                "description",
                "service",
                "work",
                "task",
                "component",
                "requirement"
            ]
        ):
            return index

    for (
        index,
        column
    ) in enumerate(
        columns
    ):
        if (
            str(
                column.get(
                    "type",
                    "text"
                )
            ).lower()
            ==
            "text"
        ):
            return index

    return 0


def calculate_row_height(
    values,
    columns
):
    longest = 0

    for column in columns:
        if column.get(
            "_calculated"
        ):
            continue

        value = values.get(
            column.get(
                "key"
            )
        )

        if value is not None:
            longest = max(
                longest,
                len(
                    str(value)
                )
            )

    if longest > 220:
        return 60

    if longest > 140:
        return 48

    if longest > 75:
        return 40

    return 32


def display_currency(
    currency
):
    code = (
        str(
            currency or ""
        )
        .strip()
        .upper()
    )

    return code


# ═══════════════════════════════════════════════════════════════
# DOCUMENT DATA
# ═══════════════════════════════════════════════════════════════

document = (
    data.get(
        "document",
        {}
    )
    or
    {}
)

sections = (
    data.get(
        "sections",
        []
    )
    or
    []
)

summary_config = (
    data.get(
        "summary",
        {}
    )
    or
    {}
)

project_title = str(
    document.get(
        "title",
        "Project BOQ"
    )
)

currency = display_currency(
    document.get(
        "currency"
    )
)

used_sheet_names = {
    "cover",
    "summary"
}


for section in sections:
    section[
        "_sheet_name"
    ] = safe_sheet_name(
        section.get(
            "title",
            "Section"
        ),
        used_sheet_names
    )


# ═══════════════════════════════════════════════════════════════
# COVER SHEET
# ═══════════════════════════════════════════════════════════════

cov = wb.create_sheet(
    "COVER"
)

cov.sheet_view.showGridLines = False


for (
    col,
    width
) in zip(
    "ABCDE",
    [
        3,
        30,
        50,
        3,
        3
    ]
):
    cov.column_dimensions[
        col
    ].width = width


for row_index in range(
    1,
    5
):
    for col in "ABCDE":
        cov[
            f"{col}"
            f"{row_index}"
        ].fill = fill(
            C_PRIMARY
        )

    cov.row_dimensions[
        row_index
    ].height = 10


cov.merge_cells(
    "B5:C5"
)

cell = cov["B5"]

cell.value = (
    "BILL OF QUANTITIES"
)

cell.font = Font(
    name="Arial",
    bold=True,
    size=26,
    color=C_PRIMARY
)

cell.alignment = (
    alignment()
)

cov.row_dimensions[
    5
].height = 46


cov.merge_cells(
    "B6:C6"
)

cell = cov["B6"]

cell.value = (
    "PROJECT BOQ & "
    "COMMERCIAL REQUIREMENTS DOCUMENT"
)

cell.font = Font(
    name="Arial",
    bold=True,
    size=11,
    color=C_SECONDARY,
    italic=True
)

cell.alignment = (
    alignment()
)

cov.row_dimensions[
    6
].height = 20


cov.merge_cells(
    "B7:C7"
)

cov[
    "B7"
].fill = fill(
    C_ACCENT
)

cov.row_dimensions[
    7
].height = 5

cov.row_dimensions[
    8
].height = 12


cov.merge_cells(
    "B9:C9"
)

cell = cov["B9"]

cell.value = (
    project_title.upper()
)

cell.font = Font(
    name="Arial",
    bold=True,
    size=15,
    color=C_BODY
)

cell.alignment = (
    alignment()
)

cov.row_dimensions[
    9
].height = 30

cov.row_dimensions[
    10
].height = 10


metadata = (
    document.get(
        "metadata",
        []
    )
    or
    []
)

doc_ref = str(
    document.get(
        "documentReference",
        ""
    )
    or
    ""
).strip()


if not doc_ref:
    doc_ref = (
        "BOQ-" +
        datetime.now()
        .strftime(
            "%Y%m%d%H%M"
        )
    )


prepared_on = str(
    document.get(
        "preparedDate",
        ""
    )
    or
    ""
).strip()


if not prepared_on:
    now = datetime.now()

    prepared_on = (
        f"{now.day} "
        f"{now.strftime('%B %Y')}"
    )


skip_cover_labels = {
    "project title",
    "title",
    "document reference",
    "prepared date",
    "prepared on"
}

meta_rows = []


for item in metadata:
    if not isinstance(
        item,
        dict
    ):
        continue

    label = str(
        item.get(
            "label",
            ""
        )
    ).strip()

    value = str(
        item.get(
            "value",
            ""
        )
        or
        ""
    )

    if (
        label
        and
        label.lower()
        not in
        skip_cover_labels
    ):
        meta_rows.append(
            (
                label,
                value
            )
        )


project_type = str(
    document.get(
        "projectType",
        ""
    )
    or
    ""
).strip()


existing_labels = {
    label.lower()
    for (
        label,
        _
    )
    in meta_rows
}


if (
    project_type
    and
    "project type"
    not in
    existing_labels
):
    meta_rows.insert(
        0,
        (
            "Project Type",
            project_type
        )
    )


if (
    currency
    and
    "currency"
    not in
    existing_labels
):
    meta_rows.append(
        (
            "Currency",
            currency
        )
    )


meta_rows += [
    (
        "Document Reference",
        doc_ref
    ),
    (
        "Prepared On",
        prepared_on
    ),
    (
        "Status",
        "DRAFT — For Vendor Quotation"
    ),
    (
        "Confidential",
        "Yes — Do not distribute without authorization"
    ),
]


row = 11


for (
    label,
    value
) in meta_rows:

    cov.row_dimensions[
        row
    ].height = 22

    key_cell = cov.cell(
        row,
        2,
        label
    )

    key_cell.font = font(
        bold=True,
        size=10,
        color=C_PRIMARY
    )

    key_cell.fill = fill(
        C_LIGHT
    )

    key_cell.border = border(
        "thin",
        C_ACCENT
    )

    key_cell.alignment = (
        alignment(
            "left"
        )
    )


    value_cell = cov.cell(
        row,
        3,
        value
    )

    value_cell.font = font(
        size=10
    )

    value_cell.border = (
        THIN
    )

    value_cell.alignment = (
        alignment(
            "left"
        )
    )

    row += 1


cov.row_dimensions[
    row
].height = 12


row += 1


cov.merge_cells(
    f"B{row}:C{row}"
)

cell = cov.cell(
    row,
    2,
    "WORK CATEGORIES INCLUDED IN THIS BOQ"
)

cell.font = font(
    bold=True,
    size=10,
    color=C_SECONDARY
)

cell.alignment = (
    alignment(
        "left"
    )
)

cov.row_dimensions[
    row
].height = 20


row += 1


for (
    index,
    section
) in enumerate(
    sections,
    1
):
    cov.row_dimensions[
        row
    ].height = 18

    number_cell = cov.cell(
        row,
        2,
        f"  {index}."
    )

    number_cell.font = font(
        bold=True,
        color=C_PRIMARY
    )

    number_cell.alignment = (
        alignment(
            "left"
        )
    )


    title_cell = cov.cell(
        row,
        3,
        (
            f"{section.get('title', '')}  "
            f"({len(section.get('rows', []))} items)"
        )
    )

    title_cell.font = font(
        size=10
    )

    title_cell.alignment = (
        alignment(
            "left"
        )
    )

    row += 1


document_summary = str(
    document.get(
        "summary",
        ""
    )
    or
    ""
).strip()


if document_summary:
    row += 1

    cov.merge_cells(
        f"B{row}:C{row}"
    )

    cell = cov.cell(
        row,
        2,
        "PROJECT SUMMARY"
    )

    cell.font = font(
        bold=True,
        size=10,
        color=C_SECONDARY
    )

    cell.alignment = (
        alignment(
            "left"
        )
    )

    row += 1


    cov.merge_cells(
        f"B{row}:C{row}"
    )

    cell = cov.cell(
        row,
        2,
        document_summary
    )

    cell.font = font(
        size=9,
        color=C_BODY
    )

    cell.alignment = (
        alignment(
            "left"
        )
    )

    cov.row_dimensions[
        row
    ].height = 45


assumptions = (
    document.get(
        "assumptions",
        []
    )
    or
    []
)


if assumptions:
    row += 2

    cov.merge_cells(
        f"B{row}:C{row}"
    )

    cell = cov.cell(
        row,
        2,
        "COMMERCIAL / ESTIMATION ASSUMPTIONS"
    )

    cell.font = font(
        bold=True,
        size=10,
        color=C_SECONDARY
    )

    cell.alignment = (
        alignment(
            "left"
        )
    )

    row += 1


    for assumption in assumptions[:8]:
        cov.merge_cells(
            f"B{row}:C{row}"
        )

        cell = cov.cell(
            row,
            2,
            f"• {assumption}"
        )

        cell.font = font(
            size=8,
            color=C_MUTED,
            italic=True
        )

        cell.alignment = (
            alignment(
                "left"
            )
        )

        cov.row_dimensions[
            row
        ].height = 22

        row += 1


row += 1


cov.merge_cells(
    f"B{row}:C{row}"
)

cell = cov.cell(
    row,
    2,
    (
        "This document is intended "
        "for qualified vendors only. "
        "Confidential & Proprietary."
    )
)

cell.font = Font(
    name="Arial",
    size=8,
    color=C_MUTED,
    italic=True
)

cell.alignment = (
    alignment(
        "left"
    )
)


row += 2


for row_index in range(
    row,
    row + 3
):
    for col in "ABCDE":
        cov[
            f"{col}"
            f"{row_index}"
        ].fill = fill(
            C_PRIMARY
        )

    cov.row_dimensions[
        row_index
    ].height = 8


cov.page_setup.fitToPage = True

cov.page_setup.fitToWidth = 1


# ═══════════════════════════════════════════════════════════════
# INDIVIDUAL BOQ SECTION SHEETS
# ═══════════════════════════════════════════════════════════════

for section in sections:

    sheet_name = (
        section[
            "_sheet_name"
        ]
    )

    ws = wb.create_sheet(
        sheet_name
    )

    ws.sheet_view.showGridLines = False


    all_columns = (
        ordered_section_columns(
            section
        )
    )


    if not all_columns:
        all_columns = [
            {
                "key":
                    "_information",

                "label":
                    "Information",

                "type":
                    "text",

                "editable":
                    False,

                "alignment":
                    "left",

                "width":
                    40,

                "_calculated":
                    False
            }
        ]

        if section.get(
            "description"
        ):
            section[
                "rows"
            ] = [
                {
                    "values": {
                        "_information":
                            section.get(
                                "description"
                            )
                    },

                    "sourceType":
                        ""
                }
            ]

        elif not section.get(
            "rows"
        ):
            section[
                "rows"
            ] = []


    n_cols = len(
        all_columns
    )


    col_letters = [
        get_column_letter(
            index
        )
        for index
        in range(
            2,
            2 + n_cols
        )
    ]


    last_col_letter = (
        col_letters[
            -1
        ]
    )


    key_to_letter = {
        column.get(
            "key"
        ):
            col_letters[
                index
            ]
        for (
            index,
            column
        )
        in enumerate(
            all_columns
        )
    }


    first_text_letter = (
        first_text_column_letter(
            all_columns,
            col_letters
        )
    )


    source_comment_index = (
        best_source_comment_column(
            all_columns
        )
    )


    ws.column_dimensions[
        "A"
    ].width = 3


    for (
        index,
        column
    ) in enumerate(
        all_columns
    ):
        ws.column_dimensions[
            col_letters[
                index
            ]
        ].width = (
            resolve_width(
                column
            )
        )


    # ── Title band ─────────────────────────────────────────────

    ws.merge_cells(
        f"B1:{last_col_letter}1"
    )


    cell = ws["B1"]

    cell.value = (
        "BOQ — " +
        str(
            section.get(
                "title",
                "SECTION"
            )
        ).upper()
    )

    cell.font = Font(
        name="Arial",
        bold=True,
        size=13,
        color=C_WHITE
    )

    cell.fill = fill(
        C_PRIMARY
    )

    cell.alignment = (
        alignment()
    )

    ws.row_dimensions[
        1
    ].height = 34


    for letter in col_letters:
        ws[
            f"{letter}1"
        ].fill = fill(
            C_PRIMARY
        )


    ws.merge_cells(
        f"B2:{last_col_letter}2"
    )


    cell = ws["B2"]

    cell.value = (
        f"Project: {project_title}"
        f"    |    "
        f"Work Category: "
        f"{section.get('title', '')}"
    )

    cell.font = Font(
        name="Arial",
        bold=True,
        size=9,
        color=C_SECONDARY,
        italic=True
    )

    cell.alignment = (
        alignment()
    )

    ws.row_dimensions[
        2
    ].height = 16


    ws.merge_cells(
        f"B3:{last_col_letter}3"
    )


    cell = ws["B3"]


    editable_present = any(
        bool(
            column.get(
                "editable",
                False
            )
        )
        for column
        in all_columns
    )


    status_note = (
        "Editable commercial/input cells are highlighted"
        if editable_present
        else
        "Generated project schedule"
    )


    cell.value = (
        f"Prepared: {prepared_on}"
        f"    |    "
        f"Status: DRAFT — For Vendor Quotation"
        f"    |    "
        f"{status_note}"
    )


    cell.font = Font(
        name="Arial",
        size=8,
        color=C_MUTED,
        italic=True
    )

    cell.alignment = (
        alignment()
    )

    ws.row_dimensions[
        3
    ].height = 14


    # ── Column headers ─────────────────────────────────────────

    header_row = 4


    ws.row_dimensions[
        header_row
    ].height = 34


    for (
        letter,
        column
    ) in zip(
        col_letters,
        all_columns
    ):
        cell = ws[
            f"{letter}"
            f"{header_row}"
        ]

        cell.value = str(
            column.get(
                "label",
                ""
            )
        )

        cell.font = font(
            bold=True,
            size=10,
            color=C_WHITE
        )

        cell.fill = fill(
            C_SECONDARY
        )

        cell.alignment = (
            alignment()
        )

        cell.border = border(
            "medium",
            C_PRIMARY
        )


    # ── Data rows ──────────────────────────────────────────────

    rows = (
        section.get(
            "rows",
            []
        )
        or
        []
    )


    first_data_row = 5

    row = (
        first_data_row
    )


    for (
        item_index,
        row_data
    ) in enumerate(
        rows
    ):

        values = (
            row_data.get(
                "values",
                {}
            )
            if isinstance(
                row_data,
                dict
            )
            else
            {}
        )


        ws.row_dimensions[
            row
        ].height = (
            calculate_row_height(
                values,
                all_columns
            )
        )


        alternate_fill = (
            C_LIGHTER
            if item_index % 2 == 0
            else
            C_WHITE
        )


        for (
            column_index,
            column
        ) in enumerate(
            all_columns
        ):

            letter = (
                col_letters[
                    column_index
                ]
            )

            cell = ws[
                f"{letter}"
                f"{row}"
            ]


            key = (
                column.get(
                    "key"
                )
            )


            column_type = str(
                column.get(
                    "type",
                    "text"
                )
            ).lower()


            cell_alignment = str(
                column.get(
                    "alignment",
                    "left"
                )
            ).lower()


            if cell_alignment not in {
                "left",
                "center",
                "right"
            }:
                cell_alignment = (
                    "left"
                )


            if column.get(
                "_calculated"
            ):
                formula = (
                    expression_to_excel_formula(
                        column.get(
                            "expression"
                        ),
                        key_to_letter,
                        row
                    )
                )

                if formula:
                    cell.value = (
                        formula
                    )

            else:
                raw_value = (
                    values.get(
                        key
                    )
                )

                value = (
                    coerce_value(
                        raw_value,
                        column_type
                    )
                )

                if (
                    value is not None
                    and
                    value != ""
                ):
                    cell.value = (
                        value
                    )


            cell.fill = fill(
                alternate_fill
            )

            cell.border = (
                THIN
            )

            cell.alignment = (
                alignment(
                    cell_alignment
                )
            )

            cell.font = font(
                size=10
            )


            apply_number_format(
                cell,
                column_type,
                currency
            )


            # Calculated amount/total cells
            if column.get(
                "_calculated"
            ):
                cell.fill = fill(
                    C_CALC_BG
                )

                cell.font = Font(
                    name="Arial",
                    size=10,
                    color=C_CALC_TXT
                )


            # Commercial rate/cost entry cells
            elif (
                column.get(
                    "editable",
                    False
                )
                and
                column_type
                ==
                "currency"
                and
                is_rate_like(
                    column
                )
            ):
                if cell.value is None:
                    cell.fill = fill(
                        C_RATE_BG
                    )

                    cell.font = Font(
                        name="Arial",
                        size=10,
                        color=C_RATE_TXT
                    )

                else:
                    cell.fill = fill(
                        C_RATE_OK_BG
                    )

                    cell.font = Font(
                        name="Arial",
                        size=10,
                        color=C_RATE_OK_TXT
                    )


            # Other editable numeric fields
            elif (
                column.get(
                    "editable",
                    False
                )
                and
                column_type in {
                    "integer",
                    "decimal",
                    "percentage"
                }
            ):
                cell.font = Font(
                    name="Arial",
                    size=10,
                    color=C_BODY
                )


        # Preserve source traceability without
        # adding a visible Source Type column.
        source_type = str(
            row_data.get(
                "sourceType",
                ""
            )
            if isinstance(
                row_data,
                dict
            )
            else
            ""
        ).strip()


        if source_type:
            comment_letter = (
                col_letters[
                    min(
                        source_comment_index,
                        len(
                            col_letters
                        ) - 1
                    )
                ]
            )

            source_cell = ws[
                f"{comment_letter}"
                f"{row}"
            ]

            source_cell.comment = Comment(
                (
                    "Source basis: "
                    f"{source_type.capitalize()}"
                ),
                "BOQ System"
            )


        row += 1


    last_data_row = (
        row - 1
    )


    # ── Subtotal ───────────────────────────────────────────────

    (
        subtotal_index,
        subtotal_column
    ) = subtotal_target(
        section,
        all_columns
    )


    subtotal_row = None

    subtotal_letter = None


    if subtotal_index is not None:
        subtotal_letter = (
            col_letters[
                subtotal_index
            ]
        )

        subtotal_row = row


        ws.row_dimensions[
            row
        ].height = 28


        label_end_index = max(
            subtotal_index - 1,
            0
        )


        label_end_letter = (
            col_letters[
                label_end_index
            ]
        )


        if label_end_letter != "B":
            ws.merge_cells(
                f"B{row}:"
                f"{label_end_letter}{row}"
            )


        subtotal_config = (
            section.get(
                "subtotal"
            )
            or
            {}
        )


        label_cell = ws[
            f"B{row}"
        ]


        label_cell.value = str(
            subtotal_config.get(
                "label"
            )
            or
            (
                "SUB-TOTAL — "
                f"{section.get('title', '')}"
            )
        )


        label_cell.font = Font(
            name="Arial",
            bold=True,
            size=10,
            color=C_WHITE
        )


        label_cell.fill = fill(
            C_SECONDARY
        )


        label_cell.alignment = (
            alignment()
        )


        label_cell.border = (
            MEDIUM
        )


        for letter in col_letters:
            ws[
                f"{letter}{row}"
            ].fill = fill(
                C_SECONDARY
            )

            ws[
                f"{letter}{row}"
            ].border = (
                MEDIUM
            )


        subtotal_cell = ws[
            f"{subtotal_letter}"
            f"{row}"
        ]


        if rows:
            subtotal_cell.value = (
                f"=SUM("
                f"{subtotal_letter}"
                f"{first_data_row}:"
                f"{subtotal_letter}"
                f"{last_data_row}"
                f")"
            )

        else:
            subtotal_cell.value = 0


        subtotal_cell.font = Font(
            name="Arial",
            bold=True,
            size=10,
            color=C_WHITE
        )


        subtotal_cell.fill = fill(
            C_SECONDARY
        )


        subtotal_cell.alignment = (
            alignment(
                "right"
            )
        )


        subtotal_cell.border = (
            MEDIUM
        )


        apply_number_format(
            subtotal_cell,
            subtotal_column.get(
                "type",
                "decimal"
            ),
            currency
        )


        row += 2


    # ── Notes / commercial basis ───────────────────────────────

    note_parts = []


    description = str(
        section.get(
            "description",
            ""
        )
        or
        ""
    ).strip()


    if description:
        note_parts.append(
            description
        )


    for note in (
        section.get(
            "notes",
            []
        )
        or
        []
    ):
        text = str(
            note
        ).strip()

        if text:
            note_parts.append(
                text
            )


    rate_columns = [
        str(
            column.get(
                "label",
                ""
            )
        )
        for column
        in all_columns
        if (
            column.get(
                "editable",
                False
            )
            and
            column.get(
                "type"
            )
            ==
            "currency"
            and
            is_rate_like(
                column
            )
        )
    ]


    if rate_columns:
        note_parts.append(
            (
                "Highlighted commercial rate/cost cells may be revised "
                "for vendor quotation; calculated amount and subtotal "
                "cells update automatically."
            )
        )


    if note_parts:
        note_text = (
            "  |  ".join(
                note_parts
            )
        )

        note_cell = ws.cell(
            row,
            2,
            note_text
        )

        note_cell.font = Font(
            name="Arial",
            size=8,
            color=C_MUTED,
            italic=True
        )

        note_cell.alignment = (
            alignment(
                "left"
            )
        )

        ws.merge_cells(
            f"B{row}:"
            f"{last_col_letter}{row}"
        )

        ws.row_dimensions[
            row
        ].height = (
            40
            if len(
                note_text
            ) > 180
            else
            24
        )


    # ── Usability / printing ───────────────────────────────────

    ws.freeze_panes = (
        f"{first_text_letter}5"
    )


    if rows:
        ws.auto_filter.ref = (
            f"B4:"
            f"{last_col_letter}"
            f"{last_data_row}"
        )


    ws.print_title_rows = (
        "1:4"
    )


    ws.page_setup.orientation = (
        "landscape"
    )


    ws.page_setup.fitToPage = (
        True
    )


    ws.page_setup.fitToWidth = (
        1
    )


    ws.page_margins.left = (
        0.25
    )


    ws.page_margins.right = (
        0.25
    )


    ws.page_margins.top = (
        0.5
    )


    ws.page_margins.bottom = (
        0.5
    )


    section[
        "_subtotal_letter"
    ] = subtotal_letter


    section[
        "_subtotal_row"
    ] = subtotal_row


# ═══════════════════════════════════════════════════════════════
# SUMMARY SHEET
# ═══════════════════════════════════════════════════════════════

smry = wb.create_sheet(
    "SUMMARY"
)

smry.sheet_view.showGridLines = False


for (
    col,
    width
) in zip(
    "ABCDEFGH",
    [
        3,
        6,
        40,
        14,
        20,
        20,
        18,
        3
    ]
):
    smry.column_dimensions[
        col
    ].width = width


smry.merge_cells(
    "B1:G1"
)


cell = smry["B1"]


cell.value = (
    "BILL OF QUANTITIES — "
    "PROJECT SUMMARY"
)


cell.font = Font(
    name="Arial",
    bold=True,
    size=13,
    color=C_WHITE
)


cell.fill = fill(
    C_PRIMARY
)


cell.alignment = (
    alignment()
)


smry.row_dimensions[
    1
].height = 34


smry.merge_cells(
    "B2:G2"
)


cell = smry["B2"]


cell.value = (
    project_title
)


cell.font = Font(
    name="Arial",
    bold=True,
    size=10,
    color=C_PRIMARY,
    italic=True
)


cell.alignment = (
    alignment()
)


smry.row_dimensions[
    2
].height = 18


smry.row_dimensions[
    3
].height = 6


amount_header = (
    f"Est. Amount ({currency})"
    if currency
    else
    "Estimated Amount"
)


headers = [
    "S.No.",
    "Work Category",
    "No. of Items",
    "Sheet Reference",
    amount_header,
    "Remarks"
]


header_columns = (
    "BCDEFG"
)


row = 4


smry.row_dimensions[
    row
].height = 28


for (
    col,
    header
) in zip(
    header_columns,
    headers
):
    cell = smry[
        f"{col}{row}"
    ]

    cell.value = (
        header
    )

    cell.font = font(
        bold=True,
        size=10,
        color=C_WHITE
    )

    cell.fill = fill(
        C_SECONDARY
    )

    cell.alignment = (
        alignment()
    )

    cell.border = border(
        "medium",
        C_PRIMARY
    )


row = 5


total_cells = []


for (
    index,
    section
) in enumerate(
    sections,
    1
):
    smry.row_dimensions[
        row
    ].height = 22


    alternate_fill = (
        C_LIGHTER
        if index % 2 == 0
        else
        C_WHITE
    )


    sheet_name = (
        section[
            "_sheet_name"
        ]
    )


    number_of_items = len(
        section.get(
            "rows",
            []
        )
    )


    subtotal_letter = (
        section.get(
            "_subtotal_letter"
        )
    )


    subtotal_row = (
        section.get(
            "_subtotal_row"
        )
    )


    if (
        subtotal_letter
        and
        subtotal_row
    ):
        amount_value = (
            f"='{sheet_name}'!"
            f"{subtotal_letter}"
            f"{subtotal_row}"
        )

        remarks = ""

    else:
        amount_value = None

        remarks = (
            "No financial subtotal defined"
        )


    cells_data = [
        (
            f"B{row}",
            str(index),
            alignment()
        ),
        (
            f"C{row}",
            section.get(
                "title",
                ""
            ),
            alignment(
                "left"
            )
        ),
        (
            f"D{row}",
            number_of_items,
            alignment()
        ),
        (
            f"E{row}",
            sheet_name,
            alignment()
        ),
        (
            f"F{row}",
            amount_value,
            alignment(
                "right"
            )
        ),
        (
            f"G{row}",
            remarks,
            alignment(
                "left"
            )
        ),
    ]


    for (
        address,
        value,
        cell_alignment
    ) in cells_data:

        cell = smry[
            address
        ]

        if value is not None:
            cell.value = (
                value
            )

        cell.fill = fill(
            alternate_fill
        )

        cell.border = (
            THIN
        )

        cell.alignment = (
            cell_alignment
        )

        cell.font = font(
            size=10
        )

        if address.startswith(
            "F"
        ):
            cell.number_format = (
                currency_number_format(
                    currency
                )
            )


    if amount_value is not None:
        total_cells.append(
            f"F{row}"
        )


    row += 1


smry.row_dimensions[
    row
].height = 30


smry.merge_cells(
    f"B{row}:E{row}"
)


cell = smry[
    f"B{row}"
]


cell.value = (
    "GRAND TOTAL "
    "(All Works Combined)"
)


cell.font = Font(
    name="Arial",
    bold=True,
    size=11,
    color=C_WHITE
)


cell.fill = fill(
    C_PRIMARY
)


cell.alignment = (
    alignment()
)


cell.border = (
    MEDIUM
)


amount_cell = smry[
    f"F{row}"
]


amount_cell.value = (
    "=" +
    "+".join(
        total_cells
    )
    if total_cells
    else
    None
)


amount_cell.font = Font(
    name="Arial",
    bold=True,
    size=11,
    color=C_WHITE
)


amount_cell.fill = fill(
    C_PRIMARY
)


amount_cell.number_format = (
    currency_number_format(
        currency
    )
)


amount_cell.alignment = (
    alignment(
        "right"
    )
)


amount_cell.border = (
    MEDIUM
)


cell = smry[
    f"G{row}"
]


cell.fill = fill(
    C_PRIMARY
)


cell.border = (
    MEDIUM
)


row += 2


summary_remarks = str(
    summary_config.get(
        "remarks",
        ""
    )
    or
    ""
).strip()


summary_note = (
    summary_remarks
    if summary_remarks
    else
    (
        "Note: Values are generated from the project-specific BOQ schema. "
        "Estimated/indicative rates should be validated through vendor "
        "quotations before commercial commitment."
    )
)


cell = smry.cell(
    row,
    2,
    summary_note
)


cell.font = Font(
    name="Arial",
    size=8,
    color=C_MUTED,
    italic=True
)


cell.alignment = (
    alignment(
        "left"
    )
)


smry.merge_cells(
    f"B{row}:G{row}"
)


smry.row_dimensions[
    row
].height = 30


smry.freeze_panes = (
    "B5"
)


smry.print_title_rows = (
    "1:4"
)


smry.page_setup.orientation = (
    "landscape"
)


smry.page_setup.fitToPage = (
    True
)


smry.page_setup.fitToWidth = (
    1
)


# Workbook order:
# COVER -> SUMMARY -> section sheets

wb.move_sheet(
    "SUMMARY",
    offset=-len(
        sections
    )
)


wb.save(
    ${JSON.stringify(outputPath)}
)


print("OK")
`;
}

/* ═══════════════════════════════════════════════════════════════
   PYTHON EXECUTION
═══════════════════════════════════════════════════════════════ */

function resolvePythonCommand() {
    if (
        process.env.PYTHON_COMMAND &&
        process.env.PYTHON_COMMAND.trim()
    ) {
        return process.env.PYTHON_COMMAND.trim();
    }

    return process.platform ===
        "win32"
        ? "python"
        : "python3";
}

/* ═══════════════════════════════════════════════════════════════
   MAIN EXPORT
═══════════════════════════════════════════════════════════════ */

async function generateBOQExcel(
    boqContent,
    title = "Project BOQ"
) {
    const data =
        normalizeBOQInput(
            boqContent,
            title
        );

    if (!data.document) {
        data.document = {};
    }

    if (
        !data.document.title
    ) {
        data.document.title =
            title ||
            "Project BOQ";
    }

    if (
        !Array.isArray(
            data.sections
        )
    ) {
        throw new Error(
            "Invalid BOQ: sections array is missing."
        );
    }

    const uniqueId = [
        Date.now(),
        process.pid,
        Math.random()
            .toString(36)
            .slice(2, 8),
    ].join("_");

    const tmpDir =
        os.tmpdir();

    const dataPath =
        path.join(
            tmpDir,
            `boq_data_${uniqueId}.json`
        );

    const outputPath =
        path.join(
            tmpDir,
            `boq_out_${uniqueId}.xlsx`
        );

    const scriptPath =
        path.join(
            tmpDir,
            `boq_gen_${uniqueId}.py`
        );

    fs.writeFileSync(
        dataPath,

        JSON.stringify(
            data,
            null,
            2
        ),

        "utf8"
    );

    fs.writeFileSync(
        scriptPath,

        buildPythonScript(
            dataPath,
            outputPath
        ),

        "utf8"
    );

    try {
        const pythonCommand =
            resolvePythonCommand();

        execFileSync(
            pythonCommand,

            [
                scriptPath
            ],

            {
                timeout:
                    120000,

                windowsHide:
                    true,

                stdio: [
                    "ignore",
                    "pipe",
                    "pipe",
                ],
            }
        );

        if (
            !fs.existsSync(
                outputPath
            )
        ) {
            throw new Error(
                "Python completed but no XLSX file was created."
            );
        }

        return fs.readFileSync(
            outputPath
        );
    } catch (error) {
        const stderr =
            error?.stderr &&
                typeof error.stderr
                    .toString ===
                "function"
                ? error.stderr
                    .toString()
                    .trim()
                : "";

        const message =
            stderr ||
            error?.message ||
            "Unknown Excel generation error";

        throw new Error(
            `Excel generation failed: ${message}`
        );
    } finally {
        for (
            const filePath
            of [
                dataPath,
                scriptPath,
                outputPath,
            ]
        ) {
            try {
                if (
                    fs.existsSync(
                        filePath
                    )
                ) {
                    fs.unlinkSync(
                        filePath
                    );
                }
            } catch {
                /*
                 * Cleanup failure must never
                 * hide the actual generation
                 * result or error.
                 */
            }
        }
    }
}

module.exports = {
    generateBOQExcel,
};



// /**
//  * generateBOQExcel.js
//  * Production-level multi-work BOQ Excel generator with FULLY DYNAMIC columns.
//  *
//  * Each work category in the AI markdown declares its own table header row,
//  * which can differ from every other category (extra Brand/Make, Grade,
//  * Rating/Capacity, Material/Finish columns etc). This file:
//  *   1. Parses that markdown WITHOUT assuming a fixed column layout
//  *   2. Builds one Excel sheet per work category with that category's
//  *      own columns, auto-inserting a system-calculated "Amount (INR)"
//  *      column right after whichever column is the Unit Rate column
//  *   3. Builds a SUMMARY sheet that links to each work sheet's subtotal
//  *   4. Builds a COVER sheet with project metadata + category index
//  *
//  * Sheets: COVER, SUMMARY, + one sheet per work category.
//  */

// const { execSync } = require("child_process");
// const fs = require("fs");
// const path = require("path");
// const os = require("os");

// /* ═══════════════════════════════════════════════════════════════
//    PARSE AI MARKDOWN — fully dynamic, header-row driven
// ═══════════════════════════════════════════════════════════════ */
// function parseMarkdown(markdown) {
//   const lines = markdown.split("\n");
//   const result = { title: "Multi-Work BOQ", meta: {}, summary: "", works: [], terms: [] };

//   let section = null;
//   let currentWork = null;
//   const summaryLines = [];
//   const termsLines = [];

//   // Column-name keyword sets used to recognize a header row regardless of
//   // exact wording / column count, and to recognize a markdown divider row.
//   const HEADER_HINTS = ["s.no", "sno", "sl no", "item description", "description", "item"];
//   const isDividerRow = (t) => /^\|[\s\-:|]+\|?$/.test(t);

//   for (const raw of lines) {
//     const t = raw.trim();
//     if (!t) continue;

//     // ── Section detection from ## headings ──────────────────────────────
//     if (t.startsWith("## ")) {
//       const h = t.replace(/^##\s+/, "").toLowerCase();
//       if (h.match(/project.?overview|^\d+\.\s*project/)) section = "meta";
//       else if (h.match(/executive.?summary|^summary/)) section = "summary";
//       else if (h.match(/bill.?of.?quantities|boq|scope.?of.?work|work.?items|work.?categor|work.?detail/)) section = "boq";
//       else if (h.match(/terms|condition|submission/)) section = "terms";
//       else section = "other";
//       continue;
//     }

//     if (t.startsWith("# ")) {
//       result.title = t.replace(/^#\s+/, "").replace(/\*\*/g, "").trim();
//       continue;
//     }

//     if (section === "boq") {
//       // ── New work category (### heading or **Bold** standalone line) ───
//       const isSub = t.startsWith("### ") || (t.startsWith("**") && t.endsWith("**") && !t.includes("|"));
//       if (isSub) {
//         const name = t.replace(/^###\s+/, "").replace(/\*\*/g, "").trim();
//         currentWork = { name, items: [], columns: null };
//         result.works.push(currentWork);
//         continue;
//       }

//       // ── Pipe-table rows ─────────────────────────────────────────────
//       if (t.includes("|")) {
//         if (isDividerRow(t)) continue; // skip |---|---| divider rows

//         const cells = t.split("|").map(c => c.trim()).filter((c, i, arr) => {
//           // keep empty cells in the middle, only drop the leading/trailing
//           // artifacts from a row that starts/ends with "|"
//           return true;
//         }).filter(c => c.length > 0 || true);

//         // Re-split properly: markdown rows like "| a | b | c |" produce
//         // ["", "a", "b", "c", ""] after split("|") — strip the outer empties.
//         const rawCells = t.split("|");
//         const trimmedCells = rawCells.map(c => c.trim());
//         // drop first/last if they're empty (typical "| ... |" wrapper)
//         if (trimmedCells.length && trimmedCells[0] === "") trimmedCells.shift();
//         if (trimmedCells.length && trimmedCells[trimmedCells.length - 1] === "") trimmedCells.pop();
//         const rowCells = trimmedCells;

//         if (!currentWork) {
//           currentWork = { name: "General Works", items: [], columns: null };
//           result.works.push(currentWork);
//         }

//         const lowerCells = rowCells.map(c => c.toLowerCase());
//         const looksLikeHeader = HEADER_HINTS.some(hint => lowerCells.some(c => c.includes(hint)));

//         if (looksLikeHeader && !currentWork.columns) {
//           // First header row for this work category — capture its exact
//           // column names. This defines the schema for every row that follows.
//           currentWork.columns = rowCells.map(c => c.replace(/\*\*/g, "").trim());
//           continue;
//         }
//         if (looksLikeHeader) continue; // a repeated/duplicate header row later — skip

//         if (!currentWork.columns) {
//           // Defensive fallback if AI ever emits a data row before a header
//           // (shouldn't happen given the prompt, but never crash on it).
//           currentWork.columns = [
//             "S.No.", "Item Description", "Unit", "Est. Qty",
//             "Brand/Make", "Unit Rate (INR)", "Specifications / Notes",
//           ];
//         }

//         // Map this row's cells onto the named columns positionally.
//         const rowObj = {};
//         currentWork.columns.forEach((colName, idx) => {
//           rowObj[colName] = rowCells[idx] !== undefined ? rowCells[idx] : "";
//         });
//         currentWork.items.push(rowObj);
//         continue;
//       }

//       // ── Non-pipe numbered line item fallback (e.g. "1. Item - Unit - Qty") ──
//       if (/^\d+[\.\)]\s/.test(t)) {
//         if (!currentWork) {
//           currentWork = { name: "General Works", items: [], columns: null };
//           result.works.push(currentWork);
//         }
//         if (!currentWork.columns) {
//           currentWork.columns = [
//             "S.No.", "Item Description", "Unit", "Est. Qty",
//             "Brand/Make", "Unit Rate (INR)", "Specifications / Notes",
//           ];
//         }
//         const parts = t.split(/\s*[-–|]\s*/);
//         const rowObj = {};
//         const cols = currentWork.columns;
//         rowObj[cols[0]] = (t.match(/^\d+/) || [""])[0];
//         rowObj[cols[1]] = (parts[0] || "").replace(/^\d+[\.\)]\s*/, "").trim();
//         if (cols[2]) rowObj[cols[2]] = parts[1] || "Lot";
//         if (cols[3]) rowObj[cols[3]] = parts[2] || "1";
//         if (cols[4]) rowObj[cols[4]] = parts[3] || "";
//         currentWork.items.push(rowObj);
//         continue;
//       }
//     }

//     // ── Project meta fields ("- Key: Value" lines under PROJECT OVERVIEW) ──
//     if (section === "meta" && t.includes(":")) {
//       const ci = t.indexOf(":");
//       const key = t.slice(0, ci).replace(/[-*•\d.]/g, "").trim();
//       const val = t.slice(ci + 1).trim().replace(/\*\*/g, "");
//       if (key && key.length < 50) {
//         result.meta[key] = val;
//         if (key.toLowerCase().includes("title")) result.title = val;
//       }
//     }

//     if (section === "summary") summaryLines.push(t.replace(/\*\*/g, ""));
//     if (section === "terms") termsLines.push(t.replace(/^[-*•]\s*/, "").replace(/\*\*/g, ""));
//   }

//   result.summary = summaryLines.join(" ");
//   result.terms = termsLines.filter(Boolean);

//   if (result.works.length === 0) {
//     result.works.push({ name: "Bill of Quantities", items: [], columns: null });
//   }

//   // Guarantee every work has a columns array, even if it had zero items parsed.
//   const DEFAULT_COLUMNS = [
//     "S.No.", "Item Description", "Unit", "Est. Qty",
//     "Brand/Make", "Unit Rate (INR)", "Specifications / Notes",
//   ];
//   result.works.forEach(w => {
//     if (!w.columns || w.columns.length === 0) w.columns = DEFAULT_COLUMNS;
//   });

//   return result;
// }

// /* ═══════════════════════════════════════════════════════════════
//    PYTHON SCRIPT BUILDER
//    Builds the actual .xlsx using openpyxl, with fully dynamic
//    per-sheet column layouts.
// ═══════════════════════════════════════════════════════════════ */
// function buildPythonScript(dataPath, outputPath) {
//   return `
// import json, re, openpyxl
// from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
// from openpyxl.utils import get_column_letter
// from datetime import datetime

// with open(${JSON.stringify(dataPath)}, "r", encoding="utf-8") as f:
//     data = json.load(f)

// wb = openpyxl.Workbook()
// wb.remove(wb.active)

// C_PRIMARY    = "1B5E20"
// C_SECONDARY  = "2E7D32"
// C_ACCENT     = "4CAF50"
// C_LIGHT      = "E8F5E9"
// C_LIGHTER    = "F1F8E9"
// C_WHITE      = "FFFFFF"
// C_BODY       = "212121"
// C_MUTED      = "616161"
// C_RATE_BG    = "FFFDE7"
// C_RATE_TXT   = "E65100"
// C_RATE_OK_BG = "E8F5E9"
// C_RATE_OK_TXT = "1B5E20"

// def fill(c): return PatternFill("solid", fgColor=c)
// def fn(bold=False, size=10, color=C_BODY, italic=False):
//     return Font(name="Arial", bold=bold, size=size, color=color, italic=italic)
// def side(style="thin", color="BDBDBD"): return Side(style=style, color=color)
// def bdr(style="thin", color="BDBDBD"):
//     s = side(style, color)
//     return Border(left=s, right=s, top=s, bottom=s)
// def aln(h="center", wrap=True): return Alignment(horizontal=h, vertical="center", wrap_text=wrap)

// THIN   = bdr()
// MEDIUM = bdr("medium", C_PRIMARY)

// def safe_name(name):
//     name = re.sub(r'[\\\\/*?\\[\\]:]', '', str(name))
//     name = name.strip() or "Work"
//     return name[:31]

// def find_col_index(columns, *keywords):
//     for i, col in enumerate(columns):
//         cl = col.lower()
//         if any(kw in cl for kw in keywords):
//             return i
//     return None

// def clean_number(raw, default=None):
//     if raw is None:
//         return default
//     s = str(raw).strip()
//     s = s.replace(",", "").replace("\\u20b9", "").replace("Rs.", "").replace("INR", "")
//     s = re.sub(r"\\(est\\.?\\)", "", s, flags=re.IGNORECASE).strip()
//     if s == "" or s in ["-", "TBD", "N/A", "NA"]:
//         return default
//     try:
//         return float(s)
//     except ValueError:
//         m = re.search(r"[\\d.]+", s)
//         if m:
//             try:
//                 return float(m.group())
//             except ValueError:
//                 return default
//         return default

// # ════════════════════════════════════════════════════════════════════════════
// # WORK CATEGORY COLUMN PLANNING — done once, shared by sheet build + summary
// # ════════════════════════════════════════════════════════════════════════════
// works = data.get("works", [])

// for work in works:
//     user_columns = work.get("columns") or [
//         "S.No.", "Item Description", "Unit", "Est. Qty",
//         "Brand/Make", "Unit Rate (INR)", "Specifications / Notes",
//     ]
//     user_columns = [str(c).strip() for c in user_columns if str(c).strip()]
//     if not user_columns:
//         user_columns = [
//             "S.No.", "Item Description", "Unit", "Est. Qty",
//             "Brand/Make", "Unit Rate (INR)", "Specifications / Notes",
//         ]

//     desc_idx = find_col_index(user_columns, "description", "item")
//     if desc_idx is None:
//         desc_idx = 1 if len(user_columns) > 1 else 0

//     qty_idx = find_col_index(user_columns, "qty", "quantity")
//     rate_idx = find_col_index(user_columns, "rate")

//     final_columns = list(user_columns)
//     if rate_idx is not None:
//         amount_insert_at = rate_idx + 1
//     else:
//         # no rate column authored — append Rate then Amount at the end
//         final_columns.append("Unit Rate (INR)")
//         rate_idx = len(final_columns) - 1
//         amount_insert_at = rate_idx + 1
//     final_columns.insert(amount_insert_at, "Amount (INR)")

//     work["_user_columns"] = user_columns
//     work["_final_columns"] = final_columns
//     work["_desc_idx"] = desc_idx
//     work["_qty_idx"] = qty_idx
//     work["_rate_idx"] = rate_idx
//     work["_amount_at"] = amount_insert_at
//     work["_sheet_name"] = safe_name(work["name"])

// # ════════════════════════════════════════════════════════════════════════════
// # SHEET 1 — COVER
// # ════════════════════════════════════════════════════════════════════════════
// cov = wb.create_sheet("COVER")
// cov.sheet_view.showGridLines = False
// for col, w in zip("ABCDE", [3, 30, 50, 3, 3]):
//     cov.column_dimensions[col].width = w

// for r in range(1, 5):
//     for col in "ABCDE":
//         cov[f"{col}{r}"].fill = fill(C_PRIMARY)
//     cov.row_dimensions[r].height = 10

// cov.merge_cells("B5:C5")
// c = cov["B5"]
// c.value = "BILL OF QUANTITIES"
// c.font = Font(name="Arial", bold=True, size=26, color=C_PRIMARY)
// c.alignment = aln()
// cov.row_dimensions[5].height = 46

// cov.merge_cells("B6:C6")
// c = cov["B6"]
// c.value = "MULTI-WORK PROJECT BOQ & REQUIREMENTS DOCUMENT"
// c.font = Font(name="Arial", bold=True, size=11, color=C_SECONDARY, italic=True)
// c.alignment = aln()
// cov.row_dimensions[6].height = 20

// cov.merge_cells("B7:C7")
// cov["B7"].fill = fill(C_ACCENT)
// cov.row_dimensions[7].height = 5

// cov.row_dimensions[8].height = 12

// cov.merge_cells("B9:C9")
// c = cov["B9"]
// c.value = str(data.get("title", "Project BOQ")).upper()
// c.font = Font(name="Arial", bold=True, size=15, color=C_BODY)
// c.alignment = aln()
// cov.row_dimensions[9].height = 30

// cov.row_dimensions[10].height = 10

// meta = data.get("meta", {})
// doc_ref = "BOQ-" + datetime.now().strftime("%Y%m%d%H%M")
// now = datetime.now()
// date_str = f"{now.day} {now.strftime('%B %Y')}"

// SKIP_META_KEYS = ["project title", "title", "document reference", "prepared date", "prepared on"]
// meta_rows = []
// for k, v in meta.items():
//     if k.lower().strip() not in SKIP_META_KEYS:
//         meta_rows.append((k, str(v)))
// meta_rows += [
//     ("Document Reference", doc_ref),
//     ("Prepared On",        date_str),
//     ("Status",             "DRAFT — For Vendor Quotation"),
//     ("Confidential",       "Yes — Do not distribute without authorization"),
// ]

// row = 11
// for k, v in meta_rows:
//     cov.row_dimensions[row].height = 22
//     kb = cov.cell(row, 2, k)
//     kb.font = fn(bold=True, size=10, color=C_PRIMARY)
//     kb.fill = fill(C_LIGHT)
//     kb.border = bdr("thin", C_ACCENT)
//     kb.alignment = aln("left")

//     vb = cov.cell(row, 3, v)
//     vb.font = fn(size=10)
//     vb.border = THIN
//     vb.alignment = aln("left")
//     row += 1

// cov.row_dimensions[row].height = 12
// row += 1

// cov.merge_cells(f"B{row}:C{row}")
// c = cov.cell(row, 2, "WORK CATEGORIES INCLUDED IN THIS BOQ")
// c.font = fn(bold=True, size=10, color=C_SECONDARY)
// c.alignment = aln("left")
// cov.row_dimensions[row].height = 20
// row += 1

// for idx, work in enumerate(works, 1):
//     cov.row_dimensions[row].height = 18
//     nb = cov.cell(row, 2, f"  {idx}.")
//     nb.font = fn(bold=True, color=C_PRIMARY)
//     nb.alignment = aln("left")
//     wc = cov.cell(row, 3, f"{work['name']}  ({len(work.get('items', []))} items)")
//     wc.font = fn(size=10)
//     wc.alignment = aln("left")
//     row += 1

// row += 1
// c = cov.cell(row, 2, "This document is intended for qualified vendors only. Confidential & Proprietary.")
// c.font = Font(name="Arial", size=8, color=C_MUTED, italic=True)
// cov.merge_cells(f"B{row}:C{row}")

// row += 2
// for r2 in range(row, row + 3):
//     for col in "ABCDE":
//         cov[f"{col}{r2}"].fill = fill(C_PRIMARY)
//     cov.row_dimensions[r2].height = 8

// cov.page_setup.fitToPage = True

// # ════════════════════════════════════════════════════════════════════════════
// # SHEETS 3+ — INDIVIDUAL WORK CATEGORY SHEETS (built BEFORE summary so we
// # know each sheet's exact amount-column letter and subtotal row for linking)
// # ════════════════════════════════════════════════════════════════════════════
// for work in works:
//     ws = wb.create_sheet(work["_sheet_name"])
//     ws.sheet_view.showGridLines = False

//     final_columns = work["_final_columns"]
//     rate_idx = work["_rate_idx"]
//     amount_at = work["_amount_at"]
//     desc_idx = work["_desc_idx"]
//     qty_idx = work["_qty_idx"]
//     n_cols = len(final_columns)

//     col_letters = [get_column_letter(i) for i in range(2, 2 + n_cols)]
//     last_col_letter = col_letters[-1]
//     rate_letter = col_letters[amount_at - 1]
//     amount_letter = col_letters[amount_at]
//     desc_letter = col_letters[desc_idx] if desc_idx < len(col_letters) else col_letters[0]

//     ws.column_dimensions["A"].width = 3
//     for i, col_name in enumerate(final_columns):
//         letter = col_letters[i]
//         cl = col_name.lower()
//         if "description" in cl or ("item" in cl and "no" not in cl):
//             w = 40
//         elif "spec" in cl or "note" in cl:
//             w = 38
//         elif "brand" in cl or "make" in cl:
//             w = 22
//         elif "grade" in cl or "finish" in cl or "material" in cl or "rating" in cl or "capacity" in cl or "resolution" in cl or "spec" in cl:
//             w = 20
//         elif "rate" in cl or "amount" in cl:
//             w = 16
//         elif "s.no" in cl or "sno" in cl or "sl no" in cl:
//             w = 7
//         elif "unit" in cl and "rate" not in cl:
//             w = 10
//         elif "qty" in cl or "quantity" in cl:
//             w = 11
//         else:
//             w = 16
//         ws.column_dimensions[letter].width = w

//     # ── Sheet title band ──────────────────────────────────────────────────
//     ws.merge_cells(f"B1:{last_col_letter}1")
//     c = ws["B1"]
//     c.value = f"BOQ — {work['name'].upper()}"
//     c.font = Font(name="Arial", bold=True, size=13, color=C_WHITE)
//     c.fill = fill(C_PRIMARY)
//     c.alignment = aln()
//     ws.row_dimensions[1].height = 34
//     for letter in col_letters:
//         ws[f"{letter}1"].fill = fill(C_PRIMARY)

//     ws.merge_cells(f"B2:{last_col_letter}2")
//     c = ws["B2"]
//     c.value = f"Project: {data.get('title','')}    |    Work Category: {work['name']}"
//     c.font = Font(name="Arial", bold=True, size=9, color=C_SECONDARY, italic=True)
//     c.alignment = aln()
//     ws.row_dimensions[2].height = 16

//     ws.merge_cells(f"B3:{last_col_letter}3")
//     c = ws["B3"]
//     prepared_date = f"{datetime.now().day} {datetime.now().strftime('%B %Y')}"
//     c.value = f"Prepared: {prepared_date}    |    Status: DRAFT — For Vendor Quotation    |    Editable rate cells are highlighted"
//     c.font = Font(name="Arial", size=8, color=C_MUTED, italic=True)
//     c.alignment = aln()
//     ws.row_dimensions[3].height = 14

//     # ── Column header row ──────────────────────────────────────────────────
//     row = 4
//     ws.row_dimensions[row].height = 32
//     for letter, h in zip(col_letters, final_columns):
//         c = ws[f"{letter}{row}"]
//         c.value = h
//         c.font = fn(bold=True, size=10, color=C_WHITE)
//         c.fill = fill(C_SECONDARY)
//         c.alignment = aln()
//         c.border = bdr("medium", C_PRIMARY)

//     # ── Data rows ───────────────────────────────────────────────────────────
//     items = work.get("items", [])
//     user_columns = work["_user_columns"]
//     row = 5
//     for idx, item in enumerate(items):
//         ws.row_dimensions[row].height = 32
//         alt = C_LIGHTER if idx % 2 == 0 else C_WHITE

//         qty_val = None
//         if qty_idx is not None and qty_idx < len(user_columns):
//             qty_val = clean_number(item.get(user_columns[qty_idx]), default=1)
//         if qty_val is None:
//             qty_val = 1

//         rate_col_name = user_columns[rate_idx] if rate_idx < len(user_columns) else None
//         rate_val = clean_number(item.get(rate_col_name)) if rate_col_name else None

//         col_cursor = 0
//         for ui, user_col in enumerate(user_columns):
//             letter = col_letters[col_cursor]
//             addr = f"{letter}{row}"
//             c = ws[addr]

//             if ui == desc_idx:
//                 value = item.get(user_col, "")
//                 c.alignment = aln("left")
//             elif ui == rate_idx:
//                 value = rate_val
//                 c.alignment = aln("right")
//             elif qty_idx is not None and ui == qty_idx:
//                 value = qty_val
//                 c.alignment = aln()
//             else:
//                 value = item.get(user_col, "")
//                 cl = user_col.lower()
//                 if "spec" in cl or "note" in cl:
//                     c.alignment = aln("left")
//                 else:
//                     c.alignment = aln()

//             if value is not None and value != "":
//                 c.value = value
//             c.fill = fill(alt)
//             c.border = THIN
//             c.font = fn(size=10)

//             if ui == rate_idx:
//                 c.number_format = "#,##0.00"
//                 if rate_val is not None:
//                     c.fill = fill(C_RATE_OK_BG)
//                     c.font = Font(name="Arial", size=10, color=C_RATE_OK_TXT)
//                 else:
//                     c.fill = fill(C_RATE_BG)
//                     c.font = Font(name="Arial", size=10, color=C_RATE_TXT)

//             col_cursor += 1

//             if ui == rate_idx:
//                 amt_letter = col_letters[col_cursor]
//                 ac = ws[f"{amt_letter}{row}"]
//                 ac.value = f"=IF({letter}{row}=\\"\\",0,{col_letters[qty_idx] if qty_idx is not None else letter}{row}*{letter}{row})"
//                 ac.fill = fill(alt)
//                 ac.border = THIN
//                 ac.alignment = aln("right")
//                 ac.font = fn(size=10, bold=False)
//                 ac.number_format = "#,##0.00"
//                 col_cursor += 1

//         row += 1

//     # ── Subtotal row ────────────────────────────────────────────────────────
//     ws.row_dimensions[row].height = 28
//     label_end_letter = col_letters[max(amount_at - 1, 0)]
//     ws.merge_cells(f"B{row}:{label_end_letter}{row}")
//     c = ws[f"B{row}"]
//     c.value = f"SUB-TOTAL — {work['name']}"
//     c.font = Font(name="Arial", bold=True, size=10, color=C_WHITE)
//     c.fill = fill(C_SECONDARY)
//     c.alignment = aln()
//     c.border = MEDIUM
//     for letter in col_letters[:amount_at]:
//         ws[f"{letter}{row}"].fill = fill(C_SECONDARY)
//         ws[f"{letter}{row}"].border = MEDIUM

//     amt = ws[f"{amount_letter}{row}"]
//     amt.value = f"=SUM({amount_letter}5:{amount_letter}{row-1})" if items else 0
//     amt.font = Font(name="Arial", bold=True, size=10, color=C_WHITE)
//     amt.fill = fill(C_SECONDARY)
//     amt.number_format = "#,##0.00"
//     amt.alignment = aln("right")
//     amt.border = MEDIUM

//     for letter in col_letters[amount_at + 1:]:
//         ws[f"{letter}{row}"].fill = fill(C_SECONDARY)
//         ws[f"{letter}{row}"].border = MEDIUM

//     subtotal_row = row
//     row += 2
//     rate_col_label = final_columns[amount_at - 1]
//     amount_col_label = final_columns[amount_at]
//     note_text = f"Please fill or review {rate_col_label} (highlighted cells) to auto-calculate {amount_col_label}. All totals flow to the SUMMARY sheet automatically."
//     c = ws.cell(row, 2, note_text)
//     c.font = Font(name="Arial", size=8, color=C_MUTED, italic=True)
//     ws.merge_cells(f"B{row}:{last_col_letter}{row}")

//     ws.freeze_panes = f"{desc_letter}5"
//     ws.page_setup.orientation = "landscape"
//     ws.page_setup.fitToPage = True
//     ws.page_setup.fitToWidth = 1

//     work["_amount_letter"] = amount_letter
//     work["_subtotal_row"] = subtotal_row

// # ════════════════════════════════════════════════════════════════════════════
// # SHEET 2 (logically) — SUMMARY, built after work sheets so subtotal refs exist.
// # Repositioned to sit right after COVER in the tab order.
// # ════════════════════════════════════════════════════════════════════════════
// smry = wb.create_sheet("SUMMARY")
// smry.sheet_view.showGridLines = False
// for col, w in zip("ABCDEFGH", [3, 6, 40, 14, 20, 18, 10, 3]):
//     smry.column_dimensions[col].width = w

// smry.merge_cells("B1:G1")
// c = smry["B1"]
// c.value = "BILL OF QUANTITIES — PROJECT SUMMARY"
// c.font = Font(name="Arial", bold=True, size=13, color=C_WHITE)
// c.fill = fill(C_PRIMARY)
// c.alignment = aln()
// smry.row_dimensions[1].height = 34

// smry.merge_cells("B2:G2")
// c = smry["B2"]
// c.value = data.get("title", "")
// c.font = Font(name="Arial", bold=True, size=10, color=C_PRIMARY, italic=True)
// c.alignment = aln()
// smry.row_dimensions[2].height = 18

// smry.row_dimensions[3].height = 6

// hdrs = ["S.No.", "Work Category", "No. of Items", "Sheet Reference", "Est. Amount (INR)", "Remarks"]
// h_cols = "BCDEFG"
// row = 4
// smry.row_dimensions[row].height = 28
// for col, h in zip(h_cols, hdrs):
//     c = smry[f"{col}{row}"]
//     c.value = h
//     c.font = fn(bold=True, size=10, color=C_WHITE)
//     c.fill = fill(C_SECONDARY)
//     c.alignment = aln()
//     c.border = bdr("medium", C_PRIMARY)

// row = 5
// total_cells = []
// for idx, work in enumerate(works, 1):
//     smry.row_dimensions[row].height = 22
//     alt = C_LIGHTER if idx % 2 == 0 else C_WHITE
//     sname = work["_sheet_name"]
//     n_items = len(work.get("items", []))
//     amount_letter = work.get("_amount_letter", "G")
//     subtotal_row = work.get("_subtotal_row", 4 + n_items + 1)

//     cells_data = [
//         (f"B{row}", str(idx),                                  aln()),
//         (f"C{row}", work["name"],                               aln("left")),
//         (f"D{row}", n_items,                                    aln()),
//         (f"E{row}", sname,                                      aln()),
//         (f"F{row}", f"='{sname}'!{amount_letter}{subtotal_row}", aln("right")),
//         (f"G{row}", "",                                         aln()),
//     ]
//     for addr, val, al in cells_data:
//         c = smry[addr]
//         c.value = val
//         c.fill = fill(alt)
//         c.border = THIN
//         c.alignment = al
//         c.font = fn(size=10)
//         if addr.startswith("F"):
//             c.number_format = "#,##0.00"
//     total_cells.append(f"F{row}")
//     row += 1

// smry.row_dimensions[row].height = 30
// smry.merge_cells(f"B{row}:E{row}")
// c = smry[f"B{row}"]
// c.value = "GRAND TOTAL (All Works Combined)"
// c.font = Font(name="Arial", bold=True, size=11, color=C_WHITE)
// c.fill = fill(C_PRIMARY)
// c.alignment = aln()
// c.border = MEDIUM

// amt = smry[f"F{row}"]
// amt.value = "=" + "+".join(total_cells) if total_cells else 0
// amt.font = Font(name="Arial", bold=True, size=11, color=C_WHITE)
// amt.fill = fill(C_PRIMARY)
// amt.number_format = "#,##0.00"
// amt.alignment = aln("right")
// amt.border = MEDIUM

// c = smry[f"G{row}"]
// c.fill = fill(C_PRIMARY)
// c.border = MEDIUM

// row += 2
// c = smry.cell(row, 2, "Note: Quantities and rates are based on current Indian market estimates. Review highlighted rate cells on each sheet — amounts and this summary recalculate automatically.")
// c.font = Font(name="Arial", size=8, color=C_MUTED, italic=True)
// smry.merge_cells(f"B{row}:G{row}")

// smry.freeze_panes = smry["B5"]
// smry.page_setup.orientation = "landscape"
// smry.page_setup.fitToPage = True

// # Move SUMMARY to sit right after COVER in the tab strip.
// wb.move_sheet("SUMMARY", offset=-(len(works)))

// wb.save(${JSON.stringify(outputPath)})
// print("OK")
// `;
// }

// /* ═══════════════════════════════════════════════════════════════
//    MAIN EXPORTED FUNCTION
// ═══════════════════════════════════════════════════════════════ */
// async function generateBOQExcel(markdownContent, title = "Multi-Work BOQ") {
//   const data = parseMarkdown(markdownContent);
//   data.title = title || data.title;

//   const tmpDir = os.tmpdir();
//   const dataPath   = path.join(tmpDir, `boq_data_${Date.now()}.json`);
//   const outputPath = path.join(tmpDir, `boq_out_${Date.now()}.xlsx`);
//   const scriptPath = path.join(tmpDir, `boq_gen_${Date.now()}.py`);

//   fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");
//   fs.writeFileSync(scriptPath, buildPythonScript(dataPath, outputPath), "utf-8");

//   try {
//     execSync(`python3 "${scriptPath}"`, { timeout: 45000 });
//   } catch (err) {
//     try { fs.unlinkSync(dataPath); fs.unlinkSync(scriptPath); } catch {}
//     throw new Error(`Excel generation failed: ${err.stderr || err.message}`);
//   }

//   const buffer = fs.readFileSync(outputPath);
//   try { fs.unlinkSync(dataPath); fs.unlinkSync(scriptPath); fs.unlinkSync(outputPath); } catch {}
//   return buffer;
// }

// module.exports = { generateBOQExcel };
