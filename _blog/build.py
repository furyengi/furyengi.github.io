#!/usr/bin/env python3
"""Build the blog from _blog/posts/<slug>/{meta.json,body.html}.

Generates (all committed, so GitHub Pages serves plain static files):
  <slug>/index.html and blog/<slug>/index.html   article pages
  blog/index.html and blogs.html                 blog index
  index.html                                     home-page blog preview (between markers)
  sitemap.xml, llms.txt, llms-full.txt           machine-readable listings

Usage:  python3 _blog/build.py
Stdlib only. The underscore folder is ignored by GitHub Pages, so sources are not published.
"""

import hashlib
import html
import json
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "_blog" / "posts"

BLOG = "https://blog.furyengi.cv/"
SITE = "https://furyengi.cv/"
AUTHOR = "Mahmud Abdulmalik"
INDEX_TITLE = "Furyengi Blog — AI, Backend & Build Notes"
INDEX_DESC = (
    "Essays by Mahmud Abdulmalik on AI systems, backend engineering, "
    "cloud infrastructure, Orvel, and software craft."
)
HOME_PREVIEW_COUNT = 4
STATIC_PAGES = [  # (path, lastmod, changefreq, priority) — home lastmod follows the newest post
    ("about.html", "2026-09-29", "monthly", "0.8"),
    ("projects.html", "2026-09-29", "monthly", "0.9"),
]

esc = lambda s: html.escape(str(s), quote=True)


def asset_version(name):
    return hashlib.md5((ROOT / name).read_bytes()).hexdigest()[:8]


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def load_posts():
    posts = []
    for folder in sorted(POSTS_DIR.iterdir()):
        if not (folder / "meta.json").exists():
            continue
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        meta["slug"] = folder.name
        meta["body"] = (folder / "body.html").read_text(encoding="utf-8").strip()
        meta["url"] = f"{BLOG}{folder.name}/"
        meta["cat"] = slugify(meta["category"])
        meta["modified"] = meta.get("modified", meta["date"])
        d = date.fromisoformat(meta["date"])
        meta["date_human"] = f"{d.strftime('%b')} {d.day}, {d.year}"
        meta["read"] = f"{meta['readMinutes']} min read"
        meta["img"] = f"/{meta['cover']}"
        meta["og_img"] = f"{SITE}{meta['cover']}"
        meta["search"] = " ".join(
            [meta["title"], meta["description"], meta["category"], *meta.get("tags", [])]
        ).lower()
        posts.append(meta)
    posts.sort(key=lambda p: (p["date"], p["slug"]), reverse=True)
    return posts


# ── shared fragments ─────────────────────────────────────────

def icon(name, cls=""):
    paths = {
        "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        "up-right": '<path d="M7 17 17 7M8 7h9v9"/>',
        "left": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
        "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
        "x": '<path d="M4 4l16 16M20 4 4 20"/>',
    }
    return f'<svg class="i {cls}" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>'


THEME_BOOT = (
    '<script>try{document.documentElement.dataset.theme='
    'localStorage.getItem("furyengi-theme")||"light"}'
    'catch(e){document.documentElement.dataset.theme="light"}</script>'
)

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com" />\n'
    '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n'
    '    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    "family=Fraunces:opsz,wght@9..144,400..700&family=Inter:wght@400;500;600;700"
    '&family=JetBrains+Mono:wght@400;500;600&display=swap" />'
)


def head(title, desc, canonical, og_img, og_type, extra=""):
    return f"""<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{esc(title)}</title>
    <meta name="description" content="{esc(desc)}" />
    <link rel="canonical" href="{canonical}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    {THEME_BOOT}
    {FONTS}
    <link rel="stylesheet" href="/blog.css?v={asset_version('blog.css')}" />
    <meta property="og:type" content="{og_type}" />
    <meta property="og:site_name" content="Furyengi Blog" />
    <meta property="og:title" content="{esc(title.removesuffix(' — Furyengi Blog'))}" />
    <meta property="og:description" content="{esc(desc)}" />
    <meta property="og:url" content="{canonical}" />
    <meta property="og:image" content="{og_img}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@furyengi" />
    <meta name="twitter:creator" content="@furyengi" />
{extra}  </head>
"""


