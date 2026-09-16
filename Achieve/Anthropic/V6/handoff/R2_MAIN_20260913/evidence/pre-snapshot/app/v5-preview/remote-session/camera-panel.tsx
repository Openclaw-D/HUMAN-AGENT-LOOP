"use client";

// V6 远程尽调 · 本地拍照/预览面板（REMOTE_DD_REPAIR C 节）。
// 底线：用户主动触发；不自动摄录；只申请视频轨道（不申请麦克风）；
// 原始文件只做本地预览（object URL），不上传、不持久化、不提交模型；
// 离开/取消/拍完即停轨道并释放 URL；浏览器回退图库时如实说明"来源未知"。
// "原件"仅指本应用收到的文件——不证明设备/现场真实性或未被上游修改。
import { useEffect, useRef, useState } from 'react';
import styles from '../preview.module.css';

interface LocalPhoto {
  name: string;
  sizeBytes: number;
  type: string;
  lastModified: number | null;
  sourceMode: 'file_capture_hint' | 'file_gallery_unknown' | 'imagecapture';
  url: string;
}

interface CameraCapabilities {
  fileInput: true;
  getUserMedia: boolean;
  imageCapture: boolean;
}

/** 能力检测：纯特性探测，不触发任何权限申请。 */
function detectCapabilities(): CameraCapabilities {
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  return {
    fileInput: true,
    getUserMedia: typeof media?.getUserMedia === 'function',
    imageCapture: typeof window !== 'undefined' && 'ImageCapture' in window,
  };
}

