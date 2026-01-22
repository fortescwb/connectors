# Instagram fixtures

Current fixtures in this package are **sanitized examples** used for schema and parser tests:

- `message_text.json`
- `message_media.json`
- `batch_mixed.json`

These payloads mirror the Instagram webhook shape but are not real captures. Real, token-free fixtures from staging are still required for:

- DM inbound (text + media) with provider message IDs
- Outbound DM responses from Graph API (per supported type)
- Comment/story interactions (not captured)

Do not commit access tokens or user PII when replacing these placeholders. After capturing real fixtures, update contract tests to point to the new files and remove any synthetic payloads that remain.
