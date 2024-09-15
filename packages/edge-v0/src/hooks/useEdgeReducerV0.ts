import { useState, useEffect, useReducer, useCallback } from "react";
import { Libp2pNode, TurboEdgeContextBody, useTurboEdgeV0 } from "../providers/TurboEdgeProviderV0";
import { fromString, toString } from "uint8arrays";
import { Message, SignedMessage } from "@libp2p/interface";
import { multiaddr } from "@multiformats/multiaddr";

export interface EdgeAction {
  peerId: string;
}

export function useEdgeReducerV0<S, A extends EdgeAction>(
  reducer: (state: S, action: A) => S,
  initialValue: S,
  {
    topic,
  }: {
    topic: string;
  }
) {
  const turboEdge = useTurboEdgeV0();
  const [state, rawDispatch] = useReducer(reducer, initialValue);

  const dispatch = useCallback(
    async (action: A) => {
      if (turboEdge) {
        await turboEdge.node.services.pubsub.publish(
          topic,
          fromString(JSON.stringify(action))
        );

        rawDispatch({
          ...action,
          peerId: turboEdge.node.peerId.toString(),
        });
      } else {
        throw new Error("Turbo Edge is not connected");
      }
    },
    [rawDispatch, turboEdge, topic]
  );

  const init = useCallback(async () => {
    if (turboEdge && topic) {
      await turboEdge.node.services.pubsub.subscribe(topic);
      await assignTopic(turboEdge, topic)
    }
  }, [turboEdge, topic]);

  const initWithRetry = useCallback(async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await init()
        return
      } catch (err) {
        if (i == 4) {
          throw err
        }
      }
    }
  }, [init]);

  useEffect(() => {
    if (turboEdge && topic) {
      initWithRetry();

      const handler = (event: CustomEvent<Message>) => {
        const eventTopic = event.detail.topic;

        if (eventTopic == topic) {
          const message = toString(event.detail.topic);
          const action: A = JSON.parse(message);

          rawDispatch({
            ...action,
            peerId: (event.detail as SignedMessage).from.toString(),
          });
        }
      };

      turboEdge.node.services.pubsub.addEventListener("message", handler);

      return () => {
        turboEdge.node.services.pubsub.removeEventListener("message", handler);
        removeTopic(turboEdge, topic)
      };
    }
  }, [turboEdge, topic]);

  return [state, dispatch];
}

async function assignTopic(turboEdge: TurboEdgeContextBody, topic: string) {
  const selfPeerId = turboEdge.node.peerId.toString()

  {
    const response = await fetch(turboEdge.p2pRelay + '/assign-topic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ peerid: selfPeerId, topic }),
    })

    if (!response.ok) {
      throw new Error('Assign topic failed')
    }
  }

  {
    const res = await fetch(turboEdge.p2pRelay + '/get-peers/' + topic).then(res => res.json())
    
    if (res.peers) {
      for (const peer of res.peers) {
        if (peer != selfPeerId) {
          const ma = multiaddr(`${turboEdge.addrPrefix}/${peer}`)
          turboEdge.node.dial(ma).catch(err => console.error(`Can't connect to ${peer}`, err))
        }
      }
    } else {
      throw new Error('Error fetching peers')
    }
  }
}

async function removeTopic(turboEdge: TurboEdgeContextBody, topic: string) {
  const selfPeerId = turboEdge.node.peerId.toString()

  const response = await fetch(turboEdge.p2pRelay + '/remove-peerid-topic', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ peerid: selfPeerId, topic }),
  })

  if (!response.ok) {
    throw new Error('Remove topic failed')
  }
}
