import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MuseChatDto } from './dto/muse-chat.dto';
import {
  AGENT_TOOL_DECLARATIONS,
  AgentSession,
  executeAgentTool,
  type ToolExecution,
} from './muse-agent.tools';
import { MuseHttpClient } from './muse-http.client';
import { sanitizeMuseReply } from './muse-reply.util';
import { WeatherClient } from './weather.client';

const SYSTEM_PROMPT = `You are Muse, Closette's AI Personal Fashion Stylist.

You have a ChatGPT-like conversation with the user about fashion, styling, clothing, fit, occasions, weather, outfits, shopping, travel packing, and their personal Closette wardrobe.

How you work:
- You understand intent and keep multi-turn context.
- You call Closette tools for real data and for any outfit, travel pack, or shop gap-fill.
- Closette Muse recommend / travel / feedback tools use the team's learned MLP ranker, LinUCB personalization, marketplace mix, and travel packer. Never replace those with your own invented rankings.
- Never invent garment IDs, product IDs, recommendation_ids, or outfit_ids. Only cite IDs returned by tools.
- Never show raw ids, UUIDs, or hex codes to the user. Describe pieces in plain language (e.g. "grey sweatshirt", "black coat"). Outfit tiles already show the clothes.
- Remember lasting style facts with remember_about_user (fit prefs, likes/dislikes, occasions, sizing notes). Read prior memory from the grounding block.
- If home location is unknown and the user names a city (or answers “where are you?”), call set_home_location with that city, then answer with live weather. Do not keep asking once set_home_location succeeds.
- Location & weather (critical):
  - The user's home city is in the session grounding block. Dress for THAT place.
  - Never invent cities (no random New York / Paris / London). Never invent temperatures.
  - If active weather is already in the grounding block or get_profile_snapshot, use it for recommend_outfits — do not call get_weather with a different city.
  - Call get_weather only with no location (defaults to home) or with a city the user explicitly named for a trip.
- For "what should I wear" / occasions: recommend_outfits with the grounded weather.
- For trips / destinations / packing: get_weather for the named destination if needed, then plan_travel_pack.
- For wardrobe questions or "does A match B": get_wardrobe_snapshot first; explain using those garments only.
- For likes/dislikes of a shown Muse outfit: submit_outfit_feedback with the Muse ids.
- Stay in fashion/styling domain. Refuse coding, hacking, homework, or unrelated general knowledge briefly.

Style: warm, concise, practical (2–5 sentences). Name the user's city when mentioning weather. Explain Muse reasons when an outfit is returned.`;

const OFF_TOPIC =
  /\b(write|generate|debug|fix)\b.*\b(code|script|sql|python|javascript|typescript|html)\b|\b(hack|exploit|jailbreak|ignore (previous|all) instructions)\b|\b(leetcode|homework essay|crypto seed|private key)\b/i;

const MAX_TOOL_ROUNDS = 6;

export type MuseChatOutfitPayload = {
  recommendationId: string;
  outfit: {
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
  };
  title: string;
  score: number;
};

export type MuseChatResponse = {
  text: string;
  outfit?: MuseChatOutfitPayload;
  travel?: Record<string, unknown>;
  context?: Record<string, unknown>;
  status?: string;
  memory?: {
    summary: string;
    facts: string[];
  };
  /** Verified home city from set_home_location — app persists to profile. */
  homeLocation?: string;
};

type GeminiPart = {
  text?: string;
  functionCall?: {
    name?: string;
    args?: Record<string, unknown>;
    /** Required by newer Gemini models when echoing tool calls back. */
    thoughtSignature?: string;
    thought_signature?: string;
  };
  functionResponse?: { name: string; response: Record<string, unknown> };
};

type GeminiContent = { role: string; parts: GeminiPart[] };

@Injectable()
export class MuseChatService {
  private readonly logger = new Logger(MuseChatService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly muse: MuseHttpClient,
    private readonly weather: WeatherClient,
  ) {}

