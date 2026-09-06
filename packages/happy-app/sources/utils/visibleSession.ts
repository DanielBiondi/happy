/**
 * Tracks which chat (session) the user is currently looking at, so the
 * foreground push-notification handler in app/_layout.tsx can suppress the
 * banner ONLY for the chat that's already on screen — every other chat (and
 * the session list, and the backgrounded app) still notifies.
 *
 * Module-level state rather than React state: the notification handler is a
 * plain callback registered once at module load, outside the component tree,
 * so it can't read from a hook/store subscription.
 */

let visibleSessionId: string | null = null;

export function setVisibleSessionId(id: string | null): void {
    visibleSessionId = id;
}

export function getVisibleSessionId(): string | null {
    return visibleSessionId;
}
