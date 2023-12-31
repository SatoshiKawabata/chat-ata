import { ChatRoom } from "../entities/ChatRoom";
import { Message } from "../entities/Message";
import { ErrorCodes, UseCaseError } from "../errors/UseCaseError";
import { ChatRoomGatewayPort } from "../ports/ChatRoomGatewayPort";
import {
  MessageGatewayPort,
  PostMessageProps,
} from "../ports/MessageGatewayPort";
import { MessageGeneratorGatewayPort } from "../ports/MessageGeneratorGatewayPort";
import { MessageSchedulerPort } from "../ports/MessageSchedulerPort";
import { CreateUserProps, UserGatewayPort } from "../ports/UserGatewayPort";
import { generateMessageRecursive } from "../utils/MessageGenerateUtils";

type InitializeChatProps = {
  users: CreateUserProps[];
  chatRoomName: string;
};

export const initializeChat = async (
  p: InitializeChatProps,
  userGateway: UserGatewayPort,
  chatRoomGateway: ChatRoomGatewayPort
): Promise<string> => {
  // ユーザーの作成
  for (const user of p.users) {
    await userGateway.createUser(user);
  }
  const users = await Promise.all(
    p.users.map(async (user) => await userGateway.createUser(user))
  );
  // チャットルームの作成
  const room = await chatRoomGateway.createChatRoom({ name: p.chatRoomName });
  // チャットメンバーの追加
  await chatRoomGateway.addChatRoomMembers({
    roomId: room.id,
    userIds: users.map((user) => user.id),
  });
  return "success!";
};

// メッセージの投稿
export const postMessage = async (
  p: PostMessageProps,
  messageGatewayPort: MessageGatewayPort
): Promise<Message> => {
  // 親メッセージがあれば、親の子メッセージの紐づけを解除する
  if (p.parentMessageId) {
    const otherChildMsg = await messageGatewayPort.findChildMessage({
      parentId: p.parentMessageId,
    });

    if (otherChildMsg) {
      // p.parentMessageIdのメッセージがあれば子メッセージの紐づけを解除
      await messageGatewayPort.removeParentMessage({ id: otherChildMsg.id });
    }
  }

  // Gatewayのメッセージの投稿メソッドを呼ぶ
  const newMsg = await messageGatewayPort.postMessage({
    ...p,
  });

  // メッセージを返す
  return newMsg;
};

// 次のメッセージを取得
type RequestNextMessageProps = {
  messageId: Message["id"];
  roomId: ChatRoom["id"];
};

export const requestNextMessage = async (
  p: RequestNextMessageProps,
  messageGatewayPort: MessageGatewayPort,
  messageSchedulerPort: MessageSchedulerPort,
  chatRoomGatewayPort: ChatRoomGatewayPort,
  userGatewayPort: UserGatewayPort,
  messageGeneratorGatewayPort: MessageGeneratorGatewayPort
): Promise<Message> => {
  // 次のメッセージ(messageIdの子メッセージ)がDBにあれば返す
  const childMsg = await messageGatewayPort.findChildMessage({
    parentId: p.messageId,
  });
  if (childMsg) {
    return childMsg;
  }

  const isGenerating = await messageSchedulerPort.isRecursiveGenerating({
    currentMessageId: p.messageId,
  });
  if (isGenerating) {
    // 次のメッセージがDBにない かつ 再帰処理中の場合、
    // 再帰処理を待つためにMessageGatewayに対してポーリングを行って
    // 生成されたメッセージを返す
    const msg = await messageGatewayPort.pollingChildMessage({
      currentMessageId: p.messageId,
    });
    return msg;
  }
  // 次のメッセージがDBにない場合、次のメッセージを生成する再帰処理generateMessageRecursiveを呼ぶ
  const { nextMessage } = await generateMessageRecursive(
    {
      currentMessageId: p.messageId,
    },
    messageGatewayPort,
    messageSchedulerPort,
    chatRoomGatewayPort,
    userGatewayPort,
    messageGeneratorGatewayPort
  );
  // 再帰処理で生成したメッセージを返す
  return nextMessage;
};
