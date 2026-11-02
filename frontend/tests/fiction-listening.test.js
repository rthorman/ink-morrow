import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { createListening } from "../app/fiction/listening.js";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("shared listening authority and lifecycle", () => {
  let current, api, dialogs, listening, pause, play, settled;
  const job = {
    id: "job",
    kind: "audiobook",
    status: "running",
    completed: 0,
    total: 2,
    available: false,
    source_branch_id: "path",
    source_head_id: "head",
    spend: { known_usd: 0, unknown_attempts: 1 },
  };
  beforeEach(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: randomUUID,
    });
    document.body.innerHTML =
      '<div class="fiction-app"></div><div id="task"></div>';
    current = { id: "story", title: "A saved story", active_branch_id: "path" };
    pause = jest
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    play = jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    api = jest.fn(async (path, method) => {
      if (path === "/fiction/story/listening/jobs")
        return { jobs: [job], plans: [] };
      if (path.endsWith("/cancel") && method === "POST")
        return { job: { ...job, status: "cancelled" } };
      if (path === "/fiction/listening/models")
        return { models: [], generation: {} };
      return { job };
    });
    dialogs = {
      openDialog: jest.fn((spec) => {
        document.getElementById("task").replaceChildren(...spec.body);
      }),
      confirmPaid: jest.fn(),
    };
    settled = jest.fn();
    listening = createListening({
      api,
      dialogs,
      getCurrent: () => current,
      getShown: () => "head",
      onSettled: settled,
    });
  });
  afterEach(() => {
    listening.dispose();
    jest.restoreAllMocks();
    localStorage.clear();
  });
  test("preparation can be cancelled after closing its dialog without another purchase", async () => {
    await listening.open();
    const spec = dialogs.openDialog.mock.calls.at(-1)[0];
    spec.actions[0].onClick(() =>
      document.getElementById("task").replaceChildren(),
    );
    const player = document.getElementById("fictionPlayback");
    expect(player.hidden).toBe(false);
    [...player.querySelectorAll("button")]
      .find((button) => button.textContent === "Cancel remaining synthesis")
      .click();
    await tick();
    expect(player.textContent).toContain("cancelled");
    expect(api.mock.calls.filter(([, method]) => method === "POST")).toEqual([
      ["/fiction/story/listening/jobs/job/cancel", "POST", {}],
    ]);
    expect(dialogs.confirmPaid).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledWith("story");
  });
  test("a late running-status reply cannot revive a cancelled preparation", async () => {
    jest.useFakeTimers();
    try {
      let finish;
      const original = api.getMockImplementation();
      api.mockImplementation((path, method) =>
        path === "/fiction/story/listening/jobs/job" && !method
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : original(path, method),
      );
      await listening.open();
      jest.advanceTimersByTime(1000);
      expect(finish).toBeTruthy();
      const player = document.getElementById("fictionPlayback");
      [...player.querySelectorAll("button")]
        .find((button) => button.textContent === "Cancel remaining synthesis")
        .click();
      await Promise.resolve();
      await Promise.resolve();
      expect(player.textContent).toContain("cancelled");
      finish({ job });
      await Promise.resolve();
      await Promise.resolve();
      expect(player.textContent).toContain("cancelled");
      expect(player.textContent).not.toContain("preparation: running");
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  test("changing story pauses cached playback and retains its explicit source link for a free return", () => {
    listening.play(current, {
      ...job,
      status: "succeeded",
      available: true,
      download_url: "/cached.mp3",
    });
    current = { id: "other", active_branch_id: "other-path" };
    listening.sync(current);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(api).not.toHaveBeenCalled();
    expect(
      document.querySelector("#fictionPlayback a").getAttribute("href"),
    ).toContain("/story/story/gallery");
  });
  test("Lock clears source text and stops the active preparation monitor", async () => {
    await listening.open();
    listening.clear();
    const player = document.getElementById("fictionPlayback");
    expect(player.hidden).toBe(true);
    expect(player.textContent).not.toContain("A saved story");
    expect(player.querySelector("audio").getAttribute("src")).toBeNull();
    expect(dialogs.confirmPaid).not.toHaveBeenCalled();
  });
});
