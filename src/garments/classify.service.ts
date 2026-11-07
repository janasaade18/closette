import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

const TIMEOUT_MS = 180_000;

@Injectable()
export class ClassifyService {
  private readonly mlBase =
    process.env.CLOSETTE_GARMENT_ML_URL?.replace(/\/$/, '') ||
    'http://127.0.0.1:8090';

  async classify(
    file: Express.Multer.File | undefined,
    query: { include_embedding?: string; include_mask?: string },
  ): Promise<Record<string, unknown>> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload a garment photo as file');
    }

    const params = new URLSearchParams();
    if (query.include_embedding != null) {
      params.set('include_embedding', query.include_embedding);
    }
    if (query.include_mask != null) {
      params.set('include_mask', query.include_mask);
    }
    const suffix = params.toString() ? `?${params}` : '';
    const url = `${this.mlBase}/v1/garments/classify${suffix}`;

    const form = new FormData();
    const bytes = new Uint8Array(file.buffer);
    form.append(
      'image',
      new Blob([bytes], { type: file.mimetype || 'image/jpeg' }),
      file.originalname || 'photo.jpg',
    );

    return this.forward(url, {
      method: 'POST',
      body: form,
    });
  }

  async corrections(
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.forward(`${this.mlBase}/v1/garments/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async forward(
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new BadGatewayException('Garment ML returned invalid JSON');
      }
      if (!response.ok) {
        const message =
          typeof payload.message === 'string'
            ? payload.message
            : `Garment ML failed with ${response.status}`;
        throw new BadGatewayException(message);
      }
      return payload;
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException('Garment classify timed out');
      }
      throw new ServiceUnavailableException(
        `Garment ML is unreachable at ${this.mlBase}. Start uvicorn on that host.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
