import { useEffect, useState } from "react";
import { usePingReducer } from "./reducers/ping";
import { useTurboEdgeV0 } from "@turbo-ing/edge-v0";

export default function PingPeers({
  roomId,
  names,
}: {
  roomId: string;
  names: { [peerId: string]: string };
}) {
  const [state, peers] = usePingReducer(roomId);
  const turboEdge = useTurboEdgeV0();
  const peerId = turboEdge?.node.peerId.toString();

  const [minPing, setMinPing] = useState(0);
  const [maxPing, setMaxPing] = useState(0);
  const [medPing, setMedPing] = useState(0);

  useEffect(() => {
    if (turboEdge && peerId) {
      const pings: number[] = Object.values(state.ping);

      // for (const sourcePeerId in state.ping) {
      //   if (sourcePeerId.startsWith(peerId)) {
      //     pings.push(state.ping[sourcePeerId]);
      //   }
      // }

      pings.sort();

      setMinPing(pings[0] || 0);
      setMaxPing(pings[pings.length - 1] || 0);

      if (pings.length % 2 == 0) {
        setMedPing(
          ((pings[Math.floor(pings.length / 2) - 1] || 0) +
            (pings[Math.floor(pings.length / 2)] || 0)) /
            2
        );
      } else {
        setMedPing(pings[Math.floor(pings.length / 2)] || 0);
      }
    }
  }, [state, turboEdge]);

  if (!roomId || !peerId) return <div></div>;

  return (
    <>
      <div>Connected Peers: {peers.length}</div>
      <div>
        Ping: {minPing}ms - {maxPing}ms (Med: {medPing}ms)
      </div>

      <ul>
        {Object.entries(state.ping).map(([peerId, ping]) => (
          <li key={peerId}>
            {names[peerId] || peerId}: {ping}ms
          </li>
        ))}
      </ul>
    </>
  );
}
