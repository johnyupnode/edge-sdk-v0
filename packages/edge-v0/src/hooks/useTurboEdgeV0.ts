import { useContext } from "react";
import { TurboEdgeContext } from "../providers/TurboEdgeProviderV0";

export function useTurboEdgeV0() {
  return useContext(TurboEdgeContext);
}