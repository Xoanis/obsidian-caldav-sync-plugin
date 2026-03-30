import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianCalDAVPlugin from "../main";

export class ObsidianCalDAVPluginSettingsTab extends PluginSettingTab {
  plugin: ObsidianCalDAVPlugin;

  constructor(app: App, plugin: ObsidianCalDAVPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "CalDAV Event Sync settings" });

    new Setting(containerEl)
      .setName("Events folder")
      .setDesc(
        'Vault folder for event notes in standalone mode. When PARA Core is available, events are stored automatically in "Records/Calendar/Events".',
      )
      .addText((text) =>
        text
          .setPlaceholder("Records/Calendar/Events")
          .setValue(this.plugin.settings.eventsDirectory)
          .onChange(async (value) => {
            this.plugin.settings.eventsDirectory = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("CalDAV username")
      .setDesc("Account login for your CalDAV provider. Yandex is one supported example.")
      .addText((text) =>
        text
          .setPlaceholder("username@example.com")
          .setValue(this.plugin.settings.caldavUsername)
          .onChange(async (value) => {
            this.plugin.settings.caldavUsername = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("CalDAV app password")
      .setDesc("Use an app password or provider-specific token when your calendar service supports it.")
      .addText((text) => {
        text
          .setPlaceholder("App password")
          .setValue(this.plugin.settings.caldavPassword)
          .onChange(async (value) => {
            this.plugin.settings.caldavPassword = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("CalDAV calendar URL")
      .setDesc(
        "Full CalDAV calendar URL. Example for Yandex: https://caldav.yandex.ru/calendars/user@yandex.ru/calendar-id/",
      )
      .addText((text) =>
        text
          .setPlaceholder("https://caldav.example.com/calendars/...")
          .setValue(this.plugin.settings.caldavCalendarUrl)
          .onChange(async (value) => {
            this.plugin.settings.caldavCalendarUrl = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
