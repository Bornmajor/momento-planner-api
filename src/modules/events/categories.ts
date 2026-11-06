/** Fixed category list mapped to Ticketmaster segments (spec §7, IDs confirmed by the T0.2 spike). */
export const CATEGORIES = [
  { id: 'music', name: 'Music', segmentId: 'KZFzniwnSyZfZ7v7nJ' },
  { id: 'sports', name: 'Sports', segmentId: 'KZFzniwnSyZfZ7v7nE' },
  { id: 'arts-theatre', name: 'Arts & Theatre', segmentId: 'KZFzniwnSyZfZ7v7na' },
  { id: 'film', name: 'Film', segmentId: 'KZFzniwnSyZfZ7v7nn' },
  { id: 'miscellaneous', name: 'Miscellaneous', segmentId: 'KZFzniwnSyZfZ7v7n1' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

export interface Category {
  id: CategoryId;
  name: string;
}

export function categoryBySegmentId(segmentId: string | undefined): Category | null {
  const match = CATEGORIES.find((c) => c.segmentId === segmentId);
  return match ? { id: match.id, name: match.name } : null;
}

export function segmentIdFor(categoryId: CategoryId): string {
  return CATEGORIES.find((c) => c.id === categoryId)!.segmentId;
}
