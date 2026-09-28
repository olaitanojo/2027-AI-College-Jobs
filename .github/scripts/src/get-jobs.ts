import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as core from "@actions/core";
import type { Job } from "./types/job.schema";
import type { JobCounts } from "./types/job-counts.schema";
import { HEADERS, MARKERS, TABLES } from "./config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function escapeTableCell(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

function getSafeHttpUrl(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} must be set.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use the http or https protocol.`);
  }

  return escapeTableCell(url.toString());
}

export function generateMarkdownTable(
  jobs: Job[],
  salary?: boolean,
  interval: string = "yr"
) {
  const headers = salary
    ? [...HEADERS.slice(0, 3), "Salary", ...HEADERS.slice(3)]
    : HEADERS;

  let table = `| ${headers.join(" | ")} |\n`;
  table += `|${headers.map(() => "---").join("|")}|\n`;

  jobs.forEach((job) => {
    const applyCell = `<a href="${getSafeHttpUrl(
      job.job_url,
      "job URL"
    )}"><img src="${getSafeHttpUrl(
      process.env.APPLY_IMG_URL,
      "APPLY_IMG_URL"
    )}" alt="Apply" width="70"/></a>`;

    const companyCell = job.company_url
      ? `<a href="${getSafeHttpUrl(job.company_url, "company URL")}"><strong>${
          escapeTableCell(job.company_name)
        }</strong></a>`
      : `<strong>${escapeTableCell(job.company_name)}</strong>`;

    const row = [
      companyCell,
      escapeTableCell(job.job_title),
      escapeTableCell(job.job_locations ?? ""),
      applyCell,
      `${job.age}d`,
    ];

    if (salary && job.salary) {
      const salary =
        job.salary >= 1000
          ? `${(job.salary / 1000).toFixed(0)}k`
          : job.salary.toString();

      const salaryCell = `$${salary}/${interval}`;
      row.splice(3, 0, salaryCell);
    } else if (salary && !job.salary) {
      const salaryCell = "";
      row.splice(3, 0, salaryCell);
    }

    table += `| ${row.join(" | ")} |\n`;
  });

  return table;
}

function getSingleMarkerIndex(
  readmeContent: string,
  marker: string,
  markerName: string
): number {
  const firstIndex = readmeContent.indexOf(marker);
  const lastIndex = readmeContent.lastIndexOf(marker);

  if (firstIndex === -1) {
    throw new Error(`Missing ${markerName} marker: ${marker}`);
  }

  if (firstIndex !== lastIndex) {
    throw new Error(`Duplicate ${markerName} marker: ${marker}`);
  }

  return firstIndex;
}

export function updateTable(
  readmeContent: string,
  marker: { start: string; end: string },
  tableContent: string
): string {
  const { start, end } = marker;
  const startIndex = getSingleMarkerIndex(readmeContent, start, "start");
  const endIndex = getSingleMarkerIndex(readmeContent, end, "end");

  if (endIndex <= startIndex + start.length) {
    throw new Error(`Table end marker must appear after its start marker.`);
  }

  const before = readmeContent.slice(0, startIndex + start.length);
  const after = readmeContent.slice(endIndex);
  return `${before}\n${tableContent}\n${after}`;
}

function updateReadme(
  tables: { [K in keyof typeof MARKERS]: string },
  filePath: string
) {
  const readmePath = path.join(__dirname, filePath);
  let readmeContent = fs.readFileSync(readmePath, "utf8");

  readmeContent = updateTable(readmeContent, MARKERS.faang, tables.faang);
  readmeContent = updateTable(readmeContent, MARKERS.quant, tables.quant);
  readmeContent = updateTable(readmeContent, MARKERS.other, tables.other);

  fs.writeFileSync(readmePath, readmeContent, "utf8");
}

function updateCounts(filePath: string, jobCounts: JobCounts) {
  const readmePath = path.join(__dirname, filePath);
  let readmeContent = fs.readFileSync(readmePath, { encoding: "utf8" });

  readmeContent = readmeContent.replace(
    /(\[Internships :books:\]\(\/\))(\s+-\s+\*\*\d+\*\*\s+available)/,
    `$1 - **${jobCounts.intern_usa_count}** available`
  );
  readmeContent = readmeContent.replace(
    /(\[New Graduate :mortar_board:\]\(\/NEW_GRAD_USA\.md\))(\s+-\s+\*\*\d+\*\* available)?/,
    `$1 - **${jobCounts.new_grad_usa_count}** available`
  );
  readmeContent = readmeContent.replace(
    /(\[Internships :books:\]\(\/INTERN_INTL\.md\))(\s+-\s+\*\*\d+\*\*)?/,
    `$1 - **${jobCounts.intern_intl_count}**`
  );
  readmeContent = readmeContent.replace(
    /(\[New Graduate :mortar_board:\]\(\/NEW_GRAD_INTL\.md\))(\s+-\s+\*\*\d+\*\* available)?/,
    `$1 - **${jobCounts.new_grad_intl_count}** available`
  );

  fs.writeFileSync(readmePath, readmeContent, { encoding: "utf8" });
}

function updateTotalCount(jobCounts: JobCounts) {
  const readmePath = path.join(__dirname, "../../../README.md");
  let readmeContent = fs.readFileSync(readmePath, { encoding: "utf8" });

  const totalJobs =
    jobCounts.intern_usa_count +
    jobCounts.new_grad_usa_count +
    jobCounts.intern_intl_count +
    jobCounts.new_grad_intl_count;

  readmeContent = readmeContent.replace(
    /(<img src="https:\/\/img\.shields\.io\/badge\/)(\d+)(%20Jobs-6366F1">)/,
    `$1${totalJobs}$3`
  );

  fs.writeFileSync(readmePath, readmeContent, { encoding: "utf8" });
}

async function main() {
  try {
    const { fetchJobCounts, fetchJobs } = await import("./queries");
    const jobCounts = await fetchJobCounts();

    for (const table of TABLES) {
      const faangJobs = await fetchJobs({
        ...table.query,
        company_type: "faang",
      });
      const quantJobs = await fetchJobs({
        ...table.query,
        company_type: "financial",
      });
      const jobs = await fetchJobs({
        ...table.query,
        company_type: "other",
      });

      const tables = {
        faang: generateMarkdownTable(faangJobs, table.salary, table.interval),
        quant: generateMarkdownTable(quantJobs, table.salary, table.interval),
        other: generateMarkdownTable(jobs),
      };

      updateReadme(tables, table.path);
      updateCounts(table.path, jobCounts);
    }

    updateTotalCount(jobCounts);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unknown error occurred");
    }
  }
}

if (import.meta.main) {
  main();
}
