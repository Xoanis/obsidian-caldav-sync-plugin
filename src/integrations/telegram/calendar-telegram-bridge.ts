import { TFile, moment, type App } from "obsidian";
import type {
  InputFocusState,
  TelegramBotApi,
  TelegramCallbackContext,
  TelegramCallbackPayload,
  TelegramHandlerResult,
  TelegramInlineKeyboard,
  TelegramMessageContext,
} from "obsidian-para-suite-contracts/telegram";
import { getAlarmTriggerTimestamp, normalizeAlarmTokens } from "../../alarm";
import type { CalendarEventNote, CreateCalendarEventInput } from "../../calendar-event";
import { getCalendarEventSummary } from "../../calendar-event";
import type { IParaCoreApi } from "../para-core/types";
import { getTelegramBotApi } from "./client";
import { EventNoteService } from "../../services/event-note-service";
import { CalDavSyncService } from "../../services/caldav-sync-service";

const UNIT_NAME = "caldav-sync-plugin";
const CALLBACK_ACTIONS = {
  createScopedEvent: "cse",
  listScopedEvents: "lse",
} as const;
const REMINDER_GRACE_MS = 1000 * 60 * 5;
const CALLBACK_TOKEN_TTL_MS = 1000 * 60 * 30;

type CallbackScopeTarget = "project" | "area";

interface CalendarTelegramBridgeDeps {
  app: App;
  paraCoreApi: IParaCoreApi | null;
  eventNoteService: EventNoteService;
  calDavSyncService: CalDavSyncService;
  getEventsDirectory: () => string;
}

interface CallbackTokenState {
  target: CallbackScopeTarget;
  path: string;
  createdAt: number;
}

interface ParsedTelegramEventInput extends CreateCalendarEventInput {
  syncWithCalendar: boolean;
}

export class CalendarTelegramBridge {
  private readonly api: TelegramBotApi | null;
  private readonly callbackTokens = new Map<string, CallbackTokenState>();
  private callbackTokenCounter = 0;

  constructor(private readonly deps: CalendarTelegramBridgeDeps) {
    this.api = getTelegramBotApi(deps.app);
  }

  register(): boolean {
    if (!this.api) {
      return false;
    }

    this.api.registerMessageHandler(
      (message, processedBefore) => this.handleMessage(message, processedBefore),
      UNIT_NAME,
    );
    this.api.registerCallbackHandler(
      (callback, processedBefore) => this.handleCallback(callback, processedBefore),
      UNIT_NAME,
    );
    this.api.registerFocusedInputHandler?.(
      (message, focus) => this.handleFocusedInput(message, focus),
      UNIT_NAME,
    );
    this.registerParaCoreContributions();
    return true;
  }

  dispose(): void {
    this.api?.disposeHandlersForUnit(UNIT_NAME);
  }

  async checkDueReminders(): Promise<void> {
    if (!this.api) {
      return;
    }

    const files = this.deps.eventNoteService.listEventFiles(this.deps.getEventsDirectory());
    const now = Date.now();

    for (const file of files) {
      const event = await this.deps.eventNoteService.readEventFile(file);
      if (!event || event.status !== "active") {
        continue;
      }

      const startTimestamp = getEventStartTimestamp(event);
      if (startTimestamp === null || startTimestamp + REMINDER_GRACE_MS < now) {
        continue;
      }

      const normalizedAlarms = normalizeAlarmTokens(event.alarm);
      let alarmStatuses = await this.deps.eventNoteService.ensureAlarmStatuses(file);

      for (const [alarmIndex, alarm] of normalizedAlarms.entries()) {
        const triggerTimestamp = getAlarmTriggerTimestamp(startTimestamp, alarm);
        if (triggerTimestamp === null || triggerTimestamp > now) {
          continue;
        }

        if (alarmStatuses[alarmIndex] !== "pending") {
          continue;
        }

        await this.api.sendMessage(renderReminderMessage(file, event, alarm));
        alarmStatuses = await this.deps.eventNoteService.updateAlarmStatus(file, alarmIndex, "sent");
      }
    }
  }

