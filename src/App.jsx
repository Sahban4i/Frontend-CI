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
const parseJwt = (t) => { try { return JSON.parse(atob(t.split(".")[1])); } catch { return null; } };

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
  const [tone, setTone] = useState("neutral"); // neutral, formal, casual
  const [format, setFormat] = useState("paragraph"); // paragraph, bullets
  const [tagsInput, setTagsInput] = useState("");
  const [_page, setPage] = useState(1); // renamed to avoid unused var warning
  const [hasMore, setHasMore] = useState(true);
  const [token, setToken] = useState(localStorage.getItem("token"));
  const payload = token ? parseJwt(token) : null;
  const userEmail = payload?.email;
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("login"); // 'login' | 'register'
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const draftSaveTimer = useRef(null);
  const utteranceRef = useRef(null);

  useEffect(() => {
    // load draft from localStorage
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) setNote(saved);
    loadHistoryPaged(true);
  }, []);

  // autosave draft (debounced)
  useEffect(() => {
    clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      if (note.trim()) localStorage.setItem(DRAFT_KEY, note);
      else localStorage.removeItem(DRAFT_KEY);
    }, 600);
    return () => clearTimeout(draftSaveTimer.current);
  }, [note]);

  // cheap helper
  const wordCount = (txt) => (typeof txt === "string" && txt.trim() ? txt.trim().split(/\s+/).length : 0);

  // Copy helper (fix: was undefined)
  const copyToClipboard = async (txt) => {
    try {
      await navigator.clipboard.writeText(txt ?? "");
      setToast("Copied");
    } catch (err) {
      console.error("Copy failed:", err);
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

  const handleAuthSubmit = async (_e) => {
    _e.preventDefault();
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
        alert(res?.message || "Auth failed");
      }
    } catch (err) {
      console.error("Auth error:", err);
      alert("Auth error");
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem("token");
    setToken(null);
  };

  // history loader kept with useCallback so hooks deps are correct
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
      } catch (err) {
        console.error("Failed to load history:", err);
        setHasMore(false);
        setToast("Failed to load");
        setTimeout(() => setToast(null), 1500);
      } finally {
        setHistoryLoading(false);
      }
    },
    [search]
  );

  // initial load
  useEffect(() => {
    loadHistoryPaged(1, true);
  }, [loadHistoryPaged]);

  // search -> reload first page
  useEffect(() => {
    const t = setTimeout(() => loadHistoryPaged(1, true), 300);
    return () => clearTimeout(t);
  }, [search, loadHistoryPaged]);

  // Summarize: allow generating without login, but only save when logged in
  async function handleSummarize() {
    if (note.trim() === "") return alert("Please enter some text!");
    setLoading(true);
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `Summarize the following text in a ${length} length:\n\n${note}`;
      const result = await model.generateContent(prompt);
      const response = await result.response.text();
      setSummary(response);

      // save to backend only if logged in:
      if (!requireAuth()) return;

      const tags = []; // keep your tags logic if you added it
      const tempId = `temp-${Date.now()}`;
      const tempEntry = { _id: tempId, note, summary: response, tags, starred: false, createdAt: new Date().toISOString() };
      setHistory((prev) => [tempEntry, ...prev]);

      try {
        const saved = await summaryAPI.save(note, response, tags);
        setHistory((prev) => prev.map((it) => (it._id === tempId ? saved : it)));
        setToast("Summary saved");
        setTimeout(() => setToast(null), 1000);
        setNote("");
        localStorage.removeItem("ai-summarizer-draft");
      } catch (err) {
        console.error("Save failed:", err);
        setToast("Save failed");
        setTimeout(() => setToast(null), 1500);
      }
    } catch (error) {
      console.error("Summarize error:", error);
      setToast("Summarization failed");
      setTimeout(() => setToast(null), 1500);
    } finally {
      setLoading(false);
    }
  }

  async function extractTextFromPDF(file) {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async () => {
        try {
          const typedArray = new Uint8Array(reader.result);
          const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
          let textContent = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            textContent += content.items.map((s) => s.str).join(" ") + "\n";
          }
          resolve(textContent);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  async function handlePDFUpload(e) {
    const file = e.target.files[0];
    if (file) {
      setPdfLoading(true);
      try {
        const text = await extractTextFromPDF(file);
        setNote(text);
      } catch (error) {
        console.error("PDF Error:", error);
        alert("Failed to extract text from PDF.");
      } finally {
        setPdfLoading(false);
      }
    }
  }

  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
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
    const margin = 40; let y = margin;
    doc.setFontSize(16); doc.text("Summary", margin, y); y += 24;
    doc.setFontSize(12);
    const lines = doc.splitTextToSize(summary, 515);
    lines.forEach((line) => {
      if (y > 780) { doc.addPage(); y = margin; }
      doc.text(line, margin, y); y += 16;
    });
    doc.save("summary.pdf");
  };

  // delete (syntax fixed)
  async function handleDelete(id) {
    if (!requireAuth()) return;
    if (!confirm("Are you sure you want to delete this summary?")) return;
    const backup = history;
    setHistory((prev) => prev.filter((h) => h._id !== id));
    try {
      const res = await summaryAPI.delete(id);
      if (res?.message) setToast("Deleted");
      setTimeout(() => setToast(null), 1200);
    } catch (error) {
      console.error("Failed to delete:", error);
      setHistory(backup);
      setToast("Delete failed");
      setTimeout(() => setToast(null), 2000);
    }
  }

  // open edit modal
  const openEdit = (item) => {
    setEditingItem({ ...item });
  };

  // edit save (reload if API fails)
  const saveEdit = async () => {
    if (!requireAuth() || !editingItem) return;
    const { _id, note: newNote, summary: newSummary, tags, starred } = editingItem;
    setHistory((prev) => prev.map((it) => (it._id === _id ? { ...it, note: newNote, summary: newSummary, tags, starred } : it)));
    setEditingItem(null);
    try {
      await summaryAPI.update(_id, newNote, newSummary, tags, starred);
      setToast("Updated");
      setTimeout(() => setToast(null), 1200);
    } catch (err) {
      console.error("Update failed", err);
      setToast("Update failed");
      setTimeout(() => setToast(null), 2000);
      loadHistoryPaged(1, true);
    }
  };

  // star toggle
  async function toggleStar(item) {
    if (!requireAuth()) return;
    try {
      const updated = await summaryAPI.star(item._id, !item.starred);
      setHistory((prev) => prev.map((it) => (it._id === item._id ? updated : it)));
    } catch (err) {
      console.error("Star toggle failed:", err);
      setToast("Failed to update");
      setTimeout(() => setToast(null), 1200);
    }
  }

  // share link
  async function shareItem(item) {
    if (!requireAuth()) return;
    try {
      const { slug } = await summaryAPI.share(item._id);
      const url = `${window.location.origin}/#/s/${slug}`;
      await navigator.clipboard.writeText(url);
      setToast("Share link copied");
      setTimeout(() => setToast(null), 1200);
    } catch (err) {
      console.error("Share failed:", err);
      setToast("Share failed");
      setTimeout(() => setToast(null), 1200);
    }
  }

  // keyboard shortcut: Ctrl/Cmd + Enter to summarize
  const onTextareaKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSummarize();
    }
  };

  function handleSpeak() {
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
  }

  function restartSpeech() {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setPaused(false);
    setShowResumeOptions(false);
    handleSpeak();
  }

  // Fix: define wordCount used in JSX
  const wordCountDisplay = wordCount(note);

  return (
    <div className="min-h-screen flex flex-col items-center p-6">
      {/* Simple Auth Panel always visible so you can find it even if Tailwind isn't styling */}
      <div style={{ width: "100%", maxWidth: 900, marginBottom: 16 }}>
        {token ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>{userEmail}</span>
            <button onClick={signOut} style={{ padding: "6px 10px", border: "1px solid #ccc", borderRadius: 8 }}>
              Sign out
            </button>
          </div>
        ) : (
          <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button onClick={() => setAuthMode("login")} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ccc" }}>
                Sign in
              </button>
              <button onClick={() => setAuthMode("register")} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ccc" }}>
                Register
              </button>
            </div>
            <form onSubmit={handleAuthSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="Email"
                required
                style={{ flex: "1 1 220px", padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
              />
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Password (min 6)"
                minLength={6}
                required
                style={{ flex: "1 1 220px", padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
              />
              <button type="submit" disabled={authLoading} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ccc" }}>
                {authLoading ? "Please wait..." : authMode === "login" ? "Sign in" : "Register"}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Main Card */}
      <div className="relative bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl p-8 w-full max-w-4xl border border-white/20 hover:shadow-pink-500/20 transition-all duration-500 hover:scale-[1.01]">
        {/* Neon Glow Effect */}
        <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 rounded-3xl blur opacity-20 group-hover:opacity-30 transition duration-1000"></div>
        
        <div className="relative">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-5xl font-black bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 bg-clip-text text-transparent drop-shadow-2xl mb-3 animate-pulse">
              🧠 AI Note Summarizer
            </h1>
            <p className="text-gray-300 text-lg font-light tracking-wide">
              Transform your notes into powerful summaries with AI magic ✨
            </p>
          </div>

          {/* Controls Bar */}
          <div className="flex justify-between items-center mb-6 bg-white/5 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-purple-300">📝 Words:</span>
              <span className="px-3 py-1 bg-gradient-to-r from-pink-500/20 to-purple-500/20 rounded-full text-white font-bold border border-pink-500/30">
                {wordCountDisplay}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-purple-300">Length:</span>
              <select
                value={length}
                onChange={(e) => setLength(e.target.value)}
                className="bg-white/10 backdrop-blur-sm text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-pink-400 border border-white/20 cursor-pointer hover:bg-white/20 transition"
              >
                <option value="short" className="bg-gray-800">Short</option>
                <option value="medium" className="bg-gray-800">Medium</option>
                <option value="detailed" className="bg-gray-800">Detailed</option>
              </select>
            </div>
          </div>

          {/* PDF Upload */}
          <div className="mb-6">
            <label className="block w-full cursor-pointer group">
              <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 backdrop-blur-sm border-2 border-dashed border-purple-400/40 rounded-2xl p-6 text-center hover:border-pink-400/60 hover:bg-white/10 transition-all duration-300">
                <span className="text-purple-300 group-hover:text-pink-300 font-semibold text-lg">
                  📄 Click to upload PDF or drag & drop
                </span>
              </div>
              <input
                type="file"
                accept="application/pdf"
                onChange={handlePDFUpload}
                className="hidden"
              />
            </label>
            {pdfLoading && (
              <p className="text-yellow-300 mt-3 text-center animate-pulse font-semibold">
                ⚡ Extracting magic from your PDF...
              </p>
            )}
          </div>

          {/* Textarea */}
          <textarea
            className="w-full h-48 p-5 rounded-2xl bg-white/5 backdrop-blur-sm text-white placeholder-gray-400 outline-none focus:ring-2 focus:ring-pink-400 border border-white/10 resize-none font-light text-lg leading-relaxed hover:bg-white/10 transition-all"
            placeholder="✍️ Paste your notes here or upload a PDF above..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={onTextareaKeyDown}
          ></textarea>

          {/* Tone, Format, Tags controls */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-4">
            {/* Tone Selector */}
            <div className="flex flex-col">
              <label className="text-sm font-semibold text-purple-300 mb-2">Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="bg-white/10 backdrop-blur-sm text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-pink-400 border border-white/20 cursor-pointer hover:bg-white/20 transition"
              >
                <option value="neutral" className="bg-gray-800">Neutral</option>
                <option value="formal" className="bg-gray-800">Formal</option>
                <option value="casual" className="bg-gray-800">Casual</option>
              </select>
            </div>

            {/* Format Selector */}
            <div className="flex flex-col">
              <label className="text-sm font-semibold text-purple-300 mb-2">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="bg-white/10 backdrop-blur-sm text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-pink-400 border border-white/20 cursor-pointer hover:bg-white/20 transition"
              >
                <option value="paragraph" className="bg-gray-800">Paragraph</option>
                <option value="bullets" className="bg-gray-800">Bullets</option>
              </select>
            </div>

            {/* Tags Input */}
            <div className="flex flex-col">
              <label className="text-sm font-semibold text-purple-300 mb-2">Tags</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="Enter tags, separated by commas"
                className="bg-white/10 backdrop-blur-sm text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-pink-400 border border-white/20"
              />
            </div>
          </div>

          {/* Summarize Button */}
          <button
            onClick={handleSummarize}
            disabled={loading}
            className={`mt-6 w-full py-4 rounded-2xl font-bold text-lg transition-all duration-300 shadow-2xl ${
              loading
                ? "bg-gray-600 cursor-not-allowed"
                : "bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 hover:from-pink-600 hover:via-purple-600 hover:to-blue-600 hover:shadow-pink-500/50 hover:scale-[1.02] active:scale-95"
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⚡</span> Creating Magic...
              </span>
            ) : (
              "✨ Summarize Now"
            )}
          </button>

          {/* Summary Output */}
          {summary && (
            <div className="mt-8 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-lg p-6 rounded-2xl border border-white/20 animate-fade-in shadow-xl">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-pink-300 to-purple-300 bg-clip-text text-transparent">
                  🎯 Your Summary
                </h2>
                <div className="flex gap-3">
                  <button
                    onClick={handleSpeak}
                    className={`${
                      isSpeaking
                        ? "bg-gradient-to-r from-red-500 to-pink-500"
                        : "bg-gradient-to-r from-purple-500 to-pink-500"
                    } text-white px-4 py-2 rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg font-semibold`}
                  >
                    {isSpeaking ? "⏸ Pause" : "🔊 Listen"}
                  </button>
                  <button
                    onClick={downloadAsPDF}
                    className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white px-4 py-2 rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg font-semibold"
                  >
                    ⬇️ Save PDF
                  </button>
                </div>
              </div>

              {showResumeOptions && (
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={restartSpeech}
                    className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white px-4 py-2 rounded-xl transition-all hover:scale-105 shadow-lg font-semibold"
                  >
                    🔁 Restart
                  </button>
                  <button
                    onClick={handleSpeak}
                    className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-4 py-2 rounded-xl transition-all hover:scale-105 shadow-lg font-semibold"
                  >
                    ▶️ Continue
                  </button>
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button onClick={() => copyToClipboard(summary)} className="bg-blue-500 text-white px-4 py-2 rounded-xl">📋 Copy</button>
                <button onClick={() => { navigator.clipboard.writeText(note); setToast("Note copied"); setTimeout(()=>setToast(null), 1200); }} className="bg-gray-700 text-white px-4 py-2 rounded-xl">✏️ Copy Note</button>
                <button onClick={exportTxt} className="bg-gray-700 text-white px-4 py-2 rounded-xl">Export .txt</button>
                <button onClick={exportMd} className="bg-gray-700 text-white px-4 py-2 rounded-xl">Export .md</button>
                <button onClick={exportPdf} className="bg-gray-700 text-white px-4 py-2 rounded-xl">Export .pdf</button>
              </div>

              <p className="text-gray-100 leading-relaxed text-lg font-light">{summary}</p>
            </div>
          )}
        </div>
      </div>

      {/* History Section */}
      {history.length > 0 && (
        <div className="relative mt-10 bg-white/10 backdrop-blur-xl p-8 rounded-3xl w-full max-w-4xl border border-white/20 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-pink-300 to-purple-300 bg-clip-text text-transparent">🕒 Summary History</h2>
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); /* optional live server search: loadHistory(e.target.value) */}}
                placeholder="Search history..."
                className="px-3 py-2 rounded-lg bg-white/5 text-white outline-none border border-white/10"
              />
              <button onClick={() => { setSearch(""); loadHistoryPaged(1, true); }} className="px-3 py-2 rounded-lg bg-purple-600 text-white">Reset</button>
            </div>
          </div>

          {historyLoading ? (
            <p className="text-center text-gray-300 animate-pulse">Loading your history...</p>
          ) : (
            <>
              <ul className="space-y-4 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                {history.map((item) => (
                  <li key={item._id} className="bg-white/5 backdrop-blur-sm p-5 rounded-2xl border border-white/10 hover:bg-white/10 hover:border-pink-400/30 transition-all duration-300 hover:scale-[1.01] group">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm text-purple-300 mb-2 font-semibold">📝 Note:</p>
                          <div className="flex gap-2">
                            <button onClick={() => toggleStar(item)} className={`text-sm px-2 py-1 rounded-md ${item.starred ? "bg-yellow-500/90" : "bg-gray-800/60"}`}>
                              {item.starred ? "★ Starred" : "☆ Star"}
                            </button>
                            <button onClick={() => shareItem(item)} className="text-sm px-2 py-1 bg-blue-600/80 rounded-md">Share</button>
                            <button onClick={() => copyToClipboard(item.summary)} className="text-sm px-2 py-1 bg-gray-800/60 rounded-md">Copy</button>
                          </div>
                        </div>
                        <p className="text-gray-300 mb-3 text-sm line-clamp-2">{item.note.slice(0, 200)}{item.note.length > 200 ? "..." : ""}</p>
                        <p className="text-sm text-pink-300 mb-2 font-semibold">✨ Summary:</p>
                        <p className="text-gray-100 text-sm leading-relaxed">{item.summary}</p>
                      </div>
                      <button onClick={(_e) => handleDelete(item._id)} className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white px-3 py-2 rounded-xl transition-all hover:scale-110 active:scale-95 shadow-lg opacity-100 font-semibold">🗑️</button>
                    </div>
                    {item.tags?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.tags.map(t => <span key={t} className="text-xs bg-white/10 border border-white/10 rounded-full px-2 py-1">{t}</span>)}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <button onClick={() => loadHistoryPaged(false)} className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white">
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white/5 backdrop-blur-lg p-6 rounded-xl w-full max-w-2xl border border-white/20">
            <h3 className="text-xl mb-3 font-bold">Edit Summary</h3>
            <textarea className="w-full h-32 p-3 rounded mb-3 bg-white/5 text-white outline-none" value={editingItem.note} onChange={(e) => setEditingItem({ ...editingItem, note: e.target.value })}></textarea>
            <textarea className="w-full h-32 p-3 rounded mb-3 bg-white/5 text-white outline-none" value={editingItem.summary} onChange={(e) => setEditingItem({ ...editingItem, summary: e.target.value })}></textarea>
            <div className="flex justify-end gap-3">
              <button onClick={() => setEditingItem(null)} className="px-4 py-2 rounded bg-gray-600">Cancel</button>
              <button onClick={saveEdit} className="px-4 py-2 rounded bg-green-500">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {showAuth && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <form onSubmit={handleAuthSubmit} className="bg-white/10 backdrop-blur-xl p-6 rounded-2xl w-full max-w-md border border-white/20">
            <h3 className="text-xl font-bold text-white mb-4">{authMode === "login" ? "Sign in" : "Create account"}</h3>
            <input
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="Email"
              className="w-full mb-3 px-3 py-2 rounded bg-white/5 text-white border border-white/10"
              required
            />
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="Password"
              className="w-full mb-4 px-3 py-2 rounded bg-white/5 text-white border border-white/10"
              minLength={6}
              required
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAuth(false)} className="px-3 py-2 rounded bg-gray-600 text-white">Cancel</button>
              <button type="submit" disabled={authLoading} className="px-3 py-2 rounded bg-purple-600 text-white">
                {authLoading ? "Please wait..." : authMode === "login" ? "Sign in" : "Register"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-8 text-gray-400 text-sm font-light">
        Made with <span className="text-pink-400">❤️</span> using React, Tailwind, Gemini AI & MongoDB
      </footer>

      <style>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
        .animate-fade-in {
          animation: fadeIn 0.5s ease-in;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, #ec4899, #8b5cf6);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to bottom, #db2777, #7c3aed);
        }
      `}</style>
    </div>
  );
}

export default App;