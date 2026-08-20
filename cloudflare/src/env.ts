export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SITES: R2Bucket;
  ADMIN_PASSWORD?: string;
  COOKIE_SIGNING_KEY?: string;
  SITE_PATH_PREFIX?: string;
  MAX_FILES?: string;
  MAX_FILE_BYTES?: string;
  MAX_SITE_BYTES?: string;
}
