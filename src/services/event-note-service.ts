import {
  TFile,
  moment,
  normalizePath,
  parseYaml,
  stringifyYaml,
  type App,
  type CachedMetadata,
} from "obsidian";
import type { IcsEvent } from "ts-ics";
import {
  buildCalendarEventFileName,
  CALENDAR_EVENT_TYPE,
  CALENDAR_DOMAIN_ID,
  getCalendarEventSummary,
  validateCalendarEventInput,
  type CalendarEventNote,
  type CreateCalendarEventInput,
} from "../calendar-event";
import {
  buildPendingAlarmStatuses,
  fromIcsEventAlarms,
  normalizeAlarmStatuses,
  normalizeAlarmTokens,
  type AlarmDeliveryStatus,
} from "../alarm";

export interface UpcomingCalendarEvent {
  file: TFile;
  event: CalendarEventNote;
  startTimestamp: number;
}

export class EventNoteService {
  constructor(private readonly app: App) {}

  listEventFiles(eventsDirectory: string): TFile[] {
    const normalizedDirectory = normalizePath(eventsDirectory);
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => normalizePath(file.path).startsWith(`${normalizedDirectory}/`));
  }

  async getEventGuid(file: TFile): Promise<string> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return typeof frontmatter?.guid === "string" ? frontmatter.guid : "";
  }

  async readEventFile(file: TFile): Promise<CalendarEventNote | null> {
    try {
      const metadata = this.app.metadataCache.getFileCache(file);
      const content = await this.app.vault.read(file);
      return tryCreateCalendarEvent(file.basename, metadata, content);
    } catch (error) {
      console.warn(`CalDAV Event Sync: failed to read event note "${file.path}"`, error);
      return null;
    }
  }

  async createEventFile(
    eventsDirectory: string,
    input: CreateCalendarEventInput,
    options?: {
      includeTelegramAlarmStatus?: boolean;
    },
  ): Promise<TFile> {
    const validationIssues = validateCalendarEventInput(input);
    if (validationIssues.length > 0) {
      throw new Error(validationIssues[0]);
    }

    await this.ensureFolder(eventsDirectory);

    const normalizedSummary = getCalendarEventSummary(input.summary, "Untitled event");
    const normalizedAlarms = normalizeAlarmTokens(input.alarm);
    const frontmatter: Record<string, unknown> = {
      type: CALENDAR_EVENT_TYPE,
      domain: CALENDAR_DOMAIN_ID,
      status: input.status?.trim() || "active",
      created: input.created?.trim() || moment().format("YYYY-MM-DD"),
      date: input.date,
      summary: normalizedSummary,
      start_time: input.start_time?.trim() || null,
      end_time: input.end_time?.trim() || null,
      location: input.location?.trim() || null,
      url: input.url?.trim() || null,
      guid: input.guid?.trim() || null,
      alarm: normalizedAlarms,
      project: normalizeWikiLink(input.project),
      area: normalizeWikiLink(input.area),
      tags: [],
    };
    if (options?.includeTelegramAlarmStatus) {
      frontmatter.telegram_alarms_status = normalizeAlarmStatuses(
        input.telegram_alarms_status,
        normalizedAlarms.length,
      );
    }
    const fileName = buildCalendarEventFileName(
      input.date,
      input.start_time?.trim(),
      normalizedSummary,
    );
    const filePath = this.buildUniqueMarkdownPath(eventsDirectory, fileName);

    return this.app.vault.create(
      filePath,
      buildMarkdownFile(frontmatter, input.description?.trim() || ""),
    );
  }

  async createEventFileFromRemoteEvent(
    eventsDirectory: string,
    remoteEvent: IcsEvent,
    options?: {
      includeTelegramAlarmStatus?: boolean;
    },
  ): Promise<TFile | null> {
    if (!remoteEvent.summary || !remoteEvent.start) {
      return null;
    }

    const startMoment = moment(remoteEvent.start.date);
    const endMoment = remoteEvent.end ? moment(remoteEvent.end.date) : null;
    if (
      remoteEvent.start.type === "DATE-TIME" &&
      endMoment &&
      endMoment.format("YYYY-MM-DD") !== startMoment.format("YYYY-MM-DD")
    ) {
      console.warn("CalDAV Event Sync: multi-day events are not imported yet", remoteEvent.uid);
      return null;
    }

    await this.ensureFolder(eventsDirectory);
    const normalizedAlarms = fromIcsEventAlarms(remoteEvent);

    const props: Record<string, unknown> = {
      type: CALENDAR_EVENT_TYPE,
      domain: CALENDAR_DOMAIN_ID,
      status: "active",
      created: startMoment.format("YYYY-MM-DD"),
      date: startMoment.format("YYYY-MM-DD"),
      summary: remoteEvent.summary,
      guid: remoteEvent.uid,
      url: remoteEvent.url,
      location: remoteEvent.location ?? null,
      alarm: normalizedAlarms,
      tags: [],
    };
    if (options?.includeTelegramAlarmStatus) {
      props.telegram_alarms_status = buildPendingAlarmStatuses(normalizedAlarms.length);
    }

    if (remoteEvent.start.type === "DATE-TIME") {
      props.start_time = startMoment.format("HH:mm");
      if (endMoment) {
        props.end_time = endMoment.format("HH:mm");
      }
    }

    const safeFileName = buildCalendarEventFileName(
      startMoment.format("YYYY-MM-DD"),
      remoteEvent.start.type === "DATE-TIME" ? startMoment.format("HH:mm") : undefined,
      remoteEvent.summary,
    );
    const filePath = this.buildUniqueMarkdownPath(eventsDirectory, safeFileName);
    return this.app.vault.create(
      filePath,
      buildMarkdownFile(props, remoteEvent.description ?? ""),
    );
  }

  async listUpcomingEvents(
    eventsDirectory: string,
    options?: {
      limit?: number;
      project?: string;
      area?: string;
      includeDone?: boolean;
    },
  ): Promise<UpcomingCalendarEvent[]> {
    const project = normalizeWikiLink(options?.project);
    const area = normalizeWikiLink(options?.area);
    const items = await Promise.all(
      this.listEventFiles(eventsDirectory).map(async (file) => {
        const event = await this.readEventFile(file);
        if (!event) {
          return null;
        }

        if (!options?.includeDone && event.status && event.status !== "active") {
          return null;
        }

        if (project && event.project !== project) {
          return null;
        }

        if (area && event.area !== area) {
          return null;
        }

        const startTimestamp = getEventStartTimestamp(event);
        if (startTimestamp === null || startTimestamp < Date.now()) {
          return null;
        }

        return {
          file,
          event,
          startTimestamp,
        };
      }),
    );

    return items
      .filter((item): item is UpcomingCalendarEvent => item !== null)
      .sort((left, right) => left.startTimestamp - right.startTimestamp)
      .slice(0, options?.limit ?? 10);
  }

  async updateSyncMetadata(file: TFile, guid: string, url?: string): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.guid = guid;
      frontmatter.url = url ?? null;
      if (!frontmatter.status) {
        frontmatter.status = "active";
      }
      if (!frontmatter.created) {
        frontmatter.created = moment().format("YYYY-MM-DD");
      }
      if (!frontmatter.tags) {
        frontmatter.tags = [];
      }
    });
  }

  async ensureAlarmStatuses(file: TFile): Promise<AlarmDeliveryStatus[]> {
    let nextStatuses: AlarmDeliveryStatus[] = [];

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const normalizedAlarms = normalizeAlarmTokens(frontmatter.alarm);
      nextStatuses = normalizeAlarmStatuses(
        readTelegramAlarmStatuses(frontmatter),
        normalizedAlarms.length,
      );

      if (!areStatusListsEqual(frontmatter.telegram_alarms_status, nextStatuses)) {
        frontmatter.telegram_alarms_status = nextStatuses;
      }
      delete frontmatter.alarms_status;
    });

    return nextStatuses;
  }

  async updateAlarmStatus(
    file: TFile,
    alarmIndex: number,
    status: AlarmDeliveryStatus,
  ): Promise<AlarmDeliveryStatus[]> {
    let nextStatuses: AlarmDeliveryStatus[] = [];

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const normalizedAlarms = normalizeAlarmTokens(frontmatter.alarm);
      nextStatuses = normalizeAlarmStatuses(
        readTelegramAlarmStatuses(frontmatter),
        normalizedAlarms.length,
      );
      if (alarmIndex >= 0 && alarmIndex < nextStatuses.length) {
        nextStatuses[alarmIndex] = status;
      }
      frontmatter.telegram_alarms_status = nextStatuses;
      delete frontmatter.alarms_status;
    });

    return nextStatuses;
  }

  async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!normalized) {
      return;
    }

    const segments = normalized.split("/").filter(Boolean);
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (!existing) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  private buildUniqueMarkdownPath(folderPath: string, fileName: string): string {
    const normalizedFolder = normalizePath(folderPath);
    let candidate = normalizePath(`${normalizedFolder}/${fileName}.md`);
    let index = 2;

    while (this.fileExists(candidate)) {
      candidate = normalizePath(`${normalizedFolder}/${fileName} ${index}.md`);
      index += 1;
    }

    return candidate;
  }

  private fileExists(path: string): boolean {
    const existing = this.app.vault.getAbstractFileByPath(path);
    return existing instanceof TFile || Boolean(existing);
  }
}

