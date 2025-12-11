import React, { useState, useEffect, useRef } from 'react';
import { CameraView } from './components/CameraView';
import { AudioPlayer } from './components/AudioPlayer';
import { ChatInterface } from './components/ChatInterface';
import { identifyBook, generateBookNarration, getChapterContent, searchBook, findBookSources } from './services/geminiService';
import { BookInfo, AppState, Bookmark, GroundingChunk, StoredBook, StoredTrack, VoiceName, Language } from './types';
import { formatTime, saveFile, createWavBlob, decodeBase64 } from './utils/audioUtils';
import { saveBookToLibrary, getLibraryBooks, saveTrackToLibrary, getTrackFromLibrary, clearLibrary, updateBookReadStatus } from './utils/dbUtils';
import { BookOpen, Sparkles, RotateCcw, Headphones, PlayCircle, Loader2, Search, Mic, MicOff, Bookmark as BookmarkIcon, Trash2, Moon, Sun, ChevronDown, ChevronUp, ArrowRight, Download, ShoppingBag, ExternalLink, FileText, HardDrive, Library, MessageCircle, CheckCircle, Circle } from 'lucide-react';
import { Toast, ToastType } from './components/Toast';
import { CircularProgress } from './components/CircularProgress';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [scannedImage, setScannedImage] = useState<string | null>(null);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [audioData, setAudioData] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Voice State
  const [currentVoice, setCurrentVoice] = useState<VoiceName>('Kore');
  // Language State
  const [currentLanguage, setCurrentLanguage] = useState<Language>('English');
  // Auto-Play Settings
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [autoStart, setAutoStart] = useState(true);

  // Toast State
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isListening, setIsListening] = useState(false);

  // Library State
  const [libraryBooks, setLibraryBooks] = useState<StoredBook[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Playback State
  const [activeTrack, setActiveTrack] = useState<string | null>(null); // 'Summary' or Chapter Name
  const [loadingTrack, setLoadingTrack] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>(""); // Granular status
  const [loadingProgress, setLoadingProgress] = useState<number>(0); // 0-100
  const [initialStartTime, setInitialStartTime] = useState(0);
  const [seekTrigger, setSeekTrigger] = useState<{ time: number; id: number } | null>(null);
  const [isPlayerMinimized, setIsPlayerMinimized] = useState(false);
  
  // Chat State
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  // Download State
  const [downloadingChapter, setDownloadingChapter] = useState<string | null>(null);
  
  // Text Content for Read Along
  const [activeText, setActiveText] = useState<string | null>(null);
  const [isTextExpanded, setIsTextExpanded] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);

  // Bookmarks State
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  // Download / Sources State
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [foundSources, setFoundSources] = useState<GroundingChunk[]>([]);
  
  const trackCache = useRef<Map<string, { text: string, audio: string }>>(new Map());
  const textSectionRef = useRef<HTMLDivElement>(null);

  // Init Load
  useEffect(() => {
    const savedBookmarks = localStorage.getItem('monstah_lumina_bookmarks');
    if (savedBookmarks) {
      try {
        setBookmarks(JSON.parse(savedBookmarks));
      } catch (e) {
        console.error("Failed to load bookmarks", e);
      }
    }

    const savedTheme = localStorage.getItem('monstah_lumina_theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove('dark');
    }

    // Load Library
    refreshLibrary();
  }, []);

  const refreshLibrary = async () => {
    try {
      const books = await getLibraryBooks();
      setLibraryBooks(books);
    } catch (e) {
      console.error("Failed to load library", e);
    }
  };

  const toggleTheme = () => {
    if (isDarkMode) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('monstah_lumina_theme', 'light');
      setIsDarkMode(false);
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('monstah_lumina_theme', 'dark');
      setIsDarkMode(true);
    }
  };

  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ message, type });
  };

  const saveBookmark = (time: number) => {
    if (!bookInfo || !activeTrack) return;
    
    const newBookmark: Bookmark = {
      id: Date.now().toString(),
      bookTitle: bookInfo.title,
      chapter: activeTrack,
      timestamp: time,
      createdAt: Date.now()
    };

    const updated = [newBookmark, ...bookmarks];
    setBookmarks(updated);
    localStorage.setItem('monstah_lumina_bookmarks', JSON.stringify(updated));
    showToast('Bookmark saved', 'success');
  };

  const deleteBookmark = (id: string) => {
    const updated = bookmarks.filter(b => b.id !== id);
    setBookmarks(updated);
    localStorage.setItem('monstah_lumina_bookmarks', JSON.stringify(updated));
    showToast('Bookmark removed', 'info');
  };

  const handleRestoreBookmark = async (bookmark: Bookmark) => {
    if (activeTrack !== bookmark.chapter) {
      if (bookmark.chapter === 'Book Summary') {
         await handlePlaySummary(bookmark.timestamp);
      } else {
         await handlePlayChapter(bookmark.chapter, bookmark.timestamp);
      }
    } else {
      setSeekTrigger({ time: bookmark.timestamp, id: Date.now() });
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const handleCapture = async (base64: string) => {
    setScannedImage(base64);
    setState(AppState.PROCESSING);
    try {
      const info = await identifyBook(base64);
      setBookInfo(info);
      setState(AppState.RESULT);
      trackCache.current.clear();
      // Save to Library
      await saveBookToLibrary(info, base64);
      refreshLibrary();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Could not identify the book. Please try again with better lighting or angle.");
      setState(AppState.ERROR);
    }
  };

  const handleSearch = async (e?: React.FormEvent, manualQuery?: string) => {
    if (e) e.preventDefault();
    const query = manualQuery || searchQuery;
    if (!query.trim()) return;

    if (manualQuery) setSearchQuery(manualQuery);

    setScannedImage(null);
    setState(AppState.PROCESSING);
    
    setBookInfo(null);
    setAudioData(null);
    setActiveTrack(null);
    setActiveText(null);
    setReadingProgress(0);
    setFoundSources([]);
    setIsSourcesOpen(false);
    trackCache.current.clear();
    setIsPlayerMinimized(false);

    try {
      const info = await searchBook(query);
      setBookInfo(info);
      setState(AppState.RESULT);
      // Save to Library (no cover image for search unless we fetch one, using null for now)
      await saveBookToLibrary(info, null);
      refreshLibrary();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Could not find the book. Please try again.");
      setState(AppState.ERROR);
    }
  };

  const handleLibraryBookClick = (stored: StoredBook) => {
    setBookInfo(stored.info);
    setScannedImage(stored.coverImage);
    setSearchQuery('');
    setAudioData(null);
    setActiveTrack(null);
    setActiveText(null);
    setReadingProgress(0);
    setState(AppState.RESULT);
    trackCache.current.clear();
    setIsPlayerMinimized(false);
    // Also update last accessed
    saveBookToLibrary(stored.info, stored.coverImage);
  };

  const handleClearLibraryClick = () => {
    if (libraryBooks.length === 0) return;
    setShowClearConfirm(true);
  };

  const performClearLibrary = async () => {
    try {
      await clearLibrary();
      setLibraryBooks([]);
      setShowClearConfirm(false);
      showToast("Library cleared successfully", "success");
    } catch (e) {
      console.error("Failed to clear library", e);
      showToast("Failed to clear library", "error");
      setShowClearConfirm(false);
    }
  };

  const handleToggleReadStatus = async () => {
    if (!bookInfo) return;
    
    const storedBook = libraryBooks.find(b => b.info.title === bookInfo.title);
    const newStatus = !storedBook?.isRead;
    
    try {
      await updateBookReadStatus(bookInfo.title, newStatus);
      await refreshLibrary();
      showToast(newStatus ? "Marked as Read" : "Marked as Unread", "success");
    } catch (e) {
      console.error("Failed to update status", e);
      showToast("Failed to update status", "error");
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Voice input is not supported in this browser.", 'error');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setSearchQuery(transcript);
    };
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
      showToast("Could not hear you. Please try again.", 'error');
    };

    recognition.start();
  };

  // Helper to get track data (Memory Cache -> IndexedDB -> Generate)
  const getTrackData = async (trackName: string, title: string, author: string, isSummary: boolean, language: Language): Promise<{text: string, audio: string}> => {
     // Include language in cache key
     const cacheKey = `${title}-${trackName}-${language}`;
     
     // 1. Memory Cache
     if (trackCache.current.has(cacheKey)) {
        setLoadingProgress(100);
        return trackCache.current.get(cacheKey)!;
     }

     // 2. IndexedDB
     try {
        const stored = await getTrackFromLibrary(title, trackName);
        // Only return if voice AND language match
        if (stored && stored.voice === currentVoice && stored.language === language) {
             trackCache.current.set(cacheKey, { text: stored.text, audio: stored.audio });
             setLoadingProgress(100);
             return { text: stored.text, audio: stored.audio };
        }
     } catch(e) {
        console.warn("DB Load failed", e);
     }

     // 3. Generate
     // Initialize simulated progress
     setLoadingProgress(5);
     const progressInterval = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 95) return prev;
          // Slow down as we approach 95
          const increment = prev < 50 ? 4 : prev < 80 ? 1.5 : 0.5;
          return prev + increment;
        });
     }, 200);

     try {
        setLoadingStatus(isSummary ? `Writing summary (${language})...` : `Writing story (${language})...`);
        
        let textToRead = "";
        if (isSummary) {
             // For summaries, we might just have English metadata. If language is not English, request a translation/summary
             if (language === 'English') {
                textToRead = `${title}, by ${author}. ${bookInfo!.description}`;
             } else {
                // If summary in another language is needed, we should probably generate it via AI to be safe, 
                // but for now re-using getChapterContent logic for summary generation if we treated it as a prompt
                textToRead = await getChapterContent(title, author, "Book Summary", language);
             }
        } else {
             textToRead = await getChapterContent(title, author, trackName, language);
        }
          
        setLoadingProgress(35); // Bump progress on text complete

        setLoadingStatus(`Creating voice (${currentVoice})...`);
        const audioBase64 = await generateBookNarration(textToRead, currentVoice);
        
        if (!audioBase64) throw new Error("Failed to generate audio");

        // 4. Save to DB & Cache
        const trackData = { text: textToRead, audio: audioBase64 };
        trackCache.current.set(cacheKey, trackData);
        
        saveTrackToLibrary({
          bookTitle: title,
          trackName: trackName,
          text: textToRead,
          audio: audioBase64,
          voice: currentVoice,
          language: language,
          createdAt: Date.now()
        }).catch(e => console.warn("Failed to save track to DB", e));

        clearInterval(progressInterval);
        setLoadingProgress(100);
        return trackData;
     } catch(e) {
        clearInterval(progressInterval);
        setLoadingProgress(0);
        throw e;
     }
  };

  const handlePlaySummary = async (startTime: number = 0, forceLanguage?: Language) => {
    if (!bookInfo) return;
    const trackName = "Book Summary";
    const langToUse = forceLanguage || currentLanguage;
    
    setInitialStartTime(startTime);
    setReadingProgress(0);
    
    // If playing same track/lang, just expand
    const cacheKey = `${bookInfo.title}-${trackName}-${langToUse}`;
    if (activeTrack === trackName && audioData && trackCache.current.has(cacheKey)) {
      if (startTime > 0) setSeekTrigger({ time: startTime, id: Date.now() });
      setIsTextExpanded(true);
      setIsPlayerMinimized(false);
      return;
    }

    // Don't set audioData to null, just set loading status. AudioPlayer handles transition.
    setLoadingTrack(trackName);
    setActiveTrack(trackName); // Optimistic update for UI highlighting
    
    try {
      const { text, audio } = await getTrackData(trackName, bookInfo.title, bookInfo.author, true, langToUse);
      
      setActiveText(text);
      setAudioData(audio);
      // setActiveTrack(trackName); // Already set
      setIsTextExpanded(true);
      setIsPlayerMinimized(false);
      setTimeout(() => {
           textSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Failed to generate narration.", 'error');
      // If failed, clear optimistic track
      if (activeTrack === trackName) setActiveTrack(null);
    } finally {
      setLoadingTrack(null);
      setLoadingStatus("");
    }
  };

  const handlePlayChapter = async (chapter: string, startTime: number = 0, forceLanguage?: Language) => {
    if (!bookInfo) return;
    const langToUse = forceLanguage || currentLanguage;
    
    setInitialStartTime(startTime);
    setReadingProgress(0);

    const cacheKey = `${bookInfo.title}-${chapter}-${langToUse}`;
    if (activeTrack === chapter && audioData && trackCache.current.has(cacheKey)) {
      if (startTime > 0) setSeekTrigger({ time: startTime, id: Date.now() });
      setIsTextExpanded(true);
      setIsPlayerMinimized(false);
      return;
    }

    // Don't set audioData to null, keep player mounted.
    setLoadingTrack(chapter);
    setActiveTrack(chapter); // Optimistic update

    try {
      const { text, audio } = await getTrackData(chapter, bookInfo.title, bookInfo.author, false, langToUse);
      
      setActiveText(text);
      setAudioData(audio);
      // setActiveTrack(chapter); // Already set
      setIsTextExpanded(true);
      setIsPlayerMinimized(false);
      setTimeout(() => {
           textSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Failed to load chapter audio. Please try again.", 'error');
      if (activeTrack === chapter) setActiveTrack(null);
    } finally {
      setLoadingTrack(null);
      setLoadingStatus("");
    }
  };

  const handleTrackFinished = () => {
    // Logic for Auto-Play Next
    if (autoPlayNext && bookInfo && activeTrack) {
       if (activeTrack === 'Book Summary') {
          // Finished summary, play first chapter
          if (bookInfo.chapters.length > 0) {
            showToast("Playing Chapter 1...", "info");
            handlePlayChapter(bookInfo.chapters[0]);
            return;
          }
       } else {
          // Finished a chapter, find next
          const idx = bookInfo.chapters.indexOf(activeTrack);
          if (idx !== -1 && idx < bookInfo.chapters.length - 1) {
             const nextChapter = bookInfo.chapters[idx + 1];
             showToast(`Playing ${nextChapter}...`, "info");
             handlePlayChapter(nextChapter);
             return;
          }
       }
    }
    showToast("Playback finished", "info");
  };

  const handleLanguageChange = (lang: Language) => {
    setCurrentLanguage(lang);
    
    // If we are currently playing something, reload it in the new language
    if (activeTrack && bookInfo) {
       if (activeTrack === "Book Summary") {
          handlePlaySummary(0, lang);
       } else {
          handlePlayChapter(activeTrack, 0, lang);
       }
    }
  };

  const handleDownloadChapter = async (chapter: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (downloadingChapter || !bookInfo) return;
    setDownloadingChapter(chapter);

    try {
      const { audio } = await getTrackData(chapter, bookInfo.title, bookInfo.author, false, currentLanguage);

      const byteArray = decodeBase64(audio);
      const blob = createWavBlob(byteArray);

      const safeTitle = bookInfo.title.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
      const safeChapter = chapter.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
      const filename = `${safeTitle}-${safeChapter}-${currentLanguage}.wav`;

      const saved = await saveFile(blob, filename, 'WAV Audio');
      if (saved) showToast(`File saved successfully`, 'success');
    } catch (err: any) {
      console.error(err);
      showToast("Failed to download. Try playing it first.", 'error');
    } finally {
      setDownloadingChapter(null);
    }
  };

  const handleFindSources = async () => {
    if (!bookInfo) return;
    setIsSourcesOpen(!isSourcesOpen);
    if (isSourcesOpen || foundSources.length > 0) return;

    setSourcesLoading(true);
    try {
      const result = await findBookSources(bookInfo.title, bookInfo.author);
      setFoundSources(result.links);
      if (result.links.length === 0) {
        showToast("No direct links found, try a manual search.", "info");
      }
    } catch (err) {
      showToast("Could not find external sources.", "error");
    } finally {
      setSourcesLoading(false);
    }
  };

  const handleDownloadText = async () => {
    if (!activeText || !activeTrack) {
      showToast("Nothing to download yet. Play a chapter first.", "error");
      return;
    }
    const blob = new Blob([activeText], { type: 'text/plain' });
    const filename = `${bookInfo?.title || 'book'}-${activeTrack.replace(/\s+/g, '_')}.txt`;
    
    const saved = await saveFile(blob, filename, 'Text File');
    if (saved) showToast("Text saved", "success");
  };

  const handleSaveToDrive = async () => {
    if (!activeTrack || !audioData) {
        showToast("No audio loaded to save. Play a chapter first.", "error");
        return;
    }
    await handleDownloadChapter(activeTrack);
  };

  const resetApp = () => {
    setState(AppState.IDLE);
    setScannedImage(null);
    setBookInfo(null);
    setAudioData(null);
    setErrorMsg(null);
    setActiveTrack(null);
    setLoadingTrack(null);
    setLoadingStatus("");
    setSearchQuery('');
    setInitialStartTime(0);
    setSeekTrigger(null);
    setToast(null);
    setActiveText(null);
    setIsTextExpanded(false);
    setReadingProgress(0);
    setIsSourcesOpen(false);
    setFoundSources([]);
    setIsChatOpen(false);
    trackCache.current.clear();
    refreshLibrary();
  };

  const renderHighlightedText = () => {
    if (!activeText) return null;
    const totalChars = activeText.length;
    const splitIndex = Math.floor(readingProgress * totalChars);
    let accumulatedChars = 0;

    return activeText.split('\n').map((paragraph, pIdx) => {
       if (!paragraph.trim()) {
         accumulatedChars += 1;
         return <br key={pIdx} className="mb-4 block" />;
       }
       const pStart = accumulatedChars;
       const pEnd = accumulatedChars + paragraph.length;
       accumulatedChars += paragraph.length + 1;

       if (splitIndex >= pEnd) {
         return <p key={pIdx} className="mb-4 bg-brand-gold/20 text-brand-dark dark:text-white rounded px-1 transition-colors duration-300">{paragraph}</p>;
       }
       if (splitIndex <= pStart) {
         return <p key={pIdx} className="mb-4 text-gray-400 dark:text-gray-600 transition-colors duration-300 px-1">{paragraph}</p>;
       }
       const splitAt = splitIndex - pStart;
       return (
         <p key={pIdx} className="mb-4 px-1">
            <span className="bg-brand-gold/20 text-brand-dark dark:text-white rounded-l transition-colors">{paragraph.substring(0, splitAt)}</span>
            <span className="text-gray-400 dark:text-gray-600 transition-colors">{paragraph.substring(splitAt)}</span>
         </p>
       );
    });
  };

  const currentBookBookmarks = bookmarks.filter(b => b.bookTitle === bookInfo?.title);
  const isCurrentBookRead = libraryBooks.find(b => b.info.title === bookInfo?.title)?.isRead;

  return (
    <div className="min-h-screen bg-brand-paper dark:bg-brand-dark font-sans text-brand-dark dark:text-brand-paper selection:bg-brand-gold/30 relative transition-colors duration-300">
      
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* Chat Overlay */}
      {isChatOpen && bookInfo && (
        <ChatInterface bookInfo={bookInfo} onClose={() => setIsChatOpen(false)} />
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-brand-paper/80 dark:bg-brand-dark/80 backdrop-blur-md border-b border-brand-dark/5 dark:border-white/5 px-6 py-4 flex justify-between items-center transition-colors duration-300">
        <div className="flex items-center gap-2 cursor-pointer" onClick={resetApp}>
          <div className="bg-brand-dark dark:bg-brand-gold text-brand-gold dark:text-brand-dark p-2 rounded-lg transition-colors">
            <BookOpen size={24} />
          </div>
          <h1 className="text-2xl font-serif font-bold text-brand-dark dark:text-brand-gold transition-colors">
            MonstahLumina<span className="text-brand-gold dark:text-brand-paper">Reader</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={toggleTheme} 
            className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-white/10 transition text-brand-dark dark:text-brand-gold"
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          
          {state !== AppState.IDLE && (
            <button 
              onClick={resetApp} 
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-full transition text-gray-700 dark:text-gray-300 flex items-center gap-2 text-sm font-bold"
              title="Back to Library"
            >
              <Library size={18} />
              <span className="hidden sm:inline">Library</span>
            </button>
          )}
        </div>
      </header>

      <main className="container mx-auto max-w-2xl p-4 md:p-6 pb-40">
        
        {/* IDLE: Scan Mode & Library */}
        {state === AppState.IDLE && (
          <div className="flex flex-col gap-6 animate-fade-in">
             <div className="text-center space-y-2 py-6">
                <h2 className="text-3xl font-serif font-bold text-brand-dark dark:text-white transition-colors">What are you reading?</h2>
                <p className="text-gray-500 dark:text-gray-400 transition-colors">Scan a book cover or search to unlock its story.</p>
             </div>

             <form onSubmit={(e) => handleSearch(e)} className="relative w-full max-w-lg mx-auto z-10">
                <div className="relative flex items-center group">
                  <Search className="absolute left-4 text-gray-400 group-focus-within:text-brand-gold transition-colors" size={20} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by title or author..."
                    className="w-full pl-12 pr-14 py-4 rounded-full border-2 border-gray-200 dark:border-gray-700 focus:border-brand-gold dark:focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/10 outline-none transition-all bg-white dark:bg-gray-800 shadow-sm text-lg text-brand-dark dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-500"
                  />
                  <button
                    type="button"
                    onClick={toggleVoiceInput}
                    className={`absolute right-3 p-2 rounded-full transition-all duration-200 ${
                      isListening 
                        ? 'bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse' 
                        : 'text-gray-400 hover:text-brand-dark hover:bg-gray-100 dark:text-gray-500 dark:hover:text-white dark:hover:bg-gray-700'
                    }`}
                  >
                    {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                </div>
             </form>
             
             <div className="h-[500px] w-full relative group">
                <CameraView onCapture={handleCapture} />
             </div>

             {/* Recent Library */}
             <div className="mt-8">
                <div className="flex items-center justify-between mb-4 px-2">
                  <div className="flex items-center gap-2 text-brand-dark dark:text-white font-bold">
                    <Library size={20} className="text-brand-gold" />
                    <h3>Your Library</h3>
                  </div>
                  <button
                      onClick={handleClearLibraryClick}
                      disabled={libraryBooks.length === 0}
                      className={`text-xs font-bold flex items-center gap-1 transition-colors px-2 py-1 rounded ${
                        libraryBooks.length > 0 
                          ? "text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20" 
                          : "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                      }`}
                  >
                      <Trash2 size={14} />
                      Clear All
                  </button>
                </div>
                {libraryBooks.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {libraryBooks.slice(0, 6).map((book, i) => (
                      <button 
                        key={i} 
                        onClick={() => handleLibraryBookClick(book)}
                        className="relative aspect-[2/3] rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all group border border-gray-200 dark:border-gray-800"
                      >
                         {book.coverImage ? (
                           <img src={`data:image/jpeg;base64,${book.coverImage}`} alt={book.info.title} className="w-full h-full object-cover" />
                         ) : (
                           <div className="w-full h-full bg-brand-dark p-4 flex items-center justify-center text-center">
                              <span className="text-brand-gold font-serif font-bold">{book.info.title}</span>
                           </div>
                         )}
                         {book.isRead && (
                            <div className="absolute top-2 right-2 bg-green-500 text-white rounded-full p-1 shadow-lg z-10">
                                <CheckCircle size={14} className="fill-current stroke-white" />
                            </div>
                         )}
                         <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                            <p className="text-white text-xs font-bold line-clamp-2">{book.info.title}</p>
                         </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 flex flex-col items-center">
                    <BookOpen className="mb-2 opacity-50" size={32} />
                    <p className="text-sm font-medium">Your library is empty.</p>
                    <p className="text-xs opacity-70">Scan a book or search to start collecting.</p>
                  </div>
                )}
             </div>
          </div>
        )}

        {state === AppState.PROCESSING && (
          <div className="h-[60vh] flex flex-col items-center justify-center gap-6 animate-pulse">
             <div className="relative">
               <div className="absolute inset-0 bg-brand-gold blur-xl opacity-20 animate-pulse"></div>
               <Sparkles size={48} className="text-brand-gold relative z-10 animate-bounce" />
             </div>
             <p className="text-lg font-serif text-gray-600 dark:text-gray-300 transition-colors">Analyzing book & fetching recommendations...</p>
          </div>
        )}

        {state === AppState.ERROR && (
          <div className="flex flex-col items-center justify-center gap-6 p-8 text-center h-[50vh]">
             <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 rounded-full flex items-center justify-center mb-2 transition-colors">
                <RotateCcw size={32} />
             </div>
             <div className="space-y-2 max-w-md">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white transition-colors">Something went wrong</h3>
                <p className="text-gray-600 dark:text-gray-400 transition-colors">{errorMsg}</p>
             </div>
             <button 
                onClick={resetApp} 
                className="px-8 py-3 bg-brand-dark dark:bg-brand-gold text-white dark:text-brand-dark rounded-xl hover:bg-black dark:hover:bg-yellow-500 shadow-lg font-bold"
              >
                Try Again
             </button>
          </div>
        )}

        {(state === AppState.RESULT || state === AppState.READING) && bookInfo && (
          <div className="animate-slide-up space-y-8">
             {/* Book Header */}
             <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl overflow-hidden border border-gray-100 dark:border-gray-800 transition-colors duration-300">
                <div className={`relative overflow-hidden bg-brand-dark ${scannedImage ? 'h-48' : 'h-32'}`}>
                   {scannedImage ? (
                     <>
                       <img src={`data:image/jpeg;base64,${scannedImage}`} alt="Scanned cover" className="w-full h-full object-cover opacity-50 blur-sm" />
                       <div className="absolute inset-0 bg-gradient-to-t from-brand-dark to-transparent"></div>
                     </>
                   ) : (
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-brand-gold/20 via-brand-dark to-brand-dark"></div>
                   )}
                   <div className="absolute bottom-0 left-0 p-6 text-white w-full">
                      <div className="flex justify-between items-end">
                        <div>
                          <div className="inline-block px-2 py-1 bg-brand-gold/20 backdrop-blur-sm rounded text-xs font-bold text-brand-gold mb-2 border border-brand-gold/50">
                            {bookInfo.genre || 'Book'}
                          </div>
                          <h2 className="text-3xl font-serif font-bold leading-tight shadow-sm">{bookInfo.title}</h2>
                          <p className="text-white/80 mt-1 text-lg">{bookInfo.author}</p>
                        </div>
                        <button
                           onClick={handleToggleReadStatus}
                           className={`p-2 rounded-full transition-all border ${
                               isCurrentBookRead 
                               ? 'bg-green-500 border-green-500 text-white' 
                               : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20 hover:text-white'
                           }`}
                           title={isCurrentBookRead ? "Mark as Unread" : "Mark as Read"}
                        >
                           {isCurrentBookRead ? <CheckCircle size={24} className="fill-current" /> : <Circle size={24} />}
                        </button>
                      </div>
                   </div>
                </div>
                
                <div className="p-6 md:p-8">
                   <div className="flex justify-between items-center mb-4">
                     <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider transition-colors">Overview</span>
                     {bookInfo.publishedDate && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 transition-colors">{bookInfo.publishedDate}</span>
                     )}
                   </div>
                   <p className="text-gray-700 dark:text-gray-300 font-serif leading-relaxed text-lg whitespace-pre-wrap mb-6 transition-colors">
                     {bookInfo.description}
                   </p>
                   
                   <div className="flex flex-col sm:flex-row gap-3">
                      <button 
                        onClick={() => handlePlaySummary(0)}
                        disabled={loadingTrack !== null}
                        className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-all ${
                          activeTrack === 'Book Summary' 
                            ? 'bg-brand-gold text-brand-dark ring-2 ring-brand-gold ring-offset-2 dark:ring-offset-gray-900 shadow-lg' 
                            : 'bg-brand-dark dark:bg-gray-800 text-white hover:bg-gray-900 dark:hover:bg-gray-700'
                        }`}
                      >
                        {loadingTrack === 'Book Summary' ? (
                          <div className="flex items-center gap-2">
                            <CircularProgress progress={loadingProgress} size={20} className={activeTrack === 'Book Summary' ? 'text-brand-dark' : 'text-brand-gold'} indicatorColor={activeTrack === 'Book Summary' ? 'text-brand-dark' : 'text-brand-gold'} trackColor={activeTrack === 'Book Summary' ? 'text-black/10' : 'text-white/20'} />
                            <span className="text-sm opacity-90">{loadingStatus || 'Loading...'}</span>
                          </div>
                        ) : (
                          <>
                            <Headphones size={20} className={activeTrack === 'Book Summary' ? 'fill-current' : ''} />
                            <span className="font-bold">
                              {activeTrack === 'Book Summary' ? 'Playing Summary' : 'Listen to Summary'}
                            </span>
                          </>
                        )}
                      </button>

                      {/* Chat Button */}
                      <button 
                        onClick={() => setIsChatOpen(true)}
                        className="py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-2 transition shadow-md"
                      >
                        <MessageCircle size={20} />
                        <span className="font-bold hidden sm:inline">Chat</span>
                      </button>

                      <button 
                        onClick={handleFindSources}
                        className={`py-3 px-4 rounded-xl flex items-center justify-center gap-2 border-2 transition-all ${
                          isSourcesOpen
                            ? 'border-brand-gold bg-brand-gold/10 text-brand-dark dark:text-brand-gold'
                            : 'border-gray-200 dark:border-gray-700 hover:border-brand-gold dark:hover:border-brand-gold text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <ShoppingBag size={20} />
                        {isSourcesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                   </div>

                   {/* Sources Dropdown */}
                   {isSourcesOpen && (
                      <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 animate-fade-in">
                          <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                            <h4 className="text-xs font-bold text-gray-400 uppercase mb-3">Current Session Downloads</h4>
                            <button 
                              onClick={handleDownloadText}
                              disabled={!activeText}
                              className="w-full flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-brand-gold hover:shadow-sm transition-all disabled:opacity-50 mb-2"
                            >
                               <div className="flex items-center gap-3 text-gray-700 dark:text-gray-200">
                                  <FileText size={18} />
                                  <span className="font-medium">Download Summary Text (TXT)</span>
                               </div>
                               <Download size={16} className="text-brand-gold" />
                            </button>
                            <button 
                              onClick={handleSaveToDrive}
                              disabled={!activeTrack || !audioData}
                              className="w-full flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-brand-gold hover:shadow-sm transition-all disabled:opacity-50"
                            >
                               <div className="flex items-center gap-3 text-gray-700 dark:text-gray-200">
                                  <HardDrive size={18} />
                                  <span className="font-medium">Save Audio to Drive / Device...</span>
                                </div>
                               <Download size={16} className="text-brand-gold" />
                            </button>
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-gray-400 uppercase mb-3">Find Online</h4>
                            {sourcesLoading ? (
                              <div className="flex items-center justify-center py-4 text-brand-gold gap-2">
                                <Loader2 className="animate-spin" size={18} />
                                <span className="text-sm">Searching...</span>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <a 
                                  href={`https://oceanofpdf.com/?s=${encodeURIComponent(bookInfo.title + ' ' + bookInfo.author)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-brand-gold transition-all"
                                >
                                  <div className="flex items-center gap-3">
                                     <Download size={16} />
                                     <span className="font-medium text-gray-700 dark:text-gray-200">Search PDF on OceanofPDF</span>
                                  </div>
                                  <ExternalLink size={16} className="text-brand-gold" />
                                </a>
                                {foundSources.map((chunk, i) => (
                                    chunk.web && (
                                      <a 
                                        key={i}
                                        href={chunk.web.uri}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-brand-gold transition-all"
                                      >
                                        <span className="font-medium text-gray-700 dark:text-gray-200 truncate pr-4">{chunk.web.title}</span>
                                        <ExternalLink size={16} className="text-brand-gold" />
                                      </a>
                                    )
                                ))}
                              </div>
                            )}
                          </div>
                      </div>
                   )}
                </div>
             </div>

             {activeText && (
               <div ref={textSectionRef} className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-brand-gold/30 overflow-hidden transition-all duration-500 animate-fade-in">
                  <button 
                    onClick={() => setIsTextExpanded(!isTextExpanded)}
                    className="w-full flex items-center justify-between p-4 bg-brand-gold/10 dark:bg-brand-gold/5 hover:bg-brand-gold/20 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-brand-dark dark:text-brand-gold font-bold">
                      <BookOpen size={18} />
                      <span>Read Along</span>
                    </div>
                    {isTextExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  {isTextExpanded && (
                    <div className="p-6 border-t border-brand-gold/10">
                       <div className="prose dark:prose-invert prose-lg max-w-none font-serif leading-loose">
                          {renderHighlightedText()}
                       </div>
                    </div>
                  )}
               </div>
             )}

             {currentBookBookmarks.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-2 text-brand-gold">
                    <BookmarkIcon size={18} className="fill-current" />
                    <h3 className="text-sm font-bold uppercase tracking-wider">Saved Bookmarks</h3>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                     {currentBookBookmarks.map(b => (
                        <div key={b.id} className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm flex justify-between items-center hover:border-brand-gold/30 transition-all group">
                           <button onClick={() => handleRestoreBookmark(b)} className="flex-1 text-left">
                             <div className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase">{b.chapter}</div>
                             <div className="text-brand-dark dark:text-white font-medium flex items-center gap-2">
                                <PlayCircle size={14} className="text-brand-gold" />
                                {formatTime(b.timestamp)}
                             </div>
                           </button>
                           <button onClick={() => deleteBookmark(b.id)} className="p-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={16} /></button>
                        </div>
                     ))}
                  </div>
                </div>
             )}

             {bookInfo.chapters && bookInfo.chapters.length > 0 && (
               <div className="space-y-4">
                 <h3 className="text-xl font-serif font-bold text-brand-dark dark:text-white px-2 transition-colors">Table of Contents</h3>
                 <div className="grid gap-3">
                    {bookInfo.chapters.map((chapter, idx) => {
                      const isActive = activeTrack === chapter;
                      const isBuffering = loadingTrack === chapter;
                      const isDownloading = downloadingChapter === chapter;
                      return (
                        <div key={idx} className={`relative flex items-center justify-between p-4 rounded-xl border text-left transition-all duration-300 group overflow-hidden ${isActive ? 'bg-white dark:bg-gray-800 border-brand-gold shadow-md scale-[1.01] z-10' : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 hover:border-brand-gold/50'}`}>
                          {isActive && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-brand-gold"></div>}
                          <div onClick={() => !loadingTrack && handlePlayChapter(chapter, 0)} className="flex-1 pr-4 pl-2 cursor-pointer z-10">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs font-bold uppercase tracking-wider transition-colors ${isActive ? 'text-brand-gold' : 'text-gray-400 dark:text-gray-500'}`}>Chapter {idx + 1}</span>
                              {isActive && <span className="px-2 py-0.5 bg-brand-gold text-white text-[10px] font-bold rounded-full animate-pulse">PLAYING</span>}
                            </div>
                            <span className={`font-serif font-medium text-lg block ${isActive ? 'text-brand-dark dark:text-brand-gold font-bold' : 'text-gray-700 dark:text-gray-300'}`}>{chapter}</span>
                             {isBuffering && <div className="text-xs text-brand-gold mt-1 font-bold animate-pulse">{loadingStatus}...</div>}
                          </div>
                          <div className="flex items-center gap-3 z-20 relative">
                             <button onClick={(e) => handleDownloadChapter(chapter, e)} disabled={isDownloading || isBuffering} className="p-2 text-gray-400 hover:text-brand-gold rounded-full transition-colors disabled:opacity-50">
                                {isDownloading ? <CircularProgress progress={loadingProgress} size={20} /> : <Download size={20} />}
                             </button>
                             <button onClick={() => handlePlayChapter(chapter, 0)} className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${isActive ? 'bg-brand-gold text-brand-dark shadow-lg scale-110' : 'bg-gray-50 dark:bg-gray-800 text-gray-300 group-hover:bg-brand-gold/20 group-hover:text-brand-gold'}`}>
                                {isBuffering ? <CircularProgress progress={loadingProgress} size={24} indicatorColor={isActive ? 'text-brand-dark' : 'text-brand-gold'} className={isActive ? 'text-brand-dark' : 'text-brand-gold'} trackColor={isActive ? 'text-black/10' : 'text-gray-200'} /> : <PlayCircle size={24} className={isActive ? 'fill-current' : ''} />}
                              </button>
                          </div>
                        </div>
                      );
                    })}
                 </div>
               </div>
             )}
             
             {bookInfo.recommendations && bookInfo.recommendations.length > 0 && (
               <div className="space-y-4 pt-4">
                  <div className="flex items-center gap-2 px-2">
                    <Sparkles className="text-brand-gold" size={20} />
                    <h3 className="text-xl font-serif font-bold text-brand-dark dark:text-white transition-colors">You Might Also Like</h3>
                  </div>
                  <div className="flex overflow-x-auto gap-4 pb-4 snap-x no-scrollbar">
                    {bookInfo.recommendations.map((rec, idx) => (
                      <button key={idx} onClick={() => handleSearch(undefined, `${rec.title} by ${rec.author}`)} className="flex-none w-64 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 snap-center text-left hover:shadow-md hover:border-brand-gold/30 transition-all group flex flex-col justify-between h-auto min-h-[160px]">
                        <div>
                          <h4 className="font-serif font-bold text-lg text-brand-dark dark:text-white line-clamp-2 group-hover:text-brand-gold transition-colors">{rec.title}</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{rec.author}</p>
                          <p className="text-xs text-gray-600 dark:text-gray-300 mt-3 line-clamp-3 leading-relaxed">"{rec.reason}"</p>
                        </div>
                        <div className="mt-3 flex items-center text-xs font-bold text-brand-gold opacity-0 group-hover:opacity-100 transition-opacity">
                          <span>Discover</span><ArrowRight size={12} className="ml-1" />
                        </div>
                      </button>
                    ))}
                  </div>
               </div>
             )}

             {(audioData || loadingTrack) && (
                <div className={`fixed bottom-6 z-40 animate-slide-up transition-all duration-300 ${isPlayerMinimized ? 'right-6 left-auto w-auto' : 'left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:max-w-2xl'}`}>
                  <div className="relative">
                    {!isPlayerMinimized && (
                      <div className="absolute -top-3 left-4 bg-brand-dark text-brand-gold text-xs font-bold px-3 py-1 rounded-full shadow-md z-50 border border-brand-gold/30">
                          {loadingTrack ? `Loading: ${loadingTrack}` : `Now Playing: ${activeTrack}`}
                      </div>
                    )}
                    <AudioPlayer 
                      base64Audio={audioData} 
                      initialStartTime={initialStartTime}
                      seekTrigger={seekTrigger}
                      onBookmark={saveBookmark}
                      onFinished={handleTrackFinished} 
                      onProgress={(p) => setReadingProgress(p)}
                      coverImage={scannedImage}
                      bookTitle={bookInfo.title}
                      chapterTitle={activeTrack || "Chapter"}
                      currentVoice={currentVoice}
                      onVoiceChange={setCurrentVoice}
                      currentLanguage={currentLanguage}
                      onLanguageChange={handleLanguageChange}
                      isMinimized={isPlayerMinimized}
                      onToggleMinimize={() => setIsPlayerMinimized(!isPlayerMinimized)}
                      autoPlayNext={autoPlayNext}
                      onToggleAutoPlayNext={() => setAutoPlayNext(!autoPlayNext)}
                      autoStart={autoStart}
                      onToggleAutoStart={() => setAutoStart(!autoStart)}
                      isLoading={!!loadingTrack}
                      loadingProgress={loadingProgress}
                    />
                  </div>
                </div>
             )}
          </div>
        )}
      </main>

      {/* Clear Library Confirmation Modal - Moved outside main for correct stacking context */}
      {showClearConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
              <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-2xl max-w-sm w-full border border-gray-200 dark:border-gray-700 transform scale-100 transition-all">
                  <h3 className="text-xl font-bold text-brand-dark dark:text-white mb-2 font-serif">Clear Library?</h3>
                  <p className="text-gray-600 dark:text-gray-300 mb-6 text-sm leading-relaxed">
                      This will permanently delete all scanned books, summaries, and generated audio tracks. This action cannot be undone.
                  </p>
                  <div className="flex justify-end gap-3">
                      <button 
                          onClick={() => setShowClearConfirm(false)}
                          className="px-4 py-2.5 text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition text-sm"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={performClearLibrary}
                          className="px-4 py-2.5 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 shadow-lg transition text-sm flex items-center gap-2"
                      >
                          <Trash2 size={16} />
                          Yes, Clear All
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;