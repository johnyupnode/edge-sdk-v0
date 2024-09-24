import { useState, useEffect, useReducer, useCallback, useMemo, useRef } from "react";
import {
  Libp2pNode,
  TurboEdgeContextBody,
} from "../providers/TurboEdgeProviderV0";
import { fromString, toString } from "uint8arrays";
import { Message, SignedMessage } from "@libp2p/interface";
import { multiaddr } from "@multiformats/multiaddr";
import { shuffleArray } from "../utils/shuffle";
import { useTurboEdgeV0 } from "./useTurboEdgeV0";
import { ensurePeers } from "../utils/peers";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export interface EdgeAction<S> {
  peerId?: string;
  __turbo__type?: string;
  __turbo__payload?: S;
}

export function useEdgeReducerV0<S, A extends EdgeAction<S>>(
  reducer: (state: S, action: A) => S,
  initialValue: S,
  {
    topic,
    onDispatch,
    onPayload,
    onReset,
  }: {
    topic: string;
    onDispatch?: (action: A) => any;
    onPayload?: (state: S) => any;
    onReset?: (previousState: S) => any;
  }
): [S, (action: A) => Promise<void>, boolean] {
  const extendedReducer = useCallback(
    (state: S, action: A): S => {
      switch (action.__turbo__type) {
        case 'PAYLOAD':
          try {
            if (onPayload) onPayload(action.__turbo__payload!)
          } catch (err) {
            console.error(err)
          }

          return action.__turbo__payload!;

        case 'RESET':
          try {
            if (onReset) onReset(state)
          } catch (err) {
            console.error(err)
          }
          
          return initialValue;
      }

      return reducer(state, action);
    },
    [reducer, onReset, onPayload]
  );

  const turboEdge = useTurboEdgeV0();
  const [state, rawDispatch] = useReducer(extendedReducer, initialValue);
  const [initialized, setInitialized] = useState(false);

  // Hooks for triggering state publishing
  const [statePublishingTarget, setStatePublishingTarget] = useState<string[]>([])
  const stateInitialized = useRef(false)

  const dispatch = useCallback(
    async (action: A) => {
      if (turboEdge && topic && initialized) {
        await turboEdge.node.services.pubsub.publish(
          topic,
          fromString(JSON.stringify(action))
        );

        rawDispatch({
          ...action,
          peerId: turboEdge.node.peerId.toString(),
        });

        if (onDispatch) {
          onDispatch(action)
        }
      } else {
        throw new Error("Turbo Edge is not connected");
      }
    },
    [rawDispatch, onDispatch, turboEdge, topic, initialized]
  );

  const init = useCallback(async () => {
    setInitialized(false);
    if (turboEdge && topic && !topic.startsWith('@turbo-ing')) {
      rawDispatch({
        __turbo__type: 'RESET'
      } as A)

      stateInitialized.current = false

      const peerId = turboEdge.node.peerId.toString()

      // Subscribe to application topic
      await turboEdge.node.services.pubsub.subscribe(topic);

      // Subscribe to Turbo Edge system topic
      const systemTopic = `@turbo-ing/edge-v0/${peerId}/${topic}`
      await turboEdge.node.services.pubsub.subscribe(systemTopic);

      const peers = await assignTopic(turboEdge, topic);

      const handler = async (event: CustomEvent<Message>) => {
        const eventTopic = event.detail.topic;
        const message: string = toString(event.detail.data);

        if (eventTopic == systemTopic) {
          const action: { type: 'REQUEST_STATE' } = JSON.parse(message);

          console.debug("Received message on topic:", eventTopic, action);

          switch (action.type) {
            case 'REQUEST_STATE': {
              setStatePublishingTarget(x => [...x, (event.detail as SignedMessage).from.toString()])
              break
            }
          }
        } else {
          // Match "@turbo-ing/edge-v0/[peerId]/[topic...]"
          const escapedSystemTopic = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const pattern = new RegExp(`^@turbo-ing\\/edge-v0\\/[a-zA-Z0-9]+\\/${escapedSystemTopic}$`);

          if (pattern.test(eventTopic)) {
            const action: { type: 'PUBLISH_STATE', payload: S } = JSON.parse(message);

            console.debug("Received message on topic:", eventTopic, action);
  
            switch (action.type) {
              case 'PUBLISH_STATE': {
                if (!stateInitialized.current) {
                  stateInitialized.current = true
                  try {
                    rawDispatch({
                      __turbo__type: 'PAYLOAD',
                      __turbo__payload: action.payload,
                    } as A)
                  } catch (err) {
                    console.error(err)
                    stateInitialized.current = false
                  }
                }
                break
              }
            }
          }
        }
      };

      turboEdge.node.services.pubsub.addEventListener("message", handler);

      // Try to fetch initial state from the peer
      async function fetchInitialData() {
        if (turboEdge) {
          if (peers.length == 0) {
            stateInitialized.current = true
            return
          }

          const shuffledPeers = shuffleArray(peers)

          // Fetch 2 peers per second for the initial state. Accept the answer from the first peers who respond.
          for (const peer of shuffledPeers) {
            const systemTopic = `@turbo-ing/edge-v0/${peer}/${topic}`

            await turboEdge.node.services.pubsub.subscribe(systemTopic)

            new Promise<void>(async resolve => {
              try {
                const hasPeers = await ensurePeers(turboEdge, systemTopic, 2000)

                if (hasPeers) {
                  await turboEdge.node.services.pubsub.publish(
                    systemTopic,
                    fromString(JSON.stringify({
                      type: 'REQUEST_STATE'
                    }))
                  );
                }

                resolve()
              } catch (err) {
                console.error('Fetching initial state from peer', peer, 'failed', err)
              }
            })

            await wait(500)

            if (stateInitialized.current) {
              return
            }
          }
    
          // If no peer is found to have the state for 1 second, we assume that no data is available.
          await wait(1000)
          stateInitialized.current = true
        }
      }
      await fetchInitialData()

      // Unsubscribe from all peers system topic for cleaning up
      for (const peer of peers) {
        const systemTopic = `@turbo-ing/edge-v0/${peer}/${topic}`
        await turboEdge.node.services.pubsub.unsubscribe(systemTopic)
      }

      if (peers.length > 0) {
        await ensurePeers(turboEdge, topic, 2000)
      }

      setInitialized(true);

      console.debug("Connected to topic:", topic);

      return () => {
        turboEdge.node.services.pubsub.unsubscribe(topic)
        turboEdge.node.services.pubsub.unsubscribe(systemTopic)
        turboEdge.node.services.pubsub.removeEventListener("message", handler);

        console.debug("Unsubscribed from topic:", topic);
      };
    } else {
      rawDispatch({
        __turbo__type: 'RESET'
      } as A)
    }
  }, [turboEdge, topic]);

  const initWithRetry = useCallback(async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await init();
        return;
      } catch (err) {
        if (i == 4) {
          throw err;
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
          const message = toString(event.detail.data);
          const action: A = JSON.parse(message);

          if (!eventTopic.startsWith('@turbo-ping')) {
            console.debug("Received message on topic:", eventTopic, action);
          }

          rawDispatch({
            ...action,
            peerId: (event.detail as SignedMessage).from.toString(),
          });
        }
      };

      turboEdge.node.services.pubsub.addEventListener("message", handler);

      return () => {
        turboEdge.node.services.pubsub.removeEventListener("message", handler);
        removeTopic(turboEdge, topic);
      };
    }
  }, [turboEdge, topic]);

  useEffect(() => {
    if (statePublishingTarget.length > 0 && turboEdge && stateInitialized.current) {
      const peerId = turboEdge.node.peerId.toString()
      const systemTopic = `@turbo-ing/edge-v0/${peerId}/${topic}`
      turboEdge.node.services.pubsub.publish(
        systemTopic,
        fromString(JSON.stringify({
          type: 'PUBLISH_STATE',
          payload: state,
        }))
      );
    }
  }, [turboEdge, statePublishingTarget, state])

  return [state, dispatch, initialized && stateInitialized.current];
}

