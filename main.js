import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { golfLocations } from "./locations.js?v=mobile-course-map-fix-20260520";

// ─── User Profile ─────────────────────────────────────────
let userProfile = null;

const profileModal = document.getElementById("profile-modal");
const profileSubmit = document.getElementById("profile-submit");
const profileReset = document.getElementById("profile-reset");
const locateNearby = document.getElementById("locate-nearby");
const overviewOpen = document.getElementById("overview-open");
const transitionMask = document.getElementById("transition-mask");
const transitionCopy = document.getElementById("transition-copy");
const listPanel = document.getElementById("list-panel");
const listTitle = document.getElementById("list-title");
const listSubtitle = document.getElementById("list-subtitle");
const listContent = document.getElementById("list-content");
const listClose = document.getElementById("list-close");
const profileScore = document.getElementById("profile-score");
const profileDrive = document.getElementById("profile-drive");
const profileMiss = document.getElementById("profile-miss");
const profileGoal = document.getElementById("profile-goal");
const mapDetailLayer = document.getElementById("map-detail-layer");
const detailMapCanvas = document.getElementById("detail-map-canvas");
const mapDetailTitle = document.getElementById("map-detail-title");
const mapDetailMeta = document.getElementById("map-detail-meta");
const mapDetailScale = document.getElementById("map-detail-scale");
const mapDetailReset = document.getElementById("map-detail-reset");
const mapDetailClose = document.getElementById("map-detail-close");
const mapProviderTools = document.getElementById("map-provider-tools");
const radioGroups = ["strategy", "terrain", "environment", "skill"];
let userLocation = null;
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isCompactViewport = () => window.matchMedia("(max-width: 768px)").matches || isTouchDevice;
let viewMode = "globe";
let isTransitioning = false;
let transitionTimer = null;

function showTransition(text = "正在进入球场") {
  if (!transitionMask) return;
  window.clearTimeout(transitionTimer);
  transitionCopy.textContent = text;
  transitionMask.classList.add("visible");
}

function hideTransition() {
  if (!transitionMask) return;
  transitionMask.classList.remove("visible");
}

function unlockTransition(delay = 0) {
  window.clearTimeout(transitionTimer);
  transitionTimer = window.setTimeout(() => {
    isTransitioning = false;
  }, delay);
}

function checkProfileComplete() {
  const allChecked = radioGroups.every((name) => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked !== null;
  });
  profileSubmit.disabled = !allChecked;
}

document.querySelectorAll("#profile-questions input[type=radio]").forEach((radio) => {
  radio.addEventListener("change", checkProfileComplete);
});

function collectProfile() {
  const nextProfile = {};
  radioGroups.forEach((name) => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    nextProfile[name] = checked.value;
  });
  nextProfile.scoreRange = profileScore.value;
  nextProfile.driveDistance = profileDrive.value;
  nextProfile.missTendency = profileMiss.value;
  nextProfile.goal = profileGoal.value.trim() || "未填写";
  return nextProfile;
}

function showProfileModal({ reset = false } = {}) {
  hideOverlay();
  if (reset) {
    userProfile = null;
    document.querySelectorAll("#profile-questions input[type=radio]").forEach((radio) => {
      radio.checked = false;
    });
    profileScore.value = "未填写";
    profileDrive.value = "未填写";
    profileMiss.value = "未填写";
    profileGoal.value = "";
    profileSubmit.disabled = true;
  }
  profileSubmit.textContent = userProfile ? "更新专属数字球童" : "生成专属数字球童";
  profileModal.classList.remove("hidden");
}

profileSubmit.addEventListener("click", () => {
  userProfile = collectProfile();
  profileModal.classList.add("hidden");
  scanAllCourses();
  if (userLocation) renderCourseList("nearby");
});

profileReset.addEventListener("click", () => {
  showProfileModal({ reset: true });
});

// ─── Matching Engine v3.0 ───────────────────────────────────
const LEVEL_MAP = { "新手上路": 1, "业余高手": 2, "职业水准": 3 };

function calculateMatch(user, course) {
  const t = course.tags;
  let totalScore = 15;
  let terrainMatch = false;
  let strategyMatch = false;
  let environmentMatch = false;

  if (user.terrain === t.terrain) { totalScore += 35; terrainMatch = true; }
  if (user.strategy === t.strategy) { totalScore += 30; strategyMatch = true; }
  if (user.environment === t.environment) { totalScore += 20; environmentMatch = true; }

  const userLv = LEVEL_MAP[user.skill];
  const courseLv = LEVEL_MAP[t.skill];
  const isHighRisk = userLv < courseLv;

  if (isHighRisk) { totalScore -= 40; }

  const finalScore = Math.max(15, totalScore);

  return { finalScore, isHighRisk, terrainMatch, strategyMatch, environmentMatch, t, user };
}

function distanceKm(a, b) {
  const toRad = THREE.MathUtils.degToRad;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getCourseDistance(loc) {
  if (!userLocation) return null;
  return distanceKm(userLocation, loc);
}

function formatDistance(km) {
  if (km === null) return "";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function getProfileSummary() {
  if (!userProfile) return "尚未建立档案";
  return [
    userProfile.strategy,
    userProfile.terrain,
    userProfile.environment,
    userProfile.skill,
    userProfile.scoreRange !== "未填写" ? `平均${userProfile.scoreRange}` : null,
    userProfile.driveDistance !== "未填写" ? `开球${userProfile.driveDistance}` : null,
    userProfile.missTendency !== "未填写" ? `常见失误：${userProfile.missTendency}` : null,
    userProfile.goal !== "未填写" ? `目标：${userProfile.goal}` : null,
  ].filter(Boolean).join("，");
}

// ─── Match dimension description ────────────────────────────
function describeMatches(m) {
  const parts = [];
  if (m.terrainMatch) parts.push(`「${m.t.terrain}」地形`);
  if (m.strategyMatch) parts.push(`「${m.t.strategy}」风格`);
  if (m.environmentMatch) parts.push(`「${m.t.environment}」条件`);
  if (parts.length === 0) return "综合";
  return parts.join("和");
}

// ─── Dialogue Decision Tree v3.0 ────────────────────────────
function getCaddyAdvice(loc, mode = "strategy", note = "") {
  if (!userProfile) return "请先完成您的专属高尔夫档案，我将为您提供个性化建议~";

  const m = calculateMatch(userProfile, loc);
  const pct = m.finalScore;
  const distance = formatDistance(getCourseDistance(loc));
  const distanceText = distance ? `距离你约 ${distance}，` : "";
  const miss = userProfile.missTendency !== "未填写" ? userProfile.missTendency : "主要失误";
  const drive = userProfile.driveDistance !== "未填写" ? userProfile.driveDistance : "常规开球距离";
  const goal = userProfile.goal !== "未填写" ? userProfile.goal : "稳定完赛";
  const noteText = note ? `你补充的现场信息是：${note}。` : "";

  if (m.isHighRisk) {
    return `风险提醒：${distanceText}${loc.name} 标定为「${m.t.skill}」，高于你当前「${userProfile.skill}」档案。建议优先选择保守落点，开球避免硬拼距离，短杆和补救杆要提前预留容错。${noteText}匹配度：${pct}%`;
  }

  if (mode === "club") {
    return `选杆建议：你的开球档案是「${drive}」，在「${loc.tags.terrain}」球场不必每洞都追求一号木满挥。长洞先找安全球道，遇到水障或沙坑密集区域，用更稳定的球杆把球放到可攻果岭距离。${noteText}匹配度：${pct}%`;
  }

  if (mode === "training") {
    return `训练计划：围绕「${goal}」，赛前重点练三项：开球落点控制、${miss}修正、50码内短杆落点。这个球场的核心标签是「${describeMatches(m)}」，练习时把安全区和惩罚区想清楚，比单纯追距离更有价值。`;
  }

  if (mode === "routine") {
    return `赛前清单：确认天气和风向，热身顺序从肩背、髋部到半挥杆；前3洞按七成力量进入节奏。你当前目标是「${goal}」，所以第一优先级是少丢球，其次才是进攻旗杆。${distanceText}建议提前预留交通和练习果岭时间。`;
  }

  if (pct >= 85) {
    return `球场攻略：${distanceText}这里的「${m.t.terrain}」和你的档案高度契合。开局可以积极一些，但每次进攻前先确认落点后的第二杆角度；如果出现${miss}，立即切换到保守线，避免连续丢杆。匹配度：${pct}%`;
  }

  if (pct >= 65) {
    return `球场攻略：${distanceText}这里的${describeMatches(m)}适合你发挥，但不要把每个洞都打成进攻洞。建议用「安全落点优先、果岭前沿可接受」的策略，稳住节奏后再挑选短四杆洞或顺风洞进攻。匹配度：${pct}%`;
  }

  return `球场攻略：${distanceText}这座球场和你的日常偏好不完全一致，更适合作为体验局。建议降低进攻预期，优先把球放回球道，遇到不熟悉地形时宁可多打一杆，也不要挑战低成功率线路。匹配度：${pct}%`;
}

// ─── Local LLM Caddy ───────────────────────────────────────
const CADDY_API_BASE = "http://localhost:11434/v1";
const CADDY_MODEL_KEY = "golf-caddy-model";
const DEFAULT_CADDY_MODEL = "qwen3:8b";
let detectedCaddyModel = null;
let modelDetectionStarted = false;

async function resolveCaddyModel() {
  if (detectedCaddyModel !== null) return detectedCaddyModel;
  if (modelDetectionStarted) return null;

  modelDetectionStarted = true;
  try {
    const preferred = localStorage.getItem(CADDY_MODEL_KEY) || DEFAULT_CADDY_MODEL;
    const res = await fetch(`${CADDY_API_BASE}/models`);
    if (!res.ok) throw new Error(`Model list failed: ${res.status}`);

    const body = await res.json();
    const models = Array.isArray(body.data) ? body.data.map((m) => m.id).filter(Boolean) : [];
    detectedCaddyModel = models.includes(preferred) ? preferred : models[0] || null;
    return detectedCaddyModel;
  } catch {
    detectedCaddyModel = null;
    return null;
  } finally {
    modelDetectionStarted = false;
  }
}

function buildCaddyPrompt(loc, mode, note) {
  const m = calculateMatch(userProfile, loc);
  const taskMap = {
    strategy: "球场攻略和路线管理",
    club: "选杆、距离控制和落点选择",
    training: "赛前训练计划和弱点修正",
    routine: "赛前准备、热身、节奏和注意事项",
  };
  return [
    "你是一个现实球场里的专业中文高尔夫球童。你需要像真人球童一样，结合球员能力、常见失误、目标、球场地形和距离，给出具体而可执行的建议。",
    "不要只说推荐或不推荐。必须体现个人定制化。",
    `本次任务：${taskMap[mode] || taskMap.strategy}`,
    "输出 120-180 字，分成 3 段：1.判断 2.打法/训练/选杆 3.风险提醒。不要编造不存在的球洞编号、价格、电话或天气。",
    "",
    `用户档案：${JSON.stringify(userProfile)}。档案摘要：${getProfileSummary()}`,
    `球场信息：${JSON.stringify(loc)}`,
    `用户位置距离：${formatDistance(getCourseDistance(loc)) || "未知"}`,
    `用户现场补充：${note || "无"}`,
    `匹配结果：${JSON.stringify({
      score: m.finalScore,
      highRisk: m.isHighRisk,
      matched: {
        terrain: m.terrainMatch,
        strategy: m.strategyMatch,
        environment: m.environmentMatch,
      },
    })}`,
  ].join("\n");
}

async function getCaddyAdviceFromLLM(loc, mode = "strategy", note = "") {
  const fallback = getCaddyAdvice(loc, mode, note);
  const model = await resolveCaddyModel();

  if (!model) {
    return `${fallback}\n\n本地球童已启用基础模式。安装模型后会自动升级为大模型建议。`;
  }

  try {
    const res = await fetch(`${CADDY_API_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.72,
        max_tokens: 420,
        messages: [
          { role: "system", content: "你只输出中文高尔夫球童建议，不输出推理过程。语气专业、具体、像真人球童，不要泛泛而谈。" },
          { role: "user", content: buildCaddyPrompt(loc, mode, note) },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Caddy request failed: ${res.status}`);
    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content?.trim();
    return content || fallback;
  } catch {
    return `${fallback}\n\n本地大模型暂时未响应，已切换基础建议。`;
  }
}

// ─── Scene ────────────────────────────────────────────────
const scene = new THREE.Scene();

// ─── Camera ───────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  200
);

// ─── Renderer ─────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.domElement.style.touchAction = "none";
document.body.appendChild(renderer.domElement);

// ─── Starfield ────────────────────────────────────────────
function createStarfield() {
  const count = isCompactViewport() ? 900 : 2000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const r = 60 + Math.random() * 80;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    const brightness = 0.6 + Math.random() * 0.4;
    colors[i * 3]     = brightness;
    colors[i * 3 + 1] = brightness;
    colors[i * 3 + 2] = brightness;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.15,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  scene.add(new THREE.Points(geo, mat));
}

// ─── Lighting ─────────────────────────────────────────────
function createLighting() {
  const ambient = new THREE.AmbientLight(0x445577, 4.0);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff8e7, 3.5);
  sun.position.set(5, 2, 5);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x445577, 1.2);
  fill.position.set(-3, -1, -4);
  scene.add(fill);

  return { sun };
}

