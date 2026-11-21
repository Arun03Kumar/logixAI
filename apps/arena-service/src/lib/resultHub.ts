import type { ArenaSubmissionView } from "@logixai/contracts";
import type { RedisClient } from "@logixai/service-kit";

/**
 * Tells open result streams that a submission was judged, across replicas.
 *
 * The judge result can be applied by any arena replica (whichever takes the
 * BullMQ job), while the learner's stream is open on another. Every replica
 * subscribes to one Redis channel with a single connection; the replica that
 * applies a result publishes it, and each replica hands it to the streams it
 * holds for that submission.
 */
export interface ResultHub {
  publish(view: ArenaSubmissionView): Promise<void>;
  /** Calls `listener` once the submission is judged; returns an unsubscribe. */
  listen(submissionId: string, listener: (view: ArenaSubmissionView) => void): () => void;
  close(): Promise<void>;
}

const CHANNEL = "logixai:arena:judged";

export function createResultHub(publisher: RedisClient, subscriber: RedisClient): ResultHub {
  const listeners = new Map<string, Set<(view: ArenaSubmissionView) => void>>();

  void subscriber.subscribe(CHANNEL);
  subscriber.on("message", (channel, message) => {
    if (channel !== CHANNEL) return;
    let view: ArenaSubmissionView;
    try {
      view = JSON.parse(message) as ArenaSubmissionView;
    } catch {
      return;
    }
    for (const listener of listeners.get(view.id) ?? []) listener(view);
  });

  return {
    async publish(view) {
      await publisher.publish(CHANNEL, JSON.stringify(view));
    },
    listen(submissionId, listener) {
      const set = listeners.get(submissionId) ?? new Set();
      set.add(listener);
      listeners.set(submissionId, set);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(submissionId);
      };
    },
    async close() {
      listeners.clear();
      await subscriber.quit();
    },
  };
}

/** In-process hub for tests and single-instance development. */
export function createLocalResultHub(): ResultHub {
  const listeners = new Map<string, Set<(view: ArenaSubmissionView) => void>>();
  return {
    async publish(view) {
      for (const listener of listeners.get(view.id) ?? []) listener(view);
    },
    listen(submissionId, listener) {
      const set = listeners.get(submissionId) ?? new Set();
      set.add(listener);
      listeners.set(submissionId, set);
      return () => set.delete(listener);
    },
    async close() {
      listeners.clear();
    },
  };
}
