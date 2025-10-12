/* 말씀읽기APP v2.0 — Firebase 로그인/진도저장 + bible.json
   + 안드로이드 최적화 음성인식 루프(간단형)
   + 마이크 버튼 ON/OFF
   + 절 완료시 절 버튼 색, 장 모두 완료시 장 버튼 색
   + 절 자동이동/장 자동이동
   + "해당절읽음" 버튼
*/
(() => {
  // ---------- PWA (선택) ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" })
        .then(reg => console.log("[SW] registered:", reg.scope))
        .catch(err => console.warn("[SW] register failed:", err));
    });
  }

  // ---------- Firebase ----------
  let auth, db, user;
  function initFirebase() {
    if (!window.firebaseConfig || typeof firebase === "undefined") {
      console.error("[Firebase] SDK/config 누락");
      return;
    }
    firebase.initializeApp(window.firebaseConfig);
    auth = firebase.auth();
    db   = firebase.firestore();
    console.log("[Firebase] 초기화 OK");
  }
  initFirebase();

  // ---------- Screens ----------
  const scrLogin = document.getElementById("screen-login");
  const scrApp   = document.getElementById("screen-app");
  function showScreen(name) {
    if (name === "login") { scrLogin?.classList.add("show"); scrApp?.classList.remove("show"); }
    else { scrApp?.classList.add("show"); scrLogin?.classList.remove("show"); }
  }

  // ---------- DOM ----------
  const els = {
    email: document.getElementById("email"),
    password: document.getElementById("password"),
    displayName: document.getElementById("displayName"),
    nickname: document.getElementById("nickname"),
    btnLogin: document.getElementById("btnLogin"),
    btnSignup: document.getElementById("btnSignup"),
    signedIn: document.getElementById("signedIn"),
    userName: document.getElementById("userName"),
    userPhoto: document.getElementById("userPhoto"),
    btnSignOut: document.getElementById("btnSignOut"),
    bookSelect: document.getElementById("bookSelect"),
    chapterGrid: document.getElementById("chapterGrid"),
    verseGrid: document.getElementById("verseGrid"),
    verseText: document.getElementById("verseText"),
    locLabel: document.getElementById("locLabel"),
    verseCount: document.getElementById("verseCount"),
    myStats: document.getElementById("myStats"),
    leaderList: document.getElementById("leaderList"),
    matrixModal: document.getElementById("matrixModal"),
    matrixWrap: document.getElementById("matrixWrap"),
    btnCloseMatrix: document.getElementById("btnCloseMatrix"),
    btnOpenMatrix: document.getElementById("btnOpenMatrix"),
    btnPrevVerse: document.getElementById("btnPrevVerse"),
    btnNextVerse: document.getElementById("btnNextVerse"),
    btnToggleMic: document.getElementById("btnToggleMic"),
    btnMarkRead: document.getElementById("btnMarkRead"),
    listenHint: document.getElementById("listenHint"),
    autoAdvance: document.getElementById("autoAdvance"),
    micBar: document.getElementById("micBar"),
    micDb: document.getElementById("micDb"),
  };

  if (els.matrixModal) els.matrixModal.style.pointerEvents = "none";

  // ---------- State ----------
  const BOOKS = window.BOOKS || [];
  const getBookByKo = (ko) => BOOKS.find(b => b.ko === ko);
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const state = {
    bible: null, currentBookKo: null, currentChapter: null,
    verses: [], currentVerseIdx: 0,
    listening:false, recog:null,
    progress:{}, myStats:{versesRead:0,chaptersRead:0,last:{bookKo:null,chapter:null,verse:0}},
    verseDoneMap: {},
  };

  // ---------- bible.json ----------
  async function loadBible() {
    try {
      const res = await fetch("./bible.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("bible.json not found");
      state.bible = await res.json();
    } catch (e) {
      console.error("[bible.json] 로딩 실패:", e);
      els.verseText && (els.verseText.textContent = "루트에 bible.json 파일이 필요합니다.");
    }
  }
  loadBible();

  // ---------- Auth UX ----------
  function mapAuthError(e) {
    const code = e?.code || "";
    if (code.includes("invalid-email")) return "이메일 형식이 올바르지 않습니다.";
    if (code.includes("email-already-in-use")) return "이미 가입된 이메일입니다. 로그인하세요.";
    if (code.includes("weak-password")) return "비밀번호를 6자 이상으로 입력하세요.";
    if (code.includes("operation-not-allowed")) return "이메일/비밀번호 로그인이 비활성화되어 있습니다.";
    if (code.includes("network-request-failed")) return "네트워크 오류가 발생했습니다.";
    return e?.message || "알 수 없는 오류가 발생했습니다.";
  }
  async function safeEnsureUserDoc(u, opts={}) {
    try { await ensureUserDoc(u, opts); } catch (e){ console.warn("[ensureUserDoc] 실패:", e); }
  }
  let busy=false;
  async function withBusy(btn, fn){
    if(busy) return;
    busy=true;
    const orig = btn?.textContent;
    if(btn){ btn.disabled=true; btn.textContent="처리 중…"; }
    try{ await fn(); } finally { busy=false; if(btn){ btn.disabled=false; btn.textContent=orig; } }
  }

  // ---------- 회원가입 / 로그인 / 로그아웃 ----------
  els.btnSignup?.addEventListener("click", () => withBusy(els.btnSignup, async () => {
    const email = (els.email.value || "").trim();
    const pw    = (els.password.value || "").trim();
    const name  = (els.displayName.value || "").trim();
    const nick  = (els.nickname?.value || "").trim();
    if (!email || !pw) { alert("이메일/비밀번호를 입력하세요."); return; }

    try {
      const cred = await auth.createUserWithEmailAndPassword(email, pw);
      user = cred.user;
      if (name) { await user.updateProfile({ displayName: name }); }
      await safeEnsureUserDoc(user, { nickname: nick });
    } catch (e) {
      console.error(e);
      alert("회원가입 실패: " + mapAuthError(e));
    }
  }));

  els.btnLogin?.addEventListener("click", () => withBusy(els.btnLogin, async () => {
    const email = (els.email.value || "").trim();
    const pw    = (els.password.value || "").trim();
    const name  = (els.displayName.value || "").trim();
    const nick  = (els.nickname?.value || "").trim();
    if (!email || !pw) { alert("이메일/비밀번호를 입력하세요."); return; }

    try {
      const cred = await auth.signInWithEmailAndPassword(email, pw);
      user = cred.user;
      if (name) { await user.updateProfile({ displayName: name }); }
      await safeEnsureUserDoc(user, { nickname: nick });
    } catch (e) {
      console.error(e);
      alert("로그인 실패: " + mapAuthError(e));
    }
  }));

  els.btnSignOut?.addEventListener("click", () => auth?.signOut());

  auth?.onAuthStateChanged(async (u) => {
    user = u;
    if (!u) { showScreen("login"); clearAppUI(); return; }

    showScreen("app");
    els.signedIn?.classList.remove("hidden");
    els.userName && (els.userName.textContent = u.displayName || u.email || "사용자");
    if (els.userPhoto) {
      if (u.photoURL) { els.userPhoto.src = u.photoURL; els.userPhoto.classList.remove('hidden'); }
      else { els.userPhoto.classList.add('hidden'); }
    }

    try { await ensureUserDoc(u); } catch (e) {}
    try { await loadMyStats(); } catch (e) {}
    try { buildBookSelect(); } catch (e) {}
    try { loadLeaderboard(); } catch (e) {}
  });

  // ---------- Firestore helpers ----------
  async function ensureUserDoc(u, opts={}) {
    if (!db || !u) return;
    const data = {
      email: u.email || "",
      versesRead: firebase.firestore.FieldValue.increment(0),
      chaptersRead: firebase.firestore.FieldValue.increment(0),
      last: state.myStats.last || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (opts.nickname && opts.nickname.trim()) data.nickname = opts.nickname.trim();
    await db.collection("users").doc(u.uid).set(data, { merge: true });
  }

  async function loadMyStats() {
    if (!db || !user) return;
    try {
      const snap = await db.collection("users").doc(user.uid).get();
      if (snap.exists) {
        const d = snap.data();
        state.myStats.versesRead = d.versesRead || 0;
        state.myStats.chaptersRead = d.chaptersRead || 0;
        state.myStats.last = d.last || { bookKo: null, chapter: null, verse: 0 };
        els.myStats && (els.myStats.textContent =
          `절 ${state.myStats.versesRead.toLocaleString()} · 장 ${state.myStats.chaptersRead.toLocaleString()}`);
      }
    } catch (e) {}

    const p = {};
    try {
      const qs = await db.collection("users").doc(user.uid).collection("progress").get();
      qs.forEach(doc => { p[doc.id] = { readChapters: new Set((doc.data().readChapters) || []) }; });
    } catch (e) {}
    state.progress = p;
  }

  async function saveLastPosition() {
    if (!db || !user) return;
    try {
      await db.collection("users").doc(user.uid).set({
        last: state.myStats.last,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {}
  }

  async function markChapterDone(bookId, chapter) {
    if (!state.progress[bookId]) state.progress[bookId] = { readChapters: new Set() };
    state.progress[bookId].readChapters.add(chapter);
    if (db && user) {
      try {
        await db.collection("users").doc(user.uid).collection("progress").doc(bookId)
          .set({ readChapters: Array.from(state.progress[bookId].readChapters) }, { merge: true });
        await db.collection("users").doc(user.uid)
          .set({ chaptersRead: firebase.firestore.FieldValue.increment(1),
                 updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        state.myStats.chaptersRead += 1;
        els.myStats && (els.myStats.textContent =
          `절 ${state.myStats.versesRead.toLocaleString()} · 장 ${state.myStats.chaptersRead.toLocaleString()}`);
        buildChapterGrid();
        buildMatrix();
      } catch (e) {}
    }
  }

  async function incVersesRead(n = 1) {
    state.myStats.versesRead += n;
    els.myStats && (els.myStats.textContent =
      `절 ${state.myStats.versesRead.toLocaleString()} · 장 ${state.myStats.chaptersRead.toLocaleString()}`);
    if (db && user) {
      try {
        await db.collection("users").doc(user.uid)
          .set({
            versesRead: firebase.firestore.FieldValue.increment(n),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
      } catch (e) {}
    }
  }

  // ---------- Book / Chapter / Verse ----------
  function clearAppUI() {
    els.bookSelect && (els.bookSelect.innerHTML = "");
    els.chapterGrid && (els.chapterGrid.innerHTML = "");
    els.verseGrid && (els.verseGrid.innerHTML = "");
    els.verseText && (els.verseText.textContent = "로그인 후 시작하세요.");
    els.leaderList && (els.leaderList.innerHTML = "");
    els.myStats && (els.myStats.textContent = "—");
    els.locLabel && (els.locLabel.textContent = "");
    els.verseCount && (els.verseCount.textContent = "");
    state.currentBookKo = null; state.currentChapter = null; state.verses = []; state.currentVerseIdx = 0;
  }

  function buildBookSelect() {
    if (!els.bookSelect) return;
    els.bookSelect.innerHTML = "";
    for (const b of BOOKS) {
      const opt = document.createElement("option");
      opt.value = b.ko; opt.textContent = b.ko;
      els.bookSelect.appendChild(opt);
    }
    const last = state.myStats?.last;
    if (last?.bookKo) {
      els.bookSelect.value = last.bookKo; state.currentBookKo = last.bookKo; buildChapterGrid();
      if (last.chapter) {
        selectChapter(last.chapter).then(() => {
          if (Number.isInteger(last.verse)) {
            state.currentVerseIdx = Math.max(0, (last.verse || 1) - 1); updateVerseText();
          }
        });
      }
    } else {
      els.bookSelect.value = BOOKS[0]?.ko || "";
      state.currentBookKo = els.bookSelect.value;
      buildChapterGrid();
    }
  }

  els.bookSelect?.addEventListener("change", () => {
    state.currentBookKo = els.bookSelect.value;
    state.currentChapter = null; state.verses = []; state.currentVerseIdx = 0;
    els.verseGrid && (els.verseGrid.innerHTML = "");
    els.verseText && (els.verseText.textContent = "장과 절을 선택하세요.");
    buildChapterGrid();
    state.myStats.last = { bookKo: state.currentBookKo, chapter: null, verse: 0 }; saveLastPosition();
  });

  function buildChapterGrid() {
    const b = getBookByKo(state.currentBookKo);
    if (!b || !els.chapterGrid) return;
    els.chapterGrid.innerHTML = "";

    for (let i = 1; i <= b.ch; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      const isDonePersist = state.progress[b.id]?.readChapters?.has(i);
      btn.className = "chip";
      btn.style.borderRadius = "9999px";
      btn.textContent = i;

      if (state.currentChapter === i) {
        const key = `${state.currentBookKo}#${i}`;
        const set = state.verseDoneMap[key];
        if (set && state.verses.length > 0 && set.size === state.verses.length) {
          btn.classList.add("done");
          btn.style.backgroundColor = "rgba(67,209,122,0.8)";
        }
      }
      if (isDonePersist) btn.classList.add("done");

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        selectChapter(i);
      });
      if (state.currentChapter === i) btn.classList.add("active");
      els.chapterGrid.appendChild(btn);
    }
  }

  els.chapterGrid?.addEventListener("click", (e) => {
    const btn = e.target?.closest("button.chip");
    if (!btn || !els.chapterGrid.contains(btn)) return;
    const n = parseInt(btn.textContent, 10);
    if (Number.isFinite(n)) {
      e.preventDefault();
      e.stopPropagation();
      selectChapter(n);
    }
  });

  function keyForChapter(){ return `${state.currentBookKo}#${state.currentChapter}`; }

  function buildVerseGrid() {
    if (!els.verseGrid) return;
    els.verseGrid.innerHTML = "";
    const key = keyForChapter();
    const doneSet = state.verseDoneMap[key] || new Set();

    for (let i = 1; i <= state.verses.length; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.style.borderRadius = "9999px";
      btn.textContent = i;

      if (doneSet.has(i)) {
        btn.classList.add("readok");
        btn.style.backgroundColor = "rgba(67,209,122,0.6)";
      }

      btn.addEventListener("click", () => {
        state.currentVerseIdx = i - 1; updateVerseText();
        state.myStats.last.verse = i; saveLastPosition();
      });
      if (state.currentVerseIdx === i - 1) btn.classList.add("active");
      els.verseGrid.appendChild(btn);
    }
  }

  function updateVerseText() {
    const v = state.verses[state.currentVerseIdx] || "";
    els.locLabel && (els.locLabel.textContent =
      `${state.currentBookKo} ${state.currentChapter}장 ${state.currentVerseIdx + 1}절`);
    els.verseCount && (els.verseCount.textContent =
      `(${state.verses.length}절 중 ${state.currentVerseIdx + 1}절)`);

    if (els.verseText) {
      els.verseText.innerHTML = "";
      for (let i = 0; i < v.length; i++) {
        const s = document.createElement("span");
        s.textContent = v[i];
        s.style.color = "";
        els.verseText.appendChild(s);
      }
    }

    if (els.verseGrid) {
      [...els.verseGrid.children].forEach((btn, idx) =>
        btn.classList.toggle("active", idx===state.currentVerseIdx));
    }
  }

  function markVerseAsDone(verseIndex1Based) {
    const key = keyForChapter();
    if (!state.verseDoneMap[key]) state.verseDoneMap[key] = new Set();
    state.verseDoneMap[key].add(verseIndex1Based);

    if (els.verseGrid) {
      const btn = els.verseGrid.children[verseIndex1Based - 1];
      if (btn) {
        btn.classList.add("readok");
        btn.style.backgroundColor = "rgba(67,209,122,0.6)";
      }
    }

    if (state.verses.length > 0 && state.verseDoneMap[key].size === state.verses.length) {
      if (els.chapterGrid) {
        const idx = (state.currentChapter - 1);
        const chBtn = els.chapterGrid.children[idx];
        if (chBtn) {
          chBtn.classList.add("done");
          chBtn.style.backgroundColor = "rgba(67,209,122,0.8)";
        }
      }
    }
  }

  // ---------- Mic Level Meter ----------
  let audioCtx, analyser, micSrc, levelTimer, micStream;
  async function startMicLevel() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      micSrc = audioCtx.createMediaStreamSource(micStream);
      micSrc.connect(analyser);

      const dataArray = new Uint8Array(analyser.fftSize);

      function update() {
        if (!analyser) return;
        analyser.getByteTimeDomainData(dataArray);
        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / dataArray.length);
        const db = 20 * Math.log10(rms || 1e-6);
        if (els.micBar) els.micBar.style.width = Math.min(100, Math.max(0, rms * 400)) + "%";
        if (els.micDb) els.micDb.textContent = (db <= -60 ? "-∞" : db.toFixed(0)) + " dB";
        levelTimer = requestAnimationFrame(update);
      }
      update();
    } catch (e) {
      console.warn("[MicLevel] 마이크 접근 실패:", e);
    }
  }
  function stopMicLevel() {
    if (levelTimer) cancelAnimationFrame(levelTimer);
    levelTimer = null;
    if (audioCtx) { try { audioCtx.close(); } catch(_) {} }
    if (micStream) { try { micStream.getTracks().forEach(t=>t.stop()); } catch(_) {} }
    audioCtx = null; analyser = null; micSrc = null; micStream = null;
    if (els.micBar) els.micBar.style.width = "0%";
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
  function supportsSR(){ return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  function makeRecognizer(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = 'ko-KR';
    r.continuous = !IS_ANDROID;        // iOS/데스크탑은 continuous 허용
    r.interimResults = !IS_ANDROID;    // Android는 final만 취급
    try { r.maxAlternatives = 4; } catch(_) {}
    return r;
  }

  let loopTimer=null, watchdogTimer=null, noResultTimer=null;
  const ANDROID_WATCHDOG_MS  = 8500;
  const ANDROID_NORESULT_MS  = 7000;
  let lastStartTs=0, lastResultTs=0;

  function runRecognizerLoop(){
    if (!state.listening) return;
    const recog = makeRecognizer();
    if (!recog) {
      els.listenHint && (els.listenHint.innerHTML="⚠️ 음성인식 미지원(Chrome/Safari 권장)");
      alert("이 브라우저는 음성인식을 지원하지 않습니다.");
      stopListening();
      return;
    }
    state.recog = recog;

    recog.onresult = (evt)=>{
      lastResultTs = Date.now();
      if (noResultTimer) { clearTimeout(noResultTimer); noResultTimer = null; }
      noResultTimer = setTimeout(() => {
        if (!state.listening) return;
        try { state.recog && state.recog.abort?.(); } catch(_) {}
        runRecognizerLoop();
      }, ANDROID_NORESULT_MS);

      const v = state.verses[state.currentVerseIdx] || "";
      if (!v) return;
      const res = evt.results[evt.results.length-1]; if (!res) return;
      const tr = res[0]?.transcript || ""; if (!tr) return;

      // 간단: 현재 절 전체 텍스트를 음성으로 읽었다고 가정하고 어느정도 인식되면 완료 처리
      // (v3의 자모 매칭/하이라이트 없이, v2는 완료 트리거만)
      const clean = (s)=>s.normalize("NFKC").replace(/[^\p{L}\p{N} ]/gu," ").replace(/\s+/g," ").trim();
      const t = clean(v), heard = clean(tr);
      // 짧은 휴리스틱: 현재 절의 절반 길이 이상 매칭되면 완료 처리
      if (heard && t.includes(heard) || heard.length >= Math.max(6, Math.floor(t.length*0.5))) {
        completeVerse(true);
      }
    };

    const restart = () => {
      if (!state.listening) return;
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer=null; }
      if (noResultTimer) { clearTimeout(noResultTimer); noResultTimer=null; }
      try {
        if (state.recog) {
          state.recog.onresult=null; state.recog.onend=null; state.recog.onerror=null;
          state.recog.abort?.();
        }
      } catch(_) {}
      loopTimer = setTimeout(runRecognizerLoop, 250);
    };
    recog.onend = restart;

    recog.onerror = (e)=>{
      const err = e?.error || "";
      if (err === "aborted" || err === "no-speech") { restart(); return; }
      console.warn("[SR] error:", err, e);
      restart();
      if (err === "not-allowed" || err === "service-not-allowed") {
        alert("마이크 권한이 필요합니다. 주소창 오른쪽 마이크 아이콘을 확인하세요.");
      }
    };

    try {
      lastStartTs  = Date.now();
      lastResultTs = lastStartTs;

      if (watchdogTimer) { clearTimeout(watchdogTimer); }
      watchdogTimer = setTimeout(() => {
        if (!state.listening) return;
        if (lastResultTs === lastStartTs) {
          try { state.recog && state.recog.abort?.(); } catch(_) {}
          runRecognizerLoop();
        }
      }, ANDROID_WATCHDOG_MS);

      if (noResultTimer) { clearTimeout(noResultTimer); }
      noResultTimer = setTimeout(() => {
        if (!state.listening) return;
        try { state.recog && state.recog.abort?.(); } catch(_) {}
        runRecognizerLoop();
      }, ANDROID_NORESULT_MS);

      recog.start();
    } catch(e) {
      console.warn("recog.start 실패:", e);
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer=null; }
      if (noResultTimer) { clearTimeout(noResultTimer); noResultTimer=null; }
      loopTimer = setTimeout(runRecognizerLoop, 200);
    }
  }

  async function startListening(){
    if (state.listening) return;
    if (!supportsSR()){
      els.listenHint && (els.listenHint.innerHTML="⚠️ 음성인식 미지원(Chrome/Safari 권장)");
      alert("이 브라우저는 음성인식을 지원하지 않습니다.");
      return;
    }
    state.listening = true;
    els.btnToggleMic && (els.btnToggleMic.textContent="⏹️");
    startMicLevel();
    runRecognizerLoop();
  }

  function stopListening(){
    state.listening=false;
    if (loopTimer) { clearTimeout(loopTimer); loopTimer=null; }
    if (state.recog){
      try{ state.recog.onresult=null; state.recog.onend=null; state.recog.onerror=null; state.recog.abort?.(); }catch(_){}
      try{ state.recog.stop?.(); }catch(_){}
    }
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer=null; }
    if (noResultTimer) { clearTimeout(noResultTimer); noResultTimer=null; }

    els.btnToggleMic && (els.btnToggleMic.textContent="🎙️");
    stopMicLevel();
  }

  els.btnToggleMic?.addEventListener("click", ()=>{ if(!state.listening) startListening(); else stopListening(); });

  // ---------- 완료/자동이동 ----------
  async function advanceToNextVerse() {
    if (state.currentVerseIdx < state.verses.length - 1) {
      state.currentVerseIdx++;
      state.myStats.last.verse = state.currentVerseIdx + 1;
      saveLastPosition();
      updateVerseText();
      buildVerseGrid();
      return true;
    }
    return false;
  }

  async function completeVerse(force=false){
    await incVersesRead(1);
    markVerseAsDone(state.currentVerseIdx + 1);

    const auto = force ? true : (els.autoAdvance ? !!els.autoAdvance.checked : true);
    const b = getBookByKo(state.currentBookKo);

    if (auto){
      const moved = await advanceToNextVerse();
      if (!moved){
        await markChapterDone(b.id, state.currentChapter);
        if (state.currentChapter < b.ch) {
          const next = state.currentChapter + 1;
          await selectChapter(next);
          buildChapterGrid();
        } else {
          alert("이 권의 모든 장을 완료했습니다. 다른 권을 선택하세요.");
        }
        return;
      }
    }
  }

  // 앞/뒤 절 버튼
  els.btnNextVerse?.addEventListener("click", ()=>{
    if(!state.verses.length) return;
    if(state.currentVerseIdx<state.verses.length-1){
      state.currentVerseIdx++;
      state.myStats.last.verse = state.currentVerseIdx + 1;
      saveLastPosition();
      updateVerseText();
      buildVerseGrid();
    }
  });
  els.btnPrevVerse?.addEventListener("click", ()=>{
    if(!state.verses.length) return;
    if(state.currentVerseIdx>0){
      state.currentVerseIdx--;
      state.myStats.last.verse = state.currentVerseIdx + 1;
      saveLastPosition();
      updateVerseText();
      buildVerseGrid();
    }
  });

  // "해당절읽음" 버튼
  els.btnMarkRead?.addEventListener("click", async () => {
    if (!state.verses.length) return;

    await incVersesRead(1);
    markVerseAsDone(state.currentVerseIdx + 1);

    if (state.currentVerseIdx < state.verses.length - 1) {
      state.currentVerseIdx++;
      state.myStats.last.verse = state.currentVerseIdx + 1;
      saveLastPosition();
      updateVerseText();
      buildVerseGrid();
      return;
    }

    const b = getBookByKo(state.currentBookKo);
    await markChapterDone(b.id, state.currentChapter);
    state.myStats.last.verse = 0;
    state.myStats.last.chapter = state.currentChapter;
    saveLastPosition();

    if (state.currentChapter < b.ch) {
      const nextChapter = state.currentChapter + 1;
      await selectChapter(nextChapter);
      buildChapterGrid();
    } else {
      alert("이 권의 모든 장을 완료했습니다. 다른 권을 선택하세요.");
    }
  });

  // ---------- Leaderboard ----------
  async function loadLeaderboard() {
    if (!db || !els.leaderList) return;
    let qs; try { qs = await db.collection("users").orderBy("versesRead","desc").limit(20).get(); } catch (e) { return; }
    const list=[]; qs.forEach(doc=>list.push({id:doc.id, ...doc.data()}));
    els.leaderList.innerHTML="";
    list.forEach((u,idx)=>{
      const label = (u.nickname && String(u.nickname).trim())
        ? String(u.nickname).trim()
        : ((u.email || "").toString().split("@")[0] || `user-${String(u.id).slice(0,6)}`);
      const v = Number(u.versesRead||0), c = Number(u.chaptersRead||0);
      const li=document.createElement("li");
      li.innerHTML = `<strong>${idx+1}위</strong> ${label} · 절 ${v.toLocaleString()} · 장 ${c.toLocaleString()}`;
      els.leaderList.appendChild(li);
    });
  }

})();
