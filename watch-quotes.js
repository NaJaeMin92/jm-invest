const easternTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

// https://www.nyse.com/trade/hours-calendars
const holidays = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19",
  "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25"
]);
const earlyCloses = new Set([
  "2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"
]);
function easternParts(date) {
  return Object.fromEntries(easternTime.formatToParts(date).map(({type, value}) => [type, value]));
}

function dateKey({year, month, day}) {
  return `${year}-${month}-${day}`;
}

export function usMarketSession(now = new Date()) {
  const parts = easternParts(now);
  const date = dateKey(parts);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const early = earlyCloses.has(date);
  let phase = "Close";
  if (!["Sat", "Sun"].includes(parts.weekday) && !holidays.has(date)) {
    if (minutes >= 240 && minutes < 570) phase = "Pre";
    else if (minutes >= 570 && minutes < (early ? 780 : 960)) phase = "Regular";
    else if (minutes >= (early ? 780 : 960) && minutes < (early ? 1020 : 1200)) phase = "After";
  }
  return {date, phase};
}
