import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { createBookStudio } from "../app/fiction/book-studio.js";
import { renderReadingCopy } from "../app/fiction/reading-copy.js";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("frozen book workspace authority", () => {
  let studio, api, dialogs, story, edition;
  const click = (text) =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent === text)
      .click();
  beforeEach(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: randomUUID,
    });
    document.body.innerHTML = '<main id="task"></main>';
    location.hash = "#/fiction/story/gate?branch=other&at=older";
    story = {
      id: "story",
      title: "Current title",
      active_branch_id: "active",
      head_beat_id: "latest",
      branches: [{ id: "other", name: "Quiet fork" }],
    };
    edition = {
      id: "edition",
      metadata: { title: "Frozen title" },
      chapter_count: 1,
      page_count: 1,
      art: [],
      contents: [{ volume_title: "I", title: "Garden", pages: 1 }],
      next_offset: null,
      sample: ["Original prose"],
      exclusions: "No private records",
      formats: ["txt"],
      sharing_available: false,
    };
    api = jest.fn(async (path, method, body) => {
      if (path.startsWith("/fiction/drafts?")) return { draft: null };
      if (path === "/fiction/drafts" && method === "POST")
        return { draft: { id: "draft", revision: 0, content: body.content } };
      if (path === "/fiction/drafts/draft")
        return { draft: { id: "draft", revision: 1, content: body.content } };
      if (path.includes("/workspace?")) return { inspection_head_id: "older" };
      if (path === "/fiction/story/editions" && method === "POST")
        return { edition };
      if (path === "/fiction/story/editions") return { editions: [] };
      if (path.endsWith("/jobs"))
        return { job: { id: "job", status: "succeeded", outputs: [] } };
      if (path.startsWith("/fiction/bookshelf"))
        return { items: [], next_offset: null };
      throw Error(path);
    });
    dialogs = {
      openDialog: jest.fn((spec) =>
        document.getElementById("task").replaceChildren(...spec.body),
      ),
      confirmDestructive: jest.fn(),
    };
    studio = createBookStudio({
      api,
      dialogs,
      getCurrent: () => story,
      playAudio: jest.fn(),
    });
  });
  afterEach(() => {
    studio.clear();
    location.hash = "";
  });
  test("viewed branch is frozen without activation; edits require another preview", async () => {
    studio.open();
    await tick();
    await tick();
    click("Preview readable book");
    await tick();
    await tick();
    const freeze = api.mock.calls.find(
      ([path, method]) =>
        path === "/fiction/story/editions" && method === "POST",
    );
    expect(freeze[2]).toMatchObject({
      branch_id: "other",
      inspection_at: "older",
      metadata: { title: "Current title" },
    });
    expect(document.body.textContent).toContain(
      "Reading links are unavailable",
    );
    click("Build frozen edition");
    await tick();
    expect(
      api.mock.calls.filter(([p, m]) => p.endsWith("/jobs") && m === "POST"),
    ).toHaveLength(1);
    const title = [...document.querySelectorAll("input")][0];
    title.value = "Changed title";
    title.dispatchEvent(new Event("input"));
    expect(document.body.textContent).toContain("Preview again");
    expect(
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Build frozen edition",
      ),
    ).toBe(false);
    expect(api.mock.calls.some(([p]) => p.endsWith("/branch"))).toBe(false);
  });
  test("Bookshelf loads only its bounded collection and starts no work", async () => {
    studio.bookshelf();
    await tick();
    expect(api.mock.calls).toEqual([["/fiction/bookshelf?kind=all&offset=0"]]);
    expect(document.body.textContent).toContain("No retained items");
  });
  test("reading links need explicit creation and retain a manual copy fallback", async () => {
    edition.sharing_available = true;
    const original = api.getMockImplementation();
    const url = "https://reader.invalid/reading-copy#" + "T".repeat(43);
    api.mockImplementation(async (path, method, body) => {
      if (path === "/fiction/story/editions/edition")
        return {
          shares: [{ id: "link", status: "active", expires_at: "2026-11-09" }],
        };
      if (path.endsWith("/shares")) return { share: { url, id: "link" } };
      if (path.endsWith("/revoke")) return { revoked: true };
      return original(path, method, body);
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: jest.fn().mockRejectedValue(Error("Clipboard unavailable")),
      },
    });
    studio.open();
    await tick();
    await tick();
    click("Preview readable book");
    await tick();
    await tick();
    expect(
      api.mock.calls.some(([p, m]) => p.endsWith("/shares") && m === "POST"),
    ).toBe(false);
    click("Create reading link");
    await tick();
    click("Copy reading link");
    await tick();
    expect(document.body.textContent).toContain(
      "Select and copy the link above.",
    );
    const input = [...document.querySelectorAll("input")].find(
      (item) => item.value === url,
    );
    expect(input.selectionEnd - input.selectionStart).toBe(url.length);
    click("Revoke link");
    await tick();
    expect(api).toHaveBeenCalledWith(
      "/fiction/story/editions/edition/shares/link/revoke",
      "POST",
      {},
    );
  });
  test("public reader treats text as text and pages through frozen prose", () => {
    const root = document.getElementById("task");
    renderReadingCopy(root, {
      metadata: { title: "<img src=x onerror=alert(1)>" },
      assets: [],
      front_matter: [],
      back_matter: [],
      volumes: [
        {
          title: "Volume",
          chapters: [
            {
              title: "Chapter",
              pages: [
                {
                  blocks: [
                    {
                      type: "paragraph",
                      text: "<script>privateAttack()</script>",
                    },
                  ],
                },
                {
                  blocks: [{ type: "paragraph", text: "The garden remains." }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<script>");
    click("Next");
    expect(root.textContent).toContain("The garden remains.");
    expect(root.textContent).not.toContain("privateAttack");
  });
});
