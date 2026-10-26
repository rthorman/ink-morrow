# Editorial browser fixture

`editorial-story.inkmorrow5` is synthetic test data: the authored Garden After Rain
opening followed by four deterministic garden passages supplied through an injected
fiction transport with no provider network calls. It contains no owner story,
credential, permission or resumable request. Browser tests import it through the
normal authenticated/CSRF-protected save endpoint to exercise real durable chapter
organization across five passages. It is a B4 test fixture, not a pre-B4 preservation
artifact. Genuine pre-B4 schema-25/B3 artifacts live under backend test recovery fixtures.
