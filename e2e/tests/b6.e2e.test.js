import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openUnlocked, apiPost } from "../auth.js";
const silence = readFileSync(
  path.join(__dirname, "../fixtures/synthetic-silence.mp3"),
);
test.describe("B6 listening UI with explicitly synthetic silence", () => {
  test.beforeEach(async ({ page }) => openUnlocked(page));
  test("review saved text, prepare once, replay and change speed without another purchase", async ({
    page,
  }) => {
    const { story } = await (
      await apiPost(page, "/api/fiction", { scenario_id: "garden-after-rain" })
    ).json();
    let starts = 0;
    let narration = 0;
    let prepared = null;
    const job = {
      id: "fixture-audio",
      plan_id: "fixture-plan",
      kind: "read-aloud",
      status: "succeeded",
      completed: 1,
      total: 1,
      spend: { known_usd: 0.01, unknown_attempts: 0 },
      available: true,
      source_branch_id: story.active_branch_id,
      source_head_id: story.head_beat_id,
      source_hash: "a".repeat(64),
      older_edition: false,
      download_url: `/api/fiction/${story.id}/listening/jobs/fixture-audio/file`,
    };
    await page.route("**/api/fiction/*/replies", async (route) => {
      narration++;
      await route.abort();
    });
    await page.route("**/api/fiction/listening/models", (route) =>
      route.fulfill({
        json: {
          models: [
            {
              id: "fixture-speech",
              name: "Synthetic fixture narrator",
              voices: [{ id: "voice", label: "Fixture voice" }],
              pcm: false,
            },
          ],
          generation: {
            provider: { id: "fixture-provider" },
            model_id: "fixture-speech",
          },
        },
      }),
    );
    await page.route("**/api/fiction/*/listening/plans", async (route) => {
      prepared = route.request().postDataJSON();
      await route.fulfill({
        json: {
          plan: {
            id: "fixture-plan",
            branch_id: story.active_branch_id,
            head_id: story.head_beat_id,
            kind: "read-aloud",
            configuration: {
              model: "fixture-speech",
              voice: "voice",
              format: "mp3",
            },
            segments: 1,
            cached_segments: 0,
            purchase_segments: 1,
            maximum_calls: 1,
            exposure:
              "Selected saved narrative prose only. No retry or fallback.",
            exclusions: "Playable saves exclude synthesized audio.",
          },
        },
      });
    });
    await page.route("**/api/fiction/*/listening/jobs", async (route) => {
      if (route.request().method() === "POST") {
        starts++;
        await route.fulfill({ json: { job } });
      } else
        await route.fulfill({ json: { jobs: starts ? [job] : [], plans: [] } });
    });
    await page.route(
      "**/api/fiction/*/listening/jobs/fixture-audio/file",
      (route) => route.fulfill({ contentType: "audio/mpeg", body: silence }),
    );
    await page.goto(`/#/story/${story.id}/desk`);
    await page
      .getByRole("button", { name: "Listen to saved text", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Preview listening plan (free)",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "at most 1 synthesis calls",
    );
    await page
      .getByRole("button", { name: "Review synthesis purchase", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Selected saved narrative prose only",
    );
    await page
      .getByRole("button", { name: "Prepare this audio", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "read-aloud · succeeded",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Story listening player" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("#fictionPlayback audio")
          .evaluate((audio) => audio.readyState),
      )
      .toBeGreaterThan(0);
    await page
      .getByLabel("Playback speed (free)", { exact: true })
      .selectOption("1.5");
    await page
      .getByRole("button", { name: "Stop playback", exact: true })
      .click();
    await page.getByRole("link", { name: "Gallery", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Story listening player" }),
    ).toBeVisible();
    expect(starts).toBe(1);
    expect(narration).toBe(0);
    expect(prepared).toMatchObject({
      branch_id: story.active_branch_id,
      inspection_at: story.head_beat_id,
      scope: "passage",
      beat_id: story.head_beat_id,
    });
    await page.getByRole("button", { name: "Lock", exact: true }).click();
    await expect(page.locator("#fictionPlayback")).toBeHidden();
  });
});
