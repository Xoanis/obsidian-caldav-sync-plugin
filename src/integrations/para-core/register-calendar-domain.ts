import {
  CALENDAR_DOMAIN_ID,
  DEFAULT_CALENDAR_RECORDS_PATH,
} from "../../calendar-event";
import { getCalendarEventNoteType } from "./calendar-note-type";
import type { IParaCoreApi, RegisteredParaDomain } from "./types";

export function registerCalendarDomain(api: IParaCoreApi): RegisteredParaDomain {
  return api.registerDomain({
    id: CALENDAR_DOMAIN_ID,
    displayName: "Calendar",
    recordsPath: DEFAULT_CALENDAR_RECORDS_PATH,
    noteTypes: [getCalendarEventNoteType()],
  });
}
