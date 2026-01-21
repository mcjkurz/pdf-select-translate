import * as pdfjsLib from "https://unpkg.com/pdfjs-dist@5.4.530/build/pdf.min.mjs";
import * as pdfjsViewer from "https://unpkg.com/pdfjs-dist@5.4.530/web/pdf_viewer.mjs";

const els = {
  fileInput: document.getElementById("fileInput"),
  clearBtn: document.getElementById("clearBtn"),
  translateBtn: document.getElementById("translateBtn"),
  targetLang: document.getElementById("targetLang"),
  customLang: document.getElementById("customLang"),
  translationOut: document.getElementById("translationOut"),
  statusLine: document.getElementById("statusLine"),
  pdfViewport: document.getElementById("pdfViewport"),
  dropZone: document.getElementById("dropZone"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageNum: document.getElementById("pageNum"),
  pageCount: document.getElementById("pageCount"),
  resizer: document.getElementById("resizer"),
  leftPanel: document.getElementById("leftPanel"),
  rightPanel: document.getElementById("rightPanel"),
  fontUp: document.getElementById("fontUp"),
  fontDown: document.getElementById("fontDown"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
};

const MIN_CHARS_FOR_TRANSLATION = 16;
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_STEP = 2;
const FONT_SIZE_KEY = "translation-font-size";
const PANEL_WIDTH_KEY = "right-panel-width";

let pdfDoc = null;
let pdfViewer = null;
let eventBus = null;
let linkService = null;
let pageTextCache = new Map();
let translateAbort = null;
let currentFontSize = parseInt(localStorage.getItem(FONT_SIZE_KEY)) || 16;

// Initialize font size
function initFontSize() {
  els.translationOut.style.fontSize = currentFontSize + "px";
}

function changeFontSize(delta) {
  currentFontSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, currentFontSize + delta));
  els.translationOut.style.fontSize = currentFontSize + "px";
  localStorage.setItem(FONT_SIZE_KEY, currentFontSize);
}

function setStatus(msg) {
  els.statusLine.textContent = msg || "";
}

function setTranslation(text) {
  els.translationOut.classList.remove("loading-shimmer");
  els.translationOut.innerHTML = "";
  els.translationOut.textContent = text || "";
}

function setLoading(isLoading) {
  if (isLoading) {
    els.translationOut.textContent = "";
    els.translationOut.classList.add("loading-shimmer");
    // Add loading dots
    const dots = document.createElement("div");
    dots.className = "loading-dots";
    dots.innerHTML = "<span></span><span></span><span></span>";
    els.translationOut.appendChild(dots);
    setStatus("");
  } else {
    els.translationOut.classList.remove("loading-shimmer");
    els.translationOut.innerHTML = "";
  }
}

// Count letters (a-z, A-Z) and CJK characters
function countMeaningfulChars(s) {
  let count = 0;
  for (const c of s) {
    if (/[a-zA-Z]/.test(c)) {
      count++;
    } else if (c >= "\u4e00" && c <= "\u9fff") {
      count++;
    } else if (c >= "\u3400" && c <= "\u4dbf") {
      count++;
    }
  }
  return count;
}

