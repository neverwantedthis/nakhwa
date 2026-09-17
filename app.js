import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const permission = document.getElementById("permission");
const toast = document.getElementById("toast");
const scoreEl = document.getElementById("score");
const cuesEl = document.getElementById("cues");
const startBtn = document.getElementById("startBtn");
const startBtn2 = document.getElementById("startBtn2");
const startWithExampleBtn = document.getElementById("startWithExampleBtn");
const exampleBtn = document.getElementById("exampleBtn");
const coachRow = document.getElementById("coachRow");
const exampleWrap = document.getElementById("exampleWrap");
const ytBtn = document.getElementById("ytBtn");
const exampleImg = document.getElementById("exampleImg");
const hintText = document.getElementById("hintText");
const nowDancing = document.getElementById("nowDancing");

let poseLandmarker;
let lastVideoTime = -1;
let lastToastKey = "";
let lastToastAt = 0;
let loopStarted = false;
const poseHist = { hipY: [], hipX: [], t: [] };
let currentDance = "ardah";

const DANCES = {
  ardah: {
    nameAr: "العرضة",
    nameEn: "Ardah",
    label: "العرضة · Ardah",
    hint: "Proud upright chest, a slightly bent bounce in the knees, a raised sword arm, and a steady drum rhythm.",
    review: reviewArdah,
    ytQuery: "العرضة النجدية اليوم الوطني",
    example: ["images/guides/guide-ardah-1.png", "images/guides/guide-ardah-2.png"],
    exampleAlt: "مثال العرضة",
  },
  mezmar: {
    nameAr: "المزمار",
    nameEn: "Mezmar",
    label: "المزمار · Mezmar",
    hint: "Hijazi stick dance: wrists around chest height as if holding or clapping a stick, athletic knees, and a driving bounce.",
    review: reviewMezmar,
    ytQuery: "رقصة المزمار الحجازي",
    example: ["images/guides/guide-mezmar-1.png", "images/guides/guide-mezmar-2.png"],
    exampleAlt: "مثال المزمار",
  },
  tasheer: {
    nameAr: "التعشير",
    nameEn: "Tasheer",
    label: "التعشير · Tasheer",
    hint: "Rifle high, then explode upward. Look for an overhead arm and a real jump — bigger hip travel than Ardah.",
    review: reviewTasheer,
    ytQuery: "رقصة التعشير الحجاز",
    example: ["images/guides/guide-tasheer-1.png", "images/guides/guide-tasheer-2.png"],
    exampleAlt: "مثال التعشير",
  },
  khatwa: {
    nameAr: "الخطوة",
    nameEn: "Khatwa",
    label: "الخطوة · Khatwa",
    hint: "Southern stepping dance: stay tall, keep a light bounce, and travel side to side with the line.",
    review: reviewKhatwa,
    ytQuery: "رقصة الخطوة الجنوبية",
    example: ["images/guides/guide-khatwa-1.png", "images/guides/guide-khatwa-2.png"],
    exampleAlt: "مثال الخطوة",
  },
  samri: {
    nameAr: "السامري",
    nameEn: "Samri",
    label: "السامري · Samri",
    hint: "Night gathering energy: chest-height claps, a smaller bounce, no sword overhead.",
    review: reviewSamri,
    ytQuery: "السامري النجدي",
    example: ["images/guides/guide-samri-1.png", "images/guides/guide-samri-2.png"],
    exampleAlt: "مثال السامري",
  },
};

startBtn.addEventListener("click", () => startCamera(false));
startBtn2.addEventListener("click", () => startCamera(false));
if (startWithExampleBtn) {
  startWithExampleBtn.addEventListener("click", () => startCamera(true));
}
if (exampleBtn) {
  exampleBtn.addEventListener("click", () => {
    setExampleVisible(!exampleOn);
    if (exampleOn && !video.srcObject) startCamera(true);
  });
}
document.getElementById("danceNav").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-dance]");
  if (!btn) return;
  setDance(btn.dataset.dance);
});
let exampleTimer = 0;
let exampleFrame = 0;
let exampleOn = false;
syncMusicLink();

