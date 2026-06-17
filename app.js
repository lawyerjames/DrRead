import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.worker.min.mjs";

const storageKey = "drread.notes.v1";

const elements = {
  pdfInput: document.querySelector("#pdfInput"),
  dropZone: document.querySelector("#dropZone"),
  fileMeta: document.querySelector("#fileMeta"),
  statusText: document.querySelector("#statusText"),
  readingArea: document.querySelector("#readingArea"),
  mainTextOnlyInput: document.querySelector("#mainTextOnlyInput"),
  playButton: document.querySelector("#playButton"),
  pauseButton: document.querySelector("#pauseButton"),
  stopButton: document.querySelector("#stopButton"),
  voiceSelect: document.querySelector("#voiceSelect"),
  rateInput: document.querySelector("#rateInput"),
  pitchInput: document.querySelector("#pitchInput"),
  rateOutput: document.querySelector("#rateOutput"),
  pitchOutput: document.querySelector("#pitchOutput"),
  notesInput: document.querySelector("#notesInput"),
  saveState: document.querySelector("#saveState"),
  clearNotesButton: document.querySelector("#clearNotesButton"),
};

const speech = window.speechSynthesis;
let paragraphNodes = [];
let currentParagraphIndex = 0;
let activeUtterance = null;
let isPaused = false;
let voices = [];
let currentFile = null;

function setStatus(message) {
  elements.statusText.textContent = message;
}

function setFileMeta(message) {
  elements.fileMeta.textContent = message;
}

function setLoadingState(isLoading) {
  elements.pdfInput.disabled = isLoading;
  elements.dropZone.classList.toggle("is-loading", isLoading);
}

function median(numbers) {
  const sorted = numbers.filter(Number.isFinite).sort((first, second) => first - second);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length === 0) {
    return 0;
  }

  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function textMatchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function getItemGeometry(item, pageHeight) {
  const fontSize = Math.abs(item.transform[3]) || item.height || 0;

  return {
    text: item.str.replace(/\s+/g, " ").trim(),
    x: item.transform[4],
    y: item.transform[5],
    top: pageHeight - item.transform[5],
    fontSize,
  };
}

function isJstorSourceNotice(items, pageNumber) {
  if (pageNumber !== 1) {
    return false;
  }

  const pageText = items.map((item) => item.text).join(" ");
  return (
    pageText.includes("JSTOR is a not-for-profit") &&
    pageText.includes("Stable URL") &&
    pageText.includes("The Yale Law Journal")
  );
}

function shouldKeepTextItem(item, context) {
  if (!context.mainTextOnly) {
    return true;
  }

  const { pageHeight, bodyFontSize, pageNumber } = context;
  const boilerplatePatterns = [
    /^This content downloaded from$/i,
    /^All use subject to$/i,
    /^https:\/\/about\.jstor\.org\/terms$/i,
    /^\(cid:\d+\)/i,
    /^JSTOR\b/i,
  ];

  if (textMatchesAny(item.text, boilerplatePatterns)) {
    return false;
  }

  const isExtremeFooter = item.top > pageHeight - 34;
  const isRunningHeader = pageNumber > 1 && item.top < pageHeight * 0.15;
  const isSmallBottomNote =
    bodyFontSize > 0 && item.fontSize < bodyFontSize * 0.82 && item.top > pageHeight * 0.62;

  return !isExtremeFooter && !isRunningHeader && !isSmallBottomNote;
}

