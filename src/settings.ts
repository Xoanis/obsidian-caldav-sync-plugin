import type { Plugin } from "obsidian";
import { DEFAULT_EVENTS_DIRECTORY } from "./calendar-event";

export interface ObsidianCalDavPluginSettings {
  eventsDirectory: string;
  caldavUsername: string;
  caldavPassword: string;
  caldavCalendarUrl: string;
}

interface LegacySettingsShape {
  eventsDirectory?: unknown;
  caldavUsername?: unknown;
  caldavPassword?: unknown;
  caldavCalendarUrl?: unknown;
  yandexUsername?: unknown;
  yandexAppPassword?: unknown;
  yandexCalendarUrl?: unknown;
}

export const DEFAULT_SETTINGS: ObsidianCalDavPluginSettings = {
  eventsDirectory: DEFAULT_EVENTS_DIRECTORY,
  caldavUsername: "",
  caldavPassword: "",
  caldavCalendarUrl: "",
};

export function loadCalDavSettings(data: unknown): ObsidianCalDavPluginSettings {
  const raw = (data ?? {}) as LegacySettingsShape;

  return {
    eventsDirectory: readString(raw.eventsDirectory) || DEFAULT_SETTINGS.eventsDirectory,
    caldavUsername:
      readString(raw.caldavUsername) || readString(raw.yandexUsername) || DEFAULT_SETTINGS.caldavUsername,
    caldavPassword:
      readString(raw.caldavPassword) ||
      readString(raw.yandexAppPassword) ||
      DEFAULT_SETTINGS.caldavPassword,
    caldavCalendarUrl:
      readString(raw.caldavCalendarUrl) ||
      readString(raw.yandexCalendarUrl) ||
      DEFAULT_SETTINGS.caldavCalendarUrl,
  };
}

export async function saveCalDavSettings(
  plugin: Plugin,
  settings: ObsidianCalDavPluginSettings,
): Promise<void> {
  await plugin.saveData({
    eventsDirectory: settings.eventsDirectory.trim() || DEFAULT_SETTINGS.eventsDirectory,
    caldavUsername: settings.caldavUsername.trim(),
    caldavPassword: settings.caldavPassword.trim(),
    caldavCalendarUrl: settings.caldavCalendarUrl.trim(),
  });
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
