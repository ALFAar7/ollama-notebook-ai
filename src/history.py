import json
import os
from datetime import datetime
from typing import List, Dict, Optional


class HistoryManager:
    """Manages translation history storage and retrieval."""
    
    def __init__(self, history_dir: str):
        self.history_dir = history_dir
        self.history_file = os.path.join(history_dir, 'translations.json')
        os.makedirs(history_dir, exist_ok=True)
        self._ensure_history_file()
    
    def _ensure_history_file(self):
        """Create history file if it doesn't exist."""
        if not os.path.exists(self.history_file):
            with open(self.history_file, 'w', encoding='utf-8') as f:
                json.dump([], f)
    
    def add_entry(
        self,
        source_text: str,
        translated_text: str,
        source_language: str,
        target_language: str,
        mode: str = 'text',
        filename: Optional[str] = None,
        page_number: Optional[int] = None,
        summary: Optional[str] = None
    ) -> Dict:
        """Add a new translation entry to history."""
        entry = {
            'id': self._generate_id(),
            'timestamp': datetime.now().isoformat(),
            'source_text': source_text[:500],  # Store first 500 chars for preview
            'translated_text': translated_text[:500],
            'source_language': source_language,
            'target_language': target_language,
            'mode': mode,
            'filename': filename,
            'page_number': page_number,
            'summary': summary,
            'source_length': len(source_text),
            'translated_length': len(translated_text)
        }
        
        # Load existing history
        history = self._load_history()
        
        # Add new entry at the beginning
        history.insert(0, entry)
        
        # Keep only last 100 entries
        history = history[:100]
        
        # Save updated history
        self._save_history(history)
        
        return entry
    
    def get_history(self, limit: int = 50, skip: int = 0) -> List[Dict]:
        """Get history entries with pagination."""
        history = self._load_history()
        return history[skip:skip + limit]
    
    def get_entry(self, entry_id: str) -> Optional[Dict]:
        """Get a specific history entry by ID."""
        history = self._load_history()
        for entry in history:
            if entry.get('id') == entry_id:
                return entry
        return None
    
    def delete_entry(self, entry_id: str) -> bool:
        """Delete a history entry by ID."""
        history = self._load_history()
        original_length = len(history)
        history = [entry for entry in history if entry.get('id') != entry_id]
        
        if len(history) < original_length:
            self._save_history(history)
            return True
        return False
    
    def clear_history(self) -> bool:
        """Clear all history entries."""
        try:
            self._save_history([])
            return True
        except Exception:
            return False
    
    def search_history(self, query: str, limit: int = 20) -> List[Dict]:
        """Search history entries by text content."""
        history = self._load_history()
        query_lower = query.lower()
        
        results = []
        for entry in history:
            source = entry.get('source_text', '').lower()
            translated = entry.get('translated_text', '').lower()
            
            if query_lower in source or query_lower in translated:
                results.append(entry)
                
                if len(results) >= limit:
                    break
        
        return results
    
    def get_stats(self) -> Dict:
        """Get statistics about translation history."""
        history = self._load_history()
        
        if not history:
            return {
                'total_translations': 0,
                'languages': {},
                'modes': {},
                'total_characters_translated': 0
            }
        
        languages = {}
        modes = {}
        total_chars = 0
        
        for entry in history:
            # Count language pairs
            lang_pair = f"{entry.get('source_language', 'unknown')} → {entry.get('target_language', 'unknown')}"
            languages[lang_pair] = languages.get(lang_pair, 0) + 1
            
            # Count modes
            mode = entry.get('mode', 'unknown')
            modes[mode] = modes.get(mode, 0) + 1
            
            # Sum characters
            total_chars += entry.get('translated_length', 0)
        
        return {
            'total_translations': len(history),
            'languages': languages,
            'modes': modes,
            'total_characters_translated': total_chars
        }
    
    def _load_history(self) -> List[Dict]:
        """Load history from file."""
        try:
            with open(self.history_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return []
    
    def _save_history(self, history: List[Dict]):
        """Save history to file."""
        with open(self.history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    
    def _generate_id(self) -> str:
        """Generate a unique ID for history entry."""
        import hashlib
        timestamp = datetime.now().isoformat()
        return hashlib.md5(timestamp.encode()).hexdigest()[:12]
