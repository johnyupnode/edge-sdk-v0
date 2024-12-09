import React, {ReactNode, useCallback, useEffect, useRef, useState,} from "react";
import {noise} from "@chainsafe/libp2p-noise";
import {yamux} from "@chainsafe/libp2p-yamux";
import {circuitRelayTransport} from "@libp2p/circuit-relay-v2";
import {dcutr} from "@libp2p/dcutr";
import {webRTC} from "@libp2p/webrtc";
import {webSockets} from "@libp2p/websockets";
import {createLibp2p} from "libp2p";
import {floodsub} from "@libp2p/floodsub";
import {identify} from "@libp2p/identify";
import * as filters from "@libp2p/websockets/filters";
import {shuffleArray} from "../utils/shuffle";
import {multiaddr} from "@multiformats/multiaddr";
import {getP2PKey} from "../utils/p2pKey";
import {ensureLibp2pPeers} from "../utils/peers";
import {TurboEdgeContextBody} from "../types";
import {TurboEdgeContext} from "../context";

export function TurboEdgeProviderV0({
                                      p2pRelay = "p2p-relay-v0.turbo.ing",
                                      daProxy = "http://localhost:3000",
                                      p2pPrivateKey,
                                      children,
                                    }: {
  p2pRelay?: string;
  daProxy?: string;
  p2pPrivateKey?: string;
  children: ReactNode;
}) {
  const [value, setValue] = useState<TurboEdgeContextBody>();
  const initialized = useRef(false);
  const reconnecting = useRef(false);
  const healthcheckInterval = useRef(Date.now());

  const buildLibp2p = useCallback(async () => {
    const privateKey = await getP2PKey(p2pPrivateKey);

    return await createLibp2p({
      privateKey,
      addresses: {
        listen: [
          // create listeners for incoming WebRTC connection attempts on on all
          // available Circuit Relay connections
          "/webrtc",
        ],
      },
      transports: [
        // the WebSocket transport lets us dial a local relay
        webSockets({
          // this allows non-secure WebSocket connections for purposes of the demo
          filter: filters.all,
        }),
        // support dialing/listening on WebRTC addresses
        webRTC({
          rtcConfiguration: {
            iceServers: [
              {
                urls: [
                  "stun:stun.l.google.com:19302",
                  "stun:global.stun.twilio.com:3478",
                  "stun:stun.cloudflare.com:3478",
                  "stun:stun.services.mozilla.com:3478",
                  "stun:stun.relay.metered.ca:80",
                ],
              },
              {
                urls: "turn:global.relay.metered.ca:80",
                username: "694db5e49dbd59234f01c4af",
                credential: "gnvTZJAcbL6Tgo7I",
              },
              {
                urls: "turn:global.relay.metered.ca:80?transport=tcp",
                username: "694db5e49dbd59234f01c4af",
                credential: "gnvTZJAcbL6Tgo7I",
              },
              {
                urls: "turn:global.relay.metered.ca:443",
                username: "694db5e49dbd59234f01c4af",
                credential: "gnvTZJAcbL6Tgo7I",
              },
              {
                urls: "turns:global.relay.metered.ca:443?transport=tcp",
                username: "694db5e49dbd59234f01c4af",
                credential: "gnvTZJAcbL6Tgo7I",
              },
            ],
          },
        }),
        // support dialing/listening on Circuit Relay addresses
        circuitRelayTransport({
          // make a reservation on any discovered relays - this will let other
          // peers use the relay to contact us
          discoverRelays: 1,
        }),
      ],
      // a connection encrypter is necessary to dial the relay
      connectionEncrypters: [noise()],
      // a stream muxer is necessary to dial the relay
      streamMuxers: [yamux()],
      connectionGater: {
        denyDialMultiaddr: () => {
          // by default we refuse to dial local addresses from browsers since they
          // are usually sent by remote peers broadcasting undialable multiaddrs and
          // cause errors to appear in the console but in this example we are
          // explicitly connecting to a local node so allow all addresses
          return false;
        },
      },
      services: {
        identify: identify(),
        // pubsub: gossipsub({
        //   allowPublishToZeroTopicPeers: true,
        //   gossipFactor: 1,
        // }),
        pubsub: floodsub(),
        dcutr: dcutr(),
      },
    });
  }, [p2pPrivateKey]);

  const reconnect = useCallback(
    async (value: TurboEdgeContextBody) => {
      if (value && !reconnecting.current) {
        try {
          reconnecting.current = true;

          let requireReconnect = false;

          if (Date.now() - healthcheckInterval.current > 2000) {
            setValue((value) =>
              value
                ? {
                  ...value,
                  connected: false,
                }
                : undefined
            );

            requireReconnect = true;
          }

          const peerId = value.node.peerId.toString();
          const statusResponse = await fetch(
            `${value.p2pRelay}/peer-status/${peerId}`
          );

          if (statusResponse.status == 200) {
            const { connected } = await statusResponse.json();

            if (!connected) {
              const node = await buildLibp2p();
              await node.dial(multiaddr(value.addrPrefix));
              await ensureLibp2pPeers(node)

              setValue((value) =>
                value
                  ? {
                    ...value,
                    node,
                    connected: true,
                  }
                  : undefined
              );
            } else {
              if (requireReconnect) {
                setValue((value) =>
                  value
                    ? {
                      ...value,
                      connected: true,
                    }
                    : undefined
                );
              }
            }
          } else {
            await reconnect(value);
          }
        } finally {
          reconnecting.current = false;
        }
      }
    },
    [reconnecting]
  );

  const init = useCallback(async (): Promise<TurboEdgeContextBody> => {
    if (initialized.current)
      throw new Error(
        "Turbo Edge has been initializing twice. This is normal for the development environment, so you can safely ignore this error."
      );

    initialized.current = true;

    const node = await buildLibp2p();

    let addrPrefix = "";

    // Fetch addrPrefix from dns
    {
      // Construct TXT record dnsaddr domain from P2P Relay
      const dnsDomain =
        "_dnsaddr." +
        (p2pRelay.startsWith("https") ? p2pRelay.substring(8) : p2pRelay);

      // Construct the URL with the domain and query type (TXT)
      const url = `https://dns.google/resolve?name=${encodeURIComponent(
        dnsDomain
      )}&type=TXT`;

      // Make the request to Google's DNS resolver
      const response = await fetch(url);

      // Parse the JSON response
      const data = await response.json();

      let addresses: string[] = [];

      // Check if the response contains answer data
      if (data.Answer) {
        // Extract TXT records from the response
        const records: string[] = data.Answer.map((answer: any) => answer.data);

        for (const record of records) {
          const dnsaddrs = record
            .split(/\s+/)
            .filter((x) => x.startsWith("dnsaddr="))
            .map((x) => x.substring(8));
          for (const dnsaddr of dnsaddrs) {
            addresses.push(dnsaddr);
          }
        }
      }

      addresses = shuffleArray(addresses);

      for (const address of addresses) {
        try {
          await node.dial(multiaddr(address));
          addrPrefix = address;
          break;
        } catch (err) {}
      }
    }

    if (!addrPrefix) {
      throw new Error("No working relay available");
    }

    const value: TurboEdgeContextBody = {
      node,
      p2pRelay: p2pRelay.startsWith("https") ? p2pRelay : "https://" + p2pRelay,
      // daProxy: daProxy.startsWith("https") ? daProxy : "https://" + daProxy,
      daProxy: daProxy,
      addrPrefix,
      connected: true,
    };

    await ensureLibp2pPeers(node)

    console.debug("Turbo Edge initialized successfully");

    return value;
  }, [p2pRelay]);

  useEffect(() => {
    try {
      init()
        .then((x) => setValue(x))
        .catch((err) => {
          if (
            err.message !=
            "Turbo Edge has been initializing twice. This is normal for the development environment, so you can safely ignore this error."
          ) {
            console.error("Failed to initialize Turbo Edge", err);
          }
        });
    } catch (err) {
      console.error("Failed to initialize Turbo Edge", err);
    }
  }, []);

  useEffect(() => {
    if (value) {
      healthcheckInterval.current = Date.now();

      const healthcheckIntervalController = setInterval(() => {
        healthcheckInterval.current = Date.now();
      }, 500);

      const handleFocus = () => reconnect(value);
      window.addEventListener("focus", handleFocus);

      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          reconnect(value);
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);

      return () => {
        clearInterval(healthcheckIntervalController);
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange
        );
      };
    }
  }, [value]);

  return (
    <TurboEdgeContext.Provider value={value}>
      {children}
    </TurboEdgeContext.Provider>
  );
}