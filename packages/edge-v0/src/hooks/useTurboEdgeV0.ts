import { useContext } from "react";
import { TurboEdgeContext } from "../providers/TurboEdgeProviderV0";

export function useTurboEdgeV0() {
  const turboEdge = useContext(TurboEdgeContext);

  if (!turboEdge?.connected) return undefined

  return turboEdge
}