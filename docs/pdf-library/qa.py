"""Render and inspect the committed Ink Morrow PDF library.

Requires Python 3, pypdf, Pillow, and Poppler's pdftoppm on PATH.
Writes page PNGs and overview contact sheets beneath the chosen output root.
"""

from __future__ import annotations

import argparse
import math
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfReader


OLD_BRAND = re.compile("scribe" + ".?" + "tribe", re.IGNORECASE)


def pdfs(repo: Path) -> list[Path]:
    return sorted((repo / "docs" / "pdf").glob("*.pdf")) + [
        repo / "docs" / "user-guide" / "Ink-Morrow-4.0-User-Guide.pdf"
    ]


def rasterize(pdf: Path, target: Path, dpi: int) -> list[Path]:
    target.mkdir(parents=True, exist_ok=True)
    command = shutil.which("pdftoppm")
    if not command:
        raise SystemExit("pdftoppm was not found on PATH; install Poppler first")
    subprocess.run(
        [command, "-png", "-r", str(dpi), str(pdf), str(target / "page")],
        check=True,
    )
    return sorted(target.glob("page-*.png"))


def contact_sheet(pages: list[Path], output: Path) -> None:
    thumbnails: list[Image.Image] = []
    for number, page in enumerate(pages, 1):
        image = Image.open(page).convert("RGB")
        image.thumbnail((250, 354))
        tile = Image.new("RGB", (270, 388), "#241128")
        tile.paste(image, ((270 - image.width) // 2, 8))
        ImageDraw.Draw(tile).text((10, 366), str(number), fill="#f0d69a")
        thumbnails.append(tile)
    columns = 5
    rows = math.ceil(len(thumbnails) / columns)
    sheet = Image.new("RGB", (columns * 270, rows * 388), "#120816")
    for index, image in enumerate(thumbnails):
        sheet.paste(image, ((index % columns) * 270, (index // columns) * 388))
    sheet.save(output, quality=88)


def inspect(pdf: Path) -> tuple[int, int]:
    reader = PdfReader(pdf)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    if not text.strip():
        raise ValueError(f"{pdf.name}: no extractable text")
    if "\ufffd" in text:
        raise ValueError(f"{pdf.name}: replacement character in extracted text")
    if OLD_BRAND.search(text):
        raise ValueError(f"{pdf.name}: old-brand residue in extracted text")
    if not reader.outline:
        raise ValueError(f"{pdf.name}: document outline/bookmarks are empty")
    return len(reader.pages), len(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, default=Path("output/pdf-qa"))
    parser.add_argument("--dpi", type=int, default=90)
    args = parser.parse_args()
    repo = args.repo.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    for pdf in pdfs(repo):
        page_count, text_count = inspect(pdf)
        pages = rasterize(pdf, output / pdf.stem, args.dpi)
        if len(pages) != page_count:
            raise ValueError(f"{pdf.name}: raster count {len(pages)} != PDF count {page_count}")
        contact_sheet(pages, output / f"{pdf.stem}-overview.jpg")
        print(f"{pdf.name}: {page_count} pages, {text_count} text characters, outline OK")


if __name__ == "__main__":
    main()
