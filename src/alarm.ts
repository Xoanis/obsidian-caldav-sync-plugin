import type { IcsAlarm, IcsDuration, IcsEvent } from "ts-ics";

const ALARM_PATTERN = /^(\d+)\s*(m|h|d|w)$/i;
const ALARM_STATUS_VALUES = new Set(["pending", "sent"]);

export type AlarmDeliveryStatus = "pending" | "sent";

export interface ParsedAlarmToken {
  token: string;
  amount: number;
  unit: "m" | "h" | "d" | "w";
}

export function normalizeAlarmTokens(value: unknown): string[] {
  const tokens = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];

  return tokens
    .map((token) => (typeof token === "string" ? token.trim().toLowerCase() : ""))
    .filter((token) => ALARM_PATTERN.test(token));
}

export function getInvalidAlarmTokens(value: unknown): string[] {
  const tokens = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];

  return tokens
    .map((token) => (typeof token === "string" ? token.trim().toLowerCase() : ""))
    .filter((token) => token.length > 0)
    .filter((token) => !ALARM_PATTERN.test(token));
}

export function parseAlarmToken(token: string): ParsedAlarmToken | null {
  const match = token.trim().toLowerCase().match(ALARM_PATTERN);
  if (!match) {
    return null;
  }

  return {
    token: `${match[1]}${match[2].toLowerCase()}`,
    amount: Number.parseInt(match[1], 10),
    unit: match[2].toLowerCase() as ParsedAlarmToken["unit"],
  };
}

export function normalizeAlarmStatuses(
  value: unknown,
  alarmCount: number,
): AlarmDeliveryStatus[] {
  const rawStatuses = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  const normalized = rawStatuses
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .map((item) => (ALARM_STATUS_VALUES.has(item) ? item as AlarmDeliveryStatus : "pending"));

  return Array.from({ length: alarmCount }, (_, index) => normalized[index] ?? "pending");
}

export function buildPendingAlarmStatuses(alarmCount: number): AlarmDeliveryStatus[] {
  return Array.from({ length: alarmCount }, () => "pending");
}

export function toIcsAlarm(token: string, summary: string): IcsAlarm | null {
  const parsed = parseAlarmToken(token);
  if (!parsed) {
    return null;
  }

  return {
    action: "DISPLAY",
    description: summary,
    summary,
    trigger: {
      type: "relative",
      value: toIcsDuration(parsed),
      options: {
        related: "START",
      },
    },
  };
}

export function fromIcsEventAlarms(event: IcsEvent | null | undefined): string[] {
  const alarms = event?.alarms ?? [];
  const tokens: string[] = [];

  for (const alarm of alarms) {
    if (alarm.trigger.type !== "relative") {
      continue;
    }

    const duration = alarm.trigger.value;
    if (!duration.before) {
      continue;
    }

    const token = fromIcsDuration(duration);
    if (token) {
      tokens.push(token);
    }
  }

  return [...new Set(tokens)];
}

export function getAlarmTriggerTimestamp(
  eventStartTimestamp: number,
  token: string,
): number | null {
  const parsed = parseAlarmToken(token);
  if (!parsed) {
    return null;
  }

  return eventStartTimestamp - getAlarmOffsetMs(parsed);
}

function toIcsDuration(parsed: ParsedAlarmToken): IcsDuration {
  const base: IcsDuration = {
    before: true,
  };

  switch (parsed.unit) {
    case "m":
      return { ...base, minutes: parsed.amount };
    case "h":
      return { ...base, hours: parsed.amount };
    case "d":
      return { ...base, days: parsed.amount };
    case "w":
      return { ...base, weeks: parsed.amount };
    default:
      return base;
  }
}

function fromIcsDuration(duration: IcsDuration): string | null {
  if (duration.weeks) {
    return `${duration.weeks}w`;
  }

  if (duration.days) {
    return `${duration.days}d`;
  }

  if (duration.hours) {
    return `${duration.hours}h`;
  }

  if (duration.minutes) {
    return `${duration.minutes}m`;
  }

  return null;
}

function getAlarmOffsetMs(parsed: ParsedAlarmToken): number {
  switch (parsed.unit) {
    case "m":
      return parsed.amount * 60 * 1000;
    case "h":
      return parsed.amount * 60 * 60 * 1000;
    case "d":
      return parsed.amount * 24 * 60 * 60 * 1000;
    case "w":
      return parsed.amount * 7 * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}
