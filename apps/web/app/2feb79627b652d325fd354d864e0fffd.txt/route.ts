/**
 * IndexNow ownership file (Bing, Yandex, Seznam, Naver). The key is public by
 * design: it only proves that whoever pings IndexNow for litehubs.com controls
 * this host. The API sends the ping after each deployment.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response("2feb79627b652d325fd354d864e0fffd", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
