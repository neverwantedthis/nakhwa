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
const sampleBtn = document.getElementById("sampleBtn");
const sampleBtn2 = document.getElementById("sampleBtn2");
const fileInput = document.getElementById("fileInput");
const fileInput2 = document.getElementById("fileInput2");

const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28],
];

let poseLandmarker;
let lastVideoTime = -1;
let lastToastKey = "";
let lastToastAt = 0;
let loopStarted = false;
let objectUrl = "";
let sampleCache = {};
let sampleAnimId = 0;
let samplePlaying = false;
const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d");
const poseHist = { hipY: [], hipX: [], t: [] };
let currentDance = "ardah";

const DANCES = {
  ardah: {
    short: "Ardah",
    label: "Ardah · العرضة",
    hint: "Proud upright chest, a slightly bent bounce in the knees, a raised sword arm, and a steady drum rhythm.",
    review: reviewArdah,
    frames: [
      "samples/ardah-frame-1.png",
      "samples/ardah-frame-2.png",
      "samples/ardah-frame-3.png",
      "samples/ardah-frame-4.png",
    ],
    order: [0, 1, 2, 3, 2, 1],
    motion: { x: 8, y: 18 },
    interval: 220,
  },
  mezmar: {
    short: "Mezmar",
    label: "Mezmar · المزمار",
    hint: "Hijazi stick dance: wrists around chest height as if holding or clapping a stick, athletic knees, and a driving bounce.",
    review: reviewMezmar,
    frames: ["samples/mezmar-frame-1.png", "samples/mezmar-frame-2.png"],
    order: [0, 1],
    motion: { x: 4, y: 40 },
    interval: 180,
  },
  tasheer: {
    short: "Ta'sheer",
    label: "Ta'sheer · التعشير",
    hint: "Rifle high, then explode upward. Look for an overhead arm and a real jump — bigger hip travel than Ardah.",
    review: reviewTasheer,
    frames: ["samples/tasheer-frame-1.png", "samples/tasheer-frame-2.png"],
    order: [0, 1],
    motion: { x: 6, y: 96 },
    interval: 200,
  },
  khatwa: {
    short: "Khatwa",
    label: "Khatwa · الخطوة",
    hint: "Southern stepping dance: stay tall, keep a light bounce, and travel side to side with the line.",
    review: reviewKhatwa,
    frames: ["samples/khatwa-frame-1.png", "samples/khatwa-frame-2.png"],
    order: [0, 1],
    motion: { x: 78, y: 18 },
    interval: 240,
  },
  samri: {
    short: "Samri",
    label: "Samri · السامري",
    hint: "Night gathering energy: chest-height claps, a smaller bounce, no sword overhead.",
    review: reviewSamri,
    frames: ["samples/samri-frame-1.png", "samples/samri-frame-2.png"],
    order: [0, 1],
    motion: { x: 6, y: 16 },
    interval: 260,
  },
};

const hintText = document.getElementById("hintText");
const nowDancing = document.getElementById("nowDancing");

startBtn.addEventListener("click", startCamera);
startBtn2.addEventListener("click", startCamera);
sampleBtn.addEventListener("click", startDanceSample);
sampleBtn2.addEventListener("click", startDanceSample);
fileInput.addEventListener("change", onFilePicked);
fileInput2.addEventListener("change", onFilePicked);
document.getElementById("danceNav").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-dance]");
  if (!btn) return;
  setDance(btn.dataset.dance);
});

function setDance(id) {
  if (!DANCES[id] || id === currentDance) return;
  const restartSample = samplePlaying;
  currentDance = id;
  poseHist.hipY.length = 0;
  poseHist.hipX.length = 0;
  poseHist.t.length = 0;
  lastToastKey = "";
  nowDancing.textContent = DANCES[id].label;
  hintText.textContent = DANCES[id].hint;
  updateSampleButtons();
  for (const chip of document.querySelectorAll(".dance-chip")) {
    chip.classList.toggle("is-on", chip.dataset.dance === id);
  }
  if (restartSample) startDanceSample();
}

function sampleButtonLabel(id, long) {
  const name = DANCES[id].short;
  return long ? `Try ${name} sample` : `${name} sample`;
}

function updateSampleButtons() {
  sampleBtn.textContent = sampleButtonLabel(currentDance, true);
  sampleBtn2.textContent = sampleButtonLabel(currentDance, false);
}