def nav(current=False):
    cur = ' aria-current="page"' if current else ""
    return f"""    <header class="nav">
      <div class="wrap nav-inner">
        <a class="brand" href="{BLOG}" data-same-tab>furyengi<span>.blog</span></a>
        <nav class="nav-links" aria-label="Blog navigation">
          <a href="{BLOG}" data-same-tab{cur}>Writing</a>
          <a href="{SITE}" data-same-tab>Portfolio</a>
          <a href="{SITE}Mahmud_CV.pdf">CV</a>
          <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch between light and dark theme">
            <svg class="i i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
            <svg class="i i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          </button>
        </nav>
      </div>
    </header>"""


def subscribe():
    return f"""      <section class="wrap section-gap">
        <div class="subscribe">
          <div>
            <h2>Get the next note</h2>
            <p>No spam. Just new writing on AI, backend systems, and what I’m building.</p>
          </div>
          <form class="newsletter-form" action="{SITE}api/newsletter" method="POST" data-newsletter-form>
            <input type="email" name="email" placeholder="Your email address" aria-label="Email address" autocomplete="email" required />
            <button type="submit">Subscribe</button>
            <p class="newsletter-status" aria-live="polite"></p>
          </form>
        </div>
      </section>"""


def footer():
    return f"""    <footer class="footer">
      <div class="wrap footer-inner">
        <span>© MMXXVI {AUTHOR}</span>
        <nav aria-label="Footer">
          <a href="{SITE}" data-same-tab>Portfolio</a>
          <a href="https://github.com/furyengi">GitHub</a>
          <a href="https://x.com/furyengi">X</a>
        </nav>
      </div>
    </footer>
    <script src="/site.js?v={asset_version('site.js')}"></script>"""


def card(p, listing=True, featured=False):
    data = f' data-post data-search="{esc(p["search"])}"' if listing else ""
    img = (
        f'<img src="{p["img"]}" alt="Cover: {esc(p["title"])}" width="1672" height="941" '
        + ('fetchpriority="high" />' if featured else 'loading="lazy" decoding="async" />')
    )
    meta = (
        f'<div class="meta"><time datetime="{p["date"]}">{p["date_human"]}</time>'
        f'<span>{p["read"]}</span>'
        f'<span class="go">Read {icon("up-right")}</span></div>'
    )
    link = f'<a class="card-link" href="{p["url"]}" data-same-tab>{esc(p["title"])}</a>'
    if featured:
        return f"""<article class="card feature" data-cat="{p['cat']}"{data}>
          <div class="thumb">{img}</div>
          <div class="card-body">
            <div class="head"><span class="badge">Latest</span><span class="kicker">{esc(p['category'])}</span></div>
            <h2>{link}</h2>
            <p class="excerpt">{esc(p['description'])}</p>
            {meta}
          </div>
        </article>"""
    return f"""<article class="card" data-cat="{p['cat']}"{data}>
            <div class="thumb">{img}</div>
            <div class="card-body">
              <span class="kicker">{esc(p['category'])}</span>
              <h3>{link}</h3>
              <p class="excerpt">{esc(p['description'])}</p>
              {meta}
            </div>
          </article>"""


# ── pages ────────────────────────────────────────────────────

def render_index(posts):
    cats = []
    for p in posts:
        if p["cat"] not in [c[0] for c in cats]:
            cats.append((p["cat"], p["category"]))
    chips = [
        f'<button class="chip" type="button" data-filter="all" aria-pressed="true">All <small>{len(posts)}</small></button>'
    ] + [
        f'<button class="chip" type="button" data-filter="{slug}" data-cat="{slug}" aria-pressed="false">'
        f'<i></i>{esc(name)} <small>{sum(1 for p in posts if p["cat"] == slug)}</small></button>'
        for slug, name in cats
    ]
    ld = {
        "@context": "https://schema.org",
        "@type": "Blog",
        "name": "Furyengi Blog",
        "url": BLOG,
        "author": {"@type": "Person", "name": AUTHOR, "alternateName": "furyengi", "url": SITE},
        "blogPost": [
            {
                "@type": "BlogPosting",
                "headline": p["title"],
                "url": p["url"],
                "image": p["og_img"],
                "datePublished": p["date"],
                "author": {"@type": "Person", "name": AUTHOR},
            }
            for p in posts
        ],
    }
    extra = f'    <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False, separators=(",", ":"))}</script>\n'
    latest, rest = posts[0], posts[1:]
    out = head(INDEX_TITLE, INDEX_DESC, BLOG, latest["og_img"], "website", extra)
    out += f"""  <body>
{nav(current=True)}
    <main>
      <section class="wrap masthead">
        <p class="eyebrow">Essays &amp; build notes</p>
        <h1>Writing<i>.</i></h1>
        <p class="lede">Notes on AI systems, backend engineering, cloud infrastructure and the things I’m building — plus the occasional tangent that’s just for fun.</p>
      </section>
      <section class="wrap" aria-label="All posts">
        <div class="toolbar">
          <label class="search">
            <span class="sr-only">Search posts</span>
            {icon("search")}
            <input type="search" data-search placeholder="Search posts…" autocomplete="off" />
          </label>
          <div class="chips" role="group" aria-label="Filter by topic">
            {"".join(chips)}
          </div>
        </div>
        <p class="status" data-status aria-live="polite">{len(posts)} posts</p>
        <div data-post-list>
          {card(latest, featured=True)}
          <div class="grid">
          {"".join(card(p) for p in rest)}
          </div>
        </div>
        <div class="empty" data-empty hidden><b>No posts match that.</b>Try another word, or clear the filter.</div>
      </section>
      <div style="height:clamp(48px,8vw,88px)"></div>
{subscribe()}
    </main>
{footer()}
    <script src="/blog.js?v={asset_version('blog.js')}"></script>
  </body>
</html>
"""
    return out


