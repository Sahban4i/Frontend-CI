import React, { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { summaryAPI, authAPI } from "./api";
import { jsPDF } from "jspdf";
import "./index.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
const parseJwt = (token) => {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch (_err) {
    return null;
  }
};

function App() {
  const DRAFT_KEY = "ai-summarizer-draft";
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [length, setLength] = useState("medium");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showResumeOptions, setShowResumeOptions] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [tone, setTone] = useState("neutral");
  const [format, setFormat] = useState("paragraph");
  const [tagsInput, setTagsInput] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [token, setToken] = useState(localStorage.getItem("token"));
  const payload = token ? parseJwt(token) : null;
  const userEmail = payload?.email;
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const draftSaveTimer = useRef(null);
  const utteranceRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) setNote(saved);
  }, []);

  useEffect(() => {
    clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      if (note.trim()) {
        localStorage.setItem(DRAFT_KEY, note);
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    }, 600);
    return () => clearTimeout(draftSaveTimer.current);
  }, [note]);

  const wordCount = (value) => {
    if (typeof value !== "string" || !value.trim()) return 0;
    return value.trim().split(/\s+/).length;
  };

  const copyToClipboard = async (value) => {
    try {
      await navigator.clipboard.writeText(value ?? "");
      setToast("Copied");
    } catch (err) {
      console.error("Copy failed", err);
      setToast("Copy failed");
    } finally {
      setTimeout(() => setToast(null), 1200);
    }
  };

  const requireAuth = () => {
    if (!token) {
      setShowAuth(true);
      return false;
    }
    return true;
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthLoading(true);
    try {
      const api = authMode === "login" ? authAPI.login : authAPI.register;
      const res = await api(authEmail, authPassword);
      if (res?.token) {
        localStorage.setItem("token", res.token);
        setToken(res.token);
        setShowAuth(false);
        setAuthEmail("");
        setAuthPassword("");
      } else {
        alert(res?.message || "Authentication failed");
      }
    } catch (error) {
      console.error("Auth error", error);
      alert("Auth error");
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem("token");
    setToken(null);
  };

  const loadHistoryPaged = useCallback(
    async (pageToLoad = 1, reset = false) => {
      try {
        const data = await summaryAPI.getAll({ q: search, page: pageToLoad, limit: 10, sort: "-createdAt" });
        const items = Array.isArray(data) ? data : data.items;
        setHistory((prev) => (reset ? items : [...prev, ...items]));
        if (!Array.isArray(data)) {
          setHasMore(pageToLoad < data.pages);
          setPage(pageToLoad + 1);
        } else {
          setHasMore(false);
        }
      } catch (error) {
        console.error("Failed to load history", error);
        setHasMore(false);
        setToast("Failed to load history");
        setTimeout(() => setToast(null), 1500);
      } finally {
        setHistoryLoading(false);
      }
    },
    [search]
  );

  useEffect(() => {
    setHistoryLoading(true);
    loadHistoryPaged(1, true);
  }, [loadHistoryPaged]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setHistoryLoading(true);
      loadHistoryPaged(1, true);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, loadHistoryPaged]);

  const deriveTags = () =>
    tagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

  const handleSummarize = async () => {
    if (note.trim() === "") {
      alert("Please enter some text");
      return;
    }
    setLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `Summarize the following text in a ${length} length with a ${tone} tone and ${format} format.\n\n${note}`;
      const result = await model.generateContent(prompt);
      const response = await result.response.text();
      setSummary(response);

      if (!requireAuth()) return;

      const tags = deriveTags();
      const tempId = `temp-${Date.now()}`;
      const tempEntry = {
        _id: tempId,
        note,
        summary: response,
        tags,
        starred: false,
        createdAt: new Date().toISOString(),
      };
      setHistory((prev) => [tempEntry, ...prev]);

      try {
        const saved = await summaryAPI.save(note, response, tags);
        setHistory((prev) => prev.map((item) => (item._id === tempId ? saved : item)));
        setToast("Summary saved");
        setTimeout(() => setToast(null), 1000);
        setNote("");
        setSummary(response);
        setTagsInput("");
        localStorage.removeItem(DRAFT_KEY);
      } catch (error) {
        console.error("Save failed", error);
        setToast("Save failed");
        setTimeout(() => setToast(null), 1500);
      }
    } catch (error) {
      console.error("Summarization failed", error);
      setToast("Summarization failed");
      setTimeout(() => setToast(null), 1500);
    } finally {
      setLoading(false);
    }
  };

  const extractTextFromPDF = async (file) => {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async () => {
        try {
          const typedArray = new Uint8Array(reader.result);
          const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
          let textContent = "";
          for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
            const pageData = await pdf.getPage(pageIndex);
            const content = await pageData.getTextContent();
            textContent += content.items.map((item) => item.str).join(" ") + "\n";
          }
          resolve(textContent);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const handlePDFUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPdfLoading(true);
    try {
      const text = await extractTextFromPDF(file);
      setNote(text);
      setToast("PDF text extracted");
      setTimeout(() => setToast(null), 1200);
    } catch (error) {
      console.error("PDF extraction failed", error);
      alert("Failed to extract text from PDF");
    } finally {
      setPdfLoading(false);
    }
  };

  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportTxt = () => {
    const blob = new Blob([summary], { type: "text/plain;charset=utf-8" });
    download(blob, "summary.txt");
  };

  const exportMd = () => {
    const md = `# Summary\n\n## Note\n\n${note}\n\n---\n\n## Summary\n\n${summary}\n`;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    download(blob, "summary.md");
  };

  const exportPdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    let y = margin;
    doc.setFontSize(16);
    doc.text("Summary", margin, y);
    y += 24;
    doc.setFontSize(12);
    const lines = doc.splitTextToSize(summary, 515);
    lines.forEach((line) => {
      if (y > 780) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 16;
    });
    doc.save("summary.pdf");
  };

  const handleDelete = async (id) => {
    if (!requireAuth()) return;
    if (!confirm("Delete this summary?")) return;
    const backup = history;
    setHistory((prev) => prev.filter((item) => item._id !== id));
    try {
      const res = await summaryAPI.delete(id);
      if (res?.message) {
        setToast("Deleted");
        setTimeout(() => setToast(null), 1200);
      }
    } catch (error) {
      console.error("Delete failed", error);
      setHistory(backup);
      setToast("Delete failed");
      setTimeout(() => setToast(null), 1500);
    }
  };

  const openEdit = (item) => {
    setEditingItem({ ...item });
  };

  const saveEdit = async () => {
    if (!requireAuth() || !editingItem) return;
    const { _id, note: nextNote, summary: nextSummary, tags, starred } = editingItem;
    setHistory((prev) => prev.map((item) => (item._id === _id ? { ...item, note: nextNote, summary: nextSummary, tags, starred } : item)));
    setEditingItem(null);
    try {
      await summaryAPI.update(_id, nextNote, nextSummary, tags, starred);
      setToast("Updated");
      setTimeout(() => setToast(null), 1200);
    } catch (error) {
      console.error("Update failed", error);
      setToast("Update failed");
      setTimeout(() => setToast(null), 1500);
      loadHistoryPaged(1, true);
    }
  };

  const toggleStar = async (item) => {
    if (!requireAuth()) return;
    try {
      const updated = await summaryAPI.star(item._id, !item.starred);
      setHistory((prev) => prev.map((entry) => (entry._id === item._id ? updated : entry)));
    } catch (error) {
      console.error("Star update failed", error);
      setToast("Failed to update");
      setTimeout(() => setToast(null), 1200);
    }
  };

  const shareItem = async (item) => {
    if (!requireAuth()) return;
    try {
      const { slug } = await summaryAPI.share(item._id);
      const url = `${window.location.origin}/#/s/${slug}`;
      await navigator.clipboard.writeText(url);
      setToast("Share link copied");
      setTimeout(() => setToast(null), 1200);
    } catch (error) {
      console.error("Share failed", error);
      setToast("Share failed");
      setTimeout(() => setToast(null), 1200);
    }
  };

  const onTextareaKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      handleSummarize();
    }
  };

  const handleSpeak = () => {
    const synth = window.speechSynthesis;
    if (isSpeaking) {
      synth.pause();
      setIsSpeaking(false);
      setPaused(true);
      setShowResumeOptions(true);
      return;
    }
    if (paused && utteranceRef.current) {
      synth.resume();
      setIsSpeaking(true);
      setPaused(false);
      setShowResumeOptions(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(summary);
    utterance.rate = 1.1;
    utterance.pitch = 1;
    utterance.onend = () => {
      setIsSpeaking(false);
      setPaused(false);
      setShowResumeOptions(false);
    };
    utteranceRef.current = utterance;
    synth.speak(utterance);
    setIsSpeaking(true);
    setShowResumeOptions(false);
  };

  const restartSpeech = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setPaused(false);
    setShowResumeOptions(false);
    handleSpeak();
  };

  const wordCountDisplay = wordCount(note);

  const navItems = [
    { label: "Paraphraser" },
    { label: "Summarizer", active: true },
    { label: "AI Chat" },
    { label: "Grammar" },
    { label: "Plagiarism" },
    { label: "Citation" },
  ];

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-emerald-50 via-white to-sky-50 text-slate-800">
      <aside className="hidden w-64 flex-col border-r border-emerald-100 bg-emerald-50/60 px-6 py-10 lg:flex">
        <h2 className="mb-8 text-lg font-semibold text-emerald-600">Workspace</h2>
        <nav className="flex flex-col gap-2">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold transition ${
                item.active
                  ? "bg-emerald-500 text-white shadow"
                  : "text-emerald-700 hover:bg-emerald-100 hover:text-emerald-600"
              }`}
            >
              <span>{item.label}</span>
              {item.active ? <span className="text-xs uppercase">Live</span> : null}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-emerald-500">Tip</p>
          <p className="mt-2 text-sm text-slate-600">Upload lecture slides as PDF to get structured study notes in seconds.</p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="border-b border-emerald-100 bg-white/90 shadow-sm backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-white">
                QB
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">Sahban Summaries</p>
                <p className="text-xl font-semibold text-slate-800">AI Summarizer</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {token ? (
                <>
                  <div className="hidden text-right text-sm sm:block">
                    <p className="font-medium text-slate-700">{userEmail}</p>
                    <button onClick={signOut} type="button" className="text-xs font-semibold text-emerald-600 underline underline-offset-4">
                      Sign out
                    </button>
                  </div>
                  <button
                    onClick={signOut}
                    type="button"
                    className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-600 sm:hidden"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowAuth(true)}
                  type="button"
                  className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600"
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <section className="bg-gradient-to-b from-white to-emerald-50/60">
            <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-12 lg:flex-row lg:items-center">
              <div className="flex-1 space-y-4">
                <h1 className="text-4xl font-semibold text-slate-900 sm:text-5xl">Free AI Summarizer</h1>
                <p className="text-lg text-slate-600">Condense articles, reports, and study material into clear takeaways instantly. Paste text or upload a PDF, choose your tone, and let the AI deliver key points while preserving context.</p>
                <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                    <p className="font-semibold text-emerald-600">Instant results</p>
                    <p className="mt-1 text-slate-500">Gemini Flash condenses long-form content in seconds.</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                    <p className="font-semibold text-emerald-600">Flexible outputs</p>
                    <p className="mt-1 text-slate-500">Switch between paragraph and bullet formats anytime.</p>
                  </div>
                </div>
              </div>

              <div className="w-full max-w-xl">
                <div className="rounded-3xl border border-emerald-100 bg-white p-8 shadow-xl">
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">Current session</p>
                      <p className="text-2xl font-semibold text-slate-900">Summarizer</p>
                    </div>
                    <div className="rounded-full bg-emerald-100 px-4 py-1 text-sm font-semibold text-emerald-600">
                      {wordCountDisplay} words
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Length</span>
                      <select
                        value={length}
                        onChange={(event) => setLength(event.target.value)}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 outline-none transition hover:border-emerald-300"
                      >
                        <option value="short">Short</option>
                        <option value="medium">Medium</option>
                        <option value="detailed">Detailed</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Tone</span>
                      <select
                        value={tone}
                        onChange={(event) => setTone(event.target.value)}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 outline-none transition hover:border-emerald-300"
                      >
                        <option value="neutral">Neutral</option>
                        <option value="formal">Formal</option>
                        <option value="casual">Casual</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Format</span>
                      <select
                        value={format}
                        onChange={(event) => setFormat(event.target.value)}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 outline-none transition hover:border-emerald-300"
                      >
                        <option value="paragraph">Paragraph</option>
                        <option value="bullets">Bullets</option>
                      </select>
                    </div>
                  </div>

                  <label className="mt-6 block cursor-pointer rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 px-6 py-6 text-center text-sm text-emerald-600 transition hover:border-emerald-300 hover:bg-emerald-100">
                    <input type="file" accept="application/pdf" onChange={handlePDFUpload} className="hidden" />
                    <p className="text-lg font-semibold text-emerald-700">Paste or upload</p>
                    <p className="mt-1 text-slate-500">Drop your PDF here or click to browse</p>
                    {pdfLoading && <p className="mt-3 text-sm font-semibold text-emerald-600">Extracting text...</p>}
                  </label>

                  <textarea
                    className="mt-6 h-40 w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-slate-700 shadow-inner outline-none transition focus:border-emerald-400 focus:bg-white"
                    placeholder="Paste your content here and press Summarize"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    onKeyDown={onTextareaKeyDown}
                  />

                  <div className="mt-4">
                    <label className="text-sm font-semibold text-emerald-700">Tags</label>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(event) => setTagsInput(event.target.value)}
                      placeholder="research, finals, client update"
                      className="mt-2 w-full rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-400"
                    />
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                    <span>Ctrl/Cmd + Enter to summarize</span>
                    <span className="font-semibold text-emerald-600">Free plan</span>
                  </div>

                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={handleSummarize}
                      disabled={loading}
                      className={`flex-1 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-600 ${
                        loading ? "cursor-not-allowed opacity-70" : ""
                      }`}
                    >
                      {loading ? "Summarizing..." : "Summarize"}
                    </button>
                    {summary && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(summary)}
                        className="rounded-xl border border-emerald-200 px-5 py-3 text-sm font-semibold text-emerald-600 transition hover:border-emerald-300 hover:bg-emerald-50"
                      >
                        Copy
                      </button>
                    )}
                  </div>

                  {summary && (
                    <div className="mt-6 space-y-4 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold text-emerald-700">Summary</p>
                          <p className="text-xs text-slate-500">Listen, edit, or export below</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={handleSpeak}
                            className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition ${
                              isSpeaking ? "bg-rose-500 hover:bg-rose-600" : "bg-emerald-500 hover:bg-emerald-600"
                            }`}
                          >
                            {isSpeaking ? "Pause audio" : "Listen"}
                          </button>
                          <button onClick={exportPdf} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
                            Download PDF
                          </button>
                        </div>
                      </div>

                      {showResumeOptions && (
                        <div className="flex gap-3">
                          <button onClick={restartSpeech} className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
                            Restart
                          </button>
                          <button onClick={handleSpeak} className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
                            Continue
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 text-sm">
                        <button onClick={exportTxt} className="rounded-full border border-emerald-200 px-3 py-1 text-emerald-600 transition hover:border-emerald-300">
                          Export TXT
                        </button>
                        <button onClick={exportMd} className="rounded-full border border-emerald-200 px-3 py-1 text-emerald-600 transition hover:border-emerald-300">
                          Export MD
                        </button>
                        <button onClick={exportPdf} className="rounded-full border border-emerald-200 px-3 py-1 text-emerald-600 transition hover:border-emerald-300">
                          Export PDF
                        </button>
                      </div>

                      <p className="text-sm leading-relaxed text-slate-700">{summary}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="border-t border-b border-emerald-100 bg-white">
            <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">Trusted tools</p>
                <h2 className="mt-2 text-3xl font-semibold text-slate-900">Featured in classrooms, clinics, and consulting teams</h2>
                <p className="mt-3 text-sm text-slate-600">Keep your workflow familiar with a clean workspace, smart defaults, and one-click exports for PDF, TXT, or Markdown.</p>
              </div>
              <div className="grid flex-1 gap-3 text-sm text-slate-600 sm:grid-cols-2">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="font-semibold text-emerald-600">Save time</p>
                  <p className="mt-1 text-slate-500">Average summaries appear in under five seconds.</p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="font-semibold text-emerald-600">Stay organized</p>
                  <p className="mt-1 text-slate-500">Search and star important recaps for quick revisits.</p>
                </div>
              </div>
            </div>
          </section>

          {history.length > 0 && (
            <section id="history-section" className="bg-gradient-to-b from-white to-emerald-50/60">
              <div className="mx-auto max-w-6xl px-6 py-12">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">Saved work</p>
                    <h2 className="mt-2 text-3xl font-semibold text-slate-900">Summary history</h2>
                    <p className="mt-1 text-sm text-slate-600">Return to previous recaps anytime, export again, or fine-tune the copy.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search summaries"
                      className="rounded-full border border-emerald-200 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-400"
                    />
                    <button
                      onClick={() => {
                        setSearch("");
                        setHistoryLoading(true);
                        loadHistoryPaged(1, true);
                      }}
                      className="rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-600 transition hover:border-emerald-300 hover:bg-emerald-50"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="mt-8 rounded-3xl border border-emerald-100 bg-white p-6 shadow">
                  {historyLoading ? (
                    <p className="text-center text-sm text-slate-500">Loading your history...</p>
                  ) : (
                    <>
                      <ul className="space-y-4">
                        {history.map((item) => (
                          <li key={item._id} className="rounded-2xl border border-emerald-100 p-5 shadow-sm transition hover:border-emerald-300 hover:shadow">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500">
                                  <span>Note</span>
                                  <span className="hidden sm:inline-block">-</span>
                                  <span className="text-slate-500">{new Date(item.createdAt).toLocaleString()}</span>
                                </div>
                                <p className="line-clamp-2 text-sm text-slate-600">{item.note.slice(0, 240)}{item.note.length > 240 ? "..." : ""}</p>
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500">Summary</p>
                                    <button onClick={() => openEdit(item)} className="text-xs font-semibold text-emerald-600">Edit</button>
                                  </div>
                                  <p className="text-sm leading-relaxed text-slate-700">{item.summary}</p>
                                </div>
                                {item.tags?.length ? (
                                  <div className="flex flex-wrap gap-2">
                                    {item.tags.map((tag) => (
                                      <span key={tag} className="rounded-full border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-600">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => toggleStar(item)}
                                  className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                                    item.starred
                                      ? "bg-amber-100 text-amber-600"
                                      : "border border-emerald-200 text-emerald-600 hover:border-emerald-300"
                                  }`}
                                >
                                  {item.starred ? "Starred" : "Star"}
                                </button>
                                <button
                                  onClick={() => shareItem(item)}
                                  className="rounded-full border border-emerald-200 px-3 py-1 text-sm font-semibold text-emerald-600 transition hover:border-emerald-300"
                                >
                                  Share
                                </button>
                                <button
                                  onClick={() => copyToClipboard(item.summary)}
                                  className="rounded-full border border-emerald-200 px-3 py-1 text-sm font-semibold text-emerald-600 transition hover:border-emerald-300"
                                >
                                  Copy
                                </button>
                                <button
                                  onClick={() => handleDelete(item._id)}
                                  className="rounded-full bg-rose-500 px-3 py-1 text-sm font-semibold text-white transition hover:bg-rose-600"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                      {hasMore && (
                        <div className="mt-6 flex justify-center">
                          <button
                            onClick={() => loadHistoryPaged(page, false)}
                            className="rounded-full border border-emerald-200 px-5 py-2 text-sm font-semibold text-emerald-600 transition hover:border-emerald-300 hover:bg-emerald-50"
                          >
                            Load more
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </section>
          )}
        </main>

        <footer className="border-t border-emerald-100 bg-white/90">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>Built with React, Tailwind, Gemini AI, and a secure MERN backend.</p>
            <p>Copyright {new Date().getFullYear()} Sahban Summaries</p>
          </div>
        </footer>
      </div>

      {toast && (
        <div className="fixed right-6 top-6 z-50 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-2xl space-y-4 rounded-3xl border border-emerald-100 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-slate-900">Edit summary</h3>
              <button onClick={() => setEditingItem(null)} className="text-sm font-semibold text-slate-500">Close</button>
            </div>
            <textarea
              className="h-32 w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-400"
              value={editingItem.note}
              onChange={(event) => setEditingItem({ ...editingItem, note: event.target.value })}
            />
            <textarea
              className="h-32 w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-400"
              value={editingItem.summary}
              onChange={(event) => setEditingItem({ ...editingItem, summary: event.target.value })}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingItem(null)} className="rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-600 transition hover:border-emerald-300 hover:bg-emerald-50">
                Cancel
              </button>
              <button onClick={saveEdit} className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600">
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuth && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <form onSubmit={handleAuthSubmit} className="w-full max-w-md space-y-4 rounded-3xl border border-emerald-100 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-slate-900">{authMode === "login" ? "Sign in" : "Create account"}</h3>
              <button
                type="button"
                onClick={() => setAuthMode((mode) => (mode === "login" ? "register" : "login"))}
                className="text-sm font-semibold text-emerald-600"
              >
                {authMode === "login" ? "Need an account?" : "Have an account?"}
              </button>
            </div>
            <input
              type="email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              placeholder="Email"
              className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-400"
              required
            />
            <input
              type="password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="Password"
              minLength={6}
              className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-400"
              required
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAuth(false)} className="rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-600 transition hover:border-emerald-300 hover:bg-emerald-50">
                Cancel
              </button>
              <button type="submit" disabled={authLoading} className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600">
                {authLoading ? "Please wait..." : authMode === "login" ? "Sign in" : "Register"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