  async chat(dto: MuseChatDto): Promise<MuseChatResponse> {
    const message = dto.message.trim();
    if (!message) {
      throw new BadRequestException('message is required');
    }

    if (OFF_TOPIC.test(message)) {
      return {
        text: 'I only help with Closette fashion and personal styling. Ask me about outfits, wardrobe, weather, travel looks, or shopping for your closet.',
        context: dto.context,
      };
    }

    const apiKey =
      this.config.get<string>('GEMINI_API_KEY')?.trim() ||
      this.config.get<string>('GOOGLE_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Set GEMINI_API_KEY (Google AI Studio free key) for Muse chat.',
      );
    }

    const preferredModel =
      this.config.get<string>('MUSE_CHAT_MODEL')?.trim() ||
      'gemini-flash-lite-latest';
    const models = this.geminiModelCandidates(preferredModel);

    const memoryFacts = Array.isArray(dto.memoryFacts)
      ? dto.memoryFacts.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
    const memoryCity = memoryFacts
      .map((fact) => {
        const match = fact.match(/home city:\s*(.+)$/i);
        return match?.[1]?.trim();
      })
      .find((value) => value && value.length >= 2);

    const location =
      (typeof dto.location === 'string' && dto.location.trim()
        ? dto.location.trim()
        : undefined) ||
      (typeof dto.context?.location === 'string' &&
      String(dto.context.location).trim()
        ? String(dto.context.location).trim()
        : undefined) ||
      memoryCity ||
      undefined;

    const latitude =
      typeof dto.latitude === 'number'
        ? dto.latitude
        : typeof dto.context?.latitude === 'number'
          ? Number(dto.context.latitude)
          : undefined;
    const longitude =
      typeof dto.longitude === 'number'
        ? dto.longitude
        : typeof dto.context?.longitude === 'number'
          ? Number(dto.context.longitude)
          : undefined;

    const session: AgentSession = {
      userId: dto.userId,
      wardrobe: dto.wardrobe ?? [],
      profile: dto.profile,
      context: { ...(dto.context ?? {}) },
      marketplaceProducts: dto.marketplaceProducts,
      location,
      latitude,
      longitude,
      latestUserMessage: dto.message.trim(),
      memorySummary:
        typeof dto.memorySummary === 'string' ? dto.memorySummary.trim() : '',
      memoryFacts,
    };

    // Ensure session weather matches the user's home location (app chip or live fetch).
    await this.ensureHomeWeather(session);

    const contents = this.buildContents(dto, session);
    let outfit: MuseChatOutfitPayload | undefined;
    let travel: Record<string, unknown> | undefined;
    let status: string | undefined;
    let homeLocation: string | undefined;
    let calledRecommend = false;
    let finalText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const payload = await this.geminiGenerate({
        apiKey,
        models,
        contents,
      });
      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      const calls = parts.filter((part) => part.functionCall?.name);

      if (!calls.length) {
        finalText = parts
          .map((part) => part.text ?? '')
          .join('\n')
          .trim();
        break;
      }

      const userParts: GeminiPart[] = [];

      for (const part of calls) {
        const call = part.functionCall!;
        const name = String(call.name);
        const args = call.args ?? {};
        if (name === 'recommend_outfits') calledRecommend = true;

        let execution: ToolExecution;
        try {
          execution = await executeAgentTool({
            name,
            args,
            session,
            muse: this.muse,
            weather: this.weather,
          });
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : String(error);
          execution = {
            name,
            response: { ok: false, error: messageText },
          };
        }

        this.applyToolExecution(session, execution, {
          onOutfit: (payload) => {
            outfit = payload;
          },
          onTravel: (payload) => {
            travel = payload;
          },
          onHome: (city) => {
            homeLocation = city;
          },
          onStatus: (next) => {
            status = next;
          },
        });

        userParts.push({
          functionResponse: {
            name: execution.name,
            response: execution.response,
          },
        });
      }

      contents.push({ role: 'model', parts });
      contents.push({ role: 'user', parts: userParts });

