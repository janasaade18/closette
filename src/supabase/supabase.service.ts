import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: ReturnType<typeof createClient>;

  constructor(private readonly configService: ConfigService) {
    this.client = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  getClient(): ReturnType<typeof createClient> {
    return this.client;
  }

  getFootScansBucket(): string {
    return (
      this.configService.get<string>('SUPABASE_FOOT_SCANS_BUCKET') ??
      'foot-scans'
    );
  }

  async uploadFootFrame(
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const bucket = this.getFootScansBucket();
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to store foot frame: ${error.message}`,
      );
    }

    const { data } = this.client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
}
