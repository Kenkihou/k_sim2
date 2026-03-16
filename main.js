import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';


// ==========================================
// 0. ローディング管理と投影ロジック (追加)
// ==========================================
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text');
const loadingProgress = document.getElementById('loading-progress');

// 読み込み対象のIDリスト
const targetIds = ['52353670', '52353671', '52353681'];

// 読み込み状態を管理するオブジェクト
const loadingStatus = {
    grounds: {},   // 読み込まれた地盤モデル (ID: Mesh)
    roads: {},     // 読み込まれた道路モデル (ID: Mesh)
    baseRoadLoaded: false, // road.glb の読み込み状態
    baseGroundLoaded: false // ground.glb の読み込み状態
};

// 全てのデータが揃ったかチェックする関数
function checkAllLoaded() {
    // 1. ターゲットIDの地盤と道路がすべて揃っているか
    const allSpecificLoaded = targetIds.every(id => {
        return loadingStatus.grounds[id] && loadingStatus.roads[id];
    });

    // 2. 基本データも揃っているか
    const allBaseLoaded = loadingStatus.baseRoadLoaded && loadingStatus.baseGroundLoaded;

    // 進捗表示の更新
    let loadedCount = 0;
    targetIds.forEach(id => {
        if (loadingStatus.grounds[id]) loadedCount++;
        if (loadingStatus.roads[id]) loadedCount++;
    });
    if (loadingStatus.baseRoadLoaded) loadedCount++;
    if (loadingStatus.baseGroundLoaded) loadedCount++;
    
    const totalRequired = (targetIds.length * 2) + 2; // (地盤3 + 道路3) + 基本2
    if (loadingProgress) {
        loadingProgress.textContent = `データ読み込み中: ${loadedCount}/${totalRequired}`;
    }

    // すべて完了していたら画面を消す
    if (allSpecificLoaded && allBaseLoaded) {
        if (loadingProgress) loadingProgress.textContent = "地形適合完了。システムを開始します...";
        setTimeout(() => {
            if (loadingScreen) {
                loadingScreen.style.opacity = '0';
                setTimeout(() => { 
                    loadingScreen.style.display = 'none'; 
                }, 800);
            }
        }, 1000);
    }
}

// 【修正後】道路を特定の地盤に投影する関数
function projectRoadToGround(roadMesh, groundMesh, id) {
    if (!roadMesh || !groundMesh) return;

    console.log(`[投影開始] ID: ${id || "Base"}`);

    // 最新の座標を強制更新
    roadMesh.updateMatrixWorld(true);
    groundMesh.updateMatrixWorld(true);

    const roadRaycaster = new THREE.Raycaster();
    const downDir = new THREE.Vector3(0, -1, 0);
    let hitCount = 0;

    roadMesh.traverse((child) => {
        if (child.isMesh) {
            // 中心座標を取得
            child.geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            child.geometry.boundingBox.getCenter(center);
            
            // ワールド座標に変換
            const worldPos = center.clone().applyMatrix4(child.matrixWorld);
            
            // はるか上空(5000m)からレイを飛ばす
            roadRaycaster.set(new THREE.Vector3(worldPos.x, 5000, worldPos.z), downDir);
            
            // 地盤のみと判定
            const intersects = roadRaycaster.intersectObject(groundMesh, true);
            
            if (intersects.length > 0) {
                const groundY = intersects[0].point.y;
                const currentY = worldPos.y;

                // ★重要：現在の高さとの「差分」を足すことで、元の高さ情報を壊さずに移動
                const offset = (groundY + 0.15) - currentY; 
                
                child.position.y += offset;
                child.updateMatrix();
                hitCount++;
            }
        }
    });
    console.log(`[投影完了] ID: ${id} / 調整数: ${hitCount}`);
}

// 道路メッシュを1つに結合して軽量化する関数
function optimizeRoads(roadGroup) {
    const geometries = [];
    
    roadGroup.updateMatrixWorld(true);
    
    roadGroup.traverse((child) => {
        if (child.isMesh) {
            // ジオメトリを複製し、現在の位置・回転・サイズを焼き付ける（applyMatrix4）
            const clonedGeom = child.geometry.clone();
            clonedGeom.applyMatrix4(child.matrixWorld);
            geometries.push(clonedGeom);
        }
    });

    if (geometries.length === 0) return roadGroup;

    // 全てのジオメトリを結合
    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    
    // 結合した新しいメッシュを作成
    const mergedMesh = new THREE.Mesh(mergedGeometry, roadMaterial);
    
    // 元のバラバラのデータを削除し、結合した1つだけを返す
    console.log(`[軽量化] ${geometries.length}個の道路パーツを1つに結合しました`);
    return mergedMesh;
}


// ==========================================
// 1. グローバル変数・定数定義
// ==========================================

// 道路用のマテリアル
const roadMaterial = new THREE.MeshBasicMaterial({
    color: 0x888888, 
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    // 埋まり防止設定（手前に描画）
    polygonOffset: true,
    polygonOffsetFactor: -4, 
    polygonOffsetUnits: -4,
    depthTest: true,
    depthWrite: false
});

// --- UI要素 ---
const menu = document.getElementById('context-menu');
const moveInfo = document.getElementById('move-info');
const commentTooltip = document.getElementById('comment-tooltip');
const helpPanel = document.getElementById('help-panel');
const walkHelpPanel = document.getElementById('walk-help-panel');
const cameraInfo = document.getElementById('camera-info');
const resetBtn = document.getElementById('reset-btn');
const saveBtn = document.getElementById('save-btn');
const loadBtn = document.getElementById('load-btn');
const walkModeBtn = document.getElementById('walk-mode-btn');
const fileInput = document.getElementById('file-input');
const duplicateBtn = document.getElementById('duplicate-btn');
const deleteBtn = document.getElementById('delete-btn');
const inputW = document.getElementById('input-width');
const inputD = document.getElementById('input-depth');
const inputH = document.getElementById('input-height');
const inputComment = document.getElementById('input-comment');
const valW = document.getElementById('val-w');
const valD = document.getElementById('val-d');
const valH = document.getElementById('val-h');
const closeBtn = document.getElementById('close-menu');

const subViewPanel = document.getElementById('sub-view-panel');
const fixedSubContainer = document.getElementById('fixed-sub-container');
const addSubBtn = document.getElementById('add-sub-btn');

// リサイズハンドル
const resizeHandle = document.getElementById('resize-handle');

// 照準UI
const crosshair = document.getElementById('crosshair');
const aimHint = document.getElementById('aim-hint');

// 地図切替ボタン
const mapSwitchBtn = document.getElementById('map-switch-btn');
let isZoningMapMode = false; 
let zoningTexture;

// 道路設定UI
const roadUI = document.getElementById('road-ui');
const roadColorPicker = document.getElementById('road-color-picker');
const roadOpacitySlider = document.getElementById('road-opacity-slider');
const roadOpacityVal = document.getElementById('road-opacity-val');

// グローバル変数に追加
let towerOuterModel = null; // 外観用
let towerInnerModel = null; // 内観用
let isTowerMode = false;    // モード管理フラグ
let savedCameraState = { position: new THREE.Vector3(), target: new THREE.Vector3() }; // カメラ位置保存用

// 京都タワーの展望台位置（座標はログより推定：X=-65.1, Z=-180.6, 床高さ=100m）
// カメラの高さは床+1.6m（目の高さ）とします
const TOWER_VIEW_POS = new THREE.Vector3(-57, 130, -181.5);
// グローバル変数に追加
let towerAngle = 0; // 展望台の周回アニメーション用


// 1. まずローダーのインスタンスを作成
const textureLoader = new THREE.TextureLoader();

// 2. 読み込みを開始し、コールバックで結果を受け取る
textureLoader.load('./asset/youto_map.png', (loadedTexture) => {
    // 3. 読み込みが終わったら、上で宣言したグローバル変数に代入
    zoningTexture = loadedTexture; 
    
    // 設定を適用
    zoningTexture.flipY = false;
    zoningTexture.colorSpace = THREE.SRGBColorSpace;
    zoningTexture.needsUpdate = true;
    
    console.log("youto_map.png の読み込みと代入が完了しました");
    
    // 描画を更新
    if (typeof renderAll === 'function') renderAll();
}, undefined, (err) => {
    console.error("テクスチャ読み込みエラー:", err);
});

// ウォークモードUI
const walkContainer = document.getElementById('walk-container');
const walkView = document.getElementById('walk-view');
const walkPlayBtn = document.getElementById('walk-play-btn');
const walkClearBtn = document.getElementById('walk-clear-btn');
const walkProgressSlider = document.getElementById('walk-progress');
const walkTensionSlider = document.getElementById('walk-tension');

const heightSteps = [20, 31, 45, 60];
// --- 【追加】断面図用の定数とグローバル変数 ---
const LAYER_SECTION = 2; 
const LAYER_SECTION_GRID = 3;

const SECTION_CONFIG = {
    cutAxis: 'X',
    planeConstant: 1000, 
    capColor: 0xff3333,
    groundColor: 0x3333ff,
    groundThickness: 3.0,
    sectionZoom: 1.0,
    sectionX: 0.0,
    sectionY: 0.0,
    bounds: null,
    baseGridY: 0
};

// 断面図用カメラやメッシュを保持する変数
let cameraSection, clipPlane, stencilGroup, capMesh, groundCapMesh, sectionGridGroup;

