import * as THREE from 'three';
window.THREE = THREE; // 콘솔에서 테스트하려고 임시로 노출
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  30,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0.3, 6);

const PIXEL_SCALE = 0.9;

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setClearColor(0x000000, 0);

function applyPixelSize() {
  const w = Math.max(1, Math.floor(window.innerWidth * PIXEL_SCALE));
  const h = Math.max(1, Math.floor(window.innerHeight * PIXEL_SCALE));
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = window.innerWidth + 'px';
  renderer.domElement.style.height = window.innerHeight + 'px';
  renderer.domElement.style.imageRendering = 'pixelated';
}
applyPixelSize();

document.body.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 2.0);
scene.add(ambient);
const directional = new THREE.DirectionalLight(0xffffff, 0.5);
directional.position.set(2, 3, 4);
scene.add(directional);

let pmremGenerator = new THREE.PMREMGenerator(renderer);
function buildEnvironment() {
  const envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
}
buildEnvironment();

renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
}, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  buildEnvironment();
}, false);

// ===== GLB 모델 로딩 =====
const loader = new GLTFLoader();

const worldGroup = new THREE.Group();
scene.add(worldGroup);

// 로딩 화면 관리 — furniture, bedding, character, character2 이렇게 4개 GLB가
// 다 로딩 완료되면(성공이든 실패든) 캔버스를 서서히 보이게 하고 로고를 치움.
// 캔버스를 로딩 끝날 때까지 opacity:0으로 숨겨두기 때문에, 하나씩 로딩되는
// 인규/책상이 로고 뒤로 비쳐 보이는 문제가 생기지 않음.
const TOTAL_ASSETS_TO_LOAD = 4;
let loadedAssetCount = 0;
function markAssetLoaded() {
  loadedAssetCount += 1;
  if (loadedAssetCount >= TOTAL_ASSETS_TO_LOAD) {
    renderer.domElement.classList.add('loaded');
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 500);
    }
  }
}



let furnitureRoot = null;
let characterRoot = null;      // 지금 화면에 붙어있는 캐릭터(작업용 또는 sleep용)
window.characterRoot = () => characterRoot; // 콘솔 디버그용
let characterBaseX = 0;
let characterBaseY = 0;
let characterBaseRotationX = 0;
let characterBaseZ = 0;
let characterScaledHeight = 0; // 발끝~머리끝 실제 높이(월드 단위) — sleep 회전 pivot 보정용

// 의자 오브젝트 참조. sleep(책상 위에서 자는) 자세일 때만 숨기려고
// furnitureRoot 로딩 콜백 안 지역 변수였던 걸 전역으로 승격시킴.
let chairObj = null;
// 노트북/마우스/커피 — sleep일 때만 숨김 (책상은 그대로 둠)
let laptopObj = null, mouseObj = null, coffeeObj = null;

// 이불+베개
let beddingRoot = null;
window.beddingRoot = () => beddingRoot; // 콘솔 디버그용

// ===== sleep 중 머리 위에 떠오르는 "Z" 표현 =====
function createZTexture() {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 128;
  canvasEl.height = 128;
  const ctx = canvasEl.getContext('2d');
  ctx.font = 'bold 90px "MyPixelFont", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; // 외곽선 모서리를 둥글게 (뾰족하게 튀는 거 방지)

  // 외곽선을 먼저 그리고, 그 위에 채우기 색을 덮어야 글자 안쪽은 원래 색, 테두리만 흰색으로 보임
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8; // 외곽선 두께 — 두꺼울수록 진하게 보임, 조절 가능
  ctx.strokeText('Z', 64, 68);

  ctx.fillStyle = '#5b6b8c';
  ctx.fillText('Z', 64, 68);

  return new THREE.CanvasTexture(canvasEl);
}

// ===== 작업 중 머리 위에 뜨는 생각풍선(랜덤 이모지) =====
const THOUGHT_EMOJI_POOL = ['❓', '💀', '🫪', '👀', '😴', '🛸', '❗️', '🍕', '🤤', '💓', '🎵', '👽'];

function createThoughtBubbleTexture(emoji) {
  const showTimerText = window.showTimerTextInBubble && window.currentTimerLabelText;

  // 텍스트 실측을 먼저 하고, 그 값에 맞춰 말풍선 폭(bw)과 캔버스 폭을 나중에 정함.
  // 캔버스 크기를 먼저 고정해두고 텍스트를 거기 맞추면 긴 텍스트가 잘리니, 순서를 반대로 함:
  // 1) 임시 캔버스로 텍스트 폭을 잰다 → 2) 그 폭에 맞는 진짜 캔버스를 만든다 → 3) 그린다.
  const bx = 10, by = 10, bh = 80, r = 24;
  let bw = 140;
  let measuredTextWidth = 0;

  if (showTimerText) {
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = 'bold 30px "MyPixelFont", monospace';
    measuredTextWidth = measureCtx.measureText(window.currentTimerLabelText).width;
    bw = Math.max(140, measuredTextWidth + 56); // 좌우 여백 28px씩, 최소 140px은 유지
  }

    const SCALE = showTimerText ? 6 : 2; // 타이머 텍스트 모드일 때만 훨씬 높은 해상도로 그림
  const canvasEl = document.createElement('canvas');
  const canvasWidth = showTimerText ? bw + 24 : 160; // 말풍선 폭(bw) + 좌우 캔버스 여백
  const canvasHeight = 160;
  canvasEl.width = canvasWidth * SCALE;
  canvasEl.height = canvasHeight * SCALE;
  const ctx = canvasEl.getContext('2d');
  ctx.scale(SCALE, SCALE); // 이후 모든 그리기 좌표는 기존 숫자 그대로 써도 2배 해상도로 그려짐

  // 말풍선 배경(둥근 사각형 + 꼬리 동그라미 두 개, 생각풍선 느낌)
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
  ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
  ctx.arcTo(bx, by + bh, bx, by, r);
  ctx.arcTo(bx, by, bx + bw, by, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 생각풍선 꼬리(작은 원 2개)
  ctx.beginPath();
  ctx.arc(55, by + bh + 18, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(38, by + bh + 38, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (showTimerText) {
    // 표시 켜짐: 이모지 대신 타이머 텍스트만 크게, 진한 색으로
    ctx.font = 'bold 30px "MyPixelFont", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText(window.currentTimerLabelText, bx + bw / 2, by + bh / 2 + 2);
  } else {
    // 표시 꺼짐(기본): 기존처럼 이모지만
    ctx.font = '48px sans-serif';
    ctx.fillText(emoji, bx + bw / 2, by + bh / 2 + 2);
  }

  const tex = new THREE.CanvasTexture(canvasEl);
  tex.magFilter = THREE.NearestFilter; // 확대할 때 부드럽게 뭉개지지 않고 또렷하게 보이도록
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
// ===== 작업 시작 시 책상에 쌓이는 서류 뭉텅이 =====
const PAPER_TAB_COLORS = ['#d4b95e', '#c9a94a', '#8fa876', '#6f9a6a', '#6a8fa0', '#5a7d92'];

// 서류 뭉텅이 옆면(긴 면)에 랜덤 색깔 인덱스탭을 그린 텍스처 생성
function createPaperStackSideTexture() {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 128;
  canvasEl.height = 64;
  const ctx = canvasEl.getContext('2d');

  ctx.fillStyle = '#f5f0e6';
  ctx.fillRect(0, 0, 128, 64);

  // 중간에 색지 몇 장이 섞인 느낌 — 옆면 일부 구간을 다른 색 얇은 띠로 칠함
    const COLORED_PAGE_COLORS = ['#e8d9a8', '#c3d9c9', '#a9c4d4'];
  const coloredPageCount = 1 + Math.floor(Math.random() * 2); // 1~2장
  for (let i = 0; i < coloredPageCount; i++) {
    const bandY = 8 + Math.random() * 48;
    const bandH = 2 + Math.random() * 2;
    ctx.fillStyle = COLORED_PAGE_COLORS[Math.floor(Math.random() * COLORED_PAGE_COLORS.length)];
    ctx.fillRect(0, bandY, 128, bandH);
  }

  // 종이 다발 옆면 — 완전히 곧은 직선 대신, 살짝 삐뚤빼뚤한 선으로 낱장 표현
  ctx.strokeStyle = '#d8d0bd';
  ctx.lineWidth = 1;
  for (let y = 4; y < 64; y += 3 + Math.random() * 2) {
    ctx.beginPath();
    ctx.moveTo(0, y + (Math.random() - 0.5) * 2);
    const segments = 4;
    for (let s = 1; s <= segments; s++) {
      const x = (128 / segments) * s;
      const wobble = (Math.random() - 0.5) * 2.5;
      ctx.lineTo(x, y + wobble);
    }
    ctx.stroke();
  }

  // 인덱스탭은 2~3개만, 크고 굵게 — 개수를 줄이고 크기를 키워야 흐릿하게 뭉개지지 않고 또렷하게 보임
  const tabCount = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < tabCount; i++) {
    const color = PAPER_TAB_COLORS[Math.floor(Math.random() * PAPER_TAB_COLORS.length)];
    const w = 26 + Math.random() * 14;
    const h = 16 + Math.random() * 6;
    const x = 6 + Math.random() * (128 - w - 12);
    const y = 6 + Math.random() * (64 - h - 12);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
  }

  const tex = new THREE.CanvasTexture(canvasEl);
  tex.magFilter = THREE.NearestFilter; // 확대할 때 흐려지지 않고 각지게(선명하게) 보이도록
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

window.createPaperStackSideTexture = createPaperStackSideTexture; // 콘솔 디버그용
const PAPER_STACK_ROW_MAX = 6; // 한 줄에 최대 몇 개까지 쌓일지
window.PAPER_STACK_SIZE = { width: 0.045, height: 0.02, depth: 0.06 }; // 뭉텅이 하나 크기 — 실행하면서 조정
window.PAPER_STACK_ORIGIN = { x: -0.13, y: 0.2, z: 0.06 }; // 책상 구석 시작 위치 — 확정된 값
window.PAPER_STACK_GAP_X = 0.05;  // 같은 줄 안에서 뭉텅이 사이 간격
window.PAPER_STACK_GAP_Z = 0.07;  // 줄과 줄 사이 간격

let paperStackGroup = null; // 서류 뭉텅이들을 담는 그룹 (책상과 별개로 worldGroup에 직접 추가)
window.paperStackGroup = () => paperStackGroup; // 콘솔 디버그용
let paperStackMeshes = []; // 지금 화면에 떠 있는 서류 뭉텅이 메시들
window.paperStackMeshes = () => paperStackMeshes; // 콘솔 디버그용
let paperStackTotalCount = 0; // 이번 작업 사이클에 몇 개로 시작했는지
let paperStackRemaining = 0;  // 지금 몇 개 남았는지
let paperStackElapsedForDrop = 0; // 다음 하나가 사라질 때까지 흐른 작업 시간(초)
const PAPER_STACK_DROP_INTERVAL_SEC = 10 * 60; // 10분마다 하나씩 사라짐

// 서류 뭉텅이 그룹을 worldGroup 안에 생성 — scene에 직접 붙이면 카메라 프레이밍(frameGroup)
// 계산에서 빠지고 인규/책상과 같은 좌표계를 못 써서 위치가 어긋남. 반드시 worldGroup에 넣어야 함.
function initPaperStackGroup() {
  paperStackGroup = new THREE.Group();
  worldGroup.add(paperStackGroup);
}

// 서류 뭉텅이 메시 하나 생성 (박스 5면은 종이색, 긴 옆면 하나만 인덱스탭 텍스처)
function createPaperStackMesh() {
  const size = window.PAPER_STACK_SIZE;
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.9 });
  const sideTexture = createPaperStackSideTexture();
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTexture, roughness: 0.9 });

  // Box 면 순서: +x, -x, +y, -y, +z, -z — 인덱스탭은 +z(카메라를 향하는 긴 옆면)에만
    // 어느 각도에서 카메라가 보든 인덱스탭이 보이도록, 옆면 4개(+x,-x,+z,-z) 전부에 텍스처 적용
  const materials = [sideMat, sideMat, paperMat, paperMat, sideMat, sideMat];

  // A4 비율(width:depth)은 항상 유지하고, 뭉텅이 전체 크기와 두께(height)만 뭉텅이마다 살짝 다르게.
  // width/depth에 같은 배율을 곱해야 비율이 안 틀어짐 — 따로 곱하면 정사각형처럼 보이는 원인이 됨.
  const sizeJitter = 0.85 + Math.random() * 0.3;   // 종이 크기 전체가 0.85~1.15배
  const heightJitter = 0.7 + Math.random() * 0.8;  // 쌓인 두께는 더 크게 들쭉날쭉(0.7~1.5배)
  const geometry = new THREE.BoxGeometry(
    size.width * sizeJitter,
    size.height * heightJitter,
    size.depth * sizeJitter
  );
  const mesh = new THREE.Mesh(geometry, materials);

  // 살짝 삐딱하게 쌓인 느낌 — y축 회전을 더 크게 줘서 뭉텅이마다 방향이 다르게 흐트러지게
  mesh.rotation.y = (Math.random() - 0.5) * 0.5;
  mesh.rotation.x = 0;
  mesh.rotation.z = 0;

  return mesh;
}