  private async handleMessage(
    message: TelegramMessageContext,
    processedBefore: boolean,
  ): Promise<TelegramHandlerResult> {
    if (processedBefore || !message.command) {
      return { processed: false, answer: null };
    }

    const command = message.command.name.toLowerCase();
    const args = message.command.args.trim();
    if (command === "event") {
      if (!args) {
        await this.beginCreateEventFlow();
        return {
          processed: true,
          answer: "Send the event in the requested format.",
        };
      }

      return this.createEventFromText(args);
    }

    if (command === "events" || command === "upcoming-events") {
      const rendered = await this.renderUpcomingEventsMessage();
      return {
        processed: true,
        answer: rendered,
      };
    }

    return { processed: false, answer: null };
  }

  private async handleCallback(
    callback: TelegramCallbackContext,
    processedBefore: boolean,
  ): Promise<TelegramHandlerResult> {
    if (processedBefore) {
      return { processed: false, answer: null };
    }

    const payload = this.decodeCallbackPayload(callback.data);
    if (!payload || payload.unit !== UNIT_NAME) {
      return { processed: false, answer: null };
    }

    const tokenState = payload.token ? this.callbackTokens.get(payload.token) : undefined;
    if (!tokenState) {
      return {
        processed: true,
        answer: "Calendar action expired. Open the card again.",
      };
    }

    if (payload.action === CALLBACK_ACTIONS.createScopedEvent) {
      await this.beginCreateEventFlow(tokenState.target, tokenState.path);
      return {
        processed: true,
        answer: "Send the new event in the requested format.",
      };
    }

    if (payload.action === CALLBACK_ACTIONS.listScopedEvents) {
      const text = await this.renderUpcomingEventsMessage(tokenState.target, tokenState.path);
      await this.api?.sendMessage(text);
      return {
        processed: true,
        answer: "Upcoming events sent.",
      };
    }

    return { processed: false, answer: null };
  }

  private async handleFocusedInput(
    message: TelegramMessageContext,
    focus: InputFocusState,
  ): Promise<TelegramHandlerResult> {
    const action = focus.context?.action;
    if (action !== "calendar.create") {
      return { processed: false, answer: null };
    }

    const text = message.text?.trim() || message.caption?.trim();
    if (!text) {
      return {
        processed: true,
        answer: "Send a plain text event description.",
      };
    }

    const target = focus.context?.target;
    const path = focus.context?.path;
    const relation = typeof target === "string" && typeof path === "string"
      ? this.getRelationOverrides(target, path)
      : {};

    const result = await this.createEventFromText(text, relation);
    await this.api?.clearInputFocus?.(UNIT_NAME);
    return result;
  }

  private async beginCreateEventFlow(
    target?: CallbackScopeTarget,
    path?: string,
  ): Promise<void> {
    if (!this.api?.setInputFocus) {
      await this.api?.sendMessage(renderCreatePrompt());
      return;
    }

    const context: Record<string, unknown> = {
      action: "calendar.create",
    };
    if (target && path) {
      context.target = target;
      context.path = path;
    }

    await this.api.setInputFocus(UNIT_NAME, {
      mode: "next-text",
      expiresInMs: 1000 * 60 * 10,
      context,
    });
    await this.api.sendMessage(renderCreatePrompt(target, path ? this.getFileBaseName(path) : undefined));
  }

  private async createEventFromText(
    text: string,
    relationOverrides?: Partial<CreateCalendarEventInput>,
  ): Promise<TelegramHandlerResult> {
    const parsed = parseTelegramEventInput(text);
    if (!parsed) {
      return {
        processed: true,
        answer: renderCreatePrompt(),
      };
    }

    try {
      const created = await this.deps.eventNoteService.createEventFile(this.deps.getEventsDirectory(), {
        ...parsed,
        ...relationOverrides,
      }, {
        includeTelegramAlarmStatus: true,
      });

      let synced = false;
      if (parsed.syncWithCalendar) {
        const event = await this.deps.eventNoteService.readEventFile(created);
        if (event) {
          const syncResult = await this.deps.calDavSyncService.syncEvent(event);
          if (syncResult) {
            await this.deps.eventNoteService.updateSyncMetadata(created, syncResult.guid, syncResult.url);
            synced = true;
          }
        }
      }

      return {
        processed: true,
        answer: [
          `Created event: ${created.basename}`,
          parsed.syncWithCalendar
            ? synced
              ? "Calendar sync: done."
              : "Calendar sync: failed."
            : "Calendar sync: skipped.",
        ].join("\n"),
      };
    } catch (error) {
      return {
        processed: true,
        answer: error instanceof Error ? error.message : "Failed to create event.",
      };
    }
  }

