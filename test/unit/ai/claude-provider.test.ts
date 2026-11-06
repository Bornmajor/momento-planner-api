import { describe, expect, it, vi } from 'vitest';
import { createClaudeProvider } from '../../../src/providers/ai/claude.provider.js';
import { sampleEvent } from '../../helpers/events.js';

const input = { event: sampleEvent(), shorten: true, translateTo: 'sw' as const };

function fakeClient(response: object) {
  return { messages: { parse: vi.fn().mockResolvedValue(response) } };
}

describe('Claude provider', () => {
  it('sends the configured model and returns the parsed title and description', async () => {
    const client = fakeClient({
      stop_reason: 'end_turn',
      parsed_output: { title: 'Usiku wa Jazz', description: 'Jioni ya muziki wa jazz.' },
    });
    const provider = createClaudeProvider({ model: 'claude-haiku-5-5', client });

    await expect(provider.personalize(input)).resolves.toEqual({
      title: 'Usiku wa Jazz',
      description: 'Jioni ya muziki wa jazz.',
    });
    const request = client.messages.parse.mock.calls[0]![0];
    expect(request.model).toBe('claude-haiku-5-5');
    expect(JSON.stringify(request.messages)).toContain('Swahili');
  });

  it.each([
    ['a refusal', { stop_reason: 'refusal', parsed_output: null }],
    ['a truncated reply', { stop_reason: 'max_tokens', parsed_output: null }],
  ])('treats %s as UPSTREAM_UNAVAILABLE', async (_case, response) => {
    const provider = createClaudeProvider({ model: 'claude-haiku-5-5', client: fakeClient(response) });
    await expect(provider.personalize(input)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
