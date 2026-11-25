import { MuseHttpClient, MuseRecommendResult } from './muse-http.client';
import { garmentLabel, mergeMemoryFacts } from './muse-reply.util';
import { WeatherClient } from './weather.client';

/** Gemini function declarations — full stylist surface; executors call Closette/Muse only. */

export const AGENT_TOOL_DECLARATIONS = [
  {
    name: 'get_wardrobe_snapshot',
    description:
      'List the user Closette wardrobe garments available in this session (ids, categories, colors, formality). Use before styling advice or compatibility questions. Never invent garments.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            'Optional filter: tops, bottoms, outerwear, footwear, one-piece, accessories',
        },
      },
    },
  },
  {
    name: 'get_profile_snapshot',
    description:
      'Read Closette style preferences for this user (gender, preferred styles/colors/garment types).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_weather',
    description:
      'Fetch live weather. Omit location to use the user home city from the session. Only pass location when the user explicitly named a different city for a trip. Never invent famous cities.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description:
            'Only a city the user just named (trip/destination). Leave empty for home weather.',
        },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
      },
    },
  },
  {
    name: 'recommend_outfits',
    description:
      'REQUIRED source of outfits. Calls Closette Muse recommend (MLP ranker + LinUCB + hard rules + optional marketplace gap-fill). Never invent outfit item ids.',
    parameters: {
      type: 'object',
      properties: {
        occasion: {
          type: 'string',
          description:
            'casual | smart-casual | work | formal | wedding | or short label',
        },
        season: {
          type: 'string',
          description: 'spring | summer | fall | winter',
        },
        temperature_c: { type: 'number' },
        condition: {
          type: 'string',
          description: 'clear | cloudy | rain | snow | cold | …',
        },
        limit: { type: 'integer', description: '1–6 candidate outfits' },
        prefer_another: {
          type: 'boolean',
          description: 'Avoid garments from the last shown outfit',
        },
        enable_marketplace: {
          type: 'boolean',
          description:
            'Allow Muse closet-first marketplace gap-fill when products are available',
        },
        notes: {
          type: 'string',
          description: 'Short styling intent for logging',
        },
      },
    },
  },
  {
    name: 'plan_travel_pack',
    description:
      'Multi-day travel packing via Closette Muse travel pack (Phase 4). Provide destination and trip days with optional per-day occasion/weather.',
    parameters: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        days: {
          type: 'array',
          description: 'Trip days',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'YYYY-MM-DD' },
              label: { type: 'string' },
              occasion: { type: 'string' },
              temperature_c: { type: 'number' },
              condition: { type: 'string' },
            },
            required: ['date'],
          },
        },
        max_items: { type: 'integer' },
        enable_marketplace: { type: 'boolean' },
      },
      required: ['days'],
    },
  },
  {
    name: 'submit_outfit_feedback',
    description:
      'Send feedback to Muse for LinUCB personalization. Use Muse recommendation_id and outfit_id from a prior recommend_outfits result.',
    parameters: {
      type: 'object',
      properties: {
        recommendation_id: { type: 'string' },
        outfit_id: { type: 'string' },
        action: {
          type: 'string',
          description: 'like | save | dislike | dismiss | worn | purchase',
        },
        note: { type: 'string' },
      },
      required: ['recommendation_id', 'outfit_id', 'action'],
    },
  },
  {
    name: 'remember_about_user',
    description:
      'Save lasting stylist memory about this user (likes, dislikes, fit, occasions, sizing, brands). Use when they share a preference that should survive future chats.',
    parameters: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          description:
            'Short durable facts, e.g. "prefers sneakers over heels"',
          items: { type: 'string' },
        },
        summary: {
          type: 'string',
          description: 'Optional one-line updated memory summary',
        },
      },
      required: ['facts'],
    },
  },
  {
    name: 'set_home_location',
    description:
      'Save the user home city for live weather. Call whenever they name the city they are in (e.g. Beirut, Paris). Then call get_weather with no location arg.',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'City or place name the user stated',
        },
      },
      required: ['city'],
    },
  },
] as const;

export type AgentSession = {
  userId: string;
  wardrobe: Record<string, unknown>[];
  profile?: Record<string, unknown>;
  context: Record<string, unknown>;
  marketplaceProducts?: Record<string, unknown>[];
  location?: string;
  latitude?: number;
  longitude?: number;
  /** Latest user utterance — used to allow travel-city weather overrides. */
  latestUserMessage?: string;
  memorySummary?: string;
  memoryFacts?: string[];
  lastRecommend?: MuseRecommendResult;
  lastOutfit?: MuseRecommendResult['recommendations'][number];
};

