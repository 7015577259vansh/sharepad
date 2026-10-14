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
  const [previewPhoto, setPreviewPhoto] = useState(null);
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