// 서류 뭉텅이들을 "무더기 자리" 단위로 재배치.
// 한 줄에 PAPER_STACK_ROW_MAX개의 자리가 있고, 뭉텅이가 늘어나면 순서대로
// 각 자리에 하나씩 배정하되, 같은 자리가 다 차면(모든 자리에 1개씩 배정된 뒤)
// 처음 자리부터 다시 돌아가서 그 위에 쌓음 — 그래서 옆으로 늘어서는 게 아니라
// 몇 개의 무더기가 위로 쌓이는 형태가 됨.
// PAPER_STACK_ROW_MAX가 이제 "한 무더기에 몇 층까지 쌓을지"의 기준이 됨.
// 첫 무더기 자리(pileIndex=0)에 계속 위로 쌓다가, PAPER_STACK_ROW_MAX층을 넘으면
// 다음 무더기 자리(pileIndex=1)로 넘어가서 다시 아래서부터 쌓기 시작함.
function layoutPaperStacks() {
  const origin = window.PAPER_STACK_ORIGIN;
  const size = window.PAPER_STACK_SIZE;

  paperStackMeshes.forEach((mesh, i) => {
    const pileIndex = Math.floor(i / PAPER_STACK_ROW_MAX);  // 어느 무더기 자리인지 (0, 1, 2...)
    const stackLayer = i % PAPER_STACK_ROW_MAX;              // 그 자리에서 몇 번째 층인지 (0~5)

    // 이 뭉텅이만의 랜덤 흔들림 — 한 번만 정하고 재사용 (매번 바뀌면 위치가 널뜀)
    if (mesh.userData.jitterX === undefined) {
      mesh.userData.jitterX = (Math.random() - 0.5) * size.width * 0.15;
      mesh.userData.jitterZ = (Math.random() - 0.5) * size.depth * 0.15;
    }

    mesh.position.set(
      origin.x + pileIndex * window.PAPER_STACK_GAP_X + mesh.userData.jitterX,
      origin.y + stackLayer * size.height * 0.85,
      origin.z + mesh.userData.jitterZ
    );
  });
}

window.fillPaperStacks = (workMinutes) => fillPaperStacks(workMinutes); // 콘솔 테스트용

// 이번 작업 사이클 분량만큼 서류 뭉텅이를 새로 채움 (기존 건 다 지우고 새로 생성)
function fillPaperStacks(workMinutes) {
  if (!paperStackGroup) return;
  for (const mesh of paperStackMeshes) {
    paperStackGroup.remove(mesh);
    mesh.geometry.dispose();
  }
  paperStackMeshes = [];

  paperStackTotalCount = Math.max(1, Math.ceil(workMinutes / 10));
  paperStackRemaining = paperStackTotalCount;
  paperStackElapsedForDrop = 0;

  for (let i = 0; i < paperStackTotalCount; i++) {
    const mesh = createPaperStackMesh();
    paperStackGroup.add(mesh);
    paperStackMeshes.push(mesh);
  }
  layoutPaperStacks();
}

// 서류 뭉텅이 하나를 제거 (가장 마지막에 쌓인 것부터 없어지게)
function removeOnePaperStack() {
  if (paperStackMeshes.length === 0) return;
  const mesh = paperStackMeshes.pop();
  paperStackGroup.remove(mesh);
  mesh.geometry.dispose();
  paperStackRemaining = Math.max(0, paperStackRemaining - 1);
  layoutPaperStacks();
}