// イベント伝播遮断
const stopProp = (e) => e.stopPropagation();
menu.addEventListener('pointerdown', stopProp);
menu.addEventListener('pointermove', stopProp);
menu.addEventListener('wheel', stopProp);
menu.addEventListener('keydown', stopProp);
menu.addEventListener('keyup', stopProp);
resetBtn.addEventListener('pointerdown', stopProp);
saveBtn.addEventListener('pointerdown', stopProp);
loadBtn.addEventListener('pointerdown', stopProp);
walkModeBtn.addEventListener('pointerdown', stopProp);
walkContainer.addEventListener('pointerdown', stopProp);
mapSwitchBtn.addEventListener('pointerdown', stopProp);
roadUI.addEventListener('pointerdown', stopProp);
roadUI.addEventListener('pointermove', stopProp);

// メニューのドラッグ移動
const menuHeader = menu.querySelector('h3');
let isMenuDragging = false;
let menuDragOffset = { x: 0, y: 0 };

menuHeader.addEventListener('pointerdown', (e) => {
    isMenuDragging = true;
    const rect = menu.getBoundingClientRect();
    menuDragOffset.x = e.clientX - rect.left;
    menuDragOffset.y = e.clientY - rect.top;
    menuHeader.setPointerCapture(e.pointerId);
});

menuHeader.addEventListener('pointermove', (e) => {
    if (!isMenuDragging) return;
    menu.style.left = (e.clientX - menuDragOffset.x) + 'px';
    menu.style.top = (e.clientY - menuDragOffset.y) + 'px';
});

menuHeader.addEventListener('pointerup', (e) => {
    isMenuDragging = false;
    menuHeader.releasePointerCapture(e.pointerId);
});


// --- シーン設定 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);


// --- 断面図ビューの初期化関数 ---
function initSectionView() {
    // 平行投影カメラ
    cameraSection = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 50000);
    cameraSection.layers.set(LAYER_SECTION);
    cameraSection.layers.enable(LAYER_SECTION_GRID);

    // 切断平面の作成
    clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), SECTION_CONFIG.planeConstant);
    renderer.localClippingEnabled = true; // クリッピングを有効化

    // 断面の塗りつぶし（キャップ）用メッシュ
    const capMaterial = new THREE.MeshBasicMaterial({
        color: SECTION_CONFIG.capColor,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.EqualStencilFunc,
        side: THREE.DoubleSide
    });
    capMesh = new THREE.Mesh(new THREE.PlaneGeometry(50000, 50000), capMaterial);
    capMesh.layers.set(LAYER_SECTION);
    scene.add(capMesh);

    // 地盤の断面ライン用メッシュ
    groundCapMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: SECTION_CONFIG.groundColor, side: THREE.DoubleSide }));
    groundCapMesh.layers.set(LAYER_SECTION);
    scene.add(groundCapMesh);

    // グリッド線用グループ
    sectionGridGroup = new THREE.Group();
    sectionGridGroup.layers.set(LAYER_SECTION_GRID);
    scene.add(sectionGridGroup);

    // GUIの追加（切断位置を操作できるようにする）
    const gui = new GUI();
    gui.add(SECTION_CONFIG, 'planeConstant', -2000, 2000).name('切断位置').onChange(v => {
        //clipPlane.constant = v;
        updateSectionViewHelper(); // 後述する更新関数
    });
}

// 実行
initSectionView();


// --- メインカメラ & レンダラー ---
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
camera.position.set(200, 200, 200);

// メインカメラは全てのレイヤー（0と1）を表示
camera.layers.enable(0);
camera.layers.enable(1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.id = 'main-canvas';
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false; 


// ----------------------------------------------------
//  サブカメラ管理
// ----------------------------------------------------

const createFrustumMesh = (cam, color = 0xffff00) => {
    const fov = cam.fov;
    const aspect = cam.aspect;
    const far = cam.far;
    const fovRad = (fov * Math.PI) / 180;
    const y = Math.tan(fovRad / 2) * far;
    const x = y * aspect;
    const vertices = new Float32Array([
        0, 0, 0, -x, y, -far, x, y, -far, -x, -y, -far, x, -y, -far
    ]);
    const indices = [
        0, 2, 1, 0, 4, 2, 0, 3, 4, 0, 1, 3, 1, 2, 3, 2, 4, 3
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(cam.position);
    mesh.quaternion.copy(cam.quaternion);
    return mesh;
};

// 1. 固定サブカメラ
const fixedSubCamera = new THREE.PerspectiveCamera(45, 4/3, 1, 5000);
fixedSubCamera.position.set(-17.1, 30.3, -121.3);
const fixedTarget = new THREE.Vector3(-68.0, 31.7, -131.5);
fixedSubCamera.lookAt(fixedTarget);
// ★ここに追記：サブカメラはレイヤー0（建物など）のみを表示し、レイヤー1（ラベル）を無視する
fixedSubCamera.layers.set(0);

const fixedSubRenderer = new THREE.WebGLRenderer({ antialias: true });
fixedSubRenderer.setSize(fixedSubContainer.clientWidth, fixedSubContainer.clientHeight);
fixedSubRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
fixedSubContainer.appendChild(fixedSubRenderer.domElement);

const fixedHelperCam = fixedSubCamera.clone();
fixedHelperCam.far = 30;
fixedHelperCam.updateProjectionMatrix();
fixedHelperCam.updateMatrixWorld(true);
const fixedHelper = new THREE.CameraHelper(fixedHelperCam);
scene.add(fixedHelper);
const fixedFrustumMesh = createFrustumMesh(fixedHelperCam);
scene.add(fixedFrustumMesh);

fixedSubRenderer.domElement.addEventListener('click', () => {
    camera.position.copy(fixedSubCamera.position);
    controls.target.copy(fixedTarget);
    controls.update();
});


// 2. 動的サブカメラ配列
const dynamicSubCameras = []; 

const addDynamicCamera = (pos, target) => {
    if (dynamicSubCameras.length >= 2) return;

    const newCam = new THREE.PerspectiveCamera(45, 4/3, 1, 5000);
    newCam.position.copy(pos);
    newCam.lookAt(target);

    const div = document.createElement('div');
    div.className = 'sub-cam-container';
    
    const newRenderer = new THREE.WebGLRenderer({ antialias: true });
    newRenderer.setSize(fixedSubContainer.clientWidth || 300, fixedSubContainer.clientHeight || 225); 
    newRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    div.appendChild(newRenderer.domElement);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-sub-btn';
    removeBtn.textContent = '×';
    div.appendChild(removeBtn);

    subViewPanel.insertBefore(div, addSubBtn);

    const hCam = newCam.clone();
    hCam.far = 30;
    hCam.updateProjectionMatrix();
    hCam.updateMatrixWorld(true);
    
    const newHelper = new THREE.CameraHelper(hCam);
    scene.add(newHelper);
    const newMesh = createFrustumMesh(hCam);
    scene.add(newMesh);

    const camData = {
        camera: newCam,
        renderer: newRenderer,
        target: target.clone(),
        helper: newHelper,
        mesh: newMesh,
        div: div,
        helperCam: hCam
    };
    dynamicSubCameras.push(camData);

    newRenderer.domElement.addEventListener('click', () => {
        camera.position.copy(newCam.position);
        controls.target.copy(camData.target);
        controls.update();
    });

    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeDynamicCamera(camData);
    });

    if (dynamicSubCameras.length >= 2) addSubBtn.style.display = 'none';
    
    requestAnimationFrame(() => {
        const w = div.clientWidth;
        const h = div.clientHeight;
        if(w && h) newRenderer.setSize(w, h);
        renderAll();
    });
};

const removeDynamicCamera = (camData) => {
    camData.div.remove();
    scene.remove(camData.helper);
    scene.remove(camData.mesh);
    camData.renderer.dispose();
    if(camData.mesh.geometry) camData.mesh.geometry.dispose();
    if(camData.mesh.material) camData.mesh.material.dispose();

    const idx = dynamicSubCameras.indexOf(camData);
    if (idx > -1) dynamicSubCameras.splice(idx, 1);

    addSubBtn.style.display = 'flex';
    renderAll();
};

addSubBtn.addEventListener('click', () => {
    addDynamicCamera(camera.position, controls.target);
});


// 3. ウォークモード用サブカメラ
const walkCamera = new THREE.PerspectiveCamera(60, 4/3, 0.5, 2000);
walkCamera.position.set(0, 100, 0); 

const walkRenderer = new THREE.WebGLRenderer({ antialias: true });
walkRenderer.setSize(300, 225); 
walkRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
walkView.appendChild(walkRenderer.domElement);

const walkHelperCam = walkCamera.clone();
walkHelperCam.far = 30;
walkHelperCam.updateProjectionMatrix();
const walkHelper = new THREE.CameraHelper(walkHelperCam);
scene.add(walkHelper);
const walkFrustumMesh = createFrustumMesh(walkHelperCam, 0xff00ff);
scene.add(walkFrustumMesh);

walkView.addEventListener('click', () => {
    camera.position.copy(walkCamera.position);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(walkCamera.quaternion);
    controls.target.copy(walkCamera.position).add(direction.multiplyScalar(20));
    controls.update();
});


