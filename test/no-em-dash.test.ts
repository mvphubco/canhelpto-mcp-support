import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const EM = String.fromCharCode(0x2014);
const FORMS = [EM, "&mdash;", "&#8212;", "\\u2014"];
const SELF = join("test", "no-em-dash.test.ts");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|md|json)$/.test(name) ? [p] : [];
  });
}

function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .split("\n")
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/[^\n]*$/, "$1"))
    .join("\n");
}

test("no em dash in what the library writes into a ticket or shows a vendor (outside comments)", () => {
  const hits: string[] = [];
  for (const f of [...files("src"), ...files("test"), "README.md", "package.json"]) {
    if (f === SELF) continue;
    withoutComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
      if (FORMS.some((form) => line.includes(form))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(hits, []);
});
