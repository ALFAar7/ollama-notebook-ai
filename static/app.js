document.addEventListener('DOMContentLoaded', () => {
    const pdfViewer = document.getElementById('pdfViewer');
    const translationArea = document.getElementById('translationArea');
    const pdfInput = document.getElementById('pdfInput');
    const translateBtn = document.getElementById('translateBtn');
    let pdfText = '';
    let currentPdfFile = null;

    pdfInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        currentPdfFile = file;
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.success) {
                pdfText = data.text;
                displayPdf(file);
                translationArea.innerHTML = '<h2>Text extracted. Click Translate to translate.</h2>';
            } else {
                alert(data.error || 'Upload failed');
            }
        } catch (err) {
            console.error(err);
            alert('Error uploading file');
        }
    });

    translateBtn.addEventListener('click', async () => {
        if (!pdfText) {
            alert('Please upload a PDF first');
            return;
        }

        translationArea.innerHTML = '<h2>Translating...</h2>';
        
        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: pdfText,
                    target_language: 'English',
                    source_language: 'auto'
                })
            });
            const data = await response.json();
            if (data.success) {
                translationArea.innerHTML = formatText(data.translated_text);
            } else {
                translationArea.innerHTML = `<h2>Error: ${data.error}</h2>`;
            }
        } catch (err) {
            console.error(err);
            translationArea.innerHTML = '<h2>Translation failed</h2>';
        }
    });

    function displayPdf(file) {
        pdfViewer.innerHTML = '<canvas id="pdfCanvas"></canvas>';
        const canvas = document.getElementById('pdfCanvas');
        const url = URL.createObjectURL(file);
        
        pdfjsLib.getDocument(url).promise.then(pdf => {
            renderPage(pdf, 1);
            
            // Add navigation
            const nav = document.createElement('div');
            nav.style.marginTop = '10px';
            nav.innerHTML = `
                <button id="prevPage">Previous</button>
                <span id="pageInfo">Page 1 of ${pdf.numPages}</span>
                <button id="nextPage">Next</button>
            `;
            pdfViewer.appendChild(nav);
            
            document.getElementById('prevPage').addEventListener('click', () => {
                if (currentPage > 1) renderPage(pdf, currentPage - 1);
            });
            document.getElementById('nextPage').addEventListener('click', () => {
                if (currentPage < pdf.numPages) renderPage(pdf, currentPage + 1);
            });
        });
    }

    let currentPage = 1;
    function renderPage(pdf, pageNum) {
        currentPage = pageNum;
        pdf.getPage(pageNum).then(page => {
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.getElementById('pdfCanvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            page.render({ canvasContext: ctx, viewport: viewport });
            document.getElementById('pageInfo').textContent = `Page ${pageNum} of ${pdf.numPages}`;
        });
    }

    function formatText(text) {
        return text.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    }
});