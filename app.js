/* 말씀읽기APP v2.0 — Firebase 로그인/진도저장 + bible.json
   + 안드로이드 최적화 음성인식 루프(간단형)
   + 마이크 버튼 ON/OFF
/* 말씀읽기APP — Firebase 로그인/진도저장 + bible.json
   + 안드로이드 최적화 음성매칭
   + 마이크는 버튼으로만 ON/OFF
   + 절 완료시 절 버튼 색, 장 모두 완료시 장 버튼 색
   + 절 자동이동/장 자동이동
   + "해당절읽음" 버튼
   + 절 자동이동/장 자동이동(성공 처리)
   + "해당절읽음" 버튼 지원
   + 마이크 ON일 때 음성모드 변경 금지(라디오 없을 시 자동 무시)
*/
(() => {
  // ---------- PWA (선택) ----------
  // ---------- PWA ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" })
@@ -71,20 +72,60 @@
    micDb: document.getElementById("micDb"),
  };

  // 모달이 닫혀있을 때는 클릭 차단
  if (els.matrixModal) els.matrixModal.style.pointerEvents = "none";

  // ---------- BOOKS 접근(항상 최신) ----------
  function getBooks(){ return Array.isArray(window.BOOKS) ? window.BOOKS : []; }
  const getBookByKo = (ko) => getBooks().find(b => b.ko === ko);

  // ---------- State ----------
  const BOOKS = window.BOOKS || [];
  const getBookByKo = (ko) => BOOKS.find(b => b.ko === ko);
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const state = {
    bible: null, currentBookKo: null, currentChapter: null,
    verses: [], currentVerseIdx: 0,
    listening:false, recog:null,
    progress:{}, myStats:{versesRead:0,chaptersRead:0,last:{bookKo:null,chapter:null,verse:0}},
    ignoreUntilTs: 0, paintedPrefix: 0,
    verseDoneMap: {},
    charCumJamo: [],    // 각 화면 글자까지의 누적 자모 길이
    charJamoLens: [],   // 각 화면 글자의 자모 기여 길이
    heardJ: "",         // 누적 음성(자모) 버퍼
    _advancing:false,   // 자동 이동 제어
    paintTimer: null,   // 🎚️ 약간 늦게 칠하기용 타이머
    pendingPaint: 0
  };

  // ==== 매칭 엄격도 ====
  let MATCH_STRICTNESS = localStorage.getItem("matchStrictness") || "보통";
  window.setMatchStrictness = function(level){
    if(!["엄격","보통","관대"].includes(level)) return;
    MATCH_STRICTNESS = level;
    localStorage.setItem("matchStrictness", level);
    const hint = document.getElementById("listenHint");
    if (hint) hint.textContent = `음성매칭 엄격도: ${level}`;
    document.querySelectorAll('input[name=matchStrict]').forEach(r=>{
      r.checked = (r.value === level);
    });
  };
  function costsByStrictness(){
    if (MATCH_STRICTNESS==="엄격") return { subNear:0.38, subFar:1.00, del:0.60, ins:0.60 };
    if (MATCH_STRICTNESS==="관대") return { subNear:0.28, subFar:0.88, del:0.52, ins:0.52 };
    return { subNear:0.35, subFar:1.00, del:0.55, ins:0.55 };
  }
  function initStrictnessUI(){
    const radios = document.querySelectorAll('input[name=matchStrict]');
    if (!radios.length) return;
    radios.forEach(r=>{
      r.checked = (r.value === MATCH_STRICTNESS);
      r.addEventListener('change', ()=>{
        if (r.checked) window.setMatchStrictness(r.value);
      });
    });
    const hint = document.getElementById("listenHint");
    if (hint) hint.textContent = `음성매칭 엄격도: ${MATCH_STRICTNESS}`;
  }

  // ---------- bible.json ----------
  async function loadBible() {
    try {
@@ -97,15 +138,16 @@
    }
  }
  loadBible();
  initStrictnessUI();

  // ---------- Auth UX ----------
  function mapAuthError(e) {
    const code = e?.code || "";
    if (code.includes("invalid-email")) return "이메일 형식이 올바르지 않습니다.";
    if (code.includes("email-already-in-use")) return "이미 가입된 이메일입니다. 로그인하세요.";
    if (code.includes("weak-password")) return "비밀번호를 6자 이상으로 입력하세요.";
    if (code.includes("operation-not-allowed")) return "이메일/비밀번호 로그인이 비활성화되어 있습니다.";
    if (code.includes("network-request-failed")) return "네트워크 오류가 발생했습니다.";
    if (code.includes("operation-not-allowed")) return "이메일/비밀번호 로그인이 비활성화되어 있습니다. 콘솔에서 활성화해주세요.";
    if (code.includes("network-request-failed")) return "네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.";
    return e?.message || "알 수 없는 오류가 발생했습니다.";
  }
  async function safeEnsureUserDoc(u, opts={}) {
@@ -271,10 +313,18 @@
    state.currentBookKo = null; state.currentChapter = null; state.verses = []; state.currentVerseIdx = 0;
  }

  // [핵심 수정] 책 드롭다운 채우기 (books.js 로드 지연 대비)
  function buildBookSelect() {
    if (!els.bookSelect) return;

    const books = getBooks();
    if (!books.length) {
      setTimeout(buildBookSelect, 150);
      return;
    }

    els.bookSelect.innerHTML = "";
    for (const b of BOOKS) {
    for (const b of books) {
      const opt = document.createElement("option");
      opt.value = b.ko; opt.textContent = b.ko;
      els.bookSelect.appendChild(opt);
@@ -290,7 +340,7 @@
        });
      }
    } else {
      els.bookSelect.value = BOOKS[0]?.ko || "";
      els.bookSelect.value = books[0]?.ko || "";
      state.currentBookKo = els.bookSelect.value;
      buildChapterGrid();
    }
