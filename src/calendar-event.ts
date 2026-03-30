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
