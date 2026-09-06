import * as React from 'react';
import { useRoute } from "@react-navigation/native";
import { SessionView } from '@/-session/SessionView';
import { useTrackVisibleSession } from '@/hooks/useTrackVisibleSession';


export default React.memo(() => {
    const route = useRoute();
    const sessionId = (route.params! as any).id as string;
    useTrackVisibleSession(sessionId);
    return (<SessionView id={sessionId} />);
});