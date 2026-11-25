// furyengi.album: photo viewer. Every photo is a normal link to its own page; this only upgrades
// a plain click to an in-page viewer. Modified clicks (new tab etc.) and no-JS keep working.
(() => {
  const links = [...document.querySelectorAll("[data-lightbox] a[data-full]")];
  if (!links.length || typeof HTMLDialogElement === "undefined") return;

  const dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "Photo viewer");
  dialog.innerHTML = `
    <p class="lb-count" aria-live="polite"></p>
    <button class="lb-btn lb-close" type="button" aria-label="Close viewer">×</button>
    <button class="lb-btn lb-prev" type="button" aria-label="Previous photo">‹</button>
    <figure>
      <img alt="" />
      <figcaption><b></b><span></span><a>Open photo page →</a></figcaption>
    </figure>
    <button class="lb-btn lb-next" type="button" aria-label="Next photo">›</button>`;
  document.body.append(dialog);

  const img = dialog.querySelector("img");
  const title = dialog.querySelector("figcaption b");
  const caption = dialog.querySelector("figcaption span");
  const pageLink = dialog.querySelector("figcaption a");
  const count = dialog.querySelector(".lb-count");
  let index = 0;

  const preload = (i) => {
    const a = links[(i + links.length) % links.length];
    if (a) new Image().src = a.dataset.full;
  };

  const show = (i) => {
    index = (i + links.length) % links.length;
    const a = links[index];
    img.src = a.dataset.full;
    img.alt = a.dataset.alt || "";
    title.textContent = a.dataset.title || "";
    caption.textContent = a.dataset.caption || "";
    pageLink.href = a.href;
    pageLink.setAttribute("data-same-tab", "");
    count.textContent = `${index + 1} / ${links.length}`;
    preload(index + 1);
    preload(index - 1);
  };

  links.forEach((a, i) =>
    a.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      show(i);
      dialog.showModal();
    }),
  );

  dialog.querySelector(".lb-close").addEventListener("click", () => dialog.close());
  dialog.querySelector(".lb-prev").addEventListener("click", () => show(index - 1));
  dialog.querySelector(".lb-next").addEventListener("click", () => show(index + 1));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") show(index - 1);
    if (event.key === "ArrowRight") show(index + 1);
  });

  let startX = null;
  dialog.addEventListener("touchstart", (event) => (startX = event.touches[0].clientX), { passive: true });
  dialog.addEventListener("touchend", (event) => {
    if (startX === null) return;
    const dx = event.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 60) show(index + (dx < 0 ? 1 : -1));
  });
})();