// ----------------------------------------------------
//  ★カメラパス制御クラス
// ----------------------------------------------------
class CameraPathController {
    constructor(scene, subCamera, groundModels, updateCallback) {
        this.scene = scene;
        this.subCamera = subCamera;
        this.groundModels = groundModels;
        this.updateCallback = updateCallback;

        this.waypoints = [];
        this.pins = [];
        this.curve = null;
        this.pathMesh = null;
        this.currentMarker = null;
        
        this.cornerRadius = 5.0; 
        this.isPlaying = false;
        this.progress = 0;
        
        this.baseSpeed = 0.0005; 
        this.slowSpeed = 0.00025; 

        this.pinMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        this.pathMaterial = new THREE.MeshLambertMaterial({ color: 0xffff00 }); 

        this.setupMarker();
    }

    setupMarker() {
        const geometry = new THREE.ConeGeometry(3.0, 9.0, 16);
        geometry.rotateX(Math.PI / 2); 
        
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        this.currentMarker = new THREE.Mesh(geometry, material);
        
        this.currentMarker.layers.set(1);
        
        this.currentMarker.visible = false; 
        this.scene.add(this.currentMarker);
    }

    handleClick(mousePosition, mainCamera) {
        if (!this.groundModels || this.groundModels.length === 0) return;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mousePosition, mainCamera);
        const intersects = raycaster.intersectObjects(this.groundModels, true);

        if (intersects.length > 0) {
            const hitPoint = intersects[0].point;
            const waypoint = hitPoint.clone().add(new THREE.Vector3(0, 1.6, 0));
            this.addWaypoint(waypoint);
        }
    }

    addWaypoint(point) {
        this.waypoints.push(point);

        const geometry = new THREE.SphereGeometry(1.0, 16, 16);
        const pin = new THREE.Mesh(geometry, this.pinMaterial);
        
        pin.layers.set(1);
        
        pin.position.copy(point);
        this.scene.add(pin);
        this.pins.push(pin);

        if (this.waypoints.length === 1) {
            this.subCamera.position.copy(point);
            this.subCamera.lookAt(point.clone().add(new THREE.Vector3(0, 0, 1)));
            
            this.currentMarker.position.copy(point).add(new THREE.Vector3(0, 3.0, 0)); 
            this.currentMarker.rotation.set(0, 0, 0); 
            this.currentMarker.visible = true;
        } else {
            this.updateCurve();
        }
        
        renderAll();
    }

    updateCurve() {
        if (this.waypoints.length < 2) return;

        this.curve = new THREE.CurvePath();
        const points = this.waypoints;
        const radius = this.cornerRadius;

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const p2 = points[i + 2];

            if (p2) {
                const vec1 = new THREE.Vector3().subVectors(p1, p0);
                const vec2 = new THREE.Vector3().subVectors(p2, p1);
                const limit = Math.min(vec1.length(), vec2.length()) * 0.5;
                const r = Math.min(radius, limit);

                const lineEnd = new THREE.Vector3().copy(p1).sub(vec1.normalize().multiplyScalar(r));
                const curveEnd = new THREE.Vector3().copy(p1).add(vec2.normalize().multiplyScalar(r));

                let lineStart;
                if (i === 0) {
                    lineStart = p0;
                } else {
                    const prevCurve = this.curve.curves[this.curve.curves.length - 1];
                    lineStart = prevCurve.v2; 
                }
                
                this.curve.add(new THREE.LineCurve3(lineStart, lineEnd));
                this.curve.add(new THREE.QuadraticBezierCurve3(lineEnd, p1, curveEnd));
            } else {
                let lineStart;
                if (i === 0) {
                    lineStart = p0;
                } else {
                    const prevCurve = this.curve.curves[this.curve.curves.length - 1];
                    lineStart = prevCurve.v2;
                }
                this.curve.add(new THREE.LineCurve3(lineStart, p1));
            }
        }

        if (this.pathMesh) {
            this.scene.remove(this.pathMesh);
            this.pathMesh.geometry.dispose();
        }

        const geometry = new THREE.TubeGeometry(this.curve, this.waypoints.length * 20, 2.0, 8, false);
        this.pathMesh = new THREE.Mesh(geometry, this.pathMaterial);
        
        this.pathMesh.layers.set(1);

        this.scene.add(this.pathMesh);
    }

    setTension(val) {
        this.cornerRadius = val * 20.0;
        this.updateCurve();
        renderAll();
    }

    undo() {
        if (this.waypoints.length === 0) return;

        this.waypoints.pop();
        
        const pin = this.pins.pop();
        if (pin) {
            this.scene.remove(pin);
            pin.geometry.dispose();
        }

        if (this.waypoints.length < 2) {
            if (this.pathMesh) {
                this.scene.remove(this.pathMesh);
                this.pathMesh.geometry.dispose();
                this.pathMesh = null;
                this.curve = null;
            }
            if (this.waypoints.length === 0) {
                this.currentMarker.visible = false;
            } else {
                const lastPoint = this.waypoints[0];
                this.subCamera.position.copy(lastPoint);
                this.currentMarker.position.copy(lastPoint).add(new THREE.Vector3(0, 3.0, 0));
            }
        } else {
            this.updateCurve();
        }

        this.progress = 0;
        this.isPlaying = false;
        
        if (this.updateCallback) this.updateCallback();
        renderAll();
    }

    update() {
        if (!this.isPlaying || !this.curve) return;

        let currentSpeed = this.baseSpeed;
        const camPos = this.subCamera.position;
        for (const p of this.waypoints) {
            if (camPos.distanceTo(p) < 10.0) {
                currentSpeed = this.slowSpeed; 
                break;
            }
        }

        this.progress += currentSpeed;
        if (this.progress > 1.0) {
            this.progress = 0;
        }

        this.applyPosition(this.progress);
        if (this.updateCallback) this.updateCallback(this.progress);
    }
    
    applyPosition(progress) {
        if (!this.curve) return;
        
        const position = this.curve.getPoint(progress);
        this.subCamera.position.copy(position);
        
        const markerPos = position.clone().add(new THREE.Vector3(0, 3.0, 0));
        this.currentMarker.position.copy(markerPos);

        const lookAtProgress = Math.min(progress + 0.001, 0.9999);
        const lookAtPoint = this.curve.getPoint(lookAtProgress);
        
        this.subCamera.lookAt(lookAtPoint);

        const markerLookAtPoint = lookAtPoint.clone().add(new THREE.Vector3(0, 3.0, 0));
        this.currentMarker.lookAt(markerLookAtPoint);
    }

    togglePlay() {
        this.isPlaying = !this.isPlaying;
        return this.isPlaying;
    }
}


// --- インタラクション変数 ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let hoveredObject = null;
let selectedObject = null;
let isDragging = false;
let dragOffset = new THREE.Vector3();
let dragStartPosition = new THREE.Vector3();
let blueBuildings = [];
let baseMeshes = [];

const downRaycaster = new THREE.Raycaster();
const downDirection = new THREE.Vector3(0, -1, 0);
let groundModels = []; 
let paintTargets = [];
let projectiles = [];
let isAiming = false; // エイム状態フラグ

// ウォークモード管理
let isWalkMode = false;
const pathController = new CameraPathController(scene, walkCamera, groundModels, (progress) => {
    if (progress !== undefined) {
        walkProgressSlider.value = progress;
    } else {
        walkProgressSlider.value = 0;
        walkPlayBtn.textContent = "▶ 再生";
        walkPlayBtn.classList.remove('playing');
    }
});


// --- 情報表示更新 ---
const updateCameraInfo = () => {
    const pos = camera.position;
    const tgt = controls.target;
    const dist = pos.distanceTo(tgt);

    let altText = '-';
        if (groundModels.length > 0) {
        // 1000mだと山岳地帯などで足りない場合があるため2000m程度を推奨
        const rayOrigin = new THREE.Vector3(pos.x, 2000, pos.z);
        downRaycaster.set(rayOrigin, downDirection);
        // intersectObjects(..., true) は再帰探索のため重いので、
        // 地盤モデルが少ない場合は直接指定する方が高速です。
        const hits = downRaycaster.intersectObjects(groundModels, true);

        if (hits.length > 0) {
            const groundY = hits[0].point.y;
            const diff = pos.y - groundY;
            altText = `${diff.toFixed(1)}m`;
        } else {
            altText = '計測不能';
        }
    }

    cameraInfo.innerHTML = `
        Camera: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}<br>
        Target: ${tgt.x.toFixed(1)}, ${tgt.y.toFixed(1)}, ${tgt.z.toFixed(1)}<br>
        Dist: ${dist.toFixed(1)}m<br>
        <span style="color: #ffff00;">カメラの地盤面からの高さ：${altText}</span>
    `;
};


// ----------------------------------------------------
//  描画制御
// ----------------------------------------------------

const renderMain = () => {
    const hideThreshold = 2.0; 

    // 固定サブ
    const distFixed = camera.position.distanceTo(fixedSubCamera.position);
    const isInsideFixed = distFixed < hideThreshold;
    fixedHelper.visible = !isInsideFixed;
    fixedFrustumMesh.visible = !isInsideFixed;

    // 動的サブ
    dynamicSubCameras.forEach(dc => {
        const dist = camera.position.distanceTo(dc.camera.position);
        const isInside = dist < hideThreshold;
        dc.helper.visible = !isInside;
        dc.mesh.visible = !isInside;
    });

    // ウォークサブ
    walkHelper.visible = false;
    walkFrustumMesh.visible = false;

    renderer.render(scene, camera);
    updateCameraInfo();
};

