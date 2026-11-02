import { el, field, button, option } from "./dom.js";
import { workspaceUrl } from "./workspace-state.js";

export function createListening({
  api,
  dialogs,
  getCurrent,
  getShown,
  onSettled = () => {},
}) {
  let epoch = 0;
  let poll = null;
  let lifetime = 0;
  let preparationTimer = null;
  let monitorVersion = 0;
  let preparation = null;
  let activeAuto = null;
  let selected = null;
  const panel = el("section", "", "fiction-playback");
  panel.id = "fictionPlayback";
  panel.setAttribute("aria-label", "Story listening player");
  panel.hidden = true;
  const label = el("p");
  const audio = el("audio");
  audio.controls = true;
  audio.preload = "metadata";
  const status = el("p");
  status.setAttribute("role", "status");
  const progress = el("p");
  progress.setAttribute("role", "status");
  const cancelPreparation = button("Cancel remaining synthesis", async () => {
    const active = preparation;
    if (!active) return;
    try {
      const data = await api(
        `/fiction/${active.story.id}/listening/jobs/${active.job.id}/cancel`,
        "POST",
        {},
      );
      if (preparation?.job.id === active.job.id)
        monitor(active.story, data.job, false, active.onUpdate);
    } catch {
      progress.textContent =
        "Cancellation could not be confirmed. Check the retained edition before starting another purchase.";
    }
  });
  cancelPreparation.hidden = true;
  const speed = field("Playback speed (free)", "select");
  for (const value of ["0.75", "1", "1.25", "1.5", "2"])
    speed.control.append(option(value, `${value}×`));
  speed.control.value = "1";
  try {
    const saved = localStorage.getItem("im-listening-speed");
    if (["0.75", "1", "1.25", "1.5", "2"].includes(saved))
      speed.control.value = saved;
  } catch {
    /* Device preferences are optional. */
  }
  const back = el("a", "Return to source story");
  const resume = button("Tap to resume", () =>
    audio.play().catch(() => {
      status.textContent =
        "Playback needs another tap or this browser cannot decode this MP3. Downloading the cached file makes no purchase.";
    }),
  );
  panel.append(
    label,
    progress,
    cancelPreparation,
    audio,
    speed.wrapper,
    resume,
    button("Stop playback", () => {
      audio.pause();
      audio.currentTime = 0;
      status.textContent = "Playback stopped. No synthesis request was made.";
    }),
    back,
    status,
  );
  document.querySelector(".fiction-app").append(panel);
  speed.control.addEventListener("change", () => {
    audio.playbackRate = Number(speed.control.value);
    try {
      localStorage.setItem("im-listening-speed", speed.control.value);
    } catch {
      /* Playback remains local even without browser storage. */
    }
  });
  audio.addEventListener("error", () => {
    status.textContent =
      "This browser could not play the cached MP3. Download it or tap to resume; no new synthesis is started.";
  });
  function play(story, job) {
    selected = {
      story_id: story.id,
      branch_id: job.source_branch_id,
      job_id: job.id,
    };
    panel.hidden = false;
    label.textContent = `${story.title} · ${job.kind} · ${job.older_edition ? "older immutable edition" : "selected saved edition"}`;
    back.href = workspaceUrl(story.id, "gallery");
    audio.src = job.download_url;
    audio.playbackRate = Number(speed.control.value);
    status.textContent =
      "Prepared audio. Pause and speed changes are free. Cancel remaining synthesis is a separate action.";
    audio.play().catch(() => {
      status.textContent =
        "Tap to resume the prepared audio. No new purchase is needed.";
    });
  }
  function sync(story) {
    if (
      activeAuto &&
      (story.id !== activeAuto.story_id ||
        story.active_branch_id !== activeAuto.branch_id)
    ) {
      const old = activeAuto;
      activeAuto = null;
      audio.pause();
      api(
        `/fiction/${old.story_id}/listening/jobs/${old.job_id}/cancel`,
        "POST",
        {},
      ).catch(() => {
        status.textContent =
          "Could not confirm cancellation. Review the previous story’s listening edition before starting another run.";
      });
      status.textContent =
        "Auto-read paused because the story or path changed. Review a new source before preparing more.";
    }
    if (selected && story.id !== selected.story_id) audio.pause();
  }
  function clear() {
    epoch++;
    lifetime++;
    clearTimeout(preparationTimer);
    preparation = null;
    progress.textContent = "";
    cancelPreparation.hidden = true;
    clearTimeout(poll);
    poll = null;
    if (selected) audio.pause();
    audio.removeAttribute("src");
    panel.hidden = true;
    label.textContent = "";
    status.textContent = "";
    selected = null;
    activeAuto = null;
  }
  function monitor(story, job, autoplay = false, onUpdate = () => {}) {
    clearTimeout(preparationTimer);
    const ticket = lifetime;
    const version = ++monitorVersion;
    autoplay =
      autoplay || (preparation?.job.id === job.id && preparation.autoplay);
    preparation = { story, job, autoplay, onUpdate };
    panel.hidden = false;
    progress.textContent = `${story.title} · ${job.kind} preparation: ${job.status} · ${job.completed}/${job.total} saved-text segments`;
    cancelPreparation.hidden = !["requested", "running"].includes(job.status);
    onUpdate(job);
    if (["requested", "running"].includes(job.status))
      preparationTimer = setTimeout(async () => {
        try {
          const data = await api(
            `/fiction/${story.id}/listening/jobs/${job.id}`,
          );
          if (ticket === lifetime && version === monitorVersion)
            monitor(story, data.job, autoplay, onUpdate);
        } catch {
          if (ticket === lifetime && version === monitorVersion)
            progress.textContent =
              "Preparation status is unavailable. Refresh retained editions before starting another purchase.";
        }
      }, 1000);
    else {
      preparation = null;
      onSettled(story.id);
      const current = getCurrent();
      if (
        autoplay &&
        job.available &&
        ["read-aloud", "auto-read"].includes(job.kind) &&
        current?.id === story.id &&
        current.active_branch_id === job.source_branch_id
      )
        play(story, job);
    }
  }
  async function open() {
    const story = getCurrent();
    if (!story) return;
    const token = ++epoch;
    clearTimeout(poll);
    const body = el("div");
    const error = el("p");
    error.setAttribute("role", "alert");
    const editions = el("section");
    const alive = () =>
      epoch === token && getCurrent()?.id === story.id && body.isConnected;
    const show = () =>
      dialogs.openDialog({
        title: "Listen to saved fiction",
        body: [body],
        actions: [
          {
            label: "Close",
            className: "btn-secondary",
            onClick: (close) => {
              epoch++;
              clearTimeout(poll);
              close(true);
            },
          },
        ],
      });
    body.append(el("p", "Opening narrator choices and retained editions…"));
    show();
    const describeJob = (job, target) => {
      target.replaceChildren(
        el("h3", `${job.kind} · ${job.status}`),
        el(
          "p",
          `${job.completed}/${job.total} segments · ${job.older_edition ? "older source edition" : "selected path source"} · $${job.spend.known_usd.toFixed(4)} known${job.spend.unknown_attempts ? ` · ${job.spend.unknown_attempts} unknown-cost attempt(s)` : ""}${job.error_code ? " · " + job.error_code : ""}`,
        ),
      );
      if (job.available) {
        target.append(
          button("Play cached edition (free)", () => play(story, job)),
        );
        const link = el("a", "Download MP3 edition");
        link.href = job.download_url;
        link.download = "InkMorrow-listening-edition.mp3";
        target.append(link);
      }
      if (job.status === "succeeded" && !job.available)
        target.append(
          el(
            "p",
            "The edition file is missing. Review a new plan; completed intact segments can be reused for free.",
          ),
        );
      if (["requested", "running"].includes(job.status))
        target.append(
          button("Cancel remaining synthesis", async () => {
            try {
              const result = await api(
                `/fiction/${story.id}/listening/jobs/${job.id}/cancel`,
                "POST",
                {},
              );
              if (alive()) describeJob(result.job, target);
            } catch (issue) {
              if (alive()) error.textContent = issue.message;
            }
          }),
        );
    };
    function follow(job, target, autoplay = false) {
      if (!alive()) return;
      monitor(story, job, autoplay, (value) => {
        if (alive()) describeJob(value, target);
      });
    }
    function review(plan) {
      if (!alive()) return;
      const target = el("section", "", "listening-plan");
      body.append(target);
      target.append(
        el("h3", "Review frozen listening source"),
        el(
          "p",
          `${plan.kind}: ${plan.segments} saved-text segments; ${plan.cached_segments} cached; at most ${plan.maximum_calls} synthesis calls. ${plan.configuration.model} · ${plan.configuration.voice} · MP3.`,
        ),
        el("p", plan.exposure),
        el("p", plan.exclusions),
      );
      if (plan.missing_unreviewed_cache)
        target.append(
          el(
            "p",
            "A reviewed cached segment is missing. Cancel this plan and preview another; it will not be synthesized silently.",
          ),
        );
      target.append(
        button("Cancel this prepared plan", async () => {
          try {
            await api(
              `/fiction/${story.id}/listening/plans/${plan.id}/cancel`,
              "POST",
              {},
            );
            if (alive()) {
              target.replaceChildren(
                el(
                  "p",
                  "Prepared plan cancelled. A delayed original start cannot dispatch synthesis.",
                ),
              );
            }
          } catch (issue) {
            if (alive()) error.textContent = issue.message;
          }
        }),
      );
      if (!plan.missing_unreviewed_cache)
        target.append(
          button(
            plan.purchase_segments
              ? "Review synthesis purchase"
              : "Prepare cached edition (free)",
            async () => {
              try {
                if (plan.purchase_segments) {
                  const approved = await dialogs.confirmPaid({
                    title: "Prepare this saved-text listening edition?",
                    consentScope: "listening:" + plan.id,
                    rememberChoice: true,
                    body: plan.exposure,
                    review: {
                      action: plan.kind,
                      object: story.title,
                      model: `${plan.configuration.model} · ${plan.configuration.voice}`,
                      quantity: `At most ${plan.maximum_calls} segment calls; ${plan.cached_segments} cached segments are free`,
                      sends: "Selected saved narrative prose only",
                      estimate: null,
                      note: "No retry or format fallback. Cancel prevents undispatched segments; a dispatched segment can still be charged. Unknown costs remain visible.",
                    },
                    confirmLabel: "Prepare this audio",
                  });
                  if (!approved || epoch !== token) return;
                  show();
                }
                const result = await api(
                  `/fiction/${story.id}/listening/jobs`,
                  "POST",
                  { plan_id: plan.id, action_key: plan.id },
                );
                if (!alive()) return;
                if (plan.kind === "auto-read")
                  activeAuto = {
                    story_id: story.id,
                    branch_id: plan.branch_id,
                    job_id: result.job.id,
                  };
                await follow(result.job, target, true);
              } catch (issue) {
                if (epoch === token) {
                  show();
                  error.textContent =
                    issue.message +
                    " Refresh retained editions to recover the same action; preparing another plan does not retry this purchase.";
                }
              }
            },
          ),
        );
    }
    const refresh = async () => {
      clearTimeout(poll);
      const data = await api(`/fiction/${story.id}/listening/jobs`);
      if (!alive()) return;
      for (const old of body.querySelectorAll(".listening-plan")) old.remove();
      editions.replaceChildren(
        el("h3", "Recent listening editions (up to 80)"),
      );
      for (const job of data.jobs) {
        const card = el("article", "", "fiction-card");
        if (["requested", "running"].includes(job.status)) follow(job, card);
        else describeJob(job, card);
        editions.append(card);
      }
      for (const plan of data.plans || []) review(plan);
    };
    body.replaceChildren(
      el(
        "p",
        "Only saved narrative prose is spoken. Page turns, playback, Pause, speed changes and cached replay make no AI purchase. Audio does not continue the story.",
      ),
      button("Refresh retained editions", () =>
        refresh().catch((issue) => {
          error.textContent = issue.message;
        }),
      ),
      editions,
      error,
    );
    await refresh().catch((issue) => {
      if (alive()) error.textContent = issue.message;
    });
    try {
      const choices = await api("/fiction/listening/models");
      if (!alive()) return;
      const selectedModel = choices.models.find(
        (model) => model.id === choices.generation.model_id,
      );
      if (!selectedModel || selectedModel.pcm) {
        body.prepend(
          el(
            "p",
            "Choose an MP3-capable Narrator in Settings to prepare new audio. Retained edition playback remains free.",
          ),
        );
        return;
      }
      const voice = field("Narrator voice", "select");
      for (const item of selectedModel.voices)
        voice.control.append(option(item.id, item.label));
      try {
        const saved = JSON.parse(
          localStorage.getItem("im-listening-voice") || "null",
        );
        if (
          saved?.model === selectedModel.id &&
          selectedModel.voices.some((item) => item.id === saved.voice)
        )
          voice.control.value = saved.voice;
      } catch {
        /* Optional narrator preference. */
      }
      voice.control.addEventListener("change", () => {
        try {
          localStorage.setItem(
            "im-listening-voice",
            JSON.stringify({
              model: selectedModel.id,
              voice: voice.control.value,
            }),
          );
        } catch {
          /* Voice selection works for this open task. */
        }
      });
      const kind = field("Listening action", "select");
      for (const [value, title] of [
        ["read-aloud", "Read aloud (up to 16 segments)"],
        ["auto-read", "Auto-read saved text (up to 512 segments)"],
        ["audiobook", "Make audiobook edition (up to 512 segments)"],
      ])
        kind.control.append(option(value, title));
      const range = field("Saved text range", "select");
      range.control.append(
        option("passage", "Viewed passage"),
        option("path", "Selected saved path"),
      );
      try {
        const layout = await api(`/fiction/${story.id}/editorial`);
        if (!alive()) return;
        for (const group of layout.groups || [])
          if (group.count)
            range.control.append(
              option("chapter:" + group.id, "Chapter: " + group.title),
            );
        for (const volume of layout.volumes || [])
          range.control.append(
            option("volume:" + volume.id, "Volume: " + volume.title),
          );
      } catch {
        /* Passage and path remain available. */
      }
      const prepare = button("Preview listening plan (free)", async () => {
        try {
          const [scope, id] = range.control.value.split(":");
          const input = {
            branch_id: story.active_branch_id,
            inspection_at: story.head_beat_id || "initial",
            kind: kind.control.value,
            scope,
            provider_id: choices.generation.provider.id,
            model: selectedModel.id,
            voice: voice.control.value,
            ...(scope === "passage"
              ? { beat_id: getShown() }
              : scope === "chapter"
                ? { chapter_id: id }
                : scope === "volume"
                  ? { volume_id: id }
                  : {}),
          };
          const { plan } = await api(
            `/fiction/${story.id}/listening/plans`,
            "POST",
            input,
          );
          if (alive()) review(plan);
        } catch (issue) {
          if (alive()) error.textContent = issue.message;
        }
      });
      body.prepend(
        el("h3", `Narrator: ${selectedModel.name}`),
        voice.wrapper,
        kind.wrapper,
        range.wrapper,
        prepare,
      );
    } catch (issue) {
      if (alive())
        error.textContent =
          issue.message +
          " Retained edition playback is still available above.";
    }
  }
  return {
    open,
    play,
    sync,
    clear,
    dispose() {
      clear();
      panel.remove();
    },
  };
}