// ─── Earth ────────────────────────────────────────────────
function createEarth() {
  const geo = new THREE.SphereGeometry(1, 128, 128);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x224488,
    specular: 0x111122,
    shininess: 8,
  });
  const earth = new THREE.Mesh(geo, mat);
  scene.add(earth);

  const loader = new THREE.TextureLoader();
  loader.load(
    "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg",
    (texture) => {
      texture.anisotropy = 16;
      texture.colorSpace = THREE.SRGBColorSpace;
      mat.map = texture;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    },
    undefined,
    () => {
      mat.color.set(0x2255aa);
      mat.needsUpdate = true;
    }
  );

  return earth;
}

// ─── Atmosphere glow ──────────────────────────────────────
function createAtmosphere() {
  const geo = new THREE.SphereGeometry(1.015, 64, 64);
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vPosition = worldPos.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float fresnel = 1.0 - abs(dot(viewDir, vNormal));
        fresnel = pow(fresnel, 3.5);
        float alpha = fresnel * 0.25;
        gl_FragColor = vec4(0.3, 0.6, 1.0, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const atmosphere = new THREE.Mesh(geo, mat);
  scene.add(atmosphere);
}

function createSpaceAccents() {
  const sunGlow = createGlowTexture(255, 224, 150, 0.95);
  const moonGlow = createGlowTexture(190, 220, 255, 0.65);

  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunGlow,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  }));
  sunSprite.scale.set(4.6, 4.6, 1);
  scene.add(sunSprite);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 32, 32),
    new THREE.MeshStandardMaterial({
      color: 0xdce8ff,
      emissive: 0x223355,
      emissiveIntensity: 0.35,
      roughness: 0.85,
    })
  );
  scene.add(moon);

  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: moonGlow,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0.44,
  }));
  moonHalo.scale.set(0.9, 0.9, 1);
  scene.add(moonHalo);

  return { sunSprite, moon, moonHalo };
}

// ─── Coordinate utility ───────────────────────────────────
function latLngToVec3(lat, lng, radius) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lng + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
     radius * Math.cos(phi),
     radius * Math.sin(phi) * Math.sin(theta)
  );
}

function vec3ToLatLng(vec) {
  const normal = vec.clone().normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(clamp(normal.y, -1, 1)));
  let lng = THREE.MathUtils.radToDeg(Math.atan2(normal.z, -normal.x)) - 180;
  if (lng < -180) lng += 360;
  if (lng > 180) lng -= 360;
  return { lat, lng };
}

// ─── Glow texture factory ─────────────────────────────────
function createGlowTexture(r, g, b, alpha) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  gradient.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, ${alpha * 0.4})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

// ─── Markers ──────────────────────────────────────────────
const orangeTex = createGlowTexture(255, 170, 50, 0.75);
const cyanTex = createGlowTexture(0, 255, 220, 0.9);
let markerContainer;

function createMarkers(radius) {
  markerContainer = new THREE.Group();
  const dots = [];

  golfLocations.forEach((loc, i) => {
    const pos = latLngToVec3(loc.lat, loc.lng, radius * 1.006);
    const basePos = pos.clone();

    const geo = new THREE.SphereGeometry(0.0025, 8, 8);
    const dotMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.5,
    });
    const dot = new THREE.Mesh(geo, dotMat);
    dot.userData = { index: i };
    dot.position.copy(pos);
    markerContainer.add(dot);

    const glowMat = new THREE.SpriteMaterial({
      map: orangeTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.15,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.position.copy(pos);
    glow.scale.set(0.022, 0.022, 1);
    markerContainer.add(glow);

    dots.push({ dot, glow, dotMat, glowMat, basePos, pillar: null, highlight: false });
  });

  scene.add(markerContainer);
  return dots;
}

// ─── Global scan after profile submission ─────────────────
function scanAllCourses() {
  if (!userProfile) return;
  markers.forEach((m, i) => {
    const loc = golfLocations[i];
    const { finalScore, isHighRisk } = calculateMatch(userProfile, loc);

    // Remove existing pillar if any
    if (m.pillar) {
      markerContainer.remove(m.pillar);
      m.pillar.geometry.dispose();
      m.pillar.material.dispose();
      m.pillar = null;
    }

    if (finalScore >= 65 && !isHighRisk) {
      // Highlight: yellow sphere + light pillar
      m.dotMat.color.set(0xffaa33);
      m.dotMat.emissive.set(0xffcc00);
      m.dotMat.emissiveIntensity = 1.2;
      m.glowMat.map = cyanTex;
      m.glowMat.opacity = 0.7;

      // Create light pillar
      const pillarGeo = new THREE.CylinderGeometry(0.0015, 0.003, 0.5, 8);
      const pillarMat = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);

      const normal = m.basePos.clone().normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        normal
      );
      pillar.setRotationFromQuaternion(quat);
      pillar.position.copy(m.basePos).add(normal.multiplyScalar(0.25));
      pillar.userData = { index: i };

      markerContainer.add(pillar);
      m.pillar = pillar;
      m.highlight = true;
    } else {
      // Dim: slightly muted yellow
      m.dotMat.color.set(0x886622);
      m.dotMat.emissive.set(0x443300);
      m.dotMat.emissiveIntensity = 0.15;
      m.glowMat.map = orangeTex;
      m.glowMat.opacity = 0.25;
      m.highlight = false;
    }
  });
}

function getRankedCourses(mode) {
  return golfLocations.map((loc, index) => {
    const match = userProfile ? calculateMatch(userProfile, loc).finalScore : 0;
    const distance = getCourseDistance(loc);
    const distanceBoost = distance === null ? 0 : Math.max(0, 120 - distance) / 2;
    return { loc, index, match, distance, score: match + distanceBoost };
  }).sort((a, b) => {
    if (mode === "nearby" && a.distance !== null && b.distance !== null) return a.distance - b.distance;
    if (mode === "recommend") return b.score - a.score;
    return b.match - a.match || a.loc.name.localeCompare(b.loc.name, "zh-Hans-CN");
  });
}

function renderCourseList(mode = "overview") {
  const ranked = getRankedCourses(mode);
  const nearby = mode === "nearby";
  const title = nearby ? "附近高尔夫球场" : "中国高尔夫球场全览";
  const subtitle = nearby
    ? (userLocation ? `已按当前位置由近到远排序，共 ${ranked.length} 座球场。` : "定位后会按距离优先推荐。")
    : `收录 ${ranked.length} 座中国高尔夫球场，可按个人档案查看匹配度。`;

  listTitle.textContent = title;
  listSubtitle.textContent = subtitle;
  listContent.innerHTML = ranked.map(({ loc, index, match, distance }) => {
    const distanceText = formatDistance(distance);
    const badge = nearby && distanceText ? distanceText : (userProfile ? `${match}%` : "查看");
    return `
      <button class="course-row" type="button" data-course-index="${index}">
        <span class="course-row-title">
          <strong>${loc.name}</strong>
          <span>${badge}</span>
        </span>
        <p class="course-row-desc">${loc.description}</p>
        <span class="course-row-tags">
          <span>${loc.tags.strategy}</span>
          <span>${loc.tags.terrain}</span>
          <span>${loc.tags.environment}</span>
          <span>${loc.tags.skill}</span>
        </span>
      </button>
    `;
  }).join("") || `<p class="list-empty">暂无可展示球场。</p>`;

  listPanel.classList.add("visible");
  listPanel.setAttribute("aria-hidden", "false");
}

function showLocationStatus(text) {
  listTitle.textContent = "附近高尔夫球场";
  listSubtitle.textContent = text;
  listContent.innerHTML = `<p class="list-empty">${text}</p>`;
  listPanel.classList.add("visible");
  listPanel.setAttribute("aria-hidden", "false");
}

function requestNearbyCourses() {
  if (!navigator.geolocation) {
    showLocationStatus("当前浏览器不支持定位，可以先查看中国球场全览。");
    return;
  }

  showLocationStatus("正在获取当前位置，请在浏览器提示中允许定位。");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
      renderCourseList("nearby");
      const nearest = getRankedCourses("nearby")[0];
      if (nearest) flyToCourse(nearest.index, 1.7);
    },
    () => {
      showLocationStatus("定位未成功。你仍然可以通过全览查看球场，或检查浏览器定位权限后再试。");
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 }
  );
}

overviewOpen.addEventListener("click", () => renderCourseList("overview"));
locateNearby.addEventListener("click", requestNearbyCourses);
listClose.addEventListener("click", () => {
  listPanel.classList.remove("visible");
  listPanel.setAttribute("aria-hidden", "true");
});
listContent.addEventListener("click", (e) => {
  const row = e.target.closest("[data-course-index]");
  if (!row) return;
  const idx = Number(row.dataset.courseIndex);
  openCourse(idx, { fly: true });
});

// ─── Build scene ──────────────────────────────────────────
createStarfield();
const { sun } = createLighting();
const earth = createEarth();
createAtmosphere();
const spaceAccents = createSpaceAccents();
const markerRadius = 1;
const markers = createMarkers(markerRadius);

// ─── Controls ─────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.22;
controls.zoomSpeed = 0.45;
controls.panSpeed = 0.35;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.35;
controls.enablePan = false;
controls.minDistance = 1.36;
controls.maxDistance = 10;
controls.target.set(0, 0, 0);
let earthUserInteracting = false;
controls.addEventListener("start", () => {
  earthUserInteracting = true;
});
controls.addEventListener("end", () => {
  earthUserInteracting = false;
});

const chinaDir = latLngToVec3(32, 108, 1);
camera.position.copy(chinaDir.clone().multiplyScalar(3.2));
controls.update();

let earthCameraTween = null;

function flyToCourse(index, distance = 1.55, onComplete = null) {
  const marker = markers[index];
  if (!marker) return false;

  const worldPos = new THREE.Vector3();
  marker.dot.getWorldPosition(worldPos);
  const normal = worldPos.normalize();
  earthCameraTween = {
    startTime: performance.now(),
    duration: prefersReducedMotion ? 260 : 860,
    fromPosition: camera.position.clone(),
    toPosition: normal.multiplyScalar(distance),
    onComplete,
  };
  controls.enabled = false;
  return true;
}

function pulseGlobeMarker(index) {
  const marker = markers[index];
  if (!marker) return;
  marker.clickPulseUntil = performance.now() + 900;
  marker.dotMat.emissiveIntensity = Math.max(marker.dotMat.emissiveIntensity, 1.7);
}

function updateEarthCameraTween() {
  if (!earthCameraTween) return;

  const p = Math.min((performance.now() - earthCameraTween.startTime) / earthCameraTween.duration, 1);
  const t = easeOutCubic(p);
  camera.position.lerpVectors(earthCameraTween.fromPosition, earthCameraTween.toPosition, t);
  controls.target.set(0, 0, 0);
  controls.update();

  if (p >= 1) {
    const onComplete = earthCameraTween.onComplete;
    earthCameraTween = null;
    controls.enabled = true;
    if (typeof onComplete === "function") onComplete();
  }
}

