import type { AiProvider, PersonalizeInput } from './ai-provider.js';

/**
 * Predictable stand-in for the real AI. Used in tests and in development without ANTHROPIC_API_KEY.
 * `calls` records every request so tests can check when the AI was (not) called.
 */
export function createFakeAiProvider(): AiProvider & { calls: PersonalizeInput[] } {
  const calls: PersonalizeInput[] = [];
  return {
    model: 'fake-ai',
    calls,
    async personalize(input) {
      calls.push(input);
      const language = input.translateTo ?? 'original';
      return {
        title: `[${language}] ${input.event.title}`,
        description:
          `${input.shorten ? 'Short' : 'Full'} (${language}): ${input.event.description ?? ''}`.trim(),
      };
    },
  };
}
