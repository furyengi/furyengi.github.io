#!/usr/bin/env python3
"""Build the photo album from _album/albums/<album>/{album.json, <photos>}.

Generates (committed, so GitHub Pages serves plain static files):
  album/index.html                          hub: albums + latest photos
  album/<album>/index.html                  one page per album
  album/<album>/<photo>/index.html          one page per photo (this is what Google indexes)
  album/<album>/<photo>/<photo>-<w>.webp    resized copies (480/960/1600, never upscaled)
  album/<album>/<photo>/<photo>-<w>.jpg     JPEG fallback used as <img src>, og:image and in the sitemap
  _album/entries.json                       sitemap entries, picked up by _blog/build.py

Privacy: every published image is re-encoded from pixels only, so EXIF (GPS, camera, dates) is dropped.
Run `python3 _album/audit.py` afterwards; it fails if any metadata slipped through.

Usage:  python3 _album/build.py [--force]
Needs Pillow. See _album/README.md.
"""

import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "_album" / "albums"
OUT = ROOT / "album"
MANIFEST = ROOT / "_album" / "manifest.json"
ENTRIES = ROOT / "_album" / "entries.json"

# Shared constants/helpers (fonts, escaping, footer, cache-busting) come from the blog builder.
_spec = importlib.util.spec_from_file_location("blogbuild", ROOT / "_blog" / "build.py")
blog = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(blog)
esc, SITE, BLOG, AUTHOR = blog.esc, blog.SITE, blog.BLOG, blog.AUTHOR
ALBUM = SITE + "album/"

WIDTHS = (480, 960, 1600)
RECIPE = "v1-webp82-jpeg85"  # bump to force every image to be regenerated
PRIVATE_KEYS = ("exif", "xmp", "icc_profile", "comment")


# ── images ───────────────────────────────────────────────────

def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def file_hash(path):
    h = hashlib.sha1(RECIPE.encode())
    h.update(path.read_bytes())
    return h.hexdigest()[:16]


def render_variants(src, dest, slug):
    """Write resized WebP + one JPEG fallback. Pixels only: no metadata is carried over."""
    dest.mkdir(parents=True, exist_ok=True)
    for stale in list(dest.glob("*.webp")) + list(dest.glob("*.jpg")):
        stale.unlink()  # sizes can change if the source changes; never leave old variants behind
    with Image.open(src) as opened:
        im = ImageOps.exif_transpose(opened)
        if "A" in im.getbands():
            flat = Image.new("RGB", im.size, "#ffffff")
            flat.paste(im, mask=im.getchannel("A"))
            im = flat
        else:
            im = im.convert("RGB")
        w0, h0 = im.size
        widths = sorted({min(w, w0) for w in WIDTHS})
        for w in widths:
            h = round(h0 * w / w0)
            resized = im if w == w0 else im.resize((w, h), Image.LANCZOS)
            resized.save(dest / f"{slug}-{w}.webp", "WEBP", quality=82, method=6)
            if w == widths[-1]:
                resized.save(dest / f"{slug}-{w}.jpg", "JPEG", quality=85, optimize=True, progressive=True)


def describe_variants(dest, slug, url_path):
    """Read back what is on disk so pages always match the real files."""
    webps = []
    for f in sorted(dest.glob(f"{slug}-*.webp"), key=lambda p: int(p.stem.rsplit("-", 1)[1])):
        with Image.open(f) as im:
            webps.append({"w": im.width, "h": im.height, "path": f"{url_path}{f.name}"})
    jpg_file = next(iter(sorted(dest.glob(f"{slug}-*.jpg"))))
    with Image.open(jpg_file) as im:
        jpg = {"w": im.width, "h": im.height, "path": f"{url_path}{jpg_file.name}"}
    return webps, jpg


# ── loading ──────────────────────────────────────────────────

