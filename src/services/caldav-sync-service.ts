import { moment, requestUrl } from "obsidian";
import {
  convertIcsCalendar,
  generateIcsCalendar,
  type IcsCalendar,
  type IcsEvent,
} from "ts-ics";
import { v4 as uuidv4 } from "uuid";
import type { CalendarEventNote, CalendarSyncResult } from "../calendar-event";
import type { ObsidianCalDavPluginSettings } from "../settings";
import { normalizeAlarmTokens, toIcsAlarm } from "../alarm";

export class CalDavSyncService {
  constructor(
    private readonly getSettings: () => ObsidianCalDavPluginSettings,
  ) {}

  async syncEvent(localEvent: CalendarEventNote): Promise<CalendarSyncResult | null> {
    const settings = this.getSettings();
    if (!this.isConfigured(settings)) {
      console.error("CalDAV Event Sync: missing CalDAV settings");
      return null;
    }

    const now = moment().toDate();
    const guid = localEvent.guid || `${uuidv4()}@obsidian.md`;
    const event = this.buildIcsEvent(localEvent, guid, now);
    const calendar: IcsCalendar = {
      prodId: "-//Obsidian Distributed Workspace//CalDAV Event Sync//EN",
      version: "2.0",
      events: [event],
    };

    const calendarUrl = this.buildEventUrl(settings.caldavCalendarUrl, event.uid);
    const auth = this.buildBasicAuth(settings.caldavUsername, settings.caldavPassword);

    try {
      const putResponse = await requestUrl({
        url: calendarUrl,
        method: "PUT",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "text/calendar",
        },
        body: generateIcsCalendar(calendar),
      });

      if (!String(putResponse.status).startsWith("2")) {
        return null;
      }

      const verified = await this.verifySyncedEvent(calendarUrl, auth, guid);
      if (verified) {
        return verified;
      }

      return { guid };
    } catch (error) {
      console.error("CalDAV Event Sync: sync failed", error);
      return null;
    }
  }

  async fetchCalendar(): Promise<IcsCalendar | null> {
    const settings = this.getSettings();
    if (!this.isConfigured(settings)) {
      console.error("CalDAV Event Sync: missing CalDAV settings");
      return null;
    }

    try {
      const response = await requestUrl({
        url: this.buildCalendarRootUrl(settings.caldavCalendarUrl),
        method: "PROPFIND",
        headers: {
          Authorization: `Basic ${this.buildBasicAuth(settings.caldavUsername, settings.caldavPassword)}`,
        },
      });

      if (!String(response.status).startsWith("2")) {
        console.error("CalDAV Event Sync: calendar fetch failed", response.status);
        return null;
      }

      return convertIcsCalendar(undefined, response.text);
    } catch (error) {
      console.error("CalDAV Event Sync: calendar fetch failed", error);
      return null;
    }
  }

  private buildIcsEvent(localEvent: CalendarEventNote, guid: string, createdAt: Date): IcsEvent {
    if (localEvent.start_time) {
      const start = new Date(`${localEvent.date}T${localEvent.start_time}:00`);
      const end = localEvent.end_time
        ? new Date(`${localEvent.date}T${localEvent.end_time}:00`)
        : new Date(start.getTime() + 60 * 60 * 1000);
      return {
        summary: localEvent.summary,
        description: localEvent.description,
        uid: guid,
        created: { date: createdAt },
        stamp: { date: createdAt },
        location: localEvent.location,
        url: localEvent.url,
        start: { date: start, type: "DATE-TIME" },
        end: { date: end, type: "DATE-TIME" },
        alarms: normalizeAlarmTokens(localEvent.alarm).map((token) => toIcsAlarm(token, localEvent.summary)).filter((alarm): alarm is NonNullable<typeof alarm> => Boolean(alarm)),
      };
    }

    const start = new Date(localEvent.date);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return {
      summary: localEvent.summary,
      description: localEvent.description,
      uid: guid,
      created: { date: createdAt },
      stamp: { date: createdAt },
      location: localEvent.location,
      url: localEvent.url,
      start: { date: start, type: "DATE" },
      end: { date: end, type: "DATE" },
      alarms: normalizeAlarmTokens(localEvent.alarm).map((token) => toIcsAlarm(token, localEvent.summary)).filter((alarm): alarm is NonNullable<typeof alarm> => Boolean(alarm)),
    };
  }

  private buildCalendarRootUrl(calendarUrl: string): string {
    return calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  }

  private buildEventUrl(calendarUrl: string, uid: string): string {
    return `${this.buildCalendarRootUrl(calendarUrl)}${uid}`;
  }

  private buildBasicAuth(username: string, password: string): string {
    return btoa(`${username}:${password}`);
  }

  private async verifySyncedEvent(
    calendarUrl: string,
    auth: string,
    guid: string,
  ): Promise<CalendarSyncResult | null> {
    for (const candidateUrl of this.buildVerificationUrls(calendarUrl)) {
      try {
        const response = await requestUrl({
          url: candidateUrl,
          method: "PROPFIND",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        });

        if (!String(response.status).startsWith("2")) {
          continue;
        }

        const syncedCalendar = convertIcsCalendar(undefined, response.text);
        return {
          guid,
          url: syncedCalendar.events?.[0]?.url,
        };
      } catch (error) {
        console.warn(
          `CalDAV Event Sync: verification probe failed for ${candidateUrl}`,
          error,
        );
      }
    }

    return null;
  }

  private buildVerificationUrls(calendarUrl: string): string[] {
    const urls = [calendarUrl];
    if (!calendarUrl.endsWith(".ics")) {
      urls.push(`${calendarUrl}.ics`);
    }

    return urls;
  }

  private isConfigured(settings: ObsidianCalDavPluginSettings): boolean {
    return Boolean(
      settings.caldavUsername.trim() &&
        settings.caldavPassword.trim() &&
        settings.caldavCalendarUrl.trim(),
    );
  }
}
