// furyengi.blog index: tag filter + search. Runs only where [data-post-list] exists.
(() => {
  const list = document.querySelector("[data-post-list]");
  if (!list) return;

  const posts = [...list.querySelectorAll("[data-post]")];
  const chips = [...document.querySelectorAll("[data-filter]")];
  const input = document.querySelector("[data-search]");
  const status = document.querySelector("[data-status]");
  const empty = document.querySelector("[data-empty]");
  const params = new URLSearchParams(location.search);

  let category = params.get("topic") || "all";
  let query = (params.get("q") || "").trim().toLowerCase();
  if (!chips.some((chip) => chip.dataset.filter === category)) category = "all";
  if (input) input.value = params.get("q") || "";

  const apply = () => {
    let shown = 0;
    posts.forEach((post) => {
      const matchesTopic = category === "all" || post.dataset.cat === category;
      const matchesQuery = !query || post.dataset.search.includes(query);
      const visible = matchesTopic && matchesQuery;
      post.hidden = !visible;
      if (visible) shown += 1;
    });

    chips.forEach((chip) =>
      chip.setAttribute("aria-pressed", String(chip.dataset.filter === category)),
    );
    if (empty) empty.hidden = shown > 0;
    if (status) {
      const filtering = category !== "all" || query;
      status.textContent = filtering
        ? `${shown} of ${posts.length} posts`
        : `${posts.length} posts`;
    }

    const next = new URLSearchParams();
    if (category !== "all") next.set("topic", category);
    if (query) next.set("q", input.value.trim());
    const search = next.toString();
    history.replaceState(null, "", location.pathname + (search ? `?${search}` : ""));
  };

  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      category = chip.dataset.filter;
      apply();
    }),
  );
  input?.addEventListener("input", () => {
    query = input.value.trim().toLowerCase();
    apply();
  });

  apply();
})();