function toLines(items) {
  const lines = [];
  let currentLine = null;

  items.forEach((item) => {
    const isNewLine =
      currentLine && Math.abs(item.top - currentLine.top) > Math.max(4, item.fontSize * 0.55);

    if (isNewLine) {
      lines.push(currentLine);
      currentLine = null;
    }

    if (!currentLine) {
      currentLine = {
        text: item.text,
        top: item.top,
        x: item.x,
        fontSize: item.fontSize,
      };
      return;
    }

    currentLine.text = `${currentLine.text} ${item.text}`;
    currentLine.fontSize = Math.max(currentLine.fontSize, item.fontSize);
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.map((line) => ({
    ...line,
    text: line.text.replace(/\s+/g, " ").trim(),
  }));
}

function lineStartsParagraph(line, previousLine) {
  if (!previousLine) {
    return true;
  }

  const verticalGap = line.top - previousLine.top;
  const expectedGap = Math.max(line.fontSize, previousLine.fontSize) * 1.55;
  const isIndented = line.x - previousLine.x > 14;
  const previousEndsSentence = /[.!?]"?$/.test(previousLine.text);

  return verticalGap > expectedGap || (isIndented && previousEndsSentence);
}

function mergeLinesToParagraphs(lines) {
  const paragraphs = [];
  let currentParagraph = "";
  let previousLine = null;

  lines.forEach((line) => {
    if (lineStartsParagraph(line, previousLine)) {
      if (currentParagraph.trim()) {
        paragraphs.push(currentParagraph.trim());
      }
      currentParagraph = line.text;
    } else if (currentParagraph.endsWith("-")) {
      currentParagraph = `${currentParagraph.slice(0, -1)}${line.text}`;
    } else {
      currentParagraph = `${currentParagraph} ${line.text}`;
    }

    previousLine = line;
  });

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  return paragraphs.filter((paragraph) => paragraph.length > 1);
}

function normalizeText(items, options) {
  const pageItems = items.map((item) => getItemGeometry(item, options.pageHeight)).filter((item) => item.text);

  if (options.mainTextOnly && isJstorSourceNotice(pageItems, options.pageNumber)) {
    return {
      paragraphs: [],
      skippedReason: "JSTOR source notice",
    };
  }

  const candidateFontSizes = pageItems
    .filter((item) => item.top > options.pageHeight * 0.12 && item.top < options.pageHeight * 0.82)
    .map((item) => item.fontSize);
  const bodyFontSize = median(candidateFontSizes);
  const filteredItems = pageItems.filter((item) =>
    shouldKeepTextItem(item, {
      ...options,
      bodyFontSize,
    }),
  );

  return {
    paragraphs: mergeLinesToParagraphs(toLines(filteredItems)),
    skippedReason: null,
  };
}

async function extractPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  let skippedPages = 0;
  const mainTextOnly = elements.mainTextOnlyInput.checked;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setStatus(`正在整理第 ${pageNumber} / ${pdf.numPages} 頁`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const result = normalizeText(textContent.items, {
      pageNumber,
      pageHeight: viewport.height,
      mainTextOnly,
    });

    if (result.skippedReason) {
      skippedPages += 1;
      continue;
    }

    pages.push({
      pageNumber,
      paragraphs: result.paragraphs,
    });
  }

  return { pages, skippedPages };
}

function renderPages(pages) {
  const fragment = document.createDocumentFragment();

  pages.forEach((page) => {
    const section = document.createElement("section");
    section.className = "page-block";
    section.setAttribute("aria-label", `第 ${page.pageNumber} 頁`);

    const heading = document.createElement("div");
    heading.className = "page-heading";
    heading.textContent = `Page ${page.pageNumber}`;
    section.append(heading);

    if (page.paragraphs.length === 0) {
      const paragraph = document.createElement("p");
      paragraph.className = "paragraph is-empty";
      paragraph.textContent = "這一頁沒有可朗讀的正文。";
      section.append(paragraph);
    } else {
      page.paragraphs.forEach((text) => {
        const paragraph = document.createElement("p");
        paragraph.className = "paragraph";
        paragraph.textContent = text;
        paragraph.tabIndex = 0;
        paragraph.addEventListener("click", () => selectParagraph(paragraph));
        paragraph.addEventListener("dblclick", () => speakFromParagraph(paragraph));
        section.append(paragraph);
      });
    }

    fragment.append(section);
  });

  if (pages.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML = "<h2>沒有找到正文</h2><p>可關閉「只讀正文」後重新載入，檢查原始抽取結果。</p>";
    fragment.append(emptyState);
  }

  elements.readingArea.replaceChildren(fragment);
  paragraphNodes = [...elements.readingArea.querySelectorAll(".paragraph")].filter(
    (node) => !node.classList.contains("is-empty"),
  );
  currentParagraphIndex = 0;
}

async function handlePdfFile(file) {
  if (!file || file.type !== "application/pdf") {
    setStatus("請選擇 PDF 檔案。");
    return;
  }

  currentFile = file;
  stopSpeech();
  setLoadingState(true);
  setFileMeta(`${file.name}，${(file.size / 1024 / 1024).toFixed(2)} MB`);

  try {
    const { pages, skippedPages } = await extractPdf(file);
    renderPages(pages);
    const skippedText = skippedPages > 0 ? `，已略過 ${skippedPages} 頁非正文` : "";
    setStatus(`已載入 ${file.name}${skippedText}`);
  } catch (error) {
    console.error(error);
    setStatus("PDF 讀取失敗，請確認檔案沒有加密或損毀。");
  } finally {
    setLoadingState(false);
  }
}

function selectParagraph(paragraph) {
  paragraphNodes.forEach((node) => node.classList.remove("is-selected"));
  paragraph.classList.add("is-selected");
  currentParagraphIndex = Math.max(0, paragraphNodes.indexOf(paragraph));
}

function clearSpeakingHighlight() {
  paragraphNodes.forEach((node) => node.classList.remove("is-speaking"));
}

function highlightParagraph(index) {
  clearSpeakingHighlight();
  const paragraph = paragraphNodes[index];

  if (!paragraph) {
    return;
  }

  paragraph.classList.add("is-speaking");
  paragraph.scrollIntoView({ behavior: "smooth", block: "center" });
}

function getSelectedText() {
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : "";
  const isInsideReader =
    selection &&
    selection.rangeCount > 0 &&
    elements.readingArea.contains(selection.getRangeAt(0).commonAncestorContainer);

  return isInsideReader ? selectedText : "";
}

function createUtterance(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  const selectedVoice = voices.find((voice) => voice.name === elements.voiceSelect.value);

  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang;
  }

  utterance.rate = Number(elements.rateInput.value);
  utterance.pitch = Number(elements.pitchInput.value);

  return utterance;
}