// ─── Progressive 2D Map Detail ─────────────────────────────
const MAP_DETAIL_TRIGGER_DISTANCE = 1.72;
const CHINA_MAP_BOUNDS = { minLat: 18, maxLat: 46, minLng: 73, maxLng: 135 };
const CHINA_MAP_CENTER = { lat: 34.2, lng: 104.2 };
const MAP_BASE_ZOOM = 4;
const MAP_MIN_SCALE = 1;
const MAP_MAX_SCALE = 64;
const MAP_TILE_SIZE = 256;
const mapConfig = window.GOLF_MAP_CONFIG || {};
const mapTileProviders = {
  amapSatellite: {
    label: "高德卫星",
    coordinateSystem: "gcj02",
    maxZoom: 18,
    layers: [
      {
        template: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
        subdomains: ["1", "2", "3", "4"],
        opacity: 1,
      },
      {
        template: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
        subdomains: ["1", "2", "3", "4"],
        opacity: 0.52,
      },
    ],
    attribution: "高德卫星底图",
  },
  amapRoad: {
    label: "高德路网",
    coordinateSystem: "gcj02",
    maxZoom: 18,
    layers: [
      {
        template: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
        subdomains: ["1", "2", "3", "4"],
        opacity: 1,
      },
    ],
    attribution: "高德路网底图",
  },
  osm: {
    label: "标准地图",
    coordinateSystem: "wgs84",
    maxZoom: 19,
    layers: [
      {
        template: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        subdomains: [""],
        opacity: 1,
      },
    ],
    attribution: "OpenStreetMap 标准底图",
  },
};
let activeMapProviderKey = mapTileProviders[mapConfig.mapTileProvider] ? mapConfig.mapTileProvider : "amapSatellite";
const tileCache = new Map();
const detailMapCtx = detailMapCanvas ? detailMapCanvas.getContext("2d") : null;
let mapDetailVisible = false;
let mapRenderPending = false;
let mapTween = null;
const mapPointers = new Map();
const mapState = {
  scale: 1.25,
  panX: 0,
  panY: 0,
  ctrlDown: false,
  panning: false,
  dragging: false,
  moved: false,
  pinching: false,
  pinchStartDistance: 0,
  pinchStartScale: 1,
  pinchCenterX: 0,
  pinchCenterY: 0,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0,
  selectedIndex: null,
  hoverIndex: null,
  clickLocked: false,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getDetailMapRect() {
  const rect = detailMapCanvas.getBoundingClientRect();
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height), left: rect.left, top: rect.top };
}

function resizeDetailMapCanvas(width, height) {
  const maxQuality = isCompactViewport() ? 2.5 : 4;
  const quality = clamp((window.devicePixelRatio || 1) * (1 + Math.min(mapState.scale, 10) * 0.18), 1, maxQuality);
  const nextW = Math.max(1, Math.round(width * quality));
  const nextH = Math.max(1, Math.round(height * quality));
  if (detailMapCanvas.width !== nextW || detailMapCanvas.height !== nextH) {
    detailMapCanvas.width = nextW;
    detailMapCanvas.height = nextH;
  }
  detailMapCtx.setTransform(quality, 0, 0, quality, 0, 0);
  return quality;
}

function applyMapTransform(ctx, width, height) {
  ctx.translate(width / 2 + mapState.panX, height / 2 + mapState.panY);
  ctx.scale(mapState.scale, mapState.scale);
  ctx.translate(-width / 2, -height / 2);
}

function transformLatForGcj(lng, lat) {
  let ret = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  ret += (20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(lat * Math.PI) + 40 * Math.sin(lat / 3 * Math.PI)) * 2 / 3;
  ret += (160 * Math.sin(lat / 12 * Math.PI) + 320 * Math.sin(lat * Math.PI / 30)) * 2 / 3;
  return ret;
}

function transformLngForGcj(lng, lat) {
  let ret = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  ret += (20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(lng * Math.PI) + 40 * Math.sin(lng / 3 * Math.PI)) * 2 / 3;
  ret += (150 * Math.sin(lng / 12 * Math.PI) + 300 * Math.sin(lng / 30 * Math.PI)) * 2 / 3;
  return ret;
}

function isOutsideChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function wgs84ToGcj02(lat, lng) {
  if (isOutsideChina(lat, lng)) return { lat, lng };
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLatForGcj(lng - 105.0, lat - 35.0);
  let dLng = transformLngForGcj(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

function getActiveMapProvider() {
  return mapTileProviders[activeMapProviderKey] || mapTileProviders.amapSatellite;
}

function getCourseMapCenter(loc) {
  const center = loc?.courseMapCenter;
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) return center;
  return { lat: loc.lat, lng: loc.lng };
}

function getCourseMapName(loc) {
  return loc?.amapPoiName || loc?.amapSearchKeyword || `${loc.name} 高尔夫球场`;
}

function isCourseMapVerified(loc) {
  return loc?.mapPrecision === "verified" || loc?.mapPrecision === "amap-poi";
}
function toProviderLngLat(loc, provider = getActiveMapProvider()) {
  const center = getCourseMapCenter(loc);
  if (provider.coordinateSystem === "gcj02") return wgs84ToGcj02(center.lat, center.lng);
  return center;
}

function lngLatToWorld(lng, lat, zoom) {
  const sinLat = Math.sin(clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180);
  const worldSize = MAP_TILE_SIZE * 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
  };
}

function getTileZoom() {
  const detailBoost = mapState.scale >= 5 ? 1 : 0;
  const zoom = Math.round(MAP_BASE_ZOOM + Math.log2(Math.max(1, mapState.scale)) + detailBoost);
  return clamp(zoom, 4, getActiveMapProvider().maxZoom);
}

function getMapRawPoint(loc, width, height) {
  const provider = getActiveMapProvider();
  const center = provider.coordinateSystem === "gcj02" ? wgs84ToGcj02(CHINA_MAP_CENTER.lat, CHINA_MAP_CENTER.lng) : CHINA_MAP_CENTER;
  const target = toProviderLngLat(loc, provider);
  const centerWorld = lngLatToWorld(center.lng, center.lat, MAP_BASE_ZOOM);
  const targetWorld = lngLatToWorld(target.lng, target.lat, MAP_BASE_ZOOM);
  return {
    x: width / 2 + targetWorld.x - centerWorld.x,
    y: height / 2 + targetWorld.y - centerWorld.y,
  };
}

function projectCourseToMap(loc, width, height) {
  const raw = getMapRawPoint(loc, width, height);
  return {
    x: (raw.x - width / 2) * mapState.scale + width / 2 + mapState.panX,
    y: (raw.y - height / 2) * mapState.scale + height / 2 + mapState.panY,
  };
}

function getPanForRawPoint(raw, width, height, scale) {
  return {
    panX: -(raw.x - width / 2) * scale,
    panY: -(raw.y - height / 2) * scale,
  };
}

function centerMapOnLatLng(lat, lng, scale = mapState.scale) {
  const { width, height } = getDetailMapRect();
  const raw = getMapRawPoint({ lat, lng }, width, height);
  mapState.scale = clamp(scale, MAP_MIN_SCALE, MAP_MAX_SCALE);
  const pan = getPanForRawPoint(raw, width, height, mapState.scale);
  mapState.panX = pan.panX;
  mapState.panY = pan.panY;
  clampMapPan(width, height);
}

function centerMapOnCourse(index, scale = 4.2) {
  const loc = golfLocations[index];
  if (!loc) return;
  const { width, height } = getDetailMapRect();
  const raw = getMapRawPoint(loc, width, height);
  mapState.scale = clamp(scale, MAP_MIN_SCALE, MAP_MAX_SCALE);
  const pan = getPanForRawPoint(raw, width, height, mapState.scale);
  mapState.panX = pan.panX;
  mapState.panY = pan.panY;
  clampMapPan(width, height);
}

function clampMapPan(width, height) {
  const maxX = width * (0.5 + mapState.scale * 0.78);
  const maxY = height * (0.5 + mapState.scale * 0.78);
  mapState.panX = clamp(mapState.panX, -maxX, maxX);
  mapState.panY = clamp(mapState.panY, -maxY, maxY);
}

function drawChinaPath(ctx, width, height) {
  const pts = [
    [0.21, 0.35], [0.28, 0.25], [0.43, 0.19], [0.57, 0.21],
    [0.69, 0.28], [0.79, 0.39], [0.84, 0.53], [0.76, 0.66],
    [0.62, 0.74], [0.49, 0.79], [0.38, 0.74], [0.30, 0.67],
    [0.20, 0.59], [0.17, 0.47],
  ];
  ctx.beginPath();
  pts.forEach(([px, py], i) => {
    const x = px * width;
    const y = py * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function formatTileUrl(template, x, y, z, subdomains) {
  const subdomain = subdomains?.length ? subdomains[Math.abs(x + y + z) % subdomains.length] : "";
  return template
    .replace("{s}", subdomain)
    .replace("{x}", x)
    .replace("{y}", y)
    .replace("{z}", z);
}

function getTileImage(url) {
  let entry = tileCache.get(url);
  if (entry) return entry;

  const image = new Image();
  entry = { image, loaded: false, error: false };
  tileCache.set(url, entry);
  image.onload = () => {
    entry.loaded = true;
    if (mapDetailVisible) renderDetailMap();
  };
  image.onerror = () => {
    entry.error = true;
    if (mapDetailVisible) renderDetailMap();
  };
  image.referrerPolicy = "no-referrer";
  image.src = url;
  return entry;
}

function drawMapLoadingGrid(ctx, width, height) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#07131a");
  bg.addColorStop(0.55, "#0d2427");
  bg.addColorStop(1, "#162a24");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(120, 220, 255, 0.08)";
  ctx.lineWidth = 1;
  const step = 64;
  for (let x = -step; x < width + step; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + (mapState.panX % step), 0);
    ctx.lineTo(x + (mapState.panX % step), height);
    ctx.stroke();
  }
  for (let y = -step; y < height + step; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + (mapState.panY % step));
    ctx.lineTo(width, y + (mapState.panY % step));
    ctx.stroke();
  }
}

function drawTileLayer(ctx, width, height, provider, layer, zoom) {
  const center = provider.coordinateSystem === "gcj02" ? wgs84ToGcj02(CHINA_MAP_CENTER.lat, CHINA_MAP_CENTER.lng) : CHINA_MAP_CENTER;
  const centerWorld = lngLatToWorld(center.lng, center.lat, zoom);
  const scaleToScreen = mapState.scale / 2 ** (zoom - MAP_BASE_ZOOM);
  const tileScreenSize = MAP_TILE_SIZE * scaleToScreen;
  const tileCount = 2 ** zoom;
  const minTileX = Math.floor((centerWorld.x - (width / 2 + mapState.panX) / scaleToScreen) / MAP_TILE_SIZE) - 1;
  const maxTileX = Math.ceil((centerWorld.x + (width / 2 - mapState.panX) / scaleToScreen) / MAP_TILE_SIZE) + 1;
  const minTileY = Math.floor((centerWorld.y - (height / 2 + mapState.panY) / scaleToScreen) / MAP_TILE_SIZE) - 1;
  const maxTileY = Math.ceil((centerWorld.y + (height / 2 - mapState.panY) / scaleToScreen) / MAP_TILE_SIZE) + 1;

  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    const wrappedX = ((tx % tileCount) + tileCount) % tileCount;
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      if (ty < 0 || ty >= tileCount) continue;
      const url = formatTileUrl(layer.template, wrappedX, ty, zoom, layer.subdomains);
      const entry = getTileImage(url);
      if (!entry.loaded || entry.error) continue;
      const x = (tx * MAP_TILE_SIZE - centerWorld.x) * scaleToScreen + width / 2 + mapState.panX;
      const y = (ty * MAP_TILE_SIZE - centerWorld.y) * scaleToScreen + height / 2 + mapState.panY;
      ctx.drawImage(entry.image, Math.round(x), Math.round(y), Math.ceil(tileScreenSize + 1), Math.ceil(tileScreenSize + 1));
    }
  }
  ctx.restore();
}

