import { App, PluginSettingTab, Setting, TextComponent } from "obsidian";
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
      .addText((text) => {
        text
          .setPlaceholder("Records/Calendar/Events")
          .setValue(this.plugin.settings.eventsDirectory);

        this.bindTextSetting(text, {
          getValue: () => this.plugin.settings.eventsDirectory,
          setValue: (value) => {
            this.plugin.settings.eventsDirectory = value;
          },
        });
      });

    new Setting(containerEl)
      .setName("CalDAV username")
      .setDesc("Account login for your CalDAV provider. Yandex is one supported example.")
      .addText((text) => {
        text
          .setPlaceholder("username@example.com")
          .setValue(this.plugin.settings.caldavUsername);

        this.bindTextSetting(text, {
          getValue: () => this.plugin.settings.caldavUsername,
          setValue: (value) => {
            this.plugin.settings.caldavUsername = value;
          },
        });
      });

    new Setting(containerEl)
      .setName("CalDAV app password")
      .setDesc("Use an app password or provider-specific token when your calendar service supports it.")
      .addText((text) => {
        text
          .setPlaceholder("App password")
          .setValue(this.plugin.settings.caldavPassword);
        text.inputEl.type = "password";

        this.bindTextSetting(text, {
          getValue: () => this.plugin.settings.caldavPassword,
          setValue: (value) => {
            this.plugin.settings.caldavPassword = value;
          },
        });
      });

    new Setting(containerEl)
      .setName("CalDAV calendar URL")
      .setDesc(
        "Full CalDAV calendar URL. Example for Yandex: https://caldav.yandex.ru/calendars/user@yandex.ru/calendar-id/",
      )
      .addText((text) => {
        text
          .setPlaceholder("https://caldav.example.com/calendars/...")
          .setValue(this.plugin.settings.caldavCalendarUrl);

        this.bindTextSetting(text, {
          getValue: () => this.plugin.settings.caldavCalendarUrl,
          setValue: (value) => {
            this.plugin.settings.caldavCalendarUrl = value;
          },
        });
      });
  }

  private bindTextSetting(
    text: TextComponent,
    options: {
      getValue: () => string;
      setValue: (value: string) => void;
    },
  ): void {
    let draftValue = options.getValue();

    const commit = async () => {
      const currentValue = options.getValue();
      if (draftValue === currentValue) {
        return;
      }

      options.setValue(draftValue);
      await this.plugin.saveSettings();
    };

    text.onChange((value) => {
      draftValue = value;
    });

    text.inputEl.addEventListener("blur", () => {
      void commit();
    });

    text.inputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      text.inputEl.blur();
      void commit();
    });
  }
}
