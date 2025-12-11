import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, StopCircle, Gauge, Bookmark as BookmarkIcon, HardDrive, Settings, Volume2, Volume1, VolumeX, ChevronDown, ChevronUp, Maximize2, Minimize2, Globe, ToggleRight, ToggleLeft, Loader2 } from 'lucide-react';
import { decodeBase64, decodeAudioData, formatTime, saveFile, createWavBlob } from '../utils/audioUtils';
import { Visualizer } from './Visualizer';
import { VoiceName, Language } from '../types';
import { CircularProgress } from './CircularProgress';

interface AudioPlayerProps {
  base64Audio: string | null;
  initialStartTime?: number;
  seekTrigger?: { time: number; id: number } | null;
  onFinished?: () => void;
  onBookmark?: (timestamp: number) => void;
  onProgress?: (percent: number) => void;
  coverImage?: string | null;
  bookTitle?: string;
  chapterTitle?: string;
  currentVoice: VoiceName;
  onVoiceChange: (voice: VoiceName) => void;
  currentLanguage: Language;
  onLanguageChange: (lang: Language) => void;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  autoPlayNext: boolean;
  onToggleAutoPlayNext: () => void;
  autoStart: boolean;
  onToggleAutoStart: () => void;
  isLoading?: boolean;
  loadingProgress?: number;
}

const VOICES: { name: VoiceName, desc: string }[] = [
  { name: 'Kore', desc: 'Calm & Soothing (Female)' },
  { name: 'Zephyr', desc: 'Bright & Clear (Female)' },
  { name: 'Puck', desc: 'Playful & Witty (Male)' },
  { name: 'Fenrir', desc: 'Deep & Intense (Male)' },
  { name: 'Charon', desc: 'Steady & Narrative (Male)' },
];

