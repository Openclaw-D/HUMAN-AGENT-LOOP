"use client";

// V6 远程尽调 · 本地拍照/预览面板（R2_CAMERA 冻结件接入，B 版本化契约 v0.2.0-r2-candidate）。
// 底线（不变）：用户主动触发；不自动摄录；只申请视频轨道（不申请麦克风）；
// 原始文件只做本地预览（object URL），不上传、不持久化、不提交模型；
// 浏览器回退图库时如实说明"来源未知"；"原件"仅指本应用收到的文件——不证明设备/现场真实性。
// R2 变更：淘汰面板内手写 getUserMedia/takePhoto，全部动作经 lib/v5-preview/camera 的
// CameraController（不留第二条执行路径）：
// - single 模式（默认）：拍完（成功或失败）控制器自动停轨并回调 onStream(null)；再拍须重新点"开启"；
// - 连续拍摄为构造依赖 captureMode:'continuous'，须用户显式开启（切换=dispose 旧实例+重建）；
// - 每张照片带 lifecycle 标注：capture_confirmed / user_cancelled / discarded / session_hangup；
//   面板"收起"仅隐藏界面（CSS/hidden），不改变生命周期、不停轨、不释放预览；
// - track/URL 全部由控制器拥有：面板只做 onStream(null) 清空 video、pagehide→dispose，
//   不自行 createObjectURL/revokeObjectURL。
import { useEffect, useRef, useState } from 'react';
import {
  CameraController,
  CAMERA_CONTROLLER_VERSION,
  buildResourceReceipt,
} from '../../../lib/v5-preview/camera/camera-controller.mjs';
import styles from './se-interview.module.css';

// 结构化视图类型（与 INTEGRATION.md §4/§5 冻结字段对应；.mjs 零依赖无 @types，不加类型包）。
interface CameraCapsView {
  secureContext: boolean | null;
  getUserMedia: string;
  imageCapture: string;
  liveCameraSupported: boolean;
  takePhotoSupported: boolean;
}

interface CameraSnapshotView {
  state: string;
  hasLiveStream: boolean;
  activePreviewId: string | null;
}

interface CameraPreviewView {
  id: string;
  url: string | null;
  mime: string;
  byteLength: number;
  width: number | null;
  height: number | null;
  sourceMethod: string;
  captureHint: { capture: string } | null;
  capturedAt: null;
  provenance: string;
}

interface ControllerResultView {
  ok: boolean;
  code?: string;
}

/** P2 语义映射：照片/预览对象生命周期标注（终端态；当前预览另有"待确认"中间态）。 */
type LifecycleLabel = 'capture_confirmed' | 'user_cancelled' | 'discarded' | 'session_hangup';

const LIFECYCLE_LABELS: Record<LifecycleLabel, string> = {
  capture_confirmed: '已确认保留',
  user_cancelled: '用户取消',
  discarded: '证据作废/清除',
  session_hangup: '挂断/离页自动释放',
};

const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  requesting: '等待摄像头授权…',
  ready: '取景中',
  capturing: '拍照中…',
  preview: '已拍照（预览待保存）',
  denied: '权限被拒',
  unsupported: '环境不支持直开摄像头',
  error: '出错',
  disposed: '已释放',
};

interface LifecycleRecord {
  id: number;
  at: string;
  label: LifecycleLabel;
  text: string;
}

/** 来源标注：capture 提示只作记录，浏览器返回图库时来源未知——不写"已现场拍摄"。 */
function sourceLabel(p: CameraPreviewView): string {
  if (p.sourceMethod === 'live_camera_takephoto') return '相机单次曝光（takePhoto）';
  if (p.captureHint) return '系统拍照/选图（capture 提示，仅记录）';
  return '图库选择（来源未知，未验证现场）';
}

