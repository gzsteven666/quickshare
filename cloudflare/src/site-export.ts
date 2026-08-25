import { ZipWriter } from '@zip.js/zip.js';
import { DeploymentError } from './errors';
import type { FileRecord } from './repositories/sites';

export function createSiteArchive(
  bucket: R2Bucket,
  siteId: string,
  versionId: string,
  files: FileRecord[]
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const output = new WritableStream<Uint8Array>({
        write(chunk) {
          controller.enqueue(chunk);
        },
        close() {
          controller.close();
        },
        abort(reason) {
          controller.error(reason);
        }
      });
      const archive = new ZipWriter(output, { useWebWorkers: false });

      void (async () => {
        try {
          for (const file of files) {
            const object = await bucket.get(`sites/${siteId}/${versionId}/${file.path}`);
            if (!object?.body) {
              throw new DeploymentError('FILE_NOT_FOUND', `已发布文件不存在：${file.path}`);
            }
            await archive.add(file.path, object.body, { useWebWorkers: false });
          }
          await archive.close();
        } catch (error) {
          controller.error(error);
        }
      })();
    }
  });
}
