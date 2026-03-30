import { existsSync, readFileSync, statSync } from "node:fs";

function fail(message) {
  throw new Error(message);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

if (packageJson.version !== manifest.version) {
  fail(
    `package.json version (${packageJson.version}) does not match manifest.json version (${manifest.version}).`,
  );
}

if (versions[manifest.version] !== manifest.minAppVersion) {
  fail(`versions.json must contain ${manifest.version}: ${manifest.minAppVersion}.`);
}

if (!existsSync("main.js")) {
  fail("main.js was not produced by the build.");
}

if (statSync("main.js").size === 0) {
  fail("main.js is empty.");
}

const releaseTag = process.env.RELEASE_TAG;
if (releaseTag && releaseTag !== `v${manifest.version}`) {
  fail(`Release tag ${releaseTag} does not match manifest version v${manifest.version}.`);
}

console.log(`Release validation passed for ${manifest.id}@${manifest.version}.`);
