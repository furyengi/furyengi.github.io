const ORIGIN = "https://furyengi.cv";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(ORIGIN);

    target.pathname = incoming.pathname === "/" ? "/blog/" : incoming.pathname;
    target.search = incoming.search;

    const originRequest = new Request(target, request);
    originRequest.headers.set("Host", "furyengi.cv");

    const response = await fetch(originRequest);
    const headers = new Headers(response.headers);

    headers.set("x-furyengi-blog-router", "cloudflare-worker");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
