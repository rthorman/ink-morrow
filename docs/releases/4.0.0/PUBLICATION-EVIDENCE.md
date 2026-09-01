# Publication format evidence

Date: 2026-09-01

PR 16 uses the synthetic, non-private publication fixture in
`backend/tests/publication.test.js`. The fixture includes Latin Extended
Unicode, curly punctuation, XML-significant characters, headings, a scene
break, an empty chapter, display-copyedited prose, and selected placed art.

## Automated format evidence

- EPUB starts with the uncompressed `application/epub+zip` mimetype and
  contains the container, OPF 3 package, declared navigation document,
  stylesheet, XHTML reading document, and every selected manifest image.
  The EPUBCheck-compatible package validator rejects missing resources or
  navigation and the semantic re-reader agrees with all other adapters.
- PDF opens independently in `pypdf 6.10.0`, reports the expected page count,
  and extracts `Parser Proof`, author, volume, chapter, and `Café …` prose in
  reading order. The file contains a ToUnicode map, ActualText spans, A4 media
  boxes, the bundled OFL Literata TrueType subset, and selected JPEG image
  objects.
- The multi-format job test builds EPUB, PDF, and TXT from one snapshot digest,
  downloads all three, and compares their semantic reading order. Dedicated
  cancellation and retry fixtures verify that `.partial` files and job stages
  are removed.
- The 3,000-page plain-text fixture remains bounded to semantic output chunks;
  Gate desktop and Mobile Chrome journeys exercise the same snapshot/job APIs.

## Manual-open checkpoint

Microsoft Edge `152.0.4191.53` and Microsoft Word
`16.0.20228.20186` are available on the evidence host. Final visible opens in
mainstream DOCX, ODT, EPUB, and PDF readers remain an explicit PR 18 beta gate;
this record does not claim a manual application/version result that was not
observed. The automated parse and extraction checks above run on every PR 16
change and are release-blocking now.
