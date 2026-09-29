(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector("#theme-toggle");
  const activity = document.querySelector("#activity");
  const months = document.querySelector("#activity-months");
  const total = document.querySelector("#contribution-total");

  root.dataset.theme =
    localStorage.getItem("furyengi-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  themeButton?.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("furyengi-theme", root.dataset.theme);
  });

  const drawGraph = (contributions = []) => {
    if (!activity || !months) return;

    const byDate = new Map(contributions.map((day) => [day.date, day]));
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(end.getDate() - 52 * 7 - end.getDay());
    activity.replaceChildren();
    months.replaceChildren();

    let previousMonth = -1;
    let contributionCount = 0;
    for (let index = 0; index < 371; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
      const day = byDate.get(key);
      const count = day?.count || 0;
      const level = day?.level || 0;
      const square = document.createElement("i");
      square.dataset.level = String(level);
      square.title = `${count} contribution${count === 1 ? "" : "s"} on ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      square.setAttribute("aria-label", square.title);
      activity.appendChild(square);
      contributionCount += count;

      if (date.getMonth() !== previousMonth && date.getDate() <= 7) {
        const label = document.createElement("span");
        label.textContent = date.toLocaleDateString("en-US", {
          month: "short",
        });
        label.style.left = `${Math.floor(index / 7) * 11}px`;
        months.appendChild(label);
        previousMonth = date.getMonth();
      }
    }

    if (total)
      total.textContent = `${contributionCount.toLocaleString()} contributions in the last year`;
  };

  if (activity) {
    fetch("https://github-contributions-api.jogruber.de/v4/furyengi?y=last")
      .then((response) => {
        if (!response.ok) throw new Error("GitHub activity unavailable");
        return response.json();
      })
      .then((data) => drawGraph(data.contributions))
      .catch(() => {
        drawGraph();
        if (total) total.textContent = "GitHub activity overview";
      });
  }

  const views = document.querySelector("#views");
  if (views) views.textContent = "furyengi";
})();