// ===== 타이핑 파티클 (typing일 때만, 손 근처에서 톡톡) =====
function createTypingParticleTexture() {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 32;
  canvasEl.height = 32;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#8fb8e8';
  ctx.beginPath();
  ctx.arc(16, 16, 8, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(canvasEl);
}

const TYPING_PARTICLE_COUNT = 4;
const typingParticles = [];
window.typingParticles = () => typingParticles; // 콘솔 디버그용
let typingParticleTexture = null;

window.TYPING_PARTICLE_INTERVAL = 0.35; // 파티클 하나가 새로 생기는 간격(초) — 타건 리듬 느낌
window.TYPING_PARTICLE_DURATION = 0.5;  // 파티클 하나가 톡 튀고 사라지기까지(초)
window.TYPING_PARTICLE_RISE = 0.03;     // 튀어오르는 높이
window.TYPING_PARTICLE_SCALE = 0.02;    // 파티클 크기
// 왼손/오른손 위치가 서로 다르니 두 지점 중 랜덤으로 하나 골라서 생성
window.TYPING_PARTICLE_OFFSETS = [
  { x: -0.15, y: 0.01, z: -0.03 },
  { x: -0.15, y: 0.01, z: -0.03 },
];
let typingParticleTimer = 0;

function initTypingParticles() {
  typingParticleTexture = createTypingParticleTexture();
  const material = new THREE.SpriteMaterial({
    map: typingParticleTexture,
    transparent: true,
    opacity: 0,
    depthTest: true, // 노트북 등 다른 오브젝트에 실제로 가려지도록
  });
  for (let i = 0; i < TYPING_PARTICLE_COUNT; i++) {
    const sprite = new THREE.Sprite(material.clone());
    sprite.visible = false;
    sprite.userData.age = -1;
    sprite.userData.offsetIndex = 0;
    worldGroup.add(sprite);
    typingParticles.push(sprite);
  }
}

// ===== 땀방울 (모든 작업 자세에서 가끔, 이마 쪽) =====
function createSweatDropTexture() {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 64;
  canvasEl.height = 64;
  const ctx = canvasEl.getContext('2d');
  // 물방울 모양(위는 뾰족, 아래는 둥근 형태)
  ctx.fillStyle = '#7ec8e3';
  ctx.strokeStyle = '#4a90b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.quadraticCurveTo(48, 34, 48, 42);
  ctx.arc(32, 42, 16, 0, Math.PI, false);
  ctx.quadraticCurveTo(16, 34, 32, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return new THREE.CanvasTexture(canvasEl);
}

const SWEAT_SPRITE_COUNT = 1;
const sweatSprites = [];
window.sweatSprites = () => sweatSprites; // 콘솔 디버그용
let sweatTexture = null;

window.SWEAT_INTERVAL_MIN = 20;  // 다음 땀방울까지 최소 대기(초)
window.SWEAT_INTERVAL_MAX = 45;  // 다음 땀방울까지 최대 대기(초)
window.SWEAT_DURATION = 1.2;     // 땀방울 하나가 맺혔다 떨어지기까지(초)
window.SWEAT_SCALE = 0.045;      // 땀방울 크기
window.SWEAT_OFFSET = { x: 0.05, y: 0.22, z: 0.02 }; // 머리(이마 쪽) 기준 오프셋
window.SWEAT_FALL_DISTANCE = 0.06; // 흘러내리는 거리
let sweatNextSpawnTime = 0;

function initSweatSprites() {
  sweatTexture = createSweatDropTexture();
  const material = new THREE.SpriteMaterial({
    map: sweatTexture,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  for (let i = 0; i < SWEAT_SPRITE_COUNT; i++) {
    const sprite = new THREE.Sprite(material.clone());
    sprite.visible = false;
    sprite.userData.age = -1;
    worldGroup.add(sprite);
    sweatSprites.push(sprite);
  }
}

// ===== 집중 반짝임 (작업 중 전반적으로, 머리 위 별) =====
function createSparkleTexture() {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 64;
  canvasEl.height = 64;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#ffd966';
  ctx.strokeStyle = '#e8a800';
  ctx.lineWidth = 1.5;
  // 네 방향으로 뻗은 반짝임(십자+대각선 별) 모양
  ctx.translate(32, 32);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(4, 4, 24, 0);
    ctx.quadraticCurveTo(4, -4, 0, 0);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return new THREE.CanvasTexture(canvasEl);
}

const SPARKLE_SPRITE_COUNT = 2;
const sparkleSprites = [];
window.sparkleSprites = () => sparkleSprites; // 콘솔 디버그용
let sparkleTexture = null;

window.SPARKLE_INTERVAL_MIN = 4;   // 다음 반짝임까지 최소 대기(초)
window.SPARKLE_INTERVAL_MAX = 9;   // 다음 반짝임까지 최대 대기(초)
window.SPARKLE_DURATION = 0.9;     // 반짝임 하나 지속 시간(초)
window.SPARKLE_SCALE = 0.05;       // 반짝임 크기
window.SPARKLE_OFFSET = { x: -0.08, y: 0.26, z: -0.02 }; // 머리 위 기준 오프셋
let sparkleNextSpawnTime = 0;

function initSparkleSprites() {
  sparkleTexture = createSparkleTexture();
  const material = new THREE.SpriteMaterial({
    map: sparkleTexture,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  for (let i = 0; i < SPARKLE_SPRITE_COUNT; i++) {
    const sprite = new THREE.Sprite(material.clone());
    sprite.visible = false;
    sprite.userData.age = -1;
    worldGroup.add(sprite);
    sparkleSprites.push(sprite);
  }
}

const THOUGHT_SPRITE_COUNT = 1; // 한 번에 하나만 떠 있게 (여러 개 동시에 뜨면 산만해서)
const thoughtSprites = [];

// 콘솔에서 조절 가능 — window.forcePose('typing') 등으로 테스트하면서 맞추세요.
window.THOUGHT_INTERVAL_MIN = 10;   // 다음 풍선까지 최소 대기(초)
window.THOUGHT_INTERVAL_MAX = 14;   // 다음 풍선까지 최대 대기(초)
window.THOUGHT_DURATION = 2.5;     // 풍선 하나가 떠 있는 시간(초)
window.THOUGHT_SCALE = 0.13;       // 풍선 크기
window.THOUGHT_OFFSET = { x: 0.12, y: 0.3, z: 0 }; // 머리 기준 위치 오프셋 — 실행하면서 조정
let thoughtNextSpawnTime = 0;

function initThoughtSprites() {
  for (let i = 0; i < THOUGHT_SPRITE_COUNT; i++) {
    const material = new THREE.SpriteMaterial({
      map: null,
      transparent: true,
      opacity: 0,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.userData.age = -1;
    worldGroup.add(sprite);
    thoughtSprites.push(sprite);
  }
}

const Z_SPRITE_COUNT = 3; // 동시에 몇 개까지 화면에 떠 있을 수 있는지
const zSprites = [];
let zTexture = null;

// 콘솔에서 조절 가능한 값들 — window.forcePose('sleep') 해두고 실행하면서 맞추세요.
window.Z_SPRITE_INTERVAL = 1.2;   // 새 Z가 생성되는 간격(초)
window.Z_SPRITE_DURATION = 2.2;   // 하나의 Z가 떠오르기 시작해서 사라지기까지 걸리는 시간(초)
window.Z_SPRITE_RISE_HEIGHT = 0.15; // 떠오르는 동안 위로 이동하는 총 거리
window.Z_SPRITE_DRIFT_X = 0.04;   // 떠오르면서 옆으로 살짝 흔들리는 정도
window.Z_SPRITE_SCALE = 0.06;     // 스프라이트 크기
window.Z_SPRITE_OFFSET = { x: 0, y: 0.12, z: 0 }; // 머리 기준 시작 위치 오프셋 — 실행하면서 조정
let zSpawnTimer = 0;

function initZSprites() {
  zTexture = createZTexture();
  const material = new THREE.SpriteMaterial({
    map: zTexture,
    transparent: true,
    opacity: 0,
    depthTest: false, // 이불/캐릭터에 가려지지 않고 항상 보이게
  });
  for (let i = 0; i < Z_SPRITE_COUNT; i++) {
    const sprite = new THREE.Sprite(material.clone());
    sprite.visible = false;
    sprite.userData.age = -1; // -1이면 아직 활성화 안 됨(대기 중)
    worldGroup.add(sprite);
    zSprites.push(sprite);
  }
}

let headBone = null;
let headBoneBaseQuat = null;

// 팔/손 뼈와, "굽히기 전 원본(bind) 회전값"을 따로 저장해둠.
// 이제 자세는 한 번만 굽히고 끝나는 게 아니라 매 프레임 목표 자세로
// 부드럽게 전환되는 방식이라, 항상 이 원본값을 기준으로 다시 계산해야 함
// (안 그러면 회전이 계속 누적되어 폭주함 — head 뼈 커서보기 때와 같은 원리).
let leftArmBone = null, leftHandBone = null, rightArmBone = null, rightHandBone = null;
window.debugBones = () => ({ leftArmBone, leftHandBone, rightArmBone, rightHandBone });
let leftArmBaseQuat = null, leftHandBaseQuat = null, rightArmBaseQuat = null, rightHandBaseQuat = null;
let spineBone = null;
let spineBaseQuat = null;
let spineBasePosition = null;

// 다리/발 뼈. 원래는 앉은 자세로 한 번 굽히고 끝이었지만, 춤출 때는
// 일어서야 하니 "원본(서 있는) 회전값"과 "앉은 자세 회전값"을 둘 다
// 저장해두고, 매 프레임 그 사이를 블렌딩하는 방식으로 바꿈.
let leftLegBone = null, rightLegBone = null, leftFootBone = null, rightFootBone = null;
let leftLegBaseQuat = null, rightLegBaseQuat = null, leftFootBaseQuat = null, rightFootBaseQuat = null;
let leftLegSitQuat = null, rightLegSitQuat = null, leftFootSitQuat = null, rightFootSitQuat = null;

let CAMERA_AZIMUTH_DEG = 60;
let CAMERA_ELEVATION_DEG = 25;
let CAMERA_EXTRA_MARGIN = 1.9;

function frameGroup(margin = CAMERA_EXTRA_MARGIN) {
  // Box3.setFromObject는 visible=false인 오브젝트도 포함시켜버리므로,
  // sleep 전용 모델(character2)이 숨겨진 상태에서도 카메라 프레이밍에
  // 영향을 주지 않도록 보이는 오브젝트만 모아서 박스를 계산함.
  function isEffectivelyVisible(obj) {
    let o = obj;
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return true;
  }

  const box = new THREE.Box3();
  let hasAny = false;
  worldGroup.traverse((obj) => {
    if (!(obj.isMesh || obj.isSkinnedMesh)) return;
    if (!isEffectivelyVisible(obj)) return;
    box.expandByObject(obj);
    hasAny = true;
  });
  if (!hasAny || box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const fovRad = (camera.fov * Math.PI) / 180;
  const fitHeightDistance = (size.y / 2) / Math.tan(fovRad / 2);
  const fitWidthDistance = (size.x / 2) / Math.tan(fovRad / 2) / camera.aspect;
  const distance = margin * Math.max(fitHeightDistance, fitWidthDistance, size.z);

  const az = (CAMERA_AZIMUTH_DEG * Math.PI) / 180;
  const el = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
  camera.position.set(
    center.x + distance * Math.sin(az) * Math.cos(el),
    center.y + distance * Math.sin(el),
    center.z + distance * Math.cos(az) * Math.cos(el)
  );
  camera.lookAt(center);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 10;
  camera.updateProjectionMatrix();
}

loader.load(
  '../assets/furniture.glb',
  (gltf) => {
    furnitureRoot = gltf.scene;
    window.furnitureRoot = furnitureRoot;

    furnitureRoot.traverse((obj) => {
      if (obj.isMesh) {
        console.log('MESH:', obj.name, '| material:', obj.material, '| map(텍스처):', obj.material?.map);
      }
    });

    chairObj = furnitureRoot.getObjectByName('의자');
    if (chairObj) {
      chairObj.position.z += 0.03;
    }

    // sleep일 때 숨길 소품들. 실제 오브젝트 이름은 furniture.glb 로딩 로그(MESH: ...)에서
    // 확인 가능 — 인수인계 문서 기준 노트북은 'PROD-34805001', 마우스는 '마우스', 커피는 '커피'.
    // 혹시 이름이 다르게 로드되면 콘솔 로그를 보고 아래 이름들을 수정하면 됨.
    laptopObj = furnitureRoot.getObjectByName('PROD-34805001') || furnitureRoot.getObjectByName('키보드');
    mouseObj = furnitureRoot.getObjectByName('마우스');
    coffeeObj = furnitureRoot.getObjectByName('커피');

    worldGroup.add(furnitureRoot);
    frameGroup();
    markAssetLoaded();
  },
  undefined,
  (error) => {
    console.error('furniture.glb 로딩 실패:', error);
    markAssetLoaded();
  }
);

// 이불+베개 — sleep일 때만 보이게, 평소엔 숨겨둠.
// character.glb와 마찬가지로 원본 GLB 크기가 크기 때문에 CHARACTER_SCALE을 그대로 적용.
loader.load(
  '../assets/bedding+pillow.glb',
  (gltf) => {
    beddingRoot = gltf.scene;
    beddingRoot.visible = false;
    beddingRoot.scale.setScalar(0.5);

    // 베개만 따로 더 키우고 싶어서, bedding/pillow 오브젝트를 각각 찾아서
    // pillow에만 추가 스케일을 얹음. beddingRoot 전체 스케일(0.5) 위에 곱해지는 값이라
    // 1.0이면 이불과 같은 배율, 1.5면 베개만 1.5배 더 커짐.
    const pillowObj = beddingRoot.getObjectByName('pillow');
    window.pillowObj = () => pillowObj; // 콘솔 디버그용
    if (pillowObj) {
      pillowObj.scale.setScalar(0.75);

      window.PILLOW_BASE_POSITION = {
        x: pillowObj.position.x,
        y: pillowObj.position.y,
        z: pillowObj.position.z,
      };
      window.PILLOW_POSITION_OFFSET = { x: 0, y: -0.035, z: 0.01 };
    }

    // 책상 위, 인규 눕는 자리 근처에 오도록 CHARACTER_POSITION을 기준점으로 삼음.
    // 정확한 위치는 SLEEP_POSITION_OFFSET처럼 실행하면서 BEDDING_POSITION_OFFSET으로 조정.
    BEDDING_BASE_POSITION = {
      x: CHARACTER_POSITION.x,
      y: CHARACTER_POSITION.y,
      z: CHARACTER_POSITION.z,
    };
    worldGroup.add(beddingRoot);
    markAssetLoaded();
  },
  undefined,
  (error) => {
    console.error('bedding_pillow.glb 로딩 실패:', error);
    markAssetLoaded();
  }
);

const CHARACTER_SCALE = 0.22;
const CHARACTER_POSITION = { x: -0, y: 0.02, z: -0.15 };

const SIT_THIGH_BEND_DEG = 90;
const SIT_SHIN_COUNTER_DEG = -10;
const CHAIR_SEAT_HEIGHT = 0.13;
const CHARACTER_HIP_NATIVE_Y = 0.185;
const SIT_EXTRA_LIFT = 0.01;
const SIT_Y_ADJUST =
  CHAIR_SEAT_HEIGHT - CHARACTER_HIP_NATIVE_Y * CHARACTER_SCALE + SIT_EXTRA_LIFT;

const CHARACTER_ROTATION_Y_DEG = 0;

// 턱 괴는 자세("chinRest")에 쓰이는 각도값들. 이제 이건 "항상 고정된 자세"가 아니라,
// 여러 자세(POSES) 중 하나로 쓰임 — 쉬는 시간/정지 상태일 때만 이 자세가 됨.
const CHIN_ARM_RAISE_DEG = 60;
const CHIN_ARM_INWARD_DEG = 0;
const CHIN_HAND_TILT_DEG = 70;
const CHIN_ARM_RAISE_DEG_R = 60;
const CHIN_ARM_INWARD_DEG_R = 0;
const CHIN_HAND_TILT_DEG_R = 70;

// character.glb(작업용, 안대 없음)와 character2.glb(sleep 전용, 안대 있음) 둘 다
// 이 함수를 거쳐서 초기화됨. 뼈 이름이 두 모델 다 동일하므로 이렇게 공용화 가능.
// isSleepModel이 true면 안대(Eye mask)는 보이고 에어팟은 숨긴 채로 시작함
// (자느라 이어폰을 빼놓은 걸로 취급 — 실제 보임/숨김은 animate()에서 매 프레임 갱신).
function setupCharacterModel(root, isSleepModel) {
  const box = new THREE.Box3().setFromObject(root);
  const minY = box.min.y;
  // 발끝~머리끝 실제 높이(스케일 적용 후, 월드 단위) — sleep 회전 시 pivot 보정에 사용.
  const scaledHeight = (box.max.y - box.min.y) * CHARACTER_SCALE;

  root.scale.setScalar(CHARACTER_SCALE);
  root.position.x = CHARACTER_POSITION.x;
  root.position.y = -minY * CHARACTER_SCALE + SIT_Y_ADJUST;
  root.position.z = CHARACTER_POSITION.z;
  root.rotation.y = THREE.MathUtils.degToRad(CHARACTER_ROTATION_Y_DEG);

  const bones = {
    leftLeg: root.getObjectByName('left_leg'),
    rightLeg: root.getObjectByName('right_leg'),
    leftFoot: root.getObjectByName('left_foot'),
    rightFoot: root.getObjectByName('right_foot'),
    leftArm: root.getObjectByName('left_arm'),
    leftHand: root.getObjectByName('left_hand'),
    rightArm: root.getObjectByName('right_arm'),
    rightHand: root.getObjectByName('right_hand'),
    spine: root.getObjectByName('Bone'),
  };

  function bendLocalX(bone, deg) {
    if (!bone) return;
    const delta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      THREE.MathUtils.degToRad(deg)
    );
    bone.quaternion.multiply(delta);
  }

  const baseQuats = {
    leftLeg: bones.leftLeg ? bones.leftLeg.quaternion.clone() : null,
    rightLeg: bones.rightLeg ? bones.rightLeg.quaternion.clone() : null,
    leftFoot: bones.leftFoot ? bones.leftFoot.quaternion.clone() : null,
    rightFoot: bones.rightFoot ? bones.rightFoot.quaternion.clone() : null,
  };

  bendLocalX(bones.leftLeg, SIT_THIGH_BEND_DEG);
  bendLocalX(bones.rightLeg, SIT_THIGH_BEND_DEG);
  bendLocalX(bones.leftFoot, SIT_SHIN_COUNTER_DEG);
  bendLocalX(bones.rightFoot, SIT_SHIN_COUNTER_DEG);

  const sitQuats = {
    leftLeg: bones.leftLeg ? bones.leftLeg.quaternion.clone() : null,
    rightLeg: bones.rightLeg ? bones.rightLeg.quaternion.clone() : null,
    leftFoot: bones.leftFoot ? bones.leftFoot.quaternion.clone() : null,
    rightFoot: bones.rightFoot ? bones.rightFoot.quaternion.clone() : null,
  };

  const armBaseQuats = {
    leftArm: bones.leftArm ? bones.leftArm.quaternion.clone() : null,
    leftHand: bones.leftHand ? bones.leftHand.quaternion.clone() : null,
    rightArm: bones.rightArm ? bones.rightArm.quaternion.clone() : null,
    rightHand: bones.rightHand ? bones.rightHand.quaternion.clone() : null,
    spine: bones.spine ? bones.spine.quaternion.clone() : null,
  };

  root.traverse((obj) => {
    if (obj.isBone) console.log('BONE:', obj.name, '| parent:', obj.parent ? obj.parent.name : null);
  });

  let headBoneRef = null;
  root.traverse((obj) => {
    if (obj.isBone && obj.name === 'head') headBoneRef = obj;
  });

  if (headBoneRef) {
    const AXIS_X_TMP = new THREE.Vector3(1, 0, 0);
    const AXIS_Z_TMP = new THREE.Vector3(0, 0, 1);
    headBoneRef.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(AXIS_X_TMP, THREE.MathUtils.degToRad(10))
    );
    headBoneRef.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(AXIS_Z_TMP, THREE.MathUtils.degToRad(15))
    );
  }
  const headBaseQuat = headBoneRef ? headBoneRef.quaternion.clone() : null;

  // 에어팟(양쪽 모델 다 있음)과, sleep 모델에만 있는 안대(Eye mask) 참조.
  // 안대는 Blender에서 head 뼈의 자식으로 붙여뒀기 때문에 head를 따라 잘 움직임.
  const airpodLeft = root.getObjectByName('airpod pro l_2.001');
  const airpodRight = root.getObjectByName('airpod pro r_1.001');
  const eyeMask = isSleepModel ? root.getObjectByName('Eye mask') : null;

  // sleep 모델은 안대를 쓰고 자는 것이므로 에어팟은 처음부터 숨겨둠.
  // 작업용 모델은 항상 에어팟이 보여야 하므로 건드리지 않음.
  if (isSleepModel) {
    if (airpodLeft) airpodLeft.visible = false;
    if (airpodRight) airpodRight.visible = false;
  }

  return {
    root,
    bones,
    baseQuats,
    sitQuats,
    armBaseQuats,
    headBone: headBoneRef,
    headBaseQuat,
    airpodLeft,
    airpodRight,
    eyeMask,
    scaledHeight,
  };
}

let workCharacterModel = null; // setupCharacterModel() 반환값 (character.glb)
let sleepCharacterModel = null; // setupCharacterModel() 반환값 (character2.glb)

// 지금 화면에 실제로 붙어있는 모델의 뼈 참조들 — animate()는 항상 이 전역 변수들만 봄.
// applyActiveCharacterModel()이 workCharacterModel/sleepCharacterModel 중 하나를
// 골라서 이 변수들을 채워넣음.
function applyActiveCharacterModel(model) {
  characterRoot = model.root;
  leftLegBone = model.bones.leftLeg;
  rightLegBone = model.bones.rightLeg;
  leftFootBone = model.bones.leftFoot;
  rightFootBone = model.bones.rightFoot;
  leftArmBone = model.bones.leftArm;
  leftHandBone = model.bones.leftHand;
  rightArmBone = model.bones.rightArm;
  rightHandBone = model.bones.rightHand;
  spineBone = model.bones.spine;

  leftLegBaseQuat = model.baseQuats.leftLeg;
  rightLegBaseQuat = model.baseQuats.rightLeg;
  leftFootBaseQuat = model.baseQuats.leftFoot;
  rightFootBaseQuat = model.baseQuats.rightFoot;

  leftLegSitQuat = model.sitQuats.leftLeg;
  rightLegSitQuat = model.sitQuats.rightLeg;
  leftFootSitQuat = model.sitQuats.leftFoot;
  rightFootSitQuat = model.sitQuats.rightFoot;

  leftArmBaseQuat = model.armBaseQuats.leftArm;
  leftHandBaseQuat = model.armBaseQuats.leftHand;
  rightArmBaseQuat = model.armBaseQuats.rightArm;
  rightHandBaseQuat = model.armBaseQuats.rightHand;
  spineBaseQuat = model.armBaseQuats.spine;

  headBone = model.headBone;
  headBoneBaseQuat = model.headBaseQuat;

  characterBaseX = characterRoot.position.x;
  characterBaseY = characterRoot.position.y;
  characterBaseRotationX = characterRoot.rotation.x;
  characterBaseZ = characterRoot.position.z;
  characterScaledHeight = model.scaledHeight || 0;
}

loader.load(
  '../assets/character.glb?v=' + Date.now(),
  (gltf) => {
    workCharacterModel = setupCharacterModel(gltf.scene, false);
    applyActiveCharacterModel(workCharacterModel);
    worldGroup.add(workCharacterModel.root);
    frameGroup();
    markAssetLoaded();

    // sleep용 모델(character2.glb)은 화면엔 미리 안 보이게 로딩만 해둠 —
    // sleep으로 전환되는 순간 바로 스왑할 수 있게 준비.
    loader.load(
      '../assets/character2.glb?v=' + Date.now(),
      (gltf2) => {
        sleepCharacterModel = setupCharacterModel(gltf2.scene, true);
        sleepCharacterModel.root.visible = false;
        worldGroup.add(sleepCharacterModel.root);
        markAssetLoaded();
      },
      undefined,
      (error) => {
        console.error('character2.glb 로딩 실패:', error);
        markAssetLoaded();
      }
    );
  },
  undefined,
  (error) => {
    console.error('character.glb 로딩 실패:', error);
    markAssetLoaded();
  }
);
// ============================

// ===== 마우스 커서 쳐다보기 기능은 제거됨 =====
// (uiohook-napi가 macOS 보안 시스템에 "악성코드 행동 패턴(입력 후킹)"으로 오탐되어
// 배포된 앱이 자동 삭제되는 문제가 있어 기능 자체를 뺐음. 이제 인규는 항상 정면을 봄 —
// 작업 중 자세(POSES)에서 고개를 돌리는 동작은 그대로 남아있음.)
let targetYawDeg = 0;
let targetPitchDeg = 0;

const LOOK_MAX_YAW_DEG = 40;
const LOOK_MAX_PITCH_DEG = 24;
const LOOK_SMOOTH = 6;
const ROLL_SMOOTH = 2;

let currentYawDeg = 0;
let currentPitchDeg = 0;
let currentRollDeg = 0;

// 고개 갸우뚱(roll)을 매끄러운 파도 대신, "한 번 움직이고 잠시 멈췄다가
// 다시 랜덤 방향으로" 움직이게 만드는 상태값들. (mouseTouch 전용)
let headRollTargetDeg = 0;
let headRollNextChangeTime = 0;
const HEAD_ROLL_MIN_WAIT = 1.5;     // 다음 변화까지 최소 대기(초)
const HEAD_ROLL_MAX_WAIT = 4.5;     // 다음 변화까지 최대 대기(초)

function maybeUpdateHeadRollTarget(currentTime, maxDeg) {
  if (currentTime < headRollNextChangeTime) return;
  headRollTargetDeg = (Math.random() * 2 - 1) * maxDeg; // -최대~+최대 사이 랜덤
  headRollNextChangeTime =
    currentTime + HEAD_ROLL_MIN_WAIT + Math.random() * (HEAD_ROLL_MAX_WAIT - HEAD_ROLL_MIN_WAIT);
}

// animate()보다 먼저 선언되어야 해서 이 위치로 옮김 (원래 파일 하단에 있었음).
let currentTimerMode = 'work';
let timerIsRunning = false;
let wasWorkRunning = false; // 작업 사이클이 새로 "시작"되는 순간(false→true)을 감지하려고 이전 상태 기억

// 모니터 쪽을 보는 각도 — 실행해보면서 조정 필요 (인규 머리 기본 방향이
// 원래 턱 괴는 사진용으로 살짝 옆으로 기울어져 있어서, 그걸 상쇄하는 값)
// animate()보다 먼저 선언되어야 해서 이 위치로 옮김 (원래 파일 하단에 있었음).
let MONITOR_LOOK_YAW_DEG = 0;
let MONITOR_LOOK_PITCH_DEG = -25;
let MOUSE_LOOK_YAW_DEG = 0;
let MOUSE_LOOK_PITCH_DEG = -10;

window.setMonitorLook = (yaw, pitch) => {
  MONITOR_LOOK_YAW_DEG = yaw;
  MONITOR_LOOK_PITCH_DEG = pitch;
  console.log('MONITOR_LOOK_YAW_DEG:', yaw, '| MONITOR_LOOK_PITCH_DEG:', pitch);
};

// ===== 작업 중 랜덤 동작 (타이핑 / 마우스 만지기 / 몸 기울이기 / 턱 괴기 / 춤) =====
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

// 자세 전환 속도 (클수록 목표 자세로 더 빨리 다가감). 자세가 너무 뚝뚝 끊기면 낮추고,
// 너무 굼뜨면 높이세요.
const POSE_SMOOTH = 5;

// lean(기울기)은 0~1 범위. 1.0일 때 실제로 몸을 얼마나 앞으로 기울일지는
// 아래 LEAN_MAX_DEG / LEAN_MAX_Z 두 값으로 조절.
const LEAN_MAX_DEG = 15;   // lean=1.0일 때 앞으로 숙이는 각도
const LEAN_MAX_Z = 0.025;  // lean=1.0일 때 앞으로 이동하는 거리
const REACH_MAX_Z = -0.02; // reach=1.0일 때 인규가 앞으로 이동하는 거리
const REACH_MAX_Y = 0.01; // reach=1.0일 때 인규가 위로 이동하는 거리
let currentLeanAmount = 0;
let currentReachAmount = 0;

// sleep(책상 위에서 자는) 자세로 얼마나 전환됐는지 (0=평소 앉은 위치, 1=완전히 책상 위에 누움)
let currentSleepAmount = 0;
const SLEEP_SMOOTH = 4; // 자세 전환 속도 (POSE_SMOOTH와 별도로 조절하고 싶어서 분리해둠)

// sleep 자세 위치/회전 조절값 — 책상 높이·위치를 코드가 정확히 모르기 때문에
// 실행 → 눈으로 확인 → 숫자 조정을 몇 번 거쳐야 합니다. window.forcePose('sleep')로
// 콘솔에서 강제 고정해두고 이 숫자들을 하나씩 바꿔가며 맞추세요.
let SLEEP_POSITION_OFFSET = { x: 0.07, y: 0, z: 0.04 };
window.SLEEP_POSITION_OFFSET = SLEEP_POSITION_OFFSET; // 콘솔에서 실시간으로 값 바꿔보려고 노출
const SLEEP_ROTATE_DEG = -90; // 하늘 보고 눕기(x축) — 이미 맞춰짐, 건드릴 필요 없음
window.SLEEP_YAW_DEG = 90; // 몸이 도는 방향(y축) — 책상 긴 변에 맞추려고 새로 추가, 콘솔에서 값 조정

// sleep일 때 고개 각도 — 기본 고정값 + 가끔 좌우로 뒤척이는 느낌
window.SLEEP_HEAD_YAW_DEG = 0;    // 기본 좌우 각도
window.SLEEP_HEAD_PITCH_DEG = 5;  // 기본 위아래 각도
window.SLEEP_HEAD_TURN_RANGE_DEG = 20; // 뒤척일 때 좌우로 최대 얼마나 도는지
let sleepHeadTurnTargetDeg = 0;
let sleepHeadTurnNextChangeTime = 0;
const SLEEP_HEAD_TURN_MIN_WAIT = 8;   // 다음 뒤척임까지 최소 대기(초) — "아주 가끔"이라 길게
const SLEEP_HEAD_TURN_MAX_WAIT = 20;  // 다음 뒤척임까지 최대 대기(초)

function maybeUpdateSleepHeadTurn(currentTime) {
  if (currentTime < sleepHeadTurnNextChangeTime) return;
  sleepHeadTurnTargetDeg = (Math.random() * 2 - 1) * window.SLEEP_HEAD_TURN_RANGE_DEG;
  sleepHeadTurnNextChangeTime =
    currentTime + SLEEP_HEAD_TURN_MIN_WAIT + Math.random() * (SLEEP_HEAD_TURN_MAX_WAIT - SLEEP_HEAD_TURN_MIN_WAIT);
}

// 이불+베개 위치 — characterRoot처럼 base+offset 방식이 아니라, bedding_pillow.glb를
// 로딩한 원본 위치에 이 오프셋을 더하는 방식. 실행하면서 SLEEP_POSITION_OFFSET처럼 조정.
let BEDDING_POSITION_OFFSET = { x: 0.08, y: 0.18, z: 0.145 };
window.BEDDING_POSITION_OFFSET = BEDDING_POSITION_OFFSET; // 콘솔에서 실시간 조정용
let BEDDING_BASE_POSITION = { x: 0, y: 0, z: 0 }; // 로딩 직후 원본 위치를 기억해둠

// 각 자세별로, 팔/손 뼈를 "원본(bind) 자세" 기준 얼마나 더 돌릴지 정의.
// 실행해보면서 숫자들을 하나씩 조정하시면 됩니다 (턱 괴는 자세 만들 때와 같은 방식).
const POSES = {
  chinRest: {
    leftArm: [{ axis: AXIS_X, deg: CHIN_ARM_RAISE_DEG }, { axis: AXIS_Z, deg: -CHIN_ARM_INWARD_DEG }],
    leftHand: [{ axis: AXIS_X, deg: CHIN_HAND_TILT_DEG }],
    rightArm: [{ axis: AXIS_X, deg: CHIN_ARM_RAISE_DEG_R }, { axis: AXIS_Z, deg: CHIN_ARM_INWARD_DEG_R }],
    rightHand: [{ axis: AXIS_X, deg: CHIN_HAND_TILT_DEG_R }],
    lean: 0,
  },
  typing: {
    leftArm: [{ axis: AXIS_X, deg: 78 }, { axis: AXIS_Z, deg: -10 }],
    leftHand: [{ axis: AXIS_X, deg: 15 }],
    rightArm: [{ axis: AXIS_X, deg: 78 }, { axis: AXIS_Z, deg: 10 }],
    rightHand: [{ axis: AXIS_X, deg: 15 }],
    lean: -1.5,
    reach: 1.0,
  },
  mouseTouch: {
    leftArm: [{ axis: AXIS_X, deg: 78 }, { axis: AXIS_Z, deg: 10 }],
    leftHand: [{ axis: AXIS_X, deg: 15 }],
    rightArm: [{ axis: AXIS_X, deg: 95 }, { axis: AXIS_Z, deg: 0 }],
    rightHand: [{ axis: AXIS_X, deg: 5 }],
    lean: -0.1,
  },
  leanForward: {
    leftArm: [{ axis: AXIS_X, deg: 100 }, { axis: AXIS_Z, deg: 0 }],
    leftHand: [{ axis: AXIS_X, deg: 60 }, { axis: AXIS_Z, deg: 60 }],
    rightArm: [{ axis: AXIS_X, deg: 100 }, { axis: AXIS_Z, deg: 0 }],
    rightHand: [{ axis: AXIS_X, deg: 60 }, { axis: AXIS_Z, deg: -60 }],
    lean: -1,
  },
  // 책상 위에 누워 자는 자세. 팔/손에 아무 델타값도 안 줘서 원본(bind pose, T자)
  // 그대로 유지 — 몸 전체를 눕히는 회전/이동만 적용하고 팔 자세는 건드리지 않음.
  // 책상 위에 누워 자는 자세. 양팔을 머리 쪽으로 모아서 베개처럼 만듦.
  // 왼팔/오른팔은 서로 반대 부호를 줘야 화면에서 대칭(양쪽 다 안쪽/위쪽)으로 보임
  // — 거울 대칭 규칙 참고 (같은 부호면 반대 방향=교차로 움직여버림).
  // 일단은 T포즈(bind pose) 그대로 둠 — 팔 각도는 나중에 하나씩 값 넣어가면서 맞출 예정.
  // (여기 배열에 {axis, deg} 항목을 추가하면 그만큼 원본 자세에서 회전이 더해짐)
  // 책상 위에 누워 자는 자세. 양팔을 머리 쪽으로 모아서 베개처럼 만듦.
  // 왼팔/오른팔은 서로 반대 부호를 줘야 화면에서 대칭(양쪽 다 안쪽/위쪽)으로 보임
  // — 거울 대칭 규칙 참고 (같은 부호면 반대 방향=교차로 움직여버림).
  sleep: {
    leftArm: [{ axis: AXIS_X, deg: 70 }, { axis: AXIS_Z, deg: -30 }],
    leftHand: [{ axis: AXIS_X, deg: 40 }],
    rightArm: [{ axis: AXIS_X, deg: 70 }, { axis: AXIS_Z, deg: 30 }],
    rightHand: [{ axis: AXIS_X, deg: 40 }],
    lean: 0,
  },
};

// 랜덤 뽑기 목록. 같은 이름을 여러 번 넣으면 그만큼 더 자주 뽑힘
// (예: typing이 3번 들어있으면 다른 것보다 3배 자주 나옴) — 지금은 타이핑 위주로 구성.
// 'sleep'은 이 목록에 넣지 않음 — 작업 중 랜덤 동작이 아니라 휴식 시간 전용으로 따로 트리거할 예정.
const WORK_ACTION_POOL = ['typing', 'typing', 'typing', 'mouseTouch', 'leanForward', 'typing'];

let currentPoseName = 'chinRest';
let workActionsActive = false;
let actionSchedulerRunning = false;

// 콘솔에서 테스트용으로 자세를 강제로 고정시킬 수 있게 노출
window.forcePose = (name) => {
  poseForcedByConsole = true;
  workActionsActive = true; // 고개 각도도 작업 모드로 정상 계산되게
  currentPoseName = name;
  console.log('자세 고정됨:', name);
};
window.debugPoseState = () => {
  console.log({ currentPoseName, workActionsActive, poseForcedByConsole });
};

window.resumeWorkActions = () => {
  poseForcedByConsole = false;
  setWorkActionsActive(true);
  console.log('랜덤 동작 재개됨');
};

function scheduleNextWorkAction() {
  if (!workActionsActive || poseForcedByConsole || currentPoseName === 'sleep') {
    actionSchedulerRunning = false;
    return;
  }
  const name = WORK_ACTION_POOL[Math.floor(Math.random() * WORK_ACTION_POOL.length)];
  currentPoseName = name;

  // leanForward(모니터 가까이 보기)만 짧게, 나머지는 기존대로 10~20초
  const holdSeconds =
    name === 'leanForward'
      ? 1.5 + Math.random() * 2.5 // 1.5~4초
      : 10 + Math.random() * 10;  // 10~20초

  setTimeout(scheduleNextWorkAction, holdSeconds * 1000);
}

let poseForcedByConsole = false;

function setWorkActionsActive(active) {
  if (poseForcedByConsole) return; // 콘솔에서 강제로 고정해둔 동안은 타이머 상태 변화 무시
  if (workActionsActive === active) return;
  workActionsActive = active;

  if (active) {
    currentPoseName = 'typing'; // 작업 시작하자마자 바로 타이핑부터
    if (!actionSchedulerRunning) {
      actionSchedulerRunning = true;
      scheduleNextWorkAction();
    }
  } else {
    currentPoseName = 'chinRest'; // 휴식/정지 상태면 턱 괴는 자세로 복귀
  }
}

function computeTargetQuat(baseQuat, deltas) {
  const target = baseQuat.clone();
  for (const { axis, deg } of deltas) {
    target.multiply(new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg)));
  }
  return target;
}

const clock = new THREE.Clock();
let lastFrameTime = 0;
let wasSleepingLastFrame = false; // sleep 전환 첫 프레임에만 모델을 스왑하려고 이전 상태 기억

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    initZSprites();
    initThoughtSprites();
    initTypingParticles();
    initSweatSprites();
    initSparkleSprites();
    initPaperStackGroup();
  });
} else {
  initZSprites();
  initThoughtSprites();
  initTypingParticles();
  initSweatSprites();
  initSparkleSprites();
  initPaperStackGroup();
}

function animate() {
  requestAnimationFrame(animate);

  const t = clock.getElapsedTime();
  const dt = Math.min(0.1, t - lastFrameTime);
  lastFrameTime = t;

  const isSleeping = currentPoseName === 'sleep';

  // 작업이 실제로 돌아가는 중일 때만 서류 뭉텅이 감소 타이머를 누적
  if (currentTimerMode === 'work' && timerIsRunning && paperStackRemaining > 0) {
    paperStackElapsedForDrop += dt;
    if (paperStackElapsedForDrop >= PAPER_STACK_DROP_INTERVAL_SEC) {
      paperStackElapsedForDrop = 0;
      removeOnePaperStack();
    }
  }

  // ===== sleep 진입/해제 순간에 캐릭터 모델을 통째로 스왑 (턱 전환, 페이드 없음) =====
  // currentPoseName이 바뀐 첫 프레임에만 실행되게 이전 상태와 비교.
  if (isSleeping !== wasSleepingLastFrame && workCharacterModel && sleepCharacterModel) {
    if (isSleeping) {
      workCharacterModel.root.visible = false;
      sleepCharacterModel.root.visible = true;
      applyActiveCharacterModel(sleepCharacterModel);
    } else {
      sleepCharacterModel.root.visible = false;
      workCharacterModel.root.visible = true;
      applyActiveCharacterModel(workCharacterModel);
    }
  }
  wasSleepingLastFrame = isSleeping;

    // 잘 때는 노트북/마우스/커피만 숨김 (책상, 의자는 그대로 둠), 이불은 그때만 보이게
  if (laptopObj) laptopObj.visible = !isSleeping;
  if (mouseObj) mouseObj.visible = !isSleeping;
  if (coffeeObj) coffeeObj.visible = !isSleeping;
      if (beddingRoot) {
    beddingRoot.visible = isSleeping;
    if (isSleeping) {
      beddingRoot.position.set(
        BEDDING_BASE_POSITION.x + window.BEDDING_POSITION_OFFSET.x,
        BEDDING_BASE_POSITION.y + window.BEDDING_POSITION_OFFSET.y,
        BEDDING_BASE_POSITION.z + window.BEDDING_POSITION_OFFSET.z
      );
      // 인규와 같은 방향(책상 긴 변)으로 돌아가게, 같은 Y축 회전값을 그대로 적용
            // 인규와 같은 방향(책상 긴 변)으로 돌아가게, 같은 Y축 회전값을 그대로 적용
      beddingRoot.rotation.y = THREE.MathUtils.degToRad(window.SLEEP_YAW_DEG);

      // 베개만 따로 위치 미세조정 (pillow는 beddingRoot의 자식이라 로컬 좌표 기준)
      if (window.pillowObj && window.pillowObj() && window.PILLOW_BASE_POSITION) {
        const p = window.pillowObj();
        p.position.set(
          window.PILLOW_BASE_POSITION.x + window.PILLOW_POSITION_OFFSET.x,
          window.PILLOW_BASE_POSITION.y + window.PILLOW_POSITION_OFFSET.y,
          window.PILLOW_BASE_POSITION.z + window.PILLOW_POSITION_OFFSET.z
        );
      }
    }
  }

  // sleep 모델의 안대(Eye mask)/에어팟도 sleep 여부에 맞춰 매 프레임 갱신
  // (모델을 처음 로딩할 때 한 번만 설정해두면, 나중에 sleep을 여러 번 껐다 켤 때
  // 안 맞을 수 있어서 매 프레임 확인하는 쪽이 안전함).
  if (sleepCharacterModel) {
    if (sleepCharacterModel.eyeMask) sleepCharacterModel.eyeMask.visible = isSleeping;
    if (sleepCharacterModel.airpodLeft) sleepCharacterModel.airpodLeft.visible = false; // sleep 모델은 항상 에어팟 숨김
    if (sleepCharacterModel.airpodRight) sleepCharacterModel.airpodRight.visible = false;
  }
  // 작업용 모델은 원래부터 에어팟이 항상 보여야 하므로 건드리지 않음 (기존 동작 유지).

  if (headBone && headBoneBaseQuat) {
    let workYaw = MONITOR_LOOK_YAW_DEG;
    let workPitch = MONITOR_LOOK_PITCH_DEG;
    let headRollDeg = 0; // 갸우뚱 각도 — leanForward/mouseTouch일 때만 값이 들어감

    if (currentPoseName === 'mouseTouch') {
      maybeUpdateHeadRollTarget(t, 9); // 마우스일 때만 더 큰 범위
      headRollDeg = headRollTargetDeg;
      workYaw = MOUSE_LOOK_YAW_DEG;
      workPitch = MOUSE_LOOK_PITCH_DEG;
    }

    if (currentPoseName === 'leanForward') {
      const headWiggleDeg = 4;   // 갸우뚱 흔드는 범위
      const headWiggleSpeed = 1.5; // 흔드는 속도 (느리게)
      headRollDeg = Math.sin(t * headWiggleSpeed) * headWiggleDeg;
      workYaw = 0;
      workPitch = -30; // 고개 든 정도
    }

    if (currentPoseName === 'sleep') {
      maybeUpdateSleepHeadTurn(t);
      workYaw = window.SLEEP_HEAD_YAW_DEG + sleepHeadTurnTargetDeg;
      workPitch = window.SLEEP_HEAD_PITCH_DEG;
    }

    const shouldUseWorkLook = poseForcedByConsole ? workActionsActive : (timerIsRunning && workActionsActive);
    const effectiveTargetYaw = shouldUseWorkLook ? workYaw : targetYawDeg;
    const effectiveTargetPitch = shouldUseWorkLook ? workPitch : targetPitchDeg;

    currentYawDeg = THREE.MathUtils.damp(currentYawDeg, effectiveTargetYaw, LOOK_SMOOTH, dt);
    currentPitchDeg = THREE.MathUtils.damp(currentPitchDeg, effectiveTargetPitch, LOOK_SMOOTH, dt);
    currentRollDeg = THREE.MathUtils.damp(currentRollDeg, headRollDeg, ROLL_SMOOTH, dt);

    const yawQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(currentYawDeg)
    );
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      THREE.MathUtils.degToRad(currentPitchDeg)
    );
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      THREE.MathUtils.degToRad(currentRollDeg)
    );
    headBone.quaternion.copy(headBoneBaseQuat).multiply(yawQuat).multiply(pitchQuat).multiply(rollQuat);
  }

  // ===== sleep 전환량 계산 (0=평소, 1=완전히 책상 위에 누움) =====
  // 다리 블렌딩에서 먼저 써야 해서 이 계산을 다리보다 앞으로 옮김.
  const sleepTarget = isSleeping ? 1 : 0;
  currentSleepAmount = THREE.MathUtils.damp(currentSleepAmount, sleepTarget, SLEEP_SMOOTH, dt);

  // ===== 다리 — 평소엔 앉은 자세(sitQuat), sleep일 땐 원본(쭉 뻗은/bind) 자세로 블렌딩 =====
  // "아무 값도 안 준 기본 자세"가 곧 setupCharacterModel()에서 굽히기 전 원본값(baseQuat)임.
  if (leftLegBone && leftLegSitQuat && leftLegBaseQuat) {
    leftLegBone.quaternion.slerpQuaternions(leftLegSitQuat, leftLegBaseQuat, currentSleepAmount);
  }
  if (rightLegBone && rightLegSitQuat && rightLegBaseQuat) {
    rightLegBone.quaternion.slerpQuaternions(rightLegSitQuat, rightLegBaseQuat, currentSleepAmount);
  }
  if (leftFootBone && leftFootSitQuat && leftFootBaseQuat) {
    leftFootBone.quaternion.slerpQuaternions(leftFootSitQuat, leftFootBaseQuat, currentSleepAmount);
  }
  if (rightFootBone && rightFootSitQuat && rightFootBaseQuat) {
    rightFootBone.quaternion.slerpQuaternions(rightFootSitQuat, rightFootBaseQuat, currentSleepAmount);
  }

  // ===== 몸 전체 위치 — 숨쉬기 + sleep일 때 책상 쪽으로 이동 =====
  if (characterRoot) {
    const breathe = isSleeping ? 0 : Math.sin(t * 1.5) * 0.002;
    characterRoot.position.x = characterBaseX + window.SLEEP_POSITION_OFFSET.x * currentSleepAmount;
    characterRoot.position.y = characterBaseY + window.SLEEP_POSITION_OFFSET.y * currentSleepAmount + breathe;
    // z는 아래쪽 "몸 전체를 정면으로 이동" 블록에서 reach와 함께 최종적으로 계산됨
  }


  // ===== 팔/손/상체 — 현재 자세(POSES[currentPoseName])로 부드럽게 전환 =====
  if (leftArmBone && leftArmBaseQuat && rightArmBone && rightArmBaseQuat) {
    const pose = POSES[currentPoseName] || POSES.chinRest;
    const factor = 1 - Math.exp(-POSE_SMOOTH * dt);

    leftArmBone.quaternion.slerp(computeTargetQuat(leftArmBaseQuat, pose.leftArm), factor);
    rightArmBone.quaternion.slerp(computeTargetQuat(rightArmBaseQuat, pose.rightArm), factor);
    if (leftHandBone && leftHandBaseQuat) {
      leftHandBone.quaternion.slerp(computeTargetQuat(leftHandBaseQuat, pose.leftHand), factor);
    }
    if (rightHandBone && rightHandBaseQuat) {
      rightHandBone.quaternion.slerp(computeTargetQuat(rightHandBaseQuat, pose.rightHand), factor);
    }

    // 타이핑 중일 땐 손이 빠르게 바둥거리는 잔진동을 슬쩍 얹어줌 (위 slerp로 정해진 자세 위에 추가)
    if (currentPoseName === 'typing') {
      const wiggleUpDeg = 5;   // 위로 올라가는 최대치
      const wiggleDownDeg = 0;  // 아래로 내려가는 최대치 (훨씬 작게)
      const wiggleSpeed = 10;

      if (leftHandBone) {
        const raw = Math.sin(t * wiggleSpeed);
        const w = raw > 0 ? raw * wiggleUpDeg : raw * wiggleDownDeg;
        leftHandBone.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(AXIS_Z, THREE.MathUtils.degToRad(w))
        );
      }
      if (rightHandBone) {
        const rawR = Math.sin(t * wiggleSpeed);
        const wR = rawR < 0 ? rawR * wiggleUpDeg : rawR * wiggleDownDeg;
        rightHandBone.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(AXIS_Z, THREE.MathUtils.degToRad(wR))
        );
      }

      const armWiggleUpDeg = 5;
      const armWiggleDownDeg = 2;
      if (leftArmBone) {
        const rawA = Math.sin(t * wiggleSpeed);
        const aw = rawA > 0 ? rawA * armWiggleUpDeg : rawA * armWiggleDownDeg;
        leftArmBone.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(AXIS_Z, THREE.MathUtils.degToRad(aw))
        );
      }
      if (rightArmBone) {
        const rawAR = Math.sin(t * wiggleSpeed);
        const awR = rawAR < 0 ? rawAR * armWiggleUpDeg : rawAR * armWiggleDownDeg;
        rightArmBone.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(AXIS_Z, THREE.MathUtils.degToRad(awR))
        );
      }
    }

    // 마우스 만질 때는 타이핑처럼 빠르진 않게, 오른손만 살살 굴리듯 움직임
    if (currentPoseName === 'mouseTouch') {
      const mouseWiggleDeg = 4;
      if (rightHandBone) {
        const mw =
          Math.sin(t * 2.3) * mouseWiggleDeg * 0.2 +
          Math.sin(t * 4.7 + 1.2) * mouseWiggleDeg * 0.1;
        rightHandBone.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(AXIS_X, THREE.MathUtils.degToRad(mw))
        );
      }
      if (rightArmBone) {
        const maw =
          Math.sin(t * 1.7 + 0.5) * (mouseWiggleDeg * 0.1) +
          Math.sin(t * 3.1 + 2.0) * (mouseWiggleDeg * 0.1);
        rightArmBone.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(AXIS_X, THREE.MathUtils.degToRad(-maw))
        );
      }
    }

    // 상체(척추=Bone) 기울이기 — sleep일 때는 lean 대신 옆으로 눕는 회전을 씀
    if (!isSleeping) {
      const leanTarget = pose.lean;
      currentLeanAmount = THREE.MathUtils.damp(currentLeanAmount, leanTarget, POSE_SMOOTH, dt);

      if (spineBone && spineBaseQuat) {
        const leanQuat = new THREE.Quaternion().setFromAxisAngle(
          AXIS_X,
          -THREE.MathUtils.degToRad(LEAN_MAX_DEG) * currentLeanAmount
        );
        spineBone.quaternion.copy(spineBaseQuat).multiply(leanQuat);
      }
    }

    // 인규 몸 전체를 정면(노트북 쪽)으로 이동 — sleep일 때는 reach 대신 SLEEP_POSITION_OFFSET.z를 씀
    if (!isSleeping) {
      const reachTarget = pose.reach || 0;
      currentReachAmount = THREE.MathUtils.damp(currentReachAmount, reachTarget, POSE_SMOOTH, dt);
      characterRoot.position.z = characterBaseZ + window.SLEEP_POSITION_OFFSET.z * currentSleepAmount;
    } else {
      characterRoot.position.z = characterBaseZ + window.SLEEP_POSITION_OFFSET.z * currentSleepAmount;
    }
  }

  // ===== 몸 전체 회전 — sleep일 때 옆으로 눕는 회전 적용 =====
  // 팔/손 계산과 별개로 characterRoot 전체를 회전시켜야 해서 이 블록은
  // leftArmBone 존재 여부와 무관하게 항상 실행되게 바깥에 둠.
  // x축으로 돌리면 "앞으로 고꾸라지는" 회전이 되어 거꾸로 뒤집혀버림 — 대신
  // z축(화면 평면상 좌우로 굴러 눕는 축)을 사용. 방향이 반대로 보이면
  // SLEEP_ROTATE_DEG 값을 음수로 바꿔보세요.
  //
  // 회전축(pivot) 보정: characterRoot의 원점은 발밑에 있어서, 그냥 rotation.z만
  // 돌리면 발을 축으로 몸통이 크게 휘둘려서 책상 밖으로 튕겨나가 보임. 몸 중심
  // (대략 키의 절반 높이)이 제자리에서 눕는 것처럼 보이도록, 회전으로 인해
  // 몸 중심이 이동한 만큼을 반대로 위치에 더해서 상쇄함.
        if (characterRoot) {
    characterRoot.rotation.order = 'YXZ'; // Y축을 먼저 적용해야 X축(눕기)과 안 얽힘
    const rotX = THREE.MathUtils.degToRad(SLEEP_ROTATE_DEG) * currentSleepAmount;
    characterRoot.rotation.y = THREE.MathUtils.degToRad(CHARACTER_ROTATION_Y_DEG + window.SLEEP_YAW_DEG * currentSleepAmount);
    characterRoot.rotation.x = characterBaseRotationX + rotX;

    const halfHeight = characterScaledHeight * 0.5;
    const pivotOffsetZ = Math.sin(rotX) * halfHeight;
    const pivotOffsetY = (Math.cos(rotX) - 1) * halfHeight;

            characterRoot.position.z -= pivotOffsetZ;
    characterRoot.position.y -= pivotOffsetY;

    // sleepAmount가 1에 가까운데(완전히 누운 상태) 위치가 정상 범위(SLEEP_POSITION_OFFSET
    // 근방, 대략 -1~1 사이)를 벗어나면 뭔가 잘못된 것 — 그 순간을 놓치지 않고 항상 찍음.
    if (isSleeping && currentSleepAmount > 0.9) {
      const p = characterRoot.position;
      const abnormal = Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1;
      if (abnormal) {
        console.warn(
          '⚠️ 비정상 위치 감지!',
          'pos:', p.x.toFixed(3), p.y.toFixed(3), p.z.toFixed(3),
          '| rot:', characterRoot.rotation.x.toFixed(3), characterRoot.rotation.y.toFixed(3), characterRoot.rotation.z.toFixed(3),
          '| sleepAmount:', currentSleepAmount.toFixed(3),
          '| currentPoseName:', currentPoseName,
          '| workActionsActive:', workActionsActive,
          '| poseForcedByConsole:', poseForcedByConsole,
          '| actionSchedulerRunning:', actionSchedulerRunning
        );
      }
    }

    if (isSleeping && Math.random() < 0.01) { // 정상 상태도 가끔 찍어서 흐름 확인
      console.log(
        'sleep pos:', characterRoot.position.x.toFixed(3), characterRoot.position.y.toFixed(3), characterRoot.position.z.toFixed(3),
        '| sleepAmount:', currentSleepAmount.toFixed(3),
        '| currentPoseName:', currentPoseName
      );
    }
  }

  // ===== sleep 중 머리 위에 Z 떠오르기 =====
  if (isSleeping && characterRoot) {
    zSpawnTimer += dt;
    if (zSpawnTimer >= window.Z_SPRITE_INTERVAL) {
      zSpawnTimer = 0;
      // 대기 중인(age === -1) 스프라이트 하나를 찾아서 활성화
      const idle = zSprites.find((s) => s.userData.age === -1);
      if (idle) {
        idle.userData.age = 0;
        idle.visible = true;
      }
    }

    for (const sprite of zSprites) {
      if (sprite.userData.age === -1) continue;

      sprite.userData.age += dt;
      const progress = sprite.userData.age / window.Z_SPRITE_DURATION; // 0~1

      if (progress >= 1) {
        sprite.userData.age = -1;
        sprite.visible = false;
        continue;
      }

      const baseX = characterRoot.position.x + window.Z_SPRITE_OFFSET.x;
      const baseY = characterRoot.position.y + window.Z_SPRITE_OFFSET.y;
      const baseZ = characterRoot.position.z + window.Z_SPRITE_OFFSET.z;

      sprite.position.set(
        baseX + Math.sin(progress * Math.PI) * window.Z_SPRITE_DRIFT_X,
        baseY + progress * window.Z_SPRITE_RISE_HEIGHT,
        baseZ
      );
      sprite.scale.setScalar(window.Z_SPRITE_SCALE);

      // 초반엔 빠르게 나타났다가, 후반엔 서서히 사라지는 느낌
      const fadeIn = Math.min(1, progress / 0.15);
      const fadeOut = Math.min(1, (1 - progress) / 0.4);
      sprite.material.opacity = Math.min(fadeIn, fadeOut);
    }
    } else {
    // sleep이 아니면 전부 숨기고 리셋
    for (const sprite of zSprites) {
      if (sprite.userData.age !== -1) {
        sprite.userData.age = -1;
        sprite.visible = false;
      }
    }
    zSpawnTimer = 0;
  }

    // ===== 생각풍선(랜덤 이모지 또는 타이머 텍스트) =====
  // 평소엔 작업 동작(typing/mouseTouch/leanForward)일 때만 이모지 풍선이 나옴.
  // sleep일 때는, 우클릭 설정(타이머 텍스트 표시)이 켜져 있는 경우에만 풍선이 뜨고
  // 이모지 대신 휴식시간 텍스트만 보여줌(Z 표시와는 별개로 같이 뜸).
  const isWorkingAction =
    currentPoseName === 'typing' || currentPoseName === 'mouseTouch' || currentPoseName === 'leanForward';
  const shouldShowBubble =
    isWorkingAction || (isSleeping && window.showTimerTextInBubble);

  if (shouldShowBubble && characterRoot && thoughtSprites.length > 0) {
    const sprite = thoughtSprites[0];

    // 타이머 텍스트 표시 설정이 방금 바뀐 순간(켜짐↔꺼짐)을 감지해서 즉시 다시 그림.
    // 안 그러면 sprite.visible이 계속 true라서 "처음 켜지는 순간"으로 인식이 안 되고,
    // 이전 상태(텍스트 또는 이모지)의 텍스처가 그대로 남아있게 됨.
    const modeJustChanged = sprite.userData.lastShowTimerMode !== window.showTimerTextInBubble;
    sprite.userData.lastShowTimerMode = window.showTimerTextInBubble;

    // 처음 풍선이 켜지는 순간 초기화
    if (!sprite.visible || modeJustChanged) {
      sprite.visible = true;
      sprite.material.opacity = 1;
      if (!isSleeping) {
        sprite.userData.currentEmoji = THOUGHT_EMOJI_POOL[Math.floor(Math.random() * THOUGHT_EMOJI_POOL.length)];
        sprite.material.map = createThoughtBubbleTexture(sprite.userData.currentEmoji);
        sprite.material.needsUpdate = true;
        thoughtNextSpawnTime = t + window.THOUGHT_INTERVAL_MIN + Math.random() * (window.THOUGHT_INTERVAL_MAX - window.THOUGHT_INTERVAL_MIN);
      } else {
        sprite.material.map = createThoughtBubbleTexture('🙂');
        sprite.material.needsUpdate = true;
      }
    }

    if (!isSleeping && t >= thoughtNextSpawnTime) {
      thoughtNextSpawnTime =
        t + window.THOUGHT_INTERVAL_MIN + Math.random() * (window.THOUGHT_INTERVAL_MAX - window.THOUGHT_INTERVAL_MIN);
      sprite.userData.currentEmoji = THOUGHT_EMOJI_POOL[Math.floor(Math.random() * THOUGHT_EMOJI_POOL.length)];
      sprite.material.map = createThoughtBubbleTexture(sprite.userData.currentEmoji);
      sprite.material.needsUpdate = true;
    }

    if (window.showTimerTextInBubble) {
      const nowSecond = Math.floor(t);
      if (sprite.userData.lastRedrawSecond !== nowSecond) {
        sprite.userData.lastRedrawSecond = nowSecond;
        sprite.material.map = createThoughtBubbleTexture(sprite.userData.currentEmoji || '🙂');
        sprite.material.needsUpdate = true;
      }
    }

    sprite.position.set(
      characterRoot.position.x + window.THOUGHT_OFFSET.x,
      characterRoot.position.y + window.THOUGHT_OFFSET.y,
      characterRoot.position.z + window.THOUGHT_OFFSET.z
    );
    if (sprite.material.map && sprite.material.map.image) {
      const img = sprite.material.map.image;
      const aspect = img.width / img.height;
      sprite.scale.set(window.THOUGHT_SCALE * aspect, window.THOUGHT_SCALE, 1);
    } else {
      sprite.scale.setScalar(window.THOUGHT_SCALE);
    }
  } else if (thoughtSprites.length > 0) {
    thoughtSprites[0].visible = false;
  }
  // (이 블록은 shouldShowBubble이 false일 때 실행됨 — 변수명은 그대로 else로 이어짐)

  // ===== 타이핑 파티클 (typing일 때만) =====
  if (currentPoseName === 'typing' && characterRoot && typingParticles.length > 0) {
    typingParticleTimer += dt;
    if (typingParticleTimer >= window.TYPING_PARTICLE_INTERVAL) {
      typingParticleTimer = 0;
      const idle = typingParticles.find((s) => s.userData.age === -1);
      if (idle) {
        idle.userData.age = 0;
        idle.userData.offsetIndex = Math.floor(Math.random() * window.TYPING_PARTICLE_OFFSETS.length);
        idle.visible = true;
      }
    }

    for (const p of typingParticles) {
      if (p.userData.age === -1) continue;
      p.userData.age += dt;
      const progress = p.userData.age / window.TYPING_PARTICLE_DURATION;
      if (progress >= 1) {
        p.userData.age = -1;
        p.visible = false;
        continue;
      }
      const off = window.TYPING_PARTICLE_OFFSETS[p.userData.offsetIndex];
      p.position.set(
        characterRoot.position.x + off.x,
        characterRoot.position.y + off.y + Math.sin(progress * Math.PI) * window.TYPING_PARTICLE_RISE,
        characterRoot.position.z + off.z
      );
      p.scale.setScalar(window.TYPING_PARTICLE_SCALE);
      p.material.opacity = 1 - progress;
    }
  } else {
    for (const p of typingParticles) {
      if (p.userData.age !== -1) {
        p.userData.age = -1;
        p.visible = false;
      }
    }
    typingParticleTimer = 0;
  }

  // ===== 땀방울 (모든 작업 자세에서 가끔) =====
  if (isWorkingAction && characterRoot && sweatSprites.length > 0) {
    if (t >= sweatNextSpawnTime) {
      sweatNextSpawnTime = t + window.SWEAT_INTERVAL_MIN + Math.random() * (window.SWEAT_INTERVAL_MAX - window.SWEAT_INTERVAL_MIN);
      const idle = sweatSprites.find((s) => s.userData.age === -1);
      if (idle) {
        idle.userData.age = 0;
        idle.visible = true;
      }
    }

    for (const s of sweatSprites) {
      if (s.userData.age === -1) continue;
      s.userData.age += dt;
      const progress = s.userData.age / window.SWEAT_DURATION;
      if (progress >= 1) {
        s.userData.age = -1;
        s.visible = false;
        continue;
      }
      s.position.set(
        characterRoot.position.x + window.SWEAT_OFFSET.x,
        characterRoot.position.y + window.SWEAT_OFFSET.y - progress * window.SWEAT_FALL_DISTANCE,
        characterRoot.position.z + window.SWEAT_OFFSET.z
      );
      s.scale.setScalar(window.SWEAT_SCALE);
      const fadeIn = Math.min(1, progress / 0.2);
      const fadeOut = Math.min(1, (1 - progress) / 0.25);
      s.material.opacity = Math.min(fadeIn, fadeOut);
    }
  } else {
    for (const s of sweatSprites) {
      if (s.userData.age !== -1) {
        s.userData.age = -1;
        s.visible = false;
      }
    }
  }

   renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyPixelSize();
});