const renderSubViews = () => {
    const fixedHVis = fixedHelper.visible;
    const fixedMVis = fixedFrustumMesh.visible;
    
    const dynamicsVis = dynamicSubCameras.map(dc => ({
        h: dc.helper.visible,
        m: dc.mesh.visible
    }));

    const walkHVis = walkHelper.visible;
    const walkMVis = walkFrustumMesh.visible;

    fixedHelper.visible = false;
    fixedFrustumMesh.visible = false;
    dynamicSubCameras.forEach(dc => {
        dc.helper.visible = false;
        dc.mesh.visible = false;
    });
    walkHelper.visible = false;
    walkFrustumMesh.visible = false;

    // レンダリング実行
    fixedSubRenderer.render(scene, fixedSubCamera);
    dynamicSubCameras.forEach(dc => {
        dc.renderer.render(scene, dc.camera);
    });
    
    if (isWalkMode) {
        walkRenderer.render(scene, walkCamera);
    }

    // 復元
    fixedHelper.visible = fixedHVis;
    fixedFrustumMesh.visible = fixedMVis;
    dynamicSubCameras.forEach((dc, i) => {
        dc.helper.visible = dynamicsVis[i].h;
        dc.mesh.visible = dynamicsVis[i].m;
    });
    walkHelper.visible = walkHVis;
    walkFrustumMesh.visible = walkMVis;
};

function renderAll() {
    renderMain();
    renderSubViews();
}

controls.addEventListener('change', renderMain);


// --- ローダー設定 ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

// --- ヘルパー関数 ---
const getColorByHeight = (height) => {
    if (height >= 59.5) return 0x0077ff; 
    if (height >= 44.5) return 0xffdd00; 
    return 0xff6600;
};

const getHoverColor = (baseColorHex) => {
    if (baseColorHex === 0x0077ff) return 0x66aaff; 
    if (baseColorHex === 0xffdd00) return 0xffff66; 
    if (baseColorHex === 0xff6600) return 0xff9933; 
    return 0xffffff;
};

const updateObjectColor = (mesh) => {
    const h = mesh.userData.originalSize.y * mesh.scale.y;
    const colorHex = getColorByHeight(h);
    mesh.userData.baseColor = colorHex;
    mesh.material.color.setHex(colorHex);
};

const addEdges = (mesh, color = 0x888888) => {
    const oldEdges = mesh.children.find(c => c.isLineSegments);
    if (oldEdges) mesh.remove(oldEdges);
    const edgesGeometry = new THREE.EdgesGeometry(mesh.geometry, 15);
    const edgesMaterial = new THREE.LineBasicMaterial({ color: color });
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    edges.raycast = () => {}; 
    mesh.add(edges);
};

const setupBaseMesh = (mesh, index) => {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const shiftX = -center.x;
    const shiftY = -box.min.y;
    const shiftZ = -center.z;
    mesh.geometry.translate(shiftX, shiftY, shiftZ);
    
    mesh.userData.originalSize = { x: size.x, y: size.y, z: size.z };
    
    mesh.userData.initialScenePos = mesh.position.clone();
    mesh.userData.initialScenePos.x -= shiftX;
    mesh.userData.initialScenePos.y -= shiftY;
    mesh.userData.initialScenePos.z -= shiftZ;

    mesh.userData.templateId = index;

    mesh.material = new THREE.MeshBasicMaterial({
        color: 0x0077ff,
        transparent: true,
        opacity: 0.4,
        depthWrite: false
    });
    mesh.userData.baseColor = 0x0077ff;
    addEdges(mesh, 0x00ffff);

    baseMeshes.push(mesh);
};

const spawnInstance = (templateId, position, scale, isOriginal = false) => {
    const template = baseMeshes[templateId];
    if (!template) return null;

    const instance = template.clone();
    
    instance.children.forEach(child => {
        if (child.isLineSegments) {
            child.raycast = () => {}; 
        }
    });

    instance.material = template.material.clone();
    instance.userData.originalSize = { ...template.userData.originalSize };
    instance.userData.templateId = templateId;
    instance.userData.isOriginal = isOriginal;

    if (position) instance.position.copy(position);
    if (scale) instance.scale.copy(scale);

    if (isOriginal) {
        instance.userData.initialPosition = instance.position.clone();
    }

    updateObjectColor(instance);
    
    scene.add(instance);
    blueBuildings.push(instance);
    return instance;
};


const loadModel = (fileName, setupAction) => {
    loader.load(`./asset/${fileName}`, (gltf) => {
        const model = gltf.scene;
        setupAction(model);
        
        // 【新規追加】断面図用の特殊処理
        // road.glb という名前が含まれていない場合のみ実行
        if (!fileName.includes('road')) {
            model.traverse((child) => {
                if (child.isMesh) {
                    child.material.clippingPlanes = [clipPlane];

                    // 背面メッシュ（ステンシル用）
                    const matBack = child.material.clone();
                    matBack.colorWrite = false; matBack.depthWrite = false; matBack.side = THREE.BackSide;
                    matBack.clippingPlanes = [clipPlane]; matBack.stencilWrite = true; 
                    matBack.stencilFunc = THREE.AlwaysStencilFunc;
                    matBack.stencilZPass = THREE.IncrementWrapStencilOp;
                    
                    const meshBack = new THREE.Mesh(child.geometry, matBack);
                    meshBack.layers.set(LAYER_SECTION);
                    scene.add(meshBack);

                    // 前面メッシュ（ステンシル用）
                    const matFront = child.material.clone();
                    matFront.colorWrite = false; matFront.depthWrite = false; matFront.side = THREE.FrontSide;
                    matFront.clippingPlanes = [clipPlane]; matFront.stencilWrite = true; 
                    matFront.stencilFunc = THREE.AlwaysStencilFunc;
                    matFront.stencilZPass = THREE.DecrementWrapStencilOp;
                    
                    const meshFront = new THREE.Mesh(child.geometry, matFront);
                    meshFront.layers.set(LAYER_SECTION);
                    scene.add(meshFront);
                }
            });
        }

        scene.add(model);
        renderAll();
    }, undefined, (err) => console.error(err));
};

loader.load('./asset/buildings_60m.glb', (gltf) => {
    const model = gltf.scene;
    let index = 0;
    
    model.traverse((child) => {
        if (child.isMesh) {
            setupBaseMesh(child, index++);
        }
    });

    baseMeshes.forEach(base => {
        spawnInstance(base.userData.templateId, base.userData.initialScenePos, new THREE.Vector3(1,1,1), true);
    });

    renderAll();
}, undefined, (err) => console.error(err));


// setupStaticModelでuv1を明示的に取得
const setupStaticModel = (model, color, edgeColor, isTexture = false) => {
    model.traverse((child) => {
        if (child.isMesh) {
            // "uv1" がある場合、それをバックアップ
            if (child.geometry.attributes.uv && child.geometry.attributes.uv1) {
                child.userData.hasUV1 = true;
                child.userData.uv0 = child.geometry.attributes.uv;  // 元のUV (航空写真)
                child.userData.uv1 = child.geometry.attributes.uv1; // 2番目のUV (用途地域)
                child.userData.originalMap = child.material.map; 
            }

            if (isTexture && child.material) {
                child.material = new THREE.MeshBasicMaterial({ map: child.material.map });
            } else {
                child.material = new THREE.MeshBasicMaterial({ color: color });
                if (edgeColor) addEdges(child, edgeColor);
            }
        }
    });
};

loadModel('buildings_static2.glb', (m) => {
    setupStaticModel(m, 0xffffff, 0x999999);
    m.traverse(c => { 
        if(c.isMesh) {
            paintTargets.push(c); 
        }
    });
});

// 1. 京都タワー（外観）
loadModel('kyoto_tower.glb', (m) => {
    towerOuterModel = m; // グローバル変数に格納
    setupStaticModel(m, null, null, true);
    // loadModel関数内で scene.add(model) しているので、ここで再度 scene.add する必要はありません
});

// 2. 展望台（内観）
loadModel('kyoto_tower_inner.glb', (m) => {
    towerInnerModel = m;
    
    // ★内観専用のセットアップ（setupStaticModelは使わない）
    m.traverse((child) => {
        if (child.isMesh) {
            // 元のマテリアルの情報を取得
            const oldMat = child.material;
            
            // MeshBasicMaterial（影なし）に作り直すが、色や透明度は引き継ぐ
            const newMat = new THREE.MeshBasicMaterial({
                color: oldMat.color,      // Blenderの色を引き継ぐ
                map: oldMat.map,          // テクスチャがあれば引き継ぐ
                transparent: oldMat.transparent, // 透明設定を引き継ぐ
                opacity: oldMat.opacity,  // 透明度を引き継ぐ
                side: THREE.DoubleSide,   // ★重要：内側からも見えるように「両面描画」にする
                depthWrite: !oldMat.transparent // 透明なガラスの場合は深度書き込みをオフにする（描画乱れ防止）
            });
            
            child.material = newMat;
        }
    });

    m.visible = false; // 最初は非表示
    
    // 読み込み確認用ログ
    console.log("展望台モデル(inner)の準備完了:", m);
});

loadModel('kyoto_station.glb', (m) => setupStaticModel(m, null, null, true));

