import { App, Modal, Notice, Setting } from "obsidian";
import type { CreateCalendarEventInput } from "../calendar-event";
import { normalizeAlarmTokens } from "../alarm";

export interface CreateEventModalResult extends CreateCalendarEventInput {
  syncWithCalendar: boolean;
}

interface CreateEventModalOptions {
  initialValue?: Partial<CreateEventModalResult>;
  onSubmit: (value: CreateEventModalResult) => Promise<void> | void;
}

export class CreateEventModal extends Modal {
  private value: CreateEventModalResult;
  private readonly onSubmit: CreateEventModalOptions["onSubmit"];

  constructor(app: App, options: CreateEventModalOptions) {
    super(app);
    this.onSubmit = options.onSubmit;
    this.value = {
      date: options.initialValue?.date ?? "",
      start_time: options.initialValue?.start_time ?? "",
      end_time: options.initialValue?.end_time ?? "",
      summary: options.initialValue?.summary ?? "",
      description: options.initialValue?.description ?? "",
      location: options.initialValue?.location ?? "",
      url: options.initialValue?.url ?? "",
      alarm: options.initialValue?.alarm ?? [],
      project: options.initialValue?.project ?? "",
      area: options.initialValue?.area ?? "",
      syncWithCalendar: options.initialValue?.syncWithCalendar ?? true,
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Create calendar event" });

    new Setting(contentEl)
      .setName("Date")
      .setDesc("Use YYYY-MM-DD.")
      .addText((text) =>
        text.setPlaceholder("2026-04-01").setValue(this.value.date).onChange((value) => {
          this.value.date = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("Start time")
      .setDesc("Optional. Use HH:mm.")
      .addText((text) =>
        text.setPlaceholder("10:00").setValue(this.value.start_time ?? "").onChange((value) => {
          this.value.start_time = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("End time")
      .setDesc("Optional. Use HH:mm.")
      .addText((text) =>
        text.setPlaceholder("11:00").setValue(this.value.end_time ?? "").onChange((value) => {
          this.value.end_time = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("Summary")
      .setDesc("Calendar-facing title. Falls back to the note filename if empty.")
      .addText((text) =>
        text.setPlaceholder("Team sync").setValue(this.value.summary ?? "").onChange((value) => {
          this.value.summary = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("Description")
      .setDesc("Stored in the body of the note.")
      .addTextArea((text) =>
        text.setPlaceholder("Agenda, details, links...").setValue(this.value.description ?? "").onChange((value) => {
          this.value.description = value;
        }),
      );

    new Setting(contentEl)
      .setName("Location")
      .addText((text) =>
        text.setPlaceholder("Online").setValue(this.value.location ?? "").onChange((value) => {
          this.value.location = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("URL")
      .addText((text) =>
        text.setPlaceholder("https://...").setValue(this.value.url ?? "").onChange((value) => {
          this.value.url = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("Alarms")
      .setDesc("Comma-separated offsets like 15m, 1h, 1d.")
      .addText((text) =>
        text
          .setPlaceholder("15m, 1h")
          .setValue((this.value.alarm ?? []).join(", "))
          .onChange((value) => {
            this.value.alarm = normalizeAlarmTokens(value);
          }),
      );

    new Setting(contentEl)
      .setName("Project")
      .setDesc("Optional wiki-link or plain project title.")
      .addText((text) =>
        text.setPlaceholder("[[Project]]").setValue(this.value.project ?? "").onChange((value) => {
          this.value.project = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("Area")
      .setDesc("Optional wiki-link or plain area title.")
      .addText((text) =>
        text.setPlaceholder("[[Area]]").setValue(this.value.area ?? "").onChange((value) => {
          this.value.area = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("Sync with calendar")
      .setDesc("If enabled, the plugin will sync the event right after creation.")
      .addToggle((toggle) =>
        toggle.setValue(this.value.syncWithCalendar).onChange((value) => {
          this.value.syncWithCalendar = value;
        }),
      );

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Create").setCta().onClick(async () => {
          if (!this.value.date.trim()) {
            new Notice("Event date is required.");
            return;
          }

          await this.onSubmit({
            ...this.value,
            date: this.value.date.trim(),
            start_time: this.value.start_time?.trim() || undefined,
            end_time: this.value.end_time?.trim() || undefined,
            summary: this.value.summary?.trim() || undefined,
            description: this.value.description?.trim() || "",
            location: this.value.location?.trim() || undefined,
            url: this.value.url?.trim() || undefined,
            project: this.value.project?.trim() || undefined,
            area: this.value.area?.trim() || undefined,
            alarm: normalizeAlarmTokens(this.value.alarm),
          });
          this.close();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      );
  }
}
