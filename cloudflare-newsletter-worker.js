// furyengi newsletter worker (Cloudflare Workers + KV + Resend)
//
//   POST /api/newsletter              subscribe: stores a pending record and emails a confirmation link
//   GET/POST /api/newsletter/confirm       confirm page (GET) / confirm the subscription (POST)
//   GET/POST /api/newsletter/unsubscribe   unsubscribe page (GET) / unsubscribe (POST, also RFC 8058 one-click)
//   POST /api/newsletter/broadcast    (Bearer BROADCAST_TOKEN) email a published post to confirmed subscribers
//
// Bindings: SUBSCRIBERS (KV). Secrets: RESEND_API_KEY, TOKEN_SECRET, BROADCAST_TOKEN.
// Vars: FROM_ADDRESS, REPLY_TO, PUBLIC_ORIGIN. See _blog/NEWSLETTER.md.

const ALLOWED_ORIGINS = new Set([
  "https://furyengi.cv",
  "https://www.furyengi.cv",
  "https://blog.furyengi.cv",
  "https://furyengi.is-a.dev",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE = "/api/newsletter";
const SUBSCRIBER_PREFIX = "subscriber:";
const CONFIRM_COOLDOWN_MS = 60 * 60 * 1000; // don't re-send a confirmation more than once an hour
const RATE_LIMIT_MAX = 5; // subscribe attempts per IP per window
const RATE_LIMIT_WINDOW_SECONDS = 3600;
const BATCH_SIZE = 100; // Resend batch limit
const DEFAULT_BATCH_DELAY_MS = 600; // Resend allows ~2 requests/second
const DEFAULT_FROM = "Furyengi Blog <blog@furyengi.cv>";
const DEFAULT_ORIGIN = "https://furyengi.cv";
const POST_URL_PREFIX = "https://blog.furyengi.cv/";
const IMAGE_URL_PREFIXES = ["https://furyengi.cv/", "https://blog.furyengi.cv/"];

const encoder = new TextEncoder();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ── HTTP helpers ─────────────────────────────────────────────

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

function page(title, message, { button, action, status = 200 } = {}) {
  const form = button
    ? `<form method="POST" action="${esc(action)}"><button type="submit">${esc(button)}</button></form>`
    : "";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light"><title>${esc(title)} — Furyengi Blog</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#1d1d1b;font:16px/1.6 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:460px;padding:32px 24px;text-align:center}h1{font:600 2rem/1.15 Georgia,serif;letter-spacing:-.02em;margin:0 0 12px}
p{color:#6b6b66;margin:0 0 24px}button{border:0;border-radius:999px;background:#1d1d1b;color:#fff;font-family:inherit;font-size:1rem;font-weight:600;line-height:1;padding:14px 28px;cursor:pointer}
a{color:#0b6b38}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(message)}</p>${form}
<p style="margin:24px 0 0"><a href="https://blog.furyengi.cv/">Back to the blog</a></p></main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex",
      },
    },
  );
}

async function parsePayload(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

// ── tokens (stateless HMAC, one purpose per link type) ───────

const toB64Url = (buffer) => {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64Url = (value) => {
  try {
    return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

const hmacKey = (env) =>
  crypto.subtle.importKey("raw", encoder.encode(env.TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function makeToken(env, purpose, email) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(`${purpose}:${email}`));
  return toB64Url(signature);
}

async function checkToken(env, purpose, email, token) {
  const signature = fromB64Url(String(token || ""));
  if (!signature) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(env), signature, encoder.encode(`${purpose}:${email}`));
}

async function safeEqual(a, b) {
  const [x, y] = await Promise.all([a, b].map((v) => crypto.subtle.digest("SHA-256", encoder.encode(String(v)))));
  const xs = new Uint8Array(x);
  const ys = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xs.length; i += 1) diff |= xs[i] ^ ys[i];
  return diff === 0;
}

async function linkFor(env, purpose, email) {
  const origin = env.PUBLIC_ORIGIN || DEFAULT_ORIGIN;
  const token = await makeToken(env, purpose, email);
  return `${origin}${BASE}/${purpose}?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

// ── KV records ───────────────────────────────────────────────
// status: "pending" (awaiting confirmation) | "subscribed" | "unsubscribed".
// Records created before double opt-in already say "subscribed" and stay active.

const subscriberKey = (email) => `${SUBSCRIBER_PREFIX}${email}`;
const getSubscriber = (env, email) => env.SUBSCRIBERS.get(subscriberKey(email), "json");
const putSubscriber = (env, email, record) =>
  env.SUBSCRIBERS.put(subscriberKey(email), JSON.stringify(record), { metadata: { status: record.status } });

async function activeSubscribers(env) {
  const emails = [];
  let cursor;
  do {
    const result = await env.SUBSCRIBERS.list({ prefix: SUBSCRIBER_PREFIX, cursor });
    for (const entry of result.keys) {
      let status = entry.metadata?.status;
      if (!status) status = (await env.SUBSCRIBERS.get(entry.name, "json"))?.status; // legacy records have no metadata
      if (status === "subscribed") emails.push(entry.name.slice(SUBSCRIBER_PREFIX.length));
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return emails;
}

// ── email (Resend) ───────────────────────────────────────────

async function resend(env, path, body) {
  const response = await fetch(`https://api.resend.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json().catch(() => ({}));
}

const envelope = (env, to, content) => ({
  from: env.FROM_ADDRESS || DEFAULT_FROM,
  to: [to],
  reply_to: env.REPLY_TO || undefined,
  ...content,
});

function confirmationMessage(env, email, confirmUrl) {
  return envelope(env, email, {
    subject: "Confirm your subscription to Furyengi Blog",
    text: `Hi,\n\nSomeone (hopefully you) asked to get new posts from furyengi.cv by email.\n\nConfirm here: ${confirmUrl}\n\nIf that wasn't you, ignore this email and nothing will happen.\n`,
    html: `<div style="max-width:520px;margin:0 auto;padding:24px;font:16px/1.6 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1d1b">
<h1 style="font:600 24px/1.2 Georgia,serif;margin:0 0 12px">Confirm your subscription</h1>
<p style="color:#555">Someone (hopefully you) asked to get new posts from furyengi.cv by email. Tap the button to confirm.</p>
<p><a href="${esc(confirmUrl)}" style="display:inline-block;background:#1d1d1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Confirm subscription</a></p>
<p style="font-size:13px;color:#8a8a84">If that wasn't you, ignore this email and nothing will happen.</p></div>`,
  });
}

function postMessage(env, post, email, unsubscribeUrl, { test }) {
  const url = esc(post.url);
  const image = post.image
    ? `<a href="${url}"><img src="${esc(post.image)}" alt="" width="560" style="display:block;width:100%;height:auto"></a>`
    : "";
  const description = post.description
    ? `<p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#555">${esc(post.description)}</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f1;padding:24px 12px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1d1b">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e2dc;border-radius:16px;overflow:hidden">${image}
<div style="padding:28px 28px 8px"><p style="margin:0 0 10px;font:600 12px monospace;letter-spacing:.12em;text-transform:uppercase;color:#14934e">New on furyengi.blog</p>
<h1 style="margin:0 0 12px;font:600 26px/1.2 Georgia,serif"><a href="${url}" style="color:inherit;text-decoration:none">${esc(post.title)}</a></h1>${description}
<a href="${url}" style="display:inline-block;background:#1d1d1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:15px">Read the post →</a></div>
<p style="margin:0;padding:24px 28px 28px;font-size:12px;line-height:1.6;color:#8a8a84">You’re getting this because you subscribed at furyengi.cv. <a href="${esc(unsubscribeUrl)}" style="color:#8a8a84">Unsubscribe</a></p></div></body></html>`;
  const text = `${post.title}\n\n${post.description ? `${post.description}\n\n` : ""}Read it: ${post.url}\n\n--\nYou're getting this because you subscribed at furyengi.cv.\nUnsubscribe: ${unsubscribeUrl}\n`;
  return envelope(env, email, {
    subject: test ? `[TEST] ${post.title}` : post.title,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}

// ── handlers ─────────────────────────────────────────────────

async function rateLimited(request, env) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return false;
  const key = `rl:${ip}`;
  const count = Number(await env.SUBSCRIBERS.get(key)) || 0;
  if (count >= RATE_LIMIT_MAX) return true;
  await env.SUBSCRIBERS.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return false;
}

async function handleSubscribe(request, env, origin) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 }, origin);
  if (!env.SUBSCRIBERS) return json({ ok: false, error: "Subscriber store is not configured" }, { status: 500 }, origin);
  if (!env.RESEND_API_KEY || !env.TOKEN_SECRET) {
    return json({ ok: false, error: "Email sending is not configured" }, { status: 500 }, origin);
  }

  const payload = await parsePayload(request).catch(() => null);
  const email = String(payload?.email || "").trim().toLowerCase();
  const source = String(payload?.source || "").slice(0, 500);
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ ok: false, error: "Enter a valid email address" }, { status: 400 }, origin);
  }
  if (await rateLimited(request, env)) {
    return json({ ok: false, error: "Too many attempts. Try again in a bit." }, { status: 429 }, origin);
  }

  const now = new Date().toISOString();
  const existing = await getSubscriber(env, email);

  if (existing?.status === "subscribed") {
    await putSubscriber(env, email, { ...existing, email, lastSeenAt: now, lastSource: source || existing.lastSource || "" });
    return json({ ok: true, alreadySubscribed: true }, { status: 200 }, origin);
  }

  if (existing?.status === "pending" && existing.confirmationSentAt && Date.now() - Date.parse(existing.confirmationSentAt) < CONFIRM_COOLDOWN_MS) {
    return json({ ok: true, pending: true }, { status: 202 }, origin);
  }

  const record = {
    ...existing,
    email,
    status: "pending",
    subscribedAt: existing?.subscribedAt || now,
    requestedAt: now,
    source: existing?.source || source,
  };
  await putSubscriber(env, email, record);

  try {
    await resend(env, "/emails", confirmationMessage(env, email, await linkFor(env, "confirm", email)));
  } catch (error) {
    console.error("confirmation email failed", error.message);
    return json({ ok: false, error: "Couldn't send the confirmation email" }, { status: 502 }, origin);
  }

  await putSubscriber(env, email, { ...record, confirmationSentAt: new Date().toISOString() });
  return json({ ok: true, pending: true }, { status: 202 }, origin);
}

