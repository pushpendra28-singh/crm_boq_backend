const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateKey(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));

  if (year < 2000 || year > 2099) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function getWeekday(value) {
  if (!isValidDateKey(value)) {
    return null;
  }

  // 0 = Sunday, 1 = Monday, ... 6 = Saturday.
  return new Date(`${value}T00:00:00Z`).getUTCDay();
}

module.exports = {
  isValidDateKey,
  getWeekday,
};