      // Nudge the model to finish with Muse recommend when it only gathered context.
      if (
        round >= 1 &&
        !calledRecommend &&
        !outfit &&
        session.wardrobe.length > 0
      ) {
        contents.push({
          role: 'user',
          parts: [
            {
              text: 'You have enough context. Call recommend_outfits now (use the weather already fetched if any). Do not invent garments.',
            },
          ],
        });
      }
    }

    // Completion fallback: still Muse engine only — never LLM-fabricated items.
    if (!outfit && !travel && session.wardrobe.length > 0 && !calledRecommend) {
      const execution = await executeAgentTool({
        name: 'recommend_outfits',
        args: {
          occasion: session.context.occasion ?? 'smart-casual',
          prefer_another: false,
        },
        session,
        muse: this.muse,
        weather: this.weather,
      });
      if (execution.contextPatch) {
        session.context = { ...session.context, ...execution.contextPatch };
      }
      if (execution.outfitPayload) {
        outfit = execution.outfitPayload;
        status =
          typeof execution.response.status === 'string'
            ? execution.response.status
            : status;
      }
    }

    if (!finalText) {
      finalText =
        outfit != null
          ? `Here is a Muse look from your Closette closet${outfit.outfit.mixed ? ', with a shop fill for a missing piece' : ''}.`
          : travel != null
            ? 'Here is a Muse travel pack built from your Closette wardrobe.'
            : 'Tell me the occasion, weather, or trip and I will style you from your Closette closet.';
    }

    return {
      text: sanitizeMuseReply(finalText, session.wardrobe),
      outfit,
      travel,
      context: session.context,
      status,
      memory: {
        summary: session.memorySummary ?? '',
        facts: session.memoryFacts ?? [],
      },
      homeLocation: homeLocation ?? session.location,
    };
  }

  private withoutWeather(
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    const next = { ...context };
    delete next.weather;
    return next;
  }

  private applyToolExecution(
    session: AgentSession,
    execution: ToolExecution,
    hooks: {
      onOutfit: (payload: NonNullable<ToolExecution['outfitPayload']>) => void;
      onTravel: (payload: Record<string, unknown>) => void;
      onHome: (city: string) => void;
      onStatus: (status: string) => void;
    },
  ) {
    if (execution.contextPatch) {
      session.context = { ...session.context, ...execution.contextPatch };
    }
    if (execution.outfitPayload) {
      hooks.onOutfit(execution.outfitPayload);
      if (typeof execution.response.status === 'string') {
        hooks.onStatus(execution.response.status);
      }
    }
    if (execution.travel) {
      hooks.onTravel(execution.travel);
      if (typeof execution.response.status === 'string') {
        hooks.onStatus(execution.response.status);
      }
    }
    if (execution.memoryPatch) {
      if (execution.memoryPatch.summary != null) {
        session.memorySummary = execution.memoryPatch.summary;
      }
      if (execution.memoryPatch.facts) {
        session.memoryFacts = execution.memoryPatch.facts;
      }
    }
    if (execution.homeLocation) {
      hooks.onHome(execution.homeLocation);
    }
  }

  /** Always refresh Open-Meteo for the profile city — never invent weather. */
  private async ensureHomeWeather(session: AgentSession): Promise<void> {
    if (!session.location) {
      // Drop any client-side invented chip weather when we have no city.
      if (session.context.weather) {
        session.context = this.withoutWeather(session.context);
      }
      return;
    }

    try {
      const snapshot = await this.weather.lookup({
        location: session.location,
        latitude: session.latitude,
        longitude: session.longitude,
      });
      if (snapshot.location) {
        session.location = snapshot.location.trim();
      }
      if (
        snapshot.source === 'open-meteo' &&
        typeof snapshot.temperature_c === 'number'
      ) {
        session.context = {
          ...session.context,
          location: session.location,
          weather: {
            temperature_c: snapshot.temperature_c,
            ...(snapshot.condition ? { condition: snapshot.condition } : {}),
          },
        };
        return;
      }
      session.context = {
        ...this.withoutWeather(session.context),
        location: session.location,
      };
      this.logger.warn(
        `Live weather unavailable for ${session.location}: ${snapshot.reason ?? snapshot.source}`,
      );
    } catch (error) {
      this.logger.warn(`Home weather prefetch failed: ${String(error)}`);
      session.context = {
        ...this.withoutWeather(session.context),
        location: session.location,
      };
    }
  }

  private buildContents(
    dto: MuseChatDto,
    session: AgentSession,
  ): GeminiContent[] {
    const contents: GeminiContent[] = [];
    for (const turn of (dto.history ?? []).slice(-12)) {
      const text = turn.content?.trim();
      if (!text) continue;
      contents.push({
        role: turn.role === 'user' ? 'user' : 'model',
        parts: [{ text: text.slice(0, 1200) }],
      });
    }

    const weather =
      typeof session.context.weather === 'object' && session.context.weather
        ? (session.context.weather as Record<string, unknown>)
        : null;
    const temp =
      weather && typeof weather.temperature_c === 'number'
        ? weather.temperature_c
        : null;
    const condition =
      weather && typeof weather.condition === 'string'
        ? weather.condition
        : null;
    const memoryFacts = (session.memoryFacts ?? []).slice(-20);
    const grounding = [
      'Session grounding (authoritative — do not invent other cities or temps):',
      session.location
        ? `- User home location: ${session.location}`
        : '- User home location: unknown (ask briefly if weather matters)',
      temp != null
        ? `- Active live weather: ${temp}°C${condition ? ` ${condition}` : ''} — use this; do not invent weather`
        : '- Active live weather: unavailable — do not invent rain/sun/temps; call get_weather or style without claiming current weather',
      typeof session.context.occasion === 'string' ||
      typeof session.context.occasion === 'number'
        ? `- Occasion: ${session.context.occasion}`
        : null,
      session.memorySummary
        ? `- Stylist memory summary: ${session.memorySummary}`
        : '- Stylist memory summary: (empty — learn and call remember_about_user when they share prefs)',
      memoryFacts.length
        ? `- Known facts:\n${memoryFacts.map((fact) => `  • ${fact}`).join('\n')}`
        : null,
      '- Reply style: never show garment UUIDs/ids; use plain names only.',
    ]
      .filter(Boolean)
      .join('\n');

    contents.push({
      role: 'user',
      parts: [
        {
          text: `${grounding}\n\nUser message:\n${dto.message.trim().slice(0, 2000)}`,
        },
      ],
    });
    return contents;
  }

  /** Preferred model first, then lighter/alternate pools for 503 capacity spikes. */
  private geminiModelCandidates(preferred: string): string[] {
    const fallbacks = [
      'gemini-2.0-flash-lite',
      'gemini-2.0-flash',
      'gemini-flash-lite-latest',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
    ];
    return [preferred, ...fallbacks.filter((model) => model !== preferred)];
  }

  private isTransientGeminiError(
    status: number,
    message: string | undefined,
  ): boolean {
    if (status === 429 || status === 503 || status === 500) return true;
    const text = (message ?? '').toLowerCase();
    return (
      text.includes('high demand') ||
      text.includes('overloaded') ||
      text.includes('unavailable') ||
      text.includes('resource_exhausted') ||
      text.includes('try again')
    );
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async geminiGenerate(input: {
    apiKey: string;
    models: string[];
    contents: GeminiContent[];
  }): Promise<{
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  }> {
    const body = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: input.contents,
      tools: [{ function_declarations: AGENT_TOOL_DECLARATIONS }],
      tool_config: { function_calling_config: { mode: 'AUTO' } },
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 512,
      },
    });

    let lastMessage = 'Muse chat is busy. Try again in a moment.';

    for (const model of input.models) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            signal: AbortSignal.timeout(45_000),
          });
        } catch (error) {
          this.logger.warn(`Gemini ${model} network fail: ${String(error)}`);
          lastMessage =
            'Muse chat could not reach Gemini. Check network / GEMINI_API_KEY.';
          await this.sleep(400 * (attempt + 1));
          continue;
        }

        const json = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
          error?: { message?: string };
        };

        if (response.ok) {
          if (model !== input.models[0] || attempt > 0) {
            this.logger.log(`Gemini ok via ${model} (attempt ${attempt + 1})`);
          }
          return json;
        }

        const message =
          json.error?.message ?? `Gemini error (${response.status})`;
        lastMessage = message;
        const transient = this.isTransientGeminiError(response.status, message);
        this.logger.warn(
          `Gemini ${model} ${response.status}: ${message}${transient ? ' — retry/fallback' : ''}`,
        );

        if (!transient) {
          throw new ServiceUnavailableException(message);
        }

        // Same-model backoff, then next model in the candidate list.
        if (attempt < 2) {
          await this.sleep(
            700 * 2 ** attempt + Math.floor(Math.random() * 400),
          );
        }
      }
    }

    throw new ServiceUnavailableException(lastMessage);
  }
}
