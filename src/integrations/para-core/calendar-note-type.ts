import { stringifyYaml } from "obsidian";
import type { BaseFrontmatter, NoteTypeDefinition, ValidationIssue } from "./types";
import { CALENDAR_EVENT_TYPE } from "../../calendar-event";
import { normalizeAlarmStatuses, normalizeAlarmTokens } from "../../alarm";

interface CalendarEventFrontmatter extends BaseFrontmatter {
  type: "calendar-event";
  domain: "calendar";
  date: string;
  summary?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  url?: string | null;
  guid?: string | null;
  alarm?: string[] | null;
  alarms_status?: string[] | null;
  project?: string | null;
  area?: string | null;
}

export function getCalendarEventNoteType(): NoteTypeDefinition<CalendarEventFrontmatter> {
  return {
    type: CALENDAR_EVENT_TYPE,
    displayName: "Calendar Event",
    folderKey: "records:/Calendar/Events",
    fileNameStrategy: "title",
    requiredFields: ["type", "status", "domain", "created", "date"],
    allowedStatuses: ["active", "done", "cancelled", "archived"],
    defaultFrontmatter: (date) => ({
      type: CALENDAR_EVENT_TYPE,
      status: "active",
      domain: "calendar",
      created: date,
      date,
      summary: null,
      start_time: null,
      end_time: null,
      location: null,
      url: null,
      guid: null,
      alarm: [],
      alarms_status: [],
      project: null,
      area: null,
      tags: [],
    }),
    template: ({ title, frontmatter }) => `${renderFrontmatter(frontmatter as unknown as Record<string, unknown>)}

# ${title}

## Details

- Date:
- Summary:
- Time:
- Location:
- URL:
- Alarm:
- Alarm Status:
- Project:
- Area:

## Notes
`,
    validate: (frontmatter) => validateCalendarEvent(frontmatter),
  };
}

function validateCalendarEvent(
  frontmatter: Partial<CalendarEventFrontmatter>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof frontmatter.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(frontmatter.date)) {
    issues.push({
      code: "invalid-calendar-date",
      message: "Calendar event 'date' must use YYYY-MM-DD format.",
      severity: "error",
    });
  }

  if (frontmatter.domain !== "calendar") {
    issues.push({
      code: "invalid-calendar-domain",
      message: "Calendar event note must declare domain 'calendar'.",
      severity: "error",
    });
  }

  if (frontmatter.start_time && !isTime(frontmatter.start_time)) {
    issues.push({
      code: "invalid-calendar-start-time",
      message: "Calendar event 'start_time' must use HH:mm format.",
      severity: "error",
    });
  }

  if (frontmatter.end_time && !isTime(frontmatter.end_time)) {
    issues.push({
      code: "invalid-calendar-end-time",
      message: "Calendar event 'end_time' must use HH:mm format.",
      severity: "error",
    });
  }

  if (frontmatter.end_time && !frontmatter.start_time) {
    issues.push({
      code: "calendar-end-without-start",
      message: "Calendar event 'end_time' should not be set without 'start_time'.",
      severity: "warning",
    });
  }

  const normalizedAlarmTokens = normalizeAlarmTokens(frontmatter.alarm);
  const rawAlarmCount = Array.isArray(frontmatter.alarm)
    ? frontmatter.alarm.length
    : typeof frontmatter.alarm === "string"
      ? 1
      : 0;
  if (rawAlarmCount > 0 && normalizedAlarmTokens.length !== rawAlarmCount) {
    issues.push({
      code: "invalid-calendar-alarm",
      message: "Calendar event 'alarm' should contain values like 15m, 1h, 1d, or 1w.",
      severity: "warning",
    });
  }

  const rawAlarmStatuses = Array.isArray(frontmatter.alarms_status)
    ? frontmatter.alarms_status
    : typeof frontmatter.alarms_status === "string"
      ? [frontmatter.alarms_status]
      : [];
  const hasAlarmStatusesField =
    frontmatter.alarms_status !== undefined && frontmatter.alarms_status !== null;
  const normalizedAlarmStatuses = normalizeAlarmStatuses(
    frontmatter.alarms_status,
    normalizedAlarmTokens.length,
  );

  if (
    hasAlarmStatusesField &&
    rawAlarmStatuses.length > 0 &&
    rawAlarmStatuses.some((status) => status !== "pending" && status !== "sent")
  ) {
    issues.push({
      code: "invalid-calendar-alarm-status",
      message: "Calendar event 'alarms_status' should contain only 'pending' or 'sent'.",
      severity: "warning",
    });
  }

  if (hasAlarmStatusesField && rawAlarmStatuses.length !== normalizedAlarmStatuses.length) {
    issues.push({
      code: "calendar-alarm-status-length-mismatch",
      message: "Calendar event 'alarms_status' should mirror the normalized 'alarm' list one-to-one.",
      severity: "warning",
    });
  }

  return issues;
}

function isTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

function renderFrontmatter(frontmatter: Record<string, unknown>): string {
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---`;
}