// ===== 마우스 휠로 카메라 확대/축소 =====
window.addEventListener('wheel', (e) => {
  e.preventDefault();

  const zoomSpeed = 0.0015;
  CAMERA_EXTRA_MARGIN = THREE.MathUtils.clamp(
    CAMERA_EXTRA_MARGIN + e.deltaY * zoomSpeed,
    0.9,
    4.0
  );
  frameGroup(CAMERA_EXTRA_MARGIN);
}, { passive: false });


// ===== 뽀모도로 타이머 UI 연결 =====
const timerBadge = document.getElementById('timer-badge');
const settingsPanel = document.getElementById('settings-panel');
const workInput = document.getElementById('work-minutes-input');
const breakInput = document.getElementById('break-minutes-input');
const startBtn = document.getElementById('timer-start-btn');
const pauseBtn = document.getElementById('timer-pause-btn');
const resetBtn = document.getElementById('timer-reset-btn');
const closeBtn = document.getElementById('settings-close-btn');



function formatSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateTimerDisplay(state) {
  currentTimerMode = state.mode;
  timerIsRunning = state.isRunning;

  const modeLabel = state.mode === 'work' ? '작업 중' : '휴식 중';
  window.currentTimerLabelText = `${modeLabel} · ${formatSeconds(state.remainingSeconds)}`;
  timerBadge.textContent = window.currentTimerLabelText;
  // 상단 배지는 "표시 켜짐" 설정과 무관하게 항상 숨김 — 켜져 있으면 생각풍선 쪽에 대신 표시함
  timerBadge.classList.add('hidden');

  if (document.activeElement !== workInput) {
    workInput.value = state.settings.workMinutes;
  }
  if (document.activeElement !== breakInput) {
    breakInput.value = state.settings.breakMinutes;
  }

  startBtn.disabled = state.isRunning;
  pauseBtn.disabled = !state.isRunning;

  // 작업이 새로 시작되는 순간(휴식→작업 전환 포함)에 서류 뭉텅이를 이번 작업 시간 분량만큼 채움
  const isWorkRunningNow = state.mode === 'work' && state.isRunning;
  if (isWorkRunningNow && !wasWorkRunning) {
    fillPaperStacks(state.settings.workMinutes);
  }
  wasWorkRunning = isWorkRunningNow;

  // 콘솔에서 forcePose로 강제 고정해둔 동안은 타이머 상태로 자세를 바꾸지 않음
  if (poseForcedByConsole) return;

    if (state.mode === 'break' && state.isRunning) {
    // 휴식 중이고 실제로 타이머가 돌아가고 있으면 sleep 자세로.
    // workActionsActive는 true로 둬야 고개가 마우스 대신 sleep 전용 각도를 따라가지만,
    // 작업용 랜덤 동작 스케줄러(scheduleNextWorkAction)는 꺼야
    // 나중에 튀어나와서 currentPoseName을 typing 등으로 덮어쓰는 걸 막을 수 있음.
    workActionsActive = true;
    actionSchedulerRunning = false; // 예약된 다음 스케줄이 있어도 이 플래그로 무시되게
    currentPoseName = 'sleep';

    // 휴식에 들어가는 순간, 남은 개수와 무관하게 서류 뭉텅이를 전부 치움
    if (paperStackMeshes.length > 0) {
      for (const mesh of paperStackMeshes) {
        paperStackGroup.remove(mesh);
        mesh.geometry.dispose();
      }
      paperStackMeshes = [];
    }
    paperStackTotalCount = 0;
    paperStackRemaining = 0;
    paperStackElapsedForDrop = 0;
  } else {
    // 작업 중이면서 실제로 돌아가고 있을 때만 랜덤 동작 활성화, 그 외엔 턱 괴는 자세로 복귀
    const shouldBeActive = state.mode === 'work' && state.isRunning;
    setWorkActionsActive(shouldBeActive);
  }
}

