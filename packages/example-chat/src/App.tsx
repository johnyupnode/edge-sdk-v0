import { useEdgeReducerV0, useTurboEdgeV0 } from "@turbo-ing/edge-v0";
import { useEffect, useState } from "react";
import { chatReducer, initialState } from "./reducers/chat";
import TurboLogo from "./assets/turbo-logo.svg";
import PingPeers from "./PingPeers";

function App() {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [roomIdCommitted, setRoomIdCommitted] = useState("");
  const [message, setMessage] = useState("");

  const [state, dispatch, connected] = useEdgeReducerV0(
    chatReducer,
    initialState,
    {
      topic: roomIdCommitted,
    }
  );

  const turboEdge = useTurboEdgeV0();

  useEffect(() => {
    if (connected) {
      dispatch({
        type: "SET_RECIPIENT_NAME",
        payload: {
          name,
        },
      });
    }
  }, [name, dispatch, connected, roomIdCommitted]);

  return (
    <>
      <div className="container mx-auto p-4">
        <div className="flex flex-col justify-center">
          <div className="mb-5">
            <div className="flex items-center justify-center mb-2">
              <div>
                <img src={TurboLogo} width={190}></img>
              </div>
              <div className="text-white text-4xl font-bold">CHAT</div>
            </div>

            <div className="text-center text-white text-lg">
              100% P2P group chat, zero servers
            </div>
            <div className="text-center text-white text-lg font-bold">
              Powered by Turbo Edge
            </div>
          </div>

          <div className="flex gap-3 mb-3">
            <input
              className="p-2 px-3 rounded w-full"
              placeholder="Enter Your Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!turboEdge}
            ></input>
          </div>

          <div className="flex gap-3">
            <input
              className="p-2 px-3 rounded w-full"
              placeholder="Enter Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={!turboEdge}
            ></input>
            <button
              className="bg-white rounded px-6 text-xl font-bold hover:bg-gray-200 transition"
              onClick={() => setRoomIdCommitted(roomId)}
              disabled={!turboEdge}
            >
              Join
            </button>
          </div>

          <div className="text-sm text-white mt-1">
            <i>
              Hint: Enter any Room ID; they're all public. Just share the
              correct one with your friend.
            </i>
          </div>

          {roomIdCommitted &&
            (connected ? (
              <div className="bg-white rounded w-full mt-4">
                <div className="border-b border-gray-400 font-bold py-3 px-4">
                  Room ID: {roomIdCommitted}
                </div>

                <div className="py-3 px-4 flex flex-col gap-3 border-b border-gray-400">
                  {state.messages.length == 0 && <div>~~~ No messages ~~~</div>}

                  {state.messages.map((message, i) => (
                    <div key={i}>
                      <div className="text-sm font-bold truncate text-ellipsis">
                        {state.names[message.peerId] || message.peerId}
                      </div>
                      <div className="text-sm">{message.message}</div>
                    </div>
                  ))}
                </div>

                <form
                  className="flex"
                  onSubmit={(e) => {
                    e.preventDefault();
                    dispatch({
                      type: "MESSAGE",
                      payload: {
                        message,
                      },
                    });
                    setMessage("");
                  }}
                >
                  <input
                    className="px-4 py-2 w-full"
                    placeholder="Enter Your Message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  ></input>
                  <button
                    className="bg-white rounded px-6 font-bold bg-[#d8e4da]"
                    type="submit"
                  >
                    Send
                  </button>
                </form>
              </div>
            ) : (
              <div className="text-lg text-white mt-4">Connecting...</div>
            ))}

          <div className="mt-4 text-xs text-gray-200">
            <div className="truncate">
              Peer ID: {turboEdge?.node.peerId.toString()}
            </div>
            <div className="mt-0.5">
              Status: {turboEdge?.node.status}
            </div>
            <div className="mt-0.5 flex flex-col gap-0.5">
              <PingPeers
                roomId={roomIdCommitted}
                names={state.names}
              ></PingPeers>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