function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function syncMusicLink() {
  if (ytBtn) ytBtn.href = youtubeSearchUrl(DANCES[currentDance].ytQuery);
}

function setExampleVisible(on) {
  exampleOn = Boolean(on);
  if (coachRow) coachRow.classList.toggle("with-example", exampleOn);
  if (exampleWrap) exampleWrap.hidden = !exampleOn;
  if (exampleBtn) exampleBtn.textContent = exampleOn ? "بدون مثال" : "مع المثال";
  if (exampleOn) showExample(currentDance);
  else if (exampleTimer) {
    clearInterval(exampleTimer);
    exampleTimer = 0;
  }
}

function showExample(id) {
  const dance = DANCES[id];
  if (!exampleImg || !dance?.example?.length) return;
  exampleFrame = 0;
  exampleImg.src = dance.example[0];
  exampleImg.alt = dance.exampleAlt || dance.label;
  if (exampleTimer) clearInterval(exampleTimer);
  if (dance.example.length < 2) return;
  exampleTimer = setInterval(() => {
    exampleFrame = (exampleFrame + 1) % dance.example.length;
    exampleImg.src = dance.example[exampleFrame];
  }, 650);
}

function setDance(id) {
  if (!DANCES[id] || id === currentDance) return;
  currentDance = id;
  poseHist.hipY.length = 0;
  poseHist.hipX.length = 0;
  poseHist.t.length = 0;
  lastToastKey = "";
  nowDancing.innerHTML = `${DANCES[id].nameAr} · <span lang="en" dir="ltr">${DANCES[id].nameEn}</span>`;
  hintText.textContent = DANCES[id].hint;
  syncMusicLink();
  if (exampleOn) showExample(id);
  for (const chip of document.querySelectorAll(".dance-chip")) {
    chip.classList.toggle("is-on", chip.dataset.dance === id);
  }
}

async function ensurePose() {
  if (poseLandmarker) return;
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

function stopCamera() {
  const stream = video.srcObject;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  video.srcObject = null;
}

async function startCamera(withExample = false) {
  if (withExample) setExampleVisible(true);
  startBtn.disabled = true;
  startBtn2.disabled = true;
  if (startWithExampleBtn) startWithExampleBtn.disabled = true;
  startBtn.textContent = "…";
  try {
    await ensurePose();
    stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    permission.hidden = true;
    startBtn.disabled = false;
    startBtn2.disabled = false;
    if (startWithExampleBtn) startWithExampleBtn.disabled = false;
    startBtn.textContent = "ابدأ";
    startBtn2.textContent = "الكاميرا";
    if (!loopStarted) {
      loopStarted = true;
      requestAnimationFrame(loop);
    }
  } catch (err) {
    startBtn.disabled = false;
    startBtn2.disabled = false;
    if (startWithExampleBtn) startWithExampleBtn.disabled = false;
    startBtn.textContent = "ابدأ";
    maybeToast("ما قدرت أفتح الكاميرا. جرّب مرة ثانية.", "bad", "cam-fail");
    console.error(err);
  }
}

function loop() {
  if (video.readyState >= 2 && !video.paused) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = poseLandmarker.detectForVideo(video, performance.now());
      drawAndCoach(result);
    }
  }
  requestAnimationFrame(loop);
}

function drawAndCoach(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const landmarks = result.landmarks?.[0];
  if (!landmarks) {
    setPanel(0, ["الجسم مو واضح في الإطار. تراجع خطوة."]);
    maybeToast("الجسم مو في الإطار", "bad", "missing");
    return;
  }
  const review = DANCES[currentDance].review(landmarks);
  setPanel(review.score, review.cues);
  maybeToast(review.popup.text, review.popup.tone, review.popup.key);
}

