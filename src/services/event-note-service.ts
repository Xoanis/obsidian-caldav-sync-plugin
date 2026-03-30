import {
  TFile,
  moment,
  normalizePath,
  type App,
  type CachedMetadata,
  type TAbstractFile,
} from "obsidian";
import type { IcsEvent } from "ts-ics";
import { CALENDAR_EVENT_TYPE, type CalendarEventNote } from "../calendar-event";

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
    const metadata = this.app.metadataCache.getFileCache(file);
    const content = await this.app.vault.read(file);
    return tryCreateCalendarEvent(file.basename, metadata, content);
  }

  async createEventFileFromRemoteEvent(
    eventsDirectory: string,
    remoteEvent: IcsEvent,
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

    const props: Record<string, unknown> = {
      type: CALENDAR_EVENT_TYPE,
      status: "active",
      created: startMoment.format("YYYY-MM-DD"),
      date: startMoment.format("YYYY-MM-DD"),
      guid: remoteEvent.uid,
      url: remoteEvent.url,
      location: remoteEvent.location ?? null,
      tags: [],
    };

    if (remoteEvent.start.type === "DATE-TIME") {
      props.start_time = startMoment.format("HH:mm");
      if (endMoment) {
        props.end_time = endMoment.format("HH:mm");
      }
    }

    const safeFileName = remoteEvent.summary.replace(/[\/\\:*?"<>|]/g, "_").trim() || "Untitled event";
    const filePath = this.buildUniqueMarkdownPath(eventsDirectory, safeFileName);
    return this.app.vault.create(
      filePath,
      buildMarkdownFile(props, remoteEvent.description ?? ""),
    );
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
  const frontmatter = metadata?.frontmatter;
  if (frontmatter?.type !== CALENDAR_EVENT_TYPE || typeof frontmatter.date !== "string") {
    return null;
  }

  return {
    date: frontmatter.date,
    start_time: readString(frontmatter.start_time),
    end_time: readString(frontmatter.end_time),
    summary: filename,
    description: extractBodyContent(content, metadata),
    location: readString(frontmatter.location),
    url: readString(frontmatter.url),
    guid: readString(frontmatter.guid),
    status: readString(frontmatter.status),
    created: readString(frontmatter.created),
  };
}

function extractBodyContent(content: string, metadata: CachedMetadata | null): string {
  const offset = metadata?.frontmatterPosition?.end.offset;
  if (typeof offset !== "number") {
    return content.trim();
  }

  return content.slice(offset + 1).trim();
}

function buildMarkdownFile(frontmatter: Record<string, unknown>, content: string): string {
  const yamlLines = Object.entries(frontmatter)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${serializeYamlValue(value)}`);

  return `---\n${yamlLines.join("\n")}\n---\n\n${content}`.trimEnd();
}

function serializeYamlValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  }

  if (value === null) {
    return "null";
  }

  return JSON.stringify(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}
