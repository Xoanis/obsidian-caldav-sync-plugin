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

- \`calendar-event\` is a standard domain note type registered by the Calendar domain plugin.
- Keep active event notes under \`${getEventsDirectory()}/\`.
- Archive past or cancelled event notes through the mirrored \`Archive/${getEventsDirectory()}/\` path when they should leave the active system.
- Prefer explicit \`summary\` in frontmatter for calendar-facing event titles. If it is empty, the plugin falls back to the note filename.
- Use \`alarm\` as a YAML array of offsets such as \`["15m", "1h", "1d"]\`.
- Calendar events are structured domain records. Add optional \`project\` or \`area\` links only when that context is genuinely useful.`,
  });

  api.registerTemplateContribution({
    id: "calendar-dashboard-upcoming-events",
    domainId: CALENDAR_DOMAIN_ID,
    target: "dashboard",
    slot: "dashboard.domainViews",
    order: 20,
    render: () => `## Upcoming Events
\`\`\`dataview
TABLE summary, date, start_time, project, area, file.link
FROM "${getEventsDirectory()}"
WHERE type = "calendar-event" AND status = "active" AND date >= date(today)
SORT date ASC, start_time ASC
LIMIT 12
\`\`\``,
  });

  api.registerTemplateContribution({
    id: "calendar-project-upcoming-events",
    domainId: CALENDAR_DOMAIN_ID,
    target: "project",
    slot: "project.domainViews",
    order: 20,
    render: () => `## Upcoming Events
\`\`\`dataview
TABLE summary, date, start_time, area, file.link
FROM "${getEventsDirectory()}"
WHERE type = "calendar-event" AND status = "active" AND project = this.file.link AND date >= date(today)
SORT date ASC, start_time ASC
LIMIT 10
\`\`\``,
  });

  api.registerTemplateContribution({
    id: "calendar-area-upcoming-events",
    domainId: CALENDAR_DOMAIN_ID,
    target: "area",
    slot: "area.domainViews",
    order: 20,
    render: () => `## Upcoming Events
\`\`\`dataview
TABLE summary, date, start_time, project, file.link
FROM "${getEventsDirectory()}"
WHERE type = "calendar-event" AND status = "active" AND area = this.file.link AND date >= date(today)
SORT date ASC, start_time ASC
LIMIT 10
\`\`\``,
  });
}
