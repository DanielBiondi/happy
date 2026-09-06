import * as React from 'react';
import { useIsFocused } from '@react-navigation/native';
import { getVisibleSessionId, setVisibleSessionId } from '@/utils/visibleSession';
import { apiSocket } from '@/sync/apiSocket';

/**
 * Marks `sessionId` as the on-screen chat while this screen is focused, and
 * clears it on blur/unmount. Read by the push-notification handler in
 * app/_layout.tsx so a "ready"/permission push is suppressed only for the chat
 * you're actively viewing.
 *
 * The cleanup only clears the tracker if it still points at this session — so
 * navigating A -> B (B sets itself, then A's blur cleanup runs) can't wipe B's
 * value out from under it.
 */
export function useTrackVisibleSession(sessionId: string): void {
    const isFocused = useIsFocused();
    React.useEffect(() => {
        if (!isFocused) {
            return;
        }
        setVisibleSessionId(sessionId);
        apiSocket.sendViewedSession(sessionId);
        return () => {
            if (getVisibleSessionId() === sessionId) {
                setVisibleSessionId(null);
                apiSocket.sendViewedSession(null);
            }
        };
    }, [isFocused, sessionId]);
}
