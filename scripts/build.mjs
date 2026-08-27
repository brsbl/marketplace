#!/usr/bin/env node
// Compose entries/*.json + marketplace.base.json into two manifests:
//
//   dist/marketplace.json      marketplace/v1 — the frozen contract
//   dist/v2/marketplace.json   marketplace/v2 — the discovery catalog
//
// One entry file feeds both. An entry is the v2 shape, and v1 is a projection
// of it that keeps exactly the seven fields v1 has always had. That direction
// matters: released clients parse v1 strictly and reject any manifest carrying
// a field they do not know, so a listing that gains `category` here must not
// gain it there. The v1 schema is additionalProperties:false, so a leak fails
// this build rather than shipping.
//
// Exits non-zero on any problem so CI can gate PRs. `--liveness` additionally
// checks that each git source ref exists and each npm package is published.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/** Exactly the fields marketplace/v1 has ever carried. Never add to this. */
const V1_ENTRY_FIELDS = new Set([
  "id",
  "displayName",
  "description",
  "icon",
  "tags",
  "author",
  "source",
]);

/**
 * Publication dates come from this repository's own history: an entry file's
 * first commit is when that listing went live, its latest commit is when it
 * last changed. Nothing here is author-supplied, so no one can backdate a
 * listing onto the front of the "Recently added" shelf.
 *
 * A shallow clone would answer every query with the same one commit, which
 * looks like a working build and publishes 82 identical timestamps. Refuse
 * instead — the publish workflow checks out with fetch-depth: 0.
 */
function gitDates(root, file) {
  const log = (args) =>
    execFileSync("git", ["-C", root, "log", "--format=%aI", ...args], {
      encoding: "utf8",
      timeout: 30_000,
    })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  const path = join("entries", file);
  const added = log(["--diff-filter=A", "--follow", "--", path]);
  const latest = log(["-1", "--", path]);
  // A file that exists but has no commit yet is a local edit, not a listing.
  // Dates are optional in v2, so omit them rather than invent one.
  if (added.length === 0 || latest.length === 0) return {};
  return { publishedAt: added.at(-1), updatedAt: latest[0] };
}

function assertFullHistory(root) {
  const shallow = execFileSync(
    "git",
    ["-C", root, "rev-parse", "--is-shallow-repository"],
    { encoding: "utf8", timeout: 30_000 },
  ).trim();
  if (shallow === "true") {
    console.error(
      "error: shallow clone — publication dates would all collapse to one commit. Check out with fetch-depth: 0.",
    );
    process.exit(1);
  }
}

const root = new URL("..", import.meta.url).pathname;
const liveness = process.argv.includes("--liveness");
const problems = [];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const base = readJson(join(root, "marketplace.base.json"));
assertFullHistory(root);

const entryFiles = readdirSync(join(root, "entries"))
  .filter((name) => name.endsWith(".json"))
  .sort();
if (entryFiles.length === 0) problems.push("entries/ contains no entry files");

const seen = new Set();
const plugins = [];
for (const file of entryFiles) {
  const path = join(root, "entries", file);
  let entry;
  try {
    entry = readJson(path);
  } catch (error) {
    problems.push(`${file}: invalid JSON (${error.message})`);
    continue;
  }
  const expectedId = file.replace(/\.json$/, "");
  if (entry.id !== expectedId) {
    problems.push(`${file}: id "${entry.id}" must equal the filename "${expectedId}"`);
  }
  if (seen.has(entry.id)) problems.push(`${file}: duplicate id "${entry.id}"`);
  seen.add(entry.id);
  if (typeof entry.icon === "object" && entry.icon?.url?.startsWith("./")) {
    try {
      readFileSync(join(root, entry.icon.url));
    } catch {
      problems.push(`${file}: relative icon "${entry.icon.url}" does not exist`);
    }
  }
  plugins.push(entry);
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const v1Schema = readJson(join(root, "schema", "marketplace.schema.json"));
const v2Schema = readJson(join(root, "schema", "marketplace-v2.schema.json"));

// Report a bad entry against its own file before it disappears into an array
// index in a manifest-level error.
const validateEntry = ajv.compile({ ...v2Schema.$defs.entry, $defs: v2Schema.$defs });
for (const entry of plugins) {
  if (validateEntry(entry)) continue;
  for (const error of validateEntry.errors ?? []) {
    problems.push(`${entry.id}.json: ${error.instancePath || "/"} ${error.message}`);
  }
}

const { newAndNotable: curatedNotable, ...v1Base } = base;
for (const entryId of curatedNotable ?? []) {
  if (!seen.has(entryId)) {
    problems.push(`marketplace.base.json: newAndNotable names unknown entry "${entryId}"`);
  }
}

const manifest = {
  $schema: "https://getbb.app/schemas/marketplace.schema.json",
  ...v1Base,
  plugins: plugins.map((entry) =>
    Object.fromEntries(
      Object.entries(entry).filter(([field]) => V1_ENTRY_FIELDS.has(field)),
    ),
  ),
};

const v2Plugins = plugins.map((entry) => ({
  ...entry,
  ...gitDates(root, `${entry.id}.json`),
}));

/**
 * The shelf bb renders as "New & notable", most notable first. Curate it by
 * setting `newAndNotable` in marketplace.base.json; a curated list is used
 * verbatim. Left unset it falls back to the newest listings, so the shelf
 * stays populated and current on its own rather than decaying into whichever
 * plugins someone hand-picked once.
 */
const NEW_AND_NOTABLE_FALLBACK_SIZE = 6;
const newAndNotable =
  curatedNotable ??
  v2Plugins
    .filter((entry) => entry.publishedAt !== undefined)
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, NEW_AND_NOTABLE_FALLBACK_SIZE)
    .map((entry) => entry.id);