  private async renderUpcomingEventsMessage(
    target?: CallbackScopeTarget,
    path?: string,
  ): Promise<string> {
    const relation = target && path ? this.getRelationOverrides(target, path) : {};
    const events = await this.deps.eventNoteService.listUpcomingEvents(this.deps.getEventsDirectory(), {
      limit: 10,
      project: relation.project,
      area: relation.area,
    });

    if (events.length === 0) {
      if (target && path) {
        return `No upcoming events linked to ${target} "${this.getFileBaseName(path)}".`;
      }

      return "No upcoming events.";
    }

    const title = target && path
      ? `Upcoming events for ${target} "${this.getFileBaseName(path)}"`
      : "Upcoming events";

    return [
      title,
      "",
      ...events.map((item) => renderUpcomingEventLine(item.file, item.event, item.startTimestamp)),
    ].join("\n");
  }

  private registerParaCoreContributions(): void {
    if (!this.deps.paraCoreApi) {
      return;
    }

    this.deps.paraCoreApi.registerTelegramHelpContribution({
      id: "calendar-telegram-help",
      domainId: "calendar",
      order: 30,
      renderHelp: () => [
        "Calendar:",
        "/event",
        "Create a new event. If you omit args, the bot will ask for the next message in this format:",
        "`YYYY-MM-DD HH:mm-HH:mm [sync|nosync] Summary | Description | Location | 15m,1h | https://...`",
        "/events",
        "Show the nearest upcoming events.",
      ],
    });

    for (const target of ["project", "area"] as const) {
      this.deps.paraCoreApi.registerTelegramCardContribution({
        id: `calendar-${target}-card`,
        domainId: "calendar",
        target,
        order: 20,
        renderSection: async (context) => {
          const relation = this.getRelationOverrides(target, context.path);
          const events = await this.deps.eventNoteService.listUpcomingEvents(this.deps.getEventsDirectory(), {
            limit: 3,
            project: relation.project,
            area: relation.area,
          });

          if (events.length === 0) {
            return null;
          }

          return [
            "Upcoming Events",
            ...events.map((item) => renderUpcomingEventLine(item.file, item.event, item.startTimestamp)),
          ].join("\n");
        },
        buildInlineKeyboard: async (context) => {
          const token = this.createCallbackToken({
            target,
            path: context.path,
          });
          return [
            [
              {
                text: "Add Event",
                callbackData: this.encodeCallbackPayload({
                  unit: UNIT_NAME,
                  action: CALLBACK_ACTIONS.createScopedEvent,
                  token,
                }),
              },
              {
                text: "Upcoming Events",
                callbackData: this.encodeCallbackPayload({
                  unit: UNIT_NAME,
                  action: CALLBACK_ACTIONS.listScopedEvents,
                  token,
                }),
              },
            ],
          ];
        },
      });
    }
  }

  private getRelationOverrides(
    target: string,
    path: string,
  ): Partial<CreateCalendarEventInput> {
    const link = `[[${this.getFileBaseName(path)}]]`;
    if (target === "project") {
      return { project: link };
    }

    if (target === "area") {
      return { area: link };
    }

    return {};
  }

  private getFileBaseName(path: string): string {
    const file = this.deps.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file.basename : path.split("/").pop()?.replace(/\.md$/i, "") || path;
  }

  private encodeCallbackPayload(payload: TelegramCallbackPayload): string {
    if (this.api?.encodeCallbackPayload) {
      return this.api.encodeCallbackPayload(payload);
    }

    return JSON.stringify(payload);
  }

  private decodeCallbackPayload(data: string): TelegramCallbackPayload | null {
    if (this.api?.decodeCallbackPayload) {
      return this.api.decodeCallbackPayload(data);
    }

    try {
      return JSON.parse(data) as TelegramCallbackPayload;
    } catch {
      return null;
    }
  }