def render_article(p, posts):
    i = posts.index(p)
    newer = posts[i - 1] if i > 0 else None
    older = posts[i + 1] if i + 1 < len(posts) else None
    others = [q for q in posts if q is not p][:2]
    tweet = f"https://twitter.com/intent/tweet?url={quote(p['url'], safe='')}&text={quote(p['title'], safe='')}"
    ld = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": p["title"],
        "description": p["description"],
        "image": p["og_img"],
        "datePublished": p["date"],
        "dateModified": p["modified"],
        "keywords": ", ".join(p.get("tags", [])),
        "mainEntityOfPage": p["url"],
        "url": p["url"],
        "author": {
            "@type": "Person", "name": AUTHOR, "alternateName": "furyengi", "url": SITE,
            "sameAs": ["https://github.com/furyengi", "https://x.com/furyengi"],
        },
        "publisher": {"@type": "Person", "name": AUTHOR, "alternateName": "furyengi"},
    }
    extra = (
        f'    <meta property="article:published_time" content="{p["date"]}" />\n'
        f'    <meta property="article:author" content="{AUTHOR}" />\n'
        + "".join(f'    <meta property="article:tag" content="{esc(t)}" />\n' for t in p.get("tags", []))
        + f'    <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False, separators=(",", ":"))}</script>\n'
    )
    pager = ""
    if newer or older:
        def pg(q, cls, label):
            return (
                f'<a class="{cls}" href="{q["url"]}" data-same-tab data-cat="{q["cat"]}">'
                f'<small>{label}</small><b>{esc(q["title"])}</b></a>'
            )
        pager = '<nav class="pager" aria-label="More posts">' + (
            pg(older, "prev", "← Older") if older else ""
        ) + (pg(newer, "next", "Newer →") if newer else "") + "</nav>"
    out = head(f"{p['title']} — Furyengi Blog", p["description"], p["url"], p["og_img"], "article", extra)
    out += f"""  <body data-cat="{p['cat']}">
    <div class="reading-progress" aria-hidden="true"><i></i></div>
{nav()}
    <main>
      <article class="wrap">
        <header class="article-head">
          <a class="back" href="{BLOG}" data-same-tab>{icon("left")} All writing</a>
          <p class="kicker">{esc(p['category'])}</p>
          <h1>{esc(p['title'])}</h1>
          <p class="dek">{esc(p['description'])}</p>
          <div class="byline">
            <div class="who">
              <img src="/furyengi-profile.jpeg" alt="{AUTHOR}" width="44" height="44" />
              <div><b>{AUTHOR}</b><small>{p['date_human']} · {p['read']}</small></div>
            </div>
            <div class="actions">
              <button class="btn" type="button" data-copy-link data-copy-url="{p['url']}">{icon("link")} Copy link</button>
              <a class="btn" href="{tweet}">{icon("x")} Share on X</a>
            </div>
          </div>
        </header>
        <figure class="article-cover"><img src="{p['img']}" alt="Cover: {esc(p['title'])}" width="1672" height="941" fetchpriority="high" /></figure>
        <div class="prose">
{p['body']}
        </div>
        <div class="tags">{"".join(f'<span class="tag">{esc(t)}</span>' for t in p.get("tags", []))}</div>
        <aside class="author">
          <img src="/furyengi-profile.jpeg" alt="{AUTHOR}" width="72" height="72" loading="lazy" />
          <div>
            <h2>Written by {AUTHOR}</h2>
            <p>Full-Stack Engineer — Backend, Cloud &amp; AI. Building Orvel and writing about AI systems, backend architecture, and software craft.</p>
            <a href="{SITE}" data-same-tab>View portfolio →</a>
          </div>
        </aside>
        {pager}
      </article>
      <section class="wrap more" aria-label="Continue reading">
        <div class="more-head"><h2>Continue reading</h2><a href="{BLOG}" data-same-tab>All writing →</a></div>
        <div class="grid">
          {"".join(card(q, listing=False) for q in others)}
        </div>
      </section>
      <div style="height:clamp(48px,8vw,88px)"></div>
{subscribe()}
    </main>
{footer()}
  </body>
</html>
"""
    return out


