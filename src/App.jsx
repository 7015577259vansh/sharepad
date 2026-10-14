import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';

const MAX_PHOTOS = 12;
const MAX_FILES = 15;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB (Supabase free plan limit)
const BUCKET = 'sharepad-files';

function resizeImage(file, maxDim = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function generateRandomCode(len = 10) {
  const chars = 'abcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function uniqueId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return generateRandomCode(16);
}

const TEXT_EXTS = ['txt','md','json','js','jsx','ts','tsx','py','cpp','c','h','java','html','css','csv','xml','yml','yaml','sql','log','sh','env','ini'];

function getPreviewKind(file) {
  const type = file.type || '';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('text/') || TEXT_EXTS.includes(ext)) return 'text';
  return 'none';
}

export default function SharePad() {
  const [stage, setStage] = useState('landing');
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [uploadError, setUploadError] = useState('');
  const [fileError, setFileError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewPhoto, setPreviewPhoto] = useState(null); // { src, index }
  const saveTimer = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentInputRef = useRef(null);

  // Always holds the latest text/photos/files so saves never use stale values
  const latest = useRef({ text: '', photos: [], files: [] });
  latest.current = { text, photos, files };

  const loadPage = useCallback(async (c) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pages')
        .select('text, photos, files')
        .eq('code', c)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setText(data.text || '');
        setPhotos(data.photos || []);
        setFiles(data.files || []);
      } else {
        setText('');
        setPhotos([]);
        setFiles([]);
      }
    } catch (err) {
      setText('');
      setPhotos([]);
      setFiles([]);
    }
    setLoading(false);
  }, []);

  const openPage = (rawCode) => {
    const trimmed = rawCode.trim();
    if (!trimmed) {
      setCodeError('Enter a page name first');
      return;
    }
    setCodeError('');
    const normalized = trimmed.toLowerCase().replace(/\s+/g, '-');
    setCode(normalized);
    setStage('page');
    loadPage(normalized);
  };

  const createNewRandomPage = () => {
    const random = generateRandomCode();
    openPage(random);
  };

  const persist = useCallback(async (activeCode, newText, newPhotos, newFiles) => {
    if (!activeCode) return;
    setSaveStatus('saving');
    try {
      const { error } = await supabase
        .from('pages')
        .upsert(
          {
            code: activeCode,
            text: newText,
            photos: newPhotos,
            files: newFiles,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'code' }
        );
      if (error) throw error;
      setSaveStatus('saved');
    } catch (err) {
      console.error('Save error:', err);
      setSaveStatus('error');
    }
  }, []);

  const handleTextChange = (val) => {
    setText(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persist(code, val, latest.current.photos, latest.current.files);
    }, 700);
  };

  // ---------- PHOTOS ----------
  const handlePhotos = async (selectedPhotos) => {
    setUploadError('');
    const arr = Array.from(selectedPhotos);
    if (photos.length + arr.length > MAX_PHOTOS) {
      setUploadError(`Up to ${MAX_PHOTOS} photos per page`);
      return;
    }
    try {
      const resized = await Promise.all(arr.map((f) => resizeImage(f)));
      const newPhotos = [...latest.current.photos, ...resized];
      setPhotos(newPhotos);
      persist(code, latest.current.text, newPhotos, latest.current.files);
    } catch (err) {
      setUploadError('Could not process one of the images');
    }
  };

  const removePhoto = (idx) => {
    const newPhotos = photos.filter((_, i) => i !== idx);
    setPhotos(newPhotos);
    persist(code, text, newPhotos, files);
  };

  const downloadPhoto = (src, index) => {
    const a = document.createElement('a');
    a.href = src;
    a.download = `sharepad-photo-${index + 1}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ---------- FILES (pdf, zip, anything) ----------
  const handleDocumentFiles = async (selectedFiles) => {
    setFileError('');
    const arr = Array.from(selectedFiles);

    if (!code) {
      setFileError('Open a SharePad page first.');
      return;
    }
    if (files.length + arr.length > MAX_FILES) {
      setFileError(`Maximum ${MAX_FILES} files allowed per page.`);
      return;
    }
    const tooBig = arr.find((f) => f.size > MAX_FILE_SIZE);
    if (tooBig) {
      setFileError(`"${tooBig.name}" is larger than 50 MB.`);
      return;
    }

    setFileBusy(true);
    const uploaded = [];
    let firstError = '';

    for (const file of arr) {
      try {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${code}/${uniqueId()}-${safeName}`;

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type || 'application/octet-stream' });
        if (error) throw error;

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

        uploaded.push({
          name: file.name,
          path,
          url: data.publicUrl,
          size: file.size,
          type: file.type || 'application/octet-stream'
        });
      } catch (err) {
        console.error('File upload error:', err);
        if (!firstError) firstError = err.message || `Could not upload "${file.name}".`;
      }
    }

    // Save whatever uploaded successfully, even if one file failed
    if (uploaded.length > 0) {
      const updatedFiles = [...latest.current.files, ...uploaded];
      setFiles(updatedFiles);
      await persist(code, latest.current.text, latest.current.photos, updatedFiles);
    }

    if (firstError) setFileError(firstError);
    setFileBusy(false);
  };

  const removeDocumentFile = async (index) => {
    const fileToRemove = files[index];
    if (!fileToRemove) return;

    setFileError('');
    setFileBusy(true);

    try {
      const { error } = await supabase.storage
        .from(BUCKET)
        .remove([fileToRemove.path]);
      if (error) throw error;

      const updatedFiles = latest.current.files.filter((f) => f.path !== fileToRemove.path);
      setFiles(updatedFiles);
      await persist(code, latest.current.text, latest.current.photos, updatedFiles);
    } catch (err) {
      console.error('File delete error:', err);
      setFileError(err.message || 'Could not delete file.');
    } finally {
      setFileBusy(false);
    }
  };

  const formatSize = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  // ---------- FILE PREVIEW ----------
  const openPreview = async (file) => {
    const kind = getPreviewKind(file);
    if (kind === 'none') return;

    // image / video / audio: direct URL kaam karta hai
    if (kind === 'image' || kind === 'video' || kind === 'audio') {
      setPreview({ file, kind, src: file.url, text: '', loading: false, error: '' });
      return;
    }

    // pdf / text: file fetch karke dikhate hain
    setPreview({ file, kind, src: '', text: '', loading: true, error: '' });
    try {
      const res = await fetch(file.url);
      if (!res.ok) throw new Error('Could not load file');
      if (kind === 'text') {
        let t = await res.text();
        if (t.length > 100000) t = t.slice(0, 100000) + '\n\n… (preview truncated, download for full file)';
        setPreview((p) => (p ? { ...p, text: t, loading: false } : p));
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        setPreview((p) => (p ? { ...p, src: url, loading: false } : p));
      }
    } catch (err) {
      setPreview((p) => (p ? { ...p, loading: false, error: 'Could not load preview. Try Download instead.' } : p));
    }
  };

  const closePreview = () => {
    if (preview && preview.kind === 'pdf' && preview.src) URL.revokeObjectURL(preview.src);
    setPreview(null);
  };

  // Esc closes file preview
  useEffect(() => {
    if (!preview) return;
    const onKey = (e) => { if (e.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  // Esc closes photo lightbox
  useEffect(() => {
    if (!previewPhoto) return;
    const onKey = (e) => { if (e.key === 'Escape') setPreviewPhoto(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewPhoto]);

  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}#${code}`;
    navigator.clipboard.writeText(url).catch(() => {});
  };

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) openPage(hash);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const styles = {
    page: { minHeight: '100vh', background: '#faf9f6', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', color: '#1a1a1a' },
    landingWrap: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' },
    title: { fontSize: '48px', fontWeight: 700, letterSpacing: '-1px', margin: 0 },
    subtitle: { fontSize: '17px', color: '#666', marginTop: '10px', marginBottom: '32px' },
    inputRow: { display: 'flex', border: '1.5px solid #ddd', borderRadius: '10px', overflow: 'hidden', background: '#fff', width: '100%', maxWidth: '480px' },
    prefix: { display: 'flex', alignItems: 'center', padding: '0 14px', color: '#999', fontSize: '15px', background: '#f5f4f0', borderRight: '1.5px solid #ddd', whiteSpace: 'nowrap' },
    input: { flex: 1, border: 'none', outline: 'none', padding: '14px 12px', fontSize: '16px', background: 'transparent', color: '#1a1a1a' },
    goBtn: { border: 'none', background: '#1a1a1a', color: '#fff', padding: '0 22px', fontSize: '15px', fontWeight: 500, cursor: 'pointer' },
    orRow: { display: 'flex', alignItems: 'center', gap: '10px', margin: '18px 0', color: '#aaa', fontSize: '13px', width: '100%', maxWidth: '480px' },
    hr: { flex: 1, height: '1px', background: '#e5e3dd' },
    randomBtn: { border: '1.5px solid #ddd', background: '#fff', borderRadius: '10px', padding: '13px 20px', fontSize: '15px', cursor: 'pointer', color: '#1a1a1a', width: '100%', maxWidth: '480px' },
    hint: { fontSize: '13px', color: '#999', marginTop: '16px', maxWidth: '420px', textAlign: 'center' },
    errorText: { fontSize: '13px', color: '#c0392b', marginTop: '10px' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #e5e3dd', background: '#fff', position: 'sticky', top: 0, zIndex: 5 },
    codeLabel: { fontSize: '15px', fontWeight: 600 },
    statusText: { fontSize: '12px', color: '#999' },
    backBtn: { border: '1px solid #ddd', background: '#fff', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer', color: '#444' },
    body: { maxWidth: '760px', margin: '0 auto', padding: '24px' },
    textarea: { width: '100%', minHeight: '220px', border: '1px solid #e5e3dd', borderRadius: '10px', padding: '16px', fontSize: '16px', lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical', outline: 'none', background: '#fff', boxSizing: 'border-box' },
    uploadZone: { marginTop: '20px', border: '1.5px dashed #ccc', borderRadius: '10px', padding: '22px', textAlign: 'center', cursor: 'pointer', color: '#777', fontSize: '14px', background: '#fff' },
    photoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '12px', marginTop: '16px' },
    photoWrap: { position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e3dd', aspectRatio: '1' },
    photoImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
    removeBtn: { position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: '22px', height: '22px', fontSize: '13px', cursor: 'pointer', lineHeight: 1 },
    photoDownloadBtn: { position: 'absolute', bottom: '4px', right: '4px', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: '22px', height: '22px', fontSize: '13px', cursor: 'pointer', lineHeight: 1 },
    lightboxOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '24px', boxSizing: 'border-box' },
    lightboxImg: { maxWidth: '100%', maxHeight: '90vh', borderRadius: '8px', objectFit: 'contain' },
    lightboxClose: { position: 'absolute', top: '20px', right: '24px', background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '50%', width: '36px', height: '36px', fontSize: '18px', cursor: 'pointer' },
    lightboxDownload: { position: 'absolute', top: '20px', right: '72px', background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '18px', height: '36px', padding: '0 16px', fontSize: '14px', cursor: 'pointer' },
    fileRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px', marginTop: '8px', border: '1px solid #e5e3dd', borderRadius: '8px', background: '#fff', overflowWrap: 'anywhere' },
    fileName: { fontSize: '14px', fontWeight: 500 },
    fileSize: { fontSize: '12px', color: '#999' },
    fileActions: { display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center' },
    downloadLink: { border: '1px solid #ddd', background: '#fff', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', color: '#1a1a1a', textDecoration: 'none' },
    fileRemoveBtn: { border: '1px solid #ddd', background: '#fff', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer', color: '#c0392b' },
    previewBtn: { border: '1px solid #ddd', background: '#fff', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer', color: '#1a1a1a' },
    modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 50 },
    modalBox: { background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '900px', height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 16px', borderBottom: '1px solid #e5e3dd' },
    modalTitle: { fontSize: '15px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    modalBody: { flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf9f6' },
    modalMsg: { color: '#777', fontSize: '14px', padding: '24px', textAlign: 'center' },
    previewText: { margin: 0, padding: '16px', width: '100%', height: '100%', boxSizing: 'border-box', overflow: 'auto', fontSize: '13px', lineHeight: 1.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', alignSelf: 'flex-start' },
  };

  if (stage === 'landing') {
    return (
      <div style={styles.page}>
        <div style={styles.landingWrap}>
          <h1 style={styles.title}>SharePad</h1>
          <p style={styles.subtitle}>Drop text, photos and any type of file. Share the code, no login.</p>
          <div style={styles.inputRow}>
            <span style={styles.prefix}>sharepad/</span>
            <input
              style={styles.input}
              placeholder="your-secret-page"
              value={codeInput}
              onChange={(e) => { setCodeInput(e.target.value); setCodeError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') openPage(codeInput); }}
            />
            <button style={styles.goBtn} onClick={() => openPage(codeInput)}>Go</button>
          </div>
          {codeError && <div style={styles.errorText}>{codeError}</div>}
          <div style={styles.orRow}><div style={styles.hr} /><span>or</span><div style={styles.hr} /></div>
          <button style={styles.randomBtn} onClick={createNewRandomPage}>Generate a secure random page</button>
          <div style={styles.hint}>Anyone with the exact code sees the same page. A random code is much harder to guess than a short word.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.codeLabel}>sharepad/{code}</div>
          <div style={styles.statusText}>
            {loading ? 'Loading…' : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Could not save, retrying' : 'Everyone with this code sees this page'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={styles.backBtn} onClick={copyLink}>Copy link</button>
          <button
            style={styles.backBtn}
            onClick={() => {
              if (saveTimer.current) clearTimeout(saveTimer.current);
              setStage('landing');
              setCodeInput('');
              setCode('');
              setText('');
              setPhotos([]);
              setFiles([]);
              setUploadError('');
              setFileError('');
              setSaveStatus('idle');
              setPreviewPhoto(null);
              setPreview(null);
              window.location.hash = '';
            }}
          >
            New page
          </button>
        </div>
      </div>

      <div style={styles.body}>
        <textarea
          style={styles.textarea}
          placeholder="Write anything here. It saves as you type."
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
        />

        {/* PHOTOS */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files.length) handlePhotos(e.target.files); e.target.value = ''; }}
        />
        <div style={styles.uploadZone} onClick={() => fileInputRef.current.click()}>
          Tap to add photos ({photos.length}/{MAX_PHOTOS})
        </div>
        {uploadError && <div style={styles.errorText}>{uploadError}</div>}

        {photos.length > 0 && (
          <div style={styles.photoGrid}>
            {photos.map((p, i) => (
              <div style={styles.photoWrap} key={i}>
                <img
                  src={p}
                  style={{ ...styles.photoImg, cursor: 'pointer' }}
                  alt={`upload ${i + 1}`}
                  onClick={() => setPreviewPhoto({ src: p, index: i })}
                />
                <button style={styles.removeBtn} onClick={() => removePhoto(i)} aria-label="Remove photo">×</button>
                <button style={styles.photoDownloadBtn} onClick={() => downloadPhoto(p, i)} aria-label="Download photo">↓</button>
              </div>
            ))}
          </div>
        )}

        {/* FILES */}
        <input
          ref={attachmentInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files.length) handleDocumentFiles(e.target.files); e.target.value = ''; }}
        />
        <div
          style={{ ...styles.uploadZone, opacity: fileBusy ? 0.6 : 1, cursor: fileBusy ? 'default' : 'pointer' }}
          onClick={() => { if (!fileBusy) attachmentInputRef.current.click(); }}
        >
          {fileBusy ? 'Working…' : `Tap to add files: PDF, ZIP, anything (${files.length}/${MAX_FILES})`}
        </div>
        {fileError && <div style={styles.errorText}>{fileError}</div>}

        {files.map((file) => (
          <div style={styles.fileRow} key={file.path}>
            <div style={{ minWidth: 0 }}>
              <div style={styles.fileName}>{file.name}</div>
              <div style={styles.fileSize}>{formatSize(file.size)}</div>
            </div>
            <div style={styles.fileActions}>
              {getPreviewKind(file) !== 'none' && (
                <button type="button" style={styles.previewBtn} onClick={() => openPreview(file)}>
                  Preview
                </button>
              )}
              <a
                href={`${file.url}?download=${encodeURIComponent(file.name)}`}
                target="_blank"
                rel="noreferrer"
                style={styles.downloadLink}
              >
                Download
              </a>
              <button
                type="button"
                style={{ ...styles.fileRemoveBtn, opacity: fileBusy ? 0.5 : 1 }}
                disabled={fileBusy}
                onClick={() => removeDocumentFile(files.findIndex((f) => f.path === file.path))}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* FILE PREVIEW MODAL */}
      {preview && (
        <div style={styles.modalOverlay} onClick={closePreview}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>{preview.file.name}</div>
              <button type="button" style={styles.backBtn} onClick={closePreview}>Close</button>
            </div>
            <div style={styles.modalBody}>
              {preview.loading && <div style={styles.modalMsg}>Loading preview…</div>}
              {preview.error && <div style={styles.modalMsg}>{preview.error}</div>}
              {!preview.loading && !preview.error && preview.kind === 'image' && (
                <img src={preview.src} alt={preview.file.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              )}
              {!preview.loading && !preview.error && preview.kind === 'pdf' && (
                <iframe title="PDF preview" src={preview.src} style={{ width: '100%', height: '100%', border: 'none' }} />
              )}
              {!preview.loading && !preview.error && preview.kind === 'video' && (
                <video src={preview.src} controls style={{ maxWidth: '100%', maxHeight: '100%' }} />
              )}
              {!preview.loading && !preview.error && preview.kind === 'audio' && (
                <audio src={preview.src} controls />
              )}
              {!preview.loading && !preview.error && preview.kind === 'text' && (
                <pre style={styles.previewText}>{preview.text}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PHOTO LIGHTBOX */}
      {previewPhoto && (
        <div style={styles.lightboxOverlay} onClick={() => setPreviewPhoto(null)}>
          <button
            style={styles.lightboxDownload}
            onClick={(e) => { e.stopPropagation(); downloadPhoto(previewPhoto.src, previewPhoto.index); }}
          >
            Download
          </button>
          <button style={styles.lightboxClose} onClick={() => setPreviewPhoto(null)} aria-label="Close">×</button>
          <img src={previewPhoto.src} style={styles.lightboxImg} alt="Full size preview" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