  private createCallbackToken(input: Omit<CallbackTokenState, "createdAt">): string {
    this.cleanupExpiredTokens();
    this.callbackTokenCounter += 1;
    const token = this.callbackTokenCounter.toString(36);
    this.callbackTokens.set(token, {
      ...input,
      createdAt: Date.now(),
    });
    return token;
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, state] of this.callbackTokens.entries()) {
      if (now - state.createdAt > CALLBACK_TOKEN_TTL_MS) {
        this.callbackTokens.delete(token);
      }
    }
  }
}

function parseTelegramEventInput(input: string): ParsedTelegramEventInput | null {
  const segments = input.split("|").map((part) => part.trim());
  const head = segments[0] || "";
  const headParts = head.split(/\s+/).filter(Boolean);
  if (headParts.length < 2) {
    return null;
  }

  const [dateToken] = headParts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateToken)) {
    return null;
  }

  let cursor = 1;
  let startTime: string | undefined;
  let endTime: string | undefined;
  const timeToken = headParts[cursor];
  if (timeToken && /^(\d{2}:\d{2})(-(\d{2}:\d{2}))?$/.test(timeToken)) {
    const [start, end] = timeToken.split("-");
    startTime = start;
    endTime = end;
    cursor += 1;
  }

  let syncWithCalendar = true;
  const syncToken = headParts[cursor]?.toLowerCase();
  if (syncToken === "sync" || syncToken === "nosync") {
    syncWithCalendar = syncToken === "sync";
    cursor += 1;
  }

  const summary = headParts.slice(cursor).join(" ").trim();
  if (!summary) {
    return null;
  }

  return {
    date: dateToken,
    start_time: startTime,
    end_time: endTime,
    summary,
    description: segments[1] || "",
    location: segments[2] || undefined,
    alarm: normalizeAlarmTokens(segments[3] || ""),
    url: segments[4] || undefined,
    syncWithCalendar,
  };
}

function renderCreatePrompt(target?: CallbackScopeTarget, scopeName?: string): string {
  const scopeLine = target && scopeName ? `${target}: ${scopeName}\n\n` : "";
  return [
    `${scopeLine}Send event in one line:`,
    "",
    "`YYYY-MM-DD HH:mm-HH:mm [sync|nosync] Summary | Description | Location | 15m,1h | https://...`",
    "",
    "Examples:",
    "`2026-04-05 10:00-11:00 sync Team sync | Release prep | Online | 15m,1h`",
    "`2026-04-06 09:00 nosync Dentist | Bring documents | Clinic | 1d`",
  ].join("\n");
}

function renderUpcomingEventLine(
  file: TFile,
  event: CalendarEventNote,
  startTimestamp: number,
): string {
  const start = moment(startTimestamp);
  const timePart = event.start_time
    ? `${event.start_time}${event.end_time ? `-${event.end_time}` : ""}`
    : "all day";
  return `- ${start.format("YYYY-MM-DD")} ${timePart} ${getCalendarEventSummary(event.summary, file.basename)}`;
}

function renderReminderMessage(
  file: TFile,
  event: CalendarEventNote,
  alarm: string,
): string {
  const lines = [
    `Reminder: ${getCalendarEventSummary(event.summary, file.basename)}`,
    `${event.date}${event.start_time ? ` ${event.start_time}${event.end_time ? `-${event.end_time}` : ""}` : ""}`,
    `Alarm: ${alarm} before start`,
  ];

  if (event.location) {
    lines.push(`Location: ${event.location}`);
  }

  if (event.project) {
    lines.push(`Project: ${event.project}`);
  }

  if (event.area) {
    lines.push(`Area: ${event.area}`);
  }

  return lines.join("\n");
}

function getEventStartTimestamp(event: CalendarEventNote): number | null {
  const parsed = event.start_time
    ? moment(`${event.date} ${event.start_time}`, "YYYY-MM-DD HH:mm", true)
    : moment(event.date, "YYYY-MM-DD", true).startOf("day");

  if (!parsed.isValid()) {
    return null;
  }

  return parsed.valueOf();
}
