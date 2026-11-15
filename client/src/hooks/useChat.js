import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../config/socket";

export const useChat = (roomId, user) => {
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const isChatOpenRef = useRef(isChatOpen);
  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);

  useEffect(() => {
    if (!roomId) return;

    const handleReceiveMessage = (message) => {
      setMessages((prev) => {
        // Prevent duplicate messages if any
        if (message.id && prev.some((m) => m.id === message.id)) {
          return prev;
        }
        return [...prev, message];
      });

      if (!isChatOpenRef.current) {
        setUnreadCount((prev) => prev + 1);
      }
    };

    socket.on("receive-message", handleReceiveMessage);

    return () => {
      socket.off("receive-message", handleReceiveMessage);
    };
  }, [roomId]);

  const sendMessage = useCallback(
    (text) => {
      if (!text || !text.trim() || !user) return;

      const messagePayload = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        text: text.trim(),
        senderName: user.name || user.fullName || "You",
        senderId: user.id,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      socket.emit("send-message", { roomId, message: messagePayload });
    },
    [roomId, user]
  );

  const toggleChat = useCallback(() => {
    setIsChatOpen((prev) => {
      if (!prev) setUnreadCount(0);
      return !prev;
    });
  }, []);

  return {
    messages,
    sendMessage,
    unreadCount,
    isChatOpen,
    toggleChat,
  };
};
