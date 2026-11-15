import { sql } from "./config/db.js";

// Socket.IO Room State: roomId -> Map<socketId, participantObject>
const rooms = new Map();

// In-memory room collaboration state for late-joiners & page refresh
// roomId -> { whiteboardStrokes: [], code: { cpp: string, java: string }, language: string, stdin: string }
const roomStates = new Map();

const DEFAULT_CODE = {
  cpp: `// C++ (GCC 9.2.0) - Real-time Collaborative IDE
#include <iostream>
#include <vector>
#include <string>

using namespace std;

int main() {
    cout << "Welcome to Meeto Live IDE!" << endl;
    
    string name;
    if (cin >> name) {
        cout << "Hello, " << name << "!" << endl;
    }
    
    return 0;
}`,
  java: `// Java (JDK 17.0.6) - Real-time Collaborative IDE
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        System.out.println("Welcome to Meeto Live IDE!");
        
        Scanner scanner = new Scanner(System.in);
        if (scanner.hasNext()) {
            String name = scanner.next();
            System.out.println("Hello, " + name + "!");
        }
    }
}`,
};

function getOrCreateRoomState(roomId) {
  if (!roomStates.has(roomId)) {
    roomStates.set(roomId, {
      whiteboardStrokes: [],
      code: { ...DEFAULT_CODE },
      language: "cpp",
      stdin: "",
    });
  }
  return roomStates.get(roomId);
}

