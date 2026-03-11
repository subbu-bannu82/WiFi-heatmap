import { useState, useRef, useEffect, useCallback } from "react";

const AP_CONFIGS = {
  "Indoor Standard":    { txPower: 20, color: "#00ff88" },
  "Indoor High Power":  { txPower: 28, color: "#00cfff" },
  "Small Office":       { txPower: 15, color: "#ff66cc" },
  "Outdoor Long Range": { txPower: 36, color: "#ffaa00" },
};
const FREQ = { "2.4 GHz": 1.0, "5 GHz": 0.65, "6 GHz": 0.45 };

function calcSignal(px, py, aps, scale, pen) {
  let best = -Infinity;
  for (const ap of aps) {
    const d = Math.sqrt(((px - ap.x) / scale) ** 2 + ((py - ap.y) / scale) ** 2);
    if (d < 0.1) return 0;
    let s = AP_CONFIGS[ap.type].txPower - 20 * Math.log10(d + 1) - 8;
    s *= pen;
    if (s > best) best = s;
  }
  return best;
}

function toColor(s) {
  if (s < -62) return null;
  const t = Math.max(0, Math.min(1, (s + 62) / 62));
  if (t < 0.3) return `rgba(220,50,0,${0.45 + t * 0.5})`;
  if (t < 0.6) return `rgba(220,200,0,0.72)`;
  return `rgba(0,${Math.round(160 + 80 * ((t - 0.6) / 0.4))},80,0.72)`;
}

function sigLabel(s) {
  if (s < -70) return ["No Signal", "#ff4444"];
  if (s < -62) return ["Weak",      "#ff8800"];
  if (s < -50) return ["Fair",      "#ffdd00"];
  if (s < -35) return ["Good",      "#88ff44"];
  return             ["Excellent",  "#00ffcc"];
}

const RES = 7;

