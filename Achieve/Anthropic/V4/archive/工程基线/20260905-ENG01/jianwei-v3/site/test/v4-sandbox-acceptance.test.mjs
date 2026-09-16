import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJsonUrl = new URL("../package.json", import.meta.url);

test("canonical Node test entry disables child-process isolation", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));
  const command = packageJson.scripts?.test;

  assert.equal(typeof command, "string");
  assert.match(command, /(?:^|\s)node(?:\.exe)?(?=\s)/i);
  assert.match(command, /(?:^|\s)--test(?=\s|=|$)/i);
  assert.match(
    command,
    /(?:^|\s)--(?:experimental-)?test-isolation(?:=|\s+)none(?=\s|$)/i,
  );
  assert.doesNotMatch(
    command,
    /(?:^|\s)(?:npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?)\s+(?:run\s+)?test/i,
  );
});
