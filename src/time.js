const UK_TIME_ZONE = 'Europe/London';

function formatUkDateTime(value) {
  if (!value) return 'Never';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).format(date).replace(',', '');
}

function nowUkDateTime() {
  return formatUkDateTime(new Date());
}

function currentUkHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).format(date);
  return Number(hour);
}

module.exports = { UK_TIME_ZONE, formatUkDateTime, nowUkDateTime, currentUkHour };
