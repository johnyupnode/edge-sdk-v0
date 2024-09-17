import { generateKeyPairFromSeed } from "@libp2p/crypto/keys";

const fromHexString = (hexString: string) =>
  Uint8Array.from(
    hexString.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

// This make the session persistent to page refresh
export async function getP2PKey(p2pPrivateKey?: string) {
  const existingKey =
    p2pPrivateKey ||
    window.sessionStorage.getItem("___TURBO___P2P_KEY") ||
    Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

  window.sessionStorage.setItem("___TURBO___P2P_KEY", existingKey);

  return generateKeyPairFromSeed("Ed25519", fromHexString(existingKey));
}