def load_albums(force):
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() and not force else {}
    fresh = {}
    albums = []
    for folder in sorted(SRC.iterdir()) if SRC.exists() else []:
        meta_path = folder / "album.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        album = {
            "slug": folder.name,
            "title": meta["title"],
            "description": meta["description"],
            "items": [],
        }
        seen = set()
        for entry in meta.get("items", []):
            src = folder / entry["file"]
            if not src.exists():
                sys.exit(f"{folder.name}: missing file {entry['file']}")
            slug = entry.get("slug") or slugify(entry["title"])
            if slug in seen:
                sys.exit(f"{folder.name}: duplicate photo slug '{slug}'")
            seen.add(slug)
            alt = str(entry.get("alt", "")).strip()
            if not alt:
                sys.exit(f"{folder.name}/{entry['file']}: alt text is required")
            caption = str(entry.get("caption") or alt).strip()
            published = date.fromisoformat(entry["date"])

            key = f"{folder.name}/{slug}"
            dest = OUT / folder.name / slug
            digest = file_hash(src)
            fresh[key] = digest
            if manifest.get(key) != digest or not any(dest.glob("*.jpg")):
                render_variants(src, dest, slug)
                print(f"  processed {key}")
            url_path = f"/album/{folder.name}/{slug}/"
            webps, jpg = describe_variants(dest, slug, url_path)
            album["items"].append(
                {
                    "album": album,
                    "slug": slug,
                    "title": entry["title"],
                    "alt": alt,
                    "caption": caption,
                    "tags": entry.get("tags", []),
                    "date": published.isoformat(),
                    "date_human": f"{published.strftime('%b')} {published.day}, {published.year}",
                    "url": f"{ALBUM}{folder.name}/{slug}/",
                    "webps": webps,
                    "jpg": jpg,
                }
            )
        album["items"].sort(key=lambda i: i["date"], reverse=True)
        if not album["items"]:
            continue  # an empty album is not published
        album["url"] = f"{ALBUM}{album['slug']}/"
        cover_slug = meta.get("cover")
        album["cover"] = next((i for i in album["items"] if i["slug"] == cover_slug), album["items"][0])
        albums.append(album)
    albums.sort(key=lambda a: a["items"][0]["date"], reverse=True)
    MANIFEST.write_text(json.dumps(dict(sorted(fresh.items())), indent=2) + "\n")
    return albums


def prune_stale(albums):
    """Remove generated pages/images for albums or photos that no longer exist in the source."""
    keep = {a["slug"]: {i["slug"] for i in a["items"]} for a in albums}
    if not OUT.exists():
        return
    for album_dir in sorted(OUT.iterdir()):
        if not album_dir.is_dir():
            continue
        if album_dir.name not in keep:
            shutil.rmtree(album_dir)
            print(f"  removed album {album_dir.name}")
            continue
        for item_dir in sorted(album_dir.iterdir()):
            if item_dir.is_dir() and item_dir.name not in keep[album_dir.name]:
                shutil.rmtree(item_dir)
                print(f"  removed photo {album_dir.name}/{item_dir.name}")


# ── html helpers ─────────────────────────────────────────────

def abs_url(path):
    return SITE.rstrip("/") + path


def srcset(item):
    return ", ".join(f"{v['path']} {v['w']}w" for v in item["webps"])


def img_tag(item, sizes, *, lazy=True, priority=False, cls=""):
    jpg = item["jpg"]
    loading = 'fetchpriority="high"' if priority else ('loading="lazy" decoding="async"' if lazy else "")
    klass = f' class="{cls}"' if cls else ""
    return (
        f'<img{klass} src="{jpg["path"]}" srcset="{srcset(item)}" sizes="{sizes}" '
        f'alt="{esc(item["alt"])}" width="{jpg["w"]}" height="{jpg["h"]}" {loading} />'
    )


def crumbs(trail):
    """trail: [(name, url)] ending with the current page."""
    items = [
        {"@type": "ListItem", "position": i + 1, "name": name, "item": url}
        for i, (name, url) in enumerate(trail)
    ]
    return {"@type": "BreadcrumbList", "itemListElement": items}


