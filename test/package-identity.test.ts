import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-10-13: the npm name "canhelpto" belongs to an unrecoverable user account, so the
// package lives in the org "canhelpto-com"; hello@canhelpto.com never existed as a mailbox.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const readme = readFileSync("README.md", "utf8");

test("the package is published under the canhelpto-com org", () => {
  assert.equal(pkg.name, "@canhelpto-com/mcp-support");
  assert.match(readme, /npm install @canhelpto-com\/mcp-support/);
  assert.match(readme, /from "@canhelpto-com\/mcp-support"/);
  assert.doesNotMatch(readme, /@canhelpto\/mcp-support|github:mvphubco/);
});

test("the author contact is the real canhelpto mailbox", () => {
  assert.match(pkg.author, /<canhelpto@canhelpto\.com>/);
});

test("every canhelpto link the package carries is tagged for attribution", () => {
  assert.match(pkg.homepage, /utm_source=npm/);
  for (const url of readme.match(/https:\/\/canhelpto\.com\/\?[^\s)]*/g) ?? []) assert.match(url, /utm_source=/);
});
