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

  const experienceDetails = {
    orvel: {
      company: "Orvel",
      role: "Creator & Lead Engineer",
      period: "2026 — Present · Remote",
      logo: "/orvel-logo.png",
      description:
        "Orvel is a local-first platform for creating, teaching, evaluating, and running AI agents. It brings agent configuration, provider-neutral inference, contextual teaching, knowledge, conversations, and repeatable evaluations into one understandable workspace.",
      work: [
        "Designed the product architecture around explicit runtime, knowledge, memory, skills, training, and evaluation boundaries.",
        "Built Orvel Studio for creating agents, configuring providers, chatting, saving corrections, managing knowledge, and running evaluations.",
        "Implemented local and hosted model workflows through Ollama, Groq, and OpenAI without exposing provider keys to the browser.",
      ],
      tags: ["Next.js", "TypeScript", "Agent Runtime", "Local AI", "Evals"],
      url: "https://github.com/orvel-ai/orvel",
      linkLabel: "Orvel",
    },
    prismor: {
      company: "Prismor",
      role: "AI Security Engineer",
      period: "2026 — Present · Remote",
      logo: "/prismor-logo.png",
      description:
        "Prismor builds security infrastructure for AI traffic. I contributed a focused improvement to how applications understand and recover from upstream provider failures.",
      work: [
        "Hardened provider authentication failure handling across buffered and streaming AI responses.",
        "Built automated coverage for proxy error paths and upstream provider failures.",
        "Improved local-backend integration guidance for safer provider configuration.",
      ],
      tags: [
        "Python",
        "AI Gateway Security",
        "HTTP Proxy",
        "Automated Testing",
      ],
      url: "https://prismor.dev",
      linkLabel: "Prismor",
    },
    galen: {
      company: "Galen Africa",
      role: "App Developer / Team Lead",
      period: "2025 — Present · Nigeria",
      logo: "/galen-africa-logo.png",
      description:
        "Galen Africa builds software for pharmacy practice, clinical care, and scientific research. I lead application work across architecture, product direction, integrations, and delivery.",
      work: [
        "Lead development of GalenDesk across application architecture and product direction.",
        "Design database workflows, backend integrations, and offline-first operations.",
        "Own reliability decisions from implementation through delivery.",
      ],
      tags: ["React Native", "Expo", "SQLite", "Node.js", "Product"],
      url: "https://galen.africa",
      linkLabel: "Galen Africa",
    },
    afrigenomed: {
      company: "Afrigenomed",
      role: "Backend Developer",
      period: "2024 — 2026 · Remote",
      logo: "/afrigenomed-logo.jpg",
      description:
        "Afrigenomed works across genomics, digital health, and learning. I developed backend systems and application data flows supporting its learning platform.",
      work: [
        "Built Node.js backend logic for users, content, and learning workflows.",
        "Developed reliable REST APIs and application data flows for an LMS.",
        "Translated product requirements into maintainable backend behavior.",
      ],
      tags: ["Node.js", "Express", "REST APIs", "Databases"],
      url: "https://afrigenomed.com",
      linkLabel: "Afrigenomed",
    },
  };

  const dialog = document.querySelector("#experience-dialog");
  const closeDialog = document.querySelector(".dialog-close");
  const openExperience = (key) => {
    const detail = experienceDetails[key];
    if (!dialog || !detail) return;
    document.querySelector("#dialog-logo").src = detail.logo;
    document.querySelector("#dialog-company").textContent = detail.company;
    document.querySelector("#dialog-role").textContent = detail.role;
    document.querySelector("#dialog-period").textContent = detail.period;
    document.querySelector("#dialog-description").textContent =
      detail.description;
    const work = document.querySelector("#dialog-work");
    work.replaceChildren(
      ...detail.work.map((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      }),
    );
    const tags = document.querySelector("#dialog-tags");
    tags.replaceChildren(
      ...detail.tags.map((item) => {
        const tag = document.createElement("span");
        tag.textContent = item;
        return tag;
      }),
    );
    const link = document.querySelector("#dialog-link");
    link.href = detail.url;
    document.querySelector("#dialog-link-label").textContent = detail.linkLabel;
    dialog.showModal();
  };

  document.querySelectorAll("[data-experience]").forEach((card) => {
    card.addEventListener("click", () =>
      openExperience(card.dataset.experience),
    );
  });
  closeDialog?.addEventListener("click", () => dialog.close());
  dialog?.addEventListener("click", (event) => {
    const bounds = dialog.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });

  const projectToggle = document.querySelector("#toggle-projects");
  const extraProjects = document.querySelectorAll(".project-extra");
  projectToggle?.addEventListener("click", () => {
    const expanded = projectToggle.getAttribute("aria-expanded") === "true";
    extraProjects.forEach((project) => {
      project.hidden = expanded;
    });
    projectToggle.setAttribute("aria-expanded", String(!expanded));
    projectToggle.textContent = expanded ? "View All" : "Show Less";
  });

  const carousel = document.querySelector(".carousel");
  carousel?.addEventListener(
    "wheel",
    (event) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;

      const atStart = carousel.scrollLeft <= 0;
      const atEnd =
        Math.ceil(carousel.scrollLeft + carousel.clientWidth) >=
        carousel.scrollWidth;

      if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;

      event.preventDefault();
      carousel.scrollLeft += delta;
    },
    { passive: false },
  );

  document.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      link.hasAttribute("data-same-tab")
    )
      return;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });

  const views = document.querySelector("#views");
  if (views) views.textContent = "furyengi";
})();
