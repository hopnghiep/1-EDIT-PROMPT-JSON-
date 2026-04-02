/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  Image as ImageIcon, 
  Send, 
  RefreshCw, 
  Copy, 
  Check, 
  Layout, 
  User, 
  Activity, 
  Layers, 
  MapPin, 
  Sun, 
  Camera,
  Upload,
  Trash2,
  ChevronRight,
  Info,
  Save,
  Plus,
  X,
  Pencil,
  ChevronDown,
  ChevronUp,
  Clock,
  Palette,
  Download,
  Maximize2,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  FileText,
  ListTree,
  Map,
  Undo,
  Redo,
  Wrench,
  Eraser,
  Type as TypeIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  FirebaseUser, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  deleteDoc, 
  addDoc, 
  serverTimestamp,
  OperationType,
  handleFirestoreError,
  Timestamp
} from './firebase';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Đã có lỗi xảy ra. Vui lòng thử lại.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error) {
          errorMessage = `Lỗi Firestore (${parsedError.operationType}): ${parsedError.error}`;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-4">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
            <h2 className="text-2xl font-serif italic text-black">Rất tiếc, đã có lỗi xảy ra</h2>
            <p className="text-black/60 text-sm">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="w-full py-3 bg-black text-white rounded-xl font-bold hover:opacity-80 transition-all"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const withRetry = async <T,>(fn: () => Promise<T>, maxRetries = 3, delayMs = 2000): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || String(error);
      const isRetryable = errorMessage.includes('503') || 
                          errorMessage.includes('429') || 
                          errorMessage.includes('UNAVAILABLE') || 
                          error?.status === 503 || 
                          error?.status === 429;
      
      if (!isRetryable || i === maxRetries - 1) {
        throw error;
      }
      console.log(`Retry ${i + 1}/${maxRetries} after ${delayMs * Math.pow(2, i)}ms due to error:`, errorMessage);
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, i)));
    }
  }
  throw lastError;
};

interface Annotation {
  id: string;
  type: 'path' | 'text';
  points?: { x: number, y: number }[];
  text?: string;
  x?: number;
  y?: number;
  color: string;
  strokeWidth: number;
}