@@ -377,13 +427,57 @@
    }
  }

  // ---------- 표시/매칭 (간략: 글자 페인트만 유지) ----------
  function decomposeJamo(s){
    const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
    const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    const S_BASE=0xAC00, L_COUNT=19, V_COUNT=21, T_COUNT=28, N_COUNT=V_COUNT*T_COUNT, S_COUNT=L_COUNT*N_COUNT;
    const out=[];
    for (const ch of (s||"")){
      const code = ch.codePointAt(0);
      const sIndex = code - S_BASE;
      if (sIndex>=0 && sIndex<S_COUNT){
        const L = Math.floor(sIndex/N_COUNT);
        const V = Math.floor((sIndex%N_COUNT)/T_COUNT);
        const T = sIndex%T_COUNT;
        out.push(CHO[L], JUNG[V]); if (T) out.push(JONG[T]);
      } else out.push(ch);
    }
    return out.join("");
  }
  function normalizeToJamo(s, forSpoken=false){
    let t = (s||"").normalize("NFKC").replace(/[“”‘’"'\u200B-\u200D`´^~]/g,"").toLowerCase();
    t = t.replace(/[^\p{L}\p{N} ]/gu," ").replace(/\s+/g," ").trim();
    return decomposeJamo(t).replace(/\s+/g,"");
  }
  function buildCharToJamoCumMap(str){
    const jamoLens = [];
    const cum = [0];
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const rawJamo = decomposeJamo(ch).normalize("NFKC");
      const cleaned = rawJamo.replace(/[^\p{L}\p{N}]/gu, "");
      const len = cleaned.length;
      jamoLens.push(len);
      cum.push(cum[cum.length - 1] + len);
    }
    state.charJamoLens = jamoLens;
    return cum;
  }
  function updateVerseText() {
    const v = state.verses[state.currentVerseIdx] || "";
    state.paintedPrefix = 0;
    state.heardJ = "";
    state.ignoreUntilTs = 0;
    state._advancing = false;
    if (state.paintTimer) { clearTimeout(state.paintTimer); state.paintTimer=null; }

    state.targetJ = normalizeToJamo(v, false);
    state.charCumJamo = buildCharToJamoCumMap(v);

    els.locLabel && (els.locLabel.textContent =
      `${state.currentBookKo} ${state.currentChapter}장 ${state.currentVerseIdx + 1}절`);
    els.verseCount && (els.verseCount.textContent =
      `(${state.verses.length}절 중 ${state.currentVerseIdx + 1}절)`);

    if (els.verseText) {
      els.verseText.innerHTML = "";
      for (let i = 0; i < v.length; i++) {
@@ -393,13 +487,44 @@
        els.verseText.appendChild(s);
      }
    }

    els.verseCount && (els.verseCount.textContent =
      `(${state.verses.length}절 중 ${state.currentVerseIdx + 1}절)`);
    if (els.verseGrid) {
      [...els.verseGrid.children].forEach((btn, idx) =>
        btn.classList.toggle("active", idx===state.currentVerseIdx));
    }
  }
  function paintRead(prefixJamoLen){
    if (!els.verseText) return;
    const spans = els.verseText.childNodes;
    const cum   = state.charCumJamo || [];
    const lens  = state.charJamoLens || [];

    let k = 0;
    while (k < cum.length && cum[k] <= prefixJamoLen) k++;
    let charCount = Math.max(0, k - 1);

    if (prefixJamoLen === 0) {
      const firstNonZero = lens.findIndex(v => v > 0);
      if (firstNonZero > 0) charCount = 0;
    }

    for (let i=0;i<spans.length;i++){
      spans[i].style.color = (i < charCount) ? "#43d17a" : "";
      spans[i].classList?.remove("read");
    }
  }
  function schedulePaint(nextPrefix){
    state.pendingPaint = Math.max(state.pendingPaint, nextPrefix);
    if (state.paintTimer) clearTimeout(state.paintTimer);
    state.paintTimer = setTimeout(() => {
      const target = Math.max(state.paintedPrefix, state.pendingPaint);
      paintRead(target);
      state.paintedPrefix = target;
      state.pendingPaint = 0;
      state.paintTimer = null;
    }, 140);
  }
  function markVerseAsDone(verseIndex1Based) {
    const key = keyForChapter();
    if (!state.verseDoneMap[key]) state.verseDoneMap[key] = new Set();
@@ -425,7 +550,7 @@
    }
  }

  // ---------- Mic Level Meter ----------
  // ---------- 마이크 레벨 ----------
  let audioCtx, analyser, micSrc, levelTimer, micStream;
  async function startMicLevel() {
    try {
@@ -467,144 +592,18 @@
    if (els.micDb) els.micDb.textContent = "-∞ dB";
  }

  // ---------- 장/절 선택 ----------
  async function selectChapter(chapter) {
    state.currentChapter = chapter;
    state.currentVerseIdx = 0;

    const b = getBookByKo(state.currentBookKo);
    els.locLabel && (els.locLabel.textContent = `${b?.ko || ""} ${chapter}장`);
    els.verseText && (els.verseText.textContent = "로딩 중…");

    if (!state.bible) {
      await loadBible();
      if (!state.bible) {
        els.verseText && (els.verseText.textContent = "bible.json 로딩 실패");
        return;
      }
    }

    const chObj = state.bible?.[state.currentBookKo]?.[String(chapter)];
    if (!chObj) {
      els.verseText && (els.verseText.textContent = `${b?.ko || ""} ${chapter}장 본문 없음`);
      els.verseCount && (els.verseCount.textContent = "");
      els.verseGrid && (els.verseGrid.innerHTML = "");
      return;
    }

    const entries = Object.entries(chObj)
      .map(([k,v])=>[parseInt(k,10), String(v)]).sort((a,c)=>a[0]-c[0]);
    state.verses = entries.map(e=>e[1]);

    els.verseCount && (els.verseCount.textContent = `(${state.verses.length}절)`);
    buildVerseGrid();
    updateVerseText();

    state.myStats.last = { bookKo: state.currentBookKo, chapter, verse: 1 };
    saveLastPosition();
    buildChapterGrid();
  }

  function buildMatrix() {
    if (!els.matrixWrap) return;
    const maxCh = Math.max(...BOOKS.map(b => b.ch));

    const table = document.createElement("table");
    table.className = "matrix";

    const thead = document.createElement("thead");
    const trTop    = document.createElement("tr");
    const trMiddle = document.createElement("tr");
    const trBottom = document.createElement("tr");

    const thBook = document.createElement("th");
    thBook.className = "book"; thBook.textContent = "권/장"; thBook.rowSpan = 3;
    trTop.appendChild(thBook);

    for (let c = 1; c <= maxCh; c++) {
      const hundreds = Math.floor(c / 100);
      const tens     = Math.floor((c % 100) / 10);
      const ones     = c % 10;

      const thH = document.createElement("th"); thH.textContent = hundreds || "";
      const thT = document.createElement("th"); thT.textContent = tens || "";
      const thO = document.createElement("th"); thO.textContent = ones;

      [thH, thT, thO].forEach(th => {
        th.style.textAlign = "center";
        th.style.minWidth = "20px";
        th.style.width = "20px";
      });

      trTop.appendChild(thH);
      trMiddle.appendChild(thT);
      trBottom.appendChild(thO);
    }

    thead.appendChild(trTop);
    thead.appendChild(trMiddle);
    thead.appendChild(trBottom);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const b of BOOKS) {
      const tr = document.createElement("tr");

      const th = document.createElement("th");
      th.className = "book"; th.textContent = b.abbr || b.short || (b.ko ? b.ko.slice(0,2) : b.id || "");
      tr.appendChild(th);

      const read = state.progress[b.id]?.readChapters || new Set();
      for (let c = 1; c <= maxCh; c++) {
        const td = document.createElement("td");
        if (c <= b.ch) {
          td.textContent = " ";
          td.style.background = read.has(c)
            ? "rgba(67,209,122,0.6)"
            : "rgba(120,120,140,0.25)";
          td.title = `${b.ko} ${c}장`;
        } else {
          td.style.background = "transparent";
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    els.matrixWrap.innerHTML = "";
    els.matrixWrap.appendChild(table);
  }

  function openMatrix(){
    buildMatrix();
    if (els.matrixModal){ els.matrixModal.style.pointerEvents = "auto"; }
    els.matrixModal?.classList.add("show");
    els.matrixModal?.classList.remove("hidden");
  }
  function closeMatrix(){
    els.matrixModal?.classList.remove("show");
    els.matrixModal?.classList.add("hidden");
    if (els.matrixModal){ els.matrixModal.style.pointerEvents = "none"; }
  }
  document.getElementById("btnOpenMatrix")?.addEventListener("click", openMatrix);
  els.btnCloseMatrix?.addEventListener("click", (e)=>{ e?.preventDefault?.(); e?.stopPropagation?.(); closeMatrix(); });
  els.matrixModal?.addEventListener("click", (e)=>{ const body=els.matrixModal.querySelector(".modal-body"); if (!body || !e.target) return; if (!body.contains(e.target)) closeMatrix(); });
  window.addEventListener("keydown", (e)=>{ if (e.key==='Escape' && els.matrixModal?.classList.contains('show')) closeMatrix(); });

  // ---------- SpeechRecognition ----------
  // ---------- SpeechRecognition (간단 루프: 버튼 토글용) ----------
  function supportsSR(){ return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  function makeRecognizer(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = 'ko-KR';
    r.continuous = !IS_ANDROID;        // iOS/데스크탑은 continuous 허용
    r.interimResults = !IS_ANDROID;    // Android는 final만 취급
    r.continuous = !IS_ANDROID;
    r.interimResults = !IS_ANDROID ? true : false;
    try { r.maxAlternatives = 4; } catch(_) {}
    return r;
  }

  let loopTimer=null, watchdogTimer=null, noResultTimer=null;
  const ANDROID_WATCHDOG_MS  = 8500;
  const ANDROID_NORESULT_MS  = 7000;
@@ -632,16 +631,34 @@

      const v = state.verses[state.currentVerseIdx] || "";
      if (!v) return;
      if (Date.now() < state.ignoreUntilTs) return;

      const res = evt.results[evt.results.length-1]; if (!res) return;
      const tr = res[0]?.transcript || ""; if (!tr) return;

      // 간단: 현재 절 전체 텍스트를 음성으로 읽었다고 가정하고 어느정도 인식되면 완료 처리
      // (v3의 자모 매칭/하이라이트 없이, v2는 완료 트리거만)
      const clean = (s)=>s.normalize("NFKC").replace(/[^\p{L}\p{N} ]/gu," ").replace(/\s+/g," ").trim();
      const t = clean(v), heard = clean(tr);
      // 짧은 휴리스틱: 현재 절의 절반 길이 이상 매칭되면 완료 처리
      if (heard && t.includes(heard) || heard.length >= Math.max(6, Math.floor(t.length*0.5))) {
        completeVerse(true);
      const targetJ = state.targetJ || normalizeToJamo(v, false);
      const pieceJ  = normalizeToJamo(tr, true);

      if (res.isFinal || IS_ANDROID) {
        state.heardJ = (state.heardJ + pieceJ);
        const cap = targetJ.length * 3;
        if (state.heardJ.length > cap) state.heardJ = state.heardJ.slice(-cap);
      }

      const tmpHeard = state.heardJ + (res.isFinal ? "" : pieceJ);

      // 간단: 들린 길이를 그대로 칠하기 예시(실제는 정교한 매칭 사용 가능)
      const k = Math.min(targetJ.length, tmpHeard.length);
      schedulePaint(k);

      const fullyPainted = Math.max(state.paintedPrefix, state.pendingPaint) >= targetJ.length;
      if (!state._advancing && fullyPainted) {
        state._advancing = true;
        setTimeout(() => {
          completeVerse(true);
          state._advancing = false;
        }, 120);
        return;
      }
    };

@@ -655,15 +672,24 @@
          state.recog.abort?.();
        }
      } catch(_) {}
      loopTimer = setTimeout(runRecognizerLoop, 250);
      loopTimer = setTimeout(runRecognizerLoop, 200);
    };
    recog.onend = restart;

    recog.onerror = (e)=>{
      const err = e?.error || "";
      if (err === "aborted" || err === "no-speech") { restart(); return; }
      if (err === "aborted" || err === "no-speech") {
        if (!state.listening) return;
        if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer=null; }
        if (noResultTimer) { clearTimeout(noResultTimer); noResultTimer=null; }
        loopTimer = setTimeout(runRecognizerLoop, 300);
        return;
      }
      console.warn("[SR] error:", err, e);
      restart();
      if (!state.listening) return;
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer=null; }
      if (noResultTimer) { clearTimeout(noResultTimer); noResultTimer=null; }
      loopTimer = setTimeout(runRecognizerLoop, 400);
      if (err === "not-allowed" || err === "service-not-allowed") {
        alert("마이크 권한이 필요합니다. 주소창 오른쪽 마이크 아이콘을 확인하세요.");
      }
