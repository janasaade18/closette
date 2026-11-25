import { Injectable, Logger } from '@nestjs/common';

export type WeatherSnapshot = {
  temperature_c?: number;
  condition?: string;
  source: 'open-meteo' | 'unavailable';
  location?: string;
  reason?: string;
  latitude?: number;
  longitude?: number;
};

/** Progressive name candidates — long reverse-geocode strings often miss. */
function geocodeQueryCandidates(raw: string): string[] {
  const query = raw.trim();
  if (!query) return [];
  const parts = query
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  const push = (value: string) => {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 2 && !out.includes(cleaned)) out.push(cleaned);
  };
  push(query);
  if (parts[0]) push(parts[0]);
  if (parts.length >= 2) push(`${parts[0]} ${parts[parts.length - 1]}`);
  if (parts.length >= 2) push(`${parts[0]}, ${parts[parts.length - 1]}`);
  for (const part of parts) {
    if (!/governorate|district|province|region/i.test(part)) push(part);
  }
  return out;
}

/** Open-Meteo lookup for the agent. Never invents temperature or condition. */
@Injectable()
export class WeatherClient {
  private readonly logger = new Logger(WeatherClient.name);

  async lookup(input: {
    location?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<WeatherSnapshot> {
    let latitude = input.latitude;
    let longitude = input.longitude;
    let place = input.location?.trim();

    if ((latitude == null || longitude == null) && place && place.length >= 2) {
      const geo = await this.geocode(place);
      if (geo) {
        latitude = geo.latitude;
        longitude = geo.longitude;
        place = geo.name;
      }
    }

    if (latitude == null || longitude == null) {
      return {
        source: 'unavailable',
        location: place?.split(',')[0]?.trim() || place,
        reason: place
          ? `Could not geocode “${place.split(',')[0]?.trim() || place}”.`
          : 'No location on profile.',
      };
    }

    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(latitude));
      url.searchParams.set('longitude', String(longitude));
      url.searchParams.set('current', 'temperature_2m,weather_code');
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        return {
          source: 'unavailable',
          location: place,
          latitude,
          longitude,
          reason: `Weather HTTP ${response.status}`,
        };
      }
      const json = (await response.json()) as {
        current?: { temperature_2m?: number; weather_code?: number };
      };
      const temperature_c = json.current?.temperature_2m;
      if (
        typeof temperature_c !== 'number' ||
        !Number.isFinite(temperature_c)
      ) {
        return {
          source: 'unavailable',
          location: place,
          latitude,
          longitude,
          reason: 'No current temperature from Open-Meteo.',
        };
      }
      const condition = weatherCodeToCondition(json.current?.weather_code);
      return {
        temperature_c: Math.round(temperature_c),
        ...(condition ? { condition } : {}),
        source: 'open-meteo',
        location: place?.split(',')[0]?.trim() || place,
        latitude,
        longitude,
      };
    } catch (error) {
      this.logger.warn(`Weather lookup failed: ${String(error)}`);
      return {
        source: 'unavailable',
        location: place,
        latitude,
        longitude,
        reason: 'Weather lookup failed.',
      };
    }
  }

  private async geocode(name: string) {
    const candidates = geocodeQueryCandidates(name);
    const regionHints = candidates.slice(1).map((part) => part.toLowerCase());

    for (const candidate of candidates) {
      try {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.searchParams.set('name', candidate);
        url.searchParams.set('count', '8');
        const response = await fetch(url, {
          signal: AbortSignal.timeout(8_000),
        });
        const json = (await response.json()) as {
          results?: Array<{
            name?: string;
            latitude?: number;
            longitude?: number;
            admin1?: string;
            country?: string;
            country_code?: string;
          }>;
        };
        const rows = json.results ?? [];
        if (!rows.length) continue;
        const needle = candidate.toLowerCase();
        const ranked = [...rows].sort((a, b) => {
          const score = (row: (typeof rows)[number]) => {
            let s = 0;
            const n = row.name?.toLowerCase() ?? '';
            const country = row.country?.toLowerCase() ?? '';
            const code = row.country_code?.toLowerCase() ?? '';
            const admin = row.admin1?.toLowerCase() ?? '';
            if (n === needle) s += 40;
            else if (n.includes(needle.split(/\s+/)[0] ?? needle)) s += 15;
            for (const hint of regionHints) {
              if (hint.length < 2) continue;
              if (country === hint || code === hint) s += 50;
              else if (country.includes(hint) || hint.includes(country))
                s += 30;
              if (admin.includes(hint)) s += 10;
            }
            return s;
          };
          return score(b) - score(a);
        });
        const hit = ranked[0];
        if (!hit || hit.latitude == null || hit.longitude == null) continue;
        return {
          name: hit.name?.trim() || candidate,
          latitude: hit.latitude,
          longitude: hit.longitude,
        };
      } catch {
        // try next candidate
      }
    }
    return null;
  }
}

function weatherCodeToCondition(code: number | undefined): string | undefined {
  if (code == null) return undefined;
  if (code === 0 || code === 1 || code === 2) return 'clear';
  if (code === 3 || code === 45 || code === 48) return 'cloudy';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'rain';
  return 'clear';
}