export function tryCreateCalendarEvent(
  filename: string,
  metadata: CachedMetadata | null,
  content: string,
): CalendarEventNote | null {
  const frontmatter = metadata?.frontmatter ?? readFrontmatterFromContent(content);
  if (frontmatter?.type !== CALENDAR_EVENT_TYPE || typeof frontmatter.date !== "string") {
    return null;
  }

  const normalizedAlarms = normalizeAlarmTokens(frontmatter.alarm);

  return {
    date: frontmatter.date,
    start_time: readString(frontmatter.start_time),
    end_time: readString(frontmatter.end_time),
    summary: getCalendarEventSummary(readString(frontmatter.summary), filename),
    description: extractBodyContent(content, metadata),
    location: readString(frontmatter.location),
    url: readString(frontmatter.url),
    guid: readString(frontmatter.guid),
    status: readString(frontmatter.status),
    created: readString(frontmatter.created),
    alarm: normalizedAlarms,
    telegram_alarms_status: normalizeAlarmStatuses(
      readTelegramAlarmStatuses(frontmatter),
      normalizedAlarms.length,
    ),
    project: normalizeWikiLink(readString(frontmatter.project)),
    area: normalizeWikiLink(readString(frontmatter.area)),
  };
}

function extractBodyContent(content: string, metadata: CachedMetadata | null): string {
  const offset = metadata?.frontmatterPosition?.end.offset;
  if (typeof offset !== "number") {
    return stripFrontmatter(content).trim();
  }

  return content.slice(offset + 1).trim();
}