function normalizeWS(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function getContextAround(fullText, selected, ctxChars = 240) {
  const full = fullText || "";
  const sel = selected || "";
  if (!full || !sel) return { before: "", after: "" };

  let idx = full.indexOf(sel);
  if (idx !== -1) {
    return {
      before: full.slice(Math.max(0, idx - ctxChars), idx),
      after: full.slice(idx + sel.length, idx + sel.length + ctxChars),
    };
  }

  const nFull = normalizeWS(full);
  const nSel = normalizeWS(sel);
  if (!nFull || !nSel) return { before: "", after: "" };
  idx = nFull.indexOf(nSel);
  if (idx === -1) return { before: "", after: "" };
  return {
    before: nFull.slice(Math.max(0, idx - ctxChars), idx),
    after: nFull.slice(idx + nSel.length, idx + nSel.length + ctxChars),
  };
}

async function fetchPageText(pageNumber) {
  if (!pdfDoc) return "";
  if (pageTextCache.has(pageNumber)) return pageTextCache.get(pageNumber);
  const page = await pdfDoc.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items.map((it) => it.str).join(" ");
  pageTextCache.set(pageNumber, text);
  return text;
}

let pdfContainer = null;

function ensureViewer() {
  // Create container structure that pdf.js requires:
  // .pdf-viewport (relative) > .pdf-container (absolute) > .pdfViewer
  const containerDiv = document.createElement('div');
  containerDiv.className = 'pdf-container';
  
  const viewerDiv = document.createElement('div');
  viewerDiv.className = 'pdfViewer';
  
  containerDiv.appendChild(viewerDiv);
  els.pdfViewport.innerHTML = '';
  els.pdfViewport.appendChild(containerDiv);
  
  pdfContainer = containerDiv;
  
  eventBus = new pdfjsViewer.EventBus();
  linkService = new pdfjsViewer.PDFLinkService({ eventBus });
  
  pdfViewer = new pdfjsViewer.PDFViewer({
    container: containerDiv,  // The absolutely positioned container
    viewer: viewerDiv,
    eventBus,
    linkService,
    textLayerMode: 2,
  });
  
  linkService.setViewer(pdfViewer);

  eventBus.on("pagesinit", () => {
    requestAnimationFrame(() => {
      fitToWidth();
      updatePageIndicator();
    });
  });

  eventBus.on("pagechanging", () => {
    updatePageIndicator();
  });

  // Refit on window resize
  window.addEventListener("resize", debounce(fitToWidth, 150));
}

function fitToWidth() {
  if (!pdfViewer || !pdfDoc || !pdfContainer) return;
  pdfViewer.currentScaleValue = "page-width";
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function updatePageIndicator() {
  const current = pdfViewer ? pdfViewer.currentPageNumber : 0;
  const total = pdfDoc ? pdfDoc.numPages : 0;
  els.pageNum.textContent = String(current || 0);
  els.pageCount.textContent = String(total || 0);
}

async function loadPdfFromUrl(url) {
  pageTextCache.clear();
  ensureViewer();
  setStatus("Loading PDF…");
  setTranslation("");

  try {
    const loadingTask = pdfjsLib.getDocument(url);
    pdfDoc = await loadingTask.promise;

    pdfViewer.setDocument(pdfDoc);
    linkService.setDocument(pdfDoc, null);
    els.pdfViewport.classList.add("has-pdf");
    updatePageIndicator();
    setStatus("");
  } catch (e) {
    console.error("Error loading PDF:", e);
    setStatus("Error loading PDF: " + (e.message || e));
  }
}

async function uploadPdf(file) {
  const fd = new FormData();
  fd.append("file", file);
  const resp = await fetch("/api/upload", { method: "POST", body: fd });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || "Upload failed");
  }
  return await resp.json();
}

function getTargetLanguage() {
  const selectValue = els.targetLang.value;
  if (selectValue === "Other") {
    return els.customLang.value.trim() || "English";
  }
  return selectValue;
}

async function translateSelection(selectedText) {
  const rawText = (selectedText || "").trim();
  if (!rawText) {
    setStatus("Select text from the PDF first.");
    return;
  }

  const text = normalizeWS(rawText);
  const charCount = countMeaningfulChars(text);
  if (charCount < MIN_CHARS_FOR_TRANSLATION) {
    setStatus(`Selection too short (${charCount} chars, need ${MIN_CHARS_FOR_TRANSLATION})`);
    return;
  }
  
  setLoading(true);

  const target = getTargetLanguage();
  const page = pdfViewer ? pdfViewer.currentPageNumber : 1;
  const fullText = await fetchPageText(page);
  const { before, after } = getContextAround(fullText, rawText, 240);

  if (translateAbort) translateAbort.abort();
  translateAbort = new AbortController();

  const resp = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selected_text: text,
      target_language: target,
      context_before: before,
      context_after: after,
    }),
    signal: translateAbort.signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || "Translation failed");
  }
  const data = await resp.json();
  setTranslation((data.translation || "").trim());
  setStatus("");
}