export type ToolExecution = {
  name: string;
  response: Record<string, unknown>;
  outfitPayload?: {
    recommendationId: string;
    outfit: MuseRecommendResult['recommendations'][number];
    title: string;
    score: number;
  };
  travel?: Record<string, unknown>;
  contextPatch?: Record<string, unknown>;
  memoryPatch?: {
    summary?: string;
    facts?: string[];
  };
  homeLocation?: string;
};

/** Safe string for unknown wardrobe / tool fields (avoids "[object Object]"). */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

export async function executeAgentTool(input: {
  name: string;
  args: Record<string, unknown>;
  session: AgentSession;
  muse: MuseHttpClient;
  weather: WeatherClient;
}): Promise<ToolExecution> {
  const { name, args, session, muse, weather } = input;

  switch (name) {
    case 'get_wardrobe_snapshot': {
      const category =
        typeof args.category === 'string' ? args.category.toLowerCase() : null;
      const rows = session.wardrobe
        .filter((item) => {
          if (!category) return true;
          return asText(item.category).toLowerCase() === category;
        })
        .slice(0, 80)
        .map((item, index) => ({
          ref: `G${index + 1}`,
          label: garmentLabel(item),
          category: item.category,
          subcategory: item.subcategory,
          colors: item.colors,
          formality: item.formality,
          pattern: item.pattern,
          // Internal only — never repeat to the user.
          _id: item.id,
        }));
      return {
        name,
        response: {
          count: rows.length,
          garments: rows,
          note: 'Speak using label only (e.g. "black coat"). Never show _id, UUIDs, or refs to the user.',
        },
      };
    }
    case 'get_profile_snapshot':
      return {
        name,
        response: {
          profile: session.profile ?? {},
          context: {
            occasion: session.context.occasion,
            occasionLabel: session.context.occasionLabel,
            weather: session.context.weather,
            scheduleLabel: session.context.scheduleLabel,
          },
          location: session.location ?? null,
          memory: {
            summary: session.memorySummary ?? '',
            facts: session.memoryFacts ?? [],
          },
        },
      };
    case 'remember_about_user': {
      const rawFacts = Array.isArray(args.facts) ? args.facts : [];
      const facts = mergeMemoryFacts(
        session.memoryFacts,
        rawFacts.filter((item): item is string => typeof item === 'string'),
      );
      const summary =
        typeof args.summary === 'string' && args.summary.trim()
          ? args.summary.trim().slice(0, 500)
          : session.memorySummary;
      session.memoryFacts = facts;
      if (summary) session.memorySummary = summary;
      return {
        name,
        response: {
          ok: true,
          saved: facts.length,
          summary: session.memorySummary ?? '',
          facts,
        },
        memoryPatch: {
          summary: session.memorySummary,
          facts,
        },
      };
    }
    case 'set_home_location': {
      const city =
        typeof args.city === 'string' ? args.city.trim().slice(0, 120) : '';
      if (city.length < 2) {
        return {
          name,
          response: {
            ok: false,
            error: 'Provide a real city name from the user.',
          },
        };
      }
      const snapshot = await weather.lookup({ location: city });
      if (snapshot.source !== 'open-meteo' || snapshot.temperature_c == null) {
        return {
          name,
          response: {
            ok: false,
            error:
              snapshot.reason ??
              `Could not verify “${city}” for live weather. Ask them to rephrase the city.`,
            tried: city,
          },
        };
      }
      const resolved = snapshot.location?.trim() || city;
      session.location = resolved;
      session.memoryFacts = mergeMemoryFacts(session.memoryFacts, [
        `home city: ${resolved}`,
      ]);
      return {
        name,
        response: {
          ok: true,
          location: resolved,
          weather: {
            temperature_c: snapshot.temperature_c,
            condition: snapshot.condition,
            source: snapshot.source,
          },
          note: 'Home city saved for this user. Use this weather; do not ask for the city again.',
        },
        homeLocation: resolved,
        contextPatch: {
          location: resolved,
          weather: {
            temperature_c: snapshot.temperature_c,
            ...(snapshot.condition ? { condition: snapshot.condition } : {}),
          },
        },
        memoryPatch: {
          summary: session.memorySummary,
          facts: session.memoryFacts,
        },
      };
    }
    case 'get_weather': {
      const requested =
        typeof args.location === 'string' ? args.location.trim() : '';
      const place = resolveWeatherPlace(requested, session);
      const snapshot = await weather.lookup({
        location: place,
        latitude: typeof args.latitude === 'number' ? args.latitude : undefined,
        longitude:
          typeof args.longitude === 'number' ? args.longitude : undefined,
      });
      if (snapshot.location && snapshot.source === 'open-meteo' && !requested) {
        session.location = snapshot.location;
      }
      const weatherPatch =
        snapshot.source === 'open-meteo' &&
        typeof snapshot.temperature_c === 'number'
          ? {
              temperature_c: snapshot.temperature_c,
              ...(snapshot.condition ? { condition: snapshot.condition } : {}),
            }
          : undefined;
      return {
        name,
        response: {
          ...snapshot,
          home_location: session.location ?? null,
          used_location: place ?? snapshot.location ?? null,
          note:
            snapshot.source === 'open-meteo'
              ? 'Live weather — do not invent different temps or cities.'
              : 'Live weather unavailable — do not invent rain/sun; ask the user or style without claiming current weather.',
        },
        contextPatch: weatherPatch
          ? {
              location: session.location ?? place,
              weather: weatherPatch,
            }
          : { location: session.location ?? place },
      };
    }
    case 'recommend_outfits': {
      if (!session.wardrobe.length) {
        return {
          name,
          response: {
            ok: false,
            status: 'empty_wardrobe',
            message: 'Closet is empty in this session.',
          },
        };
      }
      const preferAnother = Boolean(args.prefer_another);
      const avoided = new Set<string>([
        ...asStringArray(session.context.avoidedGarmentIds),
        ...(preferAnother
          ? asStringArray(session.context.lastOutfitItemIds)
          : []),
      ]);
      const weatherCtx =
        typeof session.context.weather === 'object' && session.context.weather
          ? (session.context.weather as Record<string, unknown>)
          : {};
      // Prefer grounded session weather over model-invented temps/cities.
      const temperature_c =
        typeof weatherCtx.temperature_c === 'number'
          ? weatherCtx.temperature_c
          : typeof args.temperature_c === 'number'
            ? args.temperature_c
            : undefined;
      const condition =
        typeof weatherCtx.condition === 'string'
          ? weatherCtx.condition
          : typeof args.condition === 'string'
            ? args.condition
            : undefined;
      const enableMarket =
        args.enable_marketplace === true &&
        Boolean(session.marketplaceProducts?.length);

      const body: Record<string, unknown> = {
        user_id: session.userId,
        wardrobe: session.wardrobe,
        occasion:
          typeof args.occasion === 'string'
            ? args.occasion
            : (session.context.occasion ?? 'smart-casual'),
        season: typeof args.season === 'string' ? args.season : undefined,
        weather: {
          ...(typeof temperature_c === 'number' ? { temperature_c } : {}),
          ...(condition ? { condition } : {}),
        },
        limit: clampInt(Number(args.limit ?? 4), 1, 6),
        profile: session.profile,
        preferences_override: {
          ...(session.profile ?? {}),
          avoid_garment_ids: [...avoided],
        },
        personalization: 'linucb',
        marketplace: {
          enabled: enableMarket,
          include_mixed: enableMarket,
          max_products: 48,
        },
      };
      if (enableMarket && session.marketplaceProducts?.length) {
        body.marketplace_products = session.marketplaceProducts;
      }

      const result = await muse.recommend(body);
      const picked = pickOutfit(result, avoided);
      session.lastRecommend = result;
      session.lastOutfit = picked;

      const contextPatch: Record<string, unknown> = {
        occasion: body.occasion,
        occasionLabel: formatOccasionLabel(String(body.occasion)),
        weather: body.weather,
        lastOutfitItemIds: picked?.items ?? [],
      };

      if (!picked) {
        return {
          name,
          response: {
            ok: false,
            status: result.status,
            message: result.message ?? 'No outfit candidates from Muse',
            ranking: result.ranking ?? null,
          },
          contextPatch,
        };
      }

      const title = picked.reasons?.[0]?.replace(/\.$/, '') ?? 'Your Muse look';
      const wardrobeById = new Map(
        session.wardrobe.map((item) => [asText(item.id), item]),
      );
      const pieces = (picked.items ?? []).map((id) => {
        const item = wardrobeById.get(id);
        const role =
          Object.entries(picked.roles ?? {}).find(
            ([, value]) => value === id,
          )?.[0] ?? 'piece';
        return {
          role,
          label: item ? garmentLabel(item) : 'closet piece',
        };
      });
      return {
        name,
        response: {
          ok: true,
          status: result.status,
          recommendation_id: result.recommendation_id,
          model_version: result.model_version,
          ranking: result.ranking ?? null,
          outfit: {
            outfit_id: picked.outfit_id,
            pieces,
            score: picked.score,
            reasons: picked.reasons?.slice(0, 5) ?? [],
            mixed: Boolean(picked.mixed),
            marketplace_items: picked.marketplace_items ?? [],
          },
          speak_hint:
            'Describe pieces with pieces[].label only. Never mention ids or UUIDs. The app already shows outfit tiles.',
          marketplace_suggestions: (result.marketplace_suggestions ?? []).slice(
            0,
            5,
          ),
        },
        outfitPayload: {
          recommendationId: result.recommendation_id,
          outfit: picked,
          title,
          score: picked.score,
        },
        contextPatch,
      };
    }
    case 'plan_travel_pack': {
      if (!session.wardrobe.length) {
        return {
          name,
          response: { ok: false, message: 'Closet is empty in this session.' },
        };
      }
      const days = Array.isArray(args.days) ? args.days : [];
      if (!days.length) {
        return {
          name,
          response: { ok: false, message: 'Provide at least one trip day.' },
        };
      }
      const enableMarket =
        args.enable_marketplace === true &&
        Boolean(session.marketplaceProducts?.length);
      const body: Record<string, unknown> = {
        user_id: session.userId,
        wardrobe: session.wardrobe,
        profile: session.profile,
        destination: {
          name: typeof args.destination === 'string' ? args.destination : null,
        },
        trip: {
          days: days.map((day) => {
            const row = day as Record<string, unknown>;
            return {
              date: row.date,
              label: row.label,
              occasion: row.occasion ?? 'smart-casual',
              weather: {
                ...(typeof row.temperature_c === 'number'
                  ? { temperature_c: row.temperature_c }
                  : {}),
                ...(typeof row.condition === 'string'
                  ? { condition: row.condition }
                  : {}),
              },
            };
          }),
        },
        luggage: {
          max_items:
            typeof args.max_items === 'number' ? args.max_items : undefined,
          prefer_rewear: true,
        },
        marketplace: {
          enabled: enableMarket,
          include_mixed: enableMarket,
        },
      };
      if (enableMarket && session.marketplaceProducts?.length) {
        body.marketplace_products = session.marketplaceProducts;
      }
      const result = await muse.travelPack(body);
      return {
        name,
        response: {
          ok: result.status === 'ok' || result.status === 'partial',
          status: result.status,
          model_version: result.model_version,
          day_plans: (result.day_plans ?? []).slice(0, 14),
          packing_list: (result.packing_list ?? []).slice(0, 40),
          marketplace_suggestions: (result.marketplace_suggestions ?? []).slice(
            0,
            8,
          ),
          message: result.message ?? null,
        },
        travel: result as unknown as Record<string, unknown>,
      };
    }
    case 'submit_outfit_feedback': {
      const action = asText(args.action);
      const allowed = new Set([
        'like',
        'save',
        'dislike',
        'dismiss',
        'worn',
        'purchase',
      ]);
      if (!allowed.has(action)) {
        return {
          name,
          response: { ok: false, message: `Unsupported action ${action}` },
        };
      }
      const result = await muse.feedback({
        recommendation_id: args.recommendation_id,
        outfit_id: args.outfit_id,
        action,
        user_id: session.userId,
        reason: typeof args.note === 'string' ? { note: args.note } : undefined,
      });
      return { name, response: { ok: true, result } };
    }
    default:
      return {
        name,
        response: {
          ok: false,
          message: `Unknown tool ${name}. Use Closette tools only.`,
        },
      };
  }
}

