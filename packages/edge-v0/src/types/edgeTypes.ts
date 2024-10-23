import {Libp2p, PubSub} from "@libp2p/interface";
import {Identify} from "@libp2p/identify";

export interface EdgeAction<S> {
  peerId?: string;
  __turbo__type?: string;
  __turbo__payload?: S;
}

export type Libp2pNode = Libp2p<{
  identify: Identify;
  pubsub: PubSub;
}>;

export interface TurboEdgeContextBody {
  node: Libp2pNode;
  p2pRelay: string;
  addrPrefix: string;
  connected: boolean;
}