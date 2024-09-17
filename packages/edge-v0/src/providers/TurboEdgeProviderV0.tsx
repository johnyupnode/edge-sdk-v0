import React, {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Libp2p, PubSub } from "@libp2p/interface";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { dcutr } from "@libp2p/dcutr";
import { webRTC } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import { createLibp2p } from "libp2p";
import { Identify, identify } from "@libp2p/identify";
import * as filters from "@libp2p/websockets/filters";
import { shuffleArray } from "../utils/shuffle";
import { multiaddr } from "@multiformats/multiaddr";
import { getP2PKey } from "../utils/p2pKey";
import { createFromPrivKey } from "@libp2p/peer-id-factory";

export type Libp2pNode = Libp2p<{
  identify: Identify;
  pubsub: PubSub;
}>

export interface TurboEdgeContextBody {
  node: Libp2pNode;
  p2pRelay: string;
  addrPrefix: string;
}

const fromHexString = (hexString: string) =>
  Uint8Array.from(
    hexString.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

export const TurboEdgeContext = React.createContext<TurboEdgeContextBody | undefined>(
  undefined
);

export function TurboEdgeProviderV0({
  p2pRelay = "p2p-relay-v0.turbo.ing",
  p2pPrivateKey,
  children,
}: {
  p2pRelay?: string;
  p2pPrivateKey?: string;
  children: ReactNode;
}) {
  const [value, setValue] = useState<TurboEdgeContextBody>();
  const initialized = useRef(false)

  const init = useCallback(async (): Promise<TurboEdgeContextBody> => {
    if (initialized.current) throw new Error('Turbo Edge has been initializing twice. This is normal for the development environment, so you can safely ignore this error.')
    
    initialized.current = true

    const privateKey = await getP2PKey(p2pPrivateKey)
    const peerId = await createFromPrivKey(privateKey)
    
    const node = await createLibp2p({
      peerId,
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
        webRTC(),
        // support dialing/listening on Circuit Relay addresses
        circuitRelayTransport({
          // make a reservation on any discovered relays - this will let other
          // peers use the relay to contact us
          discoverRelays: 1,
        }),
      ],
      // a connection encrypter is necessary to dial the relay
      connectionEncryption: [noise()],
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
        pubsub: gossipsub({
          allowPublishToZeroTopicPeers: true,
          gossipFactor: 1,
        }),
        dcutr: dcutr(),
      },
      connectionManager: {
        minConnections: 0,
      },
    });

    let addrPrefix = "";

    // Fetch addrPrefix from dns
    {
      // Construct TXT record dnsaddr domain from P2P Relay
      const dnsDomain =
        "_dnsaddr." +
        (p2pRelay.startsWith("http") ? p2pRelay.substring(8) : p2pRelay);

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

    console.debug("Turbo Edge initialized successfully");

    return {
      node,
      p2pRelay: p2pRelay.startsWith("http") ? p2pRelay : "https://" + p2pRelay,
      addrPrefix,
    };
  }, [p2pRelay]);

  useEffect(() => {
    try {
      init()
        .then((x) => setValue(x))
        .catch((err) => {
          if (err.message != 'Turbo Edge has been initializing twice. This is normal for the development environment, so you can safely ignore this error.') {
            console.error("Failed to initialize Turbo Edge", err)
          }
        });
    } catch (err) {
      console.error("Failed to initialize Turbo Edge", err);
    }
  }, []);

  return (
    <TurboEdgeContext.Provider value={value}>
      {children}
    </TurboEdgeContext.Provider>
  );
}