function measure(lm) {
  const vis = (i) => (lm[i].visibility ?? 1) > 0.5;
  const midShoulder = midpoint(lm[11], lm[12]);
  const midHip = midpoint(lm[23], lm[24]);
  const leftKnee = jointAngle(lm[23], lm[25], lm[27]);
  const rightKnee = jointAngle(lm[24], lm[26], lm[28]);
  const now = performance.now();
  poseHist.t.push(now);
  poseHist.hipY.push(midHip.y);
  poseHist.hipX.push(midHip.x);
  while (poseHist.t.length && now - poseHist.t[0] > 1800) {
    poseHist.t.shift();
    poseHist.hipY.shift();
    poseHist.hipX.shift();
  }
  const chestY = (midShoulder.y + midHip.y) / 2;
  const wristBand = (w) => w.y > midShoulder.y - 0.04 && w.y < midHip.y - 0.02;
  return {
    bodyVisible: [0, 11, 12, 23, 24, 25, 26, 27, 28].every(vis),
    midShoulder,
    midHip,
    torsoTilt: Math.abs(angleFromVertical(midHip, midShoulder)),
    knee: Math.min(leftKnee, rightKnee),
    shoulderWidth: dist(lm[11], lm[12]),
    stance: dist(lm[27], lm[28]),
    leftArmUp: lm[15].y < lm[11].y - 0.05,
    rightArmUp: lm[16].y < lm[12].y - 0.05,
    overhead: lm[15].y < lm[0].y || lm[16].y < lm[0].y,
    wristsAtChest: wristBand(lm[15]) && wristBand(lm[16]),
    chestY,
  };
}

function bounce(minDelta = 0.018) {
  if (poseHist.hipY.length < 12) return false;
  return Math.max(...poseHist.hipY) - Math.min(...poseHist.hipY) > minDelta;
}

function sideStep() {
  if (poseHist.hipX.length < 12) return false;
  return Math.max(...poseHist.hipX) - Math.min(...poseHist.hipX) > 0.03;
}

function finish(score, cues, popup, goodLine) {
  score = Math.max(0, Math.min(100, score));
  if (score >= 80) cues.unshift(goodLine);
  else if (!cues.length) cues.push("Keep matching posture and rhythm for this dance.");
  return { score, cues, popup };
}

function reviewArdah(lm) {
  const m = measure(lm);
  const cues = [];
  let score = 100;
  const upright = m.torsoTilt < 18;
  const kneesReady = m.knee > 125 && m.knee < 172;
  const stanceOk = m.stance > m.shoulderWidth * 0.85 && m.stance < m.shoulderWidth * 2.4;
  const swordArm = m.leftArmUp || m.rightArmUp;
  const rhythm = bounce(0.018);

  if (!m.bodyVisible) {
    score -= 40;
    cues.push("Need a fuller body shot — head, hips, knees, and feet.");
  }
  if (!upright) {
    score -= 20;
    cues.push("Chest up. Keep your torso proud and mostly upright.");
  }
  if (m.knee >= 172) {
    score -= 15;
    cues.push("Unlock your knees a little. Ardah has a bounce, not locked legs.");
  } else if (m.knee <= 125) {
    score -= 15;
    cues.push("Don't drop into a squat. Stay taller, with a light bend.");
  }
  if (!stanceOk) {
    score -= 10;
    cues.push("Open your stance a bit — feet about shoulder-width, ready to step.");
  }
  if (!swordArm) {
    score -= 25;
    cues.push("Raise a sword arm. At least one wrist should sit above the shoulder.");
  }
  if (m.bodyVisible && !rhythm) {
    score -= 15;
    cues.push("Find the drum: bounce or step so your hips move with a beat.");
  }

  let popup;
  if (!m.bodyVisible) popup = { text: "Whole body in frame", tone: "bad", key: "frame" };
  else if (!swordArm) popup = { text: "Raise your sword arm", tone: "warn", key: "arm" };
  else if (!upright) popup = { text: "Chest up — proud posture", tone: "warn", key: "torso" };
  else if (!kneesReady) popup = { text: "Light bounce in the knees", tone: "warn", key: "knees" };
  else if (!rhythm) popup = { text: "Move with the rhythm", tone: "warn", key: "rhythm" };
  else popup = { text: "Yes — that's the Ardah line", tone: "ok", key: "good" };

  return finish(score, cues, popup, "Strong Ardah line — keep that posture.");
}

