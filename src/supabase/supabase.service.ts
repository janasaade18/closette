import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    this.client = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    ) as SupabaseClient;
  }

  getClient(): SupabaseClient {
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

  publicFootFrameUrl(path: string): string {
    const { data } = this.client.storage
      .from(this.getFootScansBucket())
      .getPublicUrl(path);
    return data.publicUrl;
  }

  getWardrobeImagesBucket(): string {
    return (
      this.configService.get<string>('SUPABASE_WARDROBE_IMAGES_BUCKET') ??
      'wardrobe-images'
    );
  }

  async uploadWardrobeCutout(path: string, buffer: Buffer): Promise<string> {
    const bucket = this.getWardrobeImagesBucket();
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: 'image/png',
        upsert: false,
      });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to store wardrobe cutout: ${error.message}`,
      );
    }

    const { data } = this.client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async insertGarment(
    row: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.client
      .from('garments')
      .insert(row)
      .select()
      .single();

    if (response.error) {
      throw new InternalServerErrorException(
        `Failed to save garment: ${response.error.message}`,
      );
    }
    return response.data as Record<string, unknown>;
  }
}
