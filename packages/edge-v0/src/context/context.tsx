import {createContext} from "react";
import {TurboEdgeContextBody} from "../types";

export const TurboEdgeContext = createContext<
  TurboEdgeContextBody | undefined
>(undefined);