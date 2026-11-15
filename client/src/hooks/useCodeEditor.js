import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../config/socket";

// Distinct modern colors for users
const USER_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#8b5cf6", // purple
  "#06b6d4", // cyan
  "#f97316", // orange
  "#14b8a6", // teal
];

function getUserColor(id = "") {
  let h = 0;
  for (const c of String(id)) h = c.charCodeAt(0) + ((h << 5) - h);
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

const DEFAULT_CODE = {
  cpp: `// C++ (GCC 9.2.0) - Real-time Collaborative IDE
#include <iostream>
#include <vector>
#include <string>

using namespace std;

int main() {
    cout << "Welcome to Meeto Live IDE!" << endl;
    cout << "Enter custom input in the Stdin tab and click Run Code." << endl;
    
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
        System.out.println("Enter custom input in the Stdin tab and click Run Code.");
        
        Scanner scanner = new Scanner(System.in);
        if (scanner.hasNext()) {
            String name = scanner.next();
            System.out.println("Hello, " + name + "!");
        }
    }
}`,
};

export const useCodeEditor = (roomId, user) => {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [language, setLanguage] = useState("cpp");
  const [codes, setCodes] = useState(DEFAULT_CODE);
  const [stdin, setStdin] = useState("");
  const [output, setOutput] = useState({
    text: "",
    status: "",
    isError: false,
    time: null,
    memory: null,
    ranBy: null,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [remoteCursors, setRemoteCursors] = useState({}); // socketId -> { line, column, name, color }

  const debounceRef = useRef(null);
  const cursorDebounceRef = useRef(null);
  const myColor = getUserColor(user?.id);

  // ── Socket listeners ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;

    const onCodeChange = ({ lang, code, from }) => {
      if (from === socket.id) return;
      setCodes((prev) => ({ ...prev, [lang]: code }));
    };

    const onLangChange = ({ lang }) => {
      setLanguage(lang);
    };

    const onCursor = ({ socketId, line, column, name, color }) => {
      setRemoteCursors((prev) => ({
        ...prev,
        [socketId]: { line, column, name, color, lastUpdated: Date.now() },
      }));
    };

    const onInputChange = ({ stdin: s, from }) => {
      if (from === socket.id) return;
      setStdin(s);
    };

    const onOutputChange = (data) => {
      setOutput({
        text: data.output || "(no output)",
        status: data.status || "Completed",
        isError: Boolean(data.isError),
        time: data.time,
        memory: data.memory,
        ranBy: data.ranBy,
      });
      setIsRunning(false);
    };

    const onUserLeft = ({ socketId }) => {
      setRemoteCursors((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    };

    const onRoomSync = (data) => {
      if (data?.code) {
        setCodes((prev) => ({ ...prev, ...data.code }));
      }
      if (data?.language) {
        setLanguage(data.language);
      }
      if (data?.stdin !== undefined) {
        setStdin(data.stdin);
      }
    };

    socket.on("code-change", onCodeChange);
    socket.on("code-language", onLangChange);
    socket.on("code-cursor", onCursor);
    socket.on("code-input", onInputChange);
    socket.on("code-output", onOutputChange);
    socket.on("user-left", onUserLeft);
    socket.on("room-sync", onRoomSync);

    return () => {
      socket.off("code-change", onCodeChange);
      socket.off("code-language", onLangChange);
      socket.off("code-cursor", onCursor);
      socket.off("code-input", onInputChange);
      socket.off("code-output", onOutputChange);
      socket.off("user-left", onUserLeft);
      socket.off("room-sync", onRoomSync);
    };
  }, [roomId]);

  // Clean stale cursors every 15s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, c] of Object.entries(next)) {
          if (now - (c.lastUpdated || now) > 20000) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleCodeChange = useCallback(
    (val) => {
      setCodes((prev) => ({ ...prev, [language]: val }));
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        socket.emit("code-change", { roomId, lang: language, code: val });
      }, 100);
    },
    [roomId, language]
  );

  const handleLanguageChange = useCallback(
    (lang) => {
      setLanguage(lang);
      socket.emit("code-language", { roomId, lang });
    },
    [roomId]
  );

  const handleCursorChange = useCallback(
    (line, column = 1) => {
      clearTimeout(cursorDebounceRef.current);
      cursorDebounceRef.current = setTimeout(() => {
        socket.emit("code-cursor", {
          roomId,
          line,
          column,
          name: user?.name || "Participant",
          color: myColor,
        });
      }, 80);
    },
    [roomId, user?.name, myColor]
  );

  const handleStdinChange = useCallback(
    (val) => {
      setStdin(val);
      socket.emit("code-input", { roomId, stdin: val });
    },
    [roomId]
  );

  const runCode = useCallback(async () => {
    setIsRunning(true);
    setOutput({
      text: "Compiling and executing code...",
      status: "Running...",
      isError: false,
      time: null,
      memory: null,
      ranBy: user?.name || "You",
    });

    try {
      const baseUrl = import.meta.env.VITE_BASE_URL || "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: codes[language],
          language,
          stdin,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Execution failed");
      }

      const runResult = {
        output: data.output || "(no output)",
        status: data.status || "Completed",
        isError: data.isError,
        time: data.time,
        memory: data.memory,
        ranBy: user?.name || "You",
      };

      setOutput({
        text: runResult.output,
        status: runResult.status,
        isError: runResult.isError,
        time: runResult.time,
        memory: runResult.memory,
        ranBy: runResult.ranBy,
      });

      // Broadcast result to other participants in the room
      socket.emit("code-output", {
        roomId,
        ...runResult,
      });
    } catch (err) {
      const errResult = {
        output: `Error: ${err.message}`,
        status: "Error",
        isError: true,
        time: null,
        memory: null,
        ranBy: user?.name || "You",
      };
      setOutput({
        text: errResult.output,
        status: errResult.status,
        isError: true,
      });
      socket.emit("code-output", {
        roomId,
        ...errResult,
      });
    } finally {
      setIsRunning(false);
    }
  }, [codes, language, stdin, roomId, user?.name]);

  const toggleEditor = useCallback(() => {
    setIsEditorOpen((prev) => !prev);
  }, []);

  return {
    isEditorOpen,
    toggleEditor,
    language,
    handleLanguageChange,
    codes,
    handleCodeChange,
    stdin,
    handleStdinChange,
    output,
    isRunning,
    runCode,
    remoteCursors,
    myColor,
    handleCursorChange,
  };
};
