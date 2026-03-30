import type { App } from "obsidian";
import type { TelegramBotApi } from "obsidian-para-suite-contracts/telegram";

interface TelegramPluginLike {
  getAPI?: () => TelegramBotApi;
}

const TELEGRAM_PLUGIN_ID = "obsidian-telegram-bot-plugin";

export function getTelegramBotApi(app: App): TelegramBotApi | null {
  try {
    // @ts-ignore Obsidian plugin registry is runtime-provided.
    const plugin = app.plugins?.plugins?.[TELEGRAM_PLUGIN_ID] as TelegramPluginLike | undefined;
    return plugin?.getAPI?.() ?? null;
  } catch (error) {
    console.log("CalDAV Event Sync: Telegram API not available", error);
    return null;
  }
}
