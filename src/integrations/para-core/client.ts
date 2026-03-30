import type { App } from "obsidian";
import type { IParaCoreApi } from "./types";

interface ParaCorePluginLike {
  getApi?: () => IParaCoreApi;
}

const PARA_CORE_PLUGIN_ID = "para-core";

export function getParaCoreApi(app: App): IParaCoreApi | null {
  try {
    // @ts-ignore Obsidian plugin registry is runtime-provided.
    const plugin = app.plugins?.plugins?.[PARA_CORE_PLUGIN_ID] as ParaCorePluginLike | undefined;
    if (!plugin || typeof plugin.getApi !== "function") {
      return null;
    }

    const api = plugin.getApi();
    if (
      !api ||
      typeof api.registerNoteType !== "function" ||
      typeof api.registerTemplateContribution !== "function" ||
      typeof api.ensureFolder !== "function" ||
      typeof api.getFolderPath !== "function"
    ) {
      return null;
    }

    return api;
  } catch (error) {
    console.log("CalDAV Event Sync: PARA Core API not available", error);
    return null;
  }
}