// 타이머 텍스트를 생각풍선에 같이 보여줄지 여부 — 기본은 꺼짐
window.showTimerTextInBubble = false;

const contextMenu = document.getElementById('context-menu');
const contextToggleBtn = document.getElementById('context-toggle-timer-text');
const contextToggleState = document.getElementById('context-toggle-state');

function updateContextToggleLabel() {
  contextToggleState.textContent = window.showTimerTextInBubble ? '켜짐' : '꺼짐';
}

function openContextMenu(clientX, clientY) {
  updateContextToggleLabel();
  contextMenu.style.left = clientX + 'px';
  contextMenu.style.top = clientY + 'px';
  contextMenu.classList.remove('hidden');
}

function closeContextMenu() {
  contextMenu.classList.add('hidden');
}

contextToggleBtn.addEventListener('click', () => {
  window.showTimerTextInBubble = !window.showTimerTextInBubble;
  updateContextToggleLabel();
  closeContextMenu();
});

// 메뉴 바깥을 클릭하면 닫힘
window.addEventListener('mousedown', (e) => {
  if (!contextMenu.classList.contains('hidden') && !e.target.closest('#context-menu')) {
    closeContextMenu();
  }
});

function openSettingsPanel() {
  settingsPanel.classList.remove('hidden');
}

