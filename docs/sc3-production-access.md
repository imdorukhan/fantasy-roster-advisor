# SC3 production read access

The production optimizer reads require an enrolled Yahoo owner session. The gate checks only unexpired session metadata and the owner enrollment marker in the existing production OAuth store. It does not decrypt or refresh tokens. The SC3 data reads use the existing scoped database role and require explicit production opt-in.

For a future authorized release, configure `SC3_PRODUCTION_READS=1`, `SC3_SHARED_DB=1` and a production-scoped `SC3_DATABASE_URL` for the restricted `sc3_app` role. Keep `SC3_ISOLATED` disabled and retain the existing production OAuth variables. Preserve Vercel protection on previews. Do not carry preview Yahoo credentials into production.

Verify with a fresh authenticated owner Chrome session and an independent anonymous client. Check streaming availability, matchup lineup/projection and official Yahoo matchup routes for HTTP 200 in the owner session and HTTP 401 with no data anonymously. Verify `Cache-Control: private, no-store`, the existing Yahoo league refresh, and the absence of unexpected production write routes. Removing the production read opt-in disables the new SC3 routes. The preview-only NBA synchronization route is unchanged.
