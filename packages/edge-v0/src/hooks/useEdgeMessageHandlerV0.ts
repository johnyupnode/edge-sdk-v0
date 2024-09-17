import { useEffect } from "react";
import { useTurboEdgeV0 } from "./useTurboEdgeV0";
import { Message, SignedMessage } from "@libp2p/interface";
import { toString } from "uint8arrays";

export function useEdgeMessageHandlerV0<A>(topic: string, handler: (action: A, event: CustomEvent<SignedMessage>) => any) {
  const turboEdge = useTurboEdgeV0()

  useEffect(() => {
    if (topic && turboEdge) {
      const managedHandler = async (event: CustomEvent<Message>) => {
        const eventTopic = event.detail.topic;

        if (eventTopic == topic) {
          const message: string = toString(event.detail.data);
          const action: A = JSON.parse(message);

          return handler(action, event as CustomEvent<SignedMessage>)
        }
      }

      turboEdge.node.services.pubsub.addEventListener("message", managedHandler);

      return () => turboEdge.node.services.pubsub.removeEventListener("message", managedHandler)
    }
  }, [topic, handler, turboEdge])
}