/* 말씀읽기APP — Firebase 로그인/진도저장 + bible.json
   + 안드로이드 최적화 음성매칭
   + 마이크는 버튼으로만 ON/OFF
   + 절 완료시 절 버튼 색, 장 모두 완료시 장 버튼 색
   + 절 자동이동/장 자동이동(성공 처리)
   + "해당절읽음" 버튼 지원
   + 마이크 ON일 때 음성모드 변경 금지(라디오 없을 시 자동 무시)
*/
(() => {
  // ---------- PWA ----------
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
    verseContainer: document.getElementById("verseContainer"),
    heardBox: document.getElementById("heardBox"),
  };
   
  // 인식문장 박스가 없으면 동적 생성
  function ensureHeardBox() {
    if (!els.heardBox) {
      const box = document.createElement("div");
      box.id = "heardBox";
      box.style.cssText = [
        "margin-top:8px",
        "padding:8px 10px",
        "border-radius:8px",
        "background:#0f1229",
        "color:#cfe3ff",
        "font-size:14px",
        "line-height:1.5",
        "white-space:pre-wrap",
      ].join(";");
      (els.verseContainer || document.body).appendChild(box);
      els.heardBox = box;
    }
  }
  ensureHeardBox();
   
  // 모달이 닫혀있을 때는 클릭 차단
  if (els.matrixModal) els.matrixModal.style.pointerEvents = "none";

  // ---------- BOOKS 접근(항상 최신) ----------
  function getBooks(){ return Array.isArray(window.BOOKS) ? window.BOOKS : []; }
  const getBookByKo = (ko) => getBooks().find(b => b.ko === ko);

  // ---------- State ----------
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
    heardJ: "",         // 자모 누적
    heardRaw: "",       // 음성 인식된 ‘원문 텍스트’ 누적(표시/저장용)
    heardText: "",      // 마지막 인식 텍스트(표시용)
    _advancing:false,   // 자동 이동 제어
    paintTimer: null,   // 약간 늦게 칠하기용 타이머
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

  // 인식된 문장 출력 박스(밝은 박스) — 필요 시 사용
  function setupHeardOut(){
    if (!els.verseContainer) return;
    let box = document.getElementById("heardOut");
    if (!box){
      box = document.createElement("div");
      box.id = "heardOut";
      box.style.marginTop = "8px";
      box.style.padding = "8px 10px";
      box.style.border = "1px solid #e2e8f0";
      box.style.borderRadius = "8px";
      box.style.background = "#f8fafc";
      box.innerHTML = '<small class="muted">🎧 인식된 문장</small><div id="heardTextLine" style="margin-top:4px; font-size:14px; line-height:1.4;"></div>';
      els.verseContainer.appendChild(box);
    }
    els.heardTextLine = document.getElementById("heardTextLine");
  }
  setupHeardOut();

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
  initStrictnessUI();

  // ---------- Auth UX ----------
  function mapAuthError(e) {
    const code = e?.code || "";
    if (code.includes("invalid-email")) return "이메일 형식이 올바르지 않습니다.";
    if (code.includes("email-already-in-use")) return "이미 가입된 이메일입니다. 로그인하세요.";
    if (code.includes("weak-password")) return "비밀번호를 6자 이상으로 입력하세요.";
    if (code.includes("operation-not-allowed")) return "이메일/비밀번호 로그인이 비활성화되어 있습니다. 콘솔에서 활성화해주세요.";
    if (code.includes("network-request-failed")) return "네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.";
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

  // 책 드롭다운 채우기 (books.js 로드 지연 대비)
  function buildBookSelect() {
    if (!els.bookSelect) return;

    const books = getBooks();
    if (!books.length) {
      setTimeout(buildBookSelect, 150);
      return;
    }

    els.bookSelect.innerHTML = "";
    for (const b of books) {
      const opt = document.createElement("option");
      opt.value = b.ko;
      opt.textContent = b.ko;
      els.bookSelect.appendChild(opt);
    }

    const last = state.myStats?.last;
    if (last?.bookKo && books.some(b => b.ko === last.bookKo)) {
      els.bookSelect.value = last.bookKo;
      state.currentBookKo = last.bookKo;
      buildChapterGrid();
      if (last.chapter) {
        selectChapter(last.chapter).then(() => {
          if (Number.isInteger(last.verse)) {
            state.currentVerseIdx = Math.max(0, (last.verse || 1) - 1);
            updateVerseText();
          }
        });
      }
    } else {
      els.bookSelect.value = books[0]?.ko || "";
      state.currentBookKo = els.bookSelect.value;
      buildChapterGrid();
    }
  }

  // 책 변경 핸들러
  els.bookSelect?.addEventListener("change", () => {
    state.currentBookKo = els.bookSelect.value;
    state.currentChapter = null; state.verses = []; state.currentVerseIdx = 0;
    els.verseGrid && (els.verseGrid.innerHTML = "");
    els.verseText && (els.verseText.textContent = "장과 절을 선택하세요.");
    buildChapterGrid();
    state.myStats.last = { bookKo: state.currentBookKo, chapter: null, verse: 0 };
    saveLastPosition();
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

  function keyForChapter(){ return `${state.currentBookKo}#${state.currentChapter}`; }

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

  // ---------- 표시/매칭 ----------
  // ✅ 새 절로 넘어갈 때, 표시/히스토리/타이밍을 한 번에 초기화
function resetHeard() {
  // 화면 표시 텍스트 초기화
  if (els.heardBox) els.heardBox.textContent = "";
  if (els.heardTextLine) els.heardTextLine.textContent = "";

  // STT 누적/중간 상태 초기화
  if (state._sr) {
    state._sr.historyTokens = [];
    state._sr.historyBase   = [];
  }
  state.heardText = "";
  state.heardRaw  = "";
  state.heardJ    = "";

  // 페인트/매칭 타이밍 초기화
  state.paintedPrefix = 0;
  state.pendingPaint  = 0;
  state.ignoreUntilTs = 0;
  if (state.paintTimer) { clearTimeout(state.paintTimer); state.paintTimer = null; }
}

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
  function levenshteinDistance(a, b){
    const n = a.length, m = b.length;
    if (n === 0) return m;
    if (m === 0) return n;
    let s = a, t = b;
    if (m < n) { s = b; t = a; }
    const rows = s.length + 1;
    const cols = t.length + 1;
    const dp = new Uint16Array(rows);
    for (let i=0;i<rows;i++) dp[i]=i;
    for (let j=1;j<cols;j++){
      let prev = dp[0];
      dp[0] = j;
      for (let i=1;i<rows;i++){
        const tmp = dp[i];
        const cost = (s[i-1] === t[j-1]) ? 0 : 1;
        dp[i] = Math.min(
          dp[i] + 1,        // 삭제
          dp[i-1] + 1,      // 삽입
          prev + cost       // 치환/일치
        );
        prev = tmp;
      }
    }
    return dp[rows-1];
  }
  function similarityToTarget(targetText, spokenText){
    const tJ = normalizeToJamo(targetText, true);
    const sJ = normalizeToJamo(spokenText, true);
    if (!tJ.length && !sJ.length) return 1;
    if (!tJ.length || !sJ.length) return 0;
    const dist = levenshteinDistance(tJ, sJ);
    const denom = Math.max(tJ.length, sJ.length, 1);
    return 1 - (dist / denom);
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
   
     // ✅ 한 줄로 깔끔히 초기화(표시 + STT 히스토리 + 페인트 타이머)
     resetHeard();
     state._advancing = false;
   
     state.targetJ = normalizeToJamo(v, false);
     state.charCumJamo = buildCharToJamoCumMap(v);
   
     // (이하 기존 표시/라벨/버튼 활성화 로직 그대로 유지)
     els.locLabel && (els.locLabel.textContent =
       `${state.currentBookKo} ${state.currentChapter}장 ${state.currentVerseIdx + 1}절`);
     if (els.verseText) {
       els.verseText.innerHTML = "";
       for (let i = 0; i < v.length; i++) {
         const s = document.createElement("span");
         s.textContent = v[i];
         s.style.color = "";
         els.verseText.appendChild(s);
       }
     }

    state.targetJ = normalizeToJamo(v, false);
    state.charCumJamo = buildCharToJamoCumMap(v);

    els.locLabel && (els.locLabel.textContent =
      `${state.currentBookKo} ${state.currentChapter}장 ${state.currentVerseIdx + 1}절`);
    if (els.verseText) {
      els.verseText.innerHTML = "";
      for (let i = 0; i < v.length; i++) {
        const s = document.createElement("span");
        s.textContent = v[i];
        s.style.color = "";
        els.verseText.appendChild(s);
      }
    }
    els.verseCount && (els.verseCount.textContent =
      `(${state.verses.length}절 중 ${state.currentVerseIdx + 1}절)`);
    if (els.verseGrid) {
      [...els.verseGrid.children].forEach((btn, idx) =>
        btn.classList.toggle("active", idx===state.currentVerseIdx));
    }

    if (els.listenHint){
      els.listenHint.textContent = "음성을 말씀하시면 인식된 문장을 아래에 보여드려요. (유사도 90% 이상이면 자동으로 다음 절)";
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

  // ---------- 마이크 레벨 ----------
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

  // ---------- STT (Android Web, 강력 중복제거 + 간단 구두점 보정, 앱 통합판) ----------
  (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btnMic = els.btnToggleMic;
    const hintEl = els.listenHint;

    // STT 상태(앱 구조 유지)
    state._sr = {
      rec: null,
      listening: false,
      userStopped: false,
      historyTokens: [],
      historyBase: []
    };

    // 숫자 → 한글 수사 변환 (본문/인식 텍스트 통일)
    function toHangulDigitsAll(input) {
      if (!input) return input;
      return input.replace(/-?\d+(?:[.,:/-]\d+)*?/g, (token) => convertToken(token));
    }
    function convertToken(token) {
      const parts = token.split(/([.:/,\-])/);
      return parts.map(p => {
        if (/^-?\d+$/.test(p)) return intToHangul(p);
        if (/^\d+\.\d+$/.test(p)) return decimalToHangul(p);
        return p === '.' ? '점' : p;
      }).join('');
    }
    const _N = ['영','일','이','삼','사','오','육','칠','팔','구'];
    const _U_SMALL = ['', '십', '백', '천'];
    const _U_BIG   = ['', '만', '억', '조', '경'];
    function intToHangul(numStr){
      let neg = false;
      if (numStr.startsWith('-')) { neg = true; numStr = numStr.slice(1); }
      if (numStr === '0') return '영';
      numStr = numStr.replace(/^0+/, '');
      const chunks = [];
      for (let i = numStr.length; i > 0; i -= 4) {
        chunks.unshift(numStr.substring(Math.max(0, i-4), i));
      }
      let out = [];
      chunks.forEach((chunk, idxFromLeft) => {
        const w = fourToHangul(chunk);
        if (w) {
          const bigUnit = _U_BIG[chunks.length - idxFromLeft - 1] || '';
          out.push(w + bigUnit);
        }
      });
      return (neg ? '마이너스 ' : '') + out.join('');
    }
    function fourToHangul(chunk){
      chunk = chunk.padStart(4, '0');
      let res = '';
      for (let i = 0; i < 4; i++){
        const d = +chunk[i];
        if (d === 0) continue;
        const unit = _U_SMALL[4 - i - 1];
        const digit = (d === 1 && unit) ? '' : _N[d];
        res += digit + unit;
      }
      return res || '';
    }
    function decimalToHangul(s){
      const [a,b] = s.split('.');
      const left = intToHangul(a);
      const right = b.split('').map(d => _N[+d]).join(' ');
      return `${left}점 ${right}`;
    }

    // 구두점 보정/토크나이즈
    const normalizeSpaces = (s)=> s.replace(/\s+/g,' ').trim();
    const stripPuncTail   = (w)=> w.replace(/[\.,!?;:·…~]+$/u,'');
    const tokenize        = (s)=> normalizeSpaces(s).split(' ').filter(Boolean);
    const baseTokens      = (tokens)=> tokens.map(t=> stripPuncTail(t.toLowerCase()));
    function punctuate(str){
      let s = normalizeSpaces(str);
      s = s.replace(/([가-힣a-zA-Z0-9\)])\s*(?:\n|$)/g, '$1.\n');
      s = s.replace(/\.\.+/g,'.');
      s = s.replace(/(^|[\.!?]\s+)([a-z])/g, (m,p1,p2)=> p1 + p2.toUpperCase());
      return s;
    }
    function collapseConsecutiveSentences(text){
      const parts = normalizeSpaces(text).split(/(?<=[\.!?\u2026\u3002])\s+/);
      const out = [];
      for(const p of parts){
        const t = (p||'').trim(); if(!t) continue;
        const last = out[out.length-1] || '';
        if(last === t) continue;
        if(last && (t.startsWith(last) || last.startsWith(t))){
          out[out.length-1] = (t.length >= last.length) ? t : last;
        } else out.push(t);
      }
      return out.join(' ');
    }

    // 최종 누적 + 중복제거 → 화면반영 → 매칭(최종)
    function appendFinalDedup(newText){
      const newT = tokenize(newText);
      const newB = baseTokens(newT);
      if(newT.length === 0) return;

      if(state._sr.historyTokens.length){
        const tailLen = Math.min(state._sr.historyBase.length, 80, newB.length);
        let k = 0;
        for(let len = tailLen; len > 0; len--){
          const suffix = state._sr.historyBase.slice(-len).join(' ');
          const prefix = newB.slice(0, len).join(' ');
          if(suffix === prefix){ k = len; break; }
        }
        const remainderT = newT.slice(k);
        const remainderB = newB.slice(k);
        if(remainderT.length === 0) return;
        state._sr.historyTokens = state._sr.historyTokens.concat(remainderT);
        state._sr.historyBase   = state._sr.historyBase.concat(remainderB);
      } else {
        state._sr.historyTokens = newT.slice();
        state._sr.historyBase   = newB.slice();
      }

      const rebuilt = state._sr.historyTokens.join(' ');
      const compact = collapseConsecutiveSentences(rebuilt);
      state._sr.historyTokens = tokenize(compact);
      state._sr.historyBase   = baseTokens(state._sr.historyTokens);

      const finalText = punctuate(toHangulDigitsAll(state._sr.historyTokens.join(' ')));
      if (els.heardBox) els.heardBox.textContent = finalText;

      _applyMatchingAndMaybeAdvance(true, finalText);
    }

    // 중간 후보 → 화면반영 → 매칭(중간)
    function applyInterimCandidate(interimRaw){
      if (!interimRaw) return;
      const candidate = toHangulDigitsAll(
        (state._sr.historyTokens.join(' ') + ' ' + interimRaw).trim()
      );
      if (els.heardBox) els.heardBox.textContent = punctuate(candidate);
      _applyMatchingAndMaybeAdvance(false, candidate);
    }

    // 매칭/페인트/자동이동 (새 STT에서 사용)
    function _applyMatchingAndMaybeAdvance(isFinal, candidateFullText){
      let v = state.verses[state.currentVerseIdx] || "";
      if(!v) return;
      if(Date.now() < state.ignoreUntilTs) return;

      const vSafe    = toHangulDigitsAll(v);
      const candSafe = toHangulDigitsAll(candidateFullText);

      const sim = similarityToTarget(vSafe, candSafe);
      const targetLenJamo = (state.targetJ || normalizeToJamo(vSafe, false)).length;

      const paintTo = Math.min(targetLenJamo, Math.floor(sim * targetLenJamo));
      schedulePaint(paintTo);

      if(isFinal && sim >= 0.90){
        if(!state._advancing){
          state._advancing = true;
          setTimeout(async () => {
            await completeVerse(true);
            state._advancing = false;
          }, 120);
        }
      }
    }

    // recognizer 생성/수명주기
    function createRecognizer(){
      if(!SR) return null;
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = 'ko-KR';
      try { r.maxAlternatives = 4; } catch(_){}
      return r;
    }
    function supportsSR(){ return !!SR; }

    async function startListening(showAlert=true){
      if (state._sr.listening) return;
      if (!supportsSR()){
        if (hintEl) hintEl.innerHTML="⚠️ 음성인식 미지원(Chrome/Samsung Internet 권장) — HTTPS에서 사용하세요.";
        if (showAlert) alert("이 브라우저는 음성인식을 지원하지 않습니다.");
        return;
      }

      await startMicLevel();

      state._sr.userStopped = false;
      state._sr.listening   = true;
      state._sr.historyTokens = [];
      state._sr.historyBase   = [];
      state.paintedPrefix   = 0;
      state.ignoreUntilTs   = 0;
      state._advancing      = false;
      if (state.paintTimer){ clearTimeout(state.paintTimer); state.paintTimer=null; }
      if (els.heardBox) els.heardBox.textContent = "";
      if (btnMic) btnMic.textContent="⏹️";
      refreshRecogModeLock();

      state._sr.rec = createRecognizer();
      if(!state._sr.rec){
        alert("음성인식 초기화 실패");
        stopListening();
        return;
      }

      state._sr.rec.onresult = (e) => {
        let interim = '';
        let fin = '';
        for (let i = e.resultIndex; i < e.results.length; i++){
          const r = e.results[i];
          if(r.isFinal) fin += r[0].transcript;
          else interim += r[0].transcript;
        }

        if (interim) {
          const interimSafe = interim.replace(/\d/g, d => "영일이삼사오육칠팔구"[d]);
          applyInterimCandidate(interimSafe);
        }

        if (fin) {
          const finSafe = fin.replace(/\d/g, d => "영일이삼사오육칠팔구"[d]);
          appendFinalDedup(finSafe);
        }
      };

      state._sr.rec.onerror = (e) => {
        const err = e?.error || '';
        if (err === 'not-allowed' || err === 'service-not-allowed'){
          hintEl && (hintEl.textContent = "마이크 권한이 거부되었습니다. 주소창의 마이크 아이콘을 확인하세요.");
        } else if (err === 'network'){
          hintEl && (hintEl.textContent = "네트워크 오류로 인식이 중단되었습니다.");
        } else {
          hintEl && (hintEl.textContent = `인식 오류: ${err}`);
        }
      };

      state._sr.rec.onend = () => {
        if(!state._sr.userStopped){
          try { state._sr.rec && state._sr.rec.start(); } catch(_){}
        }
      };

      try { state._sr.rec.start(); } catch(e){
        console.warn("rec.start 실패:", e);
        stopListening(false);
        return;
      }
    }

    function stopListening(resetBtn=true){
      state._sr.userStopped = true;
      state._sr.listening   = false;

      if(state._sr.rec){
        try{
          state._sr.rec.onresult=null;
          state._sr.rec.onerror=null;
          state._sr.rec.onend=null;
          state._sr.rec.abort?.();
          state._sr.rec.stop?.();
        }catch(_){}
        state._sr.rec = null;
      }

      stopMicLevel();
      if (resetBtn && btnMic) btnMic.textContent="🎙️";
      refreshRecogModeLock();
    }

    // 앱의 마이크 토글 버튼 연결
    els.btnToggleMic?.addEventListener("click", ()=>{ 
      if(!state._sr.listening) startListening(); 
      else stopListening(); 
    });

    // 필요 시 전역 노출
    window.__stt = { startListening, stopListening };
  })();

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
        // ✅ 자동이동 OFF 시에도 즉시 표시/히스토리 정리
        resetHeard();
        state.ignoreUntilTs = Date.now() + 300;
      }
  }

  // ---------- 앞/뒤 절 버튼 ----------
  els.btnNextVerse?.addEventListener("click", ()=>{
    if(!state.verses.length) return;
    if(state.currentVerseIdx<state.verses.length-1){
      state.currentVerseIdx++;
      state.myStats.last.verse = state.currentVerseIdx + 1;
      saveLastPosition();
      updateVerseText();
      buildVerseGrid();
      state.paintedPrefix=0; state.heardJ=""; state.ignoreUntilTs = Date.now() + 300;
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
      state.paintedPrefix=0; state.heardJ=""; state.ignoreUntilTs = Date.now() + 300;
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
      state.paintedPrefix = 0;
      state.heardJ = "";
      state.ignoreUntilTs = Date.now() + 500;
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
    radios.forEach(r => { r.disabled = state._sr?.listening; });
  }
  document.querySelectorAll('input[name=recogMode]')?.forEach(radio=>{
    radio.addEventListener('change', (e)=>{
      if (state._sr?.listening) {
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
    thead.appendChild(trBottom); // (타이포 수정: theadj -> thead)
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
