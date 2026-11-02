import { el, button, field, option } from "./dom.js";
import { createPrivateDraft } from "./private-drafts.js";
import { downloadFile } from "./media.js";
import { workspaceUrl } from "./workspace-state.js";
export function createBookStudio({ api, dialogs, getCurrent, playAudio }) {
  let generation = 0,
    timer = null;
  const drafts = new Set();
  const safe = async (work, target) => {
    try {
      await work();
    } catch (error) {
      target.textContent = error.message;
    }
  };
  function open() {
    const story = getCurrent();
    if (!story) return;
    const ticket = ++generation;
    clearTimeout(timer);
    const live = () => ticket === generation && getCurrent()?.id === story.id;
    const query = new URLSearchParams(location.hash.split("?")[1] || "");
    const branch = query.get("branch") || story.active_branch_id;
    const head =
      query.get("at") ||
      (branch === story.active_branch_id ? story.head_beat_id : undefined);
    const source = {
      branch_id: branch,
      ...(head ? { inspection_at: head } : {}),
    };
    const note = el(
      "p",
      `Selected path: ${story.branches.find((b) => b.id === branch)?.name || branch}. ${head ? "At the selected history moment." : "At its latest saved moment."} Preview freezes this source without activating it.`,
    );
    const fields = {};
    for (const [key, label, type, value, max] of [
      ["title", "Book title", "input", story.title, 200],
      ["author", "Author credit", "input", "", 300],
      ["language", "Book language", "input", "en", 40],
      ["front_title", "Front matter heading", "input", "Dedication", 200],
      ["front_text", "Front matter", "textarea", "", 8000],
      ["back_title", "Back matter heading", "input", "Afterword", 200],
      ["back_text", "Back matter", "textarea", "", 8000],
    ])
      fields[key] = field(label, type, value, { maxLength: max });
    const error = el("p");
    error.setAttribute("role", "alert");
    const draftStatus = el("p");
    const previewRoot = el("section"),
      retained = el("section");
    let edition = null,
      actionKey = null,
      metadataRevision = 0;
    const draft = createPrivateDraft({
      api,
      onChange: (state) => {
        if (live()) draftStatus.textContent = state?.message || "";
      },
    });
    drafts.add(draft);
    const form = () =>
      Object.fromEntries(
        Object.entries(fields).map(([name, item]) => [
          name,
          item.control.value,
        ]),
      );
    const leave = () => {
      if (ticket === generation) {
        generation++;
        clearTimeout(timer);
      }
      draft
        .flush()
        .catch(() => {})
        .finally(() => {
          draft.close();
          drafts.delete(draft);
        });
    };
    const sourceLinks = el("nav");
    for (const [room, label] of [
      ["desk", "Review selected prose and grouping"],
      ["gallery", "Review source art / missing images"],
    ]) {
      const link = el("a", label);
      link.href =
        workspaceUrl(story.id, room) +
        "?" +
        new URLSearchParams({ branch, ...(head ? { at: head } : {}) });
      link.addEventListener("click", () => {
        leave();
        dialogs.close(true);
      });
      sourceLinks.append(link);
    }
    note.append(sourceLinks);
    const fill = (value) => {
      for (const [name, item] of Object.entries(fields))
        if (value[name] !== undefined) item.control.value = value[name];
    };
    for (const item of Object.values(fields))
      item.control.addEventListener("input", () => {
        metadataRevision++;
        edition = null;
        actionKey = null;
        previewRoot.replaceChildren(
          el(
            "p",
            "Details changed. Preview again before building or sharing. Earlier editions remain in Bookshelf.",
          ),
        );
        draft.edit({ form: form() });
      });
    const formats = field("Book format", "select");
    formats.control.append(
      ...["epub", "pdf", "html", "docx", "odt", "rtf", "md", "txt", "json"].map(
        (id) => option(id, id.toUpperCase()),
      ),
    );
    formats.control.multiple = true;
    formats.control.size = 5;
    formats.control.value = "epub";
    formats.wrapper.append(
      el(
        "p",
        "Choose one or several formats. Select all for the complete set.",
      ),
    );
    formats.wrapper.append(
      button("Select all formats", () => {
        for (const item of formats.control.options) item.selected = true;
        actionKey = null;
      }),
    );
    formats.control.addEventListener("change", () => {
      actionKey = null;
    });
    async function jobView(job) {
      if (!live()) return;
      const box = el("div");
      box.append(
        el(
          "p",
          `Build: ${job.status}${job.older_edition ? " · older edition" : ""}${job.error_code ? " · " + job.error_code : ""}`,
        ),
      );
      for (const output of job.outputs) {
        if (output.available)
          box.append(
            button(`Download ${output.format.toUpperCase()}`, () =>
              safe(
                () =>
                  downloadFile(
                    output.download_url,
                    `InkMorrow-book.${output.format}`,
                    live,
                  ),
                error,
              ),
            ),
          );
        else
          box.append(
            el(
              "p",
              `${output.format.toUpperCase()}: ${output.status === "ready" ? "file unavailable; explicitly build again" : output.error_code || output.status}`,
            ),
          );
      }
      if (["requested", "running"].includes(job.status))
        box.append(
          button("Cancel remaining rendering", () =>
            safe(async () => {
              const data = await api(
                `/fiction/${story.id}/editions/jobs/${job.id}/cancel`,
                "POST",
                {},
              );
              await jobView(data.job);
            }, error),
          ),
        );
      previewRoot.querySelector("[data-book-job]")?.remove();
      box.dataset.bookJob = "true";
      previewRoot.append(box);
      if (["requested", "running"].includes(job.status)) {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            safe(async () => {
              const data = await api(
                `/fiction/${story.id}/editions/jobs/${job.id}`,
              );
              if (live()) await jobView(data.job);
            }, error),
          600,
        );
      }
    }
    async function showEdition(value) {
      if (!live()) return;
      edition = value;
      actionKey = null;
      previewRoot.replaceChildren(
        el("h3", value.metadata.title),
        el(
          "p",
          `${value.chapter_count} chapters · ${value.page_count} passages · ${value.art.length} images${value.older_edition ? " · older edition" : ""}`,
        ),
        el("p", value.exclusions),
      );
      for (const [label, sections] of [
        ["Front matter", value.front_matter || []],
        ["Back matter", value.back_matter || []],
      ]) {
        if (sections.length) previewRoot.append(el("h4", label));
        for (const section of sections) {
          previewRoot.append(el("h5", section.title));
          for (const block of section.blocks)
            if (block.type === "paragraph")
              previewRoot.append(el("p", block.text));
        }
      }
      const contents = el("ol");
      for (const chapter of value.contents)
        contents.append(
          el(
            "li",
            `${chapter.volume_title} · ${chapter.title} (${chapter.pages})`,
          ),
        );
      previewRoot.append(contents);
      let next = value.next_offset;
      const more = button("More contents", () =>
        safe(async () => {
          const data = await api(
            `/fiction/${story.id}/editions/${value.id}?offset=${next}`,
          );
          if (!live()) return;
          for (const chapter of data.edition.contents)
            contents.append(
              el(
                "li",
                `${chapter.volume_title} · ${chapter.title} (${chapter.pages})`,
              ),
            );
          next = data.edition.next_offset;
          more.hidden = next === null;
        }, error),
      );
      more.hidden = next === null;
      previewRoot.append(more);
      for (const text of value.sample)
        previewRoot.append(el("blockquote", text));
      const art = el("details");
      art.append(el("summary", "Included cover and placed art"));
      for (const asset of value.art) {
        const img = el("img");
        img.src = asset.preview_url;
        img.alt = asset.alt_text;
        img.loading = "lazy";
        img.style.maxWidth = "240px";
        art.append(img);
      }
      previewRoot.append(art);
      const build = button(
        "Build frozen edition",
        () =>
          safe(async () => {
            if (edition?.id !== value.id)
              throw Error("Preview the changed details first.");
            actionKey ||= crypto.randomUUID();
            const selected = [...formats.control.selectedOptions].map(
              (item) => item.value,
            );
            if (!selected.length) throw Error("Choose at least one format.");
            const data = await api(
              `/fiction/${story.id}/editions/jobs`,
              "POST",
              {
                snapshot_id: value.id,
                formats: selected,
                action_key: actionKey,
              },
            );
            if (live()) await jobView(data.job);
          }, error),
        "btn btn-primary",
      );
      previewRoot.append(formats.wrapper, build);
      if (!value.sharing_available)
        previewRoot.append(
          el(
            "p",
            "Reading links are unavailable on this installation. Local export works independently.",
          ),
        );
      else {
        const days = field("Reading link expires in", "select");
        for (const n of [1, 7, 30, 90])
          days.control.append(option(n, `${n} days`));
        days.control.value = "7";
        const links = el("div");
        const refresh = async () => {
          const data = await api(`/fiction/${story.id}/editions/${value.id}`);
          if (!live()) return;
          links.replaceChildren();
          for (const link of data.shares) {
            const line = el("p", `${link.status} · expires ${link.expires_at}`);
            if (link.status === "active")
              line.append(
                button("Revoke link", () =>
                  safe(async () => {
                    await api(
                      `/fiction/${story.id}/editions/${value.id}/shares/${link.id}/revoke`,
                      "POST",
                      {},
                    );
                    await refresh();
                  }, error),
                ),
              );
            links.append(line);
          }
        };
        previewRoot.append(
          el("h4", "Share this exact preview"),
          el(
            "p",
            "Anyone with a reading link can read this frozen prose and included art. Revocation cannot retract downloaded copies. Previously issued URLs cannot be recovered; create a new link if needed.",
          ),
          days.wrapper,
          button("Create reading link", () =>
            safe(async () => {
              if (edition?.id !== value.id)
                throw Error("Preview the changed details first.");
              const data = await api(
                `/fiction/${story.id}/editions/${value.id}/shares`,
                "POST",
                { expires_in_days: Number(days.control.value) },
              );
              if (!live()) return;
              const url = field(
                "Reading link (select and copy if clipboard is unavailable)",
                "input",
                data.share.url,
                { readOnly: true },
              );
              previewRoot.append(
                url.wrapper,
                button("Copy reading link", () =>
                  safe(async () => {
                    try {
                      await navigator.clipboard.writeText(data.share.url);
                    } catch {
                      url.control.focus();
                      url.control.select();
                      error.textContent = "Select and copy the link above.";
                    }
                  }, error),
                ),
              );
              await refresh();
            }, error),
          ),
          links,
        );
        await refresh();
      }
    }
    const freeze = button(
      "Preview readable book",
      () =>
        safe(async () => {
          const revision = metadataRevision;
          const values = form();
          const matter = (prefix) =>
            values[`${prefix}_text`].trim()
              ? [
                  {
                    title: values[`${prefix}_title`],
                    text: values[`${prefix}_text`],
                  },
                ]
              : [];
          draft.edit({ form: values });
          await draft.flush();
          const data = await api(`/fiction/${story.id}/editions`, "POST", {
            ...source,
            metadata: {
              title: values.title,
              author: values.author,
              language: values.language,
              front_matter: matter("front"),
              back_matter: matter("back"),
            },
          });
          if (live() && revision === metadataRevision)
            await showEdition(data.edition);
        }, error),
      "btn btn-primary",
    );
    dialogs.openDialog({
      title: "Make a readable book",
      body: [
        note,
        ...Object.values(fields).map((f) => f.wrapper),
        draftStatus,
        freeze,
        error,
        previewRoot,
        retained,
      ],
      onFreeClose: leave,
      actions: [
        {
          label: "Close",
          className: "btn-secondary",
          onClick: (close) => {
            leave();
            close(true);
          },
        },
      ],
    });
    safe(async () => {
      const meta = await api(
        `/fiction/${story.id}/workspace?${new URLSearchParams(source)}`,
      );
      if (!live()) return;
      source.inspection_at = meta.inspection_head_id || "initial";
      const content = await draft.open(
        {
          type: "local-reference",
          game_id: story.id,
          branch_id: branch,
          head_id: meta.inspection_head_id,
          kind: "publication",
          subject_id: null,
          base_revision: null,
        },
        { form: form() },
      );
      if (live() && content && !draft.state?.dirty) fill(content.form);
      const data = await api(`/fiction/${story.id}/editions`);
      if (!live()) return;
      retained.append(
        el("h3", "Retained editions"),
        button("Open Bookshelf", () => {
          leave();
          bookshelf();
        }),
      );
      for (const value of data.editions)
        retained.append(
          button(
            `${value.metadata.title}${value.older_edition ? " · older edition" : ""}`,
            () =>
              safe(async () => {
                const detail = await api(
                  `/fiction/${story.id}/editions/${value.id}`,
                );
                if (live()) {
                  await showEdition(detail.edition);
                  if (detail.jobs[0]) await jobView(detail.jobs[0]);
                }
              }, error),
          ),
        );
    }, error);
  }
  function bookshelf() {
    const ticket = ++generation;
    clearTimeout(timer);
    const root = el("section"),
      error = el("p");
    error.setAttribute("role", "alert");
    const filter = field("Bookshelf contents", "select");
    for (const [id, label] of [
      ["all", "Everything"],
      ["book", "Books"],
      ["audio", "Audio"],
      ["art", "Art"],
    ])
      filter.control.append(option(id, label));
    let offset = 0;
    const live = () => generation === ticket;
    async function load() {
      const data = await api(
        `/fiction/bookshelf?kind=${filter.control.value}&offset=${offset}`,
      );
      if (!live()) return;
      root.replaceChildren();
      if (!data.items.length)
        root.append(el("p", "No retained items in this view."));
      for (const item of data.items) {
        const card = el("article");
        card.append(
          el("h3", `${item.title || item.story_title} · ${item.kind}`),
          el(
            "p",
            `${item.story_title}${item.older_edition ? " · older frozen source" : ""}`,
          ),
        );
        const link = el("a", "Open story");
        link.addEventListener("click", () => {
          generation++;
          dialogs.close(true);
        });
        link.href = workspaceUrl(
          item.game_id,
          item.kind === "art" ? "gallery" : "gate",
        );
        card.append(link);
        if (item.kind === "book") {
          card.append(el("p", item.status));
          for (const job of item.jobs)
            for (const output of job.outputs)
              if (output.available)
                card.append(
                  button(`Download ${output.format.toUpperCase()}`, () =>
                    safe(
                      () =>
                        downloadFile(
                          output.download_url,
                          `InkMorrow-book.${output.format}`,
                          live,
                        ),
                      error,
                    ),
                  ),
                );
              else
                card.append(
                  el(
                    "p",
                    `${output.format.toUpperCase()}: ${output.status === "ready" ? "file unavailable; reopen the retained edition and explicitly build again" : output.error_code || output.status}`,
                  ),
                );
          card.append(
            button("Remove retained edition", () =>
              safe(async () => {
                const yes = await dialogs.confirmDestructive({
                  title: "Remove this edition?",
                  body: "Its reading links will stop working. Downloaded copies and the source story remain. Unshared rendered files will be removed.",
                  confirmLabel: "Remove edition",
                });
                if (!yes) return;
                await api(
                  `/fiction/${item.game_id}/editions/${item.id}/remove`,
                  "POST",
                  {},
                );
                bookshelf();
              }, error),
            ),
          );
        } else if (item.kind === "audio") {
          card.append(
            el(
              "p",
              `${item.audio.status}${item.audio.available ? "" : " · audio unavailable"}`,
            ),
          );
          if (item.audio.available)
            card.append(
              button("Play prepared audio", () =>
                playAudio(
                  { id: item.game_id, title: item.story_title },
                  item.audio,
                ),
              ),
              button("Download MP3", () =>
                safe(
                  () =>
                    downloadFile(
                      item.audio.download_url,
                      "InkMorrow-audio.mp3",
                      live,
                    ),
                  error,
                ),
              ),
            );
        } else {
          card.append(el("p", item.privacy));
          const image = el("img");
          image.src = item.preview_url;
          image.alt = item.title;
          image.loading = "lazy";
          image.style.maxWidth = "200px";
          card.append(
            image,
            button("Download image", () =>
              safe(
                () =>
                  downloadFile(item.preview_url, "InkMorrow-art.webp", live),
                error,
              ),
            ),
          );
        }
        root.append(card);
      }
      const nav = el("nav");
      if (offset)
        nav.append(
          button("Previous items", () => {
            offset = Math.max(0, offset - 20);
            safe(load, error);
          }),
        );
      if (data.next_offset !== null)
        nav.append(
          button("Next items", () => {
            offset = data.next_offset;
            safe(load, error);
          }),
        );
      root.append(nav);
    }
    filter.control.addEventListener("change", () => {
      offset = 0;
      safe(load, error);
    });
    dialogs.openDialog({
      title: "Bookshelf",
      body: [
        el(
          "p",
          "Retained books, audio and owner-only art. Opening this view never starts rendering or buys synthesis.",
        ),
        filter.wrapper,
        error,
        root,
      ],
      actions: [
        {
          label: "Close",
          className: "btn-secondary",
          onClick: (close) => {
            generation++;
            close(true);
          },
        },
      ],
    });
    safe(load, error);
  }
  return {
    open,
    bookshelf,
    clear() {
      generation++;
      clearTimeout(timer);
      for (const draft of drafts) draft.close();
      drafts.clear();
    },
  };
}
