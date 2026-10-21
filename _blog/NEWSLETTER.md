# Newsletter: setup and sending

How it works: the site's form posts to a Cloudflare Worker (`cloudflare-newsletter-worker.js`). It saves each
address in KV as **pending**, emails a confirmation link through [Resend](https://resend.com), and only marks the
address **subscribed** when the link is confirmed (so nobody can sign up someone else). Every post email carries an
unsubscribe link plus the one-click `List-Unsubscribe` header.

Addresses saved before this existed (status `subscribed`) stay active; they did not go through confirmation.

## One-time setup

Do these **in order**. Deploying the worker before the secrets exist makes sign-ups fail.

1. **Resend**: create an account, add the domain `furyengi.cv`, and add the DNS records Resend shows you (SPF, DKIM,
   ideally DMARC) in Cloudflare DNS. Wait until the domain shows *Verified*. Create an API key with *Sending access*.
2. **Secrets** (from this folder; each command prompts for the value):
   ```
   npx wrangler secret put RESEND_API_KEY  -c wrangler-newsletter.toml     # the Resend key
   npx wrangler secret put TOKEN_SECRET    -c wrangler-newsletter.toml     # openssl rand -base64 32
   npx wrangler secret put BROADCAST_TOKEN -c wrangler-newsletter.toml     # openssl rand -base64 32
   ```
3. **Deploy**: `npx wrangler deploy -c wrangler-newsletter.toml` (the route is now `furyengi.cv/api/newsletter*`).
   Merging to GitHub does not deploy the worker; this step does.
4. **Check sign-up**: subscribe with your own address on the site, open the email, press *Confirm subscription*.
5. *(Optional)* To send from GitHub's *Actions* tab, add a repo secret `NEWSLETTER_BROADCAST_TOKEN` with the same
   value as `BROADCAST_TOKEN`.

Sender and reply-to are `FROM_ADDRESS` / `REPLY_TO` in `wrangler-newsletter.toml`. The sender must be on the
verified domain.

## Sending a post

Publish the post first and wait until it is live, so the link in the email works. Then, from the repo root:

```
export NEWSLETTER_BROADCAST_TOKEN=...        # same value as BROADCAST_TOKEN
python3 _blog/notify.py <slug> --test you@example.com    # 1. look at it in your inbox
python3 _blog/notify.py <slug> --dry-run                 # 2. how many people would get it
python3 _blog/notify.py <slug>                           # 3. send to all confirmed subscribers
```

Or use *Actions → Email a post to subscribers → Run workflow* (same options).

A post can only be sent once; a second attempt is refused. If some batches failed, the output lists how many, and
`--retry-failed` sends only to those. `--force` sends the whole thing again (rarely what you want).

## Limits to know

- Resend's free plan caps sending per day and per month. If a send hits the cap, the unsent batches show as failed;
  run `--retry-failed` after the cap resets.
- Cloudflare limits how many outbound calls one request may make. A few hundred subscribers is far inside that.
  If the list grows into the thousands, the send should be chunked.
- The sign-up form is limited to 5 attempts per IP per hour, and a pending address is re-emailed at most once an hour.

## Tests

`node --test _blog/tests/newsletter.test.mjs` runs the worker against an in-memory KV and a mocked Resend.
It does not send real email.
