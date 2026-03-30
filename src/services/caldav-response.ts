import { convertIcsCalendar, type IcsCalendar, type IcsEvent } from "ts-ics";

const DEFAULT_PROD_ID = "-//Obsidian Distributed Workspace//CalDAV Event Sync//EN";
const XML_CALENDAR_DATA_PATTERN = /<(?:[A-Za-z0-9_-]+:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?calendar-data>/gi;

export function parseCalendarResponse(text: string): IcsCalendar | null {
  const directCalendar = isLikelyIcsCalendar(text) ? tryParseIcsCalendar(text) : null;
  if (directCalendar?.events) {
    return directCalendar;
  }

  const embeddedCalendars = extractEmbeddedCalendars(text);
  if (embeddedCalendars.length === 0) {
    return null;
  }

  const events: IcsEvent[] = [];
  for (const entry of embeddedCalendars) {
    const parsed = tryParseIcsCalendar(entry);
    if (!parsed?.events?.length) {
      continue;
    }

    for (const event of parsed.events) {
      if (!event.uid || !events.some((existing) => existing.uid === event.uid)) {
        events.push(event);
      }
    }
  }

  return {
    prodId: directCalendar?.prodId || DEFAULT_PROD_ID,
    version: directCalendar?.version || "2.0",
    events,
  };
}

export function parseCalendarEventResponse(text: string): IcsEvent | null {
  return parseCalendarResponse(text)?.events?.[0] ?? null;
}

function tryParseIcsCalendar(text: string): IcsCalendar | null {
  try {
    const parsed = convertIcsCalendar(undefined, text);
    return parsed && typeof parsed === "object" ? parsed as IcsCalendar : null;
  } catch {
    return null;
  }
}

function isLikelyIcsCalendar(text: string): boolean {
  return text.trimStart().startsWith("BEGIN:VCALENDAR");
}

function extractEmbeddedCalendars(text: string): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null = null;

  while ((match = XML_CALENDAR_DATA_PATTERN.exec(text)) !== null) {
    const decoded = decodeXmlText(match[1]).trim();
    if (!decoded || seen.has(decoded)) {
      continue;
    }

    seen.add(decoded);
    entries.push(decoded);
  }

  return entries;
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
