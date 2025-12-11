import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, X, Loader2, MessageSquare, Mic, MicOff } from 'lucide-react';
import { ChatMessage, BookInfo } from '../types';
import { chatWithBook } from '../services/geminiService';

interface ChatInterfaceProps {
  bookInfo: BookInfo;
  onClose: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ bookInfo, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const responseText = await chatWithBook(bookInfo, messages, userMsg.text);
      setMessages(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', text: "Sorry, I'm having trouble connecting to the library archives right now." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => (prev ? prev + ' ' : '') + transcript);
    };
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.start();
  };

  // Helper to clean and chunk text for readability
  const renderMessageContent = (text: string) => {
    let cleanText = text;
    
    // 1. Remove Markdown bold/italic markers (** or * or __ or _)
    // Global remove of double asterisks, single asterisks, underscores
    cleanText = cleanText.replace(/\*\*/g, '').replace(/\*/g, '');
    cleanText = cleanText.replace(/__/g, '').replace(/_/g, '');
    
    // 2. Remove header markers (#)
    cleanText = cleanText.replace(/^#+\s/gm, '');
    
    // 3. Clean up list bullets that might remain (e.g., "- " or "• ")
    cleanText = cleanText.replace(/^[\-\•]\s/gm, '');

    // 4. Split by newlines to create digestible chunks
    // We filter out empty strings to avoid empty paragraphs
    return cleanText.split(/\n+/).map((chunk, i) => {
      const trimmed = chunk.trim();
      if (!trimmed) return null;
      return (
        <p key={i} className="mb-3 last:mb-0 text-sm leading-relaxed text-brand-dark dark:text-gray-200">
          {trimmed}
        </p>
      );
    });
  };

  return (
    <div className="fixed bottom-0 right-0 md:bottom-24 md:right-6 z-50 w-full md:w-[400px] bg-white dark:bg-gray-900 shadow-2xl rounded-t-2xl md:rounded-2xl border border-brand-gold/30 flex flex-col h-[500px] md:h-[600px] animate-slide-up overflow-hidden">
      {/* Header */}
      <div className="p-3 bg-brand-gold/10 border-b border-brand-gold/20 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-brand-gold text-brand-dark rounded-full shadow-sm">
             <MessageSquare size={18} />
          </div>
          <div>
             <h3 className="font-bold text-sm text-brand-dark dark:text-white line-clamp-1">{bookInfo.title}</h3>
             <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-bold">AI Companion</p>
          </div>
        </div>
        <button 
          onClick={onClose} 
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 dark:bg-gray-800 hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 rounded-lg transition-colors text-xs font-bold"
        >
          <span>Close Chat</span>
          <X size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-brand-paper dark:bg-brand-dark scroll-smooth">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-10 px-8 flex flex-col items-center animate-fade-in">
            <div className="w-16 h-16 bg-brand-gold/10 rounded-full flex items-center justify-center mb-4">
              <Bot size={32} className="text-brand-gold opacity-70" />
            </div>
            <p className="mb-2 text-brand-dark dark:text-white font-medium">Hello! I've read "{bookInfo.title}".</p>
            <p className="text-xs opacity-70">Ask me about characters, hidden meanings, or plot twists.</p>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
            {msg.role === 'model' && (
              <div className="w-8 h-8 rounded-full bg-brand-gold/20 flex items-center justify-center flex-shrink-0 text-brand-gold mt-1 shadow-sm">
                <Bot size={14} />
              </div>
            )}
            <div className={`max-w-[85%] p-3.5 rounded-2xl text-sm shadow-sm ${
              msg.role === 'user' 
                ? 'bg-brand-gold text-brand-dark rounded-tr-none font-medium' 
                : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-tl-none'
            }`}>
              {renderMessageContent(msg.text)}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 text-gray-500 mt-1 shadow-sm">
                <User size={14} />
              </div>
            )}
          </div>
        ))}
        
        {isLoading && (
          <div className="flex gap-3 justify-start animate-pulse">
             <div className="w-8 h-8 rounded-full bg-brand-gold/20 flex items-center justify-center flex-shrink-0 text-brand-gold">
                <Bot size={14} />
             </div>
             <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl border border-gray-100 dark:border-gray-700 rounded-tl-none flex items-center gap-2 shadow-sm">
                <span className="text-xs text-gray-400 font-medium">Thinking</span>
                <Loader2 size={14} className="animate-spin text-brand-gold" />
             </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 z-10">
        <div className="relative flex items-center shadow-sm rounded-full">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..." 
            className="w-full pl-5 pr-20 py-3.5 rounded-full bg-gray-50 dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 focus:border-brand-gold dark:focus:border-brand-gold focus:bg-white dark:focus:bg-gray-800 transition-all outline-none text-sm text-brand-dark dark:text-white placeholder:text-gray-400"
          />
          <div className="absolute right-2 flex items-center gap-1">
            <button
              type="button"
              onClick={toggleVoiceInput}
              className={`p-2 rounded-full transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                isListening 
                  ? 'bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse' 
                  : 'text-brand-gold dark:text-brand-gold'
              }`}
              title="Voice Input"
            >
              {isListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button 
              type="submit"
              disabled={!input.trim() || isLoading}
              className="p-2 bg-brand-gold text-brand-dark rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 hover:shadow-md transition active:scale-95"
            >
              <Send size={18} className="ml-0.5" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};