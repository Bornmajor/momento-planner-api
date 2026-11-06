/**
 * Quick live check of the two external services (no database needed):
 * one Ticketmaster search + details, and one Claude personalization.
 * Run: npx tsx --env-file=.env scripts/live-check.ts
 */
import { EVENT_COUNTRIES } from '../src/config/constants.js';
import { buildFacts } from '../src/modules/personalize/facts.js';
import { createClaudeProvider } from '../src/providers/ai/claude.provider.js';
import { createTicketmasterProvider } from '../src/providers/events/ticketmaster.provider.js';

const events = createTicketmasterProvider({
  apiKey: process.env.TICKETMASTER_API_KEY!,
  countries: EVENT_COUNTRIES,
});
const page = await events.search({ categoryId: 'music', page: 0, size: 5 });
console.log(
  `Search: ${page.totalItems} music events; first 5 countries:`,
  page.items.map((e) => e.venue?.country).join(', '),
);

const withText = (await events.getByIds(page.items.map((e) => e.id))).values();
const event = [...withText].find((e) => e.description) ?? (await events.getById(page.items[0]!.id))!;
console.log(
  `\nEvent: ${event.title}\nOriginal description (${event.description?.length ?? 0} chars): ${event.description?.slice(0, 200)}`,
);

const ai = createClaudeProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: process.env.AI_MODEL ?? 'claude-haiku-5-5',
});
const started = Date.now();
const result = await ai.personalize({ event, shorten: true, translateTo: 'sw' });
console.log(
  `\nClaude (${Date.now() - started} ms), shortened + Swahili:\n  title: ${result.title}\n  description: ${result.description}`,
);
console.log('\nFacts (built by code):', buildFacts(event, 'sw'));
