const { isValidDateKey } = require("./holidayDate");

const DAY_MS = 24 * 60 * 60 * 1000;

function dateNumber(value) {
  return new Date(`${value}T00:00:00Z`).getTime();
}

function isWeeklyOff(dateKey, rules = []) {
  if (!isValidDateKey(dateKey)) {
    throw new Error("Invalid date supplied to weekly-off calculation.");
  }

  const date = new Date(`${dateKey}T00:00:00Z`);
  const weekday = date.getUTCDay();

  const rule = rules.find((item) => item.weekday === weekday);

  if (!rule) return false;

  if (rule.pattern === "every_week") {
    return true;
  }

  if (rule.pattern === "selected_occurrences") {
    // Example: day 8–14 is the second occurrence of its weekday.
    const occurrence = Math.floor((date.getUTCDate() - 1) / 7) + 1;

    return rule.occurrences.includes(occurrence);
  }

  if (rule.pattern === "alternate_weeks") {
    if (!isValidDateKey(rule.anchorDate)) {
      throw new Error("Invalid alternate-week anchor date.");
    }

    const difference =
      (dateNumber(dateKey) - dateNumber(rule.anchorDate)) / DAY_MS;

    // Anchor is the first OFF date; repeat after every 14 days.
    return difference >= 0 && difference % 14 === 0;
  }

  throw new Error("Unsupported weekly-off pattern.");
}

function buildWeeklyOffPreview(from, to, policies) {
  const output = [];
  const sortedPolicies = [...policies].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom)
  );

  let policyIndex = -1;

  for (
    let timestamp = dateNumber(from);
    timestamp <= dateNumber(to);
    timestamp += DAY_MS
  ) {
    const date = new Date(timestamp).toISOString().slice(0, 10);

    while (
      policyIndex + 1 < sortedPolicies.length &&
      sortedPolicies[policyIndex + 1].effectiveFrom <= date
    ) {
      policyIndex += 1;
    }

    const policy = sortedPolicies[policyIndex];

    output.push({
      date,
      policyId: policy?._id || null,
      effectiveFrom: policy?.effectiveFrom || null,
      status: !policy
        ? "not_configured"
        : isWeeklyOff(date, policy.rules)
          ? "weekly_off"
          : "working_day",
    });
  }

  return output;
}

module.exports = {
  isWeeklyOff,
  buildWeeklyOffPreview,
};