const LANGUAGES: Language[] = ['English', 'Spanish', 'French', 'German', 'Japanese', 'Chinese', 'Portuguese', 'Hindi'];

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ 
  base64Audio, 
  initialStartTime = 0,
  seekTrigger,
  onFinished,
  onBookmark,
  onProgress,
  coverImage,
  bookTitle = "Audiobook",
  chapterTitle = "Chapter",
  currentVoice,
  onVoiceChange,
  currentLanguage,
  onLanguageChange,
  isMinimized,
  onToggleMinimize,
  autoPlayNext,
  onToggleAutoPlayNext,
  autoStart,
  onToggleAutoStart,
  isLoading = false,
  loadingProgress = 0
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  
  const [progress, setProgress] = useState(0);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState("00:00");
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const rateRef = useRef(1.0);

  // Volume State
  const [volume, setVolume] = useState(1.0);
  const [showVolume, setShowVolume] = useState(false);

  // Settings Menu State
  const [showSettings, setShowSettings] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const accumulatedTimeRef = useRef<number>(0);
  const lastAnchorTimeRef = useRef<number>(0);

  // Initialize Audio Context ONCE
  useEffect(() => {
    if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000
        });
        
        // Create Static Graph: Gain -> Analyser -> Destination
        gainNodeRef.current = audioContextRef.current.createGain();
        gainNodeRef.current.gain.value = volume;

        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 128;

        gainNodeRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
    }

    return () => {
      // Clean up on unmount
      stopAudio();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(e => console.warn("Error closing AudioContext:", e));
      }
      audioContextRef.current = null;
    };
  }, []);

  // Update Media Session
  useEffect(() => {
    if ('mediaSession' in navigator && bufferRef.current) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: chapterTitle,
        artist: "AI Narrator",
        album: bookTitle,
        artwork: coverImage ? [{ src: `data:image/jpeg;base64,${coverImage}`, sizes: '512x512', type: 'image/jpeg' }] : []
      });

      navigator.mediaSession.setActionHandler('play', () => { playAudio() });
      navigator.mediaSession.setActionHandler('pause', () => { pauseAudio() });
      navigator.mediaSession.setActionHandler('stop', () => { stopAudio() });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
           seekTo(details.seekTime);
        }
      });
    }
  }, [chapterTitle, bookTitle, coverImage, isPlaying]);

  // Update gain when volume changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  // Handle Audio Data Changes
  useEffect(() => {
    if (isLoading) return; // Wait until loading finishes

    if (!base64Audio) {
        stopAudio();
        return;
    }

    const loadAndPlay = async () => {
        // Stop current
        stopAudio();
        
        try {
            const ctx = audioContextRef.current;
            if (!ctx) return;

            const bytes = decodeBase64(base64Audio);
            const buffer = await decodeAudioData(bytes, ctx, 24000);
            
            bufferRef.current = buffer;
            
            // Set initial state
            if (initialStartTime > 0) {
                accumulatedTimeRef.current = Math.min(initialStartTime, buffer.duration);
                const percent = (accumulatedTimeRef.current / buffer.duration) * 100;
                setProgress(percent);
                setCurrentTimeDisplay(formatTime(accumulatedTimeRef.current));
            } else {
                accumulatedTimeRef.current = 0;
                setProgress(0);
                setCurrentTimeDisplay("00:00");
            }
            if (onProgress) onProgress(accumulatedTimeRef.current / buffer.duration);

            // Auto Play logic
            if (autoStart) {
                // Ensure context is running
                if (ctx.state === 'suspended') {
                    await ctx.resume();
                }
                playAudio();
            }

        } catch (error) {
            console.error("Failed to load audio data:", error);
        }
    };

    loadAndPlay();
  }, [base64Audio, isLoading]); // Re-run when audio changes or loading finishes

  useEffect(() => {
    if (seekTrigger && bufferRef.current) {
      seekTo(seekTrigger.time);
    }
  }, [seekTrigger]);

  const seekTo = (time: number) => {
    if (!bufferRef.current) return;
    
    const safeTime = Math.max(0, Math.min(time, bufferRef.current.duration));
    
    const wasPlaying = isPlayingRef.current;
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch(e) { /* ignore */ }
    }

    accumulatedTimeRef.current = safeTime;
    
    const percent = (safeTime / bufferRef.current.duration) * 100;
    if (onProgress) onProgress(percent / 100);

    if (wasPlaying) {
      playAudio();
    } else {
      setProgress(percent);
      setCurrentTimeDisplay(formatTime(safeTime));
    }
  };

  const setPlaybackRate = (rate: number) => {
    setPlaybackRateState(rate);
    
    if (isPlaying && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      const deltaRealTime = now - lastAnchorTimeRef.current;
      const deltaBufferTime = deltaRealTime * rateRef.current;
      
      accumulatedTimeRef.current += deltaBufferTime;
      lastAnchorTimeRef.current = now;

      if (sourceRef.current) {
        sourceRef.current.playbackRate.value = rate;
      }
    }
    rateRef.current = rate;
  };

  const cycleSpeed = () => {
    const rates = [0.75, 1.0, 1.25, 1.5, 2.0];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    setPlaybackRate(rates[nextIdx]);
  };

  const playAudio = async () => {
    if (!audioContextRef.current || !bufferRef.current) return;

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    // Stop existing to prevent overlap
    if (sourceRef.current) {
        try { 
            sourceRef.current.stop(); 
            sourceRef.current.disconnect();
        } catch(e) { /* ignore */ }
        sourceRef.current = null;
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = bufferRef.current;
    source.playbackRate.value = rateRef.current;

    if (gainNodeRef.current) {
       source.connect(gainNodeRef.current);
    } else {
       source.connect(audioContextRef.current.destination);
    }
    
    sourceRef.current = source;
    
    const offset = accumulatedTimeRef.current;
    source.start(0, offset);
    
    lastAnchorTimeRef.current = audioContextRef.current.currentTime;
    
    setIsPlaying(true);
    isPlayingRef.current = true;
    
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    updateProgress();

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = "playing";
    }
  };

  const pauseAudio = () => {
    if (sourceRef.current && isPlayingRef.current && audioContextRef.current) {
      try { sourceRef.current.stop(); } catch(e) { /* ignore */ }
      
      const now = audioContextRef.current.currentTime;
      const deltaRealTime = now - lastAnchorTimeRef.current;
      const deltaBufferTime = deltaRealTime * rateRef.current;
      
      accumulatedTimeRef.current += deltaBufferTime;
      
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }
    }
  };

  const stopAudio = () => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch(e) { /* ignore */ }
      sourceRef.current = null;
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  };

  const updateProgress = () => {
    if (isDragging) {
        animationFrameRef.current = requestAnimationFrame(updateProgress);
        return;
    }

    if (!audioContextRef.current || !bufferRef.current || !isPlayingRef.current) return;

    const now = audioContextRef.current.currentTime;
    const deltaRealTime = now - lastAnchorTimeRef.current;
    const currentBufferTime = accumulatedTimeRef.current + (deltaRealTime * rateRef.current);
    
    const duration = bufferRef.current.duration;
    
    if (currentBufferTime >= duration) {
        setIsPlaying(false);
        isPlayingRef.current = false;
        accumulatedTimeRef.current = 0;
        setProgress(100);
        setCurrentTimeDisplay(formatTime(duration));
        if (onProgress) onProgress(1);
        if (onFinished) onFinished();
        return;
    }

    const percent = Math.min((currentBufferTime / duration) * 100, 100);
    setProgress(percent);
    setCurrentTimeDisplay(formatTime(currentBufferTime));
    
    if (onProgress) {
        onProgress(percent / 100);
    }

    animationFrameRef.current = requestAnimationFrame(updateProgress);
  };

  const togglePlay = () => {
    if (isPlayingRef.current) pauseAudio();
    else playAudio();
  };

  const handleBookmarkClick = () => {
    if (onBookmark && audioContextRef.current) {
      let currentBufferTime = accumulatedTimeRef.current;
      if (isPlayingRef.current) {
          const now = audioContextRef.current.currentTime;
          const deltaRealTime = now - lastAnchorTimeRef.current;
          currentBufferTime += (deltaRealTime * rateRef.current);
      }
      onBookmark(currentBufferTime);
    }
  };

  const handleDownload = async () => {
    if (!base64Audio) return;
    try {
      const byteArray = decodeBase64(base64Audio);
      const blob = createWavBlob(byteArray);
      await saveFile(blob, `monstah-lumina-${bookTitle}-${chapterTitle}-${Date.now()}.wav`, 'WAV Audio');
    } catch (e) {
      console.error("Download failed", e);
    }
  };

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      setIsDragging(true);
      setDragProgress(val);
      
      if (bufferRef.current) {
          const time = (val / 100) * bufferRef.current.duration;
          setCurrentTimeDisplay(formatTime(time));
          if (onProgress) onProgress(val / 100);
      }
  };

  const handleRangeCommit = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
      if (!bufferRef.current) return;
      const target = e.currentTarget as HTMLInputElement;
      const val = parseFloat(target.value);
      const time = (val / 100) * bufferRef.current.duration;
      
      seekTo(time);
      setIsDragging(false);
  };

  // If no audio and not loading, we don't render. 
  // BUT if we are loading, we render the loading state.
  if (!base64Audio && !isLoading) return null;

  const currentDisplayPercent = isDragging ? dragProgress : progress;
  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // --- MINIMIZED VIEW ---
  if (isMinimized) {
    return (
      <div className="bg-brand-dark/90 backdrop-blur-md rounded-full p-2 border border-brand-gold/30 shadow-2xl flex items-center gap-3 w-full max-w-md mx-auto animate-fade-in">
        <div className="relative w-10 h-10 flex-shrink-0 rounded-full overflow-hidden border border-white/10 bg-black">
           {coverImage ? (
              <img src={`data:image/jpeg;base64,${coverImage}`} alt="Cover" className="w-full h-full object-cover animate-[spin_10s_linear_infinite]" style={{ animationPlayState: isPlaying ? 'running' : 'paused' }} />
           ) : (
              <div className="w-full h-full bg-brand-gold flex items-center justify-center"><Volume2 size={16} /></div>
           )}
        </div>
        
        <div className="flex-1 min-w-0 overflow-hidden">
           <div className="text-xs text-brand-gold font-bold truncate">
             {isLoading ? 'Generating...' : isPlaying ? 'Now Playing' : 'Paused'}
           </div>
           <div className="text-sm text-white font-serif truncate font-medium">
             {chapterTitle}
           </div>
        </div>

        {isLoading ? (
            <div className="w-10 h-10 flex items-center justify-center">
                <CircularProgress progress={loadingProgress} size={24} />
            </div>
        ) : (
            <button 
                onClick={togglePlay}
                className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full bg-brand-gold text-brand-dark hover:bg-yellow-500 transition"
            >
                {isPlaying ? <Pause className="fill-current" size={18}/> : <Play className="fill-current ml-1" size={18}/>}
            </button>
        )}

        <button 
          onClick={onToggleMinimize}
          className="p-2 text-white/60 hover:text-white transition rounded-full hover:bg-white/10"
          title="Expand"
        >
          <ChevronUp size={20} />
        </button>
      </div>
    );
  }

  // --- EXPANDED VIEW ---
  return (
    <div className="bg-brand-dark/90 backdrop-blur-md rounded-xl p-4 border border-brand-gold/30 w-full shadow-2xl relative animate-fade-in">
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="absolute bottom-full right-0 mb-2 w-72 bg-brand-paper dark:bg-gray-800 rounded-xl shadow-2xl border border-brand-gold/30 p-4 animate-fade-in z-50">
           <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
              <h4 className="font-bold text-brand-dark dark:text-white text-sm flex items-center gap-2">
                <Settings size={16} /> Player Settings
              </h4>
              <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-brand-dark">✕</button>
           </div>
           
           <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
              <div className="space-y-3">
                 <h5 className="text-xs font-bold text-gray-400 uppercase">Playback</h5>
                 
                 <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Auto-start on load</span>
                    <button 
                      onClick={onToggleAutoStart} 
                      className={`text-2xl transition-colors ${autoStart ? 'text-brand-gold' : 'text-gray-400'}`}
                    >
                      {autoStart ? <ToggleRight size={28} className="fill-current"/> : <ToggleLeft size={28} />}
                    </button>
                 </div>

                 <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Auto-play next chapter</span>
                    <button 
                      onClick={onToggleAutoPlayNext} 
                      className={`text-2xl transition-colors ${autoPlayNext ? 'text-brand-gold' : 'text-gray-400'}`}
                    >
                      {autoPlayNext ? <ToggleRight size={28} className="fill-current"/> : <ToggleLeft size={28} />}
                    </button>
                 </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700"></div>

              <div className="space-y-2">
                <h5 className="text-xs font-bold text-gray-400 uppercase">Narrator Voice</h5>
                {VOICES.map(v => (
                   <button
                     key={v.name}
                     onClick={() => { onVoiceChange(v.name); }}
                     className={`w-full text-left p-2 rounded-lg text-sm transition flex items-center justify-between ${currentVoice === v.name ? 'bg-brand-gold text-brand-dark font-bold' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                   >
                      <span>{v.name}</span>
                      <span className="text-xs opacity-70">{v.desc.split('(')[1].replace(')', '')}</span>
                   </button>
                ))}
              </div>
           </div>
        </div>
      )}

      {/* Language Modal */}
      {showLanguage && (
        <div className="absolute bottom-full right-12 mb-2 w-48 bg-brand-paper dark:bg-gray-800 rounded-xl shadow-2xl border border-brand-gold/30 p-4 animate-fade-in z-50">
           <div className="flex justify-between items-center mb-3 border-b border-gray-200 dark:border-gray-700 pb-2">
              <h4 className="font-bold text-brand-dark dark:text-white text-sm flex items-center gap-2">
                <Globe size={16} /> Language
              </h4>
              <button onClick={() => setShowLanguage(false)} className="text-gray-500 hover:text-brand-dark">✕</button>
           </div>
           <div className="space-y-1 max-h-48 overflow-y-auto">
              {LANGUAGES.map(lang => (
                 <button
                   key={lang}
                   onClick={() => { onLanguageChange(lang); setShowLanguage(false); }}
                   className={`w-full text-left p-2 rounded-lg text-sm transition flex items-center justify-between ${currentLanguage === lang ? 'bg-brand-gold text-brand-dark font-bold' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                 >
                    <span>{lang}</span>
                    {currentLanguage === lang && <div className="w-2 h-2 rounded-full bg-brand-dark"></div>}
                 </button>
              ))}
           </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        
        <div className="absolute top-2 right-2 z-20">
           <button 
             onClick={onToggleMinimize}
             className="p-1.5 rounded-full bg-black/20 text-white/50 hover:bg-black/40 hover:text-white transition"
             title="Minimize Player"
           >
             <ChevronDown size={16} />
           </button>
        </div>

        {/* Visualizer Row */}
        <div className="w-full h-[40px] flex items-center justify-center overflow-hidden rounded-lg bg-black/20 mt-2 relative">
             <Visualizer analyser={analyserRef.current} isPlaying={isPlaying} />
             {isLoading && (
                 <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-10 gap-2">
                    <CircularProgress progress={loadingProgress} size={24} className="text-brand-gold" trackColor="text-white/20" />
                    <span className="text-xs font-bold text-brand-gold">Generating...</span>
                 </div>
             )}
        </div>

        <div className="flex items-center gap-4">
          {/* Cover Art */}
          {coverImage && (
            <div className="relative w-12 h-16 sm:w-14 sm:h-[72px] flex-shrink-0 rounded overflow-hidden shadow-md border border-white/10 group bg-black">
              <img 
                  src={`data:image/jpeg;base64,${coverImage}`} 
                  alt="Book Cover" 
                  className={`w-full h-full object-cover opacity-90 transition-opacity ${isLoading ? 'opacity-50 grayscale' : 'group-hover:opacity-100'}`} 
              />
            </div>
          )}

          <button 
            onClick={togglePlay}
            disabled={isLoading}
            className={`w-12 h-12 flex-shrink-0 flex items-center justify-center rounded-full bg-brand-gold text-brand-dark transition shadow-lg ${isLoading ? 'opacity-90 cursor-not-allowed' : 'hover:bg-yellow-500'}`}
          >
            {isLoading ? (
               <CircularProgress 
                  progress={loadingProgress} 
                  size={24} 
                  className="text-brand-dark" 
                  indicatorColor="text-brand-dark" 
                  trackColor="text-brand-dark/20" 
                />
            ) : isPlaying ? (
               <Pause className="fill-current" size={20}/>
            ) : (
               <Play className="fill-current ml-1" size={20}/>
            )}
          </button>
          
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <div className="flex justify-between text-xs text-brand-cream/70 uppercase tracking-wider font-bold">
              <div className="flex items-center gap-2">
                <span>{currentVoice}</span>
                <span className="text-white/30">•</span>
                <span>{currentLanguage}</span>
                {onBookmark && !isLoading && (
                  <button 
                    onClick={handleBookmarkClick}
                    className="ml-2 flex items-center gap-1 text-brand-gold hover:text-white transition px-2 py-0.5 rounded bg-white/5 hover:bg-white/10"
                    title="Add Bookmark"
                  >
                    <BookmarkIcon size={12} className="fill-current" />
                    <span className="hidden sm:inline">Save Spot</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span>{currentTimeDisplay}</span>
              </div>
            </div>
            
            {/* Interactive Progress Bar */}
            <div className={`relative h-3 w-full group flex items-center ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="absolute inset-0 my-auto h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-brand-gold to-yellow-300"
                    style={{ width: `${currentDisplayPercent}%` }}
                  />
              </div>
              
              <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  step="0.1"
                  value={currentDisplayPercent}
                  onChange={handleRangeChange}
                  onMouseUp={handleRangeCommit}
                  onTouchEnd={handleRangeCommit}
                  disabled={isLoading}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              
              <div 
                  className={`absolute h-4 w-4 bg-white border-2 border-brand-gold rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)] pointer-events-none transition-opacity duration-200 ${isPlaying || isDragging || progress > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  style={{ 
                      left: `${currentDisplayPercent}%`, 
                      transform: 'translate(-50%, 0)'
                  }} 
              />
            </div>
          </div>

          <div className="flex items-center gap-1">
              <button 
                onClick={cycleSpeed}
                disabled={isLoading}
                className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded hover:bg-white/10 text-brand-gold text-xs font-bold transition min-w-[3.5rem] justify-center border border-brand-gold/30 disabled:opacity-30"
                title="Playback Speed"
              >
                <Gauge size={14} />
                {playbackRate}x
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowVolume(!showVolume)}
                  className={`p-2 transition rounded-full hover:bg-white/10 ${showVolume ? 'text-brand-gold' : 'text-white/50 hover:text-brand-gold'}`}
                  title="Volume"
                >
                   <VolumeIcon size={20} />
                </button>
                {showVolume && (
                  <div className="absolute bottom-full right-0 mb-2 p-3 bg-brand-paper dark:bg-gray-800 rounded-xl shadow-xl border border-brand-gold/30 flex items-center gap-2 w-40 z-50 animate-fade-in">
                    <VolumeX size={16} className="text-gray-400 dark:text-gray-500"/>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.05" 
                      value={volume}
                      onChange={(e) => setVolume(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-gold"
                    />
                    <Volume2 size={16} className="text-gray-400 dark:text-gray-500"/>
                  </div>
                )}
              </div>

              <button 
                onClick={() => setShowLanguage(!showLanguage)}
                className={`p-2 transition rounded-full hover:bg-white/10 ${showLanguage ? 'text-brand-gold' : 'text-white/50 hover:text-brand-gold'}`}
                title="Select Language"
              >
                  <Globe size={20} />
              </button>

              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 transition rounded-full hover:bg-white/10 ${showSettings ? 'text-brand-gold' : 'text-white/50 hover:text-brand-gold'}`}
                title="Voice Settings"
              >
                  <Settings size={20} />
              </button>

              <button onClick={handleDownload} disabled={isLoading || !base64Audio} className="hidden sm:block p-2 text-white/50 hover:text-brand-gold transition rounded-full hover:bg-white/10 disabled:opacity-30" title="Save to Drive / Local">
                  <HardDrive size={20} />
              </button>
          </div>
        </div>
      </div>
    </div>
  );
};