function closeSettingsPanel() {
  settingsPanel.classList.add('hidden');
}

closeBtn.addEventListener('click', closeSettingsPanel);

startBtn.addEventListener('click', () => {
  window.electronAPI.startTimer();
  closeSettingsPanel(); // 시작하면 입력 패널은 자동으로 닫히게
});

pauseBtn.addEventListener('click', () => {
  window.electronAPI.pauseTimer();
});

resetBtn.addEventListener('click', () => {
  window.electronAPI.resetTimer();
  // 리셋하면 서류 더미도 같이 비움 (다음 작업 시작 때 다시 채워짐)
  paperStackTotalCount = 0;
  paperStackRemaining = 0;
  paperStackElapsedForDrop = 0;
  wasWorkRunning = false; // 다음 작업 시작이 "새로 시작"으로 인식되게 리셋
  if (paperStackGroup) {
    for (const mesh of paperStackMeshes) {
      paperStackGroup.remove(mesh);
      mesh.geometry.dispose();
    }
    paperStackMeshes = [];
  }
});

function applyDurationsFromInputs() {
  const w = parseInt(workInput.value, 10);
  const b = parseInt(breakInput.value, 10);
  window.electronAPI.setTimerDurations(w, b);
}

workInput.addEventListener('change', applyDurationsFromInputs);
breakInput.addEventListener('change', applyDurationsFromInputs);