function buildMarkdownFile(frontmatter: Record<string, unknown>, content: string): string {
  const normalizedFrontmatter = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => value !== undefined),
  );
  return `---\n${stringifyYaml(normalizedFrontmatter).trimEnd()}\n---\n\n${content}`.trimEnd();
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeWikiLink(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\[\[.*\]\]$/.test(trimmed)) {
    return trimmed;
  }

  return `[[${trimmed}]]`;
}

function getEventStartTimestamp(event: CalendarEventNote): number | null {
  const startMoment = event.start_time
    ? moment(`${event.date} ${event.start_time}`, "YYYY-MM-DD HH:mm", true)
    : moment(event.date, "YYYY-MM-DD", true).startOf("day");

  if (!startMoment.isValid()) {
    return null;
  }

  return startMoment.valueOf();
}

function readFrontmatterFromContent(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }

  try {
    const parsed = parseYaml(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function areStatusListsEqual(
  currentValue: unknown,
  nextStatuses: AlarmDeliveryStatus[],
): boolean {
  if (!Array.isArray(currentValue)) {
    return nextStatuses.length === 0;
  }

  if (currentValue.length !== nextStatuses.length) {
    return false;
  }

  return currentValue.every((item, index) => item === nextStatuses[index]);
}

function readTelegramAlarmStatuses(frontmatter: Record<string, unknown>): unknown {
  if ("telegram_alarms_status" in frontmatter) {
    return frontmatter.telegram_alarms_status;
  }

  return frontmatter.alarms_status;
}
