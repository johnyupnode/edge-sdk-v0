import { EdgeAction, ensurePeers, useEdgeReducerV0, useTurboEdgeV0 } from "@turbo-ing/edge-v0";
import { Message, SignedMessage } from "@libp2p/interface";
import { useEffect, useReducer, useState } from "react";
import { fromString, toString } from "uint8arrays";

export interface PingState {
  ping: { [peerId: string]: number };
}

interface PingAction extends EdgeAction<PingState> {
  type: 'PING';
  timestamp: number;
}

interface PongAction extends EdgeAction<PingState> {
  type: 'PONG';
  timestamp: number;
}

export type PingPongAction = PingAction | PongAction;

export const initialState: PingState = {
  ping: {},
};

export function pingReducer(
  state: PingState = initialState,
  action: PingPongAction
): PingState {
  if (!action.peerId) return state

  switch (action.type) {
    case 'PING': {
      // Do nothing; wait for PONG to record the ping.
      return state
    }

    case 'PONG': {
      const latency = Date.now() - action.timestamp;
      return {
        ...state,
        ping: {
          ...state.ping,
          [action.peerId]: latency,
        },
      };
    }

    default:
      return state;
  }
}

export function usePingReducer(roomId: string): [PingState, string[]] {
  const turboEdge = useTurboEdgeV0()

  const commonTopic = roomId ? `@turbo-ping/COMMON/COMMON/${roomId}` : ''

  const [_, dispatchCommon, connected] = useEdgeReducerV0(pingReducer, initialState, { topic: commonTopic })
  const [state, dispatch] = useReducer(pingReducer, initialState)

  const [peers, setPeers] = useState<string[]>([]);

  useEffect(() => {
    if (turboEdge && connected && roomId) {
      const interval = setInterval(() => {
        if (turboEdge && roomId) {
          const peerList =
            turboEdge.node.services.pubsub.getSubscribers(roomId);
          setPeers(peerList.map(x => x.toString()));
          dispatchCommon({
            type: 'PING',
            timestamp: Date.now(),
          })
        } else {
          setPeers([]);
        }
      }, 100);
  
      return () => clearInterval(interval);
    }
  }, [turboEdge, roomId, dispatchCommon, connected]);

  useEffect(() => {
    if (roomId && turboEdge) {
      const myPeerId = turboEdge.node.peerId.toString()

      const managedHandler = async (event: CustomEvent<Message>) => {
        const eventTopic = event.detail.topic;

        if (eventTopic == commonTopic) {
          const message: string = toString(event.detail.data);
          const action: PingPongAction = JSON.parse(message);

          if (action.type == 'PING') {
            const source = (event.detail as SignedMessage).from.toString()
            const destTopic = `@turbo-ping/${source}/${myPeerId}/${roomId}`
            const sourceTopic = `@turbo-ping/${myPeerId}/${source}/${roomId}`
      
            await turboEdge.node.services.pubsub.subscribe(destTopic)
            await turboEdge.node.services.pubsub.subscribe(sourceTopic)
      
            const hasPeers = await ensurePeers(turboEdge, destTopic, 2000)
      
            if (hasPeers) {
              await turboEdge.node.services.pubsub.publish(
                destTopic,
                fromString(JSON.stringify({
                  type: 'PONG',
                  timestamp: action.timestamp,
                }))
              );
            }
          }
        } else if (eventTopic.startsWith(`@turbo-ping/${myPeerId}/`)) {
          const parts = eventTopic.split('/')
          const peerId = parts[2]

          const message: string = toString(event.detail.data);
          const action: PingPongAction = JSON.parse(message);
          
          if (action.type == 'PONG') {
            dispatch({
              type: 'PONG',
              timestamp: action.timestamp,
              peerId,
            })
          }
        }
      }

      turboEdge.node.services.pubsub.addEventListener("message", managedHandler);

      return () => turboEdge.node.services.pubsub.removeEventListener("message", managedHandler)
    }
  }, [roomId, turboEdge])

  return [state, peers]
}