def person():
    return {"@type": "Person", "name": AUTHOR, "alternateName": "furyengi", "url": SITE}


def image_object(item, *, full=True):
    obj = {
        "@type": "ImageObject",
        "contentUrl": abs_url(item["jpg"]["path"]),
        "url": abs_url(item["jpg"]["path"]),
        "name": item["title"],
        "thumbnailUrl": abs_url(item["webps"][0]["path"]),
    }
    if full:
        obj.update(
            {
                "caption": item["caption"],
                "description": item["alt"],
                "width": item["jpg"]["w"],
                "height": item["jpg"]["h"],
                "encodingFormat": "image/jpeg",
                "datePublished": item["date"],
                "creator": person(),
                "creditText": f"Furyengi ({AUTHOR})",
                "copyrightNotice": f"© {item['date'][:4]} {AUTHOR}",
                "keywords": ", ".join(item["tags"]),
            }
        )
    return obj


def ld(graph):
    data = {"@context": "https://schema.org", "@graph": graph}
    return f'    <script type="application/ld+json">{json.dumps(data, ensure_ascii=False, separators=(",", ":"))}</script>\n'


def head(title, description, canonical, og_image, extra=""):
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{esc(title)}</title>
    <meta name="description" content="{esc(description)}" />
    <link rel="canonical" href="{canonical}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta name="color-scheme" content="light" />
    {blog.FONTS}
    <link rel="stylesheet" href="/blog.css?v={blog.asset_version('blog.css')}" />
    <link rel="stylesheet" href="/album.css?v={blog.asset_version('album.css')}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Furyengi Album" />
    <meta property="og:title" content="{esc(title)}" />
    <meta property="og:description" content="{esc(description)}" />
    <meta property="og:url" content="{canonical}" />
    <meta property="og:image" content="{og_image}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@furyengi" />
{extra}  </head>
"""


def nav(current=False):
    cur = ' aria-current="page"' if current else ""
    return f"""    <header class="nav">
      <div class="wrap nav-inner">
        <a class="brand" href="{ALBUM}" data-same-tab>furyengi<span>.album</span></a>
        <nav class="nav-links" aria-label="Album navigation">
          <a href="{ALBUM}" data-same-tab{cur}>Album</a>
          <a href="{BLOG}" data-same-tab>Writing</a>
          <a href="{SITE}" data-same-tab>Portfolio</a>
        </nav>
      </div>
    </header>"""


def breadcrumb_html(trail):
    parts = []
    for i, (name, url) in enumerate(trail):
        last = i == len(trail) - 1
        parts.append(f'<span aria-current="page">{esc(name)}</span>' if last else f'<a href="{url}" data-same-tab>{esc(name)}</a>')
    return f'<nav class="crumbs" aria-label="Breadcrumb">{" <i>/</i> ".join(parts)}</nav>'


def photo_figure(item, *, eager=False):
    sizes = "(min-width: 1100px) 360px, (min-width: 700px) 45vw, 92vw"
    data = (
        f'data-full="{item["webps"][-1]["path"]}" data-title="{esc(item["title"])}" '
        f'data-alt="{esc(item["alt"])}" data-caption="{esc(item["caption"])}"'
    )
    return (
        f'<figure class="photo">'
        f'<a class="photo-link" href="{item["url"]}" data-same-tab {data}>'
        f'{img_tag(item, sizes, lazy=not eager)}</a>'
        f'<figcaption><b>{esc(item["title"])}</b><span>{esc(item["album"]["title"])} · {item["date_human"]}</span></figcaption>'
        f"</figure>"
    )


def page_shell(body_main, scripts=""):
    return f"""  <body>
{nav(current=scripts == 'hub')}
{body_main}
{blog.footer()}
    <script src="/album.js?v={blog.asset_version('album.js')}"></script>
  </body>
