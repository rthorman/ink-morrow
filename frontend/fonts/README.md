# Bundled fonts

ScribeTribe serves its interface fonts locally so opening a private local manuscript does not make a font request to a third party.

The WOFF2 files are Latin and Latin Extended subsets distributed by the Google Fonts project:

- Cormorant Garamond
- Inter
- Literata
- IBM Plex Mono

Each family is licensed under the SIL Open Font License 1.1. Its upstream license text is stored beside the corresponding font files.

`literata-latin.ttf` is the same Literata Latin subset converted from the
bundled WOFF2 source. Publication PDF jobs embed and subset-map it so readers
do not depend on a system font and text extraction retains Unicode order.