export default function App() {
  const heatRef = useRef(), apRef = useRef(), fileRef = useRef();
  const [img,     setImg]     = useState(null);
  const [sz,      setSz]      = useState({ w: 820, h: 500 });
  const [aps,     setAps]     = useState([]);
  const [mode,    setMode]    = useState("ap");
  const [apType,  setApType]  = useState("Indoor Standard");
  const [freq,    setFreq]    = useState("5 GHz");
  const [scale,   setScale]   = useState(10);
  const [hover,   setHover]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [status,  setStatus]  = useState("");
  const [report,  setReport]  = useState(null);
  const [showHM,  setShowHM]  = useState(true);
  const [tab,     setTab]     = useState("map");
  const [wallSt,  setWallSt]  = useState(null);
  const [walls,   setWalls]   = useState([]);

  /* ── draw heatmap ── */
  useEffect(() => {
    const cv = heatRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!showHM || aps.length === 0) return;
    const pen = FREQ[freq];
    for (let py = 0; py < cv.height; py += RES)
      for (let px = 0; px < cv.width; px += RES) {
        const c = toColor(calcSignal(px, py, aps, scale, pen));
        if (c) { ctx.fillStyle = c; ctx.fillRect(px, py, RES, RES); }
      }
  }, [aps, freq, scale, showHM, sz]);

  /* ── draw AP overlay ── */
  useEffect(() => {
    const cv = apRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    walls.forEach(w => {
      ctx.fillStyle = "rgba(255,80,80,0.22)";
      ctx.strokeStyle = "#ff5050"; ctx.lineWidth = 2;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeRect(w.x, w.y, w.w, w.h);
    });
    aps.forEach((ap, i) => {
      const col = AP_CONFIGS[ap.type].color;
      ctx.beginPath(); ctx.arc(ap.x, ap.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = col + "22"; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
      for (let r = 1; r <= 3; r++) {
        ctx.beginPath();
        ctx.arc(ap.x, ap.y, r * 5, Math.PI * 1.15, Math.PI * 1.85);
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`AP${i + 1}`, ap.x, ap.y + 26);
    });
  }, [aps, walls]);

  /* ── file upload → AI analysis ── */
  const handleFile = useCallback(async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setLoading(true); setStatus("File చదువుతున్నాం..."); setAps([]); setWalls([]);
    try {
      const isPDF  = file.type === "application/pdf";
      const ab     = await file.arrayBuffer();
      const b64    = btoa(String.fromCharCode(...new Uint8Array(ab)));

      // For images — also show preview
      if (!isPDF) {
        const url = URL.createObjectURL(file);
        await new Promise(res => {
          const im = new Image();
          im.onload = () => {
            let w = im.width, h = im.height;
            const maxW = 820, maxH = 520;
            if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
            if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
            setSz({ w, h }); setImg(url); res();
          };
          im.src = url;
        });
      } else {
        setSz({ w: 820, h: 520 });
        setImg(null);
      }

      setStatus("🤖 AI floor plan analyze చేస్తోంది...");

      const content = isPDF
        ? [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text",     text: buildPrompt(820, 520) }
          ]
        : [
            { type: "image",    source: { type: "base64", media_type: file.type,          data: b64 } },
            { type: "text",     text: buildPrompt(sz.w, sz.h) }
          ];

      const res  = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{ role: "user", content }]
        })
      });
      const data  = await res.json();
      const text  = data.content.map(i => i.text || "").join("");
      const clean = text.replace(/```json|```/g, "").trim();
      const out   = JSON.parse(clean);

      setWalls((out.walls || []).map(w => ({
        x: Math.max(0, w.x), y: Math.max(0, w.y),
        w: Math.max(8, w.w), h: Math.max(8, w.h)
      })));
      setAps((out.aps || []).map(ap => ({
        x:      Math.min(819, Math.max(10, ap.x)),
        y:      Math.min(519, Math.max(10, ap.y)),
        type:   AP_CONFIGS[ap.type] ? ap.type : "Indoor Standard",
        reason: ap.reason || ""
      })));
      setReport(out.report || null);
      setStatus(`✅ AI ${(out.aps || []).length} APs place చేసింది! Coverage ≈ ${out.report?.coverage || "~90%"}`);
    } catch (err) {
      console.error(err);
      setStatus("⚠ Analyze చేయలేకపోయాం. మళ్ళీ try చేయండి.");
    }
    setLoading(false);
  }, [sz]);

  function buildPrompt(w, h) {
    return `You are a professional WiFi network planning engineer.
Analyze this floor plan. Canvas: ${w}x${h}px. Scale: ${scale}px per meter.
Area: ${Math.round(w/scale)}m × ${Math.round(h/scale)}m.

Identify rooms, walls, corridors. Place APs for full coverage with NO dead zones.
Only use these AP types: "Indoor Standard", "Indoor High Power", "Small Office", "Outdoor Long Range".

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "walls": [{"x":<px>,"y":<px>,"w":<px>,"h":<px>}],
  "aps":   [{"x":<px>,"y":<px>,"type":"Indoor Standard","reason":"<why>"}],
  "report": {
    "summary":         "<2-3 sentence analysis>",
    "apCount":         <number>,
    "coverage":        "<e.g. 94%>",
    "recommendations": ["<tip1>","<tip2>","<tip3>"]
  }
}`;
  }

  /* ── canvas interaction ── */
  const onCanvasClick = useCallback((e) => {
    const r = apRef.current.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (mode === "ap") {
      setAps(p => [...p, { x, y, type: apType, reason: "Manual" }]);
    } else if (mode === "wall") {
      if (!wallSt) { setWallSt({ x, y }); }
      else {
        setWalls(p => [...p, {
          x: Math.min(wallSt.x, x), y: Math.min(wallSt.y, y),
          w: Math.max(8, Math.abs(x - wallSt.x)),
          h: Math.max(8, Math.abs(y - wallSt.y))
        }]);
        setWallSt(null);
      }
    }
  }, [mode, apType, wallSt]);

  const onMouseMove = useCallback((e) => {
    if (!aps.length) return;
    const r = apRef.current.getBoundingClientRect();
    setHover(calcSignal(e.clientX - r.left, e.clientY - r.top, aps, scale, FREQ[freq]));
  }, [aps, scale, freq]);

  const [hl, hc] = hover !== null ? sigLabel(hover) : ["—", "#888"];
  const cw = sz.w, ch = sz.h;

  /* ══════════════════════ RENDER ══════════════════════ */
  return (
    <div style={S.page}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 9, letterSpacing: 6, color: "#4488bb", marginBottom: 3 }}>◈ AI-POWERED ◈</div>
        <h1 style={S.title}>WiFi HEAT MAP PLANNER</h1>
        <div style={{ fontSize: 10, color: "#4488bb", letterSpacing: 2 }}>
          PDF లేదా Image upload చేయండి → AI layout చదివి AP positions పెట్టి heat map generate చేస్తుంది
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", justifyContent: "center", gap: 0, marginBottom: 16 }}>
        <button className={`tab ${tab === "map" ? "on" : ""}`}
          style={{ borderRadius: "6px 0 0 6px" }} onClick={() => setTab("map")}>🗺 HEAT MAP</button>
        <button className={`tab ${tab === "rep" ? "on" : ""}`}
          style={{ borderRadius: "0 6px 6px 0", borderLeft: "none" }} onClick={() => setTab("rep")}>📋 AI REPORT</button>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>

        {/* ── SIDEBAR ── */}
        <div style={S.sidebar}>
          <div style={S.sLabel}>◈ UPLOAD FLOOR PLAN</div>

          <div style={S.uploadBox}>
            <div style={{ fontSize: 9, color: "#00ff88", letterSpacing: 2, marginBottom: 6 }}>📄 PDF లేదా 🖼 IMAGE</div>
            <button className="cb green" onClick={() => fileRef.current.click()} disabled={loading}>
              {loading ? "⏳ Analyzing..." : "📂 Upload చేయండి"}
            </button>
            <input ref={fileRef} type="file" accept=".pdf,image/*"
              style={{ display: "none" }} onChange={handleFile} />
            <div style={{ fontSize: 9, color: "#4488bb", marginTop: 4 }}>
              PDF, PNG, JPG — అన్నీ work అవుతాయి
            </div>
          </div>

          {status && (
            <div style={{
              ...S.statusBox,
              borderColor: status.includes("✅") ? "rgba(0,255,136,0.3)" : "rgba(0,180,255,0.2)",
              color: status.includes("✅") ? "#00ff88" : "#88ccff"
            }}>{status}</div>
          )}

          <div style={S.divider} />
          <div style={S.sLabel}>◈ SETTINGS</div>

          <div style={S.fieldLabel}>AP TYPE</div>
          <select value={apType} onChange={e => setApType(e.target.value)}>
            {Object.keys(AP_CONFIGS).map(k => <option key={k}>{k}</option>)}
          </select>

          <div style={S.fieldLabel}>FREQUENCY</div>
          <select value={freq} onChange={e => setFreq(e.target.value)}>
            {Object.keys(FREQ).map(k => <option key={k}>{k}</option>)}
          </select>

          <div style={S.fieldLabel}>SCALE: {scale}px/m | {Math.round(sz.w/scale)}×{Math.round(sz.h/scale)}m</div>
          <input type="range" min={4} max={30} value={scale}
            onChange={e => setScale(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#00cfff", marginBottom: 10 }} />

          <div style={S.divider} />
          <div style={S.sLabel}>◈ MANUAL TOOLS</div>
          <button className={`cb ${mode==="ap"?"on":""}`}   onClick={() => setMode("ap")}>📡 Place AP</button>
          <button className={`cb ${mode==="wall"?"on":""}`} onClick={() => setMode("wall")}>🧱 Draw Wall</button>
          <button className={`cb ${mode==="view"?"on":""}`} onClick={() => setMode("view")}>👁 View Only</button>

          <div style={S.divider} />
          <button className="cb" onClick={() => setShowHM(p => !p)}>
            {showHM ? "🔥 Hide Heatmap" : "🔥 Show Heatmap"}
          </button>
          <button className="cb red" onClick={() => { setAps([]); setWalls([]); setStatus(""); setReport(null); }}>
            ✕ Clear All
          </button>

          {/* Legend */}
          <div style={{ marginTop: 12 }}>
            <div style={S.sLabel}>◈ SIGNAL</div>
            {[["Excellent","#00ffcc"],["Good","#88ff44"],["Fair","#ffdd00"],["Weak","#ff8800"],["No Signal","#ff4444"]].map(([l,c]) => (
              <div key={l} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3 }}>
                <div style={{ width:11, height:11, borderRadius:2, background:c, opacity:.85 }}/>
                <span style={{ fontSize:9, color:"#aabbcc" }}>{l}</span>
              </div>
            ))}
          </div>

          {/* AP list */}
          {aps.length > 0 && (
            <div style={S.apList}>
              <div style={S.sLabel}>APs: {aps.length}</div>
              {aps.map((ap, i) => (
                <div key={i} style={{ fontSize:9, color: AP_CONFIGS[ap.type].color, marginBottom:2 }}>
                  AP{i+1}: {Math.round(ap.x/scale)}m, {Math.round(ap.y/scale)}m
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── MAIN ── */}
        <div style={{ flex: 1, minWidth: 300 }}>
          {tab === "map" ? (
            <>
              {/* mode bar */}
              <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center", flexWrap:"wrap" }}>
                <span style={{ fontSize:10, color:"#4488bb", letterSpacing:1 }}>
                  MODE: <span style={{ color: mode==="ap"?"#00ff88": mode==="wall"?"#ff8888":"#00cfff" }}>
                    {mode==="ap"?"📡 AP":mode==="wall"?"🧱 WALL":"👁 VIEW"}
                  </span>
                </span>
                {wallSt && <span style={{ fontSize:10, color:"#ffaa00", animation:"pulse 1s infinite" }}>◈ 2nd corner click చేయండి</span>}
                {hover !== null && (
                  <div style={{ marginLeft:"auto", fontSize:10, padding:"3px 10px",
                    background:"rgba(0,20,40,0.85)", borderRadius:6,
                    border:`1px solid ${hc}44`, color: hc }}>
                    {hl} {hover > -Infinity ? `(${Math.round(hover)} dBm)` : ""}
                  </div>
                )}
              </div>

              {/* canvas stack */}
              <div style={S.canvasWrap}>
                {img
                  ? <img src={img} alt="floor" style={{ display:"block", width:cw, height:ch }} />
                  : <div style={{ ...S.placeholder, width:cw, height:ch }}
                      onClick={() => fileRef.current.click()}>
                      <div style={{ fontSize:48, marginBottom:12 }}>🏢</div>
                      <div style={{ fontSize:15, color:"#4488bb", letterSpacing:2, marginBottom:6 }}>
                        PDF లేదా Image Upload చేయండి
                      </div>
                      <div style={{ fontSize:10, color:"#336688", marginBottom:16 }}>
                        AI automatically floor plan analyze చేస్తుంది
                      </div>
                      <button className="cb green" style={{ width:"auto", padding:"8px 24px" }}
                        onClick={e => { e.stopPropagation(); fileRef.current.click(); }}>
                        📂 Upload చేయండి
                      </button>
                    </div>
                }

                <canvas ref={heatRef} width={cw} height={ch}
                  style={{ position:"absolute", top:0, left:0, pointerEvents:"none" }} />
                <canvas ref={apRef}   width={cw} height={ch}
                  style={{ position:"absolute", top:0, left:0, cursor: mode==="view"?"crosshair":"cell" }}
                  onClick={onCanvasClick} onMouseMove={onMouseMove} onMouseLeave={() => setHover(null)} />

                {/* loading overlay */}
                {loading && (
                  <div style={S.loadOverlay}>
                    <div style={{ fontSize:44, animation:"spin 1.2s linear infinite", marginBottom:14 }}>⟳</div>
                    <div style={{ fontSize:14, color:"#00ff88", letterSpacing:2 }}>AI ANALYZING...</div>
                    <div style={{ fontSize:11, color:"#4488bb", marginTop:8 }}>{status}</div>
                  </div>
                )}
              </div>

              {/* tips */}
              <div style={{ marginTop:10, display:"flex", gap:8, flexWrap:"wrap" }}>
                {[["1","PDF/Image upload చేయండి"],["2","AI walls & APs auto detect చేస్తుంది"],
                  ["3","Heat map automatically వస్తుంది"],["4","Hover చేసి signal చూడండి"]].map(([n,t]) => (
                  <div key={n} style={S.tip}><span style={{ color:"#00cfff", fontWeight:"bold" }}>◈{n}</span> {t}</div>
                ))}
              </div>
            </>
          ) : (
            /* ── REPORT TAB ── */
            <div style={S.reportBox}>
              <div style={S.sLabel}>◈ AI ANALYSIS REPORT</div>
              {report ? (
                <>
                  <div style={S.summaryBox}>
                    <div style={{ fontSize:10, color:"#00ff88", letterSpacing:2, marginBottom:8 }}>📊 SUMMARY</div>
                    <div style={{ fontSize:12, color:"#c8d8f0", lineHeight:1.8 }}>{report.summary}</div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
                    {[["📡 APs", report.apCount, "#00cfff"],
                      ["📶 Coverage", report.coverage, "#00ff88"],
                      ["📐 Scale", `${scale}px/m`, "#ffaa00"]].map(([l,v,c]) => (
                      <div key={l} style={{ padding:12, background:"rgba(0,20,40,0.6)",
                        border:`1px solid ${c}33`, borderRadius:8, textAlign:"center" }}>
                        <div style={{ fontSize:9, color:"#4488bb", letterSpacing:2, marginBottom:4 }}>{l}</div>
                        <div style={{ fontSize:18, fontWeight:"bold", color:c }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={S.recBox}>
                    <div style={{ fontSize:10, color:"#00cfff", letterSpacing:2, marginBottom:10 }}>💡 RECOMMENDATIONS</div>
                    {(report.recommendations || []).map((r, i) => (
                      <div key={i} style={{ display:"flex", gap:10, marginBottom:8,
                        fontSize:11, color:"#aabbcc", lineHeight:1.6 }}>
                        <span style={{ color:"#00cfff", flexShrink:0 }}>◈{i+1}</span><span>{r}</span>
                      </div>
                    ))}
                  </div>
                  {aps.length > 0 && (
                    <div style={{ marginTop:16, padding:14, background:"rgba(0,20,40,0.6)",
                      border:"1px solid rgba(0,180,255,0.1)", borderRadius:8 }}>
                      <div style={S.sLabel}>📡 AP PLACEMENT DETAILS</div>
                      {aps.map((ap, i) => (
                        <div key={i} style={{ display:"flex", gap:12, marginBottom:6,
                          padding:"6px 10px", background:"rgba(0,180,255,0.04)",
                          borderRadius:6, fontSize:10 }}>
                          <span style={{ color: AP_CONFIGS[ap.type].color, fontWeight:"bold", minWidth:30 }}>AP{i+1}</span>
                          <span style={{ color:"#667788" }}>{Math.round(ap.x/scale)}m, {Math.round(ap.y/scale)}m</span>
                          <span style={{ color:"#aabbcc", flex:1 }}>{ap.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign:"center", padding:60, color:"#4488bb" }}>
                  <div style={{ fontSize:40, marginBottom:16 }}>📄</div>
                  <div style={{ fontSize:14, letterSpacing:2 }}>PDF లేదా Image upload చేయండి</div>
                  <div style={{ fontSize:11, marginTop:8, color:"#336688" }}>AI automatically report generate చేస్తుంది</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── styles ── */
const S = {
  page: { minHeight:"100vh", background:"linear-gradient(135deg,#0a0f1e,#0d1b2e,#071422)",
    fontFamily:"'Courier New',monospace", color:"#c8d8f0", padding:"16px" },
  title: { fontSize:22, fontWeight:900, margin:0, letterSpacing:2,
    background:"linear-gradient(90deg,#00cfff,#00ff88,#00cfff)",
    WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
    backgroundSize:"200%", animation:"shimmer 3s linear infinite" },
  sidebar: { width:195, background:"rgba(0,20,50,0.6)",
    border:"1px solid rgba(0,180,255,0.15)", borderRadius:10, padding:14, flexShrink:0 },
  sLabel: { fontSize:9, letterSpacing:3, color:"#4488bb", marginBottom:8 },
  fieldLabel: { fontSize:9, color:"#4488bb", marginBottom:3 },
  divider: { height:1, background:"rgba(0,180,255,0.1)", margin:"10px 0" },
  uploadBox: { marginBottom:10, padding:10, background:"rgba(0,255,136,0.05)",
    border:"1px solid rgba(0,255,136,0.2)", borderRadius:8 },
  statusBox: { marginBottom:10, fontSize:10, padding:8, background:"rgba(0,20,40,0.6)",
    borderRadius:6, border:"1px solid", lineHeight:1.6 },
  apList: { marginTop:10, padding:8, background:"rgba(0,180,255,0.05)",
    borderRadius:6, border:"1px solid rgba(0,180,255,0.1)" },
  canvasWrap: { position:"relative", display:"inline-block",
    border:"1px solid rgba(0,180,255,0.2)", borderRadius:10, overflow:"hidden",
    boxShadow:"0 0 40px rgba(0,100,200,0.15)" },
  placeholder: { background:"repeating-linear-gradient(0deg,rgba(0,40,80,0.3) 0,rgba(0,40,80,0.3) 1px,transparent 1px,transparent 40px),repeating-linear-gradient(90deg,rgba(0,40,80,0.3) 0,rgba(0,40,80,0.3) 1px,transparent 1px,transparent 40px)",
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer" },
  loadOverlay: { position:"absolute", top:0, left:0, right:0, bottom:0,
    background:"rgba(5,15,35,0.88)", display:"flex", flexDirection:"column",
    alignItems:"center", justifyContent:"center", borderRadius:10 },
  tip: { display:"flex", alignItems:"center", gap:6, fontSize:10, color:"#667788",
    background:"rgba(0,20,40,0.5)", padding:"4px 10px", borderRadius:20,
    border:"1px solid rgba(0,100,180,0.15)" },
  reportBox: { background:"rgba(0,20,50,0.6)", border:"1px solid rgba(0,180,255,0.15)",
    borderRadius:10, padding:20 },
  summaryBox: { marginBottom:16, padding:14, background:"rgba(0,255,136,0.06)",
    border:"1px solid rgba(0,255,136,0.2)", borderRadius:8 },
  recBox: { padding:14, background:"rgba(0,180,255,0.05)",
    border:"1px solid rgba(0,180,255,0.15)", borderRadius:8 },
};

const css = `
  @keyframes shimmer { 0%{background-position:0%} 100%{background-position:200%} }
  @keyframes spin    { to{transform:rotate(360deg)} }
  @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .cb { display:block; width:100%; margin-bottom:5px; padding:7px 12px; border-radius:6px;
    cursor:pointer; font-family:'Courier New',monospace; font-size:11px;
    letter-spacing:1px; transition:all .2s; text-align:left;
    background:rgba(0,180,255,0.08); border:1px solid rgba(0,180,255,0.25); color:#88ccff; }
  .cb:hover  { background:rgba(0,180,255,0.18); border-color:#00cfff; color:#fff; }
  .cb.on     { background:rgba(0,255,136,0.15); border-color:#00ff88; color:#00ff88; }
  .cb.green  { background:rgba(0,255,136,0.1);  border-color:rgba(0,255,136,0.4); color:#00ff88; }
  .cb.red    { border-color:rgba(255,80,80,0.4); color:#ff8888; }
  .cb.red:hover { background:rgba(255,80,80,0.15); }
  .cb:disabled  { opacity:.5; cursor:not-allowed; }
  .tab { background:transparent; border:1px solid rgba(0,180,255,0.2); color:#4488bb;
    padding:8px 22px; cursor:pointer; font-family:'Courier New',monospace;
    font-size:11px; letter-spacing:2px; transition:all .2s; }
  .tab.on { background:rgba(0,180,255,0.15); border-color:#00cfff; color:#00cfff; }
  select { display:block; width:100%; margin-bottom:8px; padding:6px 8px; border-radius:6px;
    outline:none; cursor:pointer; background:rgba(0,20,40,0.8);
    border:1px solid rgba(0,180,255,0.25); color:#88ccff;
    font-family:'Courier New',monospace; font-size:11px; }
`;
