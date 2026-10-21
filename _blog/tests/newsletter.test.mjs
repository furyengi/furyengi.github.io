// Run: node --test _blog/tests/
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../../cloudflare-newsletter-worker.js";

class FakeKV {
  constructor() { this.store = new Map(); }
  async get(key, type) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return type === "json" ? JSON.parse(entry.value) : entry.value;
  }
  async put(key, value, options = {}) { this.store.set(key, { value, metadata: options.metadata }); }
  async list({ prefix = "", cursor } = {}) {
    const keys = [...this.store.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
    const start = cursor ? Number(cursor) : 0;
    const page = keys.slice(start, start + 3); // tiny page size to exercise pagination
    const done = start + 3 >= keys.length;
    return { keys: page.map(([name, e]) => ({ name, metadata: e.metadata })), list_complete: done, cursor: String(start + 3) };
  }
}

const baseEnv = () => ({
  SUBSCRIBERS: new FakeKV(),
  RESEND_API_KEY: "re_test",
  TOKEN_SECRET: "token-secret",
  BROADCAST_TOKEN: "broadcast-secret",
  FROM_ADDRESS: "Furyengi Blog <blog@furyengi.cv>",
  REPLY_TO: "me@example.com",
  PUBLIC_ORIGIN: "https://furyengi.cv",
  BATCH_DELAY_MS: "0",
});

let sentMail; // every call to Resend
const realFetch = globalThis.fetch;
function mockResend({ failWith } = {}) {
  sentMail = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sentMail.push({ url, auth: init.headers.Authorization, body });
    if (failWith) return new Response("nope", { status: failWith });
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  };
}
test.afterEach(() => { globalThis.fetch = realFetch; });

const call = (env, path, init = {}) => worker.fetch(new Request(`https://furyengi.cv${path}`, init), env);
const subscribe = (env, email, headers = {}) =>
  call(env, "/api/newsletter", { method: "POST", headers: { "content-type": "application/json", origin: "https://furyengi.cv", ...headers }, body: JSON.stringify({ email, source: "t" }) });
const linkIn = (mail, label) => new URL(mail.body.text.match(/https:\/\/\S+/)[0]);
const record = async (env, email) => env.SUBSCRIBERS.get(`subscriber:${email}`, "json");

test("subscribe stores a pending record and sends one confirmation email", async () => {
  mockResend(); const env = baseEnv();
  const res = await subscribe(env, "  New@Example.com ");
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true, pending: true });
  assert.equal((await record(env, "new@example.com")).status, "pending");
  assert.equal(sentMail.length, 1);
  assert.equal(sentMail[0].url, "https://api.resend.com/emails");
  assert.equal(sentMail[0].auth, "Bearer re_test");
  assert.deepEqual(sentMail[0].body.to, ["new@example.com"]);
  assert.equal(sentMail[0].body.from, "Furyengi Blog <blog@furyengi.cv>");
  assert.equal(sentMail[0].body.reply_to, "me@example.com");
  assert.match(sentMail[0].body.text, /\/api\/newsletter\/confirm\?email=new%40example\.com&token=/);
});

test("invalid email is rejected and nothing is sent or stored", async () => {
  mockResend(); const env = baseEnv();
  const res = await subscribe(env, "not-an-email");
  assert.equal(res.status, 400);
  assert.equal(sentMail.length, 0);
  assert.equal(env.SUBSCRIBERS.store.size, 0);
});

test("confirm page does not subscribe on GET (link scanners), only on POST", async () => {
  mockResend(); const env = baseEnv();
  await subscribe(env, "a@example.com");
  const link = linkIn(sentMail[0]);
  const path = link.pathname + link.search;
  const get = await call(env, path);
  assert.equal(get.status, 200);
  assert.match(await get.text(), /Confirm subscription/);
  assert.equal((await record(env, "a@example.com")).status, "pending");
  const post = await call(env, path, { method: "POST" });
  assert.equal(post.status, 200);
  assert.match(await post.text(), /You’re subscribed/);
  assert.equal((await record(env, "a@example.com")).status, "subscribed");
});

test("tampered or foreign confirm tokens are rejected", async () => {
  mockResend(); const env = baseEnv();
  await subscribe(env, "a@example.com");
  const link = linkIn(sentMail[0]);
  const bad = await call(env, `/api/newsletter/confirm?email=a%40example.com&token=${link.searchParams.get("token")}x`, { method: "POST" });
  assert.equal(bad.status, 400);
  const other = await call(env, `/api/newsletter/confirm?email=b%40example.com&token=${link.searchParams.get("token")}`, { method: "POST" });
  assert.equal(other.status, 400);
  assert.equal((await record(env, "a@example.com")).status, "pending");
});

