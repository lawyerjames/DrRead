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

function normalizeText(items) {
  const lines = [];
  let line = "";
  let lastY = null;

  items.forEach((item) => {
    const text = item.str.trim();

    if (!text) {
      return;
    }

    const y = Math.round(item.transform[5]);
    const isNewLine = lastY !== null && Math.abs(y - lastY) > 4;

    if (isNewLine && line.trim()) {
      lines.push(line.trim());
      line = "";
    }

    line = line ? `${line} ${text}` : text;
    lastY = y;
  });

  if (line.trim()) {
    lines.push(line.trim());
  }

  return lines
    .join("\n")
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z])|(?<=。)\s*/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function extractPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setStatus(`解析第 ${pageNumber} / ${pdf.numPages} 頁`);
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pages.push({
      pageNumber,
      paragraphs: normalizeText(textContent.items),
    });
  }

  return pages;
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
      paragraph.className = "paragraph";
      paragraph.textContent = "此頁未擷取到可朗讀文字。";
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

  elements.readingArea.replaceChildren(fragment);
  paragraphNodes = [...elements.readingArea.querySelectorAll(".paragraph")].filter(
    (node) => !node.textContent.includes("未擷取到可朗讀文字"),
  );
  currentParagraphIndex = 0;
}

async function handlePdfFile(file) {
  if (!file || file.type !== "application/pdf") {
    setStatus("請選擇 PDF 檔案");
    return;
  }

  stopSpeech();
  setLoadingState(true);
  setFileMeta(`${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`);

  try {
    const pages = await extractPdf(file);
    renderPages(pages);
    setStatus(`已載入 ${file.name}`);
  } catch (error) {
    console.error(error);
    setStatus("PDF 解析失敗，請換一份文件試試");
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
    setStatus("選取文字朗讀完成");
  };
  speech.speak(activeUtterance);
  setStatus("朗讀選取文字");
}

function speakCurrentQueue() {
  if (currentParagraphIndex >= paragraphNodes.length) {
    activeUtterance = null;
    clearSpeakingHighlight();
    currentParagraphIndex = 0;
    setStatus("朗讀完成");
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
    setStatus("朗讀中斷");
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
    setStatus("此瀏覽器不支援 Web Speech API");
    return;
  }

  if (isPaused) {
    speech.resume();
    isPaused = false;
    setStatus("繼續朗讀");
    return;
  }

  const selectedText = getSelectedText();

  if (selectedText) {
    speakSelectedText(selectedText);
    return;
  }

  if (paragraphNodes.length === 0) {
    setStatus("請先上傳 PDF");
    return;
  }

  stopSpeech();
  speakCurrentQueue();
}

function pauseSpeech() {
  if (speech && speech.speaking && !speech.paused) {
    speech.pause();
    isPaused = true;
    setStatus("已暫停");
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
    elements.voiceSelect.replaceChildren(new Option("不支援語音合成", ""));
    elements.voiceSelect.disabled = true;
    return;
  }

  voices = prioritizeVoices(speech.getVoices());
  elements.voiceSelect.replaceChildren();

  if (voices.length === 0) {
    const option = new Option("瀏覽器預設語音", "");
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
  elements.saveState.textContent = `已暫存 ${new Date().toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

elements.pdfInput.addEventListener("change", (event) => {
  handlePdfFile(event.target.files[0]);
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
  setStatus("已停止朗讀");
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
