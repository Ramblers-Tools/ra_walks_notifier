function clampHour(value, fallback) {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return fallback;
  return Math.min(23, Math.max(0, Math.trunc(hour)));
}

function normalizeSchedule(config = {}) {
  const interval = Number(config.checkIntervalMinutes);
  const activeHours = config.activeHours || {};
  const start = clampHour(activeHours.start, 7);
  const end = clampHour(activeHours.end, 22);

  return {
    checkIntervalMinutes: Number.isFinite(interval) && interval >= 1 ? Math.trunc(interval) : 5,
    activeHours: { start, end }
  };
}

function isWithinActiveHours(activeHours, hour) {
  const { start, end } = normalizeSchedule({ activeHours }).activeHours;
  const currentHour = clampHour(hour, 0);

  if (start === end) return true;
  if (start < end) return currentHour >= start && currentHour < end;
  return currentHour >= start || currentHour < end;
}

module.exports = { normalizeSchedule, isWithinActiveHours };
