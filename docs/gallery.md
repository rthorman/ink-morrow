# Gallery

Gallery is the manuscript workspace for normalized uploaded and AI-generated
art. It is an asset collection and placement editor, not an image editor or a
second manuscript reader.

## Two equal paths

**Upload an image** opens the device's native picker, shows a local blob
preview, and collects optional title, alt text, initial placement, and local
provider-reference permission. The server validates file structure, encoding,
size, pixels, dimensions, and decoder integrity, then retains a metadata-free
WebP derivative. It does not classify subject matter and makes no AI request.

**Paint with AI** begins from a selected committed page. The existing paid
prompt-condensation review produces visible editable text; a separate paid
painting review names what will cross the provider boundary. A successful
painting may be saved Gallery-only or placed after its stable source page.

## Collection and provenance

Uploaded and generated images share one responsive card grid. Each card shows
source, dimensions, retained format and size, normalization/metadata status,
and placement state. Generated art also shows provider profile/model, recorded
painting cost, and the count of resolved references retained with the result.

Title and alt text are owner-editable. A placed image with empty alt text shows
a publication warning; private Gallery storage and editing are not blocked.

## Placements and lifecycle

An asset may remain Gallery-only, appear before the first prose page, or appear
after a stable page ID. Moving, adding, or removing a placement never changes
page numbers, revisions, continuity, prepared prose, or remembered canon.
Unplace retains the asset. Delete removes its normalized derivative and all of
its placements after an explicit destructive review. Download serves only the
normalized derivative.

## Provider references and refusals

Permission to use one image as a provider reference is local, per asset, and
off by default. Permission alone sends nothing: the owner must separately
select the permitted asset for the next painting. The server resolves only
ready, permitted IDs. Imports reset permission rather than carrying consent to
another installation.

Grok-specific refusal recovery is reused unchanged. A refusal paints nothing,
shows the provider reason and billed sanitation result, places the editable
replacement in the prompt box, and waits for another deliberate Paint action.
Reference removal is offered only as an explicit retry choice after repeated
reference-bearing refusals. Existing uploaded and generated originals are
never rewritten by refusal handling.