export default function CameraPanel() {
  const [caps, setCaps] = useState<CameraCapabilities | null>(null); // 用户点击后才检测
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  /** 释放全部本地资源：视频轨道 + object URL。 */
  function cleanupCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }

  function revokeAll() {
    setPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  }

  // 离开页面：停轨道、释放 URL（刷新会清空本地预览——如实标注）。
  useEffect(() => {
    return () => {
      cleanupCamera();
      setPhotos((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.url));
        return [];
      });
    };
  }, []);

  function detectNow() {
    setCaps(detectCapabilities());
  }

  function onFilesSelected(files: FileList | null, captureHint: boolean) {
    if (files === null || files.length === 0) return;
    const file = files[0];
    const photo: LocalPhoto = {
      name: file.name,
      sizeBytes: file.size,
      type: file.type || 'unknown',
      lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
      // capture 提示只对支持的设备生效；浏览器返回图库时来源未知——如实区分，不写"已现场拍摄"。
      sourceMode: captureHint ? 'file_capture_hint' : 'file_gallery_unknown',
      url: URL.createObjectURL(file),
    };
    setPhotos((prev) => [photo, ...prev]);
  }

  async function openCamera() {
    setCameraNote(null);
    const c = caps ?? detectCapabilities();
    if (c === null || !c.getUserMedia) {
      setCameraNote('当前浏览器不支持本地相机取景（getUserMedia 不可用）；请使用『选择/拍摄图片』方式。');
      return;
    }
    try {
      // 仅视频轨道；不申请麦克风。用户已通过点击显式授权路径。
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      trackRef.current = stream.getVideoTracks()[0] ?? null;
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
      if (!c.imageCapture) {
        setCameraNote('已打开取景，但当前浏览器不支持 ImageCapture.takePhoto 单次曝光；请使用『选择/拍摄图片』方式获得照片文件。');
      }
    } catch (e) {
      cleanupCamera();
      const name = (e as DOMException)?.name ?? '';
      if (name === 'NotAllowedError') setCameraNote('相机权限被拒绝：未拍摄。可改用"选择/拍摄图片"方式。');
      else if (name === 'NotFoundError') setCameraNote('未找到可用相机设备。');
      else setCameraNote(`相机打开失败（${name || 'unknown'}）：未拍摄。`);
    }
  }

  async function takePhoto() {
    const track = trackRef.current;
    if (track === null) return;
    const c = caps ?? detectCapabilities();
    if (!c.imageCapture) {
      setCameraNote('当前浏览器不支持 takePhoto；为不以截帧冒充照片，请改用"选择/拍摄图片"。');
      return;
    }
    try {
      const ImageCaptureCtor = (window as unknown as { ImageCapture: new (track: MediaStreamTrack) => { takePhoto(): Promise<{ blob: Blob }> } }).ImageCapture;
      const imageCapture = new ImageCaptureCtor(track);
      const photo = await imageCapture.takePhoto();
      const blob = photo.blob;
      setPhotos((prev) => [{
        name: `camera-${Date.now()}.${blob.type.split('/')[1] || 'bin'}`,
        sizeBytes: blob.size,
        type: blob.type || 'unknown',
        lastModified: null,
        sourceMode: 'imagecapture',
        url: URL.createObjectURL(blob),
      }, ...prev]);
    } catch (e) {
      setCameraNote(`拍照失败（${(e as Error)?.message ?? 'unknown'}）：可改用"选择/拍摄图片"。`);
    }
  }

  return (
    <div className={styles.remoteCamera} aria-label="本地拍照/预览（尚未入库）">
      <h3 className={styles.remoteH3}>本地拍照/预览（用户主动 · 尚未入库）</h3>
      <p className={styles.remoteNote}>
        照片仅在本机预览：不上传、不入库、不提交模型；刷新或离开本页将清除本地预览。『原件』仅指本应用收到的文件，不证明设备或现场真实性。
      </p>
      {caps === null ? (
        <button type="button" className={styles.remoteBtnSmall} onClick={detectNow}>
          检测本机拍照能力（不申请权限）
        </button>
      ) : (
        <ul className={styles.remoteCaps}>
          <li>文件选择/系统拍照输入：可用</li>
          <li>本地相机取景（getUserMedia）：{caps.getUserMedia ? '可用（需你点击授权）' : '不可用（将提供选图方式）'}</li>
          <li>单次曝光拍照（ImageCapture.takePhoto）：{caps.imageCapture ? '可用' : '不可用（回退选图，不以截帧冒充）'}</li>
        </ul>
      )}
      <div className={styles.remoteCameraRow}>
        {/* 渐进增强入口：系统拍照/选图；capture 仅为提示，浏览器返回图库时来源未知 */}
        <label className={styles.remoteBtnSmall}>
          选择/拍摄图片
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => { onFilesSelected(e.target.files, true); e.target.value = ''; }}
          />
        </label>
        <label className={styles.remoteBtnSmall}>
          从图库选择（来源未知）
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { onFilesSelected(e.target.files, false); e.target.value = ''; }}
          />
        </label>
        {!cameraOn ? (
          <button type="button" className={styles.remoteBtnSmall} onClick={() => { void openCamera(); }}>
            打开本地相机取景（仅视频轨道）
          </button>
        ) : (
          <>
            <button type="button" className={styles.remoteBtnSmall} disabled={!(caps ?? detectCapabilities()).imageCapture} onClick={() => { void takePhoto(); }}>
              拍照（takePhoto）
            </button>
            <button type="button" className={styles.remoteBtnSmall} onClick={() => { cleanupCamera(); setCameraNote('已关闭相机并释放轨道。'); }}>
              关闭相机
            </button>
          </>
        )}
      </div>
      {cameraNote !== null ? <p className={styles.remoteNote} role="status">{cameraNote}</p> : null}
      {cameraOn ? <video ref={videoRef} className={styles.remoteCameraPreview} muted playsInline /> : null}
      {photos.length > 0 ? (
        <div className={styles.remotePhotos}>
          <button type="button" className={styles.remoteBtnSmall} onClick={revokeAll}>清除本地预览（释放内存）</button>
          <ul className={styles.remotePhotoList}>
            {photos.map((p, i) => (
              <li key={`${p.url}-${i}`} className={styles.remotePhotoItem}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`本地照片预览 ${i + 1}`} className={styles.remotePhotoImg} />
                <span className={styles.remotePhotoMeta}>
                  {p.sizeBytes} 字节 · {p.type}
                  {p.sourceMode === 'file_capture_hint' ? ' · 来源：系统拍照/选图（capture 提示）' : p.sourceMode === 'imagecapture' ? ' · 来源：相机单次曝光（takePhoto）' : ' · 来源：图库选择（来源未知，未验证现场）'}
                  {p.lastModified !== null ? ` · 修改时间 ${new Date(p.lastModified).toLocaleString()}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
