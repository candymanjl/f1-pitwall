function shortSha(sha: string): string {
  const hex = (sha || "").trim().replace(/[^0-9a-f]/gi, "");
  if (hex.length >= 7) return hex.slice(0, 7).toLowerCase();
  return "dev";
}

export function formatBuildStamp(sha: string, at: Date): string {
  const short = shortSha(sha);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const month = pick("month");
  const day = pick("day");
  const hour = pick("hour");
  const minute = pick("minute");
  const period = pick("dayPeriod").replace(/\./g, "").toUpperCase();
  return `v ${short} · ${month} ${day} ${hour}:${minute} ${period} ET`;
}
