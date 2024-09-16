import { EdgeAction } from "@turbo-ing/edge-v0";

export type Message = {
  message: string;
  peerId: string;
};

export interface ChatState {
  messages: Message[];
  names: { [peerId: string]: string };
}

interface ReceiveMessageAction extends EdgeAction<ChatState> {
  type: 'MESSAGE';
  payload: {
    message: string;
  };
}

interface SetRecipientNameAction extends EdgeAction<ChatState> {
  type: 'SET_RECIPIENT_NAME';
  payload: {
    name: string;
  };
}

export type ChatAction = ReceiveMessageAction | SetRecipientNameAction;

export const initialState: ChatState = {
  messages: [],
  names: {},
};

export function chatReducer(
  state: ChatState = initialState,
  action: ChatAction
): ChatState {
  if (!action.peerId) return state

  switch (action.type) {
    case 'MESSAGE': {
      const { message } = action.payload;

      return {
        ...state,
        messages: [
          ...state.messages,
          {
            message,
            peerId: action.peerId,
          },
        ],
      };
    }
    case 'SET_RECIPIENT_NAME': {
      const { name } = action.payload;
      return {
        ...state,
        names: {
          ...state.names,
          [action.peerId]: name,
        },
      };
    }
    default:
      return state;
  }
}