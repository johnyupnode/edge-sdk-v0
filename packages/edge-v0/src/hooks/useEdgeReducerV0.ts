import {
  useState,
  useEffect,
  useReducer,
  useCallback,
  useRef,
} from "react";
import { fromString, toString } from "uint8arrays";
import { Message, SignedMessage } from "@libp2p/interface";
import { multiaddr } from "@multiformats/multiaddr";
import { shuffleArray } from "../utils/shuffle";
import { useTurboEdgeV0 } from "./useTurboEdgeV0";
import { ensurePeers } from "../utils/peers";
import {EdgeAction, TurboEdgeContextBody} from "../types";
import {edgeReducerV0} from "../reducer/edgeReducerV0";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // get the host as gameId and combine with the topic
  const gameId = window.location.host;
  if (topic) {
    topic = `${topic}_${gameId}`;
  }
  const extendedReducer = useCallback(
    (state: S, action: A): S => { return edgeReducerV0(state, action, reducer, initialValue, {onPayload, onReset})},
    [reducer, onReset, onPayload]
  );

  const turboEdge = useTurboEdgeV0();
  const [state, rawDispatch] = useReducer(extendedReducer, initialValue);
  const [initialized, setInitialized] = useState(false);

  // Hooks for triggering state publishing
  const [statePublishingTarget, setStatePublishingTarget] = useState<string[]>(
    []
  );
  const stateInitialized = useRef(false);
  const pendingCleanup = useRef(false);

  const dispatch = useCallback(
    async (action: A) => {
      if (turboEdge && topic && initialized) {
        const data = {...action, sessionId: turboEdge.sessionId};
        await turboEdge.node.services.pubsub.publish(
          topic,
          fromString(JSON.stringify(data))
        );

        rawDispatch({
          ...action,
          peerId: turboEdge.node.peerId.toString(),
        });

        if (onDispatch) {
          onDispatch(action);
        }
      } else {
        throw new Error("Turbo Edge is not connected");
      }
    },
    [rawDispatch, onDispatch, turboEdge, topic, initialized]
  );

  const init = useCallback(async () => {
    if (turboEdge && topic && !topic.startsWith("@turbo-ing")) {
      stateInitialized.current = false;

      const peerId = turboEdge.node.peerId.toString();

      // Subscribe to application topic
      turboEdge.node.services.pubsub.subscribe(topic);

      // Subscribe to Turbo Edge system topic
      const systemTopic = `@turbo-ing/edge-v0/${peerId}/${topic}`;
      turboEdge.node.services.pubsub.subscribe(systemTopic);

      const peers = await assignTopic(turboEdge, topic);

      const handler = async (event: CustomEvent<Message>) => {
        const eventTopic = event.detail.topic;
        const message: string = toString(event.detail.data);

        if (eventTopic == topic) {
          const message = toString(event.detail.data);
          const action: A = JSON.parse(message);

          if (!eventTopic.startsWith("@turbo-ping")) {
            console.debug("Received message on topic:", eventTopic, action);
          }

          rawDispatch({
            ...action,
            peerId: (event.detail as SignedMessage).from.toString(),
          });
        } else if (eventTopic == systemTopic) {
          const action: { type: "REQUEST_STATE" } = JSON.parse(message);

          console.debug("Received message on topic:", eventTopic, action);

          switch (action.type) {
            case "REQUEST_STATE": {
              setStatePublishingTarget((x) => [
                ...x,
                (event.detail as SignedMessage).from.toString(),
              ]);
              break;
            }
          }
        } else {
          // Match "@turbo-ing/edge-v0/[peerId]/[topic...]"
          const escapedSystemTopic = topic.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );
          const pattern = new RegExp(
            `^@turbo-ing\\/edge-v0\\/[a-zA-Z0-9]+\\/${escapedSystemTopic}$`
          );

          if (pattern.test(eventTopic)) {
            const action: { type: "PUBLISH_STATE"; payload: S } =
              JSON.parse(message);

            console.debug("Received message on topic:", eventTopic, action);

            switch (action.type) {
              case "PUBLISH_STATE": {
                if (!stateInitialized.current) {
                  stateInitialized.current = true;
                  try {
                    rawDispatch({
                      __turbo__type: "PAYLOAD",
                      __turbo__payload: action.payload,
                    } as A);
                  } catch (err) {
                    console.error(err);
                    stateInitialized.current = false;
                  }
                }
                break;
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
            stateInitialized.current = true;
            return;
          }

          const shuffledPeers = shuffleArray(peers);

          // Fetch 2 peers per second for the initial state. Accept the answer from the first peers who respond.
          for (const peer of shuffledPeers) {
            const systemTopic = `@turbo-ing/edge-v0/${peer}/${topic}`;

            await turboEdge.node.services.pubsub.subscribe(systemTopic);

            new Promise<void>(async (resolve) => {
              try {
                const hasPeers = await ensurePeers(
                  turboEdge,
                  systemTopic,
                  2000
                );

                if (hasPeers) {
                  await turboEdge.node.services.pubsub.publish(
                    systemTopic,
                    fromString(
                      JSON.stringify({
                        type: "REQUEST_STATE",
                      })
                    )
                  );
                }

                resolve();
              } catch (err) {
                console.error(
                  "Fetching initial state from peer",
                  peer,
                  "failed",
                  err
                );
              }
            });

            await wait(500);

            if (stateInitialized.current) {
              return;
            }
          }

          // If no peer is found to have the state for 1 second, we assume that no data is available.
          await wait(1000);
          stateInitialized.current = true;
        }
      }
      await fetchInitialData();

      // Unsubscribe from all peers system topic for cleaning up
      for (const peer of peers) {
        const systemTopic = `@turbo-ing/edge-v0/${peer}/${topic}`;
        await turboEdge.node.services.pubsub.unsubscribe(systemTopic);
      }

      if (peers.length > 0) {
        await ensurePeers(turboEdge, topic, 2000);
      }

      // Register game info to the DA Proxy
      let sessionId = Math.random().toString(36).substring(7);
      if (topic && !topic.startsWith("@turbo")) {
        const gamesInfo = await getGameInfo(turboEdge, gameId, topic);
        console.log("gamesInfo", JSON.stringify(gamesInfo));
        if (gamesInfo && gamesInfo.length > 0) {
          sessionId = gamesInfo[0].sessionId;
        }
        turboEdge.sessionId = sessionId;
        await registerGameInfo(turboEdge, topic, gameId, sessionId);
      }

      setInitialized(true);

      console.debug("Connected to topic:", topic);


      return async () => {
        turboEdge.node.services.pubsub.unsubscribe(topic);
        turboEdge.node.services.pubsub.unsubscribe(systemTopic);
        turboEdge.node.services.pubsub.removeEventListener("message", handler);
        await removeTopic(turboEdge, topic);

        console.debug("Unsubscribed from topic:", topic);

        // Remove game info from the DA Proxy
        await removeGameInfo(turboEdge, topic, gameId, sessionId);

      };
    }

    return async () => {};
  }, [turboEdge, topic]);

  const initWithRetry = useCallback(async () => {
    while (pendingCleanup.current) {
      await wait(100)
    }

    for (let i = 0; i < 5; i++) {
      try {
        return await init();
      } catch (err) {
        if (i == 4) {
          throw err;
        }
      }
    }
  }, [init]);

  useEffect(() => {
    setInitialized(false);

    rawDispatch({
      __turbo__type: "RESET",
    } as A);

    if (turboEdge && topic && !topic.startsWith("@turbo-ing")) {
      let destructor: (() => Promise<void>) | null;

      const promise = initWithRetry()
        .then((result) => {
          if (result) {
            destructor = result;
          } else {
            destructor = null;
          }
          pendingCleanup.current = true
          return destructor;
        })
        .catch((err) => {
          console.error(err);
          destructor = null;
          return destructor;
        });

      return () => {
        if (typeof destructor === "undefined") {
          promise.then((result) => {
            if (result) {
              result().finally(() => {
                pendingCleanup.current = false
              });
            }
          });
        } else {
          if (destructor) {
            destructor().finally(() => {
              pendingCleanup.current = false
            });
          }
        }
      };
    }
  }, [turboEdge, topic]);

  useEffect(() => {
    if (
      statePublishingTarget.length > 0 &&
      turboEdge &&
      stateInitialized.current
    ) {
      const peerId = turboEdge.node.peerId.toString();
      const systemTopic = `@turbo-ing/edge-v0/${peerId}/${topic}`;
      turboEdge.node.services.pubsub.publish(
        systemTopic,
        fromString(
          JSON.stringify({
            type: "PUBLISH_STATE",
            payload: state,
          })
        )
      );
    }
  }, [turboEdge, statePublishingTarget, state]);

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
    const res = await fetch(
      turboEdge.p2pRelay + "/get-peers/" + encodeURIComponent(topic)
    ).then((res) => res.json());

    if (res.peers) {
      // const peers: string[] = res.peers.length > 21 ? res.peers.slice(res.peers.length - 21) : res.peers
      const peers: string[] = res.peers; // Floodsub require all peers
      const promises: Promise<string | void>[] = [];

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
          );
        }
      }

      const connectedPeers = await Promise.all(promises);

      return connectedPeers.filter((x) => typeof x === "string");
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