// 1. 基本となる地盤のロード
loader.load('./asset/ground.glb', (gltf) => {
    setupStaticModel(gltf.scene, null, null, true);
    scene.add(gltf.scene);
    groundModels.push(gltf.scene);
    
    // 保存
    loadingStatus.grounds['base'] = gltf.scene;
    loadingStatus.baseGroundLoaded = true;

    // もし基本道路が先にロードされていたら投影
    if (loadingStatus.roads['base']) {
        projectRoadToGround(loadingStatus.roads['base'], gltf.scene, 'base');
    }

    checkAllLoaded();
}, undefined, err => console.error(err));

// 2. 基本となる道路のロード
loader.load('./asset/road.glb', (gltf) => {
    gltf.scene.traverse(c => { if(c.isMesh) c.material = roadMaterial; });
    scene.add(gltf.scene);
    
    // 保存
    loadingStatus.roads['base'] = gltf.scene;
    loadingStatus.baseRoadLoaded = true;

    // もし基本地盤が先にロードされていたら投影
    if (loadingStatus.grounds['base']) {
        projectRoadToGround(gltf.scene, loadingStatus.grounds['base'], 'base');
    }

    checkAllLoaded();
}, undefined, err => console.error(err));

// 【修正後】ID付きの地盤と道路のロードとペアリング
targetIds.forEach(id => {
    
    // A. 地盤のロード（マテリアル設定を強化）
    loader.load(`./asset/ground${id}.glb`, (gltf) => {
        const m = gltf.scene;
        
        m.traverse(child => {
            if (child.isMesh) {
                // UV2がある場合の処理（用途地域図用）
                if (child.geometry.attributes.uv && child.geometry.attributes.uv1) {
                    child.userData.hasUV1 = true;
                    child.userData.uv0 = child.geometry.attributes.uv;
                    child.userData.uv1 = child.geometry.attributes.uv1;
                    child.userData.originalMap = child.material.map;
                }

                // ★修正箇所：テクスチャがない場合に透明になるのを防ぐ
                if (child.material && child.material.map) {
                    // テクスチャがあるならそれを使う
                    child.material = new THREE.MeshBasicMaterial({ map: child.material.map });
                } else {
                    // テクスチャがないなら「グレー」で表示する（これで真っ黒/透明を回避）
                    child.material = new THREE.MeshBasicMaterial({ color: 0x555555 });
                }
            }
        });

        scene.add(m);
        groundModels.push(m);
        loadingStatus.grounds[id] = m;
        
        // 道路が先に読み込まれていたら投影実行
        if (loadingStatus.roads[id]) {
            projectRoadToGround(loadingStatus.roads[id], m, id);
        }
        
        checkAllLoaded();
    }, undefined, err => console.error(`Ground${id} Load Error:`, err));

    // B. 道路のロード（既存のまま）
    loader.load(`./asset/road${id}.glb`, (gltf) => {
        const m = gltf.scene;
        m.traverse(c => { if(c.isMesh) c.material = roadMaterial; });
        
        // ★修正前：そのままシーンに追加していた
        // scene.add(m);
        // loadingStatus.roads[id] = m;

        // もし対応する地盤が既にロードされていたら投影実行
        if (loadingStatus.grounds[id]) {
            projectRoadToGround(m, loadingStatus.grounds[id], id);
            
            // ★追加：投影「後」に結合して軽量化
            const optimizedMesh = optimizeRoads(m);
            scene.add(optimizedMesh);
            loadingStatus.roads[id] = optimizedMesh; // 管理用も差し替え
        } else {
            // 地盤がまだの場合は一旦そのまま保存（後で投影時に結合する必要があるため、構造要検討）
            // ※今回はシンプルに「地盤ロード時のコールバック」側でも optimizeRoads を呼ぶように修正が必要です
            scene.add(m);
            loadingStatus.roads[id] = m;
        }
        
        checkAllLoaded();
        
    }, undefined, err => console.error(`Road${id} Load Error:`, err));
    
});


// --- イベントリスナー (元コードの内容を維持) ---

// ウォークモード切替
walkModeBtn.addEventListener('click', () => {
    isWalkMode = !isWalkMode;

    if (isWalkMode) {
        walkModeBtn.classList.add('active');
        walkContainer.style.display = 'flex';
        helpPanel.style.display = 'none';
        walkHelpPanel.style.display = 'block';
        
        menu.style.display = 'none';
        hoveredObject = null;
        document.body.style.cursor = 'crosshair';
        
        const w = walkView.clientWidth;
        const h = walkView.clientHeight;
        walkRenderer.setSize(w, h);
        walkCamera.aspect = w / h;
        walkCamera.updateProjectionMatrix();

    } else {
        walkModeBtn.classList.remove('active');
        walkContainer.style.display = 'none';
        walkHelpPanel.style.display = 'none';
        document.body.style.cursor = 'default';
        pathController.isPlaying = false;
        walkPlayBtn.classList.remove('playing');
        walkPlayBtn.textContent = "▶ 再生";
    }
    renderAll();
});

// ウォークUIイベント
walkPlayBtn.addEventListener('click', () => {
    const playing = pathController.togglePlay();
    if (playing) {
        walkPlayBtn.textContent = "❚❚ 停止";
        walkPlayBtn.classList.add('playing');
    } else {
        walkPlayBtn.textContent = "▶ 再生";
        walkPlayBtn.classList.remove('playing');
    }
});
walkClearBtn.addEventListener('click', () => {
    pathController.undo();
});
walkTensionSlider.addEventListener('input', (e) => {
    pathController.setTension(parseFloat(e.target.value));
});
walkProgressSlider.addEventListener('input', (e) => {
    pathController.progress = parseFloat(e.target.value);
    pathController.applyPosition(pathController.progress);
    renderAll();
});


duplicateBtn.addEventListener('click', () => {
    if (!selectedObject) return;
    
    const tid = selectedObject.userData.templateId;
    const currentScale = selectedObject.scale.clone();
    const currentComment = selectedObject.userData.comment;

    const newPos = selectedObject.position.clone();
    newPos.x += 10; 
    newPos.z += 10;

    const newMesh = spawnInstance(tid, newPos, currentScale, false);
    if (currentComment) newMesh.userData.comment = currentComment;

    if (groundModels.length > 0) {
        const rayOrigin = new THREE.Vector3(newMesh.position.x, 1000, newMesh.position.z);
        downRaycaster.set(rayOrigin, downDirection);
        const hits = downRaycaster.intersectObjects(groundModels, true);
        if (hits.length > 0) {
            newMesh.position.y = hits[0].point.y;
        } else {
            newMesh.position.y = 0;
        }
    }
    updateObjectColor(newMesh);
    menu.style.display = 'none';
    renderAll();
});

deleteBtn.addEventListener('click', () => {
    if (!selectedObject) return;
    scene.remove(selectedObject);
    const index = blueBuildings.indexOf(selectedObject);
    if (index > -1) blueBuildings.splice(index, 1);
    if (selectedObject.material) selectedObject.material.dispose();
    selectedObject = null;
    hoveredObject = null;
    menu.style.display = 'none';
    document.body.style.cursor = 'default';
    commentTooltip.style.display = 'none';
    renderAll();
});

resetBtn.addEventListener('click', () => {
    for (let i = blueBuildings.length - 1; i >= 0; i--) {
        scene.remove(blueBuildings[i]);
        if (blueBuildings[i].material) blueBuildings[i].material.dispose();
    }
    blueBuildings = [];

    baseMeshes.forEach(base => {
        spawnInstance(base.userData.templateId, base.userData.initialScenePos, new THREE.Vector3(1,1,1), true);
    });

    menu.style.display = 'none';
    renderAll();
});


