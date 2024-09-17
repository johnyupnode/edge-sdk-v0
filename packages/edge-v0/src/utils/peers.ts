import { TurboEdgeContextBody } from "../providers"

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function ensurePeers(turboEdge: TurboEdgeContextBody, topic: string, timeout: number) {
  let totalWait = 0

  while (totalWait < timeout) {
    const peers = turboEdge.node.services.pubsub.getSubscribers(topic)
    if (peers.length > 0) {
      return true
    }
    await wait(50)
    totalWait += 50
  }

  return false
}