function reviewMezmar(lm) {
  const m = measure(lm);
  const cues = [];
  let score = 100;
  const upright = m.torsoTilt < 22;
  const kneesReady = m.knee > 115 && m.knee < 165;
  const rhythm = bounce(0.022);

  if (!m.bodyVisible) {
    score -= 40;
    cues.push("Step back so the full body is in view.");
  }
  if (!upright) {
    score -= 15;
    cues.push("Stay lifted through the chest while the stick work happens in front of you.");
  }
  if (!m.wristsAtChest && !m.leftArmUp && !m.rightArmUp) {
    score -= 25;
    cues.push("Bring both hands in — Mezmar lives around chest height, stick or clap.");
  }
  if (m.overhead) {
    score -= 15;
    cues.push("Don't throw the rifle-high Ardah arm. Keep the stick work closer to the body.");
  }
  if (m.knee >= 165) {
    score -= 15;
    cues.push("Bend the knees more. Mezmar is springier than a standing Ardah row.");
  } else if (m.knee <= 115) {
    score -= 10;
    cues.push("Don't collapse too low — athletic, not a squat.");
  }
  if (m.bodyVisible && !rhythm) {
    score -= 20;
    cues.push("Drive the bounce. Mezmar needs a clearer up-down than a gentle sway.");
  }

  let popup;
  if (!m.bodyVisible) popup = { text: "Whole body in frame", tone: "bad", key: "frame" };
  else if (m.overhead) popup = { text: "Stick work at chest, not overhead", tone: "warn", key: "arm" };
  else if (!m.wristsAtChest && !m.leftArmUp && !m.rightArmUp) popup = { text: "Hands in for the stick", tone: "warn", key: "arm" };
  else if (!kneesReady) popup = { text: "Springier knees", tone: "warn", key: "knees" };
  else if (!rhythm) popup = { text: "Bigger Mezmar bounce", tone: "warn", key: "rhythm" };
  else popup = { text: "That's Hijazi fire", tone: "ok", key: "good" };

  return finish(score, cues, popup, "Sharp Mezmar — keep that spring.");
}

function reviewTasheer(lm) {
  const m = measure(lm);
  const cues = [];
  let score = 100;
  const jump = bounce(0.04);
  const kneesReady = m.knee > 100 && m.knee < 170;

  if (!m.bodyVisible) {
    score -= 40;
    cues.push("Need head-to-feet so the jump actually reads.");
  }
  if (!m.overhead && !m.leftArmUp && !m.rightArmUp) {
    score -= 30;
    cues.push("Lift the rifle. Tasheer wants an arm high, then the jump.");
  }
  if (m.bodyVisible && !jump) {
    score -= 30;
    cues.push("Jump. A small Ardah bounce is not enough — hips should travel.");
  }
  if (m.knee >= 170) {
    score -= 10;
    cues.push("Load the knees before you leave the ground.");
  }

  let popup;
  if (!m.bodyVisible) popup = { text: "Whole body in frame", tone: "bad", key: "frame" };
  else if (!m.overhead && !m.leftArmUp && !m.rightArmUp) popup = { text: "Rifle arm up", tone: "warn", key: "arm" };
  else if (!jump) popup = { text: "Jump with it", tone: "warn", key: "rhythm" };
  else if (!kneesReady) popup = { text: "Load the knees", tone: "warn", key: "knees" };
  else popup = { text: "That's Tasheer height", tone: "ok", key: "good" };

  return finish(score, cues, popup, "Clean Tasheer — height and rifle together.");
}