saveBtn.addEventListener('click', () => {
    const data = {
        format: 'kyoto-sim-data-v1',
        camera: {
            position: camera.position.toArray(),
            target: controls.target.toArray()
        },
        buildings: blueBuildings.map(b => ({
            templateId: b.userData.templateId,
            position: b.position.toArray(),
            scale: b.scale.toArray(),
            originalSize: b.userData.originalSize,
            isOriginal: b.userData.isOriginal,
            initialPosition: b.userData.initialPosition ? b.userData.initialPosition.toArray() : null,
            comment: b.userData.comment 
        })),
        subCameras: dynamicSubCameras.map(dc => ({
            position: dc.camera.position.toArray(),
            target: dc.target.toArray()
        }))
    };

    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const now = new Date();
    const dateStr = now.getFullYear() +
        ('0' + (now.getMonth() + 1)).slice(-2) +
        ('0' + now.getDate()).slice(-2) + '_' +
        ('0' + now.getHours()).slice(-2) +
        ('0' + now.getMinutes()).slice(-2);
        
    const a = document.createElement('a');
    a.href = url;
    a.download = `kyoto_sim_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

loadBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (!data.format || data.format !== 'kyoto-sim-data-v1') {
                alert('このファイルは京都シミュレーターのデータではありません。');
                fileInput.value = '';
                return;
            }

            for (let i = blueBuildings.length - 1; i >= 0; i--) {
                scene.remove(blueBuildings[i]);
                if (blueBuildings[i].material) blueBuildings[i].material.dispose();
            }
            blueBuildings = [];

            if (data.camera) {
                camera.position.set(data.camera.position[0], data.camera.position[1], data.camera.position[2]);
                controls.target.set(data.camera.target[0], data.camera.target[1], data.camera.target[2]);
                camera.updateProjectionMatrix();
                controls.update(); 
            }

            if (data.buildings) {
                data.buildings.forEach(bData => {
                    const pos = new THREE.Vector3().fromArray(bData.position);
                    const scl = new THREE.Vector3().fromArray(bData.scale);
                    const mesh = spawnInstance(bData.templateId, pos, scl, bData.isOriginal);
                    if (mesh) {
                        mesh.userData.originalSize = bData.originalSize;
                        if (bData.initialPosition) {
                            mesh.userData.initialPosition = new THREE.Vector3().fromArray(bData.initialPosition);
                        }
                        if (bData.comment) mesh.userData.comment = bData.comment;
                        updateObjectColor(mesh);
                    }
                });
            }

            while(dynamicSubCameras.length > 0) {
                removeDynamicCamera(dynamicSubCameras[0]);
            }
            if (data.subCameras) {
                data.subCameras.forEach(camData => {
                    const pos = new THREE.Vector3().fromArray(camData.position);
                    const tgt = new THREE.Vector3().fromArray(camData.target);
                    addDynamicCamera(pos, tgt);
                });
            }
            
            fileInput.value = '';
            renderAll();
            alert('読み込みが完了しました');
        } catch (err) {
            console.error(err);
            alert('ファイルの読み込みに失敗しました');
        }
    };
    reader.readAsText(file);
});


// 1. マウス移動
window.addEventListener('pointermove', (event) => {
    if (isWalkMode) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    // ★追加：カメラ操作中（マウスボタン押下中）はホバー計算をスキップして負荷を下げる
    if (event.buttons !== 0 && !isDragging) {
        return; 
    }

    // A. ドラッグ中の処理
    if (isDragging && selectedObject) {
        commentTooltip.style.display = 'none';

        raycaster.setFromCamera(mouse, camera);
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, intersectPoint);
        
        if (intersectPoint) {
            let newX = intersectPoint.x - dragOffset.x;
            let newZ = intersectPoint.z - dragOffset.z;

            if (event.shiftKey) {
                const diffX = newX - dragStartPosition.x;
                const diffZ = newZ - dragStartPosition.z;
                if (Math.abs(diffX) > Math.abs(diffZ)) {
                    newZ = dragStartPosition.z;
                } else {
                    newX = dragStartPosition.x;
                }
            }

            let newY = selectedObject.position.y;
            if (groundModels.length > 0) {
                const rayOrigin = new THREE.Vector3(newX, 1000, newZ);
                downRaycaster.set(rayOrigin, downDirection);
                const hits = downRaycaster.intersectObjects(groundModels, true);
                if (hits.length > 0) {
                    newY = hits[0].point.y;
                }
            }
            
            if (selectedObject.position.x !== newX || selectedObject.position.z !== newZ || selectedObject.position.y !== newY) {
                selectedObject.position.set(newX, newY, newZ);
                
                const totalDiffX = newX - dragStartPosition.x;
                const totalDiffZ = newZ - dragStartPosition.z;
                const textX = Math.abs(totalDiffX) < 0.1 ? 
                    '東西移動なし' : 
                    (totalDiffX > 0 ? `東へ ${totalDiffX.toFixed(1)}m` : `西へ ${Math.abs(totalDiffX).toFixed(1)}m`);
                const textZ = Math.abs(totalDiffZ) < 0.1 ? 
                    '南北移動なし' :
                    (totalDiffZ > 0 ? `南へ ${totalDiffZ.toFixed(1)}m` : `北へ ${Math.abs(totalDiffZ).toFixed(1)}m`);
                
                moveInfo.style.display = 'block';
                moveInfo.style.left = event.clientX + 'px';
                moveInfo.style.top = event.clientY + 'px';
                moveInfo.innerHTML = `${textX}<br>${textZ}`;
                
                renderAll();
            }
        }
        return;
    }

    // B. ホバー判定
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(blueBuildings);
    let needsRender = false;

    if (intersects.length > 0) {
        const obj = intersects[0].object;
        if (obj !== hoveredObject) {
            if (hoveredObject) {
                hoveredObject.material.color.setHex(hoveredObject.userData.baseColor);
                hoveredObject.material.opacity = 0.4;
            }
            hoveredObject = obj;
            
            const hoverColor = getHoverColor(hoveredObject.userData.baseColor);
            hoveredObject.material.color.setHex(hoverColor);
            hoveredObject.material.opacity = 0.6;
            
            document.body.style.cursor = 'move';
            helpPanel.style.display = 'block';
            
            needsRender = true;
        }

        if (hoveredObject && hoveredObject.userData.comment) {
            commentTooltip.style.display = 'block';
            commentTooltip.innerText = hoveredObject.userData.comment;
            commentTooltip.style.left = event.clientX + 'px';
            commentTooltip.style.top = event.clientY + 'px';
        } else {
            commentTooltip.style.display = 'none';
        }

    } else {
        if (hoveredObject) {
            hoveredObject.material.color.setHex(hoveredObject.userData.baseColor);
            hoveredObject.material.opacity = 0.4;
            hoveredObject = null;
            document.body.style.cursor = 'default';
            helpPanel.style.display = 'none';
            commentTooltip.style.display = 'none'; 
            
            needsRender = true;
        }
    }

    if (needsRender) renderMain();
});

// 2. 左クリック
window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;

    if (document.pointerLockElement === document.body) {
        shootPaint();
        return; 
    }

    if (isWalkMode) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        pathController.handleClick(mouse, camera);
        return;
    }

    if (hoveredObject) {
        isDragging = true;
        selectedObject = hoveredObject;
        controls.enabled = false;
        dragStartPosition.copy(selectedObject.position);
        
        dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), selectedObject.position);

        raycaster.setFromCamera(mouse, camera);
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, intersectPoint);
        if (intersectPoint) {
            dragOffset.copy(intersectPoint).sub(selectedObject.position);
            dragOffset.y = 0; 
        }
        if (menu.style.display !== 'none') {
            menu.style.display = 'none';
            renderMain();
        }
        commentTooltip.style.display = 'none';
    }
});

window.addEventListener('pointerup', () => {
    isDragging = false;
    if (document.pointerLockElement !== document.body) {
        controls.enabled = true;
    }
    if (moveInfo.style.display !== 'none') {
        moveInfo.style.display = 'none';
    }
});

// 4. 右クリック
window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (isWalkMode || document.pointerLockElement === document.body) return; 

    if (hoveredObject) {
        selectedObject = hoveredObject;

        const original = selectedObject.userData.originalSize;
        const currentScale = selectedObject.scale;

        const w = original.x * currentScale.x;
        const d = original.z * currentScale.z;
        const h = original.y * currentScale.y;

        inputW.value = w; valW.textContent = w.toFixed(1) + 'm';
        inputD.value = d; valD.textContent = d.toFixed(1) + 'm';
        
        let closestIndex = 0;
        let minDiff = Infinity;
        heightSteps.forEach((val, index) => {
            const diff = Math.abs(val - h);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = index;
            }
        });
        inputH.value = closestIndex;
        valH.textContent = heightSteps[closestIndex].toFixed(1) + 'm';

        inputComment.value = selectedObject.userData.comment || '';

        menu.style.display = 'block';
        menu.style.left = event.clientX + 'px';
        menu.style.top = event.clientY + 'px';
        
        commentTooltip.style.display = 'none';
    } else {
        if (menu.style.display !== 'none') {
            menu.style.display = 'none';
        }
    }
});

inputComment.addEventListener('input', () => {
    if (selectedObject) {
        selectedObject.userData.comment = inputComment.value;
    }
});


// --- UI操作 ---
const updateSize = () => {
    if (!selectedObject) return;
    const original = selectedObject.userData.originalSize;
    
    const w = parseFloat(inputW.value);
    const d = parseFloat(inputD.value);
    const stepIndex = parseInt(inputH.value);
    const h = heightSteps[stepIndex];

    valW.textContent = w.toFixed(1) + 'm';
    valD.textContent = d.toFixed(1) + 'm';
    valH.textContent = h.toFixed(1) + 'm';
    
    selectedObject.scale.set(w / original.x, h / original.y, d / original.z);

    if (groundModels.length > 0) {
        const pos = selectedObject.position;
        const rayOrigin = new THREE.Vector3(pos.x, 1000, pos.z);
        downRaycaster.set(rayOrigin, downDirection);
        const hits = downRaycaster.intersectObjects(groundModels, true);
        if (hits.length > 0) {
            selectedObject.position.y = hits[0].point.y;
        }
    }
    
    updateObjectColor(selectedObject);
    renderAll();
};

inputW.addEventListener('input', updateSize);
inputD.addEventListener('input', updateSize);
inputH.addEventListener('input', updateSize);

closeBtn.addEventListener('click', () => {
    menu.style.display = 'none';
});

// リサイズ処理を関数化
const updateAllRenderers = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    if(fixedSubContainer.clientWidth && fixedSubContainer.clientHeight) {
        fixedSubRenderer.setSize(fixedSubContainer.clientWidth, fixedSubContainer.clientHeight);
        fixedSubCamera.aspect = 4/3;
        fixedSubCamera.updateProjectionMatrix();
        fixedHelperCam.aspect = 4/3;
        fixedHelperCam.updateProjectionMatrix();
        fixedHelper.update();
    }

    dynamicSubCameras.forEach(dc => {
        const w = dc.div.clientWidth;
        const h = dc.div.clientHeight;
        if(w && h) {
            dc.renderer.setSize(w, h);
            dc.camera.aspect = 4/3;
            dc.camera.updateProjectionMatrix();
            dc.helperCam.aspect = 4/3;
            dc.helperCam.updateProjectionMatrix();
            dc.helper.update();
        }
    });

    if (walkView.clientWidth && walkView.clientHeight) {
        walkRenderer.setSize(walkView.clientWidth, walkView.clientHeight);
        walkCamera.aspect = walkView.clientWidth / walkView.clientHeight;
        walkCamera.updateProjectionMatrix();
        walkHelperCam.aspect = walkCamera.aspect;
        walkHelperCam.updateProjectionMatrix();
        walkHelper.update();
    }

    renderAll();
};

window.addEventListener('resize', updateAllRenderers);


// ハンドルのドラッグ処理
let isResizingPanel = false;

resizeHandle.addEventListener('pointerdown', (e) => {
    isResizingPanel = true;
    resizeHandle.classList.add('active');
    document.body.style.cursor = 'row-resize';
    e.preventDefault(); 
});

window.addEventListener('pointermove', (e) => {
    if (!isResizingPanel) return;

    let newHeight = window.innerHeight - e.clientY;
    const minH = 100;
    const maxH = window.innerHeight * 0.8;
    
    if (newHeight < minH) newHeight = minH;
    if (newHeight > maxH) newHeight = maxH;

    subViewPanel.style.height = newHeight + 'px';
    updateAllRenderers();
});

window.addEventListener('pointerup', () => {
    if (isResizingPanel) {
        isResizingPanel = false;
        resizeHandle.classList.remove('active');
        document.body.style.cursor = 'default';
    }
});


// ★追加：道路設定のリアルタイム反映（ファイルの末尾付近でも確実に動作するように定義）
roadColorPicker.addEventListener('input', (e) => {
    roadMaterial.color.set(e.target.value);
    renderAll();
});

roadOpacitySlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    roadMaterial.opacity = val;
    roadOpacityVal.textContent = val.toFixed(2);
    roadMaterial.visible = (val > 0);
    renderAll();
});


// ==========================================
// 11. ペンキ・デカール関連
// ==========================================

function createPaintTexture(baseHue) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const centerBlobs = 15;
    for (let i = 0; i < centerBlobs; i++) {
        const radius = (Math.random() * 0.2 + 0.1) * size;
        const x = size / 2 + (Math.random() - 0.5) * size * 0.4;
        const y = size / 2 + (Math.random() - 0.5) * size * 0.4;
        const hue = baseHue + (Math.random() - 0.5) * 60; 
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
        ctx.fill();
    }

    const droplets = 30;
    for (let i = 0; i < droplets; i++) {
        const radius = (Math.random() * 0.05 + 0.01) * size;
        const angle = Math.random() * Math.PI * 2;
        const dist = (Math.random() * 0.3 + 0.2) * size;
        const x = size / 2 + Math.cos(angle) * dist;
        const y = size / 2 + Math.sin(angle) * dist;
        const isAccent = Math.random() > 0.7;
        const hue = isAccent ? (baseHue + 180) % 360 : baseHue + (Math.random() - 0.5) * 40;
        
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${hue}, 100%, 70%)`;
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function createDecal(hit, baseHue) {
    const orientation = new THREE.Euler();
    const m = new THREE.Matrix4();
    m.lookAt(hit.point, hit.point.clone().add(hit.face.normal), new THREE.Vector3(0, 1, 0));
    orientation.setFromRotationMatrix(m);
    orientation.z = Math.random() * Math.PI * 2; 

    const scale = 200; 
    const size = new THREE.Vector3(scale, scale, scale);

    const material = new THREE.MeshBasicMaterial({
        map: createPaintTexture(baseHue),
        transparent: true,
        opacity: 0.9,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4, 
    });

    paintTargets.forEach(target => {
        const geometry = new DecalGeometry(target, hit.point, orientation, size);
        if (geometry.attributes.position.count > 0) {
            const decal = new THREE.Mesh(geometry, material);
            scene.add(decal);
        }
    });
}

function shootPaint() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects([...paintTargets, ...groundModels], true);

    if (intersects.length > 0) {
        const hit = intersects[0];
        const baseHue = Math.random() * 360;
        
        const ballGeometry = new THREE.SphereGeometry(6, 16, 16); 
        const ballMaterial = new THREE.MeshBasicMaterial({ color: `hsl(${baseHue}, 100%, 50%)` });
        const ball = new THREE.Mesh(ballGeometry, ballMaterial);
        
        const startPos = new THREE.Vector3(0, -2, -5).applyQuaternion(camera.quaternion).add(camera.position);
        ball.position.copy(startPos);
        scene.add(ball);

        projectiles.push({
            mesh: ball,
            targetPos: hit.point,
            speed: 15.0, 
            hitData: hit,
            baseHue: baseHue
        });
    }
}

// FキーでPointerLock
window.addEventListener('keydown', (event) => {
    if (event.key === 'f' || event.key === 'F') {
        if (document.pointerLockElement !== document.body) {
            document.body.requestPointerLock();
        } else {
            document.exitPointerLock();
        }
    }
});

// PointerLockの状態変化イベント
document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === document.body) {
        isAiming = true;
        
        // ★修正点1：完全にコントロールを無効化
        controls.enabled = false;
        
        crosshair.style.display = 'block';
        aimHint.style.display = 'block';
    } else {
        isAiming = false;
        
        const lookDistance = camera.position.distanceTo(controls.target); // 以前の距離を維持
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        
        controls.target.copy(camera.position).add(forward.multiplyScalar(lookDistance));
        
        controls.enabled = true;
        
        // ★修正点3：強制的に内部状態を更新して、ガタつき（Jump）を防止
        controls.update(); 
        
        crosshair.style.display = 'none';
        aimHint.style.display = 'none';
    }
});