export default function CameraPanel() {
  const controllerRef = useRef<CameraController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileMetaRef = useRef<{ name: string; lastModified: number | null } | null>(null);
  const decisionRef = useRef<'pending' | 'confirmed' | null>(null);
  const recordSeqRef = useRef(0);

  const [snap, setSnap] = useState<CameraSnapshotView | null>(null);
  const [caps, setCaps] = useState<CameraCapsView | null>(null); // 用户点击后才检测
  const [preview, setPreview] = useState<CameraPreviewView | null>(null);
  const [decision, setDecision] = useState<'pending' | 'confirmed' | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; lastModified: number | null } | null>(null);
  const [records, setRecords] = useState<LifecycleRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [continuous, setContinuous] = useState(false); // 默认 single：拍完自动关轨
  const [collapsed, setCollapsed] = useState(false);

  function logLifecycle(label: LifecycleLabel, text: string) {
    recordSeqRef.current += 1;
    const entry: LifecycleRecord = { id: recordSeqRef.current, at: new Date().toLocaleTimeString(), label, text };
    setRecords((prev) => [entry, ...prev].slice(0, 30));
  }

  /** 控制器交付/清空取景流：页面只负责挂/卸 video（muted+playsInline），无流即清空。 */
  function attachStream(stream: MediaStream | null) {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }

  // captureMode 是构造依赖：运行时切换模式=dispose 旧实例+按新模式重建。
  function buildController(captureMode: 'single' | 'continuous') {
    return new CameraController({
      captureMode,
      onStateChange: (s: CameraSnapshotView) => setSnap(s),
      onPreview: (p: CameraPreviewView) => {
        // 新预览就绪时，上一预览的 URL 已被控制器撤销——按上一张的决策状态落 lifecycle 标注。
        if (decisionRef.current === 'confirmed') {
          logLifecycle('discarded', '已确认保留的照片被新拍摄/选图替换：旧预览 URL 已被控制器撤销，证据不再可用。');
        } else if (decisionRef.current === 'pending') {
          logLifecycle('user_cancelled', '未确认的照片被新拍摄/选图取代：用户未确认保留，按用户取消处理。');
        }
        decisionRef.current = 'pending';
        setDecision('pending');
        setPreview(p);
        if (p.sourceMethod === 'file_picker' && fileMetaRef.current) setFileMeta({ ...fileMetaRef.current });
        else setFileMeta(null);
        fileMetaRef.current = null;
      },
      onError: (e: { code: string; message: string }) => setNotice(e.message),
      onStream: (stream: MediaStream | null) => attachStream(stream),
    });
  }

  /** 用新控制器重建后的快照回填（重建不会自动触发 onStateChange）。 */
  function rebuild(captureMode: 'single' | 'continuous') {
    controllerRef.current?.dispose();
    const next = buildController(captureMode);
    controllerRef.current = next;
    setSnap(next.getSnapshot());
    return next;
  }

  // 挂载即建控制器（构造零副作用，不触设备，初始即 idle 无需 setState 播种）；
  // pagehide→dispose 是页面义务；卸载同样释放。
  useEffect(() => {
    const controller = buildController('single');
    controllerRef.current = controller;
    // R4-B 最小验证口：验收 harness 读真实控制器计数（只读暴露，不改变产品行为）。
    (window as unknown as { __CAMERA_TEST?: unknown }).__CAMERA_TEST = {
      controller,
      buildReceipt: () => {
        const c = controllerRef.current;
        return c ? buildResourceReceipt({ counters: c.getResourceCounters() }) : null;
      },
    };
    const onPageHide = () => controllerRef.current?.dispose();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ensure(): CameraController | null {
    const c = controllerRef.current;
    if (!c) setNotice('相机控制器尚未就绪，请稍后重试。');
    return c;
  }

  /** 能力检测：控制器构造时已缓存，此处只读展示——不申请权限、不触设备。 */
  function detectNow() {
    const c = ensure();
    if (!c) return;
    setCaps(c.detectCapabilities());
    setNotice(null);
  }

  function openCamera() {
    const c = ensure();
    if (!c) return;
    setNotice(null);
    const r: ControllerResultView = c.openFromUserGesture();
    if (r.ok) {
      const cv = c.detectCapabilities();
      if (cv.liveCameraSupported && !cv.takePhotoSupported) {
        setNotice('已打开取景，但当前浏览器不支持 ImageCapture.takePhoto 单次曝光；请使用『选择/拍摄图片』方式获得照片文件。');
      }
    } else if (r.code === 'UNSUPPORTED') {
      // onError 已给中文提示并建议选图回退，无需重复文案。
    } else {
      setNotice('已在等待授权或已开启，无需重复操作。');
    }
  }

  function cancelOpen() {
    const c = ensure();
    if (!c) return;
    const r = c.cancelRequest();
    if (r.ok) {
      setNotice('已取消等待摄像头授权；迟到的授权流将被立即停轨。');
      logLifecycle('user_cancelled', '用户取消等待摄像头授权：已退出请求，迟到的授权流将被立即停轨。');
    }
  }

  function closeCamera() {
    const c = ensure();
    if (!c) return;
    const r = c.closeStream();
    if (r.ok) setNotice('已关闭相机并释放轨道。');
  }

  function takePhoto() {
    const c = ensure();
    if (!c) return;
    const r: ControllerResultView = c.capture();
    if (!r.ok && r.code === 'IMAGECAPTURE_UNSUPPORTED') {
      setNotice('当前浏览器不支持 takePhoto；为不以截帧冒充照片，请改用"选择/拍摄图片"。');
    }
    // NO_STREAM：按钮已按状态置灰（拍完自动关轨后不触发）；触达也不弹错，突出"重新开启"。
  }

  async function onFilesSelected(files: FileList | null, captureHint: boolean) {
    if (files === null || files.length === 0) return;
    const file = files[0];
    fileMetaRef.current = {
      name: file.name,
      lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
    };
    const c = ensure();
    if (!c) return;
    setNotice(null);
    // capture 提示仅登记；选图会使在途拍照与未决开启请求作废（后选文件优先）。
    await c.acceptFile(file, captureHint ? { captureHint: { capture: 'environment' } } : {});
  }

  function confirmKeep() {
    if (!preview) return;
    decisionRef.current = 'confirmed';
    setDecision('confirmed');
    logLifecycle('capture_confirmed', '用户确认保留当前照片（仅本地内存，尚未入库、不上传）。');
  }

  function cancelPending() {
    if (!preview) return;
    decisionRef.current = null;
    setDecision(null);
    setPreview(null);
    logLifecycle('user_cancelled', '用户取消该照片：不保留显示；URL 由控制器在下次替换或释放时回收。');
  }

  function discardCurrent() {
    if (!preview) return;
    decisionRef.current = null;
    setDecision(null);
    setPreview(null);
    rebuild(continuous ? 'continuous' : 'single');
    logLifecycle('discarded', '证据作废并清除：已停全部轨道、撤销本预览全部 URL，资源清零（控制器已重建）。');
  }

  /** 挂断：本地相机会话整体释放（停轨+撤 URL），幂等。 */
  function hangupAll() {
    decisionRef.current = null;
    setDecision(null);
    setPreview(null);
    rebuild(continuous ? 'continuous' : 'single');
    logLifecycle('session_hangup', '挂断：已停全部视频轨道并撤销全部本地预览 URL（dispose 全清，控制器已重建）。');
  }

  function toggleContinuous(next: boolean) {
    setContinuous(next);
    const had = preview !== null;
    decisionRef.current = null;
    setDecision(null);
    setPreview(null);
    rebuild(next ? 'continuous' : 'single');
    if (had) logLifecycle('discarded', '切换拍摄模式：旧预览已随控制器重建释放（captureMode 为构造依赖，不可运行时切换）。');
    setNotice(next ? '已显式切换为连续拍摄：开启期间轨道保持，请留意"摄像头开启中"提示。' : '已恢复单次模式：拍完自动关轨。');
  }

  const st = snap?.state ?? 'idle';
  const live = snap?.hasLiveStream ?? false;
  const openAllowed = st !== 'requesting' && st !== 'capturing' && !live;

  return (
    <div className={styles.sivCamera} aria-label="本地拍照/预览（尚未入库）">
      <div className={styles.sivCameraRow}>
        <h3 className={styles.sivCameraH3}>本地拍照/预览（用户主动 · 尚未入库）</h3>
        <button
          type="button"
          className={styles.sivBtnSmall}
          aria-expanded={!collapsed}
          aria-controls="v5-camera-body"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? '展开面板（不停轨）' : '收起面板（不停轨）'}
        </button>
      </div>
      <p className={styles.sivNote}>
        照片仅在本机预览：不上传、不入库、不提交模型；刷新或离开本页将清除本地预览。『原件』仅指本应用收到的文件，不证明设备或现场真实性。
      </p>
      <p className={styles.sivNote} data-controller-version={CAMERA_CONTROLLER_VERSION}>
        相机控制器 {CAMERA_CONTROLLER_VERSION}：拍完默认关轨（单次）；连续拍摄须显式开启。收起面板不改变生命周期（不停轨、不释放预览）。
      </p>
      {live ? (
        <p className={styles.sivNote} role="status" data-live="true">
          摄像头开启中（视频轨道存活）{continuous ? ' · 连续拍摄模式（显式开启）' : ' · 单次模式：拍完自动关轨'}
        </p>
      ) : null}
      <div id="v5-camera-body" hidden={collapsed}>
        {caps === null ? (
          <button type="button" className={styles.sivBtnSmall} onClick={detectNow}>
            检测本机拍照能力（不申请权限）
          </button>
        ) : (
          <ul className={styles.sivCaps}>
            <li>文件选择/系统拍照输入：可用</li>
            <li>本地相机取景（getUserMedia）：{caps.getUserMedia === 'available' ? '可用（需你点击授权）' : '不可用（将提供选图方式）'}</li>
            <li>单次曝光拍照（ImageCapture.takePhoto）：{caps.imageCapture === 'available' ? '可用' : '不可用（回退选图，不以截帧冒充）'}</li>
            <li>安全上下文：{caps.secureContext === null ? '未知（以实际调用为准）' : caps.secureContext ? '是' : '否（直开摄像头将被拒绝，请用选图）'}</li>
          </ul>
        )}
        <div className={styles.sivCameraRow}>
          {/* 渐进增强入口：系统拍照/选图；capture 仅为提示，浏览器返回图库时来源未知 */}
          <label className={styles.sivBtnSmall}>
            选择/拍摄图片
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className={styles.sivFileInput}
              onChange={(e) => { void onFilesSelected(e.target.files, true); e.target.value = ''; }}
            />
          </label>
          <label className={styles.sivBtnSmall}>
            从图库选择（来源未知）
            <input
              type="file"
              accept="image/*"
              className={styles.sivFileInput}
              onChange={(e) => { void onFilesSelected(e.target.files, false); e.target.value = ''; }}
            />
          </label>
          {openAllowed ? (
            <button type="button" className={styles.sivBtnSmall} onClick={openCamera}>
              打开本地相机取景（仅视频轨道）
            </button>
          ) : null}
          {st === 'requesting' ? (
            <button type="button" className={styles.sivBtnSmall} onClick={cancelOpen}>
              取消开启（不等待授权）
            </button>
          ) : null}
          {live ? (
            <>
              <button
                type="button"
                className={styles.sivBtnSmall}
                disabled={st !== 'ready' || caps?.imageCapture === 'missing'}
                onClick={takePhoto}
              >
                拍照（takePhoto）
              </button>
              <button type="button" className={styles.sivBtnSmall} onClick={closeCamera}>
                关闭相机
              </button>
            </>
          ) : null}
          <label className={styles.sivBtnSmall} htmlFor="v5-camera-continuous">
            <input
              id="v5-camera-continuous"
              type="checkbox"
              checked={continuous}
              onChange={(e) => toggleContinuous(e.target.checked)}
            />
            {' '}连续拍摄（显式开启；默认拍完关轨）
          </label>
          <button type="button" className={styles.sivBtnSmall} onClick={hangupAll}>
            挂断并释放全部（停轨+撤 URL）
          </button>
        </div>
        <p className={styles.sivNote} data-state={st} data-live={live ? 'yes' : 'no'}>
          当前状态：{STATE_LABELS[st] ?? st} · 轨道：{live ? '存活' : '无'} · 预览：
          {preview ? (decision === 'confirmed' ? '已确认保留（capture_confirmed）' : '待用户确认') : '无'}
        </p>
        {notice !== null ? <p className={styles.sivNote} role="status">{notice}</p> : null}
        <video
          ref={videoRef}
          className={styles.sivCameraPreview}
          muted
          playsInline
          hidden={!live}
          aria-label="本地相机取景（仅视频轨道，不上传）"
        />
        {preview ? (
          <div className={styles.sivPhotos} data-preview-id={preview.id} data-decision={decision ?? 'pending'}>
            <p className={styles.sivPhotoMeta}>
              生命周期：{decision === 'confirmed' ? 'capture_confirmed（用户确认保留）' : '待用户确认（尚未入库、不上传）'}
              {' · '}来源：{sourceLabel(preview)}
              {preview.captureHint ? ` · capture 提示：${preview.captureHint.capture}（仅记录，不作来源证明）` : ''}
              {' · '}{preview.byteLength} 字节 · {preview.mime || 'unknown'}
              {preview.width !== null && preview.height !== null ? ` · ${preview.width}×${preview.height}` : ''}
              {fileMeta?.lastModified !== null && fileMeta !== null ? ` · 修改时间 ${new Date(fileMeta.lastModified).toLocaleString()}` : ''}
            </p>
            <ul className={styles.sivPhotoList}>
              <li className={styles.sivPhotoItem}>
                {preview.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.url} alt="当前本地照片预览（尚未入库）" className={styles.sivPhotoImg} />
                ) : (
                  <span className={styles.sivPhotoMeta}>预览 URL 不可用（object_url_unavailable），原件字节仍在本地内存。</span>
                )}
                <span className={styles.sivPhotoMeta}>
                  出处：{preview.provenance === 'unverified' ? '未验证（不证明现场拍摄）' : preview.provenance}
                  {' · '}拍摄时间：{preview.capturedAt === null ? '未知（不解析 EXIF）' : preview.capturedAt}
                </span>
              </li>
            </ul>
            <div className={styles.sivCameraRow}>
              {decision === 'pending' ? (
                <>
                  <button type="button" className={styles.sivBtnSmall} onClick={confirmKeep}>
                    保留这张（确认保留）
                  </button>
                  <button type="button" className={styles.sivBtnSmall} onClick={cancelPending}>
                    取消（不保留）
                  </button>
                </>
              ) : null}
              <button type="button" className={styles.sivBtnSmall} onClick={discardCurrent}>
                清除本地预览（释放内存）
              </button>
            </div>
          </div>
        ) : null}
        {records.length > 0 ? (
          <div className={styles.sivPhotos}>
            <p className={styles.sivNote}>生命周期记录（仅本地内存，刷新即失；新事件在上）：</p>
            <ul className={styles.sivCaps}>
              {records.map((r) => (
                <li key={r.id} data-lifecycle={r.label}>
                  {r.at} · {LIFECYCLE_LABELS[r.label]}（{r.label}）· {r.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