@@ -694,24 +720,33 @@
      console.warn("recog.start 실패:", e);
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer=null; }
      if (noResultTimer) { clearTimeout(noResultTimer); noResultTimer=null; }
      loopTimer = setTimeout(runRecognizerLoop, 200);
      loopTimer = setTimeout(runRecognizerLoop, 150);
    }
  }

  async function startListening(){
  async function startListening(showAlert=true){
    if (state.listening) return;
    if (!supportsSR()){
      els.listenHint && (els.listenHint.innerHTML="⚠️ 음성인식 미지원(Chrome/Safari 권장)");
      alert("이 브라우저는 음성인식을 지원하지 않습니다.");
      if (showAlert) alert("이 브라우저는 음성인식을 지원하지 않습니다.");
      return;
    }
    // 마이크 레벨만 켜도 인식 시작 전에 권한 팝업이 뜹니다
    await startMicLevel();

    state.paintedPrefix = 0;
    state.heardJ = "";
    state.ignoreUntilTs = 0;
    state._advancing = false;
    if (state.paintTimer) { clearTimeout(state.paintTimer); state.paintTimer=null; }
    state.listening = true;
    els.btnToggleMic && (els.btnToggleMic.textContent="⏹️");
    startMicLevel();

    refreshRecogModeLock();
    runRecognizerLoop();
  }

  function stopListening(){
  function stopListening(resetBtn=true){
    state.listening=false;
    if (loopTimer) { clearTimeout(loopTimer); loopTimer=null; }
    if (state.recog){
@@ -720,9 +755,11 @@
    }
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer=null; }
    if (noResultTimer) { clearTimeout(noResultTimer); noResultTimer=null; }
    if (state.paintTimer) { clearTimeout(state.paintTimer); state.paintTimer=null; }

    els.btnToggleMic && (els.btnToggleMic.textContent="🎙️");
    if (resetBtn && els.btnToggleMic) els.btnToggleMic.textContent="🎙️";
    stopMicLevel();
    refreshRecogModeLock();
  }

  els.btnToggleMic?.addEventListener("click", ()=>{ if(!state.listening) startListening(); else stopListening(); });
@@ -751,19 +788,28 @@
      const moved = await advanceToNextVerse();
      if (!moved){
        await markChapterDone(b.id, state.currentChapter);

        if (state.currentChapter < b.ch) {
          const next = state.currentChapter + 1;
          await selectChapter(next);
          buildChapterGrid();
          state.paintedPrefix = 0;
          state.heardJ = "";
          state.ignoreUntilTs = Date.now() + 600;
        } else {
          alert("이 권의 모든 장을 완료했습니다. 다른 권을 선택하세요.");
        }
        return;
      }
      state.paintedPrefix = 0;
      state.heardJ = "";
      state.ignoreUntilTs = Date.now() + 500;
    } else {
      state.ignoreUntilTs = Date.now() + 300;
    }
  }

  // 앞/뒤 절 버튼
  // ---------- 앞/뒤 절 버튼 ----------
  els.btnNextVerse?.addEventListener("click", ()=>{
    if(!state.verses.length) return;
    if(state.currentVerseIdx<state.verses.length-1){
@@ -772,6 +818,7 @@
      saveLastPosition();
      updateVerseText();
      buildVerseGrid();
      state.paintedPrefix=0; state.heardJ=""; state.ignoreUntilTs = Date.now() + 300;
    }
  });
  els.btnPrevVerse?.addEventListener("click", ()=>{
@@ -782,6 +829,7 @@
      saveLastPosition();
      updateVerseText();
      buildVerseGrid();
      state.paintedPrefix=0; state.heardJ=""; state.ignoreUntilTs = Date.now() + 300;
    }
  });

