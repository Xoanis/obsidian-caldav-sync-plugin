import { CALENDAR_DOMAIN_ID } from "../../calendar-event";
import type { IParaCoreApi } from "./types";

export function registerCalendarTemplateContributions(
  api: IParaCoreApi,
  getEventsDirectory: () => string,
): void {
  api.registerTemplateContribution({
    id: "calendar-guideline-guide",
    domainId: CALENDAR_DOMAIN_ID,
    target: "guideline",
    slot: "guideline.domainGuides",
    order: 30,
    render: () => `## Calendar Events

- \`calendar-event\` notes are owned by the calendar plugin, not by PARA Core itself.
- Keep active event notes under \`${getEventsDirectory()}/\` for the shared workspace default.
- Archive past or cancelled event notes through the mirrored \`Archive/${getEventsDirectory()}/\` path when they should leave the active system.
- Use calendar events for time-bound commitments. Add optional \`project\` or \`area\` links only when that context is genuinely useful.`,
  });
}