function drawCourseDetailHints(ctx, width, height) {
  if (mapState.scale < 8) return;
  golfLocations.forEach((loc, index) => {
    const p = projectCourseToMap(loc, width, height);
    if (p.x < -180 || p.x > width + 180 || p.y < -180 || p.y > height + 180) return;
    const match = userProfile ? calculateMatch(userProfile, loc).finalScore : 60;
    const strong = match >= 65 || index === mapState.selectedIndex;
    const size = clamp(54 + mapState.scale * 1.4, 62, 118);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((index % 11) * 0.29);
    ctx.globalAlpha = strong ? 0.44 : 0.25;
    ctx.fillStyle = "rgba(93, 205, 112, 0.42)";
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.72, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(245, 236, 190, 0.42)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-size * 0.62, -size * 0.05);
    ctx.bezierCurveTo(-size * 0.18, -size * 0.36, size * 0.18, size * 0.32, size * 0.62, size * 0.02);
    ctx.stroke();
    ctx.fillStyle = "rgba(60, 145, 210, 0.34)";
    ctx.beginPath();
    ctx.ellipse(size * 0.34, size * 0.12, size * 0.18, size * 0.06, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawTerrainBackground(ctx, width, height) {
  const provider = getActiveMapProvider();
  const zoom = getTileZoom();
  drawMapLoadingGrid(ctx, width, height);
  provider.layers.forEach((layer) => drawTileLayer(ctx, width, height, provider, layer, zoom));

  if (activeMapProviderKey === "amapSatellite") {
    ctx.fillStyle = "rgba(4, 14, 18, 0.12)";
    ctx.fillRect(0, 0, width, height);
  }

  drawCourseDetailHints(ctx, width, height);

  const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, width * 0.24, width * 0.5, height * 0.48, width * 0.76);
  vignette.addColorStop(0, "rgba(255,255,255,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(238, 250, 255, 0.72)";
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.fillText(`${provider.attribution} · z${zoom}`, 16, height - 16);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawMapMarkers(ctx, width, height) {
  const labelVisible = mapState.scale > 2.1;
  const richLabelVisible = mapState.scale >= 4;
  ctx.font = "12px Microsoft YaHei, sans-serif";
  golfLocations.forEach((loc, index) => {
    const p = projectCourseToMap(loc, width, height);
    if (p.x < -80 || p.x > width + 80 || p.y < -80 || p.y > height + 80) return;

    const selected = index === mapState.selectedIndex;
    const hovered = index === mapState.hoverIndex;
    const match = userProfile ? calculateMatch(userProfile, loc).finalScore : 0;
    const strong = selected || hovered || match >= 65 || !userProfile;
    const r = selected ? 8 : hovered ? 6.6 : strong ? 5.2 : 3.4;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r * (selected || hovered ? 4.1 : 3.4), 0, Math.PI * 2);
    ctx.fillStyle = selected ? "rgba(95, 230, 255, 0.24)" : hovered ? "rgba(255,255,255,0.18)" : strong ? "rgba(0, 255, 214, 0.13)" : "rgba(255, 176, 70, 0.1)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "#ffffff" : strong ? "#49ffe1" : "#e7ae55";
    ctx.fill();
    ctx.strokeStyle = selected || hovered ? "rgba(80, 230, 255, 0.95)" : "rgba(255,255,255,0.42)";
    ctx.lineWidth = 1.3;
    ctx.stroke();

    if (labelVisible || selected || hovered) {
      const label = richLabelVisible
        ? `${loc.name} · ${loc.city || loc.province || "中国"} · ${loc.holes || 18}洞${userProfile ? ` · ${match}%` : ""}`
        : loc.name;
      ctx.font = richLabelVisible ? "12px Microsoft YaHei, sans-serif" : "12px Microsoft YaHei, sans-serif";
      const textW = ctx.measureText(label).width;
      const lx = p.x + 10;
      const ly = p.y - 9;
      ctx.fillStyle = "rgba(5, 18, 22, 0.66)";
      ctx.strokeStyle = "rgba(130, 236, 255, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      drawRoundedRect(ctx, lx, ly - 15, textW + 14, richLabelVisible ? 24 : 22, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(238, 252, 255, 0.92)";
      ctx.fillText(label, lx + 7, ly);
    }
  });
}

function renderDetailMapNow() {
  if (!detailMapCtx || !mapDetailVisible) return;
  const { width, height } = getDetailMapRect();
  const quality = resizeDetailMapCanvas(width, height);
  detailMapCtx.clearRect(0, 0, width, height);
  drawTerrainBackground(detailMapCtx, width, height);
  drawMapMarkers(detailMapCtx, width, height);

  const target = mapState.selectedIndex === null ? "中国高尔夫局部地图" : golfLocations[mapState.selectedIndex].name;
  mapDetailTitle.textContent = target;
  mapDetailMeta.textContent = isTouchDevice
    ? "单指拖动平移，双指缩放；点击光点进入球场详情，高德地图按钮查看外部实景地图。"
    : mapState.ctrlDown
    ? "Ctrl 平移中：拖动画面可水平 / 垂直移动。"
    : "滚轮按点击位置递进缩放，Ctrl + 拖动平移；底图会按 zoom 级别重新请求高清瓦片。";
  mapDetailScale.textContent = `${getActiveMapProvider().label} · 瓦片 z${getTileZoom()} · 细节 ${quality.toFixed(1)}x · 缩放 ${mapState.scale.toFixed(1)}x`;
}

function renderDetailMap() {
  if (mapRenderPending) return;
  mapRenderPending = true;
  requestAnimationFrame(() => {
    mapRenderPending = false;
    renderDetailMapNow();
  });
}

function animateMapToCourse(index, { scale = 4.3, duration = 620, onComplete = null } = {}) {
  const loc = golfLocations[index];
  if (!loc) return false;
  const { width, height } = getDetailMapRect();
  const raw = getMapRawPoint(loc, width, height);
  const nextScale = clamp(Math.max(scale, mapState.scale), MAP_MIN_SCALE, MAP_MAX_SCALE);
  const pan = getPanForRawPoint(raw, width, height, nextScale);
  mapTween = {
    startTime: performance.now(),
    duration: prefersReducedMotion ? 180 : duration,
    fromScale: mapState.scale,
    fromPanX: mapState.panX,
    fromPanY: mapState.panY,
    toScale: nextScale,
    toPanX: clamp(pan.panX, -width * (0.5 + nextScale * 0.78), width * (0.5 + nextScale * 0.78)),
    toPanY: clamp(pan.panY, -height * (0.5 + nextScale * 0.78), height * (0.5 + nextScale * 0.78)),
    onComplete,
  };
  return true;
}

function updateMapTween() {
  if (!mapTween) return;
  const p = Math.min((performance.now() - mapTween.startTime) / mapTween.duration, 1);
  const t = easeInOutCubic(p);
  mapState.scale = THREE.MathUtils.lerp(mapTween.fromScale, mapTween.toScale, t);
  mapState.panX = THREE.MathUtils.lerp(mapTween.fromPanX, mapTween.toPanX, t);
  mapState.panY = THREE.MathUtils.lerp(mapTween.fromPanY, mapTween.toPanY, t);
  renderDetailMap();

  if (p >= 1) {
    const onComplete = mapTween.onComplete;
    mapTween = null;
    if (typeof onComplete === "function") onComplete();
  }
}

function enterMapDetail(index = null, { fromGlobe = false } = {}) {
  if (!mapDetailLayer || !detailMapCanvas || isTransitioning) return;
  isTransitioning = true;
  viewMode = "transition";
  mapDetailVisible = true;
  mapState.selectedIndex = Number.isInteger(index) ? index : null;
  if (!Number.isInteger(index)) {
    const focus = vec3ToLatLng(camera.position.clone().normalize());
    const targetLat = clamp(focus.lat, CHINA_MAP_BOUNDS.minLat, CHINA_MAP_BOUNDS.maxLat);
    const targetLng = clamp(focus.lng, CHINA_MAP_BOUNDS.minLng, CHINA_MAP_BOUNDS.maxLng);
    centerMapOnLatLng(targetLat, targetLng, Math.max(mapState.scale, 1.34));
  }
  if (fromGlobe) showTransition("正在进入高精度地图");
  document.body.classList.add("map-transitioning");
  document.body.classList.add("map-mode");
  mapDetailLayer.classList.add("visible");
  mapDetailLayer.setAttribute("aria-hidden", "false");
  listPanel.classList.remove("visible");
  listPanel.setAttribute("aria-hidden", "true");
  controls.enabled = false;
  if (Number.isInteger(index)) centerMapOnCourse(index);
  renderDetailMapNow();
  window.setTimeout(() => {
    hideTransition();
    document.body.classList.remove("map-transitioning");
    viewMode = "map";
    unlockTransition();
  }, prefersReducedMotion ? 120 : 520);
}

function exitMapDetail({ keepCamera = false, instant = false } = {}) {
  if (!mapDetailLayer || !mapDetailVisible) return;
  if (isTransitioning && !instant) return;
  if (!instant) {
    isTransitioning = true;
    viewMode = "transition";
    showTransition("正在返回地球视角");
  }
  mapDetailVisible = false;
  mapState.dragging = false;
  mapState.panning = false;
  mapState.pinching = false;
  mapPointers.clear();
  mapDetailLayer.classList.remove("visible");
  mapDetailLayer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("map-mode");
  document.body.classList.remove("map-transitioning");
  controls.enabled = true;
  if (!keepCamera) {
    earthCameraTween = {
      startTime: performance.now(),
      duration: instant || prefersReducedMotion ? 1 : 720,
      fromPosition: camera.position.clone(),
      toPosition: chinaDir.clone().multiplyScalar(3.2),
      onComplete: () => {
        hideTransition();
        viewMode = "globe";
        unlockTransition();
      },
    };
    controls.enabled = false;
  } else {
    hideTransition();
    viewMode = "map";
    unlockTransition();
  }
}

function zoomDetailMapAt(clientX, clientY, factor) {
  const { width, height, left, top } = getDetailMapRect();
  const oldScale = mapState.scale;
  const nextScale = clamp(oldScale * factor, MAP_MIN_SCALE, MAP_MAX_SCALE);
  if (Math.abs(nextScale - oldScale) < 0.001) return;

  const x = clientX - left;
  const y = clientY - top;
  const worldX = (x - width / 2 - mapState.panX) / oldScale;
  const worldY = (y - height / 2 - mapState.panY) / oldScale;
  mapState.scale = nextScale;
  mapState.panX = x - width / 2 - worldX * nextScale;
  mapState.panY = y - height / 2 - worldY * nextScale;
  clampMapPan(width, height);
  renderDetailMap();
}

function findMapCourseAt(clientX, clientY) {
  const { width, height, left, top } = getDetailMapRect();
  const x = clientX - left;
  const y = clientY - top;
  let best = null;
  let bestDistance = Infinity;

  golfLocations.forEach((loc, index) => {
    const p = projectCourseToMap(loc, width, height);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDistance) {
      best = index;
      bestDistance = d;
    }
  });

  return bestDistance <= Math.max(16, 28 - mapState.scale * 1.5) ? best : null;
}

function updateDetailMapCursor() {
  if (!detailMapCanvas) return;
  detailMapCanvas.classList.toggle("ctrl-pan", mapState.ctrlDown || mapState.panning || isTouchDevice);
  detailMapCanvas.classList.toggle("is-panning", mapState.panning);
  if (mapDetailVisible) renderDetailMap();
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Control" && !mapState.ctrlDown) {
    mapState.ctrlDown = true;
    updateDetailMapCursor();
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Control") {
    mapState.ctrlDown = false;
    updateDetailMapCursor();
  }
});

detailMapCanvas.addEventListener("wheel", (e) => {
  if (!mapDetailVisible || isTransitioning) return;
  e.preventDefault();
  if (mapState.scale <= 1.04 && e.deltaY > 0) {
    exitMapDetail();
    return;
  }
  zoomDetailMapAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.34 : 0.78);
}, { passive: false });

function updateMapPointer(pointerEvent) {
  mapPointers.set(pointerEvent.pointerId, {
    x: pointerEvent.clientX,
    y: pointerEvent.clientY,
    pointerType: pointerEvent.pointerType,
  });
}

function getTouchPointers() {
  return [...mapPointers.values()].filter((p) => p.pointerType === "touch");
}

function getPointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getPointerCenter(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

detailMapCanvas.addEventListener("pointerdown", (e) => {
  if (!mapDetailVisible || isTransitioning) return;
  detailMapCanvas.setPointerCapture(e.pointerId);
  updateMapPointer(e);
  mapState.startX = e.clientX;
  mapState.startY = e.clientY;
  mapState.startPanX = mapState.panX;
  mapState.startPanY = mapState.panY;
  mapState.moved = false;

  const touches = getTouchPointers();
  if (touches.length >= 2) {
    const [a, b] = touches;
    const center = getPointerCenter(a, b);
    mapState.pinching = true;
    mapState.dragging = false;
    mapState.panning = false;
    mapState.pinchStartDistance = Math.max(1, getPointerDistance(a, b));
    mapState.pinchStartScale = mapState.scale;
    mapState.pinchCenterX = center.x;
    mapState.pinchCenterY = center.y;
    mapState.moved = true;
    updateDetailMapCursor();
    return;
  }

  if (e.pointerType === "touch" || e.ctrlKey || mapState.ctrlDown) {
    mapState.dragging = true;
    mapState.panning = true;
    updateDetailMapCursor();
  }
});

detailMapCanvas.addEventListener("pointermove", (e) => {
  if (!mapDetailVisible) return;
  updateMapPointer(e);
  const touches = getTouchPointers();
  if (mapState.pinching && touches.length >= 2) {
    const [a, b] = touches;
    const center = getPointerCenter(a, b);
    const distance = Math.max(1, getPointerDistance(a, b));
    const factor = distance / Math.max(1, mapState.pinchStartDistance);
    zoomDetailMapAt(center.x, center.y, mapState.pinchStartScale * factor / mapState.scale);
    mapState.moved = true;
    return;
  }

  if (!mapState.dragging) {
    if (!isTouchDevice) {
      const hoverIndex = findMapCourseAt(e.clientX, e.clientY);
      if (hoverIndex !== mapState.hoverIndex) {
        mapState.hoverIndex = hoverIndex;
        renderDetailMap();
      }
    }
    return;
  }

  const dx = e.clientX - mapState.startX;
  const dy = e.clientY - mapState.startY;
  if (Math.hypot(dx, dy) > 2) mapState.moved = true;
  mapState.panX = mapState.startPanX + dx;
  mapState.panY = mapState.startPanY + dy;
  const { width, height } = getDetailMapRect();
  clampMapPan(width, height);
  renderDetailMap();
});

detailMapCanvas.addEventListener("pointerup", (e) => {
  if (!mapDetailVisible || isTransitioning) {
    mapPointers.delete(e.pointerId);
    return;
  }
  updateMapPointer(e);
  const wasDrag = mapState.pinching || mapState.moved;
  mapPointers.delete(e.pointerId);
  if (mapState.dragging) {
    mapState.dragging = false;
    mapState.panning = false;
    updateDetailMapCursor();
    if (wasDrag || e.ctrlKey || mapState.ctrlDown) return;
  }
  if (mapState.pinching) {
    mapState.pinching = getTouchPointers().length >= 2;
    if (wasDrag) return;
  }

  const index = findMapCourseAt(e.clientX, e.clientY);
  if (index !== null) {
    mapState.selectedIndex = index;
    renderDetailMapNow();
    openCourse(index, { fly: true, distance: 1.42 });
    return;
  }
  if (!e.ctrlKey && !mapState.ctrlDown) zoomDetailMapAt(e.clientX, e.clientY, 1.55);
});

detailMapCanvas.addEventListener("pointercancel", (e) => {
  mapPointers.delete(e.pointerId);
  mapState.dragging = false;
  mapState.panning = false;
  mapState.pinching = false;
  updateDetailMapCursor();
});

detailMapCanvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType !== "touch" && mapState.hoverIndex !== null) {
    mapState.hoverIndex = null;
    renderDetailMap();
  }
});

mapDetailReset.addEventListener("click", () => {
  mapState.scale = 1.25;
  mapState.panX = 0;
  mapState.panY = 0;
  mapState.selectedIndex = null;
  renderDetailMapNow();
});

mapDetailClose.addEventListener("click", () => {
  exitMapDetail();
});

mapProviderTools?.addEventListener("click", (e) => {
  const button = e.target.closest("[data-map-provider]");
  if (!button) return;
  const nextProvider = button.dataset.mapProvider;
  if (!mapTileProviders[nextProvider] || nextProvider === activeMapProviderKey) return;
  activeMapProviderKey = nextProvider;
  mapProviderTools.querySelectorAll("[data-map-provider]").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  renderDetailMapNow();
});

function maybeEnterMapDetailFromGlobe() {
  if (viewMode !== "globe" || mapDetailVisible || earthCameraTween || isTransitioning) return;
  if (!profileModal.classList.contains("hidden")) return;
  if (overlay.classList.contains("visible")) return;
  if (camera.position.length() <= MAP_DETAIL_TRIGGER_DISTANCE) enterMapDetail(null, { fromGlobe: true });
}

function requestMapDetailAfterZoom() {
  if (viewMode !== "globe" || mapDetailVisible || isTransitioning) return;
  requestAnimationFrame(() => maybeEnterMapDetailFromGlobe());
}

// ─── Mini 3D Clubhouse Scene ──────────────────────────────
const modelCanvas = document.getElementById("model-canvas");
const modelTerrainToggle = document.getElementById("model-terrain-toggle");
const modelGenericToggle = document.getElementById("model-generic-toggle");
const modelAmapToggle = document.getElementById("model-amap-toggle");
const modelRotateToggle = document.getElementById("model-rotate-toggle");
const modelRotateSpeed = document.getElementById("model-rotate-speed");
const externalMapViewer = document.getElementById("external-map-viewer");
const amapCourseMap = document.getElementById("amap-course-map");
const externalMapStatus = document.getElementById("external-map-status");
const photoDetail = document.getElementById("photo-detail");
const photoDetailImage = document.getElementById("photo-detail-image");
const photoDetailVideo = document.getElementById("photo-detail-video");
const photoDetailTitle = document.getElementById("photo-detail-title");
const photoDetailMeta = document.getElementById("photo-detail-meta");
const photoDetailClose = document.getElementById("photo-detail-close");
const modelRenderer = new THREE.WebGLRenderer({
  canvas: modelCanvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
modelRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
modelRenderer.setClearColor(0x000000, 0);

const modelScene = new THREE.Scene();
const modelCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
modelCamera.position.set(3.5, 4.5, 5.0);
modelCamera.lookAt(0, -0.5, 0);

const modelControls = new OrbitControls(modelCamera, modelCanvas);
modelControls.enableDamping = true;
modelControls.dampingFactor = 0.08;
modelControls.enableRotate = true;
modelControls.enablePan = false;
modelControls.rotateSpeed = Number(modelRotateSpeed.value);
modelControls.zoomSpeed = 0.65;
modelControls.panSpeed = 0.45;
modelControls.minDistance = 0.75;
modelControls.maxDistance = 8;
modelControls.minPolarAngle = Math.PI * 0.18;
modelControls.maxPolarAngle = Math.PI * 0.52;
modelControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
modelControls.touches.ONE = THREE.TOUCH.ROTATE;
modelControls.target.set(0, -0.45, 0);
modelControls.update();

let modelRotationEnabled = true;
let modelIsDragging = false;

function syncModelRotationMode() {
  modelControls.enableRotate = true;
  modelControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  modelControls.touches.ONE = THREE.TOUCH.ROTATE;
  modelRotateToggle.textContent = modelRotationEnabled ? "自动环绕：开" : "自动环绕：关";
  modelRotateToggle.classList.toggle("active", modelRotationEnabled);
}

modelRotateToggle.addEventListener("click", () => {
  modelRotationEnabled = !modelRotationEnabled;
  syncModelRotationMode();
});

modelRotateSpeed.addEventListener("input", () => {
  modelControls.rotateSpeed = Number(modelRotateSpeed.value);
});

syncModelRotationMode();

let lastModelW = 0;
let lastModelH = 0;

function updateModelRendererSize() {
  const w = modelCanvas.clientWidth;
  const h = modelCanvas.clientHeight;
  if (w > 0 && h > 0 && (w !== lastModelW || h !== lastModelH)) {
    modelRenderer.setSize(w, h);
    modelCamera.aspect = w / Math.max(h, 1);
    modelCamera.updateProjectionMatrix();
    lastModelW = w;
    lastModelH = h;
  }
}

modelScene.add(new THREE.AmbientLight(0xccccdd, 2.5));
const modelSun = new THREE.DirectionalLight(0xffffff, 5);
modelSun.position.set(3, 5, 4);
modelScene.add(modelSun);
const modelFill = new THREE.DirectionalLight(0x8899cc, 2);
modelFill.position.set(-2, 1, -3);
modelScene.add(modelFill);

// Load GLTF model
const modelGroup = new THREE.Group();
const courseTerrainGroup = new THREE.Group();
modelScene.add(modelGroup);
modelScene.add(courseTerrainGroup);
courseTerrainGroup.visible = true;
modelGroup.visible = false;
let modelHasFallback = false;
let modelViewMode = "terrain";
let terrainLoadToken = 0;
let amapLoaderPromise = null;
let embeddedAmap = null;
const amapCourseResolutionCache = new Map();
const courseTerrainTextureCache = new Map();

function disposeObject3D(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => {
      material.dispose?.();
    });
  });
}

function clearCourseTerrainGroup() {
  while (courseTerrainGroup.children.length) {
    const child = courseTerrainGroup.children[0];
    courseTerrainGroup.remove(child);
    disposeObject3D(child);
  }
}

function getAmapTileUrlForCourse(x, y, z, style = 6) {
  const host = style === 6 ? "webst" : "webrd";
  const server = Math.abs(x + y + z) % 4 + 1;
  if (style === 6) return `https://${host}0${server}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`;
  return `https://${host}0${server}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`;
}

function loadTileBitmap(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

async function createCourseSatelliteCanvas(loc) {
  const verified = isCourseMapVerified(loc);
  const canvasSize = isCompactViewport() ? 1024 : 1536;
  const zoom = verified ? 17 : 15;
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext("2d");
  const courseCenter = getCourseMapCenter(loc);
  const center = wgs84ToGcj02(courseCenter.lat, courseCenter.lng);
  const centerWorld = lngLatToWorld(center.lng, center.lat, zoom);
  const minWorldX = centerWorld.x - canvasSize / 2;
  const minWorldY = centerWorld.y - canvasSize / 2;
  const minTileX = Math.floor(minWorldX / MAP_TILE_SIZE);
  const maxTileX = Math.floor((minWorldX + canvasSize) / MAP_TILE_SIZE);
  const minTileY = Math.floor(minWorldY / MAP_TILE_SIZE);
  const maxTileY = Math.floor((minWorldY + canvasSize) / MAP_TILE_SIZE);
  const tileCount = 2 ** zoom;
  let loadedCount = 0;

  ctx.fillStyle = "#13231f";
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  for (let pass = 0; pass < 2; pass++) {
    const style = pass === 0 ? 6 : 8;
    ctx.globalAlpha = pass === 0 ? 1 : 0.38;
    const jobs = [];
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const wrappedX = ((tx % tileCount) + tileCount) % tileCount;
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        if (ty < 0 || ty >= tileCount) continue;
        const url = getAmapTileUrlForCourse(wrappedX, ty, zoom, style);
        jobs.push(loadTileBitmap(url).then((image) => {
          if (!image) return;
          const dx = Math.round(tx * MAP_TILE_SIZE - minWorldX);
          const dy = Math.round(ty * MAP_TILE_SIZE - minWorldY);
          ctx.drawImage(image, dx, dy, MAP_TILE_SIZE + 1, MAP_TILE_SIZE + 1);
          if (pass === 0) loadedCount += 1;
        }));
      }
    }
    await Promise.all(jobs);
  }

  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, 0, canvasSize, canvasSize);
  shade.addColorStop(0, "rgba(255,255,255,0.08)");
  shade.addColorStop(0.45, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.20)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  ctx.fillStyle = "rgba(2, 8, 10, 0.48)";
  ctx.fillRect(0, canvasSize - 78, canvasSize, 78);
  ctx.fillStyle = "rgba(238, 250, 255, 0.92)";
  ctx.font = "700 32px Microsoft YaHei, sans-serif";
  ctx.fillText(loc.name, 36, canvasSize - 36);
  ctx.font = "20px Microsoft YaHei, sans-serif";
  ctx.fillText(`${getCourseMapName(loc)} · ${verified ? "已校准球场实景" : "估算球场范围"} · 高德卫星瓦片`, 36, canvasSize - 12);

  if (!verified) {
    ctx.fillStyle = "rgba(255, 210, 120, 0.88)";
    ctx.font = "18px Microsoft YaHei, sans-serif";
    ctx.fillText("未配置高德 Key 时使用较大范围卫星图，接入 API 后会自动锁定球场 POI。", 36, canvasSize - 104);
  }

  if (!loadedCount) throw new Error("satellite tiles failed");
  return canvas;
}

