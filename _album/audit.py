#!/usr/bin/env python3
"""Check the generated album for SEO and privacy problems. Exits non-zero on any failure.

  python3 _album/audit.py

Checks: every <img> has alt/src/width/height and its file exists; one <h1>; canonical and meta description;
JSON-LD parses; internal links resolve; every photo page is linked from its album and the hub; the sitemap
lists every album page and every image; and no published image carries EXIF/XMP/ICC metadata (GPS, camera, dates).
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ALBUM = ROOT / "album"
SITE = "https://furyengi.cv"
PRIVATE_KEYS = ("exif", "xmp", "icc_profile", "comment", "XML:com.adobe.xmp")

failures = []


def fail(where, message):
    failures.append(f"{where}: {message}")


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.imgs, self.links, self.h1 = [], [], 0
        self.canonical = self.description = self.title = None
        self.jsonld, self._in_ld, self._in_title, self._buf = [], False, False, ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "img":
            self.imgs.append(a)
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "h1":
            self.h1 += 1
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        elif tag == "meta" and a.get("name") == "description":
            self.description = a.get("content")
        elif tag == "script" and a.get("type") == "application/ld+json":
            self._in_ld, self._buf = True, ""
        elif tag == "title":
            self._in_title, self.title = True, ""

    def handle_endtag(self, tag):
        if tag == "script" and self._in_ld:
            self._in_ld = False
            self.jsonld.append(self._buf)
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_ld:
            self._buf += data
        elif self._in_title:
            self.title += data


def to_file(url):
    """Map a site URL or root-relative path to a file in the repo; None if it is not ours."""
    if url.startswith(SITE):
        url = url[len(SITE):]
    elif url.startswith("http") or url.startswith("mailto:") or url.startswith("#"):
        return None
    path = url.split("#")[0].split("?")[0]
    target = ROOT / path.lstrip("/")
    return target / "index.html" if path.endswith("/") else target


def audit_pages():
    pages = sorted(ALBUM.rglob("index.html"))
    if not pages:
        fail("album", "no pages found; run _album/build.py")
    for f in pages:
        rel = f.relative_to(ROOT)
        p = Page()
        p.feed(f.read_text(encoding="utf-8"))
        if p.h1 != 1:
            fail(rel, f"expected exactly one <h1>, found {p.h1}")
        if not p.title or len(p.title) > 90:
            fail(rel, f"title missing or too long ({len(p.title or '')} chars)")
        if not p.description:
            fail(rel, "missing meta description")
        expected = f"{SITE}/{f.parent.relative_to(ROOT)}/".replace("//album", "/album")
        if p.canonical != expected:
            fail(rel, f"canonical is {p.canonical!r}, expected {expected!r}")
        for raw in p.jsonld:
            try:
                json.loads(raw)
            except ValueError as error:
                fail(rel, f"invalid JSON-LD: {error}")
        if not p.jsonld:
            fail(rel, "no JSON-LD")
        for img in p.imgs:
            where = f"{rel} <img {img.get('src', '?')}>"
            if not (img.get("alt") or "").strip():
                fail(where, "missing or empty alt text")
            if not img.get("src"):
                fail(where, "missing src")
            elif (t := to_file(img["src"])) is not None and not t.exists():
                fail(where, "src file does not exist")
            if not (img.get("width") and img.get("height")):
                fail(where, "missing width/height (causes layout shift)")
            for part in (img.get("srcset") or "").split(","):
                url = part.strip().split(" ")[0]
                if url and (t := to_file(url)) is not None and not t.exists():
                    fail(where, f"srcset file does not exist: {url}")
        for href in p.links:
            t = to_file(href)
            if t is not None and not t.exists():
                fail(rel, f"broken link {href}")
    return pages


def audit_links(pages):
    hub = (ALBUM / "index.html").read_text(encoding="utf-8")
    for f in pages:
        parts = f.relative_to(ALBUM).parts
        if len(parts) == 3:  # album/<album>/<photo>/index.html
            album_page = (ALBUM / parts[0] / "index.html").read_text(encoding="utf-8")
            url = f"{SITE}/album/{parts[0]}/{parts[1]}/"
            if url not in album_page:
                fail(f.relative_to(ROOT), "photo page is not linked from its album page")
            if url not in hub and f"/album/{parts[0]}/" not in hub:
                fail(f.relative_to(ROOT), "photo page is unreachable from the hub")


def audit_images():
    count = 0
    for f in list(ALBUM.rglob("*.webp")) + list(ALBUM.rglob("*.jpg")):
        count += 1
        with Image.open(f) as im:
            leaked = [k for k in PRIVATE_KEYS if k in im.info]
            if leaked or len(im.getexif()):
                fail(f.relative_to(ROOT), f"carries metadata: {leaked or 'EXIF tags'}")
    return count


def audit_sources():
    """Source photos are committed to the public repo, so they must not carry EXIF/GPS/XMP either."""
    src = ROOT / "_album" / "albums"
    count = 0
    for f in sorted(src.rglob("*")) if src.exists() else []:
        if f.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".gif"):
            continue
        count += 1
        try:
            with Image.open(f) as im:
                leaked = [k for k in ("exif", "xmp", "XML:com.adobe.xmp") if k in im.info]
                if leaked or len(im.getexif()):
                    fail(f.relative_to(ROOT), f"source photo carries metadata ({leaked or 'EXIF tags'}); "
                                              "publish originals through the private album-inbox, not directly")
        except OSError as error:
            fail(f.relative_to(ROOT), f"cannot read image: {error}")
    return count


def audit_sitemap():
    sm = ROOT / "sitemap.xml"
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "i": "http://www.google.com/schemas/sitemap-image/1.1"}
    try:
        tree = ET.parse(sm)
    except ET.ParseError as error:
        fail("sitemap.xml", f"not valid XML: {error}")
        return
    urls = {u.findtext("s:loc", namespaces=ns): [i.findtext("i:loc", namespaces=ns) for i in u.findall("i:image", ns)] for u in tree.getroot().findall("s:url", ns)}
    for f in ALBUM.rglob("index.html"):
        url = f"{SITE}/{f.parent.relative_to(ROOT)}/"
        if url not in urls:
            fail("sitemap.xml", f"missing {url}")
    for loc, images in urls.items():
        for image in images:
            t = to_file(image)
            if t is None or not t.exists():
                fail("sitemap.xml", f"{loc} lists an image that does not exist: {image}")
    return sum(len(v) for v in urls.values())


def main():
    pages = audit_pages()
    audit_links(pages)
    images = audit_images()
    sources = audit_sources()
    sitemap_images = audit_sitemap()
    if failures:
        print(f"FAILED ({len(failures)} problem{'s' if len(failures) != 1 else ''}):")
        for line in failures:
            print(" -", line)
        sys.exit(1)
    print(f"OK: {len(pages)} pages, {images} published images + {sources} source photos (no metadata), {sitemap_images} sitemap images")


if __name__ == "__main__":
    main()
