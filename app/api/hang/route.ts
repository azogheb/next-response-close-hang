// A plain route handler: nothing here is unusual. The hang is in how Next writes the response.
// `?delay=<ms>` waits before answering and `?size=<bytes>` pads the body, so a client reset can
// land while the response is still being written.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const delay = Number(params.get("delay") ?? 0);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  return Response.json({ ok: true, pad: "x".repeat(Number(params.get("size") ?? 0)) });
}