function onFilePicked(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  startVideoFile(objectUrl, true);
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

function stopSampleClip() {
  samplePlaying = false;
  if (sampleAnimId) cancelAnimationFrame(sampleAnimId);
  sampleAnimId = 0;
}

function stopCamera() {
  stopSampleClip();
  const stream = video.srcObject;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  video.srcObject = null;
}

async function startCamera() {
  startBtn.disabled = true;
  startBtn.textContent = "Loading pose model…";
  try {
    await ensurePose();
    stopCamera();
    video.classList.remove("from-file");
    video.controls = false;
    video.loop = false;
    video.removeAttribute("src");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    beginPlayback();
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = "Try again";
    maybeToast("Camera or model failed to start. Use localhost, not a file:// page.", "bad", "cam-fail");
    console.error(err);
  }
}

async function loadSampleFrames(id) {
  if (sampleCache[id]) return sampleCache[id];
  const dance = DANCES[id];
  sampleCache[id] = await Promise.all(
    dance.frames.map(
      (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`Missing ${src}`));
          img.src = src;
        })
    )
  );
  return sampleCache[id];
}

function drawSampleFrame(img, phase, dance) {
  const w = sampleCanvas.width;
  const h = sampleCanvas.height;
  sampleCtx.fillStyle = "#1a110c";
  sampleCtx.fillRect(0, 0, w, h);
  const scale = Math.min(w / img.width, h / img.height) * 0.92;
  const dw = img.width * scale;
  const dh = img.height * scale;
  const ox = Math.sin(phase) * dance.motion.x;
  const oy = -Math.abs(Math.sin(phase)) * dance.motion.y;
  sampleCtx.drawImage(img, (w - dw) / 2 + ox, (h - dh) / 2 + oy, dw, dh);
}

async function startDanceSample() {
  const danceId = currentDance;
  const dance = DANCES[danceId];
  startBtn.disabled = true;
  sampleBtn.textContent = `Loading ${dance.short} clip…`;
  try {
    await ensurePose();
    const images = await loadSampleFrames(danceId);
    stopCamera();
    poseHist.hipY.length = 0;
    poseHist.hipX.length = 0;
    poseHist.t.length = 0;
    lastVideoTime = -1;
    sampleCanvas.width = 720;
    sampleCanvas.height = 960;
    drawSampleFrame(images[0], 0, dance);
    video.classList.add("from-file");
    video.controls = false;
    video.loop = true;
    video.muted = true;
    video.removeAttribute("src");
    video.srcObject = sampleCanvas.captureStream(20);
    await video.play();

    let frame = 0;
    let lastSwap = 0;
    let phase = 0;
    samplePlaying = true;
    const tick = (time) => {
      if (!samplePlaying) return;
      phase += 0.12;
      if (time - lastSwap > dance.interval) {
        lastSwap = time;
        frame = (frame + 1) % dance.order.length;
      }
      drawSampleFrame(images[dance.order[frame]], phase, dance);
      sampleAnimId = requestAnimationFrame(tick);
    };
    sampleAnimId = requestAnimationFrame(tick);
    beginPlayback();
  } catch (err) {
    startBtn.disabled = false;
    updateSampleButtons();
    maybeToast(`Could not load the ${dance.short} sample.`, "bad", "vid-fail");
    console.error(err);
  }
}

async function startVideoFile(src, isBlob) {
  startBtn.disabled = true;
  sampleBtn.textContent = "Loading clip…";
  try {
    await ensurePose();
    stopCamera();
    poseHist.hipY.length = 0;
    poseHist.hipX.length = 0;
    poseHist.t.length = 0;
    lastVideoTime = -1;
    video.classList.add("from-file");
    video.controls = true;
    video.loop = true;
    video.muted = true;
    if (!isBlob && objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
    video.src = src;
    await video.play();
    beginPlayback();
  } catch (err) {
    startBtn.disabled = false;
    updateSampleButtons();
    maybeToast("Could not play that video. Try another MP4/WebM file.", "bad", "vid-fail");
    console.error(err);
  }
}

function beginPlayback() {
  permission.hidden = true;
  updateSampleButtons();
  startBtn.disabled = false;
  startBtn.textContent = "Start camera";
  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(loop);
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
    setPanel(0, ["No full body found in this frame. Use a clip where the dancer is clearly visible."]);
    maybeToast("No body in this frame", "bad", "missing");
    return;
  }

  drawSkeleton(landmarks);
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
    cues.push("Lift the rifle. Ta'sheer wants an arm high, then the jump.");
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
  else popup = { text: "That's Ta'sheer height", tone: "ok", key: "good" };

  return finish(score, cues, popup, "Clean Ta'sheer — height and rifle together.");
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

function drawSkeleton(lm) {
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(212, 176, 106, 0.9)";
  ctx.fillStyle = "#d4b06a";
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
    ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
    ctx.stroke();
  }
  for (const point of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    ctx.beginPath();
    ctx.arc(lm[point].x * canvas.width, lm[point].y * canvas.height, 6, 0, Math.PI * 2);
    ctx.fill();
  }
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
