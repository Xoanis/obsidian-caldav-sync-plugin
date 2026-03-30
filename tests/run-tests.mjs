import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const tempRoot = path.join(process.cwd(), "tests", ".tmp");
mkdirSync(tempRoot, { recursive: true });
const tempDir = mkdtempSync(path.join(tempRoot, "caldav-sync-tests-"));

try {
  const outfile = path.join(tempDir, "caldav-response.mjs");
  const source = readFileSync("src/services/caldav-response.ts", "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: "caldav-response.ts",
  });
  writeFileSync(outfile, transpiled.outputText, "utf8");

  const {
    parseCalendarEventResponse,
    parseCalendarResponse,
  } = await import(pathToFileURL(outfile).href);

  run("parses direct ICS calendar responses", () => {
    const calendar = parseCalendarResponse([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Example//EN",
      "BEGIN:VEVENT",
      "UID:test-1@example.com",
      "DTSTART;VALUE=DATE:20260401",
      "DTEND;VALUE=DATE:20260402",
      "SUMMARY:Direct fetch",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n"));

    assert.equal(calendar?.events?.length, 1);
    assert.equal(calendar?.events?.[0]?.uid, "test-1@example.com");
    assert.equal(calendar?.events?.[0]?.summary, "Direct fetch");
  });

  run("parses CalDAV REPORT multistatus responses with embedded calendar-data", () => {
    const reportResponse = [
      "<?xml version='1.0' encoding='utf-8'?>",
      '<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">',
      "  <response>",
      "    <href>/calendar/a.ics</href>",
      "    <propstat>",
      "      <prop>",
      "        <C:calendar-data>BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:report-1@example.com",
      "DTSTART;VALUE=DATE:20260403",
      "DTEND;VALUE=DATE:20260404",
      "SUMMARY:Report one",
      "END:VEVENT",
      "END:VCALENDAR</C:calendar-data>",
      "      </prop>",
      "    </propstat>",
      "  </response>",
      "  <response>",
      "    <href>/calendar/b.ics</href>",
      "    <propstat>",
      "      <prop>",
      "        <C:calendar-data>BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:report-2@example.com",
      "DTSTART;VALUE=DATE:20260405",
      "DTEND;VALUE=DATE:20260406",
      "SUMMARY:Report two &amp; more",
      "END:VEVENT",
      "END:VCALENDAR</C:calendar-data>",
      "      </prop>",
      "    </propstat>",
      "  </response>",
      "</multistatus>",
    ].join("\n");

    const calendar = parseCalendarResponse(reportResponse);
    assert.equal(calendar?.events?.length, 2);
    assert.deepEqual(
      calendar?.events?.map((event) => event.uid),
      ["report-1@example.com", "report-2@example.com"],
    );
    assert.equal(calendar?.events?.[1]?.summary, "Report two & more");
  });

  run("returns null for PROPFIND responses without calendar-data", () => {
    const propfindResponse = [
      "<?xml version='1.0' encoding='utf-8'?>",
      '<multistatus xmlns="DAV:">',
      "  <response>",
      "    <href>/calendar/</href>",
      "    <propstat>",
      "      <prop>",
      "        <displayname>Test Calendar</displayname>",
      "      </prop>",
      "    </propstat>",
      "  </response>",
      "</multistatus>",
    ].join("\n");

    assert.equal(parseCalendarResponse(propfindResponse), null);
  });

  run("parses a single event response for sync verification", () => {
    const event = parseCalendarEventResponse([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:verify-1@example.com",
      "DTSTART;VALUE=DATE:20260407",
      "DTEND;VALUE=DATE:20260408",
      "SUMMARY:Verification",
      "URL:https://example.com/meeting",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n"));

    assert.equal(event?.uid, "verify-1@example.com");
    assert.equal(event?.url, "https://example.com/meeting");
  });

  console.log("All tests passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
