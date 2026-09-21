"""
Content-type-aware text chunking for translation documents.
Adapted from Open Notebook's chunking utilities.
"""

import os
import re
from typing import List, Optional, Tuple


try:
    from langchain_text_splitters import (
        MarkdownHeaderTextSplitter,
        HTMLHeaderTextSplitter,
        RecursiveCharacterTextSplitter
    )
    HAS_LANGCHAIN = True
except ImportError:
    HAS_LANGCHAIN = False


def _get_splitter(content_type: str):
    """Get the appropriate text splitter based on content type."""
    if not HAS_LANGCHAIN:
        return None
    
    if content_type == 'html':
        headers_to_split_on = [
            ("h1", "Header 1"),
            ("h2", "Header 2"),
            ("h3", "Header 3"),
            ("h4", "Header 4"),
            ("h5", "Header 5"),
            ("h6", "Header 6"),
        ]
        return HTMLHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    elif content_type == 'markdown':
        headers_to_split_on = [
            ("#", "Header 1"),
            ("##", "Header 2"),
            ("###", "Header 3"),
            ("####", "Header 4"),
            ("#####", "Header 5"),
            ("######", "Header 6"),
        ]
        return MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    else:
        return None


def _split_text_recursive(text: str, chunk_size: int = 1600, chunk_overlap: int = 240) -> List[str]:
    """
    Fallback recursive character splitting without langchain dependency.
    Splits text into chunks by paragraphs, then by sentences if needed.
    """
    # First split by double newlines (paragraphs)
    paragraphs = re.split(r'\n\s*\n', text)
    chunks = []
    current_chunk = []
    current_length = 0
    
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        para_length = len(para)
        
        # If paragraph itself is larger than chunk_size, split by sentences
        if para_length > chunk_size:
            sentences = re.split(r'(?<=[.!?।])\s+', para)
            for sentence in sentences:
                sentence = sentence.strip()
                if not sentence:
                    continue
                sent_length = len(sentence)
                
                if current_length + sent_length > chunk_size and current_chunk:
                    chunks.append('\n\n'.join(current_chunk))
                    current_chunk = []
                    current_length = 0
                
                if sent_length > chunk_size:
                    # Word-level splitting for very long sentences
                    words = sentence.split()
                    temp_chunk = []
                    temp_length = 0
                    for word in words:
                        if temp_length + len(word) + 1 > chunk_size and temp_chunk:
                            chunks.append(' '.join(temp_chunk))
                            temp_chunk = []
                            temp_length = 0
                        temp_chunk.append(word)
                        temp_length += len(word) + 1
                    if temp_chunk:
                        chunks.append(' '.join(temp_chunk))
                else:
                    current_chunk.append(sentence)
                    current_length += sent_length + 2
            continue
        
        # Check if adding this paragraph would exceed chunk_size
        if current_length + para_length > chunk_size and current_chunk:
            chunks.append('\n\n'.join(current_chunk))
            current_chunk = []
            current_length = 0
        
        current_chunk.append(para)
        current_length += para_length + 2
    
    if current_chunk:
        chunks.append('\n\n'.join(current_chunk))
    
    return chunks or [text]


def detect_content_type(text: str, file_path: Optional[str] = None) -> str:
    """
    Auto-detect content type from file extension or content heuristics.
    
    Args:
        text: The text content to analyze
        file_path: Optional file path for extension-based detection
        
    Returns:
        Content type: 'html', 'markdown', or 'plain'
    """
    # Check file extension first if provided
    if file_path:
        ext = os.path.splitext(file_path)[1].lower()
        if ext in ['.html', '.htm']:
            return 'html'
        elif ext in ['.md', '.markdown']:
            return 'markdown'
    
    # Content-based heuristics
    text_sample = text[:1000]  # Check first 1000 chars
    
    # HTML detection
    if re.search(r'<[^>]+>', text_sample):
        # Likely HTML if we see tags
        return 'html'
    
    # Markdown detection
    markdown_patterns = [
        r'^#{1,6}\s+',  # Headers
        r'^\s*[-*+]\s+',  # Unordered lists
        r'^\s*\d+\.\s+',  # Ordered lists
        r'\[[^\]]+\]\([^\)]+\)',  # Links
        r'`{3}.*?`{3}',  # Code blocks
    ]
    
    for pattern in markdown_patterns:
        if re.search(pattern, text_sample, re.MULTILINE):
            return 'markdown'
    
    # Default to plain text
    return 'plain'


def chunk_text(text: str, content_type: str, file_path: Optional[str] = None) -> List[str]:
    """
    Split text into managed chunks using appropriate splitter per content type.
    
    Args:
        text: The text to chunk
        content_type: One of 'html', 'markdown', 'plain'
        file_path: Optional file path for metadata
        
    Returns:
        List of text chunks
    """
    # Configuration from plan
    CHUNK_SIZE = 400  # tokens (approximated as chars/4)
    CHUNK_OVERLAP = int(CHUNK_SIZE * 0.15)  # 15%
    MIN_CHUNK_SIZE = 5  # tokens
    
    # Convert token estimates to character estimates (rough approximation)
    # Assuming ~4 characters per token on average
    max_chars = CHUNK_SIZE * 4
    overlap_chars = CHUNK_OVERLAP * 4
    min_chars = MIN_CHUNK_SIZE * 4
    
    chunks = []
    
    if HAS_LANGCHAIN:
        splitter = _get_splitter(content_type)
        if splitter:
            try:
                header_splits = splitter.split_text(text)
                chunks = [split.page_content for split in header_splits if split.page_content.strip()]
            except Exception:
                # Fallback to recursive character splitting
                chunks = _split_text_recursive(text, max_chars, overlap_chars)
        else:
            chunks = _split_text_recursive(text, max_chars, overlap_chars)
    else:
        # Use fallback splitting without langchain
        chunks = _split_text_recursive(text, max_chars, overlap_chars)
    
    # Filter chunks below minimum threshold
    chunks = [chunk for chunk in chunks if len(chunk.strip()) >= min_chars]
    
    # Apply secondary chunking for oversized chunks
    final_chunks = []
    for chunk in chunks:
        if len(chunk) > max_chars * 2:  # If chunk is too large, split further
            sub_chunks = _split_text_recursive(chunk, max_chars, overlap_chars)
            final_chunks.extend([c for c in sub_chunks if len(c.strip()) >= min_chars])
        else:
            final_chunks.append(chunk)
    
    return final_chunks


def chunk_for_translation(text: str) -> List[str]:
    """
    Domain-specific chunking for translation.
    Uses content-type detection and appropriate splitting.
    
    Args:
        text: Text to chunk for translation
        
    Returns:
        List of chunks suitable for translation processing
    """
    content_type = detect_content_type(text)
    return chunk_text(text, content_type)