// エイム中の視点移動
document.addEventListener('mousemove', (event) => {
    if (isAiming) {
        const sensitivity = 0.002;
        const euler = new THREE.Euler(0, 0, 0, 'YXZ');
        euler.setFromQuaternion(camera.quaternion);

        euler.y -= event.movementX * sensitivity;
        euler.x -= event.movementY * sensitivity;
        euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));

        camera.quaternion.setFromEuler(euler);
        renderAll();
    }
});

// 地図切り替え処理（UV入れ替えとテクスチャ差し替え）
mapSwitchBtn.addEventListener('click', () => {
    isZoningMapMode = !isZoningMapMode;
    
    if (isZoningMapMode) {
        mapSwitchBtn.classList.add('active');
        mapSwitchBtn.textContent = "🗺️ 用途地域";
    } else {
        mapSwitchBtn.classList.remove('active');
        mapSwitchBtn.textContent = "🗺️ 航空写真";
    }

    groundModels.forEach(model => {
        model.traverse(child => {
            if (child.isMesh && child.userData.hasUV1) {
                if (isZoningMapMode) {
                    // 用途地域モード
                    child.geometry.setAttribute('uv', child.userData.uv1);
                    child.material.map = zoningTexture; 
                } else {
                    // 航空写真モード
                    child.geometry.setAttribute('uv', child.userData.uv0);
                    child.material.map = child.userData.originalMap; 
                }
                
                child.geometry.attributes.uv.needsUpdate = true;
                child.material.needsUpdate = true; 
            }
        });
    });
    
    renderAll();
});


// ==========================================
// ★完成版：OSM建物名表示（優先順位付き・種別フィルター実装）
// ==========================================

function fetchAndShowBuildingNames() {
    console.log("ローカルのOSMデータから建物名を表示します...");

    const OFFSET_X = -75;
    const OFFSET_Z = -180;
    const centerLat = 34.98755; 
    const centerLon = 135.75922;

    // 外部APIではなく、assetフォルダ内のJSONファイルを読み込む
    fetch('./asset/osm_data.json')
        .then(response => {
            if (!response.ok) throw new Error("JSONファイルが見つかりません。asset/osm_data.jsonを確認してください。");
            return response.json();
        })
        .then(data => {
            console.log(`データ読み込み完了: ${data.elements.length} 件`);
            createNameLabelsFinal(data.elements, centerLat, centerLon, OFFSET_X, OFFSET_Z);
        })
        .catch(err => {
            console.error("OSM表示エラー:", err);
            // ファイルがない場合やエラー時は、もう一度だけAPI試行するなどのバックアップも可能
        });
}

// ==========================================
// ★最終修正版：重複エラー解消 & 地盤判定の強制強化
// ==========================================

