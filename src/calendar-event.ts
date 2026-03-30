import type { AlarmDeliveryStatus } from "./alarm";

export const CALENDAR_EVENT_TYPE = "calendar-event";
export const CALENDAR_DOMAIN_ID = "calendar";
export const DEFAULT_CALENDAR_RECORDS_PATH = "Calendar";
export const DEFAULT_EVENTS_DIRECTORY = "Records/Calendar/Events";

export interface CalendarEventNote {
  date: string;
  start_time?: string;
  end_time?: string;
  summary: string;
  description: string;
  location?: string;
  url?: string;
  guid?: string;
  status?: string;
  created?: string;
  alarm?: string[];
  telegram_alarms_status?: AlarmDeliveryStatus[];
  project?: string;
  area?: string;
}

export interface CalendarSyncResult {
  guid: string;
  url?: string;
}

export interface CreateCalendarEventInput {
  date: string;
  start_time?: string;
  end_time?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  guid?: string;
  status?: string;
  created?: string;
  alarm?: string[];
  telegram_alarms_status?: AlarmDeliveryStatus[];
  project?: string;
  area?: string;
}

export function getCalendarEventSummary(
  summary: string | null | undefined,
  fallback: string,
): string {
  const normalizedSummary = summary?.trim();
  if (normalizedSummary) {
    return normalizedSummary;
  }

  return fallback.trim() || "Untitled event";
}

export function buildCalendarEventFileName(
  date: string,
  startTime: string | undefined,
  summary: string,
): string {
  const timePrefix = startTime ? ` ${startTime.replace(":", "-")}` : "";
  const rawName = `${date}${timePrefix} ${summary}`.trim();
  return rawName.replace(/[\/\\:*?"<>|]/g, "_").trim() || `${date}${timePrefix}`.trim();
}

export function validateCalendarEventInput(input: CreateCalendarEventInput): string[] {
  const issues: string[] = [];
  const date = input.date?.trim();
  const startTime = input.start_time?.trim();
  const endTime = input.end_time?.trim();
  const url = input.url?.trim();

  if (!date) {
    issues.push("Event date is required.");
  } else if (!isIsoDate(date)) {
    issues.push("Event date must use YYYY-MM-DD format.");
  }

  if (startTime && !isTime(startTime)) {
    issues.push("Start time must use HH:mm format.");
  }

  if (endTime && !isTime(endTime)) {
    issues.push("End time must use HH:mm format.");
  }

  if (endTime && !startTime) {
    issues.push("End time cannot be set without a start time.");
  }

  if (startTime && endTime && endTime <= startTime) {
    issues.push("End time must be later than start time.");
  }

  if (url && !isValidUrl(url)) {
    issues.push("URL must be a valid absolute link.");
  }

  return issues;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}
