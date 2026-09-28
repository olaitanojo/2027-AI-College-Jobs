import { describe, expect, test } from "bun:test";
import { generateMarkdownTable, updateTable } from "./get-jobs";
import type { Job } from "./types/job.schema";

const marker = {
  start: "<!-- TABLE_START -->",
  end: "<!-- TABLE_END -->",
};

const job: Job = {
  company_name: "A & B | <Company>",
  company_url: "https://example.com/jobs?team=ai&level=entry",
  job_title: "ML Engineer\nIntern | 2027",
  job_locations: "Remote | USA",
  job_url: "https://example.com/apply?role=ml&source=table",
  age: 2,
};

describe("generateMarkdownTable", () => {
  test("escapes job fields while preserving valid HTTPS links", () => {
    const previousApplyImageUrl = process.env.APPLY_IMG_URL;
    process.env.APPLY_IMG_URL = "https://example.com/apply.png?size=70&theme=dark";

    try {
      const table = generateMarkdownTable([job]);

      expect(table).toContain("A &amp; B \\| &lt;Company&gt;");
      expect(table).toContain("ML Engineer Intern \\| 2027");
      expect(table).toContain("Remote \\| USA");
      expect(table).toContain(
        'href="https://example.com/apply?role=ml&amp;source=table"'
      );
    } finally {
      process.env.APPLY_IMG_URL = previousApplyImageUrl;
    }
  });

  test("rejects unsafe job URLs", () => {
    process.env.APPLY_IMG_URL = "https://example.com/apply.png";

    expect(() =>
      generateMarkdownTable([{ ...job, job_url: "javascript:alert(1)" }])
    ).toThrow("job URL must use the http or https protocol.");
  });
});

describe("updateTable", () => {
  test("replaces only the content between a valid marker pair", () => {
    const content = `before\n${marker.start}\nold\n${marker.end}\nafter`;

    expect(updateTable(content, marker, "new")).toBe(
      `before\n${marker.start}\nnew\n${marker.end}\nafter`
    );
  });

  test("rejects missing, duplicated, and reversed markers", () => {
    expect(() => updateTable("content", marker, "new")).toThrow(
      "Missing start marker"
    );
    expect(() =>
      updateTable(
        `${marker.start}\n${marker.start}\n${marker.end}`,
        marker,
        "new"
      )
    ).toThrow("Duplicate start marker");
    expect(() =>
      updateTable(`${marker.end}\n${marker.start}`, marker, "new")
    ).toThrow("Table end marker must appear after its start marker.");
  });
});