export function setupSocketIO(io) {
  io.on("connection", (socket) => {
    let currentRoomId = null;
    let currentUser = null;

    // ── 1. User joins a meeting room ──────────────────────────────────────────
    socket.on("join-room", async ({ roomId, user, audioEnabled = true, videoEnabled = true }) => {
      try {
        if (!roomId) return;
        currentRoomId = roomId;

        let meeting = null;
        try {
          const meetings = await sql`SELECT * FROM meetings WHERE meeting_id = ${roomId}`;
          if (meetings.length > 0) {
            meeting = meetings[0];
            if (meeting.status === "ended") {
              socket.emit("meeting-ended", { message: "This meeting has already ended." });
              return;
            }
          }
        } catch (dbErr) {
          console.warn("Could not verify meeting from DB (continuing in memory):", dbErr.message);
        }

        const isHost = Boolean(
          meeting?.host_id && user?.id && meeting.host_id.toString() === user.id.toString()
        );

        currentUser = {
          socketId: socket.id,
          userId: user?.id || null,
          userName: user?.name || user?.fullName || "Participant",
          isHost,
          audioEnabled,
          videoEnabled,
        };

        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Map());
        }

        const roomParticipants = rooms.get(roomId);

        // Capacity check (10 Free, 100 Premium)
        if (meeting) {
          try {
            const hosts = await sql`SELECT plan FROM users WHERE id = ${meeting.host_id}`;
            const hostPlan = hosts[0]?.plan || "free";
            const maxParticipants = hostPlan === "premium" ? 100 : 10;
            if (roomParticipants.size >= maxParticipants) {
              socket.emit("meeting-ended", {
                message: `Meeting capacity limit reached (max ${maxParticipants} participants for ${hostPlan.toUpperCase()} plan).`,
              });
              return;
            }
          } catch {
            // Ignore plan check if query fails
          }
        }

        // Join the Socket.IO room channel
        socket.join(roomId);

        // Get list of existing users currently in the room (excluding this socket)
        const existingUsers = Array.from(roomParticipants.values()).filter(
          (p) => p.socketId !== socket.id
        );

        // Save current user to room participants map
        roomParticipants.set(socket.id, currentUser);

        // Safely record participant in DB (do not fail socket join if DB insert fails)
        if (meeting?.id) {
          try {
            const userId = user?.id || null;
            const existing = await sql`
              SELECT id FROM meeting_participants
              WHERE meeting_id = ${meeting.id}
              AND ((${userId}::text IS NOT NULL AND user_id = ${userId}) OR name = ${currentUser.userName})
              LIMIT 1
            `;
            if (existing.length === 0) {
              await sql`
                INSERT INTO meeting_participants (meeting_id, user_id, name, joined_at)
                VALUES (${meeting.id}, ${userId}, ${currentUser.userName}, NOW())
              `;
            }
          } catch (pErr) {
            console.warn("Participant DB logging warning:", pErr.message);
          }
        }

        // Fetch collaboration state for this room (whiteboard drawings, current code, stdin)
        const state = getOrCreateRoomState(roomId);

        // Send existing room state to the newly connected user
        socket.emit("room-sync", {
          existingUsers,
          whiteboardStrokes: state.whiteboardStrokes,
          code: state.code,
          language: state.language,
          stdin: state.stdin,
        });

        // Also emit legacy all-users for WebRTC compatibility
        socket.emit("all-users", existingUsers);

        // Notify other peers in the room
        socket.to(roomId).emit("user-joined", currentUser);
      } catch (err) {
        console.error("Error in join-room:", err);
      }
    });

    // ── 2. WebRTC Signaling ───────────────────────────────────────────────────
    socket.on("offer", ({ targetSocketId, callerSocketId, sdp }) => {
      io.to(targetSocketId).emit("offer", {
        callerSocketId,
        sdp,
        callerUser: currentUser,
      });
    });

    socket.on("answer", ({ targetSocketId, responderSocketId, sdp }) => {
      io.to(targetSocketId).emit("answer", {
        responderSocketId,
        sdp,
      });
    });

    socket.on("ice-candidate", ({ targetSocketId, senderSocketId, candidate }) => {
      io.to(targetSocketId).emit("ice-candidate", {
        senderSocketId,
        candidate,
      });
    });

    socket.on("toggle-audio", ({ roomId, audioEnabled }) => {
      const targetRoom = roomId || currentRoomId;
      if (targetRoom && rooms.has(targetRoom) && rooms.get(targetRoom).has(socket.id)) {
        rooms.get(targetRoom).get(socket.id).audioEnabled = audioEnabled;
      }
      if (targetRoom) {
        socket.to(targetRoom).emit("user-toggled-audio", {
          socketId: socket.id,
          audioEnabled,
        });
      }
    });

    socket.on("toggle-video", ({ roomId, videoEnabled }) => {
      const targetRoom = roomId || currentRoomId;
      if (targetRoom && rooms.has(targetRoom) && rooms.get(targetRoom).has(socket.id)) {
        rooms.get(targetRoom).get(socket.id).videoEnabled = videoEnabled;
      }
      if (targetRoom) {
        socket.to(targetRoom).emit("user-toggled-video", {
          socketId: socket.id,
          videoEnabled,
        });
      }
    });

    // ── 3. Chat Messages ──────────────────────────────────────────────────────
    socket.on("send-message", async ({ roomId, message }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom || !message) return;

      const messagePayload = {
        ...message,
        id: message.id || Date.now().toString(),
        senderSocketId: socket.id,
      };

      // Broadcast immediately to everyone in the room (including sender)
      io.in(targetRoom).emit("receive-message", messagePayload);

      // Persist to database asynchronously
      try {
        const meetings = await sql`SELECT id, status FROM meetings WHERE meeting_id = ${targetRoom}`;
        if (meetings.length > 0 && meetings[0].status !== "ended") {
          const meetingId = meetings[0].id;
          const senderId = message.senderId || null;
          await sql`
            INSERT INTO meeting_messages (meeting_id, sender_id, sender_name, text, timestamp)
            VALUES (${meetingId}, ${senderId}, ${message.senderName || "Anonymous"}, ${message.text}, NOW())
          `;
        }
      } catch (err) {
        console.warn("Could not save chat message to DB:", err.message);
      }
    });

    // ── 4. Whiteboard Collaborative Events ────────────────────────────────────
    socket.on("whiteboard-segment", ({ roomId, stroke }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom) return;
      socket.to(targetRoom).emit("whiteboard-segment", { stroke });
    });

    socket.on("whiteboard-preview", ({ roomId, stroke }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom) return;
      socket.to(targetRoom).emit("whiteboard-preview", { stroke });
    });

    socket.on("whiteboard-commit", ({ roomId, stroke }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom) return;

      // Cache stroke in memory for late-joiners
      const state = getOrCreateRoomState(targetRoom);
      if (stroke) {
        state.whiteboardStrokes.push(stroke);
      }

      socket.to(targetRoom).emit("whiteboard-commit", { stroke });
    });

    socket.on("whiteboard-clear", ({ roomId }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom) return;

      const state = getOrCreateRoomState(targetRoom);
      state.whiteboardStrokes = [];

      socket.to(targetRoom).emit("whiteboard-clear");
    });

    // ── 5. Code Editor Collaborative Events ───────────────────────────────────
    socket.on("code-change", ({ roomId, lang, code }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom) return;

      // Update in-memory code state
      const state = getOrCreateRoomState(targetRoom);
      if (lang && code !== undefined) {
        state.code[lang] = code;
      }

      socket.to(targetRoom).emit("code-change", {
        lang,
        code,
        from: socket.id,
      });
    });

    socket.on("code-language", ({ roomId, lang }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom || !lang) return;

      const state = getOrCreateRoomState(targetRoom);
      state.language = lang;

      socket.to(targetRoom).emit("code-language", {
        lang,
        from: socket.id,
      });
    });

    socket.on("code-cursor", ({ roomId, line, column, name, color }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom) return;

      socket.to(targetRoom).emit("code-cursor", {
        socketId: socket.id,
        line,
        column,
        name: name || currentUser?.userName || "Peer",
        color,
      });
    });

    socket.on("code-input", ({ roomId, stdin }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom) return;

      const state = getOrCreateRoomState(targetRoom);
      state.stdin = stdin || "";

      socket.to(targetRoom).emit("code-input", {
        stdin,
        from: socket.id,
      });
    });

    socket.on("code-output", ({ roomId, output, status, isError, time, memory, ranBy }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom) return;

      socket.to(targetRoom).emit("code-output", {
        output,
        status,
        isError,
        time,
        memory,
        ranBy: ranBy || currentUser?.userName || "Someone",
      });
    });

    // ── 6. Host Ends Meeting ──────────────────────────────────────────────────
    socket.on("end-meeting", async ({ roomId }) => {
      const targetRoom = roomId || currentRoomId;
      if (!targetRoom) return;

      try {
        await sql`
          UPDATE meetings
          SET status = 'ended', ended_at = NOW()
          WHERE meeting_id = ${targetRoom}
        `;
      } catch (err) {
        console.warn("Error marking meeting as ended in DB:", err.message);
      }

      // Fix: io.to(targetRoom), not io.on
      io.to(targetRoom).emit("meeting-ended", {
        message: "The meeting has been ended by the host.",
      });

      rooms.delete(targetRoom);
      roomStates.delete(targetRoom);
    });

    // ── 7. Disconnect Handler ─────────────────────────────────────────────────
    socket.on("disconnect", () => {
      if (currentRoomId && rooms.has(currentRoomId)) {
        const roomParticipants = rooms.get(currentRoomId);
        roomParticipants.delete(socket.id);

        if (roomParticipants.size === 0) {
          // If nobody is left, delete after 5 minutes of inactivity
          setTimeout(() => {
            if (rooms.get(currentRoomId)?.size === 0) {
              rooms.delete(currentRoomId);
              roomStates.delete(currentRoomId);
            }
          }, 300000);
        } else {
          // Notify remaining peers that a user disconnected
          socket.to(currentRoomId).emit("user-left", {
            socketId: socket.id,
            user: currentUser,
          });
        }
      }
    });
  });
}