function createTerrainLoadingMesh() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 4.2, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x284538, roughness: 0.92, metalness: 0.02 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.38;
  courseTerrainGroup.add(mesh);
}

async function updateCourseTerrainView(index) {
  const loc = golfLocations[index];
  if (!loc) return;
  const token = ++terrainLoadToken;
  clearCourseTerrainGroup();
  createTerrainLoadingMesh();
  modelLabel.textContent = `${loc.name} · 正在加载实景卫星地形`;

  try {
    const courseCenter = getCourseMapCenter(loc);
    const textureKey = `${loc.id}-${loc.mapPrecision || "estimated"}-${courseCenter.lat.toFixed(5)}-${courseCenter.lng.toFixed(5)}`;
    let texture = courseTerrainTextureCache.get(textureKey);
    if (!texture) {
      const canvas = await createCourseSatelliteCanvas(loc);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(modelRenderer.capabilities.getMaxAnisotropy?.() || 1, 8);
      courseTerrainTextureCache.set(textureKey, texture);
    }
    if (token !== terrainLoadToken || selectedCourseIndex !== index) return;
    clearCourseTerrainGroup();

    const geometry = new THREE.PlaneGeometry(6.4, 4.65, 96, 72);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const ridge = Math.sin(x * 2.6 + y * 1.2) * 0.035 + Math.cos(y * 3.2) * 0.025;
      const edge = Math.max(Math.abs(x) / 3.2, Math.abs(y) / 2.325);
      positions.setZ(i, ridge - Math.max(0, edge - 0.72) * 0.18);
    }
    geometry.computeVertexNormals();

    const terrain = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.82,
        metalness: 0.02,
      })
    );
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = -0.34;
    courseTerrainGroup.add(terrain);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(6.45, 0.16, 4.7),
      new THREE.MeshStandardMaterial({ color: 0x12201d, roughness: 0.9 })
    );
    base.position.y = -0.49;
    courseTerrainGroup.add(base);

    modelLabel.textContent = `${loc.name} · 实景卫星 2.5D 地形`;
  } catch {
    if (token !== terrainLoadToken) return;
    clearCourseTerrainGroup();
    createFallbackCourseModel();
    modelGroup.visible = true;
    courseTerrainGroup.visible = false;
    modelLabel.textContent = `${loc.name} · 卫星地形加载失败，已切回 3D 模型`;
  }
}

function syncModelViewButtons() {
  modelTerrainToggle?.classList.toggle("active", modelViewMode === "terrain");
  modelGenericToggle?.classList.toggle("active", modelViewMode === "model");
  modelAmapToggle?.classList.toggle("active", modelViewMode === "amap");
}

function hideEmbeddedAmap() {
  if (embeddedAmap) {
    embeddedAmap.destroy();
    embeddedAmap = null;
  }
  externalMapViewer?.classList.remove("visible", "ready");
  externalMapViewer?.setAttribute("aria-hidden", "true");
}

function hasAmapJsKey() {
  return Boolean(String(mapConfig.amapKey || "").trim());
}

function gcj02ToWgs84(lat, lng) {
  if (isOutsideChina(lat, lng)) return { lat, lng };
  let wLat = lat;
  let wLng = lng;
  for (let i = 0; i < 8; i++) {
    const gcj = wgs84ToGcj02(wLat, wLng);
    wLat -= gcj.lat - lat;
    wLng -= gcj.lng - lng;
  }
  return { lat: wLat, lng: wLng };
}

function getCourseMapKeyword(loc) {
  return loc.amapSearchKeyword || `${loc.province || ""} ${loc.city || ""} ${getCourseMapName(loc)} 高尔夫球场`.trim();
}

function loadAmapJsApi() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapLoaderPromise) return amapLoaderPromise;
  amapLoaderPromise = new Promise((resolve, reject) => {
    const key = String(mapConfig.amapKey || "").trim();
    if (!key) {
      reject(new Error("missing amap key"));
      return;
    }
    if (mapConfig.amapSecurityJsCode) {
      window._AMapSecurityConfig = { securityJsCode: mapConfig.amapSecurityJsCode };
    }
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error("amap unavailable"));
    script.onerror = () => reject(new Error("amap script failed"));
    document.head.appendChild(script);
  });
  return amapLoaderPromise;
}

function getAmapPoiLocation(poi) {
  const location = poi?.location;
  if (!location) return null;
  const lng = Number(location.lng ?? location[0] ?? (typeof location.getLng === "function" ? location.getLng() : NaN));
  const lat = Number(location.lat ?? location[1] ?? (typeof location.getLat === "function" ? location.getLat() : NaN));
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function scoreAmapCoursePoi(loc, poi) {
  const name = String(poi?.name || "");
  const address = String(poi?.address || "");
  const type = String(poi?.type || "");
  const text = `${name} ${address} ${type}`;
  let score = 0;
  ["高尔夫", "球会", "球场", "俱乐部", "乡村"].forEach((token) => {
    if (text.includes(token)) score += 24;
  });
  const baseName = loc.name.replace(/高尔夫|俱乐部|球会|球场|国际|重庆|上海|北京|深圳|广州|成都|武汉|天津|南京|青岛|大连/g, "");
  if (baseName && text.includes(baseName)) score += 18;
  if (loc.city && text.includes(loc.city)) score += 6;
  if (loc.province && text.includes(loc.province)) score += 4;
  ["社区", "小区", "酒店", "公司", "学院", "产业园", "售楼", "公寓", "学校"].forEach((token) => {
    if (name.includes(token) && !name.includes("高尔夫")) score -= 30;
  });

  const poiLoc = getAmapPoiLocation(poi);
  if (poiLoc) {
    const expected = wgs84ToGcj02(getCourseMapCenter(loc).lat, getCourseMapCenter(loc).lng);
    const distance = Math.hypot((poiLoc.lng - expected.lng) * 96, (poiLoc.lat - expected.lat) * 111);
    if (distance <= 1.2) score += 14;
    else if (distance <= 6) score += 5;
    else score -= Math.min(24, distance * 1.5);
  }
  return score;
}

function resolveCourseMapInfoWithAmap(AMap, loc) {
  if (!AMap?.PlaceSearch) {
    return new Promise((resolve) => {
      AMap.plugin?.("AMap.PlaceSearch", () => resolve(resolveCourseMapInfoWithAmap(AMap, loc)));
      if (!AMap.plugin) resolve(null);
    });
  }
  const cacheKey = loc.id || loc.name;
  if (amapCourseResolutionCache.has(cacheKey)) return Promise.resolve(amapCourseResolutionCache.get(cacheKey));

  return new Promise((resolve) => {
    const search = new AMap.PlaceSearch({
      city: loc.city || loc.province || "全国",
      citylimit: false,
      pageSize: 12,
      extensions: "base",
    });
    search.search(getCourseMapKeyword(loc), (status, result) => {
      const pois = result?.poiList?.pois || [];
      const best = pois
        .map((poi) => ({ poi, score: scoreAmapCoursePoi(loc, poi), location: getAmapPoiLocation(poi) }))
        .filter((item) => item.location && item.score >= 22)
        .sort((a, b) => b.score - a.score)[0];

      if (!best) {
        amapCourseResolutionCache.set(cacheKey, null);
        resolve(null);
        return;
      }

      const wgsCenter = gcj02ToWgs84(best.location.lat, best.location.lng);
      const info = {
        amapPoiName: best.poi.name || getCourseMapName(loc),
        courseMapCenter: wgsCenter,
        mapPrecision: "amap-poi",
      };
      amapCourseResolutionCache.set(cacheKey, info);
      resolve(info);
    });
  });
}

async function applyAmapCourseResolution(index) {
  if (!hasAmapJsKey()) return null;
  const loc = golfLocations[index];
  if (!loc) return null;
  try {
    const AMap = await loadAmapJsApi();
    const info = await resolveCourseMapInfoWithAmap(AMap, loc);
    if (info) Object.assign(loc, info);
    return info;
  } catch {
    return null;
  }
}

function showCourseTerrainMode() {
  modelViewMode = "terrain";
  syncModelViewButtons();
  hideEmbeddedAmap();
  modelCanvas.style.visibility = "visible";
  modelGroup.visible = false;
  courseTerrainGroup.visible = true;
  modelControls.enabled = true;
  if (selectedCourseIndex !== null) {
    const index = selectedCourseIndex;
    if (hasAmapJsKey()) {
      applyAmapCourseResolution(index).finally(() => {
        if (selectedCourseIndex === index && modelViewMode === "terrain") updateCourseTerrainView(index);
      });
    } else {
      updateCourseTerrainView(index);
    }
  }
}

function showGenericModelMode() {
  modelViewMode = "model";
  syncModelViewButtons();
  hideEmbeddedAmap();
  modelCanvas.style.visibility = "visible";
  courseTerrainGroup.visible = false;
  modelGroup.visible = true;
  modelControls.enabled = true;
  if (selectedCourseIndex !== null) modelLabel.textContent = `${golfLocations[selectedCourseIndex].name} · 3D 球场模型`;
}

function showEmbeddedAmapMode() {
  modelViewMode = "amap";
  syncModelViewButtons();
  if (!externalMapViewer || !amapCourseMap || !externalMapStatus || selectedCourseIndex === null) return;
  const loc = golfLocations[selectedCourseIndex];
  externalMapViewer.classList.add("visible");
  externalMapViewer.classList.remove("ready");
  externalMapViewer.setAttribute("aria-hidden", "false");
  modelCanvas.style.visibility = "hidden";
  modelControls.enabled = false;
  externalMapStatus.textContent = hasAmapJsKey()
    ? "正在加载高德 JSAPI 3D 实景地图..."
    : "未配置高德 JSAPI Key：当前项目已提供真实卫星 2.5D 地形；如需官方高德 3D 地图，请在 window.GOLF_MAP_CONFIG 中填写 amapKey 和安全密钥。";
  modelLabel.textContent = `${loc.name} · 高德 3D 实景地图`;

  if (!hasAmapJsKey()) return;

  loadAmapJsApi().then(async (AMap) => {
    if (modelViewMode !== "amap" || selectedCourseIndex === null) return;
    await applyAmapCourseResolution(selectedCourseIndex);
    if (modelViewMode !== "amap" || selectedCourseIndex === null) return;
    const currentLoc = golfLocations[selectedCourseIndex];
    if (embeddedAmap) {
      embeddedAmap.destroy();
      embeddedAmap = null;
    }
    const courseCenter = getCourseMapCenter(currentLoc);
    const point = wgs84ToGcj02(courseCenter.lat, courseCenter.lng);
    const layers = [
      new AMap.TileLayer.Satellite(),
      new AMap.TileLayer.RoadNet(),
    ];
    embeddedAmap = new AMap.Map(amapCourseMap, {
      viewMode: "3D",
      zoom: 17.4,
      pitch: 68,
      rotation: -28,
      center: [point.lng, point.lat],
      layers,
      resizeEnable: true,
      terrain: true,
      features: ["bg", "road", "building", "point"],
    });
    new AMap.Marker({
      position: [point.lng, point.lat],
      title: getCourseMapName(currentLoc),
      map: embeddedAmap,
    });
    externalMapViewer.classList.add("ready");
    setTimeout(() => embeddedAmap?.resize?.(), 120);
  }).catch(() => {
    externalMapStatus.textContent = "高德 JSAPI 加载失败：请确认 Key、安全密钥、域名白名单和网络状态。当前可继续使用实景卫星 2.5D 地形。";
  });
}

function createFallbackCourseModel() {
  if (modelHasFallback || modelGroup.children.length > 0) return;
  modelHasFallback = true;

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 3.15, 0.18, 64),
    new THREE.MeshStandardMaterial({ color: 0x3f7c43, roughness: 0.88 })
  );
  base.position.y = -0.45;
  modelGroup.add(base);

  const fairwayMat = new THREE.MeshStandardMaterial({ color: 0x8fc86b, roughness: 0.74 });
  const greenMat = new THREE.MeshStandardMaterial({ color: 0xa8db7b, roughness: 0.62 });
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xd8c58c, roughness: 0.9 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x3c83a9, roughness: 0.42, metalness: 0.05 });

  for (let i = 0; i < 5; i++) {
    const fairway = new THREE.Mesh(new THREE.SphereGeometry(0.72, 32, 12), fairwayMat);
    fairway.scale.set(1.7, 0.08, 0.42);
    fairway.position.set(-1.7 + i * 0.85, -0.3 + i * 0.015, Math.sin(i * 1.2) * 0.72);
    fairway.rotation.y = -0.35 + i * 0.18;
    modelGroup.add(fairway);
  }

  const water = new THREE.Mesh(new THREE.SphereGeometry(0.58, 32, 12), waterMat);
  water.scale.set(1.4, 0.05, 0.48);
  water.position.set(1.05, -0.24, 0.72);
  water.rotation.y = 0.5;
  modelGroup.add(water);

  for (let i = 0; i < 4; i++) {
    const sand = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 8), sandMat);
    sand.scale.set(1.45, 0.05, 0.62);
    sand.position.set(-1.1 + i * 0.7, -0.21, -0.9 + Math.sin(i) * 0.24);
    sand.rotation.y = i * 0.7;
    modelGroup.add(sand);
  }

  const green = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 10), greenMat);
  green.scale.set(1.45, 0.06, 0.82);
  green.position.set(1.9, -0.19, -0.45);
  green.rotation.y = -0.4;
  modelGroup.add(green);

  loadingText.textContent = "已载入备用地形";
  loadingPercent.textContent = "100%";
  loadingScreen.classList.add("fade-out");
  setTimeout(() => {
    loadingScreen.style.display = "none";
  }, 500);
}

