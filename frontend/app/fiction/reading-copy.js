import { el, button } from "./dom.js";
export function renderReadingCopy(root, document) {
  const pages = [
    ...document.front_matter,
    ...document.volumes.flatMap((volume) =>
      volume.chapters.flatMap((chapter) =>
        chapter.pages.map((page, index) => ({
          title: index === 0 ? `${volume.title} · ${chapter.title}` : "",
          blocks: page.blocks,
        })),
      ),
    ),
    ...document.back_matter,
  ];
  let index = 0;
  function show() {
    root.replaceChildren(el("h1", document.metadata.title));
    if (document.metadata.author)
      root.append(el("p", document.metadata.author));
    const page = pages[index];
    const article = el("article");
    if (page?.title) article.append(el("h2", page.title));
    for (const block of page?.blocks || []) {
      if (block.type === "paragraph") article.append(el("p", block.text));
      else if (block.type === "scene_break") article.append(el("hr"));
      else if (block.type === "art") {
        const asset = document.assets.find((a) => a.key === block.asset_key);
        if (asset) {
          const img = el("img");
          img.src = `data:${asset.media_type};base64,${asset.content_base64}`;
          img.alt = block.alt_text || asset.alt_text;
          article.append(img);
        }
      }
    }
    root.append(article);
    const nav = el("nav");
    nav.setAttribute("aria-label", "Reading copy pages");
    const previous = button("Previous", () => {
      index--;
      show();
    });
    previous.disabled = index === 0;
    const next = button("Next", () => {
      index++;
      show();
    });
    next.disabled = index >= pages.length - 1;
    nav.append(previous, el("span", `${index + 1} / ${pages.length}`), next);
    root.append(nav);
  }
  show();
}
const root = document.getElementById("readingCopy");
if (root) {
  const token = location.hash.slice(1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    root.replaceChildren(el("p", "This reading link is unavailable."));
  else
    fetch("/api/fiction-reading-copy", {
      headers: { Authorization: `Share ${token}` },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })
      .then(async (response) => {
        if (!response.ok)
          throw Error(
            "This reading link has expired, was revoked, or is unavailable.",
          );
        return response.json();
      })
      .then((data) => renderReadingCopy(root, data.document))
      .catch((error) => root.replaceChildren(el("p", error.message)));
}
