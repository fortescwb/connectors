# @connectors/adapter-express (deprecated)

Deprecated compatibility adapter for Express. Use `core-runtime` webhook handlers directly and capture raw request body in the app as needed.

Status:
- Removal planned for v1.0.0
- Only retained so existing apps can use `rawBodyMiddleware`/`RawBodyRequest` without breaking changes

Do not add new dependencies on this package; migrate to `core-runtime`-first flows instead.
