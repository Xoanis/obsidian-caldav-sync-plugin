import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { getParaCoreApi } from "./src/integrations/para-core/client";
import { getCalendarEventNoteType } from "./src/integrations/para-core/calendar-note-type";
import { registerCalendarTemplateContributions } from "./src/integrations/para-core/register-calendar-template-contributions";
import type { IParaCoreApi } from "./src/integrations/para-core/types";
import { ObsidianCalDAVPluginSettingsTab } from "./src/settings-tab";
import {
  DEFAULT_SETTINGS,
  loadCalDavSettings,
  saveCalDavSettings,
  type ObsidianCalDavPluginSettings,
} from "./src/settings";
import { CalDavSyncService } from "./src/services/caldav-sync-service";
import { EventNoteService } from "./src/services/event-note-service";
import { CALENDAR_EVENT_TYPE } from "./src/calendar-event";

export default class ObsidianCalDAVPlugin extends Plugin {
  settings: ObsidianCalDavPluginSettings = DEFAULT_SETTINGS;

  private paraCoreApi: IParaCoreApi | null = null;
  private eventNoteService!: EventNoteService;
  private calDavSyncService!: CalDavSyncService;

  async onload() {
    await this.loadSettings();

    this.eventNoteService = new EventNoteService(this.app);
    this.calDavSyncService = new CalDavSyncService(() => this.settings);
    this.initializeParaCoreIntegration();

    this.addSettingTab(new ObsidianCalDAVPluginSettingsTab(this.app, this));
    this.registerCommands();
    await this.ensureEventsFolder();
  }

  onunload() {
    console.log("CalDAV Event Sync unloaded");
  }

  getEventsDirectory(): string {
    return this.settings.eventsDirectory.trim() || DEFAULT_SETTINGS.eventsDirectory;
  }

  async loadSettings() {
    this.settings = loadCalDavSettings(await this.loadData());
  }

  async saveSettings() {
    await saveCalDavSettings(this, this.settings);
    await this.ensureEventsFolder();
  }

  private registerCommands() {
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
    if (!this.paraCoreApi) {
      console.log("CalDAV Event Sync: PARA Core integration not available");
      return;
    }

    this.paraCoreApi.registerNoteType(getCalendarEventNoteType());
    registerCalendarTemplateContributions(this.paraCoreApi, () => this.getEventsDirectory());
    void this.ensureCalendarEventTemplateFile();
    console.log("CalDAV Event Sync: registered PARA Core note type and guideline contributions");
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
}
