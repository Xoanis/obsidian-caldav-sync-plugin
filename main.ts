import { MarkdownView, Notice, Plugin, TFile, moment, normalizePath } from "obsidian";
import { getParaCoreApi } from "./src/integrations/para-core/client";
import { getCalendarEventNoteType } from "./src/integrations/para-core/calendar-note-type";
import { registerCalendarTemplateContributions } from "./src/integrations/para-core/register-calendar-template-contributions";
import { registerCalendarDomain } from "./src/integrations/para-core/register-calendar-domain";
import type { IParaCoreApi, RegisteredParaDomain } from "./src/integrations/para-core/types";
import { CalendarTelegramBridge } from "./src/integrations/telegram/calendar-telegram-bridge";
import { ObsidianCalDAVPluginSettingsTab } from "./src/settings-tab";
import {
  DEFAULT_STATE,
  DEFAULT_SETTINGS,
  loadCalDavState,
  loadCalDavSettings,
  saveCalDavSettings,
  type ObsidianCalDavPluginState,
  type ObsidianCalDavPluginSettings,
} from "./src/settings";
import { CalDavSyncService } from "./src/services/caldav-sync-service";
import { EventNoteService } from "./src/services/event-note-service";
import { CALENDAR_EVENT_TYPE } from "./src/calendar-event";
import { CreateEventModal, type CreateEventModalResult } from "./src/ui/create-event-modal";

export default class ObsidianCalDAVPlugin extends Plugin {
  settings: ObsidianCalDavPluginSettings = DEFAULT_SETTINGS;
  state: ObsidianCalDavPluginState = DEFAULT_STATE;

  private paraCoreApi: IParaCoreApi | null = null;
  private calendarDomain: RegisteredParaDomain | null = null;
  private eventNoteService!: EventNoteService;
  private calDavSyncService!: CalDavSyncService;
  private telegramBridge: CalendarTelegramBridge | null = null;

  async onload() {
    await this.loadSettings();

    this.eventNoteService = new EventNoteService(this.app);
    this.calDavSyncService = new CalDavSyncService(() => this.settings);
    this.initializeParaCoreIntegration();
    this.initializeTelegramIntegration();

    this.addSettingTab(new ObsidianCalDAVPluginSettingsTab(this.app, this));
    this.registerCommands();
    await this.ensureEventsFolder();
  }

  onunload() {
    this.telegramBridge?.dispose();
    console.log("CalDAV Event Sync unloaded");
  }

  getEventsDirectory(): string {
    if (this.calendarDomain) {
      return `${this.calendarDomain.recordsPath}/Events`;
    }

    return this.settings.eventsDirectory.trim() || DEFAULT_SETTINGS.eventsDirectory;
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = loadCalDavSettings(data);
    this.state = loadCalDavState(data);
  }

  async saveSettings() {
    await saveCalDavSettings(this, this.settings, this.state);
    await this.ensureEventsFolder();
  }

  async savePluginData() {
    await saveCalDavSettings(this, this.settings, this.state);
  }