function reviewKhatwa(lm) {
  const m = measure(lm);
  const cues = [];
  let score = 100;
  const upright = m.torsoTilt < 20;
  const lateral = sideStep();
  const rhythm = bounce(0.015);
  const kneesReady = m.knee > 130 && m.knee < 175;

  if (!m.bodyVisible) {
    score -= 40;
    cues.push("Show the feet — Khatwa is a stepping dance.");
  }
  if (!upright) {
    score -= 15;
    cues.push("Stay tall in the line. Don't fold forward.");
  }
  if (m.overhead) {
    score -= 10;
    cues.push("Keep the dagger/hand work lower than a full Ardah sword salute.");
  }
  if (m.bodyVisible && !lateral) {
    score -= 25;
    cues.push("Travel sideways. Khatwa should shift the hips left and right.");
  }
  if (m.bodyVisible && !rhythm) {
    score -= 10;
    cues.push("Add a light bounce on top of the side step.");
  }

  let popup;
  if (!m.bodyVisible) popup = { text: "Feet in the shot", tone: "bad", key: "frame" };
  else if (!upright) popup = { text: "Stay tall", tone: "warn", key: "torso" };
  else if (!lateral) popup = { text: "Step with the line", tone: "warn", key: "rhythm" };
  else if (!kneesReady) popup = { text: "Soft knees for the step", tone: "warn", key: "knees" };
  else popup = { text: "That's the southern step", tone: "ok", key: "good" };

  return finish(score, cues, popup, "Good Khatwa — the line is moving.");
}

function reviewSamri(lm) {
  const m = measure(lm);
  const cues = [];
  let score = 100;
  const upright = m.torsoTilt < 18;
  const rhythm = bounce(0.012);
  const swordHigh = m.overhead || (m.leftArmUp && m.rightArmUp);

  if (!m.bodyVisible) {
    score -= 35;
    cues.push("Stand where the camera sees head to hips at least.");
  }
  if (!upright) {
    score -= 15;
    cues.push("Samri stays composed — lift the chest.");
  }
  if (swordHigh) {
    score -= 25;
    cues.push("Drop the sword salute. Samri claps at the chest, it doesn't raise a blade.");
  } else if (!m.wristsAtChest) {
    score -= 25;
    cues.push("Clap at chest height. Both wrists should sit between shoulders and ribs.");
  }
  if (m.bodyVisible && !rhythm) {
    score -= 15;
    cues.push("Sway with the samri beat — smaller than Ardah, but still moving.");
  }

  let popup;
  if (!m.bodyVisible) popup = { text: "Get in frame", tone: "bad", key: "frame" };
  else if (swordHigh) popup = { text: "This isn't Ardah — clap", tone: "warn", key: "arm" };
  else if (!m.wristsAtChest) popup = { text: "Clap at the chest", tone: "warn", key: "arm" };
  else if (!upright) popup = { text: "Composed chest", tone: "warn", key: "torso" };
  else if (!rhythm) popup = { text: "Sway with the samri", tone: "warn", key: "rhythm" };
  else popup = { text: "That's the majlis feel", tone: "ok", key: "good" };

  return finish(score, cues, popup, "Warm Samri — keep the claps and sway.");
}

function setPanel(score, cues) {
  scoreEl.textContent = Number.isFinite(score) ? `${Math.round(score)}` : "—";
  cuesEl.innerHTML = cues.map((c) => `<li>${c}</li>`).join("");
}

function maybeToast(text, tone, key) {
  const now = performance.now();
  if (key === lastToastKey && now - lastToastAt < 1600) return;
  lastToastKey = key;
  lastToastAt = now;
  toast.hidden = false;
  toast.textContent = text;
  toast.className = `toast ${tone}`;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleFromVertical(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

function jointAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y) || 1;
  return (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
}
