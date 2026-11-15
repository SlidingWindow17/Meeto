import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  XIcon, PencilIcon, EraserIcon, Minus, Square, Circle, Trash2, Download,
} from "lucide-react";
import { socket } from "../../config/socket";

// ─── Constants ────────────────────────────────────────────────────────────────
const COLORS = [
  { hex: "#1e293b", label: "Black" },
  { hex: "#ef4444", label: "Red" },
  { hex: "#3b82f6", label: "Blue" },
  { hex: "#22c55e", label: "Green" },
  { hex: "#f59e0b", label: "Amber" },
  { hex: "#a855f7", label: "Purple" },
];

const STROKE_WIDTHS = [2, 4, 7, 12];

const TOOLS = [
  { id: "pen",    label: "Pen",       Icon: PencilIcon },
  { id: "line",   label: "Line",      Icon: Minus      },
  { id: "rect",   label: "Rectangle", Icon: Square     },
  { id: "circle", label: "Circle",    Icon: Circle     },
  { id: "eraser", label: "Eraser",    Icon: EraserIcon },
];

// ─── Canvas helpers ───────────────────────────────────────────────────────────
function getCanvasPoint(canvas, e) {
  const rect   = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const scaleX  = canvas.width  / rect.width;
  const scaleY  = canvas.height / rect.height;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function applyStyle(ctx, stroke) {
  ctx.lineCap   = "round";
  ctx.lineJoin  = "round";
  ctx.lineWidth = stroke.width;
  if (stroke.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
  }
}

/** Draw any stroke type onto a canvas context */
function drawStroke(ctx, stroke) {
  if (!stroke?.points?.length) return;
  ctx.save();
  applyStyle(ctx, stroke);

  const pts = stroke.points;
  const p0  = pts[0];
  const p1  = pts[pts.length - 1];

  if (stroke.tool === "pen" || stroke.tool === "eraser") {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    pts.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  } else if (stroke.tool === "line") {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  } else if (stroke.tool === "rect") {
    ctx.beginPath();
    ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
  } else if (stroke.tool === "circle") {
    const rx = Math.abs(p1.x - p0.x) / 2;
    const ry = Math.abs(p1.y - p0.y) / 2;
    const cx = p0.x + (p1.x - p0.x) / 2;
    const cy = p0.y + (p1.y - p0.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function redrawAll(ctx, canvas, strokes) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  strokes.forEach((s) => drawStroke(ctx, s));
}

// ─── Component ────────────────────────────────────────────────────────────────
const WhiteboardPanel = ({ isOpen, onClose, roomId, strokesRef }) => {
  const canvasRef      = useRef(null); // committed layer
  const overlayRef     = useRef(null); // live-preview layer
  const isDrawing      = useRef(false);
  const startPoint     = useRef(null);
  const currentStroke  = useRef(null);

  const [tool,        setTool]        = useState("pen");
  const [color,       setColor]       = useState(COLORS[0].hex);
  const [strokeWidth, setStrokeWidth] = useState(4);

  // ── HiDPI canvas sizing ───────────────────────────────────────────────────
  const setupCanvas = useCallback(() => {
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    [canvas, overlay].forEach((c) => {
      c.width        = rect.width  * dpr;
      c.height       = rect.height * dpr;
      c.style.width  = rect.width  + "px";
      c.style.height = rect.height + "px";
    });
    redrawAll(canvas.getContext("2d"), canvas, strokesRef.current);
  }, [strokesRef]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(setupCanvas, 50);
    const ro = new ResizeObserver(setupCanvas);
    if (canvasRef.current?.parentElement) ro.observe(canvasRef.current.parentElement);
    return () => { clearTimeout(id); ro.disconnect(); };
  }, [isOpen, setupCanvas]);

  // ── Socket listeners (always active, not gated on isOpen) ────────────────
  useEffect(() => {
    if (!roomId) return;

    // pen/eraser live segment from a remote peer → draw on committed canvas
    const onSegment = ({ stroke }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawStroke(canvas.getContext("2d"), stroke);
      // segments are NOT stored in history; the final commit handles that
    };

    // shape live preview from a remote peer → draw on overlay canvas
    const onPreview = ({ stroke }) => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const octx = overlay.getContext("2d");
      octx.clearRect(0, 0, overlay.width, overlay.height);
      drawStroke(octx, stroke);
    };

    // committed stroke (all tools) → push to history + draw on committed canvas
    const onCommit = ({ stroke }) => {
      strokesRef.current.push(stroke);
      const canvas  = canvasRef.current;
      const overlay = overlayRef.current;
      if (!canvas) return;
      drawStroke(canvas.getContext("2d"), stroke);
      // clear the shape preview that was shown during drag
      if (overlay) overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
    };

    // clear board
    const onClear = () => {
      strokesRef.current = [];
      const canvas  = canvasRef.current;
      const overlay = overlayRef.current;
      if (canvas)  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      if (overlay) overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
    };

    // room sync on initial connect or reconnect
    const onRoomSync = (data) => {
      if (data?.whiteboardStrokes && Array.isArray(data.whiteboardStrokes)) {
        strokesRef.current = [...data.whiteboardStrokes];
        const canvas = canvasRef.current;
        if (canvas) {
          redrawAll(canvas.getContext("2d"), canvas, strokesRef.current);
        }
      }
    };

    socket.on("whiteboard-segment", onSegment);
    socket.on("whiteboard-preview", onPreview);
    socket.on("whiteboard-commit",  onCommit);
    socket.on("whiteboard-clear",   onClear);
    socket.on("room-sync",          onRoomSync);

    return () => {
      socket.off("whiteboard-segment", onSegment);
      socket.off("whiteboard-preview", onPreview);
      socket.off("whiteboard-commit",  onCommit);
      socket.off("whiteboard-clear",   onClear);
      socket.off("room-sync",          onRoomSync);
    };
  }, [roomId, strokesRef]);

  // ── Drawing ───────────────────────────────────────────────────────────────
  const startDraw = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = getCanvasPoint(canvas, e);
    isDrawing.current     = true;
    startPoint.current    = point;
    currentStroke.current = {
      tool,
      color: tool === "eraser" ? "#ffffff" : color,
      width: tool === "eraser" ? strokeWidth * 3 : strokeWidth,
      points: [point],
    };
  }, [tool, color, strokeWidth]);

  const doDraw = useCallback((e) => {
    e.preventDefault();
    if (!isDrawing.current || !currentStroke.current) return;
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas) return;

    const point = getCanvasPoint(canvas, e);
    currentStroke.current.points.push(point);
    const pts = currentStroke.current.points;

    if (tool === "pen" || tool === "eraser") {
      // ── Draw locally (incremental segment) ─────────────────────────────
      if (pts.length >= 2) {
        const ctx = canvas.getContext("2d");
        ctx.save();
        applyStyle(ctx, currentStroke.current);
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        ctx.restore();

        // ── Broadcast segment live ──────────────────────────────────────
        socket.emit("whiteboard-segment", {
          roomId,
          stroke: {
            tool,
            color: currentStroke.current.color,
            width: currentStroke.current.width,
            points: [pts[pts.length - 2], pts[pts.length - 1]],
          },
        });
      }
    } else {
      // ── Shape: redraw preview locally on overlay ────────────────────────
      if (overlay) {
        const octx = overlay.getContext("2d");
        octx.clearRect(0, 0, overlay.width, overlay.height);
        drawStroke(octx, { ...currentStroke.current, points: [startPoint.current, point] });
      }

      // ── Broadcast shape preview live ────────────────────────────────────
      socket.emit("whiteboard-preview", {
        roomId,
        stroke: {
          tool,
          color: currentStroke.current.color,
          width: currentStroke.current.width,
          points: [startPoint.current, point],
        },
      });
    }
  }, [tool, color, roomId]);

  const endDraw = useCallback((e) => {
    e?.preventDefault();
    if (!isDrawing.current || !currentStroke.current) return;
    isDrawing.current = false;

    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas) return;

    // Commit shape from overlay → committed canvas, clear overlay
    if (tool !== "pen" && tool !== "eraser") {
      drawStroke(canvas.getContext("2d"), currentStroke.current);
      if (overlay) overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
    }

    // Save to local history
    strokesRef.current.push({ ...currentStroke.current });

    // Broadcast final committed stroke to all peers
    // (for pen/eraser this lets late-joiners replay; for shapes it's the first full draw)
    socket.emit("whiteboard-commit", {
      roomId,
      stroke: { ...currentStroke.current },
    });

    currentStroke.current = null;
    startPoint.current    = null;
  }, [tool, roomId, strokesRef]);

  const clearBoard = useCallback(() => {
    strokesRef.current = [];
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (canvas)  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    if (overlay) overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
    socket.emit("whiteboard-clear", { roomId });
  }, [roomId, strokesRef]);

  const downloadBoard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link    = document.createElement("a");
    link.download = "whiteboard.png";
    link.href     = canvas.toDataURL("image/png");
    link.click();
  }, []);

  if (!isOpen) return null;

  return (
    <aside className="w-full sm:w-[420px] h-full bg-white border-l border-slate-200 flex flex-col z-30 shadow-2xl animate-in slide-in-from-right duration-200 select-none">
      {/* ── Header ── */}
      <div className="p-3 border-b border-slate-200 flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
          <PencilIcon className="w-4 h-4 text-primary" />
          Whiteboard
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={downloadBoard} title="Download as PNG"
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center gap-3 shrink-0 bg-slate-50">
        {/* Tools */}
        <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1 shadow-xs">
          {TOOLS.map(({ id, label, Icon }) => (
            <button key={id} title={label} onClick={() => setTool(id)}
              className={`p-2 rounded-lg transition-all cursor-pointer ${
                tool === id ? "bg-primary text-white shadow-sm" : "hover:bg-slate-100 text-slate-600"
              }`}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        {/* Colors */}
        <div className="flex items-center gap-1.5">
          {COLORS.map(({ hex, label }) => (
            <button key={hex} title={label}
              onClick={() => { setColor(hex); if (tool === "eraser") setTool("pen"); }}
              className={`w-5 h-5 rounded-full transition-all cursor-pointer border-2 ${
                color === hex && tool !== "eraser"
                  ? "border-slate-700 scale-110 shadow"
                  : "border-transparent hover:scale-110"
              }`}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>

        {/* Stroke widths */}
        <div className="flex items-center gap-1.5">
          {STROKE_WIDTHS.map((w) => (
            <button key={w} title={`${w}px`} onClick={() => setStrokeWidth(w)}
              className={`flex items-center justify-center w-7 h-7 rounded-lg cursor-pointer transition-all border ${
                strokeWidth === w
                  ? "bg-primary/10 border-primary/40"
                  : "bg-white border-slate-200 hover:bg-slate-100"
              }`}>
              <span className="rounded-full bg-slate-800 block"
                style={{ width: Math.min(w * 1.5, 18), height: Math.min(w * 1.5, 18) }} />
            </button>
          ))}
        </div>

        {/* Clear */}
        <button onClick={clearBoard} title="Clear board (clears for everyone)"
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-medium cursor-pointer transition-all">
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>

      {/* ── Canvas area ── */}
      <div className="flex-1 relative overflow-hidden bg-white">
        {/* Committed strokes */}
        <canvas ref={canvasRef}
          className="absolute inset-0 cursor-crosshair"
          onMouseDown={startDraw} onMouseMove={doDraw}
          onMouseUp={endDraw}     onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={doDraw} onTouchEnd={endDraw}
        />
        {/* Live preview overlay (shapes + remote) */}
        <canvas ref={overlayRef}
          className="absolute inset-0 pointer-events-none" />

        {strokesRef.current.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-300 text-sm font-medium select-none">Start drawing…</p>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50 flex items-center gap-2 shrink-0">
        <span className="w-3 h-3 rounded-full border-2 border-slate-300"
          style={{ backgroundColor: tool === "eraser" ? "transparent" : color }} />
        <span className="text-[11px] text-slate-400 font-medium capitalize">
          {TOOLS.find((t) => t.id === tool)?.label} · {tool === "eraser" ? strokeWidth * 3 : strokeWidth}px
        </span>
        <span className="ml-auto text-[11px] text-slate-400">Live · All participants</span>
      </div>
    </aside>
  );
};

export default WhiteboardPanel;