  private registerCommands() {
    this.addCommand({
      id: "create-event",
      name: "Create new calendar event",
      callback: async () => {
        await this.createEventFromModal();
      },
    });

    this.addCommand({
      id: "sync-event",
      name: "Sync event with calendar",
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice("No active file to sync.");
          return;
        }

        await this.syncEventFile(activeFile, true);
      },
    });

    this.addCommand({
      id: "sync-all-events",
      name: "Sync all events with calendar",
      callback: async () => {
        await this.syncAllEvents();
      },
    });
  }

  private initializeParaCoreIntegration() {
    this.paraCoreApi = getParaCoreApi(this.app);
    this.calendarDomain = null;
    if (!this.paraCoreApi) {
      console.log("CalDAV Event Sync: PARA Core integration not available");
      return;
    }

    this.calendarDomain = registerCalendarDomain(this.paraCoreApi);
    registerCalendarTemplateContributions(this.paraCoreApi, () => this.getEventsDirectory());
    void this.ensureCalendarEventTemplateFile();
    console.log("CalDAV Event Sync: registered PARA Core calendar domain and contributions");
  }

  private async ensureCalendarEventTemplateFile(): Promise<void> {
    if (!this.paraCoreApi) {
      return;
    }

    const templatePath = normalizePath(
      `${this.paraCoreApi.getSettings().folders.templates}/${CALENDAR_EVENT_TYPE}.md`,
    );
    if (this.app.vault.getAbstractFileByPath(templatePath)) {
      return;
    }

    const definition = getCalendarEventNoteType();
    await this.app.vault.create(
      templatePath,
      definition.template({
        title: "{{title}}",
        date: "{{date}}",
        timestamp: "{{timestamp}}",
        frontmatter: definition.defaultFrontmatter("{{date}}", "{{timestamp}}"),
      }),
    );
  }

  private async ensureEventsFolder() {
    const eventsDirectory = this.getEventsDirectory();
    if (this.paraCoreApi) {
      await this.paraCoreApi.ensureFolder(eventsDirectory);
      return;
    }

    await this.eventNoteService.ensureFolder(eventsDirectory);
  }

  private async syncAllEvents() {
    const eventFiles = this.eventNoteService.listEventFiles(this.getEventsDirectory());
    if (eventFiles.length === 0) {
      new Notice("No event notes found in the configured events folder.");
      return;
    }

    const localGuids = new Set<string>();
    let syncedCount = 0;

    for (const file of eventFiles) {
      const guid = await this.eventNoteService.getEventGuid(file);
      if (guid) {
        localGuids.add(guid);
      }

      const synced = await this.syncEventFile(file, false);
      if (synced) {
        syncedCount += 1;
      }
    }

    const calendar = await this.calDavSyncService.fetchCalendar();
    if (!calendar?.events?.length) {
      new Notice(`Synced ${syncedCount} local event(s).`);
      return;
    }

    let importedCount = 0;
    for (const remoteEvent of calendar.events) {
      if (!remoteEvent.uid || localGuids.has(remoteEvent.uid)) {
        continue;
      }

      const created = await this.eventNoteService.createEventFileFromRemoteEvent(
        this.getEventsDirectory(),
        remoteEvent,
      );
      if (created) {
        importedCount += 1;
      }
    }

    new Notice(
      `Synced ${syncedCount} local event(s) and imported ${importedCount} remote event(s).`,
    );
  }

  private async syncEventFile(file: TFile, showSuccessNotice: boolean): Promise<boolean> {
    const event = await this.eventNoteService.readEventFile(file);
    if (!event) {
      new Notice("Active note is not a calendar-event note.");
      return false;
    }

    const syncResult = await this.calDavSyncService.syncEvent(event);
    if (!syncResult) {
      new Notice(`Failed to sync event: ${file.basename}`);
      return false;
    }

    await this.eventNoteService.updateSyncMetadata(file, syncResult.guid, syncResult.url);
    if (showSuccessNotice) {
      new Notice(`Synced event: ${file.basename}`);
    }

    return true;
  }

  private async createEventFromModal(): Promise<void> {
    const sourceView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const sourceEditor = sourceView?.editor;
    const sourceFile = sourceView?.file;
    const initialValue = this.getCreateEventInitialValue(sourceFile ?? null);

    new CreateEventModal(this.app, {
      initialValue,
      onSubmit: async (value) => {
        await this.handleCreateEventModalSubmit(value, sourceEditor, sourceFile?.path);
      },
    }).open();
  }

  private getCreateEventInitialValue(activeFile: TFile | null): Partial<CreateEventModalResult> {
    const today = moment().format("YYYY-MM-DD");
    const frontmatter = activeFile
      ? this.app.metadataCache.getFileCache(activeFile)?.frontmatter
      : undefined;

    if (frontmatter?.type === "project") {
      return {
        date: today,
        project: `[[${activeFile?.basename}]]`,
      };
    }

    if (frontmatter?.type === "area") {
      return {
        date: today,
        area: `[[${activeFile?.basename}]]`,
      };
    }

    return {
      date: today,
    };
  }

  private async handleCreateEventModalSubmit(
    value: CreateEventModalResult,
    sourceEditor: MarkdownView["editor"] | undefined,
    sourcePath?: string,
  ): Promise<void> {
    const created = await this.eventNoteService.createEventFile(this.getEventsDirectory(), value);

    if (sourceEditor && sourcePath !== created.path) {
      sourceEditor.replaceSelection(`![[${created.path}]]`);
    }

    await this.app.workspace.getLeaf(true).openFile(created);

    if (value.syncWithCalendar) {
      const synced = await this.syncEventFile(created, false);
      if (!synced) {
        new Notice(`Event created, but calendar sync failed: ${created.basename}`);
        return;
      }
    }

    new Notice(`Created event: ${created.basename}`);
  }

  private initializeTelegramIntegration() {
    this.telegramBridge = new CalendarTelegramBridge({
      app: this.app,
      paraCoreApi: this.paraCoreApi,
      eventNoteService: this.eventNoteService,
      calDavSyncService: this.calDavSyncService,
      getEventsDirectory: () => this.getEventsDirectory(),
      getReminderState: () => this.state.sentReminderKeys,
      saveReminderState: async (sentReminderKeys) => {
        this.state.sentReminderKeys = sentReminderKeys;
        await this.savePluginData();
      },
    });

    const registered = this.telegramBridge.register();
    if (!registered) {
      return;
    }

    this.registerInterval(window.setInterval(() => {
      void this.telegramBridge?.checkDueReminders();
    }, 60 * 1000));
    void this.telegramBridge.checkDueReminders();
  }
}