// Register game info to the DA Proxy
// This is used to inform the DA Proxy that the game is running on the edge node
async function registerGameInfo(turboEdge: TurboEdgeContextBody, topic: string, gameId: string, sessionId: string) {
  const selfPeerId = turboEdge.node.peerId.toString();

  const response = await fetch(turboEdge.daProxy + "/game/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ peerId: selfPeerId, topic, gameId, sessionId }),
  });

  if (!response.ok) {
    throw new Error("Register game info failed");
  }
}

// Remove game info from the DA Proxy
// This is used to inform the DA Proxy that the game is no longer running on the edge node
async function removeGameInfo(turboEdge: TurboEdgeContextBody, topic: string, gameId: string, sessionId: string) {
  const selfPeerId = turboEdge.node.peerId.toString();

  const response = await fetch(turboEdge.daProxy + "/game/remove", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ peerId: selfPeerId, topic, gameId, sessionId }),
  });

  if (!response.ok) {
    throw new Error("Remove game info failed");
  }
}

async function getGameInfo(turboEdge: TurboEdgeContextBody, gameId: string, topic: string) {
  const response = await fetch(`${turboEdge.daProxy}/game/${encodeURIComponent(gameId)}/${encodeURIComponent(topic)}`);
  if (!response.ok) {
    throw new Error("Get game info failed");
  }

  console.log("response", JSON.stringify(response));

  return response.json();
}
