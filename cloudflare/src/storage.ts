export async function deleteSiteObjects(bucket: R2Bucket, siteId: string): Promise<number> {
  const prefix = `sites/${siteId}/`;
  let cursor: string | undefined;
  let deletedObjects = 0;

  do {
    const page = await bucket.list({ prefix, limit: 1000, cursor });
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) {
      await bucket.delete(keys);
      deletedObjects += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return deletedObjects;
}