test("a confirm token cannot be used as an unsubscribe token", async () => {
  mockResend(); const env = baseEnv();
  await subscribe(env, "a@example.com");
  const t = linkIn(sentMail[0]).searchParams.get("token");
  const res = await call(env, `/api/newsletter/unsubscribe?email=a%40example.com&token=${t}`, { method: "POST" });
  assert.equal(res.status, 400);
});

test("subscribing again: pending is rate-limited to one email per hour; confirmed sends nothing", async () => {
  mockResend(); const env = baseEnv();
  await subscribe(env, "a@example.com");
  await subscribe(env, "a@example.com");
  assert.equal(sentMail.length, 1);
  const link = linkIn(sentMail[0]);
  await call(env, link.pathname + link.search, { method: "POST" });
  const again = await subscribe(env, "a@example.com");
  assert.deepEqual(await again.json(), { ok: true, alreadySubscribed: true });
  assert.equal(sentMail.length, 1);
});

test("a failed confirmation email returns 502 and allows an immediate retry", async () => {
  mockResend({ failWith: 500 }); const env = baseEnv();
  const res = await subscribe(env, "a@example.com");
  assert.equal(res.status, 502);
  mockResend();
  const retry = await subscribe(env, "a@example.com");
  assert.equal(retry.status, 202);
  assert.equal(sentMail.length, 1);
});

test("missing email configuration fails closed without storing anything", async () => {
  mockResend(); const env = baseEnv(); delete env.RESEND_API_KEY;
  const res = await subscribe(env, "a@example.com");
  assert.equal(res.status, 500);
  assert.equal(env.SUBSCRIBERS.store.size, 0);
});

test("per-IP rate limit blocks the 6th attempt", async () => {
  mockResend(); const env = baseEnv();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await subscribe(env, `u${i}@example.com`, { "cf-connecting-ip": "1.2.3.4" })).status);
  assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
  assert.equal(sentMail.length, 5);
});

