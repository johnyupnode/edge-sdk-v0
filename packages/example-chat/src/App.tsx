import { useEdgeReducerV0 } from "@turbo-ing/edge-v0";
import { useState } from "react";
import { chatReducer, initialState } from "./reducers/chat";

function App() {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [roomIdCommitted, setRoomIdCommitted] = useState("");
  const [message, setMessage] = useState("");

  const [state, dispatch, initialized] = useEdgeReducerV0(
    chatReducer,
    initialState,
    {
      topic: roomIdCommitted,
    }
  );

  return (
    <>
      <div className="container mx-auto p-4">
        <div className="flex flex-col justify-center">
          <div className="flex gap-3 mb-3">
            <input
              className="p-2 px-3 rounded w-full"
              placeholder="Enter Your Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            ></input>
          </div>

          <div className="flex gap-3">
            <input
              className="p-2 px-3 rounded w-full"
              placeholder="Enter Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            ></input>
            <button
              className="bg-white rounded px-6 text-xl font-bold hover:bg-gray-200 transition"
              onClick={() => setRoomIdCommitted(roomId)}
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

          {roomIdCommitted && initialized && (
            <div className="bg-white rounded w-full mt-4">
              <div className="border-b border-gray-400 font-bold py-3 px-4">
                Room ID: {roomIdCommitted}
              </div>

              <div className="py-3 px-4 flex flex-col gap-3 border-b border-gray-400">
                {state.messages.length == 0 && <div>~~~ No messages ~~~</div>}

                {state.messages.map((message, i) => (
                  <div key={i}>
                    <div className="text-sm font-bold mb-1 truncate text-ellipsis">{message.peerId}</div>
                    <div className="text-sm">{message.message}</div>
                  </div>
                ))}
              </div>

              <div className="flex">
                <input
                  className="px-4 py-2 w-full"
                  placeholder="Enter Your Message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                ></input>
                <button
                  className="bg-white rounded px-6 font-bold bg-[#d8e4da]"
                  onClick={() =>
                    dispatch({
                      type: "MESSAGE",
                      payload: {
                        message,
                      },
                    })
                  }
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default App;
