import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../config/socket";

export const useWhiteboard = (roomId) => {
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  // Store all committed strokes for redrawing
  const strokesRef = useRef([]);

  const toggleWhiteboard = useCallback(() => {
    setIsWhiteboardOpen((prev) => !prev);
  }, []);

  // Broadcast a completed stroke to peers
  const emitStroke = useCallback(
    (stroke) => {
      if (!roomId) return;
      socket.emit("whiteboard-stroke", { roomId, stroke });
    },
    [roomId]
  );

  // Broadcast clear-board to peers
  const emitClear = useCallback(() => {
    if (!roomId) return;
    socket.emit("whiteboard-clear", { roomId });
  }, [roomId]);

  return {
    isWhiteboardOpen,
    toggleWhiteboard,
    strokesRef,
    emitStroke,
    emitClear,
  };
};