function clearAll() {
  setTranslation("");
  setStatus("");
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
}

async function doTranslate() {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : "";
  try {
    await translateSelection(text);
  } catch (e) {
    if (String(e && e.name) === "AbortError") return;
    setLoading(false);
    setStatus(String(e && e.message ? e.message : e));
  }
}

async function handleFileUpload(file) {
  if (!file) {
    setStatus("No file selected.");
    return;
  }
  if (file.type !== "application/pdf") {
    setStatus("Please select a PDF file.");
    return;
  }
  try {
    setStatus("Uploading…");
    const { pdf_url } = await uploadPdf(file);
    await loadPdfFromUrl(pdf_url);
  } catch (e) {
    setStatus(String(e && e.message ? e.message : e));
  }
}

function setupDragAndDrop() {
  const dropZone = els.dropZone;
  if (!dropZone) return;

  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  });

  // Click to browse
  dropZone.addEventListener("click", () => {
    els.fileInput.click();
  });
}

// Resizable panel
function setupResizer() {
  const resizer = els.resizer;
  const rightPanel = els.rightPanel;
  
  // Restore saved width
  const savedWidth = localStorage.getItem(PANEL_WIDTH_KEY);
  if (savedWidth) {
    rightPanel.style.width = savedWidth + "px";
  }
  
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = rightPanel.offsetWidth;
    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const dx = startX - e.clientX;
    const newWidth = Math.max(280, Math.min(600, startWidth + dx));
    rightPanel.style.width = newWidth + "px";
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(PANEL_WIDTH_KEY, rightPanel.offsetWidth);
    }
  });
}

// Custom language input
function setupCustomLanguage() {
  els.targetLang.addEventListener("change", () => {
    if (els.targetLang.value === "Other") {
      els.customLang.style.display = "block";
      els.customLang.focus();
    } else {
      els.customLang.style.display = "none";
    }
  });
}

async function init() {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs";

  // Initialize font size
  initFontSize();

  // Auto-upload when file is selected
  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files && els.fileInput.files[0];
    if (file) handleFileUpload(file);
  });

  // Drag and drop + click to browse
  setupDragAndDrop();

  els.clearBtn.addEventListener("click", clearAll);
  els.translateBtn.addEventListener("click", doTranslate);

  els.prevPage.addEventListener("click", () => {
    if (!pdfViewer) return;
    pdfViewer.currentPageNumber = Math.max(1, pdfViewer.currentPageNumber - 1);
  });

  els.nextPage.addEventListener("click", () => {
    if (!pdfViewer || !pdfDoc) return;
    pdfViewer.currentPageNumber = Math.min(pdfDoc.numPages, pdfViewer.currentPageNumber + 1);
  });

  // Zoom controls
  els.zoomIn.addEventListener("click", () => {
    if (!pdfViewer) return;
    pdfViewer.currentScale = Math.min(4, pdfViewer.currentScale * 1.25);
  });

  els.zoomOut.addEventListener("click", () => {
    if (!pdfViewer) return;
    pdfViewer.currentScale = Math.max(0.25, pdfViewer.currentScale / 1.25);
  });

  // Font size controls
  els.fontUp.addEventListener("click", () => changeFontSize(FONT_SIZE_STEP));
  els.fontDown.addEventListener("click", () => changeFontSize(-FONT_SIZE_STEP));

  // Resizable panel
  setupResizer();

  // Custom language
  setupCustomLanguage();

  // Initial state
  clearAll();
}

init();
