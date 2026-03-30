export const CALENDAR_EVENT_TYPE = "calendar-event";
export const CALENDAR_DOMAIN_ID = "calendar";
export const DEFAULT_EVENTS_DIRECTORY = "Inbox/Events";

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
}

export interface CalendarSyncResult {
  guid: string;
  url?: string;
}
