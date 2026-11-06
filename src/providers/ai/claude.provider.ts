import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { AiProvider, PersonalizedText } from './ai-provider.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';

const OutputSchema = z.object({ title: z.string(), description: z.string() });

/** The one SDK call we make, as an interface so tests can pass a fake client. */
export interface ClaudeParseClient {
  messages: {
    parse(params: Record<string, unknown>): Promise<{ stop_reason: string | null; parsed_output: unknown }>;
  };
}

function realClient(apiKey: string): ClaudeParseClient {
  const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
  return {
    messages: {
      parse: (params) =>
        anthropic.messages.parse(params as unknown as Parameters<typeof anthropic.messages.parse>[0]),
    },
  };
}

// The reason is logged (as the cause), never sent to clients.
const unavailable = (reason: string) =>
  new AppError('UPSTREAM_UNAVAILABLE', 'The AI service is unavailable, please try again', undefined, {
    cause: new Error(reason),
  });

export function createClaudeProvider(options: {
  model: string;
  apiKey?: string;
  client?: ClaudeParseClient;
}): AiProvider {
  const client = options.client ?? realClient(options.apiKey ?? '');

  return {
    model: options.model,
    async personalize(input): Promise<PersonalizedText> {
      let response: Awaited<ReturnType<ClaudeParseClient['messages']['parse']>>;
      try {
        response = await client.messages.parse({
          model: options.model,
          max_tokens: 2_000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserMessage(input) }],
          // A short rewrite: low effort keeps cost and latency down.
          output_config: { effort: 'low', format: zodOutputFormat(OutputSchema) },
        });
      } catch (err) {
        throw unavailable(err instanceof Error ? err.name : 'request failed');
      }

      // Refusals and truncated replies have no usable output.
      if (response.stop_reason !== 'end_turn') throw unavailable(`stop_reason ${response.stop_reason}`);
      const parsed = OutputSchema.safeParse(response.parsed_output);
      if (!parsed.success) throw unavailable('unparseable output');
      return { title: parsed.data.title.trim(), description: parsed.data.description.trim() };
    },
  };
}
