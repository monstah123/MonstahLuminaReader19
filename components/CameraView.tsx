import React, { useRef, useEffect, useState } from 'react';
import { Camera, RefreshCw, CameraOff, Video } from 'lucide-react';

interface CameraViewProps {
  onCapture: (base64Image: string) => void;
}

export const CameraView: React.FC<CameraViewProps> = ({ onCapture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [isStreamReady, setIsStreamReady] = useState(false);

  // Handle visibility (Tab switch / Screen lock recovery)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isActive) {
        startCamera();
      } else if (document.visibilityState === 'hidden') {
         stopCamera(); // Optional: stop to save battery when hidden
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isActive]);

  // Lifecycle management
  useEffect(() => {
    if (isActive) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isActive]);

  const startCamera = async () => {
    stopCamera(); // Ensure clean state
    setError(null);
    setIsStreamReady(false);

    if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera API not supported in this browser.");
        return;
    }

    try {
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };
      
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = mediaStream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        // Wait for video to actually be ready to play
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(console.error);
          setIsStreamReady(true);
        };
      }
    } catch (err: any) {
      console.error("Error accessing camera:", err);
      // If error is due to context/permission not allowed (common on initial load without gesture),
      // fallback to inactive state so user sees "Turn On Camera" button instead of error.
      // This forces the user to interact (click 'Turn On') which satisfies browser security policies.
      const msg = err.message || '';
      if (
        err.name === 'NotAllowedError' || 
        err.name === 'PermissionDeniedError' || 
        msg.toLowerCase().includes('not allowed') ||
        msg.toLowerCase().includes('permission')
      ) {
         setIsActive(false);
      } else {
         setError("Could not access camera. Please ensure permissions are granted.");
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreamReady(false);
  };

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current && isStreamReady) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64 = dataUrl.split(',')[1];
        onCapture(base64);
      }
    }
  };

  const toggleCamera = () => {
    setIsActive(!isActive);
  };

  // Error State
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] bg-gray-900 rounded-2xl text-white p-6 text-center border border-gray-800">
        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
           <CameraOff className="text-red-500" size={32} />
        </div>
        <h3 className="text-lg font-bold mb-2">Camera Unavailable</h3>
        <p className="mb-6 text-gray-400 text-sm max-w-xs">{error}</p>
        <button 
          onClick={() => startCamera()}
          className="px-6 py-3 bg-brand-gold text-brand-dark font-bold rounded-xl hover:bg-yellow-500 transition flex items-center gap-2"
        >
          <RefreshCw size={18} />
          Retry Camera
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden rounded-2xl shadow-2xl border border-gray-800 group">
      
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover transition-opacity duration-500 ${isActive && isStreamReady ? 'opacity-100' : 'opacity-0'}`}
      />
      
      {/* Placeholder when inactive/loading */}
      {(!isActive || !isStreamReady) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-gray-500">
           {!isActive ? (
              <div className="text-center">
                 <CameraOff size={48} className="mx-auto mb-3 opacity-50" />
                 <p>Camera Paused</p>
              </div>
           ) : (
              <div className="animate-pulse">
                <Camera size={48} className="opacity-50" />
              </div>
           )}
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
      
      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
         <div className="flex justify-between items-start">
            <div className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-white/80 text-xs font-medium border border-white/10">
               {isActive ? "Live Feed" : "Paused"}
            </div>
            
            {/* Toggle Button */}
            <button 
               onClick={toggleCamera}
               className="pointer-events-auto p-3 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-white hover:text-black transition border border-white/10"
               title={isActive ? "Turn Camera Off" : "Turn Camera On"}
            >
               {isActive ? <Video size={20} /> : <CameraOff size={20} />}
            </button>
         </div>

         {/* Center Frame Guide */}
         {isActive && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-80 border-2 border-brand-gold/50 rounded-lg">
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-brand-gold"></div>
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-brand-gold"></div>
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-brand-gold"></div>
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-brand-gold"></div>
            <p className="absolute -bottom-8 w-full text-center text-white/80 text-sm bg-black/50 px-2 py-1 rounded-full backdrop-blur-sm">
              Align book cover
            </p>
          </div>
         )}

         {/* Capture Button Area */}
         <div className="flex justify-center pointer-events-auto pt-4">
            {isActive ? (
               <button
                onClick={handleCapture}
                disabled={!isStreamReady}
                className="w-16 h-16 rounded-full bg-white border-4 border-brand-gold flex items-center justify-center shadow-[0_0_20px_rgba(212,175,55,0.5)] hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Capture"
              >
                <Camera className="w-8 h-8 text-brand-dark" />
              </button>
            ) : (
              <button
                onClick={toggleCamera}
                className="px-6 py-3 bg-brand-gold text-brand-dark font-bold rounded-full shadow-lg hover:bg-yellow-500 transition"
              >
                Turn On Camera
              </button>
            )}
         </div>
      </div>
    </div>
  );
};