const loadingScreen = document.getElementById("loading-screen");
const loadingPercent = document.getElementById("loading-percent");
const loadingText = document.getElementById("loading-text");

const loader = new GLTFLoader();
loader.load(
  "./assets/golf_scene.glb",
  (gltf) => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = 6.0;
    const scale = targetSize / maxDim;

    gltf.scene.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    gltf.scene.position.set(-center.x * scale, -center.y * scale + 0.35, -center.z * scale);

    modelGroup.add(gltf.scene);

    loadingText.textContent = "加载完成";
    loadingPercent.textContent = "100%";
    loadingScreen.classList.add("fade-out");
    setTimeout(() => {
      loadingScreen.style.display = "none";
    }, 700);
  },
  (xhr) => {
    if (xhr.total > 0) {
      const pct = Math.min(99, Math.round((xhr.loaded / xhr.total) * 100));
      loadingPercent.textContent = pct + "%";
    }
  },
  () => {
    console.warn("Golf model failed to load, path:", "./assets/golf_scene.glb");
    createFallbackCourseModel();
  }
);

// ─── Raycaster click interaction ───────────────────────────
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 0.02;
const mouse = new THREE.Vector2();
const mouseDown = new THREE.Vector2();
const mouseUp = new THREE.Vector2();
const modelRaycaster = new THREE.Raycaster();
const modelMouse = new THREE.Vector2();
const modelMouseDown = new THREE.Vector2();
const modelMouseUp = new THREE.Vector2();
let lastModelFocusPoint = null;
let modelZoomStep = 0;
let modelCameraTween = null;
let caddyRequestId = 0;


const overlay = document.getElementById("overlay");
const cardTitle = document.getElementById("card-title");
const cardDesc = document.getElementById("card-desc");
const cardClose = document.getElementById("card-close");
const courseTerrain = document.getElementById("course-terrain");
const courseEnvironment = document.getElementById("course-environment");
const courseSummary = document.getElementById("course-summary");
const courseTabButtons = document.querySelectorAll(".course-tab");
const courseTabPanel = document.getElementById("course-tab-panel");

const caddyText = document.getElementById("caddy-text");
const caddyBubble = document.getElementById("caddy-bubble");
const modelLabel = document.getElementById("model-label");
const caddyModeButtons = document.querySelectorAll(".caddy-mode");
const caddyNote = document.getElementById("caddy-note");
const caddyAsk = document.getElementById("caddy-ask");
let selectedCourseIndex = null;
let selectedCaddyMode = "strategy";
let photoDetailVisible = false;
let realViewDragging = false;
let realViewStartX = 0;
let realViewStartYaw = 0;
let realViewYaw = 0;

modelTerrainToggle?.addEventListener("click", showCourseTerrainMode);
modelGenericToggle?.addEventListener("click", showGenericModelMode);
modelAmapToggle?.addEventListener("click", showEmbeddedAmapMode);

function getCourseVideoSrc(index) {
  const loc = golfLocations[index];
  return loc?.realviewVideo || "";
}

function applyRealViewYaw() {
  const shift = Math.sin(realViewYaw) * 10;
  const scale = 1.16 + Math.abs(Math.cos(realViewYaw)) * 0.03;
  if (photoDetailVideo) photoDetailVideo.style.transform = `scale(${scale}) translateX(${shift}%)`;
  if (photoDetailImage) photoDetailImage.style.transform = `scale(${scale}) translateX(${shift * 0.45}%)`;
}

function hideOverlay() {
  caddyRequestId += 1;
  terrainLoadToken += 1;
  hidePhotoDetail();
  hideEmbeddedAmap();
  modelCanvas.style.visibility = "visible";
  selectedCourseIndex = null;
  overlay.classList.remove("visible");
  document.body.classList.remove("overlay-open");
}

function easeOutCubic(p) {
  return 1 - Math.pow(1 - p, 3);
}

function easeInOutCubic(p) {
  return p < 0.5
    ? 4 * p * p * p
    : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function focusModelAtPoint(point) {
  modelLabel.textContent = selectedCourseIndex === null
    ? "已聚焦到球场局部区域"
    : `${golfLocations[selectedCourseIndex].name} · 已聚焦到球场局部区域`;
  const distances = [4.6, 2.35, 1.05];
  const sameArea = lastModelFocusPoint && lastModelFocusPoint.distanceTo(point) < 2.4;
  modelZoomStep = sameArea ? Math.min(modelZoomStep + 1, distances.length - 1) : 0;
  lastModelFocusPoint = point.clone();

  const currentOffset = modelCamera.position.clone().sub(modelControls.target);
  const direction = currentOffset.lengthSq() > 0.0001
    ? currentOffset.normalize()
    : new THREE.Vector3(0.55, 0.6, 0.55).normalize();

  modelCameraTween = {
    startTime: performance.now(),
    duration: 680,
    fromPosition: modelCamera.position.clone(),
    fromTarget: modelControls.target.clone(),
    toPosition: point.clone().add(direction.multiplyScalar(distances[modelZoomStep])),
    toTarget: point.clone(),
    revealPhoto: false,
  };
}

function updateModelCameraTween() {
  if (!modelCameraTween) return;

  const elapsed = performance.now() - modelCameraTween.startTime;
  const p = Math.min(elapsed / modelCameraTween.duration, 1);
  const t = easeOutCubic(p);

  modelCamera.position.lerpVectors(modelCameraTween.fromPosition, modelCameraTween.toPosition, t);
  modelControls.target.lerpVectors(modelCameraTween.fromTarget, modelCameraTween.toTarget, t);

  if (p >= 1) {
    const shouldRevealPhoto = modelCameraTween.revealPhoto;
    modelCameraTween = null;
    if (shouldRevealPhoto) showPhotoDetail();
  }
}

function createFallbackPhoto(loc) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 760;
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#c7e4f2");
  sky.addColorStop(0.38, "#7fb2a4");
  sky.addColorStop(1, "#315f33");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width * 0.5, canvas.height * 0.62);
  ctx.rotate(-0.16);
  ctx.fillStyle = "#6fb55b";
  ctx.beginPath();
  ctx.ellipse(0, 0, 560, 210, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#93cf79";
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.ellipse(-470 + i * 160, Math.sin(i) * 42, 120, 42, Math.sin(i) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#345d86";
  ctx.beginPath();
  ctx.ellipse(230, 35, 145, 54, 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e6d8a8";
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(-330 + i * 150, 70 + Math.sin(i) * 32, 52, 22, i * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(600, 380, 120, 600, 380, 760);
  vignette.addColorStop(0, "rgba(255,255,255,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "700 38px Microsoft YaHei, sans-serif";
  ctx.fillText(loc.name, 44, 72);
  ctx.font = "24px Microsoft YaHei, sans-serif";
  ctx.fillText(`${loc.tags.terrain} · ${loc.tags.skill}`, 44, 112);
  return canvas.toDataURL("image/png");
}

function showPhotoDetail() {
  if (selectedCourseIndex === null) return;
  const loc = golfLocations[selectedCourseIndex];
  const videoSrc = getCourseVideoSrc(selectedCourseIndex);

  let src = "";
  try {
    modelControls.update();
    modelRenderer.render(modelScene, modelCamera);
    src = modelCanvas.toDataURL("image/png");
  } catch {
    src = createFallbackPhoto(loc);
  }

  photoDetailImage.src = src || createFallbackPhoto(loc);
  if (!videoSrc) {
    photoDetailVideo.style.display = "none";
    photoDetailTitle.textContent = `${loc.name} · 暂无实景视频`;
    photoDetailMeta.textContent = "当前球场尚未接入实景资源，已保留 3D 球场模型视角。";
    photoDetail.classList.add("visible");
    photoDetail.setAttribute("aria-hidden", "false");
    photoDetailVisible = true;
    modelControls.enabled = false;
    return;
  }

  photoDetailVideo.src = videoSrc;
  photoDetailVideo.poster = photoDetailImage.src;
  photoDetailVideo.style.display = "block";
  try {
    photoDetailVideo.currentTime = 0;
  } catch {
    // Metadata may not be ready yet; playback still starts from the beginning for a new src.
  }
  realViewYaw = 0;
  applyRealViewYaw();
  photoDetailVideo.load();
  photoDetailVideo.play().catch(() => {});
  photoDetailTitle.textContent = `${loc.name} · 实景视频 / 360环视`;
  photoDetailMeta.textContent = "按住实景水平拖动，可模拟以自我为中心的 360 度观察。";
  photoDetail.classList.add("visible");
  photoDetail.setAttribute("aria-hidden", "false");
  photoDetailVisible = true;
  modelControls.enabled = false;
}

function hidePhotoDetail() {
  if (!photoDetail) return;
  photoDetail.classList.remove("visible");
  photoDetail.setAttribute("aria-hidden", "true");
  photoDetailVisible = false;
  if (photoDetailVideo) {
    photoDetailVideo.pause();
    photoDetailVideo.removeAttribute("src");
    photoDetailVideo.load();
  }
  if (modelControls) modelControls.enabled = true;
}

function getAmapCourseUrl(loc) {
  const courseCenter = getCourseMapCenter(loc);
  const name = encodeURIComponent(getCourseMapName(loc));
  const city = encodeURIComponent(loc.city || loc.province || "");
  if (!isCourseMapVerified(loc)) {
    const keyword = encodeURIComponent(getCourseMapKeyword(loc));
    return `https://uri.amap.com/search?keyword=${keyword}&city=${city}&src=3d-golf&callnative=0`;
  }
  const point = wgs84ToGcj02(courseCenter.lat, courseCenter.lng);
  return `https://uri.amap.com/marker?position=${point.lng.toFixed(6)},${point.lat.toFixed(6)}&name=${name}&src=3d-golf&coordinate=gaode&callnative=0&city=${city}`;
}

function openAmapCourseMap() {
  if (selectedCourseIndex === null) return;
  const loc = golfLocations[selectedCourseIndex];
  const url = loc.externalMapUrl || loc.amapUrl || getAmapCourseUrl(loc);
  const nextWindow = window.open(url, "_blank");
  if (nextWindow) nextWindow.opener = null;
  if (!nextWindow && courseTabPanel) {
    courseTabPanel.insertAdjacentHTML(
      "beforeend",
      `<p class="course-provider-note">浏览器拦截了新窗口，请允许弹窗后再次点击“打开高德地图”。</p>`
    );
  }
}

function getCourseDescription(loc) {
  const parts = [loc.description];
  if (userProfile) {
    const match = calculateMatch(userProfile, loc);
    parts.push(`匹配度 ${match.finalScore}%，难度 ${loc.tags.skill}，核心风格：${loc.tags.strategy} / ${loc.tags.terrain} / ${loc.tags.environment}。`);
  }
  const distance = formatDistance(getCourseDistance(loc));
  if (distance) parts.push(`当前位置距离约 ${distance}。`);
  return parts.join(" ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function renderCourseTab(tabName = "terrain") {
  if (selectedCourseIndex === null || !courseTabPanel) return;
  const loc = golfLocations[selectedCourseIndex];
  courseTabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.courseTab === tabName);
  });

  if (tabName === "environment") {
    courseTabPanel.innerHTML = `
      <strong>${escapeHtml(loc.city || loc.province || "中国球场")}</strong>
      <p>${escapeHtml(loc.environmentLabel || loc.tags.environment)} · ${escapeHtml(loc.description)}</p>
    `;
    return;
  }

  if (tabName === "info") {
    courseTabPanel.innerHTML = `
      <strong>${escapeHtml(loc.name)}</strong>
      <p>${escapeHtml(loc.province || "中国")} ${escapeHtml(loc.city || "")} · ${loc.holes || 18} 洞 · Par ${loc.par || 72}</p>
      <p>练习场：${loc.facilities?.drivingRange ? "有" : "待确认"} · 餐饮：${loc.facilities?.restaurant ? "有" : "待确认"} · 住宿：${loc.facilities?.hotel ? "有" : "待确认"}</p>
    `;
    return;
  }

  if (tabName === "realview") {
    const hasVideo = Boolean(loc.realviewVideo || loc.panoVideo);
    const verified = isCourseMapVerified(loc);
    courseTabPanel.innerHTML = `
      <strong>实景地图 / 360 环视</strong>
	      <p>${verified ? "“当前球场已使用校准坐标。”" : "“当前球场使用估算坐标；接入高德 Key 后会自动搜索并锁定高尔夫 POI。”"}“打开高德地图”会优先进入球场搜索/坐标结果；“播放本地实景”使用当前项目已有视频资源，不再混用。</p>
      <div class="course-action-row">
        <button class="course-realview-button" id="course-amap-embed" type="button">内嵌高德3D</button>
        <button class="course-realview-button" id="course-amap-open" type="button">打开高德地图</button>
        <button class="course-realview-button" id="course-realview-open" type="button" ${hasVideo ? "" : "disabled"}>${hasVideo ? "播放本地实景" : "暂无本地实景"}</button>
      </div>
    `;
    return;
  }

  courseTabPanel.innerHTML = `
    <div class="terrain-mini" aria-hidden="true"></div>
    <p>${escapeHtml(loc.terrainLabel || loc.tags.terrain)} · 二维地图已改为高德/标准地图瓦片底图，缩放时按 zoom 级别重新加载高清底图，球场策略图层叠加显示。</p>
  `;
}

function refreshCaddyAdvice() {
  if (selectedCourseIndex === null) return;

  const loc = golfLocations[selectedCourseIndex];
  const note = caddyNote.value.trim();
  const requestId = ++caddyRequestId;
  caddyText.textContent = "数字球童正在结合档案、球场、距离与现场补充重新分析...";
  caddyBubble.scrollTop = 0;

  getCaddyAdviceFromLLM(loc, selectedCaddyMode, note).then((advice) => {
    if (requestId === caddyRequestId) {
      caddyText.textContent = advice;
      requestAnimationFrame(() => {
        caddyBubble.scrollTop = 0;
      });
    }
  });
}

function openCourse(index, options = {}) {
  const loc = golfLocations[index];
  if (!loc) return;

  if (options.fly && !options.skipFly) {
    if (isTransitioning || mapState.clickLocked) return;
    isTransitioning = true;
    mapState.clickLocked = true;
    mapState.selectedIndex = index;
    pulseGlobeMarker(index);
    listPanel.classList.remove("visible");
    listPanel.setAttribute("aria-hidden", "true");
    if (overlay.classList.contains("visible")) hideOverlay();

    if (mapDetailVisible) {
      renderDetailMapNow();
      animateMapToCourse(index, {
        scale: Math.max(mapState.scale, 4.2),
        onComplete: () => {
          showTransition(`正在进入 ${loc.name} 球场`);
          window.setTimeout(() => {
            openCourse(index, { skipFly: true, fromMap: true });
            hideTransition();
            mapState.clickLocked = false;
            viewMode = "map";
            unlockTransition();
          }, prefersReducedMotion ? 80 : 340);
        },
      });
      return;
    }

    showTransition(`正在进入 ${loc.name} 球场`);
    const didFly = flyToCourse(index, options.distance || 1.55, () => {
      openCourse(index, { skipFly: true, fromGlobe: true });
      setTimeout(hideTransition, 240);
      mapState.clickLocked = false;
      viewMode = "globe";
      unlockTransition(120);
    });
    if (!didFly) {
      openCourse(index, { skipFly: true });
      setTimeout(hideTransition, 240);
      mapState.clickLocked = false;
      unlockTransition(120);
    }
    return;
  }

  selectedCourseIndex = index;
  selectedCaddyMode = "strategy";
  caddyModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.caddyMode === selectedCaddyMode);
  });
  hidePhotoDetail();
  lastModelFocusPoint = null;
  modelZoomStep = 0;
  modelCameraTween = null;

  cardTitle.textContent = loc.name + " · 高尔夫俱乐部";
  cardDesc.textContent = getCourseDescription(loc);
  courseTerrain.textContent = loc.terrainLabel || loc.tags.terrain;
  courseEnvironment.textContent = loc.environmentLabel || loc.tags.environment;
  courseSummary.textContent = `${loc.city || loc.province || "中国"} · ${loc.holes || 18}洞 · Par ${loc.par || 72}`;
  modelLabel.textContent = loc.name + " · 高尔夫俱乐部";
  listPanel.classList.remove("visible");
  listPanel.setAttribute("aria-hidden", "true");
  overlay.classList.add("visible");
  document.body.classList.add("overlay-open");
  modelRotationEnabled = true;
  syncModelRotationMode();
  showCourseTerrainMode();
  renderCourseTab("terrain");

  refreshCaddyAdvice();
  requestAnimationFrame(() => requestAnimationFrame(updateModelRendererSize));
}

caddyModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedCaddyMode = button.dataset.caddyMode;
    caddyModeButtons.forEach((item) => item.classList.toggle("active", item === button));
    refreshCaddyAdvice();
  });
});

courseTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    renderCourseTab(button.dataset.courseTab);
  });
});

courseTabPanel.addEventListener("click", (e) => {
  const amapEmbedButton = e.target.closest("#course-amap-embed");
  if (amapEmbedButton) {
    showEmbeddedAmapMode();
    return;
  }
  const amapButton = e.target.closest("#course-amap-open");
  if (amapButton) {
    openAmapCourseMap();
    return;
  }
  const realviewButton = e.target.closest("#course-realview-open");
  if (!realviewButton || realviewButton.disabled) return;
  showPhotoDetail();
});

caddyAsk.addEventListener("click", refreshCaddyAdvice);

cardClose.addEventListener("click", (e) => {
  e.stopPropagation();
  hideOverlay();
});

photoDetailClose.addEventListener("click", (e) => {
  e.stopPropagation();
  hidePhotoDetail();
});

photoDetailVideo.addEventListener("pointerdown", (e) => {
  realViewDragging = true;
  realViewStartX = e.clientX;
  realViewStartYaw = realViewYaw;
  photoDetailVideo.setPointerCapture(e.pointerId);
});

photoDetailVideo.addEventListener("pointermove", (e) => {
  if (!realViewDragging) return;
  realViewYaw = realViewStartYaw + (e.clientX - realViewStartX) * 0.006;
  applyRealViewYaw();
});

photoDetailVideo.addEventListener("pointerup", () => {
  realViewDragging = false;
});

photoDetailVideo.addEventListener("pointercancel", () => {
  realViewDragging = false;
});

photoDetailVideo.addEventListener("pointerleave", () => {
  realViewDragging = false;
});

photoDetailVideo.addEventListener("error", () => {
  photoDetailVideo.style.display = "none";
});

renderer.domElement.addEventListener("pointerdown", (e) => {
  mouseDown.set(e.clientX, e.clientY);
});

renderer.domElement.addEventListener("wheel", (e) => {
  if (e.deltaY < 0) requestMapDetailAfterZoom();
}, { passive: true });

renderer.domElement.addEventListener("pointerup", (e) => {
  mouseUp.set(e.clientX, e.clientY);
  if (mouseDown.distanceTo(mouseUp) > 3) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const clickable = markers.flatMap(m => m.pillar ? [m.dot, m.pillar] : [m.dot]);
  const hits = raycaster.intersectObjects(clickable);

  if (hits.length > 0) {
    const idx = hits[0].object.userData.index;
    openCourse(idx, { fly: true, distance: 1.42 });
  } else {
    hideOverlay();
  }
});

modelCanvas.addEventListener("pointerdown", (e) => {
  modelMouseDown.set(e.clientX, e.clientY);
  modelIsDragging = true;
});

modelCanvas.addEventListener("pointerup", (e) => {
  modelIsDragging = false;
  if (photoDetailVisible) return;
  modelMouseUp.set(e.clientX, e.clientY);
  if (modelMouseDown.distanceTo(modelMouseUp) > 4) return;

  const rect = modelCanvas.getBoundingClientRect();
  modelMouse.x = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  modelMouse.y = -((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;

  modelRaycaster.setFromCamera(modelMouse, modelCamera);
  const hits = modelRaycaster.intersectObjects(modelGroup.children, true);
  if (hits.length > 0) focusModelAtPoint(hits[0].point);
});

modelCanvas.addEventListener("pointercancel", () => {
  modelIsDragging = false;
});

modelCanvas.addEventListener("pointerleave", () => {
  modelIsDragging = false;
});

// ─── Animation loop ───────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  const sunAngle = 0.35 + Math.sin(t * 0.015) * 0.06;
  spaceAccents.sunSprite.position.set(Math.cos(sunAngle) * 18, 5.8, Math.sin(sunAngle) * 18);
  sun.position.copy(spaceAccents.sunSprite.position).normalize().multiplyScalar(8);
  spaceAccents.moon.position.set(Math.cos(t * 0.035) * 3.4, 1.4 + Math.sin(t * 0.05) * 0.28, Math.sin(t * 0.035) * 3.4);
  spaceAccents.moonHalo.position.copy(spaceAccents.moon.position);

  if (viewMode === "globe" && !earthUserInteracting && !earthCameraTween && !overlay.classList.contains("visible")) {
    const spin = dt * 0.018;
    earth.rotation.y += spin;
    if (markerContainer) markerContainer.rotation.y = earth.rotation.y;
  }

  updateMapTween();

  markers.forEach((m, i) => {
    const pulse = 1 + Math.sin(t * 2.5 + i) * 0.04;
    const clickPulse = m.clickPulseUntil && performance.now() < m.clickPulseUntil
      ? 1 + Math.sin(t * 22) * 0.18 + 0.24
      : 1;

    if (m.highlight) {
      const s = pulse * 1.2 * clickPulse;
      m.dot.scale.setScalar(s);
      m.glow.scale.set(0.026 * s, 0.026 * s, 1);

    } else {
      const s = pulse * clickPulse;
      m.dot.scale.setScalar(s);
      m.glow.scale.set(0.022 * s, 0.022 * s, 1);
    }
  });

  updateEarthCameraTween();
  if (!earthCameraTween) controls.update();
  maybeEnterMapDetailFromGlobe();
  renderer.render(scene, camera);

  if (overlay.classList.contains("visible")) {
    updateModelRendererSize();
    updateModelCameraTween();
    modelControls.update();
    if (modelRotationEnabled && !modelIsDragging && !photoDetailVisible) {
      modelGroup.rotation.y += dt * Number(modelRotateSpeed.value);
    }
    modelRenderer.render(modelScene, modelCamera);
  }
}

animate();

// ─── Touch hint adaptation ─────────────────────────────────
const hintEl = document.getElementById("hint");
if (isTouchDevice) {
  hintEl.innerHTML = "单指浏览 &nbsp;|&nbsp; 双指缩放 &nbsp;|&nbsp; 点击光点查看详情";
}

// ─── Resize handler ───────────────────────────────────────
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (mapDetailVisible) renderDetailMapNow();
});