const v2Manifest = {
  $schema: "https://getbb.app/schemas/marketplace-v2.schema.json",
  ...v1Base,
  schemaVersion: 2,
  newAndNotable,
  plugins: v2Plugins,
};

const validate = ajv.compile(v1Schema);
if (!validate(manifest)) {
  for (const error of validate.errors ?? []) {
    problems.push(`schema v1: ${error.instancePath || "/"} ${error.message}`);
  }
}
const validateV2 = ajv.compile(v2Schema);
if (!validateV2(v2Manifest)) {
  for (const error of validateV2.errors ?? []) {
    problems.push(`schema v2: ${error.instancePath || "/"} ${error.message}`);
  }
}

if (liveness) {
  for (const entry of plugins) {
    const source = entry.source ?? {};
    try {
      if (source.git) {
        const { url, ref, range, tagPrefix } = source.git;
        if (range !== undefined) {
          const prefix = tagPrefix ?? "";
          const out = execFileSync(
            "git",
            ["ls-remote", "--tags", url, `refs/tags/${prefix}v*`],
            { encoding: "utf8", timeout: 30_000 },
          );
          const tagPattern = new RegExp(
            `refs/tags/${prefix.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(v\\d+\\.\\d+\\.\\d+)(\\^\\{\\})?$`,
          );
          const hasTag = out
            .split("\n")
            .some((line) => tagPattern.test(line.trim()));
          if (!hasTag) {
            problems.push(
              `${entry.id}: no ${prefix}vX.Y.Z tags found at ${url} for range "${range}"`,
            );
          }
        } else {
          const out = execFileSync("git", ["ls-remote", url, ref, `${ref}^{}`], {
            encoding: "utf8",
            timeout: 30_000,
          });
          const isCommit = /^[0-9a-f]{7,40}$/i.test(ref);
          if (!isCommit && out.trim().length === 0) {
            problems.push(`${entry.id}: git ref "${ref}" not found at ${url}`);
          }
          if (isCommit) {
            // ls-remote cannot list arbitrary commits; verify the repo answers at all.
            execFileSync("git", ["ls-remote", url, "HEAD"], { encoding: "utf8", timeout: 30_000 });
          }
        }
      } else if (source.npm) {
        execFileSync("npm", ["view", source.npm.package, "name"], {
          encoding: "utf8",
          timeout: 30_000,
        });
      }
    } catch (error) {
      problems.push(`${entry.id}: liveness check failed (${error.message.split("\n")[0]})`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`);
  process.exit(1);
}

const bytes = JSON.stringify(manifest, null, 2) + "\n";
const v2Bytes = JSON.stringify(v2Manifest, null, 2) + "\n";
for (const [label, payload] of [
  ["marketplace.json", bytes],
  ["v2/marketplace.json", v2Bytes],
]) {
  if (Buffer.byteLength(payload, "utf8") > 1_048_576) {
    console.error(`error: composed ${label} exceeds 1 MiB`);
    process.exit(1);
  }
}
mkdirSync(join(root, "dist", "v2"), { recursive: true });
writeFileSync(join(root, "dist", "marketplace.json"), bytes);
writeFileSync(join(root, "dist", "v2", "marketplace.json"), v2Bytes);
const dated = v2Manifest.plugins.filter((entry) => entry.publishedAt !== undefined).length;
console.log(`built dist/marketplace.json with ${plugins.length} entries`);
console.log(
  `built dist/v2/marketplace.json with ${plugins.length} entries (${dated} dated, ${newAndNotable.length} new & notable)`,
);