test("CORS preflight works for the blog origin", async () => {
  const env = baseEnv();
  const res = await call(env, "/api/newsletter", { method: "OPTIONS", headers: { origin: "https://blog.furyengi.cv" } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://blog.furyengi.cv");
});

test("unsubscribe: GET only shows a page; POST (form or one-click) unsubscribes", async () => {
  mockResend(); const env = baseEnv();
  await env.SUBSCRIBERS.put("subscriber:a@example.com", JSON.stringify({ email: "a@example.com", status: "subscribed" }), { metadata: { status: "subscribed" } });
  const post = { slug: "p", title: "T", url: "https://blog.furyengi.cv/p/" };
  const send = await call(env, "/api/newsletter/broadcast", { method: "POST", headers: { authorization: "Bearer broadcast-secret" }, body: JSON.stringify(post) });
  assert.equal(send.status, 200);
  const unsub = new URL(sentMail[0].body[0].headers["List-Unsubscribe"].slice(1, -1));
  const path = unsub.pathname + unsub.search;
  assert.equal((await call(env, path)).status, 200);
  assert.equal((await record(env, "a@example.com")).status, "subscribed");
  const oneClick = await call(env, path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(oneClick.status, 200);
  assert.equal((await record(env, "a@example.com")).status, "unsubscribed");
  const again = await subscribe(env, "a@example.com");   // can re-subscribe, goes back through confirmation
  assert.equal(again.status, 202);
  assert.equal((await record(env, "a@example.com")).status, "pending");
});

async function seed(env) {
  const put = (email, status, meta = true) => env.SUBSCRIBERS.put(`subscriber:${email}`, JSON.stringify({ email, status }), meta ? { metadata: { status } } : {});
  await put("one@example.com", "subscribed");
  await put("two@example.com", "subscribed");
  await put("legacy@example.com", "subscribed", false);   // created before double opt-in: no metadata
  await put("pending@example.com", "pending");
  await put("gone@example.com", "unsubscribed");
}
const broadcast = (env, body, token = "broadcast-secret") =>
  call(env, "/api/newsletter/broadcast", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const post = { slug: "ram-vs-ram", title: "RAM vs <Ram>", description: "Fun & games", url: "https://blog.furyengi.cv/ram-vs-ram/", image: "https://furyengi.cv/ram-vs-ram-cover.png" };

test("broadcast requires the bearer token", async () => {
  mockResend(); const env = baseEnv(); await seed(env);
  assert.equal((await broadcast(env, post, "wrong")).status, 401);
  assert.equal((await call(env, "/api/newsletter/broadcast", { method: "POST", body: JSON.stringify(post) })).status, 401);
  assert.equal(sentMail.length, 0);
});

test("broadcast emails confirmed + legacy subscribers only, one personalised unsubscribe link each", async () => {
  mockResend(); const env = baseEnv(); await seed(env);
  const res = await broadcast(env, post);
  assert.deepEqual(await res.json(), { ok: true, test: false, recipients: 3, sent: 3, failed: 0 });
  const msgs = sentMail.flatMap((m) => m.body);
  assert.deepEqual(msgs.map((m) => m.to[0]).sort(), ["legacy@example.com", "one@example.com", "two@example.com"]);
  for (const m of msgs) {
    assert.equal(m.subject, "RAM vs <Ram>");
    assert.match(m.headers["List-Unsubscribe"], new RegExp(`email=${encodeURIComponent(m.to[0])}`));
    assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.ok(m.html.includes("RAM vs &lt;Ram&gt;"), "title is HTML-escaped");
    assert.ok(!m.html.includes("<Ram>"));
    assert.ok(m.text.includes("https://blog.furyengi.cv/ram-vs-ram/"));
  }
});

test("broadcast is idempotent per post; force resends", async () => {
  mockResend(); const env = baseEnv(); await seed(env);
  await broadcast(env, post);
  const second = await broadcast(env, post);
  assert.equal(second.status, 409);
  assert.equal(sentMail.length, 1);
  assert.equal((await broadcast(env, { ...post, force: true })).status, 200);
  assert.equal(sentMail.length, 2);
});

test("test mode sends only to the given address and does not mark the post as sent", async () => {
  mockResend(); const env = baseEnv(); await seed(env);
  const res = await broadcast(env, { ...post, test: "me@example.com" });
  assert.equal((await res.json()).sent, 1);
  assert.deepEqual(sentMail[0].body.map((m) => m.to[0]), ["me@example.com"]);
  assert.equal(sentMail[0].body[0].subject, "[TEST] RAM vs <Ram>");
  assert.equal(await env.SUBSCRIBERS.get("sent:ram-vs-ram"), null);
});

test("dry run counts recipients without sending", async () => {
  mockResend(); const env = baseEnv(); await seed(env);
  const res = await broadcast(env, { ...post, dryRun: true });
  assert.deepEqual(await res.json(), { ok: true, dryRun: true, recipients: 3, alreadySent: false });
  assert.equal(sentMail.length, 0);
});

test("recipients are sent in batches of at most 100", async () => {
  mockResend(); const env = baseEnv();
  for (let i = 0; i < 230; i += 1) await env.SUBSCRIBERS.put(`subscriber:u${i}@example.com`, "{}", { metadata: { status: "subscribed" } });
  const res = await broadcast(env, post);
  assert.equal((await res.json()).sent, 230);
  assert.deepEqual(sentMail.map((m) => m.body.length), [100, 100, 30]);
});

test("a failed batch is reported, recorded, and can be retried without duplicating the rest", async () => {
  const env = baseEnv(); await seed(env);
  mockResend({ failWith: 500 });
  const failed = await broadcast(env, post);
  assert.equal(failed.status, 502);
  assert.equal(await env.SUBSCRIBERS.get("sent:ram-vs-ram"), null);   // nothing delivered, so no "sent" lock
  mockResend();
  const ok = await broadcast(env, post);
  assert.equal((await ok.json()).sent, 3);
});

test("retryFailed only targets recorded failures that are still subscribed", async () => {
  mockResend(); const env = baseEnv(); await seed(env);
  await env.SUBSCRIBERS.put("sent:ram-vs-ram", JSON.stringify({ sent: 1, failed: ["one@example.com", "gone@example.com"] }));
  const res = await broadcast(env, { ...post, retryFailed: true });
  assert.deepEqual(await res.json(), { ok: true, test: false, recipients: 1, sent: 1, failed: 0 });
  assert.deepEqual(sentMail[0].body.map((m) => m.to[0]), ["one@example.com"]);
});

test("broadcast rejects bad input (wrong host, bad slug, missing title)", async () => {
  mockResend(); const env = baseEnv(); await seed(env);
  assert.equal((await broadcast(env, { ...post, url: "https://evil.example/x/" })).status, 400);
  assert.equal((await broadcast(env, { ...post, image: "https://evil.example/x.png" })).status, 400);
  assert.equal((await broadcast(env, { ...post, slug: "../x" })).status, 400);
  assert.equal((await broadcast(env, { ...post, title: "" })).status, 400);
  assert.equal(sentMail.length, 0);
});

test("unknown paths return 404 JSON", async () => {
  const res = await call(baseEnv(), "/api/newsletter/nope");
  assert.equal(res.status, 404);
});