async function readLink(request, env, purpose) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  const valid = EMAIL_RE.test(email) && (await checkToken(env, purpose, email, url.searchParams.get("token")));
  return { email, valid, action: `${url.pathname}${url.search}` };
}

async function handleConfirm(request, env) {
  if (!env.SUBSCRIBERS || !env.TOKEN_SECRET) return page("Not available", "This isn't set up yet.", { status: 500 });
  const { email, valid, action } = await readLink(request, env, "confirm");
  if (!valid) return page("Link not valid", "This confirmation link is invalid or incomplete.", { status: 400 });

  if (request.method === "GET") {
    return page("Confirm your subscription", `Get new posts from furyengi.blog at ${email}.`, { button: "Confirm subscription", action });
  }
  if (request.method !== "POST") return page("Not allowed", "Method not allowed.", { status: 405 });

  const existing = await getSubscriber(env, email);
  if (!existing) return page("Link expired", "Please subscribe again from the site.", { status: 404 });
  const now = new Date().toISOString();
  await putSubscriber(env, email, { ...existing, status: "subscribed", confirmedAt: existing.confirmedAt || now, lastSeenAt: now });
  return page("You’re subscribed", "Thanks! I’ll only email when there’s a new post worth reading.");
}

async function handleUnsubscribe(request, env) {
  if (!env.SUBSCRIBERS || !env.TOKEN_SECRET) return page("Not available", "This isn't set up yet.", { status: 500 });
  const { email, valid, action } = await readLink(request, env, "unsubscribe");
  if (!valid) return page("Link not valid", "This unsubscribe link is invalid or incomplete.", { status: 400 });

  if (request.method === "GET") {
    return page("Unsubscribe", `Stop emails from furyengi.blog to ${email}?`, { button: "Unsubscribe", action });
  }
  if (request.method !== "POST") return page("Not allowed", "Method not allowed.", { status: 405 });

  const existing = await getSubscriber(env, email);
  if (existing && existing.status !== "unsubscribed") {
    await putSubscriber(env, email, { ...existing, status: "unsubscribed", unsubscribedAt: new Date().toISOString() });
  }
  return page("You’re unsubscribed", "You won’t get any more emails from me. Sorry to see you go.");
}

