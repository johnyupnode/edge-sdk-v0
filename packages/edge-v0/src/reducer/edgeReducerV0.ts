import {EdgeAction} from "../types";

export function edgeReducerV0<S, A extends EdgeAction<S>>(
  state: S,
  action: A,
  reducer: (state: S, action: A) => S,
  initialValue: S,
  {
    onPayload,
    onReset,
  }: {
    onPayload?: (state: S) => any;
    onReset?: (previousState: S) => any;
  }
): S {
  switch (action.__turbo__type) {
    case "PAYLOAD":
      try {
        if (onPayload) onPayload(action.__turbo__payload!);
      } catch (err) {
        console.error(err);
      }

      return action.__turbo__payload!;

    case "RESET":
      try {
        if (onReset) onReset(state);
      } catch (err) {
        console.error(err);
      }

      return initialValue;
  }

  return reducer(state, action);
}