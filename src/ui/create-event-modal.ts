import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { validateCalendarEventInput, type CreateCalendarEventInput } from "../calendar-event";
import { getInvalidAlarmTokens, normalizeAlarmTokens } from "../alarm";

export interface CreateEventModalResult extends CreateCalendarEventInput {
  syncWithCalendar: boolean;
}

interface CreateEventModalOptions {
  initialValue?: Partial<CreateEventModalResult>;
  showParaFields?: boolean;
  projectSuggestions?: string[];
  areaSuggestions?: string[];
  onSubmit: (value: CreateEventModalResult) => Promise<void> | void;
}

export class CreateEventModal extends Modal {
  private value: CreateEventModalResult;
  private rawAlarmValue: string;
  private readonly onSubmit: CreateEventModalOptions["onSubmit"];
  private readonly showParaFields: boolean;
  private readonly projectSuggestions: string[];
  private readonly areaSuggestions: string[];
  private readonly fieldInputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  private readonly fieldErrors = new Map<string, HTMLDivElement>();
  private createButton: ButtonComponent | null = null;

  constructor(app: App, options: CreateEventModalOptions) {
    super(app);
    this.onSubmit = options.onSubmit;
    this.showParaFields = Boolean(options.showParaFields);
    this.projectSuggestions = options.projectSuggestions ?? [];
    this.areaSuggestions = options.areaSuggestions ?? [];
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
    this.rawAlarmValue = (options.initialValue?.alarm ?? []).join(", ");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("caldav-create-event-modal");

    contentEl.createEl("h2", { text: "Create calendar event" });
    contentEl.createEl("p", {
      text: "Date and time use native pickers when available. Leave time empty for an all-day event.",
      cls: "caldav-create-event-hint",
    });

    new Setting(contentEl)
      .setName("Date")
      .setDesc("Required.")
      .addText((text) => {
        text.inputEl.type = "date";
        this.registerField("date", text.inputEl);
        return text.setPlaceholder("2026-04-01").setValue(this.value.date).onChange((value) => {
          this.value.date = value.trim();
          this.updateValidationState();
        });
      });

    new Setting(contentEl)
      .setName("Start time")
      .setDesc("Optional. Leave empty for an all-day event.")
      .addText((text) => {
        text.inputEl.type = "time";
        text.inputEl.step = "300";
        this.registerField("start_time", text.inputEl);
        return text.setPlaceholder("10:00").setValue(this.value.start_time ?? "").onChange((value) => {
          this.value.start_time = value.trim();
          if (!this.value.end_time && /^\d{2}:\d{2}$/.test(this.value.start_time ?? "")) {
            this.value.end_time = addHour(this.value.start_time ?? "");
            const endTimeInput = this.fieldInputs.get("end_time");
            if (endTimeInput instanceof HTMLInputElement) {
              endTimeInput.value = this.value.end_time;
            }
          }
          this.updateValidationState();
        });
      });

    new Setting(contentEl)
      .setName("End time")
      .setDesc("Optional. Must be later than start time.")
      .addText((text) => {
        text.inputEl.type = "time";
        text.inputEl.step = "300";
        this.registerField("end_time", text.inputEl);
        return text.setPlaceholder("11:00").setValue(this.value.end_time ?? "").onChange((value) => {
          this.value.end_time = value.trim();
          this.updateValidationState();
        });
      });

    new Setting(contentEl)
      .setName("Summary")
      .setDesc("Calendar-facing title. Falls back to the note filename if empty.")
      .addText((text) => {
        this.registerField("summary", text.inputEl);
        return text.setPlaceholder("Team sync").setValue(this.value.summary ?? "").onChange((value) => {
          this.value.summary = value.trim();
          this.updateValidationState();
        });
      });

    new Setting(contentEl)
      .setName("Description")
      .setDesc("Stored in the body of the note.")
      .addTextArea((text) => {
        this.registerField("description", text.inputEl);
        return text.setPlaceholder("Agenda, details, links...").setValue(this.value.description ?? "").onChange((value) => {
          this.value.description = value;
          this.updateValidationState();
        });
      });

    new Setting(contentEl)
      .setName("Location")
      .addText((text) => {
        this.registerField("location", text.inputEl);
        return text.setPlaceholder("Online").setValue(this.value.location ?? "").onChange((value) => {
          this.value.location = value.trim();
          this.updateValidationState();
        });
      });

    new Setting(contentEl)
      .setName("URL")
      .addText((text) => {
        this.registerField("url", text.inputEl);
        return text.setPlaceholder("https://...").setValue(this.value.url ?? "").onChange((value) => {
          this.value.url = value.trim();
          this.updateValidationState();
        });
      });

    new Setting(contentEl)
      .setName("Alarms")
      .setDesc("Comma-separated offsets like 15m, 1h, 1d.")
      .addText((text) => {
        this.registerField("alarm", text.inputEl);
        return text
          .setPlaceholder("15m, 1h")
          .setValue(this.rawAlarmValue)
          .onChange((value) => {
            this.rawAlarmValue = value;
            this.value.alarm = normalizeAlarmTokens(value);
            this.updateValidationState();
          });
      });

    if (this.showParaFields) {
      new Setting(contentEl)
        .setName("Project")
        .setDesc("Optional. Start typing to pick an existing project note, or enter a new title.")
        .addText((text) => {
          this.registerField("project", text.inputEl);
          text.setPlaceholder("[[Project]]").setValue(this.value.project ?? "").onChange((value) => {
            this.value.project = value.trim();
            this.updateValidationState();
          });
          this.attachSuggestions(text.inputEl, "caldav-project-suggestions", this.projectSuggestions);
          return text;
        });

      new Setting(contentEl)
        .setName("Area")
        .setDesc("Optional. Start typing to pick an existing area note, or enter a new title.")
        .addText((text) => {
          this.registerField("area", text.inputEl);
          text.setPlaceholder("[[Area]]").setValue(this.value.area ?? "").onChange((value) => {
            this.value.area = value.trim();
            this.updateValidationState();
          });
          this.attachSuggestions(text.inputEl, "caldav-area-suggestions", this.areaSuggestions);
          return text;
        });
    }

    new Setting(contentEl)
      .setName("Sync with calendar")
      .setDesc("If enabled, the plugin will sync the event right after creation.")
      .addToggle((toggle) =>
        toggle.setValue(this.value.syncWithCalendar).onChange((value) => {
          this.value.syncWithCalendar = value;
        }),
      );

    new Setting(contentEl)
      .addButton((button) => {
        this.createButton = button;
        return button.setButtonText("Create").setCta().onClick(async () => {
          const payload: CreateEventModalResult = {
            ...this.value,
            date: this.value.date.trim(),
            start_time: this.value.start_time?.trim() || undefined,
            end_time: this.value.end_time?.trim() || undefined,
            summary: this.value.summary?.trim() || undefined,
            description: this.value.description?.trim() || "",
            location: this.value.location?.trim() || undefined,
            url: this.value.url?.trim() || undefined,
            project: this.showParaFields ? this.value.project?.trim() || undefined : undefined,
            area: this.showParaFields ? this.value.area?.trim() || undefined : undefined,
            alarm: normalizeAlarmTokens(this.rawAlarmValue),
          };

          try {
            await this.onSubmit(payload);
            this.close();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "Failed to create event.");
          }
        });
      })
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      );

    this.updateValidationState();
  }

  onClose(): void {
    this.modalEl.removeClass("caldav-create-event-modal");
    this.contentEl.empty();
  }

  private attachSuggestions(inputEl: HTMLInputElement, listId: string, values: string[]): void {
    if (values.length === 0) {
      return;
    }

    inputEl.setAttribute("list", listId);
    if (this.contentEl.querySelector(`#${listId}`)) {
      return;
    }

    const datalist = this.contentEl.createEl("datalist");
    datalist.id = listId;
    for (const value of values) {
      datalist.createEl("option", { value });
    }
  }

  private registerField(name: string, inputEl: HTMLInputElement | HTMLTextAreaElement): void {
    this.fieldInputs.set(name, inputEl);
    inputEl.addClass("caldav-create-event-input");
    const errorEl = inputEl.parentElement?.createDiv({ cls: "caldav-create-event-error" });
    if (errorEl) {
      errorEl.setText("");
      this.fieldErrors.set(name, errorEl);
    }
  }

  private updateValidationState(): void {
    const fieldErrors = this.collectFieldErrors();
    const fields = new Set([...this.fieldInputs.keys(), ...this.fieldErrors.keys()]);

    for (const fieldName of fields) {
      const inputEl = this.fieldInputs.get(fieldName);
      const errorEl = this.fieldErrors.get(fieldName);
      const errorMessage = fieldErrors.get(fieldName) ?? "";

      inputEl?.classList.toggle("is-invalid", Boolean(errorMessage));
      if (errorEl) {
        errorEl.setText(errorMessage);
        errorEl.classList.toggle("is-visible", Boolean(errorMessage));
      }
    }

    this.createButton?.setDisabled(fieldErrors.size > 0);
  }

  private collectFieldErrors(): Map<string, string> {
    const payload: CreateEventModalResult = {
      ...this.value,
      date: this.value.date.trim(),
      start_time: this.value.start_time?.trim() || undefined,
      end_time: this.value.end_time?.trim() || undefined,
      summary: this.value.summary?.trim() || undefined,
      description: this.value.description?.trim() || "",
      location: this.value.location?.trim() || undefined,
      url: this.value.url?.trim() || undefined,
      project: this.showParaFields ? this.value.project?.trim() || undefined : undefined,
      area: this.showParaFields ? this.value.area?.trim() || undefined : undefined,
      alarm: normalizeAlarmTokens(this.rawAlarmValue),
    };
    const issues = new Map<string, string>();
    const invalidAlarms = getInvalidAlarmTokens(this.rawAlarmValue);
    if (invalidAlarms.length > 0) {
      issues.set("alarm", `Invalid alarm values: ${invalidAlarms.join(", ")}. Use 15m, 1h, 1d, or 1w.`);
    }

    for (const issue of validateCalendarEventInput(payload)) {
      if (issue.includes("date")) {
        issues.set("date", issue);
      } else if (issue.includes("Start time")) {
        issues.set("start_time", issue);
      } else if (issue.includes("End time")) {
        issues.set("end_time", issue);
      } else if (issue.includes("URL")) {
        issues.set("url", issue);
      }
    }

    return issues;
  }
}

function addHour(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return value;
  }

  const nextHour = (hours + 1) % 24;
  return `${nextHour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}
