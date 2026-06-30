import re


def clean_extracted_text(text):
    cleaned = re.sub(r'\(cid:\d+\)', '', text)
    cleaned = re.sub(r'\(cid:[0-9a-fA-F]+\)', '', cleaned)
    return cleaned


def split_text_for_translation(text, max_chars=3000):
    pages = re.split(r'\n\n--- Page \d+ ---\n\n', text)
    chunks = []
    for page in pages:
        page = page.strip()
        if not page:
            continue
        paragraphs = re.split(r'\n\s*\n', page)
        current_chunk = []
        current_length = 0
        for paragraph in paragraphs:
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            para_length = len(paragraph)
            if para_length > max_chars:
                sentences = re.split(r'(?<=[.!?।])\s+', paragraph)
                for sentence in sentences:
                    sentence = sentence.strip()
                    if not sentence:
                        continue
                    sent_length = len(sentence)
                    if current_length + sent_length > max_chars and current_chunk:
                        chunks.append('\n\n'.join(current_chunk))
                        current_chunk = []
                        current_length = 0
                    if sent_length > max_chars:
                        words = sentence.split()
                        temp_chunk = []
                        temp_length = 0
                        for word in words:
                            if temp_length + len(word) + 1 > max_chars and temp_chunk:
                                chunks.append('\n'.join(temp_chunk))
                                temp_chunk = []
                                temp_length = 0
                            temp_chunk.append(word)
                            temp_length += len(word) + 1
                        if temp_chunk:
                            chunks.append('\n'.join(temp_chunk))
                    else:
                        current_chunk.append(sentence)
                        current_length += sent_length + 2
                continue
            if current_length + para_length > max_chars and current_chunk:
                chunks.append('\n\n'.join(current_chunk))
                current_chunk = []
                current_length = 0
            current_chunk.append(paragraph)
            current_length += para_length + 2
        if current_chunk:
            chunks.append('\n\n'.join(current_chunk))
    return chunks or [text]


def extract_pages(text):
    page_numbers = [int(number) for number in re.findall(r'--- Page (\d+) ---', text)]
    parts = re.split(r'\n\n--- Page \d+ ---\n\n', text)
    pages = {}
    for index, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue
        page_number = page_numbers[index - 1] if index > 0 else 1
        pages[page_number] = part
    if not pages and text.strip():
        pages[1] = text.strip()
    return pages


def get_page_text(text, page_number):
    pages = extract_pages(text)
    if page_number not in pages:
        raise ValueError(f'Page {page_number} was not found')
    return pages[page_number]
