const required = [
  "OURA_ACCESS_TOKEN",
  "OURA_REFRESH_TOKEN",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
];
const missing = required.filter((name) => !process.env[name]);

if (process.env.OURA_LIVE_TESTS !== "1" || missing.length > 0) {
  console.error("Live tests are opt-in and require a dedicated Oura OAuth token set.");
  console.error(`Set OURA_LIVE_TESTS=1 and ${required.join(", ")}.`);
  process.exit(1);
}
