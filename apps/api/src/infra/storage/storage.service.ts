import { Global, Inject, Injectable, Module } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ApiEnv } from '@arenacore/shared';
import { API_ENV } from '../../config/config.module.js';

export interface StoredObject {
  contentType: string | undefined;
  sizeBytes: number | undefined;
}

/** S3-compatible object storage for evidence and assets (s3mock locally, S3 in production). */
@Injectable()
export class StorageService {
  private readonly client: S3Client;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: !!env.S3_ENDPOINT,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
  }

  get evidenceBucket(): string {
    return this.env.S3_EVIDENCE_BUCKET;
  }

  /** Short-lived URL the browser PUTs the file to; the content type is part of the signature. */
  presignUpload(
    bucket: string,
    key: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: 300 },
    );
  }

  presignDownload(bucket: string, key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 300,
    });
  }

  async head(bucket: string, key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { contentType: res.ContentType, sizeBytes: res.ContentLength };
    } catch {
      return null;
    }
  }

  /** Reads the first bytes so uploads can be checked against their declared type. */
  async readPrefix(bucket: string, key: string, bytes = 16): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    const chunk = await res.Body!.transformToByteArray();
    return Buffer.from(chunk);
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
