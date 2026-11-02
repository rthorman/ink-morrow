"use strict";
const { keys, text, fail } = require("./model");
const { blocksOf } = require("../publication/document");
function bookInput(input, fallback = "Untitled story") {
  keys(
    input,
    ["title", "author", "language", "front_matter", "back_matter"],
    "Book details",
  );
  const title =
    input.title === undefined ? fallback : text(input.title, "Book title", 200);
  const author = text(input.author, "Author credit", 300, { optional: true });
  const language =
    input.language === undefined
      ? "en"
      : text(input.language, "Book language", 40);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language))
    fail("Use a language tag such as en or en-GB.");
  function matter(items, label) {
    if (items === undefined) return [];
    if (!Array.isArray(items) || items.length > 8)
      fail(`${label} supports at most eight sections.`);
    return items.map((item) => {
      keys(item, ["title", "text"], label);
      const content = text(item.text, label, 8000, { optional: true });
      return {
        role: "other",
        title: text(item.title, "Section title", 200, { optional: true }),
        blocks: blocksOf(content),
      };
    });
  }
  return {
    metadata: { title, author, language },
    front_matter: matter(input.front_matter, "Front matter"),
    back_matter: matter(input.back_matter, "Back matter"),
  };
}
module.exports = { bookInput };
