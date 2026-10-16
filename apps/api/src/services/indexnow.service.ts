/**
 * Tells Bing (and the other IndexNow engines) that the LiteHubs public pages
 * exist or changed. Sent a few minutes after each production start so the new
 * web release is live when the crawler arrives. The key is public: the web app
 * serves it at https://litehubs.com/2feb79627b652d325fd354d864e0fffd.txt to prove ownership.
 */
import { logger } from "../config/logger";

const KEY = "2feb79627b652d325fd354d864e0fffd";
const HOST = "litehubs.com";
const PATHS = [
  "/",
  "/logiciel/gestion-avicole",
  "/logiciel/elevage-porcin",
  "/logiciel/gestion-agricole",
  "/logiciel/equipes-rh",
  "/contact",
  "/rendezvous",
];

export function scheduleIndexNowPing(delayMs = 5 * 60_000) {
  const timer = setTimeout(() => {
    void fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST,
        key: KEY,
        keyLocation: `https://${HOST}/${KEY}.txt`,
        urlList: PATHS.map((path) => `https://${HOST}${path}`),
      }),
      signal: AbortSignal.timeout(15_000),
    })
      .then((response) => logger.info({ status: response.status }, "IndexNow ping sent"))
      .catch((error) => logger.warn({ err: error }, "IndexNow ping failed"));
  }, delayMs);
  timer.unref();
}