function validatePost(body) {
  const title = String(body?.title || "").trim();
  const url = String(body?.url || "").trim();
  const description = String(body?.description || "").trim();
  const image = String(body?.image || "").trim();
  const slug = String(body?.slug || "").trim();
  if (!/^[a-z0-9-]+$/.test(slug)) return { error: "Invalid slug" };
  if (!title || title.length > 200) return { error: "Title is required (max 200 characters)" };
  if (!url.startsWith(POST_URL_PREFIX)) return { error: `url must start with ${POST_URL_PREFIX}` };
  if (image && !IMAGE_URL_PREFIXES.some((prefix) => image.startsWith(prefix))) return { error: "image must be hosted on furyengi.cv" };
  return { post: { slug, title, url, description: description.slice(0, 500), image } };
}

async function handleBroadcast(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  if (!env.BROADCAST_TOKEN) return json({ ok: false, error: "Broadcast is not configured" }, { status: 503 });
  if (!(await safeEqual(request.headers.get("authorization") || "", `Bearer ${env.BROADCAST_TOKEN}`))) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!env.SUBSCRIBERS || !env.RESEND_API_KEY || !env.TOKEN_SECRET) {
    return json({ ok: false, error: "Email sending is not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const { post, error } = validatePost(body);
  if (error) return json({ ok: false, error }, { status: 400 });

  const test = body.test ? String(body.test).trim().toLowerCase() : "";
  if (test && !EMAIL_RE.test(test)) return json({ ok: false, error: "Invalid test address" }, { status: 400 });

  const sentKey = `sent:${post.slug}`;
  const previous = await env.SUBSCRIBERS.get(sentKey, "json");
  if (!test && !body.dryRun && previous && !body.force && !body.retryFailed) {
    return json({ ok: false, error: "Already sent. Use retryFailed to resend failures or force to send again.", sent: previous }, { status: 409 });
  }

  let recipients;
  if (test) {
    recipients = [test];
  } else if (body.retryFailed) {
    const active = new Set(await activeSubscribers(env));
    recipients = (previous?.failed || []).filter((email) => active.has(email));
  } else {
    recipients = await activeSubscribers(env);
  }

  if (body.dryRun) return json({ ok: true, dryRun: true, recipients: recipients.length, alreadySent: Boolean(previous) });
  if (recipients.length === 0) return json({ ok: true, recipients: 0, sent: 0, failed: 0 });

  const failed = [];
  let sent = 0;
  let lastError = "";
  const delay = Number(env.BATCH_DELAY_MS ?? DEFAULT_BATCH_DELAY_MS);
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const messages = await Promise.all(
      chunk.map(async (email) => postMessage(env, post, email, await linkFor(env, "unsubscribe", email), { test: Boolean(test) })),
    );
    try {
      await resend(env, "/emails/batch", messages);
      sent += chunk.length;
    } catch (err) {
      failed.push(...chunk);
      lastError = err.message;
      console.error("broadcast batch failed", err.message);
    }
    if (i + BATCH_SIZE < recipients.length && delay > 0) await sleep(delay);
  }

  if (!test && sent + (body.retryFailed ? previous?.sent || 0 : 0) > 0) {
    await env.SUBSCRIBERS.put(
      sentKey,
      JSON.stringify({
        sentAt: new Date().toISOString(),
        title: post.title,
        sent: sent + (body.retryFailed ? previous?.sent || 0 : 0),
        failed: failed.slice(0, 500),
      }),
    );
  }

  const status = sent === 0 ? 502 : 200;
  return json({ ok: failed.length === 0, test: Boolean(test), recipients: recipients.length, sent, failed: failed.length, ...(lastError && { error: lastError }) }, { status });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const path = new URL(request.url).pathname.replace(/\/+$/, "");

    if (path === BASE) return handleSubscribe(request, env, origin);
    if (path === `${BASE}/confirm`) return handleConfirm(request, env);
    if (path === `${BASE}/unsubscribe`) return handleUnsubscribe(request, env);
    if (path === `${BASE}/broadcast`) return handleBroadcast(request, env);
    return json({ ok: false, error: "Not found" }, { status: 404 }, origin);
  },
};
