import type { RunSnapshot } from '../contracts/workflow.js';

type ReviewEvent = { type: string; timestamp: number; reference: string | null };

export function reviewIntervals(events: ReviewEvent[]): NonNullable<RunSnapshot['leadReviews']> {
  const reviews: NonNullable<RunSnapshot['leadReviews']> = [];
  for (const event of events) {
    if (event.type === 'handoff.claimed' || event.type === 'worker.readback_claimed') {
      if (event.reference)
        reviews.push({ handoffId: event.reference, startedAt: event.timestamp, finishedAt: null });
    } else {
      for (const review of reviews) {
        if (
          review.finishedAt === null &&
          (event.type.startsWith('run.') || review.handoffId === event.reference)
        )
          review.finishedAt = event.timestamp;
      }
    }
  }
  return reviews;
}
