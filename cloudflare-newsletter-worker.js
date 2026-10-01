const ALLOWED_ORIGINS = new Set([
  "https://furyengi.cv",
  "https://www.furyengi.cv",
  "https://blog.furyengi.cv",
  "https://furyengi.is-a.dev",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://furyengi.cv";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(payload, init = {}, origin = "") {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...(init.headers || {}),
    },
  });
}

async function parsePayload(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, { status: 405 }, origin);
    }

    if (!env.SUBSCRIBERS) {
      return json({ ok: false, error: "Subscriber store is not configured" }, { status: 500 }, origin);
    }

    const payload = await parsePayload(request).catch(() => null);
    const email = String(payload?.email || "").trim().toLowerCase();
    const source = String(payload?.source || "").slice(0, 500);

    if (!EMAIL_RE.test(email)) {
      return json({ ok: false, error: "Enter a valid email address" }, { status: 400 }, origin);
    }

    const key = `subscriber:${email}`;
    const existing = await env.SUBSCRIBERS.get(key, "json");
    const now = new Date().toISOString();

    if (existing) {
      await env.SUBSCRIBERS.put(
        key,
        JSON.stringify({
          ...existing,
          email,
          lastSeenAt: now,
          lastSource: source || existing.lastSource || "",
        }),
      );

      return json({ ok: true, alreadySubscribed: true }, { status: 200 }, origin);
    }

    await env.SUBSCRIBERS.put(
      key,
      JSON.stringify({
        email,
        subscribedAt: now,
        source,
        status: "subscribed",
      }),
    );

    return json({ ok: true, alreadySubscribed: false }, { status: 201 }, origin);
  },
};
