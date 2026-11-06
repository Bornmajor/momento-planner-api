import { model, Schema } from 'mongoose';

export interface SavedEventFields {
  eventId: string;
  source: 'ticketmaster';
  createdAt: Date;
}

/** Ties an event id to a user. No event data is copied (intent.md §4.3). */
const savedEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, enum: ['ticketmaster'], required: true, default: 'ticketmaster' },
    eventId: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform: (_doc, ret) => {
        const saved = ret as unknown as SavedEventFields;
        return { eventId: saved.eventId, source: saved.source, savedAt: saved.createdAt };
      },
    },
  },
);

savedEventSchema.index({ userId: 1, source: 1, eventId: 1 }, { unique: true });
savedEventSchema.index({ userId: 1, createdAt: -1 });

export const SavedEvent = model('SavedEvent', savedEventSchema);