const FloorPlanViewer = ({ 
  data, 
  interactive = false, 
  annotations = [], 
  onAnnotationsChange,
  isDrawingMode = false,
  drawingColor = '#e63946',
  drawingWidth = 5,
  drawingTool = 'pencil'
}: { 
  data: any, 
  interactive?: boolean,
  annotations?: Annotation[],
  onAnnotationsChange?: (annotations: Annotation[]) => void,
  isDrawingMode?: boolean,
  drawingColor?: string,
  drawingWidth?: number,
  drawingTool?: 'pencil' | 'text'
}) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [currentPath, setCurrentPath] = useState<{ x: number, y: number }[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleZoom = (e: React.MouseEvent) => {
    if (!interactive || isDrawingMode) return;
    e.stopPropagation();
    setZoomLevel(prev => prev === 1 ? 2 : prev === 2 ? 3 : 1);
  };

  const getSVGCoords = (e: React.MouseEvent | React.TouchEvent) => {
    if (!svgRef.current) return null;
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    
    if ('clientX' in e) {
      pt.x = e.clientX;
      pt.y = e.clientY;
    } else {
      pt.x = e.touches[0].clientX;
      pt.y = e.touches[0].clientY;
    }

    const cursorpt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: cursorpt.x, y: cursorpt.y };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isDrawingMode) return;
    const coords = getSVGCoords(e);
    if (!coords) return;

    if (drawingTool === 'text') {
      const text = prompt("Nhập nội dung ghi chú:");
      if (text) {
        const newAnnotation: Annotation = {
          id: Math.random().toString(36).substr(2, 9),
          type: 'text',
          text,
          x: coords.x,
          y: coords.y,
          color: drawingColor,
          strokeWidth: drawingWidth
        };
        if (onAnnotationsChange) {
          onAnnotationsChange([...annotations, newAnnotation]);
        }
      }
      return;
    }

    setCurrentPath([coords]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawingMode || !currentPath) return;
    const coords = getSVGCoords(e);
    if (coords) {
      setCurrentPath(prev => prev ? [...prev, coords] : [coords]);
    }
  };

  const handleMouseUp = () => {
    if (!isDrawingMode || !currentPath || currentPath.length < 2) {
      setCurrentPath(null);
      return;
    }

    const newAnnotation: Annotation = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'path',
      points: currentPath,
      color: drawingColor,
      strokeWidth: drawingWidth
    };

    if (onAnnotationsChange) {
      onAnnotationsChange([...annotations, newAnnotation]);
    }
    setCurrentPath(null);
  };

  // Helper to find arrays by key in a nested object
  const findArray = (obj: any, key: string): any[] => {
    if (!obj || typeof obj !== 'object') return [];
    if (Array.isArray(obj[key])) return obj[key];
    for (const k in obj) {
      const found = findArray(obj[k], key);
      if (found.length > 0) return found;
    }
    return [];
  };

  const walls = findArray(data, 'walls');
  const rooms = findArray(data, 'rooms');
  const openings = [...findArray(data, 'openings'), ...findArray(data, 'doors'), ...findArray(data, 'windows')];
  const asciiDiagram = data.ascii_diagram;

  if (asciiDiagram) {
    return (
      <div 
        className="w-full h-full overflow-auto bg-[#1e1e24] rounded-xl flex items-center justify-center p-4"
        style={{ cursor: interactive ? (zoomLevel === 3 ? 'zoom-out' : 'zoom-in') : 'default' }}
        onClick={handleZoom}
      >
        <pre 
          className="text-[#e0e0e0] font-mono text-xs sm:text-sm leading-tight whitespace-pre"
          style={{
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'center center',
            transition: 'transform 0.3s ease-in-out'
          }}
        >
          {asciiDiagram}
        </pre>
      </div>
    );
  }

  if (walls.length === 0 && rooms.length === 0 && openings.length === 0) {
    return (
      <div className="p-8 text-center flex flex-col items-center justify-center h-full">
        <div className="text-gray-500 font-mono text-sm mb-2">Không tìm thấy dữ liệu mảng 'walls', 'rooms', hoặc 'openings' trong JSON.</div>
        <div className="text-gray-400 text-xs max-w-md">Hãy kiểm tra lại cấu trúc JSON được tạo ra. Đôi khi AI có thể trả về cấu trúc không đúng chuẩn. Bạn có thể thử tạo lại JSON.</div>
      </div>
    );
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const updateBounds = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  walls.forEach((wall: any) => {
    wall.line?.forEach(([x, y]: [number, number]) => updateBounds(x, y));
  });

  rooms.forEach((room: any) => {
    room.polygon?.forEach(([x, y]: [number, number]) => updateBounds(x, y));
  });

  openings.forEach((opening: any) => {
    if (opening.position) {
      updateBounds(opening.position[0], opening.position[1]);
    }
  });

  if (minX === Infinity) {
    minX = 0; minY = 0; maxX = 1000; maxY = 1000;
  }

  const padding = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 100);
  const viewBox = `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;

  const baseFontSize = Math.max((maxX - minX) * 0.012, 8);
  const textShadowStyle = { textShadow: '1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff' };

  return (
    <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
      <svg 
        ref={svgRef}
        viewBox={viewBox} 
        className="w-full h-full transition-all duration-300 ease-in-out" 
        style={{ 
          backgroundColor: '#f8f9fa', 
          borderRadius: '0.75rem',
          width: `${zoomLevel * 100}%`,
          height: `${zoomLevel * 100}%`,
          cursor: isDrawingMode ? 'crosshair' : (interactive ? (zoomLevel === 3 ? 'zoom-out' : 'zoom-in') : 'default'),
          touchAction: isDrawingMode ? 'none' : 'auto'
        }}
        onClick={handleZoom}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Draw Rooms */}
        {rooms.map((room: any, i: number) => {
          if (!room.polygon || room.polygon.length < 3) return null;
          const points = room.polygon.map((p: any) => `${p[0]},${p[1]}`).join(' ');
          
          let cx = 0, cy = 0;
          room.polygon.forEach((p: any) => { cx += p[0]; cy += p[1]; });
          cx /= room.polygon.length;
          cy /= room.polygon.length;

          const roomLabel = room.id ? (room.name ? `[${room.id}] ${room.name}` : `[${room.id}]`) : (room.name || '');

          return (
            <g key={`room-${i}`}>
              <polygon points={points} fill="#e9ecef" stroke="#dee2e6" strokeWidth="2" opacity="0.5" />
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={baseFontSize * 1.5} fill="#495057" fontWeight="bold" style={textShadowStyle} className="pointer-events-none">
                {roomLabel}
              </text>
              {room.area && (
                <text x={cx} y={cy + baseFontSize * 2} textAnchor="middle" dominantBaseline="middle" fontSize={baseFontSize} fill="#6c757d" style={textShadowStyle} className="pointer-events-none">
                  {room.area} m²
                </text>
              )}
              {room.details && (
                <text x={cx} y={cy + baseFontSize * 3.5} textAnchor="middle" dominantBaseline="middle" fontSize={baseFontSize * 0.8} fill="#868e96" style={textShadowStyle} className="pointer-events-none">
                  {room.details.length > 30 ? room.details.substring(0, 30) + '...' : room.details}
                </text>
              )}
            </g>
          );
        })}

        {/* Draw Walls */}
        {walls.map((wall: any, i: number) => {
          if (!wall.line || wall.line.length < 2) return null;
          const [[x1, y1], [x2, y2]] = wall.line;
          const thickness = wall.thickness || 100;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          
          return (
            <g key={`wall-${i}`}>
              <line 
                x1={x1} y1={y1} x2={x2} y2={y2} 
                stroke="#343a40" 
                strokeWidth={Math.max((maxX - minX) * 0.01, thickness / 10, 2)} 
                strokeLinecap="square" 
              />
              {wall.id && (
                <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={baseFontSize} fill="#e63946" fontWeight="bold" style={textShadowStyle} className="pointer-events-none">
                  {wall.id}
                </text>
              )}
            </g>
          );
        })}

        {/* Draw Openings */}
        {openings.map((opening: any, i: number) => {
          if (!opening.position) return null;
          const [x, y] = opening.position;
          const width = opening.width || 900;
          const type = opening.type?.toLowerCase();
          const isDoor = type === 'door';
          const isWindow = type === 'window';
          
          const symbolSize = Math.max((maxX - minX) * 0.015, width / 20, 10);

          return (
            <g key={`opening-${i}`} transform={`translate(${x}, ${y})`}>
              {isDoor ? (
                <>
                  <rect x={-symbolSize} y={-symbolSize/2} width={symbolSize*2} height={symbolSize} fill="#fff" stroke="#e63946" strokeWidth="2" />
                  <path d={`M 0,${-symbolSize/2} A ${symbolSize},${symbolSize} 0 0,1 ${symbolSize},${symbolSize/2}`} fill="none" stroke="#e63946" strokeWidth="1.5" strokeDasharray="2,2" />
                </>
              ) : isWindow ? (
                <>
                  <rect x={-symbolSize} y={-symbolSize/3} width={symbolSize*2} height={symbolSize*2/3} fill="#e0fbfc" stroke="#0077b6" strokeWidth="2" />
                  <line x1={-symbolSize} y1={0} x2={symbolSize} y2={0} stroke="#0077b6" strokeWidth="1" />
                </>
              ) : (
                <circle cx={0} cy={0} r={symbolSize} fill="#ffb703" />
              )}
              {opening.id && (
                <text x={0} y={-symbolSize - 4} textAnchor="middle" dominantBaseline="alphabetic" fontSize={baseFontSize} fill="#0077b6" fontWeight="bold" style={textShadowStyle} className="pointer-events-none">
                  {opening.id}
                </text>
              )}
            </g>
          );
        })}

        {/* Draw Annotations */}
        {annotations.map((ann) => {
          if (ann.type === 'path' && ann.points) {
            const d = ann.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            return (
              <path 
                key={ann.id} 
                d={d} 
                fill="none" 
                stroke={ann.color} 
                strokeWidth={ann.strokeWidth} 
                strokeLinecap="round" 
                strokeLinejoin="round" 
              />
            );
          }
          if (ann.type === 'text' && ann.text) {
            return (
              <text 
                key={ann.id} 
                x={ann.x} 
                y={ann.y} 
                fill={ann.color} 
                fontSize={baseFontSize * 2} 
                fontWeight="bold"
                style={textShadowStyle}
              >
                {ann.text}
              </text>
            );
          }
          return null;
        })}

        {/* Draw Current Path */}
        {currentPath && currentPath.length > 1 && (
          <path 
            d={currentPath.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} 
            fill="none" 
            stroke={drawingColor} 
            strokeWidth={drawingWidth} 
            strokeLinecap="round" 
            strokeLinejoin="round" 
          />
        )}
      </svg>
    </div>
  );
};

const JsonTreeNode = ({ data, name, isLast = true, initialExpanded = true }: { data: any, name?: string, isLast?: boolean, initialExpanded?: boolean }) => {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  
  if (data === null) {
    return (
      <div className="pl-4 font-mono text-xs">
        {name && <span className="text-blue-600">"{name}"</span>}
        {name && <span className="text-black/50">: </span>}
        <span className="text-gray-500">null</span>
        {!isLast && <span className="text-black/50">,</span>}
      </div>
    );
  }

  const isObject = typeof data === 'object';
  const isArray = Array.isArray(data);
  
  if (!isObject) {
    return (
      <div className="pl-4 font-mono text-xs">
        {name && <span className="text-blue-600">"{name}"</span>}
        {name && <span className="text-black/50">: </span>}
        <span className={
          typeof data === 'string' ? 'text-green-600' : 
          typeof data === 'number' ? 'text-orange-500' : 
          typeof data === 'boolean' ? 'text-purple-600' : 'text-gray-500'
        }>
          {typeof data === 'string' ? `"${data}"` : String(data)}
        </span>
        {!isLast && <span className="text-black/50">,</span>}
      </div>
    );
  }

  const keys = Object.keys(data);
  const isEmpty = keys.length === 0;

  return (
    <div className="pl-4 font-mono text-xs">
      <div 
        className="flex items-center cursor-pointer hover:bg-black/5 rounded px-1 -ml-1 w-fit"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {!isEmpty && (
          <span className="w-4 h-4 inline-flex items-center justify-center text-black/40">
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
        {isEmpty && <span className="w-4 inline-block" />}
        {name && <span className="text-blue-600">"{name}"</span>}
        {name && <span className="text-black/50">: </span>}
        <span className="text-black/50">{isArray ? '[' : '{'}</span>
        {!isExpanded && !isEmpty && <span className="text-black/40 px-1">...</span>}
        {(!isExpanded || isEmpty) && (
          <>
            <span className="text-black/50">{isArray ? ']' : '}'}</span>
            {!isLast && <span className="text-black/50">,</span>}
          </>
        )}
      </div>
      
      {isExpanded && !isEmpty && (
        <div>
          {keys.map((key, index) => (
            <JsonTreeNode 
              key={key} 
              name={isArray ? undefined : key} 
              data={data[key as keyof typeof data]} 
              isLast={index === keys.length - 1}
              initialExpanded={initialExpanded}
            />
          ))}
          <div className="pl-4 text-black/50">
            {isArray ? ']' : '}'}
            {!isLast && <span>,</span>}
          </div>
        </div>
      )}
    </div>
  );
};

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface PromptParts {
  summary: string;
  mainObject: string;
  poseAction: string;
  secondaryElements: string;
  background: string;
  lighting: string;
  composition: string;
}

const INITIAL_PARTS: PromptParts = {
  summary: '',
  mainObject: '',
  poseAction: '',
  secondaryElements: '',
  background: '',
  lighting: '',
  composition: '',
};

const SECTIONS = [
  { id: 'summary', label: 'Tóm tắt hình ảnh', icon: ImageIcon, placeholder: 'Một câu ngắn mô tả tổng thể khung cảnh...', tooltip: 'Bức tranh toàn cảnh về những gì bạn muốn tạo ra. Giúp AI hiểu được ý tưởng cốt lõi trước khi đi vào chi tiết.' },
  { id: 'mainObject', label: 'Đối tượng chính', icon: User, placeholder: 'Mô tả chi tiết về chủ thể chính...', tooltip: 'Nhân vật, con vật hoặc đồ vật là tâm điểm của bức ảnh. Mô tả ngoại hình, trang phục, màu sắc và đặc điểm nổi bật.' },
  { id: 'poseAction', label: 'Tư thế & Hành động', icon: Activity, placeholder: 'Chủ thể đang làm gì?', tooltip: 'Chủ thể đang ở tư thế nào? Đang thực hiện hành động gì? Điều này tạo ra sự sống động và câu chuyện cho bức ảnh.' },
  { id: 'secondaryElements', label: 'Yếu tố phụ', icon: Layers, placeholder: 'Các chi tiết và vật thể hỗ trợ...', tooltip: 'Những vật thể, nhân vật phụ hoặc chi tiết nhỏ xung quanh giúp làm phong phú thêm câu chuyện và bối cảnh.' },
  { id: 'background', label: 'Bối cảnh & Nền', icon: MapPin, placeholder: 'Địa điểm, thời gian và không gian...', tooltip: 'Nơi sự việc diễn ra. Là trong nhà hay ngoài trời? Thành phố hay thiên nhiên? Thời gian nào trong ngày?' },
  { id: 'lighting', label: 'Ánh sáng & Không khí', icon: Sun, placeholder: 'Tông màu, tâm trạng và nguồn sáng...', tooltip: 'Loại ánh sáng (tự nhiên, neon, cinematic) và cảm xúc tổng thể (ấm áp, u ám, huyền bí) mà bức ảnh mang lại.' },
  { id: 'composition', label: 'Bố cục & Khung hình', icon: Camera, placeholder: 'Góc máy, tiêu cự và cách sắp xếp...', tooltip: 'Góc nhìn của camera (cận cảnh, toàn cảnh, từ dưới lên) và phong cách nghệ thuật (nhiếp ảnh, 3D, tranh vẽ).' },
];

const SAMPLE_PROMPTS: (PromptParts & { title: string })[] = [];

const DEFAULT_STYLE_PROMPTS = [
  "Giữ nguyên hình dáng, góc máy của 'the first image', nhưng áp dụng toàn bộ vật liệu, màu sắc và ánh sáng từ 'the second image'",
  "Thay đổi [vật liệu hiện tại] thành [vật liệu mới]. Giữ nguyên [các yếu tố hoặc vật liệu cần giữ lại]"
];

function useAppHistory(initialParts: PromptParts, initialJson: string | null) {
  const [state, setState] = useState<{parts: PromptParts, json: string | null}>({ parts: initialParts, json: initialJson });
  const [past, setPast] = useState<{parts: PromptParts, json: string | null}[]>([]);
  const [future, setFuture] = useState<{parts: PromptParts, json: string | null}[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedState = useRef<{parts: PromptParts, json: string | null}>({ parts: initialParts, json: initialJson });

  const updateState = (updater: (prev: {parts: PromptParts, json: string | null}) => {parts: PromptParts, json: string | null}, debounceMs: number = 1000) => {
    setState((prev) => {
      const resolvedState = updater(prev);
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      if (debounceMs === 0) {
        if (JSON.stringify(lastSavedState.current) !== JSON.stringify(resolvedState)) {
          setPast((p) => [...p, lastSavedState.current]);
          setFuture([]);
          lastSavedState.current = resolvedState;
        }
      } else {
        timeoutRef.current = setTimeout(() => {
          if (JSON.stringify(lastSavedState.current) !== JSON.stringify(resolvedState)) {
            setPast((p) => [...p, lastSavedState.current]);
            setFuture([]);
            lastSavedState.current = resolvedState;
          }
        }, debounceMs);
      }

      return resolvedState;
    });
  };

  const setParts = (updater: PromptParts | ((prev: PromptParts) => PromptParts), immediate = false) => {
    updateState((prev) => {
      const newParts = typeof updater === 'function' ? (updater as any)(prev.parts) : updater;
      return { ...prev, parts: newParts };
    }, immediate ? 0 : 1000);
  };

  const setArchitectureJson = (updater: string | null | ((prev: string | null) => string | null), immediate = false) => {
    updateState((prev) => {
      const newJson = typeof updater === 'function' ? (updater as any)(prev.json) : updater;
      return { ...prev, json: newJson };
    }, immediate ? 0 : 1000);
  };

  const undo = () => {
    if (past.length === 0) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    setState(currentState => {
      const previous = past[past.length - 1];
      const newPast = past.slice(0, past.length - 1);
      
      if (JSON.stringify(lastSavedState.current) !== JSON.stringify(currentState)) {
        setFuture((f) => [currentState, ...f]);
      } else {
        setFuture((f) => [lastSavedState.current, ...f]);
      }
      
      setPast(newPast);
      lastSavedState.current = previous;
      return previous;
    });
  };

  const redo = () => {
    if (future.length === 0) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    setState(currentState => {
      const next = future[0];
      const newFuture = future.slice(1);
      
      if (JSON.stringify(lastSavedState.current) !== JSON.stringify(currentState)) {
        setPast((p) => [...p, currentState]);
      } else {
        setPast((p) => [...p, lastSavedState.current]);
      }
      
      setFuture(newFuture);
      lastSavedState.current = next;
      return next;
    });
  };

  return { 
    parts: state.parts, 
    architectureJson: state.json, 
    setParts, 
    setArchitectureJson, 
    undo, 
    redo, 
    canUndo: past.length > 0, 
    canRedo: future.length > 0 
  };
}

function ColorEditorModal({ 
  architectureJson, 
  setArchitectureJson, 
  onClose 
}: { 
  architectureJson: string; 
  setArchitectureJson: (json: string) => void; 
  onClose: () => void; 
}) {
  const [localJson, setLocalJson] = useState<any>(null);

  useEffect(() => {
    try {
      setLocalJson(JSON.parse(architectureJson));
    } catch (e) {
      console.error("Failed to parse JSON for color editor", e);
    }
  }, [architectureJson]);

  if (!localJson || !localJson.color_proposal) return null;

  const handleColorChange = (roomId: string, field: 'wall_color' | 'floor_color' | 'furniture_accent', value: string) => {
    setLocalJson((prev: any) => {
      const newJson = { ...prev };
      const room = newJson.color_proposal.room_details.find((r: any) => r.room_id === roomId);
      if (room) {
        if (typeof room[field] === 'string') {
          room[field] = value;
        } else if (room[field] && typeof room[field] === 'object') {
          room[field].hex = value;
        }
      }
      return newJson;
    });
  };

  const handleGlobalColorChange = (field: string, value: string) => {
    setLocalJson((prev: any) => {
      const newJson = { ...prev };
      if (newJson.color_proposal.global_palette) {
        if (typeof newJson.color_proposal.global_palette[field] === 'string') {
          newJson.color_proposal.global_palette[field] = value;
        } else if (newJson.color_proposal.global_palette[field] && typeof newJson.color_proposal.global_palette[field] === 'object') {
          newJson.color_proposal.global_palette[field].hex = value;
        }
      }
      return newJson;
    });
  };

  const handleSave = () => {
    setArchitectureJson(JSON.stringify(localJson, null, 2));
    onClose();
  };

  const renderColorInput = (label: string, value: any, onChange: (val: string) => void) => {
    const hex = typeof value === 'string' ? value : (value?.hex || '#000000');
    const name = typeof value === 'object' && value?.name ? value.name : '';

    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-black/60">{label}</label>
        <div className="flex items-center gap-2">
          <input 
            type="color" 
            value={hex} 
            onChange={(e) => onChange(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0 p-0"
          />
          <div className="flex flex-col">
            <span className="text-sm font-mono">{hex}</span>
            {name && <span className="text-xs text-black/60">{name}</span>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#F5F5F0] rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-black/10"
      >
        <div className="p-6 border-b border-black/10 flex items-center justify-between bg-white">
          <h3 className="text-xl font-serif italic text-black flex items-center gap-2">
            <Palette className="w-5 h-5" />
            Chỉnh sửa màu sắc
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 space-y-8">
          {localJson.color_proposal.global_palette && (
            <section className="space-y-4">
              <h4 className="text-lg font-medium border-b border-black/10 pb-2">Bảng màu chung</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {Object.entries(localJson.color_proposal.global_palette).map(([key, value]) => (
                  <div key={key} className="bg-white p-4 rounded-xl border border-black/5">
                    {renderColorInput(key.charAt(0).toUpperCase() + key.slice(1), value, (val) => handleGlobalColorChange(key, val))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {localJson.color_proposal.room_details && localJson.color_proposal.room_details.length > 0 && (
            <section className="space-y-4">
              <h4 className="text-lg font-medium border-b border-black/10 pb-2">Màu sắc từng phòng</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {localJson.color_proposal.room_details.map((room: any) => (
                  <div key={room.room_id} className="bg-white p-4 rounded-xl border border-black/5 space-y-4">
                    <h5 className="font-medium text-black">{room.room_name || room.room_id}</h5>
                    <div className="grid grid-cols-3 gap-4">
                      {renderColorInput('Tường', room.wall_color, (val) => handleColorChange(room.room_id, 'wall_color', val))}
                      {renderColorInput('Sàn', room.floor_color, (val) => handleColorChange(room.room_id, 'floor_color', val))}
                      {renderColorInput('Điểm nhấn', room.furniture_accent, (val) => handleColorChange(room.room_id, 'furniture_accent', val))}
                    </div>
                    {room.reasoning && (
                      <p className="text-xs text-black/60 italic mt-2">{room.reasoning}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="p-6 border-t border-black/10 bg-white flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-black/5 transition-colors"
          >
            Hủy
          </button>
          <button 
            onClick={handleSave}
            className="px-6 py-2.5 bg-black text-white rounded-xl text-sm font-medium hover:bg-black/90 transition-colors flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Cập nhật và trở về
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [isProjectListOpen, setIsProjectListOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);

  const [samples, setSamples] = useState<(PromptParts & { title: string; isCustom?: boolean })[]>([]);
  const { parts, architectureJson, setParts, setArchitectureJson, undo, redo, canUndo, canRedo } = useAppHistory(INITIAL_PARTS, null);
  const [improvedPrompt, setImprovedPrompt] = useState('');
  const [changeIdea, setChangeIdea] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isImproving, setIsImproving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [isDescribing, setIsDescribing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [materialImages, setMaterialImages] = useState<string[]>([]);
  const [isDraggingMaterial, setIsDraggingMaterial] = useState(false);
  const materialFileInputRef = useRef<HTMLInputElement>(null);
  const [mentionState, setMentionState] = useState<{
    active: boolean;
    query: string;
    field: keyof PromptParts | 'finalPrompt' | null;
    cursorIndex: number;
  }>({ active: false, query: '', field: null, cursorIndex: 0 });
  const [viewingImageIndex, setViewingImageIndex] = useState<number>(0);
  const [isSavingSample, setIsSavingSample] = useState(false);
  const [newSampleTitle, setNewSampleTitle] = useState('');
  const [editingSampleTitle, setEditingSampleTitle] = useState<string | null>(null);
  const [history, setHistory] = useState<{id: string, prompt: string, timestamp: number}[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [consistencyProtection, setConsistencyProtection] = useState(false);
  const [isAddingAccents, setIsAddingAccents] = useState(false);
  const [controlMethod, setControlMethod] = useState<'prompt' | 'balanced' | 'image'>('balanced');
  const [controlStrengths, setControlStrengths] = useState({
    prompt: 100,
    balanced: 50,
    image: 100
  });

  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [finalPrompt, setFinalPrompt] = useState<string>('');
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [isGeneratingFinal, setIsGeneratingFinal] = useState(false);
  const [jsonValidationMessages, setJsonValidationMessages] = useState<{ type: 'error' | 'warning' | 'success', message: string }[]>([]);
  const [isGeneratingJson, setIsGeneratingJson] = useState(false);
  const [isGeneratingDetailedJson, setIsGeneratingDetailedJson] = useState(false);
  const [isAutoFixingJson, setIsAutoFixingJson] = useState(false);
  const [isAnalyzingColors, setIsAnalyzingColors] = useState(false);
  const [jsonInVietnamese, setJsonInVietnamese] = useState(false);
  const [jsonChangeIdea, setJsonChangeIdea] = useState('');
  const [isUpdatingJsonIdea, setIsUpdatingJsonIdea] = useState(false);
  const [isUpdatingPromptFromJson, setIsUpdatingPromptFromJson] = useState(false);
  const [isAddingAccentsToJsonIdea, setIsAddingAccentsToJsonIdea] = useState(false);
  const [customStylePrompts, setCustomStylePrompts] = useState<string[]>([]);
  const [newStylePrompt, setNewStylePrompt] = useState('');
  const [isAddingStylePrompt, setIsAddingStylePrompt] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editingSectionContent, setEditingSectionContent] = useState('');
  const [isViewingAllStyles, setIsViewingAllStyles] = useState(false);
  const [selectedStyleInModal, setSelectedStyleInModal] = useState<string | null>(null);
  const [isViewingImage, setIsViewingImage] = useState(false);
  const [hoveredArea, setHoveredArea] = useState<'main' | 'ref' | null>(null);
  const [isDraggingMain, setIsDraggingMain] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        // Sync user profile
        const userDoc = doc(db, 'users', currentUser.uid);
        try {
          await setDoc(userDoc, {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            updatedAt: serverTimestamp()
          }, { merge: true });
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `users/${currentUser.uid}`);
        }
      } else {
        setProjects([]);
        setCurrentProjectId(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync Projects List
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'projects'), where('ownerUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProjects(projectList);
    }, (e) => {
      handleFirestoreError(e, OperationType.LIST, 'projects');
    });
    return () => unsubscribe();
  }, [user]);

  // Sync Current Project Data
  useEffect(() => {
    if (!user || !currentProjectId) return;
    const projectDoc = doc(db, 'projects', currentProjectId);
    const unsubscribe = onSnapshot(projectDoc, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.parts) setParts(data.parts);
        if (data.improvedPrompt) setImprovedPrompt(data.improvedPrompt);
        if (data.finalPrompt) setFinalPrompt(data.finalPrompt);
        if (data.architectureJson) setArchitectureJson(data.architectureJson);
        if (data.annotations) setAnnotations(data.annotations);
        if (data.uploadedImages) setUploadedImages(data.uploadedImages);
        if (data.referenceImage) setReferenceImage(data.referenceImage);
        if (data.history) setHistory(data.history);
      }
    }, (e) => {
      handleFirestoreError(e, OperationType.GET, `projects/${currentProjectId}`);
    });
    return () => unsubscribe();
  }, [user, currentProjectId]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error("Login failed", e);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Logout failed", e);
    }
  };

  const saveCurrentProject = async (name?: string) => {
    if (!user) return;
    setIsSavingProject(true);
    try {
      const projectData = {
        ownerUid: user.uid,
        name: name || (currentProjectId ? projects.find(p => p.id === currentProjectId)?.name : 'Dự án mới'),
        parts,
        improvedPrompt,
        finalPrompt,
        architectureJson,
        annotations,
        uploadedImages,
        referenceImage,
        history,
        updatedAt: serverTimestamp()
      };

      if (currentProjectId) {
        await updateDoc(doc(db, 'projects', currentProjectId), projectData);
      } else {
        const docRef = await addDoc(collection(db, 'projects'), {
          ...projectData,
          createdAt: serverTimestamp()
        });
        setCurrentProjectId(docRef.id);
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, currentProjectId ? `projects/${currentProjectId}` : 'projects');
    } finally {
      setIsSavingProject(false);
    }
  };

  const createNewProject = () => {
    setCurrentProjectId(null);
    handleReset();
  };
  const [isViewingPromptIdea, setIsViewingPromptIdea] = useState(false);
  const [isViewingJsonIdea, setIsViewingJsonIdea] = useState(false);
  const [isViewingJson, setIsViewingJson] = useState(false);
  const [isViewingFloorPlan, setIsViewingFloorPlan] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingTool, setDrawingTool] = useState<'pencil' | 'text'>('pencil');
  const [drawingColor, setDrawingColor] = useState('#e63946');
  const [drawingWidth, setDrawingWidth] = useState(5);
  const [isEditingColors, setIsEditingColors] = useState(false);
  const [isEditingJson, setIsEditingJson] = useState(false);
  const [isJsonTreeView, setIsJsonTreeView] = useState(false);
  const [tempJson, setTempJson] = useState("");
  const [materialLinks, setMaterialLinks] = useState<string[]>([]);
  const [newMaterialLink, setNewMaterialLink] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Load samples and history from localStorage
  useEffect(() => {
    const savedSamples = localStorage.getItem('custom_samples');
    const customSamples = savedSamples ? JSON.parse(savedSamples) : [];
    setSamples([...SAMPLE_PROMPTS, ...customSamples]);

    const savedHistory = localStorage.getItem('prompt_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }

    const savedStylePrompts = localStorage.getItem('custom_style_prompts');
    if (savedStylePrompts) {
      setCustomStylePrompts(JSON.parse(savedStylePrompts));
    }

    const checkApiKey = async () => {
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkApiKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const addToHistory = (promptText: string) => {
    if (!promptText.trim()) return;
    const newItem = { id: Date.now().toString(), prompt: promptText, timestamp: Date.now() };
    setHistory(prev => {
      const newHistory = [newItem, ...prev].slice(0, 20); // Keep last 20
      localStorage.setItem('prompt_history', JSON.stringify(newHistory));
      return newHistory;
    });
  };

  const saveCustomSample = () => {
    if (!newSampleTitle.trim()) return;
    
    const newSample = { ...parts, title: newSampleTitle, isCustom: true };
    let updatedCustom;
    
    if (editingSampleTitle) {
      // Update existing
      updatedCustom = samples
        .filter(s => s.isCustom)
        .map(s => s.title === editingSampleTitle ? newSample : s);
    } else {
      // Add new
      updatedCustom = [...samples.filter(s => s.isCustom), newSample];
    }

    localStorage.setItem('custom_samples', JSON.stringify(updatedCustom));
    setSamples([...SAMPLE_PROMPTS, ...updatedCustom]);
    setNewSampleTitle('');
    setIsSavingSample(false);
    setEditingSampleTitle(null);
  };

  const handleEditSample = (sample: PromptParts & { title: string }) => {
    setParts(sample);
    setNewSampleTitle(sample.title);
    setEditingSampleTitle(sample.title);
    setIsSavingSample(true);
    setImprovedPrompt('');
    setError(null);
  };

  const deleteSample = (title: string) => {
    if (window.confirm(`Bạn có chắc chắn muốn xóa mẫu "${title}" không?`)) {
      const updatedCustom = samples.filter(s => s.isCustom && s.title !== title);
      localStorage.setItem('custom_samples', JSON.stringify(updatedCustom));
      setSamples([...SAMPLE_PROMPTS, ...updatedCustom]);
    }
  };

  const removeUploadedImage = (index: number) => {
    setUploadedImages(prev => {
      const newImages = prev.filter((_, i) => i !== index);
      if (newImages.length === 0) {
        setParts(INITIAL_PARTS);
      }
      return newImages;
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeReferenceImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setReferenceImage(null);
    if (refFileInputRef.current) {
      refFileInputRef.current.value = '';
    }
  };

  const removeMaterialImage = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setMaterialImages(prev => prev.filter((_, i) => i !== index));
    if (materialFileInputRef.current) {
      materialFileInputRef.current.value = '';
    }
  };

  const handleInputChange = (id: keyof PromptParts, value: string) => {
    setParts(prev => ({ ...prev, [id]: value }));
  };

  // Auto-fill logic
  useEffect(() => {
    const timer = setTimeout(() => {
      const otherPartsEmpty = !parts.mainObject && !parts.poseAction && !parts.secondaryElements && !parts.background && !parts.lighting && !parts.composition;
      if (parts.summary.trim().length > 10 && otherPartsEmpty && !isAutoFilling) {
        autoFillParts();
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timer);
  }, [parts.summary]);

  const autoFillParts = async () => {
    if (!parts.summary.trim()) return;
    setIsAutoFilling(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Dựa trên tóm tắt hình ảnh này: "${parts.summary}", hãy lên ý tưởng cho 6 phần còn lại của khung câu lệnh 7 phần.
        Hãy sáng tạo, chi tiết và mô tả trực quan sinh động.
        
        Trả về kết quả dưới dạng đối tượng JSON với các khóa: mainObject, poseAction, secondaryElements, background, lighting, composition.
        Tất cả nội dung phải bằng tiếng Việt.`,
        config: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mainObject: { type: Type.STRING },
              poseAction: { type: Type.STRING },
              secondaryElements: { type: Type.STRING },
              background: { type: Type.STRING },
              lighting: { type: Type.STRING },
              composition: { type: Type.STRING },
            }
          }
        }
      });

      const result = JSON.parse(response.text || '{}');
      setParts(prev => ({ ...prev, ...result }));
    } catch (error) {
      console.error('Error auto-filling parts:', error);
    } finally {
      setIsAutoFilling(false);
    }
  };

  useEffect(() => {
    validateArchitectureJson(architectureJson);
  }, [architectureJson]);

  const handleCopy = () => {
    navigator.clipboard.writeText(improvedPrompt || getCombinedPrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getCombinedPrompt = () => {
    let combined = Object.values(parts).filter(Boolean).join('. ');
    if (consistencyProtection && combined.trim()) {
      combined += ' Giữ nguyên bố cục, ánh sáng, phong cách, góc camera và không đổi phần ngoài nội dung tinh chỉnh.';
    }
    
    if (uploadedImages.length > 0 && combined.trim()) {
      const strength = controlStrengths[controlMethod];
      if (controlMethod === 'prompt') {
        combined += ` [Chế độ: Prompt (${strength}%) - Tạo đối tượng mới hoàn toàn dựa trên mô tả văn bản và vùng thay đổi]`;
      } else if (controlMethod === 'balanced') {
        combined += ` [Chế độ: Balanced (${strength}%) - Giữ lại hình dáng và bố cục của đối tượng gốc, cập nhật nội dung thay đổi]`;
      } else if (controlMethod === 'image') {
        combined += ` [Chế độ: Image (${strength}%) - Yêu cầu tuyệt đối 100% giữ nguyên không thay đổi hình ảnh gốc, chỉ cập nhật nội dung thay đổi]`;
      }
    }
    
    return combined;
  };

  const improvePrompt = async () => {
    if (!getCombinedPrompt().trim()) return;
    
    setIsImproving(true);
    setError(null);
    setChangeIdea(''); // Reset change idea on new improvement
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Bạn là một chuyên gia kỹ sư câu lệnh hình ảnh AI.
        Tôi sẽ cung cấp cho bạn 7 phần của một cấu trúc câu lệnh.
        Nhiệm vụ của bạn là kết hợp chúng thành một đoạn văn ngôn ngữ tự nhiên duy nhất, cực kỳ chi tiết, tuân theo các quy tắc sau:
        1. Sử dụng ngôn ngữ tự nhiên, giàu tính mô tả (không dùng thẻ tags hay thuật ngữ kỹ thuật).
        2. Mô tả rõ ràng mọi chi tiết trực quan.
        3. Duy trì luồng văn bản mạch lạc.
        4. Không sử dụng trọng số như (word:1.2).
        5. Toàn bộ nội dung phải bằng tiếng Việt.
        
        Các phần đầu vào:
        - Tóm tắt: ${parts.summary}
        - Đối tượng chính: ${parts.mainObject}
        - Tư thế/Hành động: ${parts.poseAction}
        - Yếu tố phụ: ${parts.secondaryElements}
        - Bối cảnh: ${parts.background}
        - Ánh sáng: ${parts.lighting}
        - Bố cục: ${parts.composition}
        ${consistencyProtection ? '- Yêu cầu bổ sung: Giữ nguyên bố cục, ánh sáng, phong cách, góc camera và không đổi phần ngoài nội dung tinh chỉnh.' : ''}
        ${uploadedImages.length > 0 ? `- Yêu cầu kiểm soát hình ảnh gốc: ${
          controlMethod === 'prompt' ? `Chế độ Prompt (Mức độ: ${controlStrengths.prompt}%) - Tạo ra đối tượng mới hoàn toàn dựa trên mô tả bằng văn bản.` :
          controlMethod === 'balanced' ? `Chế độ Balanced (Mức độ: ${controlStrengths.balanced}%) - Giữ lại nhiều hơn hình dáng và bố cục của đối tượng gốc.` :
          `Chế độ Image (Mức độ: ${controlStrengths.image}%) - Yêu cầu tuyệt đối 100% giữ nguyên không thay đổi hình ảnh đã tải và phân tích. Hình dáng đối tượng hầu như không thay đổi.`
        }` : ''}
        
        Chỉ trả về đoạn văn câu lệnh đã được đánh bóng.`,
      });
      
      setImprovedPrompt(response.text || '');
      addToHistory(response.text || '');
    } catch (err) {
      console.error('Error improving prompt:', err);
      setError('Không thể tinh chỉnh câu lệnh. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      setIsImproving(false);
    }
  };

  const updatePrompt = async () => {
    if (!changeIdea.trim() || !improvedPrompt) return;

    setIsUpdating(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      let controlInstruction = '';
      if (uploadedImages.length > 0) {
        const strength = controlStrengths[controlMethod];
        if (controlMethod === 'prompt') {
          controlInstruction = `\n- Chú ý quan trọng: Áp dụng Chế độ Prompt (Mức độ: ${strength}%). Tạo ra đối tượng mới hoàn toàn dựa trên mô tả bằng văn bản và vùng thay đổi nội dung.`;
        } else if (controlMethod === 'balanced') {
          controlInstruction = `\n- Chú ý quan trọng: Áp dụng Chế độ Balanced (Mức độ: ${strength}%). Vẫn sử dụng lời nhắc thay đổi nội dung nhưng giữ lại nhiều hơn hình dáng và bố cục của đối tượng gốc.`;
        } else if (controlMethod === 'image') {
          controlInstruction = `\n- Chú ý quan trọng: Áp dụng Chế độ Image (Mức độ: ${strength}%). Yêu cầu tuyệt đối 100% giữ nguyên không thay đổi hình ảnh đã tải và phân tích. Hình dáng đối tượng hầu như không thay đổi, chỉ cập nhật các nội dung trong mục ý tưởng thay đổi. Màu sắc sẽ là sự pha trộn giữa màu của ảnh gốc với màu được yêu cầu trong lời nhắc.`;
        }
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Bạn là một chuyên gia kỹ sư câu lệnh hình ảnh AI.
        Tôi có một câu lệnh hiện tại: "${improvedPrompt}"
        
        Người dùng muốn thay đổi câu lệnh này với ý tưởng sau: "${changeIdea}"
        
        Nhiệm vụ của bạn là cập nhật câu lệnh hiện tại để bao gồm ý tưởng thay đổi này. 
        Hãy giữ nguyên phong cách mô tả chi tiết và ngôn ngữ tự nhiên. 
        Toàn bộ nội dung phải bằng tiếng Việt.${controlInstruction}
        
        Chỉ trả về đoạn văn câu lệnh đã được cập nhật.`,
      });

      setImprovedPrompt(response.text || '');
      addToHistory(response.text || '');
      setChangeIdea(''); // Clear after successful update

      // Automatically update JSON if it exists
      if (architectureJson) {
        try {
          let parts: any[] = [{ text: `Dựa trên câu lệnh mô tả hình ảnh sau đây, hãy tạo ra một file JSON chi tiết về kiến trúc theo đúng định dạng sau:
{
  "project": {
    "name": "Residential House",
    "units": "mm",
    "levels": 1
  },
  "geometry": {
    "walls": [],
    "rooms": [
      {
        "id": "R1",
        "name": "living room",
        "details": "Spacious living room with a fireplace and large windows facing the garden",
        "polygon": [[0,0],[5000,0],[5000,4000],[0,4000]],
        "area": 20,
        "connections": ["R2"]
      }
    ],
    "openings": []
  },
  "elements": {
    "doors": [],
    "windows": [],
    "stairs": []
  },
  "semantics": {
    "room_types": [],
    "circulation": []
  },
  "style": {
    "architecture": "",
    "materials": {},
    "roof": {}
  },
  "ascii_diagram": "Tạo một sơ đồ mặt bằng bằng ASCII art CHẤT LƯỢNG CAO ở đây. YÊU CẦU NGHIÊM NGẶT: 1. Các bức tường (dùng '+', '-', '|') phải tạo thành các đường nối liền mạch, không bị đứt gãy. 2. Các phòng phải được bao quanh hoàn toàn bởi tường. 3. BẮT BUỘC chèn các ký hiệu ID (ví dụ: [R1] Phòng khách, W1, D1, WIN1) hiển thị rõ ràng và đặt CHÍNH XÁC vào không gian tương ứng của chúng trên sơ đồ (ID phòng nằm giữa phòng và được bọc trong ngoặc vuông ví dụ [R1], ID tường nằm trên/cạnh tường, ID cửa nằm ngay vị trí cửa). Sử dụng khoảng trắng hợp lý để tạo tỷ lệ. Ví dụ:\n+----------W1----------+\n|                      |\n|         [R1]         |\n|      Phòng khách     |\n|                      |\n+----D1----+---WIN1----+"
}

Câu lệnh mô tả hình ảnh: "${response.text || ''}"

Hãy phân tích và điền các thông tin chi tiết vào cấu trúc JSON trên dựa vào nội dung câu lệnh.
Lưu ý: Mỗi đối tượng trong mảng "rooms" cần có thêm trường "details" để mô tả chi tiết chức năng hoặc đặc điểm của phòng đó (ví dụ: "Phòng khách rộng rãi với lò sưởi và cửa sổ lớn hướng ra sân vườn").
${jsonInVietnamese ? "Lưu ý quan trọng: Hãy dịch các giá trị (value) mô tả trong JSON sang tiếng Việt. Giữ nguyên các khóa (key) bằng tiếng Anh." : ""}

Chỉ trả về chuỗi JSON hợp lệ, không có markdown hay giải thích thêm.` }];

          if (uploadedImages.length > 0) {
            const imageParts = uploadedImages.map(img => {
              const mimeType = img.split(';')[0].split(':')[1];
              const base64Data = img.split(',')[1];
              return {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType,
                }
              };
            });
            parts.unshift(...imageParts);
          }

          const jsonResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: { parts },
            config: {
              maxOutputTokens: 8192,
              responseMimeType: "application/json",
            }
          });
          
          setArchitectureJson(jsonResponse.text || null);
        } catch (jsonErr) {
          console.error('Error auto-updating JSON:', jsonErr);
          // Don't show error to user since the prompt update succeeded
        }
      }
    } catch (err) {
      console.error('Error updating prompt:', err);
      setError('Không thể cập nhật câu lệnh. Vui lòng thử lại.');
    } finally {
      setIsUpdating(false);
    }
  };

  const addAccentsToChangeIdea = async () => {
    if (!changeIdea.trim()) return;
    
    setIsAddingAccents(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Thêm dấu tiếng Việt chuẩn xác cho đoạn văn bản sau. Chỉ trả về đoạn văn bản đã được thêm dấu, không thêm bất kỳ lời giải thích hay nội dung nào khác:\n\n"${changeIdea}"`,
      });
      
      if (response.text) {
        setChangeIdea(response.text.trim());
      }
    } catch (err) {
      console.error('Error adding accents:', err);
    } finally {
      setIsAddingAccents(false);
    }
  };

  const generateImage = async () => {
    const promptToUse = improvedPrompt || getCombinedPrompt();
    if (!promptToUse.trim()) return;

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      let parts: any[] = [{ text: promptToUse }];
      
      if (uploadedImages.length > 0) {
        const imageParts = uploadedImages.map(img => {
          const mimeType = img.split(';')[0].split(':')[1];
          const base64Data = img.split(',')[1];
          return {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            }
          };
        });
        parts = [...imageParts, ...parts];
      }

      const response = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: parts,
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K"
          },
          seed: seed,
        }
      }));

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setGeneratedImageUrl(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
    } catch (error: any) {
      console.error('Error generating image:', error);
      if (error.message && (error.message.includes('PERMISSION_DENIED') || error.message.includes('Requested entity was not found'))) {
        setHasApiKey(false);
        setError('API Key không hợp lệ hoặc không có quyền truy cập. Vui lòng chọn lại API Key trả phí.');
      } else {
        setError('Có lỗi xảy ra khi tạo ảnh. Vui lòng thử lại.');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const getParsedJson = (jsonString: string | null) => {
    if (!jsonString) return null;
    try {
      let cleanJson = jsonString;
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\n/, '').replace(/\n```$/, '');
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\n/, '').replace(/\n```$/, '');
      }
      return JSON.parse(cleanJson);
    } catch (e) {
      return null;
    }
  };

  const validateArchitectureJson = (jsonString: string | null) => {
    if (!jsonString) {
      setJsonValidationMessages([]);
      return;
    }
    
    const messages: { type: 'error' | 'warning' | 'success', message: string }[] = [];
    
    try {
      // Remove markdown code blocks if present
      let cleanJson = jsonString;
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\n/, '').replace(/\n```$/, '');
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\n/, '').replace(/\n```$/, '');
      }
      
      const data = JSON.parse(cleanJson);
      
      // Check basic structure
      if (!data.meta && !data.project) messages.push({ type: 'warning', message: 'Thiếu đối tượng "meta" hoặc "project".' });
      if (!data.floor_plan && !data.geometry) messages.push({ type: 'error', message: 'Thiếu đối tượng "floor_plan" hoặc "geometry" (hình học).' });
      
      // Support both old and new schema
      const rooms = data.floor_plan?.rooms || data.geometry?.rooms || [];
      const doors = data.floor_plan?.doors || data.geometry?.openings || [];
      const windows = data.floor_plan?.windows || [];
      const walls = data.geometry?.walls || [];
      
      if (data.floor_plan || data.geometry) {
        if (!Array.isArray(rooms)) messages.push({ type: 'error', message: '"rooms" phải là một mảng.' });
        if (!Array.isArray(doors)) messages.push({ type: 'error', message: '"doors/openings" phải là một mảng.' });
        
        // Check room connections
        const roomIds = new Set(Array.isArray(rooms) ? rooms.map((r: any) => r.id) : []);
        if (Array.isArray(rooms)) {
          rooms.forEach((room: any, index: number) => {
            if (Array.isArray(room.connections)) {
              room.connections.forEach((connId: string) => {
                // In new schema, connections might include stairs
                if (!roomIds.has(connId) && !connId.startsWith('stair_')) {
                  messages.push({ type: 'warning', message: `Phòng "${room.id || index}" kết nối đến "${connId}" không tồn tại.` });
                }
              });
            }
            if (room.polygon && (!Array.isArray(room.polygon) || room.polygon.length < 3)) {
              messages.push({ type: 'warning', message: `Phòng "${room.id || index}" có đa giác (polygon) không hợp lệ (cần ít nhất 3 điểm).` });
            }
          });
        }
        
        // Check walls (only in old schema)
        if (Array.isArray(walls) && walls.length > 0) {
          walls.forEach((wall: any, index: number) => {
            if (wall.line && (!Array.isArray(wall.line) || wall.line.length !== 2)) {
              messages.push({ type: 'warning', message: `Tường "${wall.id || index}" có đường thẳng (line) không hợp lệ (cần đúng 2 điểm).` });
            }
          });
        }
      }
      
      if (messages.length === 0) {
        messages.push({ type: 'success', message: 'JSON hợp lệ và nhất quán.' });
      }
      
    } catch (e) {
      messages.push({ type: 'error', message: 'Lỗi cú pháp JSON: Không thể phân tích cú pháp.' });
    }
    
    setJsonValidationMessages(messages);
  };

  const generateArchitectureJson = async () => {
    const promptToUse = improvedPrompt || getCombinedPrompt();
    if (!promptToUse.trim()) return;

    setIsGeneratingJson(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      let parts: any[] = [{ text: `Dựa trên câu lệnh mô tả hình ảnh sau đây, hãy tạo ra một file JSON chi tiết về kiến trúc theo đúng định dạng sau:
{
  "meta": {
    "unit": "m",
    "scale": 1.0,
    "source": "image_upload"
  },
  "floor_plan": {
    "levels": {
      "floor_elevation": 0.0,
      "ceiling_default": 3.6
    },
    "rooms": [
      {
        "id": "room_1",
        "name": "living_room",
        "details": "Phòng khách rộng rãi với lò sưởi và cửa sổ lớn hướng ra sân vườn",
        "polygon": [[0,0], [5,0], [5,4], [0,4]],
        "area": 20.0,
        "height": 3.6,
        "ceiling_height": 3.6,
        "connections": ["room_2", "stair_1"],
        "doors": ["door_1"],
        "windows": ["window_1"],
        "function": "public_space"
      }
    ],
    "doors": [
      {
        "id": "door_1",
        "type": "swing",
        "width": 0.9,
        "height": 2.2,
        "head_height": 2.2,
        "position": [5, 2],
        "connects": ["room_1", "room_2"],
        "swing_direction": "left"
      }
    ],
    "windows": [
      {
        "id": "window_1",
        "type": "sliding",
        "width": 1.8,
        "sill_height": 0.9,
        "head_height": 2.1,
        "height": 1.2,
        "position": [2, 4],
        "room_id": "room_1"
      }
    ],
    "stairs": [
      {
        "id": "stair_1",
        "type": "straight",
        "start": [6, 0],
        "end": [6, 4],
        "width": 1.0,
        "steps": 18,
        "riser": 0.17,
        "tread": 0.27,
        "floor_start": 0.0,
        "floor_end": 3.06,
        "direction": "up",
        "connects": ["floor_1", "floor_2"]
      }
    ],
    "adjacency_matrix": {
      "room_1": ["room_2", "stair_1"],
      "room_2": ["room_1"]
    }
  },
  "ceiling": {
    "type": "false_ceiling",
    "min_height": 2.7,
    "max_height": 3.6
  },
  "elevation_system": {
    "origin": "FFL",
    "floor_finish": 0.0
  },
  "ascii_diagram": "Tạo một sơ đồ mặt bằng bằng ASCII art CHẤT LƯỢNG CAO ở đây. YÊU CẦU NGHIÊM NGẶT: 1. Các bức tường (dùng '+', '-', '|') phải tạo thành các đường nối liền mạch, không bị đứt gãy. 2. Các phòng phải được bao quanh hoàn toàn bởi tường. 3. BẮT BUỘC chèn các ký hiệu ID (ví dụ: [room_1] Phòng khách, door_1, window_1) hiển thị rõ ràng và đặt CHÍNH XÁC vào không gian tương ứng của chúng trên sơ đồ (ID phòng nằm giữa phòng và được bọc trong ngoặc vuông ví dụ [room_1], ID cửa nằm ngay vị trí cửa). Sử dụng khoảng trắng hợp lý để tạo tỷ lệ. Ví dụ:\n+----------------------+\n|                      |\n|      [room_1]        |\n|      Phòng khách     |\n|                      |\n+----door_1----+---window_1----+"
}

Câu lệnh mô tả hình ảnh: "${promptToUse}"

Hãy phân tích và điền các thông tin chi tiết vào cấu trúc JSON trên dựa vào nội dung câu lệnh.
Lưu ý: Mỗi đối tượng trong mảng "rooms" cần có thêm trường "details" để mô tả chi tiết chức năng hoặc đặc điểm của phòng đó (ví dụ: "Phòng khách rộng rãi với lò sưởi và cửa sổ lớn hướng ra sân vườn").
${jsonInVietnamese ? "Lưu ý quan trọng: Hãy dịch các giá trị (value) mô tả trong JSON sang tiếng Việt. Giữ nguyên các khóa (key) bằng tiếng Anh." : ""}

Chỉ trả về chuỗi JSON hợp lệ, không có markdown hay giải thích thêm.` }];
      
      if (uploadedImages.length > 0) {
        const imageParts = uploadedImages.map(img => {
          const mimeType = img.split(';')[0].split(':')[1];
          const base64Data = img.split(',')[1];
          return {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            }
          };
        });
        parts = [...imageParts, ...parts];
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: parts,
        },
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        }
      });
      
      setArchitectureJson(response.text || null);
    } catch (err) {
      console.error('Error generating architecture JSON:', err);
      setError('Không thể tạo JSON kiến trúc. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      setIsGeneratingJson(false);
    }
  };

  const generateDetailedArchitectureJson = async (overrideImages?: string[]) => {
    const promptToUse = improvedPrompt || getCombinedPrompt();
    const imagesToUse = overrideImages || uploadedImages;
    if (!promptToUse.trim() && imagesToUse.length === 0) return;

    setIsGeneratingDetailedJson(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      let parts: any[] = [{ text: `You are an AI specialized in architectural floor plan analysis. Your task is to extract structured architectural data from input floor plan images (which may include floor plans, sections, elevations, perspectives) and output a precise JSON following the schema. Analyze all provided images synchronously to provide full details.

Analyze the provided architectural floor plan image and extract structured spatial and architectural data.

REQUIREMENTS:

1. DETECT ROOMS
- Identify all enclosed spaces
- Extract polygon boundaries
- Estimate area (m2)
- Assign room type (living_room, bedroom, kitchen, wc, circulation)

2. DETECT DOORS
- Identify door symbols and openings
- Extract width
- Determine swing direction if visible
- Assign height:
  - Default = 2.1m if not specified
  - If scale detected → calculate

3. DETECT WINDOWS
- Identify window symbols
- Extract width
- Assign:
  - sill_height = 0.9m (default if not visible)
  - head_height = 2.1m (default)
  - height = head - sill

4. DETECT STAIRS
- Identify staircases
- Detect:
  - number of steps
  - direction (up/down)
  - width
- Calculate:
  - riser = total_height / steps (default floor height = 3.6m)
  - tread = 0.25–0.30m estimated

5. HEIGHT SYSTEM (CRITICAL)
- If no elevation info:
  - floor_elevation = 0.0
  - ceiling_height = 3.6m
- Doors:
  - head_height = 2.1–2.2m
- Windows:
  - sill_height = 0.8–1.0m
  - head_height = 2.0–2.2m

6. BUILD SPATIAL RELATIONSHIPS
- Detect adjacency between rooms
- Build connection graph via doors

7. OUTPUT FORMAT
Return ONLY valid JSON (no explanation)

Follow this schema strictly:

{
  "meta": {
    "unit": "m",
    "scale": 1.0,
    "source": "image_upload"
  },
  "floor_plan": {
    "levels": {
      "floor_elevation": 0.0,
      "ceiling_default": 3.6
    },
    "rooms": [],
    "doors": [],
    "windows": [],
    "stairs": [],
    "adjacency_matrix": {}
  },
  "ceiling": {
    "type": "false_ceiling",
    "min_height": 2.7,
    "max_height": 3.6
  },
  "elevation_system": {
    "origin": "FFL",
    "floor_finish": 0.0
  },
  "rules": {
    "door": {
      "min_height": 2.1,
      "min_width_main": 0.9,
      "min_width_room": 0.8
    },
    "window": {
      "min_sill_height": 0.8,
      "max_sill_height": 1.2,
      "min_head_height": 2.0
    },
    "room": {
      "min_ceiling_height": 2.6,
      "wc_min": 2.4
    },
    "stair": {
      "riser_min": 0.15,
      "riser_max": 0.18,
      "tread_min": 0.25,
      "tread_max": 0.30,
      "min_width": 0.9
    }
  },
  "validate": [
    {
      "type": "door_height_check",
      "condition": "door.height < 2.1",
      "message": "Door height below TCVN minimum"
    },
    {
      "type": "window_sill_check",
      "condition": "window.sill_height < 0.8",
      "message": "Window sill too low"
    },
    {
      "type": "ceiling_height_check",
      "condition": "room.ceiling_height < 2.6",
      "message": "Ceiling height below standard"
    },
    {
      "type": "stair_riser_check",
      "condition": "stair.riser > 0.18",
      "message": "Stair riser too high"
    }
  ],
  "compliance_report": {
    "status": "warning",
    "issues": [],
    "score": 100
  },
  "suggestion": {},
  "ascii_diagram": "GENERATE A HIGH-QUALITY ASCII ART FLOOR PLAN HERE. STRICT REQUIREMENTS: 1. Walls (using '+', '-', '|') MUST form seamless, unbroken connected lines. 2. Rooms MUST be completely enclosed by walls. 3. You MUST clearly include the exact IDs generated above (e.g., [room_1] Living Room, door_1, window_1) and place them ACCURATELY in their corresponding spaces (Room IDs inside the room and wrapped in brackets e.g. [room_1], Door/Window IDs at the exact openings). Use spacing properly to maintain proportions."
}

PRIORITY:
- Accuracy of spatial logic over visual detail
- Consistent scale across all elements
- Do NOT hallucinate unknown data → use default rules

${promptToUse ? `Additional context from prompt: "${promptToUse}"` : ""}
${jsonInVietnamese ? "Lưu ý quan trọng: Hãy dịch các giá trị (value) mô tả trong JSON sang tiếng Việt. Giữ nguyên các khóa (key) bằng tiếng Anh." : ""}

Chỉ trả về chuỗi JSON hợp lệ, không có markdown hay giải thích thêm.` }];
      
      if (imagesToUse.length > 0) {
        const imageParts = imagesToUse.map(img => {
          const mimeType = img.split(';')[0].split(':')[1];
          const base64Data = img.split(',')[1];
          return {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            }
          };
        });
        parts = [...imageParts, ...parts];
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: {
          parts: parts,
        },
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        }
      });
      
      setArchitectureJson(response.text || null);
    } catch (err) {
      console.error('Error generating detailed architecture JSON:', err);
      setError('Không thể tạo JSON kiến trúc chi tiết. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      setIsGeneratingDetailedJson(false);
    }
  };

  const autoFixAndOptimizeJson = async () => {
    if (!architectureJson) return;

    setIsAutoFixingJson(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      let parts: any[] = [{ text: `You are an advanced architectural AI engine specializing in Vietnamese building standards (TCVN). You can analyze, fix, and regenerate floor plans from structured JSON data.

INPUT: Architectural JSON (rooms, doors, windows, stairs)

TASK:

1. VALIDATE AGAINST TCVN
Check all elements:
- Door height >= 2.1m
- Door width >= 0.8m (>=0.9m main)
- Window sill height: 0.8–1.2m
- Ceiling height >= 2.6m
- Stair:
  - riser: 0.15–0.18m
  - tread: 0.25–0.30m
  - width >= 0.9m

2. AUTO FIX (CRITICAL)
If violations found:
- Adjust dimensions minimally
- Preserve original layout as much as possible
- Recalculate dependent values (area, stair steps)

3. LAYOUT OPTIMIZATION
- Ensure all rooms accessible
- Improve circulation flow
- Avoid dead-end spaces
- Ensure each bedroom has window
- Avoid WC directly facing kitchen

4. SPATIAL RE-GENERATION
- Update room polygons if needed
- Adjust door positions for better flow
- Reconnect adjacency graph

5. OUTPUT

Return JSON:

{
  "fixed_plan": {},
  "changes": [],
  "compliance_report": {},
  "optimization_score": 0-100
}

RULES:
- Do NOT break structural logic
- Keep geometry consistent
- Prefer small corrections over large redesign

Here is the input JSON:
${architectureJson}

${jsonInVietnamese ? "Lưu ý quan trọng: Hãy dịch các giá trị (value) mô tả trong JSON sang tiếng Việt. Giữ nguyên các khóa (key) bằng tiếng Anh." : ""}

Chỉ trả về chuỗi JSON hợp lệ, không có markdown hay giải thích thêm.` }];

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: {
          parts: parts,
        },
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        }
      });
      
      setArchitectureJson(response.text || null);
    } catch (err) {
      console.error('Error auto-fixing architecture JSON:', err);
      setError('Không thể tự động sửa JSON. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      setIsAutoFixingJson(false);
    }
  };

  const analyzeAndProposeColors = async () => {
    if (!architectureJson) return;

    setIsAnalyzingColors(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      let parts: any[] = [{ text: `You are an expert interior designer and architect.
TASK: Analyze the current architectural JSON and propose a color and material scheme that fits the "modern minimalist" (hiện đại tối giản) style.

REQUIREMENTS:
1. Modern Minimalist Style: Focus on neutral tones (whites, grays, beiges), natural materials (light wood, concrete), and subtle contrasts.
2. Analyze the rooms provided in the JSON and assign specific HEX color codes and materials for each room.
3. Return ONLY a valid JSON object with the following structure:

{
  "style_analysis": "Phân tích phong cách hiện tại và lý do chọn bảng màu mới (tiếng Việt)",
  "global_palette": {
    "primary": { "hex": "#HEX", "name": "Tên màu" },
    "secondary": { "hex": "#HEX", "name": "Tên màu" },
    "accent": { "hex": "#HEX", "name": "Tên màu" },
    "background": { "hex": "#HEX", "name": "Tên màu" }
  },
  "materials": {
    "floors": "Mô tả vật liệu sàn",
    "walls": "Mô tả vật liệu tường",
    "accents": "Mô tả vật liệu điểm nhấn"
  },
  "room_details": [
    {
      "room_id": "id_phong",
      "room_name": "Tên phòng",
      "wall_color": { "hex": "#HEX", "name": "Tên màu" },
      "floor_color": { "hex": "#HEX", "name": "Tên màu" },
      "furniture_accent": { "hex": "#HEX", "name": "Tên màu" },
      "reasoning": "Lý do chọn màu này cho phòng"
    }
  ]
}

Here is the input JSON:
${architectureJson}

Chỉ trả về chuỗi JSON hợp lệ, không có markdown hay giải thích thêm.` }];

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: {
          parts: parts,
        },
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        }
      });
      
      const currentJson = JSON.parse(architectureJson);
      const colorProposal = JSON.parse(response.text || "{}");
      currentJson.color_proposal = colorProposal;
      
      setArchitectureJson(JSON.stringify(currentJson, null, 2));
    } catch (err) {
      console.error('Error analyzing colors:', err);
      setError('Không thể phân tích và đề xuất màu sắc. Vui lòng thử lại.');
    } finally {
      setIsAnalyzingColors(false);
    }
  };

  const updateJsonAndPrompt = async () => {
    if (!jsonChangeIdea.trim() || !improvedPrompt) return;

    setIsUpdatingJsonIdea(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      let controlInstruction = '';
      if (uploadedImages.length > 0) {
        const strength = controlStrengths[controlMethod];
        if (controlMethod === 'prompt') {
          controlInstruction = `\n- Chú ý quan trọng: Áp dụng Chế độ Prompt (Mức độ: ${strength}%). Tạo ra đối tượng mới hoàn toàn dựa trên mô tả bằng văn bản và vùng thay đổi nội dung.`;
        } else if (controlMethod === 'balanced') {
          controlInstruction = `\n- Chú ý quan trọng: Áp dụng Chế độ Balanced (Mức độ: ${strength}%). Vẫn sử dụng lời nhắc thay đổi nội dung nhưng giữ lại nhiều hơn hình dáng và bố cục của đối tượng gốc.`;
        } else if (controlMethod === 'image') {
          controlInstruction = `\n- Chú ý quan trọng: Áp dụng Chế độ Image (Mức độ: ${strength}%). Yêu cầu tuyệt đối 100% giữ nguyên không thay đổi hình ảnh đã tải và phân tích. Hình dáng đối tượng hầu như không thay đổi, chỉ cập nhật các nội dung trong mục ý tưởng thay đổi. Màu sắc sẽ là sự pha trộn giữa màu của ảnh gốc với màu được yêu cầu trong lời nhắc.`;
        }
      }

      const promptResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Bạn là một chuyên gia kỹ sư câu lệnh hình ảnh AI.
        Tôi có một câu lệnh hiện tại: "${improvedPrompt}"
        
        Người dùng muốn thay đổi câu lệnh này với ý tưởng sau: "${jsonChangeIdea}"
        
        Nhiệm vụ của bạn là cập nhật câu lệnh hiện tại để bao gồm ý tưởng thay đổi này. 
        Hãy giữ nguyên phong cách mô tả chi tiết và ngôn ngữ tự nhiên. 
        Toàn bộ nội dung phải bằng tiếng Việt.${controlInstruction}
        
        Chỉ trả về đoạn văn câu lệnh đã được cập nhật.`,
      });

      const newPrompt = promptResponse.text || '';
      setImprovedPrompt(newPrompt);
      addToHistory(newPrompt);

      let parts: any[] = [{ text: `Dựa trên câu lệnh mô tả hình ảnh sau đây, hãy tạo ra một file JSON chi tiết về kiến trúc theo đúng định dạng sau:
{
  "meta": {
    "unit": "m",
    "scale": 1.0,
    "source": "image_upload"
  },
  "floor_plan": {
    "levels": {
      "floor_elevation": 0.0,
      "ceiling_default": 3.6
    },
    "rooms": [
      {
        "id": "room_1",
        "name": "living_room",
        "details": "Phòng khách rộng rãi với lò sưởi và cửa sổ lớn hướng ra sân vườn",
        "polygon": [[0,0], [5,0], [5,4], [0,4]],
        "area": 20.0,
        "height": 3.6,
        "ceiling_height": 3.6,
        "connections": ["room_2", "stair_1"],
        "doors": ["door_1"],
        "windows": ["window_1"],
        "function": "public_space"
      }
    ],
    "doors": [
      {
        "id": "door_1",
        "type": "swing",
        "width": 0.9,
        "height": 2.2,
        "head_height": 2.2,
        "position": [5, 2],
        "connects": ["room_1", "room_2"],
        "swing_direction": "left"
      }
    ],
    "windows": [
      {
        "id": "window_1",
        "type": "sliding",
        "width": 1.8,
        "sill_height": 0.9,
        "head_height": 2.1,
        "height": 1.2,
        "position": [2, 4],
        "room_id": "room_1"
      }
    ],
    "stairs": [
      {
        "id": "stair_1",
        "type": "straight",
        "start": [6, 0],
        "end": [6, 4],
        "width": 1.0,
        "steps": 18,
        "riser": 0.17,
        "tread": 0.27,
        "floor_start": 0.0,
        "floor_end": 3.06,
        "direction": "up",
        "connects": ["floor_1", "floor_2"]
      }
    ],
    "adjacency_matrix": {
      "room_1": ["room_2", "stair_1"],
      "room_2": ["room_1"]
    }
  },
  "ceiling": {
    "type": "false_ceiling",
    "min_height": 2.7,
    "max_height": 3.6
  },
  "elevation_system": {
    "origin": "FFL",
    "floor_finish": 0.0
  },
  "ascii_diagram": "Tạo một sơ đồ mặt bằng bằng ASCII art CHẤT LƯỢNG CAO ở đây. YÊU CẦU NGHIÊM NGẶT: 1. Các bức tường (dùng '+', '-', '|') phải tạo thành các đường nối liền mạch, không bị đứt gãy. 2. Các phòng phải được bao quanh hoàn toàn bởi tường. 3. BẮT BUỘC chèn các ký hiệu ID (ví dụ: [room_1] Phòng khách, door_1, window_1) hiển thị rõ ràng và đặt CHÍNH XÁC vào không gian tương ứng của chúng trên sơ đồ (ID phòng nằm giữa phòng và được bọc trong ngoặc vuông ví dụ [room_1], ID cửa nằm ngay vị trí cửa). Sử dụng khoảng trắng hợp lý để tạo tỷ lệ. Ví dụ:\n+----------------------+\n|                      |\n|      [room_1]        |\n|      Phòng khách     |\n|                      |\n+----door_1----+---window_1----+"
}

Câu lệnh mô tả hình ảnh: "${newPrompt}"

Hãy phân tích và điền các thông tin chi tiết vào cấu trúc JSON trên dựa vào nội dung câu lệnh.
Lưu ý: Mỗi đối tượng trong mảng "rooms" cần có thêm trường "details" để mô tả chi tiết chức năng hoặc đặc điểm của phòng đó (ví dụ: "Phòng khách rộng rãi với lò sưởi và cửa sổ lớn hướng ra sân vườn").
${jsonInVietnamese ? "Lưu ý quan trọng: Hãy dịch các giá trị (value) mô tả trong JSON sang tiếng Việt. Giữ nguyên các khóa (key) bằng tiếng Anh." : ""}

Chỉ trả về chuỗi JSON hợp lệ, không có markdown hay giải thích thêm.` }];
      
      if (uploadedImages.length > 0) {
        const imageParts = uploadedImages.map(img => {
          const mimeType = img.split(';')[0].split(':')[1];
          const base64Data = img.split(',')[1];
          return {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            }
          };
        });
        parts.unshift(...imageParts);
      }

      const jsonResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: parts,
        },
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        }
      });
      
      setArchitectureJson(jsonResponse.text || null);
      setJsonChangeIdea('');
    } catch (err) {
      console.error('Error updating JSON and prompt:', err);
      setError('Không thể cập nhật JSON và câu lệnh. Vui lòng thử lại.');
    } finally {
      setIsUpdatingJsonIdea(false);
    }
  };

  const handleUpdateJson = async () => {
    setArchitectureJson(tempJson);
    
    if (!improvedPrompt && !getCombinedPrompt().trim()) {
      setIsViewingJson(false);
      setIsEditingJson(false);
      return;
    }

    setIsUpdatingPromptFromJson(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      const promptResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Bạn là một chuyên gia kỹ sư câu lệnh hình ảnh AI.
        Tôi có một câu lệnh hiện tại: "${improvedPrompt || getCombinedPrompt()}"
        
        Người dùng đã thay đổi cấu trúc JSON kiến trúc thành:
        \`\`\`json
        ${tempJson}
        \`\`\`
        
        Nhiệm vụ của bạn là cập nhật câu lệnh hiện tại để phản ánh chính xác các thay đổi trong JSON này. 
        Hãy giữ nguyên phong cách mô tả chi tiết và ngôn ngữ tự nhiên. 
        Toàn bộ nội dung phải bằng tiếng Việt.
        
        Chỉ trả về đoạn văn câu lệnh đã được cập nhật.`,
      });

      const newPrompt = promptResponse.text || '';
      setImprovedPrompt(newPrompt);
      addToHistory(newPrompt);
      setIsViewingJson(false);
      setIsEditingJson(false);
    } catch (err) {
      console.error('Error updating prompt from JSON:', err);
      setError('Không thể cập nhật câu lệnh từ JSON. Vui lòng thử lại.');
    } finally {
      setIsUpdatingPromptFromJson(false);
    }
  };

  const addAccentsToJsonChangeIdea = async () => {
    if (!jsonChangeIdea.trim()) return;
    
    setIsAddingAccentsToJsonIdea(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Thêm dấu tiếng Việt chuẩn xác cho đoạn văn bản sau. Chỉ trả về đoạn văn bản đã được thêm dấu, không thêm bất kỳ lời giải thích hay nội dung nào khác:\n\n"${jsonChangeIdea}"`,
      });
      
      if (response.text) {
        setJsonChangeIdea(response.text.trim());
      }
    } catch (err) {
      console.error('Error adding accents:', err);
    } finally {
      setIsAddingAccentsToJsonIdea(false);
    }
  };

  const processMainImages = async (files: File[]) => {
    const base64Promises = files.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    });

    const newBase64Datas = await Promise.all(base64Promises);
    
    setUploadedImages(prev => {
      const updatedImages = [...prev, ...newBase64Datas];
      describeImages(updatedImages);
      generateDetailedArchitectureJson(updatedImages);
      return updatedImages;
    });
  };

  const processRefImage = (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      setReferenceImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const processMaterialImages = (files: File[]) => {
    let loadedCount = 0;
    const newImages: string[] = [];
    
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        newImages.push(reader.result as string);
        loadedCount++;
        if (loadedCount === files.length) {
          setMaterialImages(prev => [...prev, ...newImages]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) processMainImages(Array.from(files));
  };

  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processRefImage(file);
  };

  const handleMaterialImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) processMaterialImages(Array.from(files));
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      const items = e.clipboardData?.items;
      if (!items) return;
      
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            if (hoveredArea === 'ref') {
              processRefImage(file);
            } else if (hoveredArea === 'main') {
              imageFiles.push(file);
            } else {
              if (uploadedImages.length === 0) imageFiles.push(file);
              else processRefImage(file);
            }
          }
        }
      }
      if (imageFiles.length > 0) processMainImages(imageFiles);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [hoveredArea, uploadedImages]);

  const addStylePrompt = () => {
    if (newStylePrompt.trim() && !customStylePrompts.includes(newStylePrompt.trim()) && !DEFAULT_STYLE_PROMPTS.includes(newStylePrompt.trim())) {
      const newPrompts = [...customStylePrompts, newStylePrompt.trim()];
      setCustomStylePrompts(newPrompts);
      localStorage.setItem('custom_style_prompts', JSON.stringify(newPrompts));
      setNewStylePrompt('');
      setIsAddingStylePrompt(false);
    }
  };

  const deleteStylePrompt = (promptToDelete: string) => {
    const newPrompts = customStylePrompts.filter(p => p !== promptToDelete);
    setCustomStylePrompts(newPrompts);
    localStorage.setItem('custom_style_prompts', JSON.stringify(newPrompts));
  };

  const handleReset = () => {
    setParts(INITIAL_PARTS);
    setUploadedImages([]);
    setImprovedPrompt('');
    setReferenceImage(null);
    setArchitectureJson(null);
    setGeneratedImageUrl(null);
    setFinalImageUrl(null);
    setChangeIdea('');
    setJsonChangeIdea('');
    setFinalPrompt('');
  };

  const handleExport = () => {
    const data = {
      samples: samples.filter(s => !SAMPLE_PROMPTS.includes(s)),
      history,
      stylePrompts: customStylePrompts,
      parts,
      improvedPrompt,
      referenceImage,
      uploadedImages,
      finalPrompt,
      annotations
    };
    
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    const fileName = `Tool_1_Prompt_sua_anh_${day}-${month}-${year}_luc_${hours}h${minutes}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.samples) {
          const newSamples = [...SAMPLE_PROMPTS];
          for (const sample of data.samples) {
            if (!newSamples.some(s => s.title === sample.title)) {
              newSamples.push(sample);
            }
          }
          setSamples(newSamples);
          localStorage.setItem('custom_samples', JSON.stringify(newSamples.filter(s => !SAMPLE_PROMPTS.includes(s))));
        }
        if (data.history) {
          setHistory(data.history);
          localStorage.setItem('prompt_history', JSON.stringify(data.history));
        }
        if (data.stylePrompts) {
          setCustomStylePrompts(data.stylePrompts);
          localStorage.setItem('custom_style_prompts', JSON.stringify(data.stylePrompts));
        }
        if (data.parts) setParts(data.parts);
        if (data.improvedPrompt) setImprovedPrompt(data.improvedPrompt);
        if (data.referenceImage) setReferenceImage(data.referenceImage);
        if (data.uploadedImages) setUploadedImages(data.uploadedImages);
        if (data.finalPrompt) setFinalPrompt(data.finalPrompt);
        if (data.annotations) setAnnotations(data.annotations);
      } catch (error) {
        console.error("Failed to parse JSON file", error);
        alert("File không hợp lệ hoặc bị lỗi.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const generateFinalImage = async () => {
    const basePrompt = improvedPrompt || getCombinedPrompt();
    const fullPrompt = finalPrompt.trim() ? (generatedImageUrl ? finalPrompt : `${basePrompt}\n\n${finalPrompt}`) : basePrompt;

    if (!fullPrompt.trim()) return;

    setIsGeneratingFinal(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      let parts: any[] = [];
      
      if (generatedImageUrl) {
        const previewMimeType = generatedImageUrl.split(';')[0].split(':')[1];
        const previewBase64 = generatedImageUrl.split(',')[1];
        parts.push({
          inlineData: {
            data: previewBase64,
            mimeType: previewMimeType,
          }
        });
      }

      if (referenceImage) {
        const refMimeType = referenceImage.split(';')[0].split(':')[1];
        const refBase64 = referenceImage.split(',')[1];
        parts.push({
          inlineData: {
            data: refBase64,
            mimeType: refMimeType,
          }
        });
      }

      parts.push({ text: fullPrompt });

      const response = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: parts,
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K"
          },
          seed: seed,
        }
      }));

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setFinalImageUrl(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
    } catch (error: any) {
      console.error('Error generating final image:', error);
      if (error.message && (error.message.includes('PERMISSION_DENIED') || error.message.includes('Requested entity was not found'))) {
        setHasApiKey(false);
        setError('API Key không hợp lệ hoặc không có quyền truy cập. Vui lòng chọn lại API Key trả phí.');
      } else {
        setError('Có lỗi xảy ra khi tạo ảnh. Vui lòng thử lại.');
      }
    } finally {
      setIsGeneratingFinal(false);
    }
  };

  const describeImages = async (base64Datas: string[]) => {
    if (base64Datas.length === 0) return;
    setIsDescribing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
      
      const imageParts = base64Datas.map(data => ({
        inlineData: { data: data.split(',')[1], mimeType: data.split(';')[0].split(':')[1] }
      }));

      const response = await withRetry(() => ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            ...imageParts,
            { text: "Mô tả các hình ảnh này chi tiết bằng cách sử dụng cấu trúc 7 phần: Tóm tắt, Đối tượng chính, Tư thế/Hành động, Yếu tố phụ, Bối cảnh, Ánh sáng và Bố cục. Tổng hợp thông tin từ tất cả các hình ảnh để phân tích đồng bộ và bổ sung đầy đủ chi tiết. Trả về kết quả dưới dạng đối tượng JSON với các khóa này bằng tiếng Anh (summary, mainObject, poseAction, secondaryElements, background, lighting, composition) nhưng nội dung giá trị phải bằng tiếng Việt. CHỈ trả về văn bản mô tả. TUYỆT ĐỐI KHÔNG bao gồm bất kỳ chuỗi base64, URL hình ảnh, hoặc dữ liệu hình ảnh nào trong câu trả lời." }
          ]
        },
        config: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              mainObject: { type: Type.STRING },
              poseAction: { type: Type.STRING },
              secondaryElements: { type: Type.STRING },
              background: { type: Type.STRING },
              lighting: { type: Type.STRING },
              composition: { type: Type.STRING },
            }
          }
        }
      }));

      const result = JSON.parse(response.text || '{}');
      setParts(result);
    } catch (error: any) {
      console.error('Error describing image:', error);
      const errorMessage = error?.message || String(error);
      if (errorMessage.includes('503') || errorMessage.includes('UNAVAILABLE')) {
        setError('Dịch vụ AI hiện đang quá tải hoặc không khả dụng (Lỗi 503). Vui lòng thử lại sau ít phút.');
      } else {
        setError('Có lỗi xảy ra khi phân tích hình ảnh (JSON không hợp lệ hoặc quá dài). Vui lòng thử lại với hình ảnh khác.');
      }
    } finally {
      setIsDescribing(false);
    }
  };

  const loadSample = (sample: PromptParts) => {
    setParts(sample);
    setImprovedPrompt('');
    setError(null);
  };

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-6 font-sans">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-xl text-center space-y-6">
          <div className="w-16 h-16 bg-[#5A5A40]/10 rounded-2xl flex items-center justify-center mx-auto">
            <Sparkles className="w-8 h-8 text-[#5A5A40]" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-black">Cần có API Key</h2>
            <p className="text-sm text-black/60">
              Ứng dụng này sử dụng mô hình tạo ảnh chất lượng cao (Gemini 3.1 Flash Image Preview). Bạn cần chọn một API Key trả phí từ Google Cloud để tiếp tục.
            </p>
          </div>
          <button
            onClick={handleSelectKey}
            className="w-full py-3 bg-black text-white rounded-xl font-bold hover:opacity-80 transition-opacity"
          >
            Chọn API Key
          </button>
          <p className="text-xs text-black/40">
            Tìm hiểu thêm về <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline hover:text-black">thanh toán API</a>.
          </p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#5A5A40] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-black/40">Đang khởi tạo...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F5F5F0] text-black font-sans selection:bg-[#5A5A40] selection:text-white">
        {/* Header */}
        <header className="border-b border-black/10 bg-white/50 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-[#5A5A40] rounded-lg flex items-center justify-center">
                  <Sparkles className="text-white w-5 h-5" />
                </div>
                <h1 className="text-xl font-semibold tracking-tight text-black">PromptCraft AI</h1>
              </div>

              {user && (
                <div className="hidden md:flex items-center gap-2">
                  <div className="w-px h-6 bg-black/10 mx-2" />
                  <button 
                    onClick={() => setIsProjectListOpen(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-black/5 hover:bg-black/10 rounded-xl transition-all text-sm font-medium"
                  >
                    <FileText className="w-4 h-4" />
                    {currentProjectId ? projects.find(p => p.id === currentProjectId)?.name : 'Chọn dự án'}
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => saveCurrentProject()}
                    disabled={isSavingProject}
                    className="p-2 hover:bg-black/5 rounded-xl transition-all text-black/60"
                    title="Lưu dự án"
                  >
                    {isSavingProject ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              {user ? (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-black/10" />
                    <div className="hidden sm:block text-right">
                      <p className="text-xs font-bold text-black">{user.displayName}</p>
                      <button onClick={handleLogout} className="text-[10px] text-black/40 hover:text-red-500 transition-colors">Đăng xuất</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={handleLogin}
                  className="px-4 py-2 bg-black text-white rounded-xl text-sm font-bold hover:opacity-80 transition-all flex items-center gap-2"
                >
                  <User className="w-4 h-4" />
                  Đăng nhập
                </button>
              )}
              
              <div className="w-px h-6 bg-black/10 mx-1 hidden sm:block" />
              
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => importFileInputRef.current?.click()}
                  className="p-2 hover:bg-black/5 rounded-xl text-black/60 transition-colors"
                  title="Nhập dữ liệu"
                >
                  <Upload className="w-4 h-4" />
                </button>
                <input 
                  type="file"
                  ref={importFileInputRef}
                  onChange={handleImport}
                  accept=".json"
                  className="hidden"
                />
                <button 
                  onClick={handleExport}
                  className="p-2 hover:bg-black/5 rounded-xl text-black/60 transition-colors"
                  title="Xuất dữ liệu"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
              
              <div className="w-px h-6 bg-black/10 mx-1" />
              
              <div className="flex items-center gap-1">
                <button 
                  onClick={undo}
                  disabled={!canUndo}
                  className="p-2 hover:bg-black/5 rounded-xl text-black/60 disabled:opacity-20 transition-all"
                  title="Hoàn tác"
                >
                  <Undo className="w-4 h-4" />
                </button>
                <button 
                  onClick={redo}
                  disabled={!canRedo}
                  className="p-2 hover:bg-black/5 rounded-xl text-black/60 disabled:opacity-20 transition-all"
                  title="Làm lại"
                >
                  <Redo className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-[1600px] mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Input Form */}
        <div className="lg:col-span-4 space-y-8">
          {/* Sample Prompts Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">Câu lệnh mẫu</h3>
              <button 
                onClick={() => setIsSavingSample(true)}
                className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40] flex items-center gap-1 hover:opacity-70 transition-opacity"
              >
                <Plus className="w-3 h-3" />
                Lưu mẫu mới
              </button>
            </div>
            
            <AnimatePresence>
              {isSavingSample && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-4 bg-white border border-[#5A5A40]/20 rounded-2xl flex gap-3 items-center shadow-sm"
                >
                  <input 
                    autoFocus
                    type="text"
                    value={newSampleTitle}
                    onChange={(e) => setNewSampleTitle(e.target.value)}
                    placeholder="Tên câu lệnh mẫu..."
                    className="flex-1 bg-[#F5F5F0] border-none rounded-xl px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-[#5A5A40]"
                    onKeyDown={(e) => e.key === 'Enter' && saveCustomSample()}
                  />
                  <button 
                    onClick={saveCustomSample}
                    disabled={!newSampleTitle.trim()}
                    className="px-4 py-2 bg-[#5A5A40] text-white rounded-xl text-xs font-bold hover:opacity-90 disabled:opacity-30 transition-all"
                  >
                    Lưu
                  </button>
                  <button 
                    onClick={() => {
                      setIsSavingSample(false);
                      setEditingSampleTitle(null);
                      setNewSampleTitle('');
                    }}
                    className="p-2 text-black/40 hover:text-black transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex flex-wrap gap-2">
              {samples.map((sample, index) => (
                <div key={index} className="relative flex items-center">
                  {sample.isCustom ? (
                    <div className="flex items-center bg-white border border-black/10 rounded-full overflow-hidden hover:border-black transition-all shadow-sm">
                      <button
                        onClick={() => loadSample(sample)}
                        className="px-4 py-2 text-xs font-medium flex items-center gap-2 hover:bg-black/5 transition-colors active:bg-black/10"
                      >
                        <Save className="w-3 h-3 text-[#5A5A40]" />
                        {sample.title}
                      </button>
                      <div className="flex items-center border-l border-black/10 bg-black/5">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditSample(sample);
                          }}
                          className="p-2 hover:bg-white text-black/60 hover:text-[#5A5A40] transition-colors"
                          title="Chỉnh sửa"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSample(sample.title);
                          }}
                          className="p-2 hover:bg-red-500 hover:text-white text-black/60 transition-colors"
                          title="Xóa"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => loadSample(sample)}
                      className="px-4 py-2 bg-white border border-black/10 rounded-full text-xs font-medium hover:border-black transition-all active:scale-95 shadow-sm"
                    >
                      {sample.title}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Advanced Controls */}
          <section className="bg-white rounded-2xl p-6 border border-black/10 space-y-6">
            <h3 className="text-lg font-medium text-black">Điều Khiển Nâng Cao</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-black">Seed (Tính nhất quán)</label>
                  <div className="group relative">
                    <Info className="w-3.5 h-3.5 text-black cursor-help opacity-40" />
                    <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-white rounded-xl shadow-xl border border-black/5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-[10px] leading-relaxed text-black normal-case font-normal">
                      Trường Seed (Hạt giống) là một con số dùng để khởi tạo quá trình sinh ảnh. 
                      <br/><br/>
                      - <b>Giữ nguyên Seed:</b> Nếu bạn dùng cùng một câu lệnh và cùng một số Seed, AI sẽ tạo ra bức ảnh gần như giống hệt nhau. Rất hữu ích khi bạn muốn tinh chỉnh một chi tiết nhỏ mà không làm thay đổi toàn bộ bố cục.<br/>
                      - <b>Thay đổi/Để trống:</b> AI sẽ chọn một số ngẫu nhiên, tạo ra một bức ảnh hoàn toàn mới mỗi lần.
                    </div>
                  </div>
                </div>
                <input 
                  type="number"
                  value={seed || ''}
                  onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : undefined)}
                  placeholder="Ngẫu nhiên"
                  className="w-full bg-[#F5F5F0] border border-black/5 rounded-lg px-4 py-2 text-sm text-black outline-none focus:ring-1 focus:ring-[#5A5A40]"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-black">Phân Tích Hình Ảnh (Describe Canvas)</label>
                <div 
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingMain(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDraggingMain(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingMain(false);
                    const files = e.dataTransfer.files;
                    if (files && files.length > 0) {
                      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
                      if (imageFiles.length > 0) processMainImages(imageFiles);
                    }
                  }}
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (items) {
                      const imageFiles: File[] = [];
                      for (let i = 0; i < items.length; i++) {
                        if (items[i].type.indexOf('image') !== -1) {
                          const file = items[i].getAsFile();
                          if (file) imageFiles.push(file);
                        }
                      }
                      if (imageFiles.length > 0) processMainImages(imageFiles);
                    }
                  }}
                  onMouseEnter={() => setHoveredArea('main')}
                  onMouseLeave={() => setHoveredArea(null)}
                  className={cn(
                    "w-full bg-[#F5F5F0] border border-dashed rounded-lg px-4 py-2 text-sm text-black flex items-center justify-center gap-2 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/50",
                    isDraggingMain ? "border-[#5A5A40] bg-[#EBEBE5]" : "border-black/20 hover:bg-[#EBEBE5]"
                  )}
                >
                  {isDescribing ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-black" />
                  ) : (
                    <Upload className="w-4 h-4 text-black" />
                  )}
                  {uploadedImages.length > 0 ? 'Thêm ảnh khác' : 'Tải ảnh lên để phân tích'}
                </div>
                
                <AnimatePresence>
                  {uploadedImages.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4"
                    >
                      {uploadedImages.map((img, idx) => (
                        <div 
                          key={idx} 
                          className="relative group/img cursor-pointer"
                          onClick={() => {
                            setViewingImageIndex(idx);
                            setIsViewingImage(true);
                          }}
                        >
                          <img 
                            src={img} 
                            alt={`Uploaded Preview ${idx + 1}`} 
                            className="w-full h-24 object-cover rounded-xl border border-black/10"
                          />
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              removeUploadedImage(idx);
                            }}
                            className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity shadow-lg hover:scale-110 active:scale-95"
                            title="Gỡ bỏ ảnh"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  className="hidden" 
                  accept="image/*" 
                  multiple
                />
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-serif italic text-black">Khung Cấu Trúc 7 Phần</h2>
              <div className="group relative">
                <Info className="w-5 h-5 text-black cursor-help opacity-40" />
                <div className="absolute right-0 top-full mt-2 w-64 p-4 bg-white rounded-xl shadow-xl border border-black/5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-xs leading-relaxed text-black">
                  Tuân theo cấu trúc này để tạo ra các câu lệnh chuyên nghiệp. AI hoạt động tốt nhất với ngôn ngữ tự nhiên và các chi tiết trực quan cụ thể.
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              {SECTIONS.map((section) => (
                <div key={section.id} className="group relative">
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-black group-focus-within:text-[#5A5A40] transition-colors cursor-help group/label relative">
                      <section.icon className="w-3.5 h-3.5" />
                      {section.label}
                      <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-white rounded-xl shadow-xl border border-black/5 opacity-0 invisible group-hover/label:opacity-100 group-hover/label:visible transition-all z-10 text-[10px] leading-relaxed text-black normal-case font-normal">
                        {section.tooltip}
                      </div>
                    </label>
                    <button
                      onClick={() => {
                        setEditingSection(section.id);
                        setEditingSectionContent(parts[section.id as keyof PromptParts]);
                      }}
                      className="text-black/40 hover:text-black transition-colors p-1 rounded-md hover:bg-black/5"
                      title="Mở rộng để xem và sửa"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={parts[section.id as keyof PromptParts]}
                    onChange={(e) => handleInputChange(section.id as keyof PromptParts, e.target.value)}
                    placeholder={section.placeholder}
                    className={cn(
                      "w-full bg-white border border-black/10 rounded-xl p-4 text-sm text-black focus:ring-2 focus:ring-[#5A5A40]/20 focus:border-[#5A5A40] outline-none transition-all resize-none min-h-[96px] h-24",
                      isAutoFilling && section.id !== 'summary' && "animate-pulse opacity-50"
                    )}
                  />
                  {section.id === 'summary' && (
                    <div className="absolute right-3 bottom-3 flex items-center gap-2">
                      {isAutoFilling && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F5F5F0] rounded-lg text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Đang soạn thảo...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* History Section */}
          <section className="bg-white rounded-2xl border border-black/10 overflow-hidden">
            <button 
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className="w-full p-6 flex items-center justify-between bg-white hover:bg-black/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-black" />
                <h3 className="text-lg font-medium text-black">Lịch sử câu lệnh</h3>
              </div>
              {isHistoryOpen ? <ChevronUp className="w-5 h-5 text-black/50" /> : <ChevronDown className="w-5 h-5 text-black/50" />}
            </button>
            
            <AnimatePresence>
              {isHistoryOpen && (
                <motion.div 
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-6 pt-0 border-t border-black/5 space-y-4 max-h-96 overflow-y-auto">
                    {history.length === 0 ? (
                      <p className="text-sm text-black/40 italic text-center py-4">Chưa có lịch sử nào.</p>
                    ) : (
                      history.map((item) => (
                        <div key={item.id} className="p-4 bg-[#F5F5F0] rounded-xl space-y-2 group">
                          <p className="text-sm text-black line-clamp-3">{item.prompt}</p>
                          <div className="flex items-center justify-between pt-2">
                            <span className="text-[10px] text-black/40 uppercase tracking-widest font-bold">
                              {new Date(item.timestamp).toLocaleString('vi-VN')}
                            </span>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(item.prompt);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              }}
                              className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                            >
                              <Copy className="w-3 h-3" />
                              Sao chép
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>

        {/* Middle Column: Output & Preview */}
        <div className="lg:col-span-4 space-y-8">
          <div className="sticky top-24 space-y-8">
            {/* Refined Prompt Card */}
            <div className="bg-white text-black border border-black/10 rounded-3xl p-8 shadow-xl space-y-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <Sparkles className="w-24 h-24 text-black" />
              </div>
              
              <div className="flex items-center justify-between relative z-10">
                <h3 className="text-xl font-serif italic text-black">Kết Quả Tinh Chỉnh</h3>
                <div className="flex gap-2">
                  <button 
                    onClick={handleCopy}
                    className="p-2 hover:bg-black/5 rounded-lg transition-colors"
                    title="Sao chép vào bộ nhớ tạm"
                  >
                    {copied ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5 text-black" />}
                  </button>
                </div>
              </div>

              <div className="min-h-[120px] text-black leading-relaxed text-sm relative z-10">
                {isImproving ? (
                  <div className="flex items-center gap-3 text-black/40">
                    <RefreshCw className="w-4 h-4 animate-spin text-black" />
                    Đang đánh bóng ý tưởng của bạn...
                  </div>
                ) : error ? (
                  <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-xl text-black text-xs flex items-start gap-3">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                    <p>{error}</p>
                  </div>
                ) : improvedPrompt ? (
                  <div className="space-y-4">
                    <p>{improvedPrompt}</p>
                    
                    <div className="pt-4 border-t border-black/10 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-black opacity-40">Ý tưởng thay đổi</label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setIsViewingPromptIdea(true)}
                            className="text-[10px] font-medium text-[#5A5A40] bg-[#5A5A40]/10 hover:bg-[#5A5A40]/20 px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                          >
                            <Maximize2 className="w-3 h-3" />
                            Xem tất cả
                          </button>
                          <button
                            onClick={addAccentsToChangeIdea}
                            disabled={isAddingAccents || !changeIdea.trim()}
                            className="text-[10px] font-medium text-[#5A5A40] bg-[#5A5A40]/10 hover:bg-[#5A5A40]/20 px-2 py-1 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
                          >
                            {isAddingAccents ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            Thêm dấu
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          value={changeIdea}
                          onChange={(e) => setChangeIdea(e.target.value)}
                          placeholder="Ví dụ: Đổi sang ban đêm, thêm tuyết rơi..."
                          className="flex-1 bg-black/5 border border-black/5 rounded-xl px-4 py-2 text-sm text-black outline-none focus:ring-1 focus:ring-black/20"
                          onKeyDown={(e) => e.key === 'Enter' && updatePrompt()}
                        />
                        <button 
                          onClick={updatePrompt}
                          disabled={isUpdating || !changeIdea.trim()}
                          className="px-4 py-2 bg-black text-white rounded-xl text-xs font-bold hover:opacity-80 disabled:opacity-30 transition-all flex items-center gap-2"
                        >
                          {isUpdating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Cập nhật
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-black/40 italic">Điền vào khung cấu trúc và nhấn "Tinh chỉnh câu lệnh" để thấy phép màu.</p>
                )}
              </div>

              <div className="flex flex-col gap-3 relative z-10">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-black opacity-40">Bảo vệ tính nhất quán</label>
                    <div className="group relative">
                      <Info className="w-3.5 h-3.5 text-black cursor-help opacity-40" />
                      <div className="absolute right-0 bottom-full mb-2 w-64 p-3 bg-white rounded-xl shadow-xl border border-black/5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-[10px] leading-relaxed text-black normal-case font-normal">
                        Khi được bật, AI sẽ tự động thêm yêu cầu giữ nguyên các yếu tố cốt lõi của bức ảnh vào câu lệnh.
                      </div>
                    </div>
                  </div>
                  <label className="flex items-start gap-3 p-3 bg-white/50 border border-black/5 rounded-xl cursor-pointer hover:bg-white transition-colors">
                    <input 
                      type="checkbox" 
                      checked={consistencyProtection}
                      onChange={(e) => setConsistencyProtection(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-[#5A5A40] rounded border-black/20 focus:ring-[#5A5A40] cursor-pointer"
                    />
                    <span className="text-xs text-black leading-tight">Giữ nguyên bố cục, ánh sáng, phong cách, góc camera và không đổi phần ngoài nội dung tinh chỉnh</span>
                  </label>
                </div>

                {uploadedImages.length > 0 && (
                  <div className="space-y-3 p-4 bg-white/50 border border-black/5 rounded-xl">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black opacity-40">Chế độ kiểm soát hình ảnh</label>
                      <div className="group relative">
                        <Info className="w-3.5 h-3.5 text-black cursor-help opacity-40" />
                        <div className="absolute right-0 bottom-full mb-2 w-64 p-3 bg-white rounded-xl shadow-xl border border-black/5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-[10px] leading-relaxed text-black normal-case font-normal">
                          Quyết định mức độ tham chiếu đến hình dáng và cấu trúc ban đầu của hình ảnh đã tải lên.
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => setControlMethod('prompt')}
                        className={cn("p-2 text-[10px] font-medium rounded-lg border transition-all flex justify-center", controlMethod === 'prompt' ? "bg-[#5A5A40] text-white border-[#5A5A40]" : "bg-white text-black border-black/10 hover:border-black/30")}
                      >
                        Prompt
                      </button>
                      <button
                        onClick={() => setControlMethod('balanced')}
                        className={cn("p-2 text-[10px] font-medium rounded-lg border transition-all flex justify-center", controlMethod === 'balanced' ? "bg-[#5A5A40] text-white border-[#5A5A40]" : "bg-white text-black border-black/10 hover:border-black/30")}
                      >
                        Balanced
                      </button>
                      <button
                        onClick={() => setControlMethod('image')}
                        className={cn("p-2 text-[10px] font-medium rounded-lg border transition-all flex justify-center", controlMethod === 'image' ? "bg-[#5A5A40] text-white border-[#5A5A40]" : "bg-white text-black border-black/10 hover:border-black/30")}
                      >
                        Image
                      </button>
                    </div>
                    
                    <div className="space-y-2 pt-1">
                      <div className="flex justify-between text-[10px] font-bold text-black uppercase tracking-widest opacity-60">
                        <span>Mức độ kiểm soát</span>
                        <span>{controlStrengths[controlMethod]}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={controlStrengths[controlMethod]}
                        onChange={(e) => setControlStrengths({...controlStrengths, [controlMethod]: parseInt(e.target.value)})}
                        className="w-full h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-[#5A5A40]"
                      />
                      <p className="text-[10px] text-black/60 italic leading-relaxed">
                        {controlMethod === 'prompt' && "Tạo đối tượng mới hoàn toàn dựa trên mô tả bằng văn bản."}
                        {controlMethod === 'balanced' && "Giữ lại nhiều hơn hình dáng và bố cục của đối tượng gốc."}
                        {controlMethod === 'image' && "Yêu cầu tuyệt đối 100% giữ nguyên không thay đổi hình ảnh đã tải."}
                      </p>
                    </div>
                  </div>
                )}

                <button 
                  onClick={improvePrompt}
                  disabled={isImproving || !getCombinedPrompt().trim()}
                  className="w-full bg-white text-black font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] border border-black/10"
                >
                  <Sparkles className="w-5 h-5" />
                  Tinh chỉnh câu lệnh
                </button>
                <button 
                  onClick={generateImage}
                  disabled={isGenerating || (!improvedPrompt && !getCombinedPrompt().trim())}
                  className="w-full bg-[#5A5A40] text-white font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-[#4A4A30] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                >
                  {isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  Tạo ảnh xem trước
                </button>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <button 
                    onClick={() => generateDetailedArchitectureJson()}
                    disabled={isGeneratingDetailedJson || (!improvedPrompt && !getCombinedPrompt().trim() && uploadedImages.length === 0)}
                    className="w-full bg-white text-black font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] border border-black/10 text-sm"
                  >
                    {isGeneratingDetailedJson ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Layers className="w-5 h-5" />}
                    Tạo JSON Kiến trúc
                  </button>
                  <button 
                    onClick={generateArchitectureJson}
                    disabled={isGeneratingJson || (!improvedPrompt && !getCombinedPrompt().trim())}
                    className="w-full bg-white text-black font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] border border-black/10 text-sm"
                  >
                    {isGeneratingJson ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Layout className="w-5 h-5" />}
                    Tạo JSON chi tiết kiến trúc
                  </button>
                  <button 
                    onClick={autoFixAndOptimizeJson}
                    disabled={isAutoFixingJson || !architectureJson}
                    className="w-full bg-white text-black font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] border border-black/10 text-sm"
                  >
                    {isAutoFixingJson ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Wrench className="w-5 h-5" />}
                    Auto Fix & TCVN
                  </button>
                  <button 
                    onClick={analyzeAndProposeColors}
                    disabled={isAnalyzingColors || !architectureJson}
                    className="w-full bg-white text-black font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] border border-black/10 text-sm"
                  >
                    {isAnalyzingColors ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Palette className="w-5 h-5" />}
                    Màu sắc (Tối giản)
                  </button>
                </div>
                <div className="flex justify-end">
                  <label className="flex items-center gap-2 text-xs text-black/60 cursor-pointer hover:text-black transition-colors">
                    <input 
                      type="checkbox" 
                      checked={jsonInVietnamese}
                      onChange={(e) => setJsonInVietnamese(e.target.checked)}
                      className="rounded border-black/20 text-[#5A5A40] focus:ring-[#5A5A40] cursor-pointer"
                    />
                    Tạo JSON bằng Tiếng Việt
                  </label>
                </div>
              </div>
            </div>

            {/* Architecture JSON Display */}
            {architectureJson && (
              <div className="bg-white rounded-3xl border border-black/10 p-6 relative group">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-serif italic text-black">JSON Kiến trúc</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsJsonTreeView(!isJsonTreeView)}
                      className="p-2 hover:bg-black/5 rounded-xl transition-colors text-black/60 hover:text-black text-xs font-medium flex items-center gap-1"
                    >
                      {isJsonTreeView ? <FileText className="w-4 h-4" /> : <ListTree className="w-4 h-4" />}
                      {isJsonTreeView ? "Dạng văn bản" : "Dạng cây"}
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(architectureJson);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="p-2 hover:bg-black/5 rounded-xl transition-colors text-black/60 hover:text-black"
                      title="Sao chép JSON"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="relative">
                  {isJsonTreeView && getParsedJson(architectureJson) ? (
                    <div className="bg-black/5 p-4 rounded-xl overflow-auto max-h-64">
                      <JsonTreeNode data={getParsedJson(architectureJson)} />
                    </div>
                  ) : (
                    <pre className="bg-black/5 p-4 rounded-xl overflow-hidden text-xs font-mono text-black/80 whitespace-pre-wrap max-h-40">
                      {architectureJson}
                    </pre>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" />
                  <div className="absolute bottom-2 right-2 flex items-center gap-2">
                    {getParsedJson(architectureJson)?.color_proposal && (
                      <button
                        onClick={() => setIsEditingColors(true)}
                        className="p-2 bg-white shadow-md rounded-xl hover:bg-black/5 transition-colors text-indigo-600 hover:text-indigo-700 flex items-center gap-1 text-xs font-medium"
                      >
                        <Palette className="w-4 h-4" />
                        Chỉnh sửa màu sắc
                      </button>
                    )}
                    <button
                      onClick={() => setIsViewingFloorPlan(true)}
                      className="p-2 bg-white shadow-md rounded-xl hover:bg-black/5 transition-colors text-[#5A5A40] hover:text-[#4A4A30] flex items-center gap-1 text-xs font-medium"
                    >
                      <Map className="w-4 h-4" />
                      Xem sơ đồ
                    </button>
                    <button
                      onClick={() => {
                        setTempJson(architectureJson);
                        setIsViewingJson(true);
                      }}
                      className="p-2 bg-white shadow-md rounded-xl hover:bg-black/5 transition-colors text-black/60 hover:text-black flex items-center gap-1 text-xs font-medium"
                    >
                      <Maximize2 className="w-4 h-4" />
                      Xem tất cả
                    </button>
                  </div>
                </div>
                
                {jsonValidationMessages.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {jsonValidationMessages.map((msg, idx) => (
                      <div key={idx} className={cn(
                        "text-xs p-3 rounded-xl flex items-start gap-2",
                        msg.type === 'error' ? "bg-red-50 text-red-700 border border-red-100" :
                        msg.type === 'warning' ? "bg-yellow-50 text-yellow-700 border border-yellow-100" :
                        "bg-green-50 text-green-700 border border-green-100"
                      )}>
                        {msg.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> :
                         msg.type === 'warning' ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> :
                         <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                        <span>{msg.message}</span>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="pt-4 mt-4 border-t border-black/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-black opacity-40">Ý tưởng thay đổi</label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsViewingJsonIdea(true)}
                        className="text-[10px] font-medium text-[#5A5A40] bg-[#5A5A40]/10 hover:bg-[#5A5A40]/20 px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                      >
                        <Maximize2 className="w-3 h-3" />
                        Xem tất cả
                      </button>
                      <button
                        onClick={addAccentsToJsonChangeIdea}
                        disabled={isAddingAccentsToJsonIdea || !jsonChangeIdea.trim()}
                        className="text-[10px] font-medium text-[#5A5A40] bg-[#5A5A40]/10 hover:bg-[#5A5A40]/20 px-2 py-1 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {isAddingAccentsToJsonIdea ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        Thêm dấu
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={jsonChangeIdea}
                      onChange={(e) => setJsonChangeIdea(e.target.value)}
                      placeholder="Ví dụ: Đổi sang ban đêm, thêm tuyết rơi..."
                      className="flex-1 bg-black/5 border border-black/5 rounded-xl px-4 py-2 text-sm text-black outline-none focus:ring-1 focus:ring-black/20"
                      onKeyDown={(e) => e.key === 'Enter' && updateJsonAndPrompt()}
                    />
                    <button 
                      onClick={updateJsonAndPrompt}
                      disabled={isUpdatingJsonIdea || !jsonChangeIdea.trim()}
                      className="px-4 py-2 bg-black text-white rounded-xl text-xs font-bold hover:opacity-80 disabled:opacity-30 transition-all flex items-center gap-2"
                    >
                      {isUpdatingJsonIdea ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Cập nhật
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Image Preview */}
            <div className="bg-white rounded-3xl border border-black/10 overflow-hidden aspect-square flex items-center justify-center relative group">
              {isGenerating ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-4 border-[#5A5A40] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-medium text-black/40">Đang tổng hợp hình ảnh...</p>
                </div>
              ) : generatedImageUrl ? (
                <>
                  <img 
                    src={generatedImageUrl} 
                    alt="Generated Preview" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <a 
                      href={generatedImageUrl} 
                      download="prompt-craft-preview.png"
                      className="bg-white text-black px-6 py-3 rounded-full font-semibold flex items-center gap-2 hover:scale-105 transition-transform"
                    >
                      Tải ảnh xuống
                    </a>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-4 text-black/20">
                  <ImageIcon className="w-16 h-16 stroke-[1] text-black opacity-20" />
                  <p className="text-sm text-black opacity-40">Ảnh xem trước sẽ xuất hiện ở đây</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Style Transfer & Material Swap */}
        <div className="lg:col-span-4 space-y-8">
          <div className="sticky top-24 space-y-8">
            <div className="bg-white text-black border border-black/10 rounded-3xl p-8 shadow-xl space-y-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <Palette className="w-24 h-24 text-black" />
              </div>
              
              <div className="flex items-center justify-between relative z-10">
                <h3 className="text-xl font-serif italic text-black">Truyền Tải Phong Cách</h3>
              </div>

              <div className="space-y-6 relative z-10">
                {/* Material/Furniture Directory */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-widest text-black">Thư mục vật liệu/nội thất</label>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMaterialLink}
                      onChange={(e) => setNewMaterialLink(e.target.value)}
                      placeholder="Nhập đường dẫn web hoặc thư mục máy tính..."
                      className="flex-1 bg-white/50 border border-black/10 rounded-xl px-4 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/50"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newMaterialLink.trim()) {
                          setMaterialLinks([...materialLinks, newMaterialLink.trim()]);
                          setNewMaterialLink('');
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (newMaterialLink.trim()) {
                          setMaterialLinks([...materialLinks, newMaterialLink.trim()]);
                          setNewMaterialLink('');
                        }
                      }}
                      disabled={!newMaterialLink.trim()}
                      className="px-4 py-2 bg-[#5A5A40] text-white rounded-xl text-sm font-medium hover:bg-[#4A4A30] transition-colors disabled:opacity-50"
                    >
                      Lưu link
                    </button>
                  </div>
                  {materialLinks.length > 0 && (
                    <div className="space-y-2 mt-3">
                      {materialLinks.map((link, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-white/50 border border-black/5 rounded-lg p-2 group">
                          <a 
                            href={link.startsWith('http') ? link : '#'} 
                            target={link.startsWith('http') ? "_blank" : "_self"}
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline truncate flex-1 mr-2"
                            onClick={(e) => {
                              if (!link.startsWith('http')) {
                                e.preventDefault();
                                navigator.clipboard.writeText(link);
                                alert('Đã copy đường dẫn thư mục vào clipboard!');
                              }
                            }}
                            title={link.startsWith('http') ? "Mở trang web" : "Click để copy đường dẫn"}
                          >
                            {link}
                          </a>
                          <button
                            onClick={() => {
                              setMaterialLinks(materialLinks.filter((_, i) => i !== idx));
                            }}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                            title="Xóa link"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reference Image Upload */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-widest text-black">Ảnh tham chiếu (Reference Image)</label>
                    <a 
                      href={`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(parts.mainObject || parts.summary || 'design inspiration')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold uppercase tracking-widest text-[#E60023] flex items-center gap-1 hover:opacity-70 transition-opacity"
                      title="Tìm ý tưởng trên Pinterest"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.951-7.252 4.182 0 7.433 2.982 7.433 6.963 0 4.156-2.618 7.502-6.255 7.502-1.222 0-2.372-.635-2.763-1.385l-.752 2.867c-.272 1.036-.999 2.332-1.492 3.124 1.124.346 2.316.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.367 18.592 0 12.017 0z"/>
                      </svg>
                      Pinterest
                    </a>
                  </div>
                  <div 
                    tabIndex={0}
                    onClick={() => refFileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingRef(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsDraggingRef(false); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingRef(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file && file.type.startsWith('image/')) processRefImage(file);
                    }}
                    onPaste={(e) => {
                      const items = e.clipboardData?.items;
                      if (items) {
                        for (let i = 0; i < items.length; i++) {
                          if (items[i].type.indexOf('image') !== -1) {
                            const file = items[i].getAsFile();
                            if (file) processRefImage(file);
                            break;
                          }
                        }
                      }
                    }}
                    onMouseEnter={() => setHoveredArea('ref')}
                    onMouseLeave={() => setHoveredArea(null)}
                    className={cn(
                      "w-full aspect-video rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 cursor-pointer transition-all overflow-hidden relative group/ref focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/50",
                      referenceImage 
                        ? "border-transparent" 
                        : isDraggingRef 
                          ? "border-[#5A5A40] bg-[#F5F5F0]" 
                          : "border-black/20 hover:border-[#5A5A40] hover:bg-[#F5F5F0]"
                    )}
                  >
                    {referenceImage ? (
                      <>
                        <img src={referenceImage} alt="Reference" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/ref:opacity-100 transition-opacity flex items-center justify-center">
                          <p className="text-white font-semibold flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            Thay đổi ảnh
                          </p>
                        </div>
                        <button 
                          onClick={removeReferenceImage}
                          className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover/ref:opacity-100 transition-opacity shadow-lg hover:scale-110 active:scale-95 z-10"
                          title="Gỡ bỏ ảnh"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="w-12 h-12 bg-black/5 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Upload className="w-5 h-5 text-black/40" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-black">Tải lên ảnh tham khảo</p>
                          <p className="text-xs text-black/40 mt-1">Có thể click, drag, paste từ clipboard</p>
                          <p className="text-xs text-black/40 mt-1">PNG, JPG (Tối đa 5MB)</p>
                        </div>
                      </>
                    )}
                    <input 
                      type="file" 
                      ref={refFileInputRef} 
                      onChange={handleReferenceImageUpload} 
                      className="hidden" 
                      accept="image/*" 
                    />
                  </div>
                </div>

                {/* Style Prompts List */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-widest text-black">Câu lệnh mẫu</label>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => setIsAddingStylePrompt(!isAddingStylePrompt)}
                        className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40] flex items-center gap-1 hover:opacity-70 transition-opacity"
                      >
                        <Plus className="w-3 h-3" />
                        Lưu mẫu mới
                      </button>
                      <button
                        onClick={() => setIsViewingAllStyles(true)}
                        className="text-black/40 hover:text-black transition-colors p-1 rounded-md hover:bg-black/5"
                        title="Xem tất cả"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  
                  <AnimatePresence>
                    {isAddingStylePrompt && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex gap-2 mb-3"
                      >
                        <input 
                          type="text"
                          value={newStylePrompt}
                          onChange={(e) => setNewStylePrompt(e.target.value)}
                          placeholder="Nhập câu lệnh mẫu mới..."
                          className="flex-1 bg-black/5 border border-black/5 rounded-xl px-4 py-2 text-sm text-black outline-none focus:ring-1 focus:ring-black/20"
                          onKeyDown={(e) => e.key === 'Enter' && addStylePrompt()}
                        />
                        <button 
                          onClick={addStylePrompt}
                          disabled={!newStylePrompt.trim()}
                          className="px-4 py-2 bg-black text-white rounded-xl text-xs font-bold hover:opacity-80 disabled:opacity-30 transition-all"
                        >
                          Lưu
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {DEFAULT_STYLE_PROMPTS.map((prompt, index) => (
                      <div 
                        key={`default-${index}`}
                        onClick={() => setFinalPrompt(prev => prev ? `${prev}\n${prompt}` : prompt)}
                        className="p-3 bg-black/5 rounded-xl text-xs text-black cursor-pointer hover:bg-black/10 transition-colors"
                      >
                        {prompt}
                      </div>
                    ))}
                    {customStylePrompts.map((prompt, index) => (
                      <div 
                        key={`custom-${index}`}
                        className="p-3 bg-[#F5F5F0] border border-[#5A5A40]/20 rounded-xl text-xs text-black cursor-pointer hover:bg-[#EBEBE5] transition-colors relative group flex gap-2 items-start"
                        onClick={() => setFinalPrompt(prev => prev ? `${prev}\n${prompt}` : prompt)}
                      >
                        <Save className="w-3.5 h-3.5 text-[#5A5A40] shrink-0 mt-0.5" />
                        <span className="flex-1">{prompt}</span>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteStylePrompt(prompt); }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 text-red-500 rounded transition-all ml-2"
                          title="Xóa mẫu này"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Final Prompt Input */}
                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase tracking-widest text-black">Yêu cầu tạo ảnh cuối cùng</label>
                  <textarea 
                    value={finalPrompt}
                    onChange={(e) => setFinalPrompt(e.target.value)}
                    placeholder="Nhập nội dung yêu cầu..."
                    className="w-full bg-black/5 border border-black/5 rounded-xl px-4 py-3 text-sm text-black outline-none focus:ring-1 focus:ring-black/20 min-h-[100px] resize-y"
                  />
                </div>

                {/* Generate Button */}
                <button 
                  onClick={generateFinalImage}
                  disabled={isGeneratingFinal || (!finalPrompt.trim() && !(improvedPrompt || getCombinedPrompt()).trim())}
                  className="w-full bg-[#5A5A40] text-white font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-[#4A4A30] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                >
                  {isGeneratingFinal ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  Tạo ảnh cuối cùng
                </button>
              </div>
            </div>

            {/* Final Image Preview */}
            <div className="bg-white rounded-3xl border border-black/10 overflow-hidden aspect-square flex items-center justify-center relative group">
              {isGeneratingFinal ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-4 border-[#5A5A40] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-medium text-black/40">Đang tạo ảnh cuối cùng...</p>
                </div>
              ) : finalImageUrl ? (
                <>
                  <img 
                    src={finalImageUrl} 
                    alt="Final Generated" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <a 
                      href={finalImageUrl} 
                      download="prompt-craft-final.png"
                      className="bg-white text-black px-6 py-3 rounded-full font-semibold flex items-center gap-2 hover:scale-105 transition-transform"
                    >
                      Tải ảnh xuống
                    </a>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-4 text-black/20">
                  <ImageIcon className="w-16 h-16 stroke-[1] text-black opacity-20" />
                  <p className="text-sm text-black opacity-40">Ảnh cuối cùng sẽ xuất hiện ở đây</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isViewingImage && uploadedImages.length > 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsViewingImage(false)}
          >
            <div className="relative max-w-5xl max-h-[90vh] w-full flex items-center justify-center">
              <button 
                onClick={() => setIsViewingImage(false)}
                className="absolute -top-12 right-0 p-2 text-white hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              <img 
                src={uploadedImages[viewingImageIndex]} 
                alt="Full size view" 
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </motion.div>
        )}

        {editingSection && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setEditingSection(null)}
          >
            <div 
              className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-black/10 flex items-center justify-between bg-[#F5F5F0]">
                <h3 className="text-sm font-bold uppercase tracking-widest text-black flex items-center gap-2">
                  {SECTIONS.find(s => s.id === editingSection)?.icon && React.createElement(SECTIONS.find(s => s.id === editingSection)!.icon, { className: "w-4 h-4" })}
                  {SECTIONS.find(s => s.id === editingSection)?.label}
                </h3>
                <button 
                  onClick={() => setEditingSection(null)}
                  className="p-1 hover:bg-black/10 rounded-md transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 flex-1 overflow-y-auto">
                <textarea
                  value={editingSectionContent}
                  onChange={(e) => {
                    setEditingSectionContent(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  ref={(el) => {
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = el.scrollHeight + 'px';
                    }
                  }}
                  className="w-full min-h-[400px] bg-white border border-black/10 rounded-xl p-4 text-sm text-black focus:ring-2 focus:ring-[#5A5A40]/20 focus:border-[#5A5A40] outline-none transition-all resize-none overflow-hidden"
                  placeholder="Nhập nội dung..."
                />
              </div>
              <div className="p-4 border-t border-black/10 flex justify-end gap-3 bg-[#F5F5F0]">
                <button 
                  onClick={() => setEditingSection(null)}
                  className="px-6 py-2 rounded-xl text-sm font-bold text-black hover:bg-black/5 transition-colors"
                >
                  Trở về
                </button>
                <button 
                  onClick={() => {
                    handleInputChange(editingSection as keyof PromptParts, editingSectionContent);
                    setEditingSection(null);
                  }}
                  className="px-6 py-2 bg-[#5A5A40] text-white rounded-xl text-sm font-bold hover:bg-[#4A4A30] transition-colors"
                >
                  Cập nhật
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {isViewingAllStyles && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsViewingAllStyles(false)}
          >
            <div 
              className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-black/10 flex items-center justify-between bg-[#F5F5F0]">
                <h3 className="text-sm font-bold uppercase tracking-widest text-black flex items-center gap-2">
                  <Palette className="w-4 h-4" />
                  Tất cả phong cách mẫu
                </h3>
                <button 
                  onClick={() => setIsViewingAllStyles(false)}
                  className="p-1 hover:bg-black/10 rounded-md transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 flex-1 overflow-y-auto bg-white">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-black/40 mb-4">Mẫu hệ thống</h4>
                    {DEFAULT_STYLE_PROMPTS.map((prompt, index) => (
                      <div 
                        key={`modal-default-${index}`}
                        onClick={() => setSelectedStyleInModal(prompt)}
                        className={cn(
                          "p-4 rounded-xl text-sm cursor-pointer transition-all border",
                          selectedStyleInModal === prompt 
                            ? "bg-[#5A5A40]/10 border-[#5A5A40] text-black" 
                            : "bg-black/5 border-transparent text-black/80 hover:bg-black/10"
                        )}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="flex-1">{prompt}</span>
                          {selectedStyleInModal === prompt && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40] shrink-0 bg-white px-2 py-1 rounded-md border border-[#5A5A40]/20">Đã chọn</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-black/40 mb-4">Mẫu của bạn</h4>
                    {customStylePrompts.length === 0 ? (
                      <p className="text-sm text-black/40 italic">Chưa có mẫu nào được lưu.</p>
                    ) : (
                      customStylePrompts.map((prompt, index) => (
                        <div 
                          key={`modal-custom-${index}`}
                          onClick={() => setSelectedStyleInModal(prompt)}
                          className={cn(
                            "p-4 rounded-xl text-sm cursor-pointer transition-all border relative group",
                            selectedStyleInModal === prompt 
                              ? "bg-[#5A5A40]/10 border-[#5A5A40] text-black" 
                              : "bg-[#F5F5F0] border-[#5A5A40]/20 text-black hover:bg-[#EBEBE5]"
                          )}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <span className="flex-1">{prompt}</span>
                            {selectedStyleInModal === prompt && (
                              <span className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40] shrink-0 bg-white px-2 py-1 rounded-md border border-[#5A5A40]/20">Đã chọn</span>
                            )}
                          </div>
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              deleteStylePrompt(prompt); 
                              if (selectedStyleInModal === prompt) setSelectedStyleInModal(null);
                            }}
                            className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:scale-110"
                            title="Xóa mẫu này"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-black/10 flex justify-end gap-3 bg-[#F5F5F0]">
                <button 
                  onClick={() => setIsViewingAllStyles(false)}
                  className="px-6 py-2 rounded-xl text-sm font-bold text-black hover:bg-black/5 transition-colors"
                >
                  Trở về
                </button>
                <button 
                  onClick={() => {
                    if (selectedStyleInModal) {
                      setFinalPrompt(prev => prev ? `${prev}\n${selectedStyleInModal}` : selectedStyleInModal);
                      setIsViewingAllStyles(false);
                      setSelectedStyleInModal(null);
                    }
                  }}
                  disabled={!selectedStyleInModal}
                  className="px-6 py-2 bg-[#5A5A40] text-white rounded-xl text-sm font-bold hover:bg-[#4A4A30] disabled:opacity-30 transition-colors"
                >
                  Cập nhật
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Prompt Idea Modal */}
      <AnimatePresence>
        {isViewingPromptIdea && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-black/10 flex items-center justify-between bg-[#F5F5F0]">
                <h3 className="text-xl font-serif italic text-black">Ý tưởng thay đổi</h3>
                <button onClick={() => setIsViewingPromptIdea(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <textarea
                  value={changeIdea}
                  onChange={(e) => setChangeIdea(e.target.value)}
                  className="w-full h-64 p-4 bg-black/5 border border-black/10 rounded-xl text-black resize-none focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/50"
                  placeholder="Nhập ý tưởng thay đổi của bạn..."
                />
              </div>
              <div className="p-6 border-t border-black/10 bg-white flex justify-end gap-3">
                <button
                  onClick={() => setIsViewingPromptIdea(false)}
                  className="px-6 py-2 rounded-xl font-medium text-black hover:bg-black/5 transition-colors"
                >
                  Trở về
                </button>
                <button
                  onClick={async () => {
                    await updatePrompt();
                    setIsViewingPromptIdea(false);
                  }}
                  disabled={isUpdating || !changeIdea.trim()}
                  className="px-6 py-2 bg-[#5A5A40] text-white rounded-xl font-medium hover:bg-[#4A4A30] transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isUpdating ? <RefreshCw className="w-5 h-5 animate-spin" /> : null}
                  Cập nhật
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* JSON Idea Modal */}
      <AnimatePresence>
        {isViewingJsonIdea && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-black/10 flex items-center justify-between bg-[#F5F5F0]">
                <h3 className="text-xl font-serif italic text-black">Ý tưởng thay đổi JSON</h3>
                <button onClick={() => setIsViewingJsonIdea(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <textarea
                  value={jsonChangeIdea}
                  onChange={(e) => setJsonChangeIdea(e.target.value)}
                  className="w-full h-64 p-4 bg-black/5 border border-black/10 rounded-xl text-black resize-none focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/50"
                  placeholder="Nhập ý tưởng thay đổi JSON của bạn..."
                />
              </div>
              <div className="p-6 border-t border-black/10 bg-white flex justify-end gap-3">
                <button
                  onClick={() => setIsViewingJsonIdea(false)}
                  className="px-6 py-2 rounded-xl font-medium text-black hover:bg-black/5 transition-colors"
                >
                  Trở về
                </button>
                <button
                  onClick={async () => {
                    await updateJsonAndPrompt();
                    setIsViewingJsonIdea(false);
                  }}
                  disabled={isUpdatingJsonIdea || !jsonChangeIdea.trim()}
                  className="px-6 py-2 bg-[#5A5A40] text-white rounded-xl font-medium hover:bg-[#4A4A30] transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isUpdatingJsonIdea ? <RefreshCw className="w-5 h-5 animate-spin" /> : null}
                  Cập nhật
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* JSON Edit Modal */}
      <AnimatePresence>
        {isViewingJson && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-black/10 flex items-center justify-between bg-[#F5F5F0]">
                <h3 className="text-xl font-serif italic text-black">
                  {isEditingJson ? "Chỉnh sửa JSON Kiến trúc" : "Chi tiết JSON Kiến trúc"}
                </h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setIsEditingJson(!isEditingJson)}
                    className="text-sm font-medium text-[#5A5A40] hover:text-[#4A4A30] flex items-center gap-1"
                  >
                    {isEditingJson ? <FileText className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                    {isEditingJson ? "Xem dạng cây" : "Chỉnh sửa"}
                  </button>
                  <button onClick={() => {
                    setIsViewingJson(false);
                    setIsEditingJson(false);
                  }} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto flex-1 bg-black/5">
                {isEditingJson ? (
                  <textarea
                    value={tempJson}
                    onChange={(e) => setTempJson(e.target.value)}
                    className="w-full min-h-[500px] p-4 bg-white border border-black/10 rounded-xl text-black font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/50 shadow-inner"
                    spellCheck={false}
                  />
                ) : (
                  <div className="w-full min-h-[500px] p-4 bg-white border border-black/10 rounded-xl overflow-auto shadow-inner">
                    {getParsedJson(tempJson) ? (
                      <JsonTreeNode data={getParsedJson(tempJson)} />
                    ) : (
                      <div className="text-red-500 font-mono text-sm">JSON không hợp lệ. Vui lòng chuyển sang chế độ chỉnh sửa để sửa lỗi.</div>
                    )}
                  </div>
                )}
              </div>
              <div className="p-6 border-t border-black/10 bg-white flex justify-end gap-3">
                <button
                  onClick={() => {
                    setIsViewingJson(false);
                    setIsEditingJson(false);
                  }}
                  className="px-6 py-2 rounded-xl font-medium text-black hover:bg-black/5 transition-colors"
                >
                  Trở về
                </button>
                {isEditingJson && (
                  <button
                    onClick={handleUpdateJson}
                    disabled={isUpdatingPromptFromJson}
                    className="px-6 py-2 bg-[#5A5A40] text-white rounded-xl font-medium hover:bg-[#4A4A30] transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isUpdatingPromptFromJson ? <RefreshCw className="w-5 h-5 animate-spin" /> : null}
                    Cập nhật
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Color Editor Modal */}
      <AnimatePresence>
        {isEditingColors && architectureJson && (
          <ColorEditorModal 
            architectureJson={architectureJson}
            setArchitectureJson={setArchitectureJson}
            onClose={() => setIsEditingColors(false)}
          />
        )}
      </AnimatePresence>

      {/* Floor Plan Viewer Modal */}
      <AnimatePresence>
        {isViewingFloorPlan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-black/10 flex items-center justify-between bg-[#F5F5F0]">
                <div className="flex items-center gap-4">
                  <h3 className="text-xl font-serif italic text-black flex items-center gap-2">
                    <Map className="w-5 h-5" />
                    Sơ đồ minh họa mặt bằng kiến trúc
                  </h3>
                  
                  {/* Drawing Toolbar */}
                  <div className="flex items-center gap-2 bg-white/50 p-1 rounded-xl border border-black/5 ml-4">
                    <button 
                      onClick={() => setIsDrawingMode(!isDrawingMode)}
                      className={cn(
                        "p-2 rounded-lg transition-all flex items-center gap-2 text-xs font-bold",
                        isDrawingMode ? "bg-black text-white" : "hover:bg-black/5 text-black/60"
                      )}
                      title="Chế độ vẽ"
                    >
                      <Pencil className="w-4 h-4" />
                      {isDrawingMode ? "Đang vẽ" : "Vẽ ghi chú"}
                    </button>
                    
                    {isDrawingMode && (
                      <>
                        <div className="w-px h-6 bg-black/10 mx-1" />
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => setDrawingTool('pencil')}
                            className={cn(
                              "p-1.5 rounded-lg transition-all",
                              drawingTool === 'pencil' ? "bg-black/10 text-black" : "text-black/40 hover:bg-black/5"
                            )}
                            title="Bút chì"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setDrawingTool('text')}
                            className={cn(
                              "p-1.5 rounded-lg transition-all",
                              drawingTool === 'text' ? "bg-black/10 text-black" : "text-black/40 hover:bg-black/5"
                            )}
                            title="Văn bản"
                          >
                            <TypeIcon className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="w-px h-6 bg-black/10 mx-1" />
                        <div className="flex items-center gap-1">
                          {['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#000000'].map(color => (
                            <button 
                              key={color}
                              onClick={() => setDrawingColor(color)}
                              className={cn(
                                "w-6 h-6 rounded-full border-2 transition-transform",
                                drawingColor === color ? "border-black scale-110" : "border-transparent hover:scale-105"
                              )}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                        <div className="w-px h-6 bg-black/10 mx-1" />
                        <select 
                          value={drawingWidth}
                          onChange={(e) => setDrawingWidth(Number(e.target.value))}
                          className="bg-transparent text-xs font-bold outline-none cursor-pointer"
                        >
                          <option value={2}>Mảnh</option>
                          <option value={5}>Vừa</option>
                          <option value={10}>Dày</option>
                        </select>
                        <div className="w-px h-6 bg-black/10 mx-1" />
                        <button 
                          onClick={() => setAnnotations(annotations.slice(0, -1))}
                          className="p-2 hover:bg-black/5 rounded-lg text-black/60"
                          title="Hoàn tác"
                        >
                          <Undo className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                            if (confirm("Xóa tất cả ghi chú?")) {
                              setAnnotations([]);
                            }
                          }}
                          className="p-2 hover:bg-black/5 rounded-lg text-red-500"
                          title="Xóa tất cả"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <button onClick={() => setIsViewingFloorPlan(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1 bg-black/5 flex flex-col items-center justify-center min-h-[500px] relative">
                {getParsedJson(architectureJson) ? (
                  <div className="w-full h-full max-h-[60vh] flex items-center justify-center bg-white rounded-xl shadow-inner p-4 border border-black/10 overflow-auto">
                    <FloorPlanViewer 
                      data={getParsedJson(architectureJson)} 
                      interactive={true} 
                      annotations={annotations}
                      onAnnotationsChange={setAnnotations}
                      isDrawingMode={isDrawingMode}
                      drawingColor={drawingColor}
                      drawingWidth={drawingWidth}
                      drawingTool={drawingTool}
                    />
                  </div>
                ) : (
                  <div className="text-red-500 font-mono text-sm bg-white p-4 rounded-xl shadow-inner border border-black/10">
                    JSON không hợp lệ. Không thể vẽ sơ đồ.
                  </div>
                )}
                {(!getParsedJson(architectureJson) || !getParsedJson(architectureJson).ascii_diagram) && (
                  <div className="mt-4 w-full flex justify-center gap-6 text-xs text-black/60">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-[#e9ecef] border border-[#dee2e6] opacity-50"></div>
                      <span>Phòng</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-1 bg-[#343a40]"></div>
                      <span>Tường</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-white border border-[#e63946] flex items-center justify-center">
                        <div className="w-2 h-2 border-t border-l border-[#e63946] rounded-tl-full"></div>
                      </div>
                      <span>Cửa đi</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-2 bg-[#e0fbfc] border border-[#0077b6]"></div>
                      <span>Cửa sổ</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="p-6 border-t border-black/10 bg-white flex justify-end gap-3">
                <button
                  onClick={() => setIsViewingFloorPlan(false)}
                  className="px-6 py-2 rounded-xl font-medium text-black hover:bg-black/5 transition-colors"
                >
                  Trở về
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-black/5">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-xs font-bold uppercase tracking-widest text-black">
          <p>© 2026 PromptCraft AI • Vận hành bởi Gemini</p>
          <div className="flex gap-8">
            <a href="#" className="hover:opacity-60 transition-colors">Tài liệu</a>
            <a href="#" className="hover:opacity-60 transition-colors">API</a>
            <a href="#" className="hover:opacity-60 transition-colors">Chính sách bảo mật</a>
          </div>
        </div>
      </footer>
      {/* Project List Modal */}
      <AnimatePresence>
        {isProjectListOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-black/10 flex items-center justify-between bg-[#F5F5F0]">
                <h3 className="text-xl font-serif italic text-black">Dự án của bạn</h3>
                <button onClick={() => setIsProjectListOpen(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1 space-y-2">
                <button 
                  onClick={() => {
                    createNewProject();
                    setIsProjectListOpen(false);
                  }}
                  className="w-full p-4 border-2 border-dashed border-black/10 rounded-2xl flex items-center justify-center gap-2 text-black/40 hover:border-black/30 hover:text-black/60 transition-all"
                >
                  <Plus className="w-5 h-5" />
                  <span className="font-bold">Tạo dự án mới</span>
                </button>
                
                {projects.map((project) => (
                  <div 
                    key={project.id}
                    className={cn(
                      "group p-4 rounded-2xl border transition-all flex items-center justify-between cursor-pointer",
                      currentProjectId === project.id 
                        ? "bg-[#5A5A40]/10 border-[#5A5A40] text-black" 
                        : "bg-white border-black/5 hover:border-black/20"
                    )}
                    onClick={() => {
                      setCurrentProjectId(project.id);
                      setIsProjectListOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center group-hover:bg-black/10 transition-colors">
                        <FileText className="w-5 h-5 text-black/40" />
                      </div>
                      <div>
                        <p className="font-bold text-sm">{project.name}</p>
                        <p className="text-[10px] text-black/40">Cập nhật: {project.updatedAt?.toDate().toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          const newName = prompt("Nhập tên mới cho dự án:", project.name);
                          if (newName) updateDoc(doc(db, 'projects', project.id), { name: newName });
                        }}
                        className="p-2 hover:bg-black/5 rounded-lg text-black/40 hover:text-black"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm("Xóa dự án này?")) {
                            await deleteDoc(doc(db, 'projects', project.id));
                            if (currentProjectId === project.id) setCurrentProjectId(null);
                          }
                        }}
                        className="p-2 hover:bg-black/5 rounded-lg text-black/40 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </ErrorBoundary>
  );
}