function pickOutfit(result: MuseRecommendResult, avoided: Set<string>) {
  const rows = [...(result.recommendations ?? [])];
  if (!rows.length) return undefined;
  rows.sort((a, b) => {
    let scoreA = a.score ?? 0;
    let scoreB = b.score ?? 0;
    if (a.mixed) scoreA -= 0.15;
    if (b.mixed) scoreB -= 0.15;
    if ((a.items ?? []).some((id) => avoided.has(id))) scoreA -= 3;
    if ((b.items ?? []).some((id) => avoided.has(id))) scoreB -= 3;
    return scoreB - scoreA;
  });
  return (
    rows.find(
      (row) => !(row.items ?? []).some((id) => avoided.has(id)) && !row.mixed,
    ) ??
    rows.find((row) => !(row.items ?? []).some((id) => avoided.has(id))) ??
    rows[0]
  );
}

/**
 * Home location wins unless the model asks for a city that the user actually named
 * in their latest message (trip / destination).
 */
function resolveWeatherPlace(
  requested: string,
  session: AgentSession,
): string | undefined {
  const home = session.location?.trim();
  if (!requested) return home;

  if (!home) return requested;

  const homeNorm = home.toLowerCase();
  const reqNorm = requested.toLowerCase();
  if (homeNorm.includes(reqNorm) || reqNorm.includes(homeNorm.split(',')[0])) {
    return home;
  }

  const message = (session.latestUserMessage ?? '').toLowerCase();
  const cityToken = reqNorm.split(',')[0]?.trim() ?? reqNorm;
  if (cityToken.length >= 3 && message.includes(cityToken)) {
    return requested;
  }

  // Model invented a city — stick to home.
  return home;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function formatOccasionLabel(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
