import type { App } from "obsidian";
import type { TelegramBotApi } from "obsidian-para-suite-contracts/telegram";

interface TelegramPluginLike {
  getAPI?: () => TelegramBotApi;
}

const TELEGRAM_PLUGIN_IDS = ["obsidian-telegram-bot-plugin", "obsidian-telegram-bot"];

export function getTelegramBotApi(app: App): TelegramBotApi | null {
  try {
    for (const pluginId of TELEGRAM_PLUGIN_IDS) {
      // @ts-ignore Obsidian plugin registry is runtime-provided.
      const plugin = app.plugins?.plugins?.[pluginId] as TelegramPluginLike | undefined;
      const api = plugin?.getAPI?.();
      if (api) {
        return api;
      }
    }

    return null;
  } catch (error) {
    console.log("CalDAV Event Sync: Telegram API not available", error);
    return null;
  }
}
