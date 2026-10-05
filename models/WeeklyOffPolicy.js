const mongoose = require("mongoose");

const {
  isValidDateKey,
  getWeekday,
} = require("../utils/holidayDate");

const { Schema } = mongoose;

const weeklyOffRuleSchema = new Schema(
  {
    weekday: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
      validate: {
        validator: Number.isInteger,
        message: "Weekday must be an integer between 0 and 6.",
      },
    },

    pattern: {
      type: String,
      required: true,
      enum: ["every_week", "selected_occurrences", "alternate_weeks"],
    },

    // Example: [2, 4] means second and fourth occurrence
    // of the selected weekday in each month.
    occurrences: {
      type: [Number],
      default: [],
      validate: {
        validator(values) {
          return (
            values.every(
              (value) =>
                Number.isInteger(value) &&
                value >= 1 &&
                value <= 5
            ) &&
            new Set(values).size === values.length
          );
        },
        message: "Occurrences must be unique integers between 1 and 5.",
      },
    },

    // Starting OFF date for alternate-week rotation.
    anchorDate: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

weeklyOffRuleSchema.pre("validate", function () {
  if (this.pattern === "selected_occurrences") {
    if (this.occurrences.length === 0) {
      this.invalidate(
        "occurrences",
        "Select at least one occurrence for this weekday."
      );
    }
  } else if (this.occurrences.length > 0) {
    this.invalidate(
      "occurrences",
      "Occurrences are only allowed for selected-occurrence rules."
    );
  }

  if (this.pattern === "alternate_weeks") {
    if (!isValidDateKey(this.anchorDate)) {
      this.invalidate(
        "anchorDate",
        "A valid starting off date is required for alternate weeks."
      );
    } else if (getWeekday(this.anchorDate) !== this.weekday) {
      this.invalidate(
        "anchorDate",
        "Starting off date must match the selected weekday."
      );
    }
  } else if (this.anchorDate !== null) {
    this.invalidate(
      "anchorDate",
      "Starting off date is only allowed for alternate-week rules."
    );
  }
});

const weeklyOffPolicySchema = new Schema(
  {
    effectiveFrom: {
      type: String,
      required: [true, "Effective date is required."],
      validate: {
        validator: isValidDateKey,
        message: "Provide a valid effective date between 2000 and 2099.",
      },
    },

    rules: {
      type: [weeklyOffRuleSchema],
      default: [],
      validate: {
        validator(rules) {
          const weekdays = rules.map((rule) => rule.weekday);

          return (
            rules.length <= 7 &&
            new Set(weekdays).size === weekdays.length
          );
        },
        message: "Each weekday can have only one weekly-off rule.",
      },
    },

    reason: {
      type: String,
      required: [true, "Please provide a reason for this policy."],
      trim: true,
      minlength: 3,
      maxlength: 1000,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      immutable: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

weeklyOffPolicySchema.index(
  { effectiveFrom: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "WeeklyOffPolicy",
  weeklyOffPolicySchema
);