function createNameLabelsFinal(elements, centerLat, centerLon, offsetX, offsetZ) {
    const TEXT_SCALE = 0.24; // 2倍の大きさ
    const LABEL_OFFSET_Y = 10; 
    const CHECK_DIST = 30; // 重なり防止距離を調整

    // ■ 除外リスト
    const ignoreNames = ["京都", "下京区", "京都市", "京都駅前", "公衆トイレ", "自動販売機", "Bus Stop", "駐車場", "Times", "Entry", "Exit"];
    
    // ■ 優先キーワード（ホテルをここに含めます）
    const priorityKeywords = ["ニデック", "京都タワー", "ホテル", "Hotel", "旅館", "通", "大路", "小路", "警察", "消防", "役所", "ビル"];

    // ■ カテゴリ除外（飲食店・ショップを排除）
    const excludeTypes = {
        amenity: ["restaurant", "cafe", "fast_food", "bar", "pub", "izakaya", "vending_machine", "bench", "parking", "bicycle_parking", "toilets"],
        shop: true, 
        tourism: ["guest_house", "information"] // ホテルは除外しない
    };

    // ソート：ホテルやニデックを最優先
    elements.sort((a, b) => {
        const nameA = a.tags.name || "";
        const nameB = b.tags.name || "";
        const getPriority = (n) => {
            if (n.includes("ニデック") || n.includes("京都タワー")) return 100;
            for (const key of priorityKeywords) { if (n.includes(key)) return 10; }
            return 0;
        };
        return getPriority(nameB) - getPriority(nameA); 
    });

    const labelGroup = new THREE.Group();
    // ★重要：グループ全体をレイヤー1に設定（サブカメラから隠すため）
    labelGroup.layers.set(1); 
    scene.add(labelGroup);

    // (中略: メッシュ収集・Raycaster設定は既存のまま)
    const targetObjects = [];
    scene.traverse(obj => {
        if (obj.isMesh) {
            const n = (obj.name || "").toLowerCase();
            if (!n.includes("label") && !n.includes("line") && !n.includes("sprite")) targetObjects.push(obj);
        }
    });

    const raycaster = new THREE.Raycaster();
    if (typeof camera !== 'undefined') raycaster.camera = camera;
    const placedLabels = []; 

    elements.forEach(el => {
        if (!el || !el.tags || !el.tags.name) return;
        const name = el.tags.name;
        const t = el.tags;

        // フィルタリング
        if (ignoreNames.some(ng => name.includes(ng))) return;
        if (excludeTypes.shop === true && t.shop && !["department_store", "mall"].includes(t.shop)) return;
        if (t.amenity && excludeTypes.amenity.includes(t.amenity)) return;
        if (t.tourism && excludeTypes.tourism.includes(t.tourism)) return;

        const lat = el.lat || (el.center && el.center.lat);
        const lon = el.lon || (el.center && el.center.lon);
        if (lat === undefined || lon === undefined) return;

        const x = (lon - centerLon) * 91000 + offsetX;
        const z = -(lat - centerLat) * 111000 + offsetZ;

        if (placedLabels.some(item => Math.sqrt((item.x - x) ** 2 + (item.z - z) ** 2) < CHECK_DIST)) return;

        // 高さ判定
        let groundY = 0;
        if (targetObjects.length > 0) {
            targetObjects.forEach(obj => obj.updateMatrixWorld());
            raycaster.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
            const intersects = raycaster.intersectObjects(targetObjects, true);
            if (intersects.length > 0) {
                let maxY = -Infinity;
                intersects.forEach(hit => { if (hit.point.y > maxY) maxY = hit.point.y; });
                groundY = maxY;
            }
        }
        
        groundY = Math.max(0, groundY); 
        const pinTopY = groundY + LABEL_OFFSET_Y;

        // --- 描画（ピンとスプライト） ---
        const isStreet = name.includes("通") || name.includes("大路");
        
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, groundY, z), new THREE.Vector3(x, pinTopY, z)]),
            new THREE.LineBasicMaterial({ color: isStreet ? 0xffaa00 : 0x00ffff, transparent: true, opacity: 0.5 })
        );
        // ★各パーツもレイヤー1に
        line.layers.set(1); 
        labelGroup.add(line);

        const sprite = createTextSpriteHQ(name);
        sprite.scale.multiplyScalar(TEXT_SCALE);
        sprite.position.set(x, pinTopY + 2, z); 
        // ★ラベルもレイヤー1に
        sprite.layers.set(1); 
        labelGroup.add(sprite);

        placedLabels.push({ name, x, z });
    });
    renderAll();
}

// 確実に文字を出すための関数（これがないとエラーになります）
function createTextSpriteHQ(message) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 42;
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textWidth = ctx.measureText(message).width;
    
    const padding = 15;
    canvas.width = textWidth + padding * 2;
    canvas.height = fontSize + padding * 2;
    
    // 背景
    ctx.fillStyle = "rgba(0, 20, 50, 0.8)";
    ctx.strokeStyle = "rgba(0, 255, 255, 0.9)";
    ctx.lineWidth = 4;
    
    // 角丸の描画（roundRect関数を呼び出し）
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 10);
    ctx.fill();
    ctx.stroke();
    
    // 文字
    ctx.fillStyle = "white";
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(canvas.width * 0.5, canvas.height * 0.5, 1);
    return sprite;
}

// Canvasで角丸四角形を描く補助関数
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// 既存の即時実行は削除し、ロード完了を待つ5秒後の1回だけに絞る
setTimeout(() => {
    console.log("5秒経過：建物名の配置を開始します...");
    fetchAndShowBuildingNames();
}, 5000);


// --- 展望台モード切り替え処理 ---
document.getElementById('tower-btn').addEventListener('click', () => {
    isTowerMode = !isTowerMode;

    if (isTowerMode) {
        // === 展望台モード ON ===
        savedCameraState.position.copy(camera.position);
        savedCameraState.target.copy(controls.target);

        if (towerOuterModel) towerOuterModel.visible = false;
        if (towerInnerModel) towerInnerModel.visible = true;

        // 1. 初期角度の設定（0ラジアン＝東からスタート）
        towerAngle = 0;

        // 2. カメラ位置を「半径4m」の位置にセット
        // TOWER_VIEW_POS は展望台の中心座標とします
        camera.position.set(
            TOWER_VIEW_POS.x + 2, // 半径4m (X軸プラス方向)
            TOWER_VIEW_POS.y, 
            TOWER_VIEW_POS.z
        );

        // 3. ターゲット（視線）を「カメラの少し外側」にセット
        // これにより、最初は「外」を向いた状態になります
        controls.target.set(
            TOWER_VIEW_POS.x + 6, // カメラよりさらに外側
            TOWER_VIEW_POS.y,
            TOWER_VIEW_POS.z
        );

        // 4. 操作制限（移動禁止・回転のみ許可）
        controls.enablePan = false;  // 平行移動禁止
        controls.enableZoom = false; // ズーム禁止（壁抜け防止）
        controls.enableRotate = false; // ★回転も禁止
        // ※カメラ位置とターゲットの初期配置は animate で即座に上書きされるため省略可ですが、
        //   一瞬のチラつき防止のためにセットしておきます
        const radius = 4.0;
        const lookDist = 50.0;
        camera.position.set(TOWER_VIEW_POS.x + radius, TOWER_VIEW_POS.y, TOWER_VIEW_POS.z);
        controls.target.set(TOWER_VIEW_POS.x + radius + lookDist, TOWER_VIEW_POS.y - 15, TOWER_VIEW_POS.z);        

        controls.update();
        document.getElementById('tower-btn').innerText = "❌ 展望台を降りる";
        
    } else {
        // === 展望台モード OFF ===
        if (towerOuterModel) towerOuterModel.visible = true;
        if (towerInnerModel) towerInnerModel.visible = false;

        camera.position.copy(savedCameraState.position);
        controls.target.copy(savedCameraState.target);
        
        // 設定を元に戻す
        controls.enablePan = true;
        controls.enableZoom = true;
        controls.enableRotate = true; // 回転許可
        controls.rotateSpeed = 1.0; // 元の速度

        controls.update();
        document.getElementById('tower-btn').innerText = "🗼 展望台モード";
    }
});


// カメラの移動範囲を円柱状に制限する関数
function clampCameraPosition(center, maxRadius) {
    if (!isTowerMode) return; // 展望台モード以外は何もしない

    // 現在のカメラ位置と中心点との距離（水平距離）を計算
    const dx = camera.position.x - center.x;
    const dz = camera.position.z - center.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // 半径5mを超えていたら押し戻す
    if (distance > maxRadius) {
        const ratio = maxRadius / distance;
        camera.position.x = center.x + dx * ratio;
        camera.position.z = center.z + dz * ratio;
    }

    // 高さ（Y）も一定範囲に固定するとより安全（床を突き抜けないように）
    // 例: 中心の高さ ±1m 以内
    // if (Math.abs(camera.position.y - center.y) > 1.0) {
    //     camera.position.y = center.y; 
    // }
}


// ----------------------------------------------------------------
// アニメーションループ
// ----------------------------------------------------------------

function animate() {
    requestAnimationFrame(animate);
    
    // ★エイム（PointerLock）中でない時だけ OrbitControls を更新する
    if (!isAiming) {
        controls.update();
    }
    
    // ペンキ球の更新（既存のまま）
    if (projectiles.length > 0) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            const direction = new THREE.Vector3().subVectors(p.targetPos, p.mesh.position).normalize();
            const distance = p.mesh.position.distanceTo(p.targetPos);
            
            if (distance < p.speed) {
                createDecal(p.hitData, p.baseHue);
                scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                projectiles.splice(i, 1);
                renderAll(); 
            } else {
                p.mesh.position.add(direction.multiplyScalar(p.speed));
                renderAll(); 
            }
        }
    }
    
    // ウォークモードや展望台モードの更新（既存のまま）
    if (isWalkMode && pathController.isPlaying) {
        pathController.update();
        renderAll();
    }
    // 展望台モードがある場合はここに controls.update() が必要ですが、
    // isAiming と排他制御にすれば問題ありません。
}


animate();

renderAll();