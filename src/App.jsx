import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';

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

export default function SharePad() {
  const [stage, setStage] = useState('landing');
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [uploadError, setUploadError] = useState('');
  const [codeError, setCodeError] = useState('');
  const saveTimer = useRef(null);
  const fileInputRef = useRef(null);

  const loadPage = useCallback(async (c) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pages')
        .select('text, photos')
        .eq('code', c)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setText(data.text || '');
        setPhotos(data.photos || []);
      } else {
        setText('');
        setPhotos([]);
      }
    } catch (err) {
      setText('');
      setPhotos([]);
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

  const persist = useCallback(async (activeCode, newText, newPhotos) => {
    if (!activeCode) return;
    setSaveStatus('saving');
    try {
      const { error } = await supabase
        .from('pages')
        .upsert(
          { code: activeCode, text: newText, photos: newPhotos, updated_at: new Date().toISOString() },
          { onConflict: 'code' }
        );
      if (error) throw error;
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
    }
  }, []);

  const handleTextChange = (val) => {
    setText(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persist(code, val, photos);
    }, 700);
  };

  const handleFiles = async (files) => {
    setUploadError('');
    const arr = Array.from(files);
    if (photos.length + arr.length > 12) {
      setUploadError('Up to 12 photos per page');
      return;
    }
    try {
      const resized = await Promise.all(arr.map((f) => resizeImage(f)));
      const newPhotos = [...photos, ...resized];
      setPhotos(newPhotos);
      persist(code, text, newPhotos);
    } catch (err) {
      setUploadError('Could not process one of the images');
    }
  };

  const removePhoto = (idx) => {
    const newPhotos = photos.filter((_, i) => i !== idx);
    setPhotos(newPhotos);
    persist(code, text, newPhotos);
  };

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
  };

  if (stage === 'landing') {
    return (
      <div style={styles.page}>
        <div style={styles.landingWrap}>
          <h1 style={styles.title}>SharePad</h1>
          <p style={styles.subtitle}>Write text and drop photos. Share the code, no login.</p>
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
          <button style={styles.backBtn} onClick={() => { setStage('landing'); setCodeInput(''); setCode(''); setText(''); setPhotos([]); window.location.hash = ''; }}>New page</button>
        </div>
      </div>

      <div style={styles.body}>
        <textarea
          style={styles.textarea}
          placeholder="Write anything here. It saves as you type."
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files.length) handleFiles(e.target.files); e.target.value = ''; }}
        />
        <div style={styles.uploadZone} onClick={() => fileInputRef.current.click()}>
          Tap to add photos ({photos.length}/12)
        </div>
        {uploadError && <div style={styles.errorText}>{uploadError}</div>}

        {photos.length > 0 && (
          <div style={styles.photoGrid}>
            {photos.map((p, i) => (
              <div style={styles.photoWrap} key={i}>
                <img src={p} style={styles.photoImg} alt={`upload ${i + 1}`} />
                <button style={styles.removeBtn} onClick={() => removePhoto(i)} aria-label="Remove photo">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