function speakSelectedText(text) {
  stopSpeech();
  activeUtterance = createUtterance(text);
  activeUtterance.onend = () => {
    activeUtterance = null;
    setStatus("已讀完選取文字。");
  };
  speech.speak(activeUtterance);
  setStatus("正在朗讀選取文字。");
}

function speakCurrentQueue() {
  if (currentParagraphIndex >= paragraphNodes.length) {
    activeUtterance = null;
    clearSpeakingHighlight();
    currentParagraphIndex = 0;
    setStatus("朗讀完成。");
    return;
  }

  highlightParagraph(currentParagraphIndex);
  const paragraph = paragraphNodes[currentParagraphIndex];
  activeUtterance = createUtterance(paragraph.textContent);
  activeUtterance.onend = () => {
    currentParagraphIndex += 1;
    speakCurrentQueue();
  };
  activeUtterance.onerror = () => {
    activeUtterance = null;
    clearSpeakingHighlight();
    setStatus("朗讀中斷。");
  };

  speech.speak(activeUtterance);
  setStatus(`正在朗讀第 ${currentParagraphIndex + 1} 段`);
}

function speakFromParagraph(paragraph) {
  currentParagraphIndex = Math.max(0, paragraphNodes.indexOf(paragraph));
  stopSpeech();
  speakCurrentQueue();
}

function playSpeech() {
  if (!speech) {
    setStatus("這個瀏覽器不支援 Web Speech API。");
    return;
  }

  if (isPaused) {
    speech.resume();
    isPaused = false;
    setStatus("繼續朗讀。");
    return;
  }

  const selectedText = getSelectedText();

  if (selectedText) {
    speakSelectedText(selectedText);
    return;
  }

  if (paragraphNodes.length === 0) {
    setStatus("請先載入 PDF。");
    return;
  }

  stopSpeech();
  speakCurrentQueue();
}

function pauseSpeech() {
  if (speech && speech.speaking && !speech.paused) {
    speech.pause();
    isPaused = true;
    setStatus("已暫停。");
  }
}

function stopSpeech() {
  if (speech) {
    speech.cancel();
  }

  activeUtterance = null;
  isPaused = false;
  clearSpeakingHighlight();
}

function prioritizeVoices(availableVoices) {
  return [...availableVoices].sort((first, second) => {
    const firstScore = /^(zh|en)/i.test(first.lang) ? 0 : 1;
    const secondScore = /^(zh|en)/i.test(second.lang) ? 0 : 1;
    return firstScore - secondScore || first.lang.localeCompare(second.lang);
  });
}

function loadVoices() {
  if (!speech) {
    elements.voiceSelect.replaceChildren(new Option("沒有可用的語音", ""));
    elements.voiceSelect.disabled = true;
    return;
  }

  voices = prioritizeVoices(speech.getVoices());
  elements.voiceSelect.replaceChildren();

  if (voices.length === 0) {
    const option = new Option("正在載入語音", "");
    elements.voiceSelect.add(option);
    return;
  }

  voices.forEach((voice) => {
    const option = new Option(`${voice.name} (${voice.lang})`, voice.name);
    elements.voiceSelect.add(option);
  });

  const preferredIndex = voices.findIndex((voice) => /^(zh-TW|zh|en)/i.test(voice.lang));
  elements.voiceSelect.selectedIndex = preferredIndex >= 0 ? preferredIndex : 0;
}

function restoreNotes() {
  elements.notesInput.value = localStorage.getItem(storageKey) || "";
}

function saveNotes() {
  localStorage.setItem(storageKey, elements.notesInput.value);
  elements.saveState.textContent = `已儲存於 ${new Date().toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

elements.pdfInput.addEventListener("change", (event) => {
  handlePdfFile(event.target.files[0]);
});

elements.mainTextOnlyInput.addEventListener("change", () => {
  if (currentFile) {
    handlePdfFile(currentFile);
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});

elements.dropZone.addEventListener("drop", (event) => {
  handlePdfFile(event.dataTransfer.files[0]);
});

elements.playButton.addEventListener("click", playSpeech);
elements.pauseButton.addEventListener("click", pauseSpeech);
elements.stopButton.addEventListener("click", () => {
  stopSpeech();
  setStatus("已停止朗讀。");
});

elements.rateInput.addEventListener("input", () => {
  elements.rateOutput.value = Number(elements.rateInput.value).toFixed(1);
});

elements.pitchInput.addEventListener("input", () => {
  elements.pitchOutput.value = Number(elements.pitchInput.value).toFixed(1);
});

elements.notesInput.addEventListener("input", saveNotes);
elements.clearNotesButton.addEventListener("click", () => {
  elements.notesInput.value = "";
  saveNotes();
  elements.notesInput.focus();
});

if (speech) {
  speech.addEventListener("voiceschanged", loadVoices);
}

window.addEventListener("beforeunload", stopSpeech);

restoreNotes();
loadVoices();
