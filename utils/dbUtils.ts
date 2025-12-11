import { BookInfo, StoredBook, StoredTrack } from '../types';

const DB_NAME = 'MonstahLuminaReaderDB';
const DB_VERSION = 1;
const STORE_BOOKS = 'books';
const STORE_TRACKS = 'tracks';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'info.title' });
      }
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        // Composite key would be better, but we'll use a compound string index or manual handling
        // Simple keyPath: array of [bookTitle, trackName] supported in modern browsers
        db.createObjectStore(STORE_TRACKS, { keyPath: ['bookTitle', 'trackName'] });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveBookToLibrary = async (book: BookInfo, coverImage: string | null) => {
  const db = await openDB();
  const tx = db.transaction(STORE_BOOKS, 'readwrite');
  const store = tx.objectStore(STORE_BOOKS);
  
  // Get existing book to preserve isRead status
  return new Promise<void>((resolve, reject) => {
    const getReq = store.get(book.title);
    
    getReq.onsuccess = () => {
      const existing = getReq.result as StoredBook | undefined;
      
      const storedBook: StoredBook = {
        info: book,
        coverImage: coverImage || existing?.coverImage || null,
        lastAccessed: Date.now(),
        isRead: existing?.isRead || false
      };
      
      const putReq = store.put(storedBook);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    
    getReq.onerror = () => reject(getReq.error);
  });
};

export const updateBookReadStatus = async (title: string, isRead: boolean) => {
  const db = await openDB();
  const tx = db.transaction(STORE_BOOKS, 'readwrite');
  const store = tx.objectStore(STORE_BOOKS);
  
  return new Promise<void>((resolve, reject) => {
    const getReq = store.get(title);
    getReq.onsuccess = () => {
      const existing = getReq.result as StoredBook | undefined;
      if (existing) {
        existing.isRead = isRead;
        const putReq = store.put(existing);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        resolve(); // Book not found, ignore
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
};

export const getLibraryBooks = async (): Promise<StoredBook[]> => {
  const db = await openDB();
  const tx = db.transaction(STORE_BOOKS, 'readonly');
  const store = tx.objectStore(STORE_BOOKS);
  const request = store.getAll();
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      // Sort by last accessed desc
      const books = request.result as StoredBook[];
      books.sort((a, b) => b.lastAccessed - a.lastAccessed);
      resolve(books);
    };
    request.onerror = () => reject(request.error);
  });
};

export const saveTrackToLibrary = async (track: StoredTrack) => {
  const db = await openDB();
  const tx = db.transaction(STORE_TRACKS, 'readwrite');
  const store = tx.objectStore(STORE_TRACKS);
  store.put(track);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const getTrackFromLibrary = async (bookTitle: string, trackName: string): Promise<StoredTrack | undefined> => {
  const db = await openDB();
  const tx = db.transaction(STORE_TRACKS, 'readonly');
  const store = tx.objectStore(STORE_TRACKS);
  // IDB KeyRange or just get by array key
  const request = store.get([bookTitle, trackName]);
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const clearLibrary = async () => {
  const db = await openDB();
  const tx = db.transaction([STORE_BOOKS, STORE_TRACKS], 'readwrite');
  
  tx.objectStore(STORE_BOOKS).clear();
  tx.objectStore(STORE_TRACKS).clear();
  
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};