def home_preview(posts):
    rows = []
    for p in posts[:HOME_PREVIEW_COUNT]:
        rows.append(
            f"""        <a class="bp-row" data-cat="{p['cat']}" href="{p['url']}" data-same-tab>
          <img class="bp-thumb" src="{p['img']}" alt="" width="1672" height="941" loading="lazy" />
          <span class="bp-copy">
            <span class="bp-cat">{esc(p['category'])}</span>
            <h3>{esc(p['title'])}</h3>
            <span class="bp-meta">{p['date_human']} · {p['read']}</span>
          </span>
          {icon("up-right", "bp-open")}
        </a>"""
        )
    return "\n".join(rows)


# ── writers ──────────────────────────────────────────────────

def write(path, text):
    path = ROOT / path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def replace_between(text, start, end, new, label):
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pattern.search(text):
        sys.exit(f"markers for {label} not found")
    return pattern.sub(lambda _: f"{start}\n{new}\n        {end}", text, count=1)


def main():
    posts = load_posts()
    if not posts:
        sys.exit("no posts found")

    index = render_index(posts)
    write("blog/index.html", index)
    write("blogs.html", index)

    for p in posts:
        page = render_article(p, posts)
        write(f"{p['slug']}/index.html", page)
        write(f"blog/{p['slug']}/index.html", page)

    # home page preview
    home = (ROOT / "index.html").read_text(encoding="utf-8")
    home = replace_between(home, "<!-- blog:start -->", "<!-- blog:end -->", home_preview(posts), "index.html")
    write("index.html", home)

    # cache-bust site.css / site.js on the static pages that load them
    for name in ("index.html", "about.html", "projects.html"):
        page = (ROOT / name).read_text(encoding="utf-8")
        for asset in ("site.css", "site.js"):
            page = re.sub(rf'(/{re.escape(asset)}\?v=)[\w.-]+', rf'\g<1>{asset_version(asset)}', page)
        write(name, page)

    # sitemap
    latest = posts[0]["date"]
    urls = [(SITE, latest, "monthly", "1.0")]
    urls += [(SITE + path, mod, freq, pri) for path, mod, freq, pri in STATIC_PAGES]
    urls += [(BLOG, latest, "weekly", "0.9")]
    urls += [(p["url"], p["modified"], "monthly", "0.8") for p in posts]
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    for loc, mod, freq, pri in urls:
        sm += f"  <url>\n    <loc>{loc}</loc>\n    <lastmod>{mod}</lastmod>\n    <changefreq>{freq}</changefreq>\n    <priority>{pri}</priority>\n  </url>\n"
    write("sitemap.xml", sm + "</urlset>\n")

    # llms files
    short = (ROOT / "llms.txt").read_text(encoding="utf-8")
    short = short[: short.index("## Blog")] + "## Blog\n" + "".join(f"- {p['title'].replace('“', chr(34)).replace('”', chr(34))}\n" for p in posts)
    write("llms.txt", short)
    full = (ROOT / "llms-full.txt").read_text(encoding="utf-8")
    start, end = full.index("## Blog"), full.index("Canonical profile identity")
    section = "## Blog\n\n" + "".join(
        f"### {p['title'].replace('“', chr(34)).replace('”', chr(34))}\n{p.get('llmsSummary', p['description'])}\n\n" for p in posts
    )
    write("llms-full.txt", full[:start] + section + full[end:])

    print(f"built {len(posts)} posts: " + ", ".join(p["slug"] for p in posts))


if __name__ == "__main__":
    main()
