# Blog source

Posts live in `_blog/posts/<slug>/`:

- `meta.json` — `title`, `description`, `date` (YYYY-MM-DD), `readMinutes`, `category`, `tags`, `cover` (file in the repo root), optional `modified` and `llmsSummary`
- `body.html` — the article body: plain `<p>`, `<h2>`/`<h3>`, `<ul>`/`<ol>`, `<blockquote>`, `<pre><code>`, `<img>`, `<a>`

To publish a new post:

1. Add the folder above and drop the cover image (16:9, ~1672×941) in the repo root.
2. Run `python3 _blog/build.py`.
3. Commit everything it changed, then push.

The script regenerates the article pages (`<slug>/` and `blog/<slug>/`), the blog index (`blog/index.html`, `blogs.html`), the home-page preview (between the `blog:start`/`blog:end` markers in `index.html`), `sitemap.xml`, `llms.txt` and `llms-full.txt`. Don't edit those by hand.

Categories get their colour from `blog.css` (`[data-cat="…"]`); a new category falls back to the accent green until you add a rule.
