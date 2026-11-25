import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Thin HTTP client to the existing Muse process. No ranking logic lives here. */

export type MuseRecommendResult = {
  status: string;
  recommendation_id: string;
  recommendations: Array<{
    outfit_id: string;
    items: string[];
    roles: Record<string, string>;
    score: number;
    reasons: string[];
    reason_codes?: string[];
    signals_used?: string[];
    model_version?: string;
    mixed?: boolean;
    marketplace_items?: Array<Record<string, unknown>>;
  }>;
  ranking?: Record<string, unknown>;
  marketplace_suggestions?: Array<Record<string, unknown>>;
  weather?: Record<string, unknown>;
  message?: string;
  error?: string;
  model_version?: string;
};

export type MuseTravelResult = {
  status: string;
  day_plans?: Array<Record<string, unknown>>;
  packing_list?: Array<Record<string, unknown>>;
  marketplace_suggestions?: Array<Record<string, unknown>>;
  message?: string;
  error?: string;
  model_version?: string;
};

@Injectable()
export class MuseHttpClient {
  private readonly logger = new Logger(MuseHttpClient.name);

  constructor(private readonly config: ConfigService) {}

  baseUrl(): string {
    return (
      this.config.get<string>('MUSE_URL')?.trim().replace(/\/$/, '') ||
      'http://127.0.0.1:8787'
    );
  }

  async recommend(body: Record<string, unknown>): Promise<MuseRecommendResult> {
    return this.postJson<MuseRecommendResult>('/v1/outfits/recommend', body);
  }

  async feedback(
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.postJson<Record<string, unknown>>('/v1/outfits/feedback', body);
  }

  async travelPack(body: Record<string, unknown>): Promise<MuseTravelResult> {
    return this.postJson<MuseTravelResult>('/v1/travel/pack', body);
  }

  async health(): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl()}/health`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(`Muse health failed: ${String(error)}`);
      throw new ServiceUnavailableException(
        `Cannot reach Muse at ${url}. Start: node api/server.js --port 8787`,
      );
    }
  }

  private async postJson<T extends { error?: string; message?: string }>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      this.logger.warn(`Muse ${path} unreachable: ${String(error)}`);
      throw new ServiceUnavailableException(
        `Cannot reach Muse at ${url}. Keep Muse running on :8787.`,
      );
    }
    const json = (await response.json()) as T;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        json.message ??
          json.error ??
          `Muse ${path} failed (${response.status})`,
      );
    }
    return json;
  }
}