async function assignTopic(turboEdge: TurboEdgeContextBody, topic: string) {
  const selfPeerId = turboEdge.node.peerId.toString();

  {
    const response = await fetch(turboEdge.p2pRelay + "/assign-topic", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ peerid: selfPeerId, topic }),
    });

    if (!response.ok) {
      throw new Error("Assign topic failed");
    }
  }

  {
    const res = await fetch(turboEdge.p2pRelay + "/get-peers/" + encodeURIComponent(topic)).then(
      (res) => res.json()
    );

    if (res.peers) {
      // const peers: string[] = res.peers.length > 21 ? res.peers.slice(res.peers.length - 21) : res.peers
      const peers: string[] = res.peers // Floodsub require all peers
      const promises: Promise<string | void>[] = []

      for (const peer of peers) {
        if (peer != selfPeerId) {
          const ma = multiaddr(
            `${turboEdge.addrPrefix}/p2p-circuit/webrtc/p2p/${peer}`
          );
          promises.push(
            turboEdge.node
              .dial(ma)
              .then(() => peer)
              .catch((err) => console.error(`Can't connect to ${peer}`, err))
          )
        }
      }

      const connectedPeers = await Promise.all(promises)

      return connectedPeers.filter(x => typeof x === 'string')
    } else {
      throw new Error("Error fetching peers");
    }
  }
}

async function removeTopic(turboEdge: TurboEdgeContextBody, topic: string) {
  const selfPeerId = turboEdge.node.peerId.toString();

  const response = await fetch(turboEdge.p2pRelay + "/remove-peerid-topic", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ peerid: selfPeerId, topic }),
  });

  if (!response.ok) {
    throw new Error("Remove topic failed");
  }
}