if (window.electronAPI && window.electronAPI.onTimerUpdate) {
  window.electronAPI.onTimerUpdate(updateTimerDisplay);
}

if (window.electronAPI && window.electronAPI.getTimerState) {
  window.electronAPI.getTimerState().then(updateTimerDisplay);
}


// ===== 왼쪽 드래그로 창 이동 / Shift+왼쪽 드래그로 카메라 회전 / 인규 클릭하면 설정 패널 =====
let isDragging = false;
let isOrbiting = false;
let lastScreenX = 0;
let lastScreenY = 0;

let pendingDx = 0;
let pendingDy = 0;
let rafScheduled = false;

let mouseDownClientX = 0;
let mouseDownClientY = 0;
let mouseDownTime = 0;
let totalMoveDistance = 0;
const CLICK_MAX_MOVE_PX = 4;
const CLICK_MAX_DURATION_MS = 500;

const raycaster = new THREE.Raycaster();
const clickNDC = new THREE.Vector2();

function tryOpenSettingsFromClick(clientX, clientY) {
  if (!characterRoot) {
    console.log('클릭 무시: characterRoot 없음');
    return;
  }

  clickNDC.x = (clientX / window.innerWidth) * 2 - 1;
  clickNDC.y = -(clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(clickNDC, camera);
  const intersects = raycaster.intersectObject(characterRoot, true);
  console.log('클릭 시도:', clientX, clientY, '| 맞은 개수:', intersects.length, '| characterRoot.visible:', characterRoot.visible);

  if (intersects.length > 0) {
    openSettingsPanel();
  }
}

function flushMove() {
  rafScheduled = false;
  if (pendingDx !== 0 || pendingDy !== 0) {
    window.electronAPI.moveWindow(pendingDx, pendingDy);
    pendingDx = 0;
    pendingDy = 0;
  }
}

// 우클릭(button === 2)으로 인규를 클릭하면 컨텍스트 메뉴 열기
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!characterRoot) return;

  clickNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  clickNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(clickNDC, camera);
  const intersects = raycaster.intersectObject(characterRoot, true);

  if (intersects.length > 0) {
    openContextMenu(e.clientX, e.clientY);
  }
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest && e.target.closest('#settings-panel')) return;
  if (e.target.closest && e.target.closest('#context-menu')) return;

  if (e.shiftKey) {
    isOrbiting = true;
  } else {
    isDragging = true;
  }
  lastScreenX = e.screenX;
  lastScreenY = e.screenY;

  mouseDownClientX = e.clientX;
  mouseDownClientY = e.clientY;
  mouseDownTime = performance.now();
  totalMoveDistance = 0;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging && !isOrbiting) return;

  if (e.buttons !== 1) {
    isDragging = false;
    isOrbiting = false;
    return;
  }

  const dx = e.screenX - lastScreenX;
  const dy = e.screenY - lastScreenY;
  lastScreenX = e.screenX;
  lastScreenY = e.screenY;

  totalMoveDistance += Math.abs(dx) + Math.abs(dy);

  if (isOrbiting) {
    // 위아래(고도, elevation)는 고정하고 좌우(방위각, azimuth)만 움직이게 함 —
    // 마우스를 위아래로 움직여도(dy) 카메라 각도가 안 바뀜.
    CAMERA_AZIMUTH_DEG += dx * 0.4;
    frameGroup();
    return;
  }

  pendingDx += dx;
  pendingDy += dy;
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(flushMove);
  }
});

window.addEventListener('mouseup', (e) => {
  if (isOrbiting) {
    console.log(
      '현재 카메라 각도 → CAMERA_AZIMUTH_DEG:',
      Math.round(CAMERA_AZIMUTH_DEG),
      '| CAMERA_ELEVATION_DEG:',
      Math.round(CAMERA_ELEVATION_DEG)
    );
  }

  const elapsed = performance.now() - mouseDownTime;
  const wasClick =
    !isOrbiting && totalMoveDistance <= CLICK_MAX_MOVE_PX && elapsed <= CLICK_MAX_DURATION_MS;

  if (wasClick) {
    tryOpenSettingsFromClick(mouseDownClientX, mouseDownClientY);
  }

  isDragging = false;
  isOrbiting = false;
});

window.addEventListener('blur', () => {
  isDragging = false;
  isOrbiting = false;
});
