#!/usr/bin/env node
/**
 * Gate live tests: require real Oura OAuth app credentials.
 *
 * Usage: OURA_CLIENT_ID=... OURA_CLIENT_SECRET=... npm run test:live
 */
const needed = ["OURA_CLIENT_ID", "OURA_CLIENT_SECRET"];
const missing = needed.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `Live tests skipped: missing ${missing.join(", ")}.\n` +
      "Register an Oura app at https://cloud.ouraring.com/oauth/applications\n" +
      "(redirect URI http://localhost:9876/callback) and set these env vars.",
  );
  process.exit(1);
}
console.log("Live-test credentials present — running live tests.");