</html>
"""


# ── pages ────────────────────────────────────────────────────

def render_hub(albums):
    latest = sorted((i for a in albums for i in a["items"]), key=lambda i: (i["date"]), reverse=True)[:24]
    total = sum(len(a["items"]) for a in albums)
    desc = "Photos by Mahmud Abdulmalik (Furyengi): screenshots of the products I build and moments from my work and life."
    cards = []
    for a in albums:
        cover = a["cover"]
        n = len(a["items"])
        cards.append(
            f"""<article class="card" data-cat="build-notes">
            <div class="thumb">{img_tag(cover, "(min-width: 700px) 45vw, 92vw", lazy=False)}</div>
            <div class="card-body">
              <span class="kicker">{n} photo{'s' if n != 1 else ''}</span>
              <h3><a class="card-link" href="{a['url']}" data-same-tab>{esc(a['title'])}</a></h3>
              <p class="excerpt">{esc(a['description'])}</p>
              <div class="meta"><time datetime="{a['items'][0]['date']}">Updated {a['items'][0]['date_human']}</time><span class="go">Open album {blog.icon('up-right')}</span></div>
            </div>
          </article>"""
        )
    graph = [
        {
            "@type": "ImageGallery",
            "@id": ALBUM + "#gallery",
            "url": ALBUM,
            "name": "Furyengi Album",
            "description": desc,
            "author": person(),
            "hasPart": [image_object(i, full=False) for i in latest],
        },
        crumbs([("Furyengi", SITE), ("Album", ALBUM)]),
    ]
    main = f"""    <main>
      <section class="wrap masthead">
        <p class="eyebrow">Photos by Furyengi</p>
        <h1>Album<i>.</i></h1>
        <p class="lede">Screenshots of the products I build and moments from my work and life, by Mahmud Abdulmalik, known online as Furyengi. {total} photo{'s' if total != 1 else ''} so far, with more on the way.</p>
      </section>
      <section class="wrap" aria-label="Albums">
        <div class="grid albums">
          {"".join(cards)}
        </div>
      </section>
      <section class="wrap latest" aria-label="Latest photos">
        <h2 class="section-title">Latest photos</h2>
        <div class="masonry" data-lightbox data-count="{len(latest)}">
          {"".join(photo_figure(i, eager=n < 4) for n, i in enumerate(latest))}
        </div>
      </section>
    </main>"""
    out = head("Furyengi Album — Photos by Mahmud Abdulmalik", desc, ALBUM, abs_url(albums[0]["cover"]["jpg"]["path"]), ld(graph))
    return out + page_shell(main, "hub")


def render_album(album):
    trail = [("Furyengi", SITE), ("Album", ALBUM), (album["title"], album["url"])]
    desc = album["description"]
    graph = [
        {
            "@type": "ImageGallery",
            "@id": album["url"] + "#gallery",
            "url": album["url"],
            "name": f"{album['title']} — Furyengi Album",
            "description": desc,
            "author": person(),
            "hasPart": [image_object(i, full=False) for i in album["items"]],
        },
        crumbs(trail),
    ]
    n = len(album["items"])
    main = f"""    <main>
      <section class="wrap masthead compact">
        {breadcrumb_html(trail[1:])}
        <h1>{esc(album['title'])}</h1>
        <p class="lede">{esc(desc)} <span class="count">{n} photo{'s' if n != 1 else ''}</span></p>
      </section>
      <section class="wrap" aria-label="Photos">
        <div class="masonry" data-lightbox data-count="{n}">
          {"".join(photo_figure(i, eager=k < 4) for k, i in enumerate(album["items"]))}
        </div>
      </section>
    </main>"""
    out = head(f"{album['title']} — Photos by Furyengi", desc, album["url"], abs_url(album["cover"]["jpg"]["path"]), ld(graph))
    return out + page_shell(main)


def render_item(item):
    album = item["album"]
    items = album["items"]
    i = items.index(item)
    newer = items[i - 1] if i > 0 else None
    older = items[i + 1] if i + 1 < len(items) else None
    others = [x for x in items if x is not item][:6]
    trail = [("Furyengi", SITE), ("Album", ALBUM), (album["title"], album["url"]), (item["title"], item["url"])]
    graph = [
        {
            "@type": "WebPage",
            "@id": item["url"] + "#webpage",
            "url": item["url"],
            "name": item["title"],
            "description": item["caption"],
            "datePublished": item["date"],
            "primaryImageOfPage": {"@id": item["url"] + "#image"},
            "breadcrumb": crumbs(trail),
            "author": person(),
        },
        {"@id": item["url"] + "#image", **image_object(item)},
    ]
    pager = ""
    if newer or older:
        def pg(q, cls, label):
            return f'<a class="{cls}" href="{q["url"]}" data-same-tab><small>{label}</small><b>{esc(q["title"])}</b></a>'
        pager = '<nav class="pager" aria-label="More photos">' + (
            pg(older, "prev", "← Older") if older else ""
        ) + (pg(newer, "next", "Newer →") if newer else "") + "</nav>"
    more = ""
    if others:
        more = f"""      <section class="wrap more" aria-label="More from this album">
        <div class="more-head"><h2>More from {esc(album['title'])}</h2><a href="{album['url']}" data-same-tab>Open album →</a></div>
        <div class="masonry" data-lightbox data-count="{len(others)}">
          {"".join(photo_figure(x) for x in others)}
        </div>
      </section>"""
    big = item["jpg"]["path"]
    main = f"""    <main>
      <article class="wrap">
        <header class="article-head">
          {breadcrumb_html(trail[1:])}
          <h1>{esc(item['title'])}</h1>
          <p class="dek">{esc(item['caption'])}</p>
          <div class="byline">
            <div class="who"><div><b>Photo by Furyengi ({AUTHOR})</b><small>{item['date_human']} · {esc(album['title'])}</small></div></div>
            <div class="actions"><a class="btn" href="{big}" target="_blank" rel="noopener">View full size</a></div>
          </div>
        </header>
        <figure class="article-cover">{img_tag(item, "(min-width: 1000px) 1000px, 94vw", lazy=False, priority=True)}</figure>
        <div class="tags">{"".join(f'<span class="tag">{esc(t)}</span>' for t in item["tags"])}</div>
        <p class="credit">© {item['date'][:4]} {AUTHOR}. All rights reserved.</p>
        {pager}
      </article>
{more}
    </main>"""
    out = head(f"{item['title']} — Furyengi Album", item["caption"], item["url"], abs_url(item["jpg"]["path"]), ld(graph))
    return out + page_shell(main)


# ── write ────────────────────────────────────────────────────

def write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main():
    force = "--force" in sys.argv
    albums = load_albums(force)
    if not albums:
        sys.exit("No albums with photos found in _album/albums/")

    prune_stale(albums)
    write(OUT / "index.html", render_hub(albums))
    entries = [
        {
            "loc": ALBUM,
            "lastmod": max(i["date"] for a in albums for i in a["items"]),
            "changefreq": "weekly",
            "priority": "0.8",
            "images": [],
        }
    ]
    for album in albums:
        write(OUT / album["slug"] / "index.html", render_album(album))
        entries.append(
            {
                "loc": album["url"],
                "lastmod": album["items"][0]["date"],
                "changefreq": "weekly",
                "priority": "0.7",
                "images": [abs_url(i["jpg"]["path"]) for i in album["items"]],
            }
        )
        for item in album["items"]:
            write(OUT / album["slug"] / item["slug"] / "index.html", render_item(item))
            entries.append(
                {
                    "loc": item["url"],
                    "lastmod": item["date"],
                    "changefreq": "monthly",
                    "priority": "0.6",
                    "images": [abs_url(item["jpg"]["path"])],
                }
            )
    ENTRIES.write_text(json.dumps(entries, indent=2) + "\n")
    print(f"built {len(albums)} album(s), {sum(len(a['items']) for a in albums)} photo(s)")

    # Regenerate the sitemap (and blog nav/footer) so the album pages are listed.
    subprocess.run([sys.executable, str(ROOT / "_blog" / "build.py")], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
