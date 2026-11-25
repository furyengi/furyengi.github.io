# Album

The photo album at `furyengi.cv/album/`. Each photo gets its own page (that is what Google indexes), each album has a
grid page, and `/album/` is the hub. Pages, resized images, structured data and sitemap entries are generated.

## Add photos

1. Put the photo in `_album/albums/<album-slug>/` (a new folder makes a new album; an album with no photos is not published).
   Use a descriptive file name, e.g. `lagos-conference-stage.jpg`, not `IMG_0231.jpg`.
2. Add it to that folder's `album.json` (copy an existing item):
   - `file`, `slug` (the URL), `title`, `date` (YYYY-MM-DD)
   - `alt`: **required**, one plain sentence saying what is in the picture
   - `caption`: a sentence or two for the photo page (this text is what Google reads around the image)
   - `tags`: a few words
3. Run:
   ```
   python3 _album/build.py     # resizes images, writes pages, updates sitemap.xml
   python3 _album/audit.py     # must say OK: checks alt text, links, sitemap, and that no photo carries metadata
   ```
4. Commit everything it changed and push. Then in Search Console: URL inspection → paste the new photo page → Request indexing.

## Privacy: read this before adding real photos

The published copies are re-encoded from pixels only, so GPS, camera and date metadata are dropped (the audit fails if any
slips through). **But the original you drop in `_album/albums/` is committed to this public repo with its metadata intact.**
That is fine for screenshots. For real photos, use the private inbox repo (phase 2) so originals never land here,
or remove location data on your phone before committing (Gallery → share → remove location).

Only publish photos you took or have the right to publish, and be careful with photos of other people.

## Files

| Path | What it is |
| ---- | ---------- |
| `_album/albums/<album>/album.json` + photos | the source |
| `_album/build.py` | generator |
| `_album/audit.py` | checks the output |
| `_album/manifest.json`, `_album/entries.json` | build bookkeeping (manifest avoids re-encoding unchanged photos; entries feed the sitemap) |
| `album/` | generated site (commit it) |
| `album.css`, `album.js` | styles and the photo viewer |

`python3 _album/build.py --force` re-encodes every image.
