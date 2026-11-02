import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openUnlocked, apiPost } from "../auth.js";
test.describe("B7 frozen books and retained collection", () => {
  test.beforeEach(async ({ page }) => openUnlocked(page));
  test("private draft survives reload; preview invalidation, local export and Bookshelf require no provider", async ({
    page,
  }, testInfo) => {
    const { story } = await (
      await apiPost(page, "/api/fiction", { scenario_id: "garden-after-rain" })
    ).json();
    let paid = 0;
    await page.route("**/api/fiction/*/replies", async (route) => {
      paid++;
      await route.abort();
    });
    await page.goto(`/#/story/${story.id}/gate`);
    await page
      .getByRole("button", { name: "Make a readable book", exact: true })
      .click();
    await page
      .getByLabel("Author credit", { exact: true })
      .fill("The fixture gardener");
    await expect(page.getByRole("dialog")).toContainText(
      "Private draft saved on the server.",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Make a readable book", exact: true })
      .click();
    await expect(page.getByLabel("Author credit", { exact: true })).toHaveValue(
      "The fixture gardener",
    );
    await page
      .getByRole("button", { name: "Preview readable book", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Reading links are unavailable",
    );
    await page.getByLabel("Book title", { exact: true }).fill("A later garden");
    await expect(
      page.getByRole("button", { name: "Build frozen edition", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Preview readable book", exact: true })
      .click();
    await page.getByLabel("Book format", { exact: true }).selectOption("json");
    await page
      .getByRole("button", { name: "Build frozen edition", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download JSON", exact: true })
      .click();
    const document = JSON.parse(
      readFileSync(await (await download).path(), "utf8"),
    );
    expect(document.metadata).toMatchObject({
      title: "A later garden",
      author: "The fixture gardener",
    });
    await page.screenshot({
      path: testInfo.outputPath("frozen-book.png"),
      fullPage: true,
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.getByRole("button", { name: "Bookshelf", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Bookshelf");
    await expect(page.getByRole("dialog")).toContainText("A later garden");
    await expect(
      page
        .getByRole("dialog")
        .locator("article")
        .filter({ has: page.locator(`a[href*="${story.id}"]`) })
        .filter({ hasText: "A later garden" })
        .getByRole("button", { name: "Download JSON", exact: true }),
    ).toBeVisible();
    expect(paid).toBe(0);
  });
});

test("public reading copy renders frozen text with a header capability and no owner API calls", async ({
  page,
}) => {
  const token = "T".repeat(43);
  let reads = 0,
    ownerReads = 0;
  await page.route("**/api/fiction-reading-copy", async (route) => {
    reads++;
    expect(route.request().headers().authorization).toBe(`Share ${token}`);
    await route.fulfill({
      json: {
        document: {
          metadata: {
            title: "A public garden",
            author: "Fixture author",
            language: "en",
          },
          assets: [],
          front_matter: [],
          back_matter: [],
          volumes: [
            {
              title: "Garden",
              chapters: [
                {
                  title: "After rain",
                  pages: [
                    {
                      blocks: [
                        {
                          type: "paragraph",
                          text: "<script>Never execute</script>",
                        },
                      ],
                    },
                    {
                      blocks: [
                        {
                          type: "paragraph",
                          text: "The open gate stays open.",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
  });
  await page.route("**/api/fiction/**", async (route) => {
    ownerReads++;
    await route.abort();
  });
  await page.goto(`/reading-copy#${token}`);
  await expect(
    page.getByRole("heading", { name: "A public garden", exact: true }),
  ).toBeVisible();
  await expect(page.locator("article")).toContainText(
    "<script>Never execute</script>",
  );
  await expect(page.locator("article script")).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("article")).toContainText(
    "The open gate stays open.",
  );
  expect(reads).toBe(1);
  expect(ownerReads).toBe(0);
});
