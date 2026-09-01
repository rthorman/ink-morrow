# Grok sanitation adapter

Release 4.0 keeps image-provider interoperability separate from ScribeTribe's
own content rules. ScribeTribe does not classify an author's prompt or uploaded
art. The Grok adapter only handles the failure contract of Grok image models.

## Renderable prompts

Scene-prompt condensation remains visible and editable. When the configured
image model is Grok, the art-direction request adds a Grok-specific
renderability instruction: produce one visual prompt, keep people clothed or
safely draped, imply mature material through framing and atmosphere, use
non-graphic aftermath, and request no generated text. A non-Grok model does not
receive this wording.

## Refusal flow

The selected image-provider adapter classifies failures. Grok's HTTP 400
contract is a refusal; a client error from another image provider remains that
provider's ordinary rejection and does not trigger Grok sanitation.

On a Grok refusal:

1. exactly one image request has occurred;
2. no image retry starts;
3. one Scribe sanitation call quotes the bounded provider reason and refused
   prompt as untrusted data;
4. the API returns the reason, editable replacement prompt, sanitation model,
   billed-attempt count, exact sanitation cost, and the number of references
   sent;
5. the dialog displays the refusal and sanitation cost while replacing the
   editable prompt; and
6. generation waits for a new paid action from the owner.

The adapter never promises that a replacement will be accepted. A missing or
invalid sanitation result fails honestly and carries any known sanitation
spend without starting an image request.

## Reference-free retry

When two consecutive refusals occur while identity references were attached,
the dialog offers **Retry without identity references**. It is unchecked by
default. Only checking it makes the next request send `drop_references: true`.
The UI says that references may be contributing; it does not claim they caused
the refusal.

Dropping references affects one provider request only. It does not delete,
rewrite, re-encode, unplace, or change permission or metadata on any uploaded
or generated asset. Changing story or reference selection, creating a fresh
prompt, or completing an image successfully resets refusal state.

## API response

`POST /api/stories/:id/pages/:number/scene-image` returns HTTP 200 for the
announce-and-wait state:

```json
{
  "refused": true,
  "adapter": "grok",
  "reason": "bounded provider reason",
  "sanitized_prompt": "editable replacement",
  "sanitation_cost_usd": 0.0012,
  "sanitation_model": "provider/model",
  "sanitation_billed_attempts": 1,
  "references_sent": 2,
  "can_drop_references": true
}
```

`rewrite_cost_usd` remains as a temporary compatibility alias for
`sanitation_cost_usd`. A non-Grok rejection uses the ordinary error response
and `IMAGE_PROVIDER_REJECTED`; it never returns the Grok refusal shape.