@@ -798,6 +846,9 @@
      saveLastPosition();
      updateVerseText();
      buildVerseGrid();
      state.paintedPrefix = 0;
      state.heardJ = "";
      state.ignoreUntilTs = Date.now() + 500;
      return;
    }

@@ -811,11 +862,31 @@
      const nextChapter = state.currentChapter + 1;
      await selectChapter(nextChapter);
      buildChapterGrid();
      state.paintedPrefix = 0;
      state.heardJ = "";
      state.ignoreUntilTs = Date.now() + 600;
    } else {
      alert("이 권의 모든 장을 완료했습니다. 다른 권을 선택하세요.");
    }
  });

  // ---------- 음성모드 라디오: 마이크 ON일 때 변경 금지 ----------
  function refreshRecogModeLock() {
    const radios = document.querySelectorAll('input[name=recogMode]');
    if (!radios?.length) return;
    radios.forEach(r => { r.disabled = state.listening; });
  }
  document.querySelectorAll('input[name=recogMode]')?.forEach(radio=>{
    radio.addEventListener('change', (e)=>{
      if (state.listening) {
        e.preventDefault();
        e.stopImmediatePropagation();
        alert("마이크를 끈 후에 음성 인식 모드를 변경할 수 있습니다.");
        refreshRecogModeLock();
      }
    });
  });

  // ---------- Leaderboard ----------
  async function loadLeaderboard() {
    if (!db || !els.leaderList) return;
@@ -833,4 +904,155 @@
    });
  }

  // (도움) 성경 축약표기
  function shortBookName(b){
    return b.abbr || b.short || (b.ko ? b.ko.slice(0,2) : b.id || "");
  }

  // ---------- Progress Matrix ----------
  function buildMatrix() {
    if (!els.matrixWrap) return;

    const books = getBooks();
    if (!books.length) { els.matrixWrap.innerHTML = ""; return; }

    const maxCh = Math.max(...books.map(b => b.ch));

    const table = document.createElement("table");
    table.className = "matrix";

    const thead = document.createElement("thead");

    const trTop    = document.createElement("tr");
    const trMiddle = document.createElement("tr");
    const trBottom = document.createElement("tr");

    const thBook = document.createElement("th");
    thBook.className = "book";
    thBook.textContent = "권/장";
    thBook.rowSpan = 3;
    trTop.appendChild(thBook);

    for (let c = 1; c <= maxCh; c++) {
      const hundreds = Math.floor(c / 100);
      const tens     = Math.floor((c % 100) / 10);
      const ones     = c % 10;

      const thH = document.createElement("th");
      thH.textContent = hundreds || "";
      const thT = document.createElement("th");
      thT.textContent = tens || "";
      const thO = document.createElement("th");
      thO.textContent = ones;

      [thH, thT, thO].forEach(th => {
        th.style.textAlign = "center";
        th.style.minWidth = "20px";
        th.style.width = "20px";
      });

      trTop.appendChild(thH);
      trMiddle.appendChild(thT);
      trBottom.appendChild(thO);
    }

    thead.appendChild(trTop);
    thead.appendChild(trMiddle);
    thead.appendChild(trBottom);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const b of books) {
      const tr = document.createElement("tr");

      const th = document.createElement("th");
      th.className = "book";
      th.textContent = shortBookName(b);
      tr.appendChild(th);

      const read = state.progress[b.id]?.readChapters || new Set();
      for (let c = 1; c <= maxCh; c++) {
        const td = document.createElement("td");
        if (c <= b.ch) {
          td.textContent = " ";
          td.style.background = read.has(c)
            ? "rgba(67,209,122,0.6)"
            : "rgba(120,120,140,0.25)";
          td.title = `${b.ko} ${c}장`;
        } else {
          td.style.background = "transparent";
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    els.matrixWrap.innerHTML = "";
    els.matrixWrap.appendChild(table);
  }

  function openMatrix(){
    buildMatrix();
    if (els.matrixModal){
      els.matrixModal.style.pointerEvents = "auto";
    }
    els.matrixModal?.classList.add("show");
    els.matrixModal?.classList.remove("hidden");
  }

  function closeMatrix(){
    els.matrixModal?.classList.remove("show");
    els.matrixModal?.classList.add("hidden");
    if (els.matrixModal){
      els.matrixModal.style.pointerEvents = "none";
    }
  }

  document.getElementById("btnOpenMatrix")?.addEventListener("click", openMatrix);
  els.btnCloseMatrix?.addEventListener("click", (e)=>{ e?.preventDefault?.(); e?.stopPropagation?.(); closeMatrix(); });
  els.matrixModal?.addEventListener("click", (e)=>{ const body=els.matrixModal.querySelector(".modal-body"); if (!body || !e.target) return; if (!body.contains(e.target)) closeMatrix(); });
  window.addEventListener("keydown", (e)=>{ if (e.key==='Escape' && els.matrixModal?.classList.contains('show')) closeMatrix(); });

  // ---------- 장 선택 ----------
  async function selectChapter(chapter) {
    state.currentChapter = chapter;
    state.currentVerseIdx = 0;

    const b = getBookByKo(state.currentBookKo);
    els.locLabel && (els.locLabel.textContent = `${b?.ko || ""} ${chapter}장`);
    els.verseText && (els.verseText.textContent = "로딩 중…");

    if (!state.bible) {
      await loadBible();
      if (!state.bible) {
        els.verseText && (els.verseText.textContent = "bible.json 로딩 실패");
        return;
      }
    }

    const chObj = state.bible?.[state.currentBookKo]?.[String(chapter)];
    if (!chObj) {
      els.verseText && (els.verseText.textContent = `${b?.ko || ""} ${chapter}장 본문 없음`);
      els.verseCount && (els.verseCount.textContent = "");
      els.verseGrid && (els.verseGrid.innerHTML = "");
      return;
    }

    const entries = Object.entries(chObj)
      .map(([k,v])=>[parseInt(k,10), String(v)])
      .sort((a,c)=>a[0]-c[0]);

    state.verses = entries.map(e=>e[1]);

    els.verseCount && (els.verseCount.textContent = `(${state.verses.length}절)`);
    buildVerseGrid();
    updateVerseText();

    state.myStats.last = { bookKo: state.currentBookKo, chapter, verse: 1 };
    saveLastPosition();

    buildChapterGrid();
  }

})();
