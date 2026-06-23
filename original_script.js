pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* ============================================================
   STATE
============================================================ */
const state = {
  docs: {},          // id -> docObject
  activeDocId: null,
  tool: 'select',
  color: '#ff3b30',
  size: 4,
  fontSize: 18,
  symbol: '★',
  pendingImage: null,   // {src, w, h} once picked, before placement click
};
let docCounter = 0;
const SWATCH_COLORS = ['#ff3b30','#ffcc00','#34c759','#007aff','#5856d6','#1a1c22','#ffffff'];
const SYMBOLS = ['★','✔','✖','➜','♥','⚑','⬤','▲','!','?','＋','⊘'];

/* ============================================================
   DOM REFS
============================================================ */
const $ = (sel) => document.querySelector(sel);
const fileInput = $('#fileInput');
const imageFileInput = $('#imageFileInput');
const tabbar = $('#tabbar');
const tabAddBtn = $('#tabAddBtn');
const viewerWrap = $('#viewerWrap');
const emptyState = $('#emptyState');
const hintBanner = $('#hintBanner');
const eraserCursor = $('#eraserCursor');
const textPopover = $('#textPopover');
const textPopoverInput = $('#textPopoverInput');

['#uploadBtnRail', '#uploadBtnEmpty', '#tabAddBtn'].forEach(sel=>{
  $(sel).addEventListener('click', ()=> fileInput.click());
});

fileInput.addEventListener('change', (e)=>{
  handleFiles(e.target.files);
  fileInput.value = '';
});

/* ============================================================
   TOOLBOX UI SETUP
============================================================ */
function buildSwatches(){
  const wrap = $('#swatches');
  wrap.innerHTML = '';
  SWATCH_COLORS.forEach(c=>{
    const sw = document.createElement('div');
    sw.className = 'swatch' + (c === state.color ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', ()=>{
      state.color = c;
      $('#colorPicker').value = (c === '#ffffff') ? '#ffffff' : c;
      buildSwatches();
    });
    wrap.appendChild(sw);
  });
}
buildSwatches();

$('#colorPicker').addEventListener('input', (e)=>{
  state.color = e.target.value;
  buildSwatches();
});

$('#sizeSlider').addEventListener('input', (e)=>{
  state.size = +e.target.value;
  $('#sizeVal').textContent = state.size;
});

$('#fontSizeSlider').addEventListener('input', (e)=>{
  state.fontSize = +e.target.value;
  $('#fontSizeVal').textContent = state.fontSize;
});

function buildSymbolGrid(){
  const grid = $('#symbolGrid');
  grid.innerHTML = '';
  SYMBOLS.forEach(s=>{
    const b = document.createElement('div');
    b.className = 'symbol-btn' + (s === state.symbol ? ' selected' : '');
    b.textContent = s;
    b.addEventListener('click', ()=>{
      state.symbol = s;
      buildSymbolGrid();
    });
    grid.appendChild(b);
  });
}
buildSymbolGrid();

const TOOL_HINTS = {
  select: 'Drag images, text, or symbols to move them — hover one to resize or delete it.',
  pen: 'Click and drag on the page to draw freehand.',
  highlight: 'Drag across text to highlight it.',
  text: 'Click anywhere on the page to add text.',
  image: 'Pick an image, then click where it should appear.',
  symbol: 'Pick a symbol on the left, then click to stamp it.',
  erase: 'Drag over a mark to erase it.'
};

document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const tool = btn.dataset.tool;
    if(tool === 'image'){
      imageFileInput.click();
      return; // tool gets set once an image file is chosen
    }
    setTool(tool);
  });
});

imageFileInput.addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    const img = new Image();
    img.onload = ()=>{
      state.pendingImage = { src: ev.target.result, w: img.width, h: img.height };
      setTool('image');
      showHint('Click on the page to place the image.');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  imageFileInput.value = '';
});

function setTool(tool){
  state.tool = tool;
  document.querySelectorAll('.tool-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  $('#symbolSection').style.display = (tool === 'symbol') ? 'block' : 'none';
  $('#fontSection').style.display = (tool === 'text') ? 'block' : 'none';
  document.getElementById('app').classList.toggle('tool-select', tool === 'select');
  document.getElementById('app').classList.toggle('tool-erase', tool === 'erase');
  if(tool !== 'erase') hideEraserCursor();
  if(TOOL_HINTS[tool]) showHint(TOOL_HINTS[tool]); else hideHint();
}

let hintTimer = null;
function showHint(msg){
  hintBanner.textContent = msg;
  hintBanner.style.display = 'block';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideHint, 3200);
}
function hideHint(){ hintBanner.style.display = 'none'; }

$('#undoBtn').addEventListener('click', ()=>{
  const page = getVisiblePage();
  if(page) undoPage(page);
});
$('#clearPageBtn').addEventListener('click', ()=>{
  const page = getVisiblePage();
  if(page) clearPage(page);
});
$('#exportBtn').addEventListener('click', ()=>{
  const doc = state.docs[state.activeDocId];
  if(doc) exportDoc(doc);
});
$('#mergeBtn').addEventListener('click', mergeAllDocs);

/* ============================================================
   FILE LOADING
============================================================ */
async function handleFiles(fileList){
  // PDFs can be multi-selected in the file picker (input has `multiple`) or
  // dropped together — every valid file in the batch becomes its own tab,
  // in the exact order they were selected.
  const pdfFiles = Array.from(fileList).filter(f => f.type === 'application/pdf');
  if(!pdfFiles.length) return;

  emptyState.classList.add('hidden');

  // Build tabs + empty viewers synchronously first, so the tab strip fills
  // in immediately and in selection order, even while pages are still
  // being rasterized in the background.
  const prepared = pdfFiles.map(file => {
    const id = 'doc_' + (++docCounter);
    const doc = { id, name: file.name, file, pages: [] };
    state.docs[id] = doc;
    buildTab(doc);
    buildViewer(doc);
    return doc;
  });

  switchTab(prepared[0].id);

  await Promise.all(prepared.map(doc => loadDocument(doc)));
}

async function loadDocument(doc){
  const arrayBuf = await doc.file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuf.slice(0) });
  const pdf = await loadingTask.promise;

  doc.pdf = pdf;
  doc.originalBytes = arrayBuf;
  doc.numPages = pdf.numPages;

  await renderAllPages(doc);
}

/* ============================================================
   TABS
============================================================ */
function buildTab(doc){
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.docId = doc.id;
  tab.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
    <span class="tab-name">${escapeHtml(doc.name)}</span>
    <span class="tab-close">✕</span>
  `;
  tab.addEventListener('click', (e)=>{
    if(e.target.classList.contains('tab-close')){
      closeDoc(doc.id);
    } else {
      switchTab(doc.id);
    }
  });
  tabbar.insertBefore(tab, tabAddBtn);
}

function switchTab(id){
  state.activeDocId = id;
  document.querySelectorAll('.tab').forEach(t=>{
    t.classList.toggle('active', t.dataset.docId === id);
  });
  document.querySelectorAll('.doc-viewer').forEach(v=>{
    v.classList.toggle('active', v.dataset.docId === id);
  });
}

function closeDoc(id){
  const doc = state.docs[id];
  if(!doc) return;
  doc.viewerEl?.remove();
  document.querySelector(`.tab[data-doc-id="${id}"]`)?.remove();
  delete state.docs[id];
  if(state.activeDocId === id){
    const remaining = Object.keys(state.docs);
    state.activeDocId = remaining.length ? remaining[remaining.length-1] : null;
    if(state.activeDocId) switchTab(state.activeDocId);
  }
  if(Object.keys(state.docs).length === 0){
    emptyState.classList.remove('hidden');
  }
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ============================================================
   VIEWER / PAGE RENDERING
============================================================ */
function buildViewer(doc){
  const el = document.createElement('div');
  el.className = 'doc-viewer';
  el.dataset.docId = doc.id;
  viewerWrap.appendChild(el);
  doc.viewerEl = el;
}

async function renderAllPages(doc){
  const toolboxWidth = document.getElementById('toolbox').getBoundingClientRect().width;
  const availWidth = window.innerWidth - toolboxWidth - 48; // padding allowance

  for(let i = 1; i <= doc.numPages; i++){
    const page = await doc.pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(availWidth / baseViewport.width, 1.6);
    const viewport = page.getViewport({ scale });

    const dpr = window.devicePixelRatio || 1;

    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.style.width = viewport.width + 'px';
    wrap.style.height = viewport.height + 'px';

    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.className = 'pdf-canvas';
    pdfCanvas.width = viewport.width * dpr;
    pdfCanvas.height = viewport.height * dpr;
    pdfCanvas.style.width = viewport.width + 'px';
    pdfCanvas.style.height = viewport.height + 'px';
    const pdfCtx = pdfCanvas.getContext('2d');
    pdfCtx.scale(dpr, dpr);

    const annotCanvas = document.createElement('canvas');
    annotCanvas.className = 'annot-canvas';
    annotCanvas.width = viewport.width * dpr;
    annotCanvas.height = viewport.height * dpr;
    annotCanvas.style.width = viewport.width + 'px';
    annotCanvas.style.height = viewport.height + 'px';
    const annotCtx = annotCanvas.getContext('2d');
    annotCtx.scale(dpr, dpr);
    annotCtx.lineCap = 'round';
    annotCtx.lineJoin = 'round';

    const badge = document.createElement('div');
    badge.className = 'page-num-badge';
    badge.textContent = `Page ${i} of ${doc.numPages}`;

    wrap.appendChild(pdfCanvas);
    wrap.appendChild(annotCanvas);
    wrap.appendChild(badge);
    doc.viewerEl.appendChild(wrap);

    await page.render({ canvasContext: pdfCtx, viewport }).promise;

    let lines = [];
    try{
      lines = await computeTextLines(page, viewport);
    }catch(err){ /* text-less / scanned page — highlight falls back to freehand */ }

    const pageObj = {
      doc, index: i, wrap, pdfCanvas, annotCanvas, ctx: annotCtx,
      cssWidth: viewport.width, cssHeight: viewport.height,
      history: [], lines, placedItems: [],
    };
    doc.pages.push(pageObj);
    attachPageEvents(pageObj);
  }
}

/* Build per-line bounding boxes (in canvas CSS-pixel coords) from the page's
   text content, so the highlight tool can snap to real text lines instead
   of drawing a free, line-ignorant stroke. */
async function computeTextLines(pdfPage, viewport){
  const textContent = await pdfPage.getTextContent();
  const items = [];
  for(const item of textContent.items){
    if(!item.str || !item.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const scaleX = Math.hypot(tx[0], tx[1]);
    const scaleY = Math.hypot(tx[2], tx[3]);
    const height = (item.height ? item.height * scaleY : scaleY) || scaleY || 10;
    const width = item.width ? item.width * scaleX : 0;
    const x = tx[4];
    const top = tx[5] - height;
    if(width > 0) items.push({ x, y: top, width, height });
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  const Y_TOL = 4;
  for(const it of items){
    let line = lines.find(l => Math.abs(l.y - it.y) <= Y_TOL);
    if(!line){
      line = { y: it.y, height: it.height, minX: it.x, maxX: it.x + it.width };
      lines.push(line);
    } else {
      line.minX = Math.min(line.minX, it.x);
      line.maxX = Math.max(line.maxX, it.x + it.width);
      line.height = Math.max(line.height, it.height);
      line.y = Math.min(line.y, it.y);
    }
  }
  return lines
    .map(l => ({ x: l.minX, y: l.y, width: l.maxX - l.minX, height: l.height }))
    .sort((a, b) => a.y - b.y);
}

function getVisiblePage(){
  const doc = state.docs[state.activeDocId];
  if(!doc || !doc.pages.length) return null;
  // pick the page most centered in the viewport
  const viewerRect = doc.viewerEl.getBoundingClientRect();
  const centerY = viewerRect.top + viewerRect.height/2;
  let best = doc.pages[0], bestDist = Infinity;
  for(const p of doc.pages){
    const r = p.wrap.getBoundingClientRect();
    const pc = r.top + r.height/2;
    const dist = Math.abs(pc - centerY);
    if(dist < bestDist){ bestDist = dist; best = p; }
  }
  return best;
}

/* ============================================================
   DRAWING / ANNOTATION LOGIC
============================================================ */
function snapshot(page){
  // store a lightweight undo snapshot (capped history)
  try{
    const data = page.ctx.getImageData(0, 0, page.annotCanvas.width, page.annotCanvas.height);
    page.history.push(data);
    if(page.history.length > 25) page.history.shift();
  }catch(err){ /* ignore */ }
}

function undoPage(page){
  if(!page.history.length) return;
  const data = page.history.pop();
  page.ctx.putImageData(data, 0, 0);
}

function clearPage(page){
  snapshot(page);
  page.ctx.clearRect(0, 0, page.annotCanvas.width, page.annotCanvas.height);
  page.placedItems.slice().forEach(item => deletePlacedItem(page, item));
}

function attachPageEvents(page){
  const canvas = page.annotCanvas;
  let drawing = false;
  let lastX = 0, lastY = 0;
  let hlBaseline = null;
  let hlStart = null;

  function toLocal(e){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top)
    };
  }

  canvas.addEventListener('pointerdown', (e)=>{
    const tool = state.tool;
    if(tool === 'select') return;
    const { x, y } = toLocal(e);

    if(tool === 'text'){
      openTextPopover(page, x, y);
      return;
    }
    if(tool === 'symbol'){
      placeSymbol(page, x, y);
      return;
    }
    if(tool === 'image'){
      if(!state.pendingImage){ showHint('Pick an image first.'); return; }
      placeImage(page, x, y);
      return;
    }
    if(tool === 'highlight' && page.lines && page.lines.length){
      drawing = true;
      snapshot(page);
      hlBaseline = page.ctx.getImageData(0, 0, page.annotCanvas.width, page.annotCanvas.height);
      hlStart = { x, y };
      canvas.setPointerCapture(e.pointerId);
      drawHighlightPreview(page, hlBaseline, hlStart, { x, y });
      return;
    }
    if(tool === 'pen' || tool === 'highlight' || tool === 'erase'){
      drawing = true;
      snapshot(page);
      lastX = x; lastY = y;
      canvas.setPointerCapture(e.pointerId);
      strokeSegment(page, x, y, x+0.01, y+0.01);
    }
  });

  canvas.addEventListener('pointermove', (e)=>{
    if(!drawing) return;
    const { x, y } = toLocal(e);
    if(state.tool === 'highlight' && hlBaseline){
      drawHighlightPreview(page, hlBaseline, hlStart, { x, y });
    } else {
      strokeSegment(page, lastX, lastY, x, y);
      lastX = x; lastY = y;
    }
  });

  function endStroke(e){
    if(drawing){
      drawing = false;
      hlBaseline = null;
      hlStart = null;
      try{ canvas.releasePointerCapture(e.pointerId); }catch(err){}
    }
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointerleave', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
}

/* Find the text line whose vertical band contains y (nearest line otherwise). */
function findLineAt(page, y){
  if(!page.lines || !page.lines.length) return null;
  let best = null, bestDist = Infinity;
  for(const line of page.lines){
    const top = line.y, bottom = line.y + line.height;
    if(y >= top - 2 && y <= bottom + 2) return line;
    const center = top + line.height / 2;
    const dist = Math.abs(center - y);
    if(dist < bestDist){ bestDist = dist; best = line; }
  }
  return best;
}

/* All lines whose vertical band falls within [yA, yB]. */
function linesBetween(page, yA, yB){
  if(!page.lines || !page.lines.length) return [];
  const top = Math.min(yA, yB), bottom = Math.max(yA, yB);
  const hit = page.lines.filter(l => (l.y + l.height) >= top - 1 && l.y <= bottom + 1);
  return hit.length ? hit.sort((a,b)=>a.y-b.y) : [];
}

/* Redraw the in-progress highlight from a saved pre-drag snapshot, so the
   rectangles always snap to whichever text line(s) the drag currently spans. */
function drawHighlightPreview(page, baseline, start, current){
  page.ctx.putImageData(baseline, 0, 0);

  let lines = linesBetween(page, start.y, current.y);
  if(!lines.length){
    const line = findLineAt(page, current.y);
    if(line) lines = [line];
  }
  if(!lines.length) return;

  const dragDistance = Math.hypot(current.x - start.x, current.y - start.y);
  const ctx = page.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = state.color;
  ctx.globalAlpha = 0.55;

  if(lines.length === 1){
    const line = lines[0];
    let x1, x2;
    if(dragDistance < 3){
      // simple click: highlight the whole line for convenience
      x1 = line.x; x2 = line.x + line.width;
    } else {
      x1 = Math.min(start.x, current.x);
      x2 = Math.max(start.x, current.x);
    }
    ctx.fillRect(x1, line.y, Math.max(x2 - x1, 2), line.height);
  } else {
    const upPoint = start.y <= current.y ? start : current;
    const downPoint = start.y <= current.y ? current : start;
    lines.forEach((line, idx)=>{
      let x1, x2;
      if(idx === 0){ x1 = upPoint.x; x2 = line.x + line.width; }
      else if(idx === lines.length - 1){ x1 = line.x; x2 = downPoint.x; }
      else { x1 = line.x; x2 = line.x + line.width; }
      if(x1 > x2){ const t = x1; x1 = x2; x2 = t; }
      ctx.fillRect(x1, line.y, Math.max(x2 - x1, 2), line.height);
    });
  }
  ctx.restore();
}

function strokeSegment(page, x1, y1, x2, y2){
  const ctx = page.ctx;
  ctx.save();
  if(state.tool === 'pen'){
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = state.color;
    ctx.globalAlpha = 1;
    ctx.lineWidth = state.size;
  } else if(state.tool === 'highlight'){
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = state.color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(state.size * 2.4, 14);
  } else if(state.tool === 'erase'){
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = Math.max(state.size * 2, 16);
  }
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function placeSymbol(page, x, y){
  const fontSize = Math.max(state.size * 5, 24);
  createPlacedItem(page, {
    type: 'symbol', x, y, text: state.symbol,
    fontSize, color: state.color, centered: true
  });
}

function placeImage(page, x, y){
  const pending = state.pendingImage;
  const img = new Image();
  img.onload = ()=>{
    const targetW = Math.min(page.cssWidth * 0.35, 220);
    const targetH = targetW * (img.height / img.width);
    createPlacedItem(page, {
      type: 'image', x: x - targetW/2, y: y - targetH/2, w: targetW, h: targetH,
      src: pending.src, naturalW: img.width, naturalH: img.height
    });
  };
  img.src = pending.src;
}

/* Unified factory for anything that lives on top of the page and can be
   dragged / resized / deleted while the Select tool is active:
   images, typed text, and stamped symbols. */
function createPlacedItem(page, opts){
  const el = document.createElement('div');
  el.className = 'placed-item placed-' + opts.type;

  const delBtn = document.createElement('div');
  delBtn.className = 'img-del';
  delBtn.textContent = '✕';
  delBtn.addEventListener('pointerdown', (e)=> e.stopPropagation());
  delBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    deletePlacedItem(page, record);
  });

  const handle = document.createElement('div');
  handle.className = 'img-handle';

  let record;

  if(opts.type === 'image'){
    el.style.left = opts.x + 'px';
    el.style.top = opts.y + 'px';
    el.style.width = opts.w + 'px';
    el.style.height = opts.h + 'px';
    const imgTag = document.createElement('img');
    imgTag.src = opts.src;
    imgTag.draggable = false;
    el.appendChild(imgTag);
    record = { type: 'image', el, src: opts.src, naturalW: opts.naturalW, naturalH: opts.naturalH };
    el.appendChild(delBtn);
    el.appendChild(handle);
    attachItemDrag(el, page);
    attachImageResize(el, handle, page);
  } else {
    // text / symbol: box auto-sizes to its content, so resizing only
    // needs to change font-size — the browser reflows the box for us.
    el.style.color = opts.color;
    el.style.fontSize = opts.fontSize + 'px';
    el.style.fontFamily = opts.type === 'symbol' ? 'sans-serif' : "Inter, sans-serif";
    el.textContent = opts.text;
    if(opts.centered){
      el.style.left = opts.x + 'px';
      el.style.top = opts.y + 'px';
      el.style.transform = 'translate(-50%, -50%)';
    } else {
      el.style.left = opts.x + 'px';
      el.style.top = opts.y + 'px';
    }
    record = { type: opts.type, el, text: opts.text, color: opts.color, fontSize: opts.fontSize, centered: !!opts.centered };
    el.appendChild(delBtn);
    el.appendChild(handle);
    attachItemDrag(el, page);
    attachFontResize(el, handle, record);
  }

  page.wrap.appendChild(el);
  page.placedItems.push(record);
  return record;
}

function deletePlacedItem(page, record){
  record.el.remove();
  const idx = page.placedItems.indexOf(record);
  if(idx > -1) page.placedItems.splice(idx, 1);
}

/* Drag-to-move — shared by every placed item type. The element's own
   transform (if centered) is preserved; only left/top change. */
function attachItemDrag(el, page){
  let startPointer = null, startLeft = 0, startTop = 0;
  el.addEventListener('pointerdown', (e)=>{
    if(e.target.classList.contains('img-handle') || e.target.classList.contains('img-del')) return;
    e.stopPropagation();
    startPointer = { x: e.clientX, y: e.clientY };
    startLeft = parseFloat(el.style.left) || 0;
    startTop = parseFloat(el.style.top) || 0;
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e)=>{
    if(!startPointer) return;
    const dx = e.clientX - startPointer.x;
    const dy = e.clientY - startPointer.y;
    el.style.left = (startLeft + dx) + 'px';
    el.style.top = (startTop + dy) + 'px';
  });
  function release(e){
    if(startPointer){
      startPointer = null;
      el.classList.remove('dragging');
      try{ el.releasePointerCapture(e.pointerId); }catch(err){}
    }
  }
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

function attachImageResize(el, handle, page){
  let startPointer = null, startW = 0, startH = 0;
  handle.addEventListener('pointerdown', (e)=>{
    e.stopPropagation();
    startPointer = { x: e.clientX, y: e.clientY };
    startW = el.offsetWidth;
    startH = el.offsetHeight;
    el.classList.add('resizing');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e)=>{
    if(!startPointer) return;
    const dx = e.clientX - startPointer.x;
    const dy = e.clientY - startPointer.y;
    const aspect = startW / startH;
    let newW = Math.max(24, startW + dx);
    let newH = Math.max(24, newW / aspect);
    // keep proportional sizing unless the user holds shift for free resize
    if(e.shiftKey){ newH = Math.max(24, startH + dy); }
    el.style.width = newW + 'px';
    el.style.height = newH + 'px';
  });
  function release(e){
    if(startPointer){
      startPointer = null;
      el.classList.remove('resizing');
      try{ handle.releasePointerCapture(e.pointerId); }catch(err){}
    }
  }
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
}

/* Text/symbol "resize" = scale the font-size; the box reflows to fit. */
function attachFontResize(el, handle, record){
  let startPointer = null, startSize = 0;
  handle.addEventListener('pointerdown', (e)=>{
    e.stopPropagation();
    startPointer = { x: e.clientX, y: e.clientY };
    startSize = record.fontSize;
    el.classList.add('resizing');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e)=>{
    if(!startPointer) return;
    const delta = (e.clientX - startPointer.x) + (e.clientY - startPointer.y);
    const newSize = Math.max(8, Math.min(220, startSize + delta * 0.6));
    record.fontSize = newSize;
    el.style.fontSize = newSize + 'px';
  });
  function release(e){
    if(startPointer){
      startPointer = null;
      el.classList.remove('resizing');
      try{ handle.releasePointerCapture(e.pointerId); }catch(err){}
    }
  }
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
}

/* ---- text popover ---- */
let textPopoverTarget = null;
function openTextPopover(page, x, y){
  textPopoverTarget = { page, x, y };
  const rect = page.wrap.getBoundingClientRect();
  textPopover.style.left = (rect.left + x) + 'px';
  textPopover.style.top = (rect.top + y) + 'px';
  textPopover.style.display = 'block';
  textPopoverInput.value = '';
  textPopoverInput.focus();
}
$('#textPopoverCancel').addEventListener('click', ()=>{
  textPopover.style.display = 'none';
  textPopoverTarget = null;
});
$('#textPopoverOk').addEventListener('click', ()=>{
  if(!textPopoverTarget) return;
  const { page, x, y } = textPopoverTarget;
  const text = textPopoverInput.value;
  if(text.trim()){
    createPlacedItem(page, {
      type: 'text', x, y, text,
      fontSize: state.fontSize, color: state.color
    });
  }
  textPopover.style.display = 'none';
  textPopoverTarget = null;
});

/* ============================================================
   EXPORT (flatten annotations into the PDF with pdf-lib)
============================================================ */
async function flattenDocToBytes(doc){
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.load(doc.originalBytes.slice(0));
  const pdfPages = pdfDoc.getPages();

  for(let i = 0; i < doc.pages.length; i++){
    const pageObj = doc.pages[i];
    const pdfPage = pdfPages[i];
    const { width, height } = pdfPage.getSize();

    // 1) pen / highlight / text / symbol strokes (already rasterized on the canvas)
    const dataUrl = pageObj.annotCanvas.toDataURL('image/png');
    const pngBytes = dataUrl.split(',')[1];
    const pngImage = await pdfDoc.embedPng(base64ToUint8Array(pngBytes));
    pdfPage.drawImage(pngImage, { x: 0, y: 0, width, height });

    // 2) user-placed images, text, and symbols — wherever they were left
    const scaleX = width / pageObj.cssWidth;
    const scaleY = height / pageObj.cssHeight;
    for(const item of pageObj.placedItems){
      const el = item.el;
      const cssW = el.offsetWidth;
      const cssH = el.offsetHeight;
      let cssLeft = parseFloat(el.style.left) || 0;
      let cssTop = parseFloat(el.style.top) || 0;
      if(item.centered){
        // symbols are placed with a translate(-50%,-50%) anchor
        cssLeft -= cssW / 2;
        cssTop -= cssH / 2;
      }

      const pdfW = cssW * scaleX;
      const pdfH = cssH * scaleY;
      const pdfX = cssLeft * scaleX;
      const pdfY = height - (cssTop * scaleY) - pdfH;

      let embedded;
      if(item.type === 'image'){
        embedded = await embedImageAuto(pdfDoc, item.src);
      } else {
        const dataUrl = rasterizeTextItem(item, cssW, cssH);
        embedded = await pdfDoc.embedPng(base64ToUint8Array(dataUrl.split(',')[1]));
      }
      pdfPage.drawImage(embedded, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
    }
  }

  return pdfDoc.save();
}

/* Re-draw a placed text/symbol element onto an offscreen canvas at its
   on-screen size, so it embeds with exactly the glyphs shown (this also
   sidesteps PDF standard-font limitations with unicode symbol characters). */
function rasterizeTextItem(item, cssW, cssH){
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, cssW * dpr);
  c.height = Math.max(1, cssH * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = item.color;
  ctx.font = `${item.fontSize}px ${item.type === 'symbol' ? 'sans-serif' : 'Inter, sans-serif'}`;
  ctx.textBaseline = 'top';
  if(item.type === 'symbol'){
    ctx.textAlign = 'center';
    ctx.fillText(item.text, cssW / 2, (cssH - item.fontSize) / 2);
  } else {
    ctx.textAlign = 'left';
    const lineHeight = item.fontSize * 1.25;
    item.text.split('\n').forEach((line, i)=>{
      ctx.fillText(line, 0, i * lineHeight);
    });
  }
  return c.toDataURL('image/png');
}

async function embedImageAuto(pdfDoc, dataUrl){
  const isJpeg = /^data:image\/jpe?g/i.test(dataUrl);
  const base64 = dataUrl.split(',')[1];
  const bytes = base64ToUint8Array(base64);
  try{
    return isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
  }catch(err){
    // fall back: re-encode through canvas as PNG (covers gif/webp/etc.)
    const png = await reencodeAsPng(dataUrl);
    return pdfDoc.embedPng(base64ToUint8Array(png.split(',')[1]));
  }
}

function reencodeAsPng(dataUrl){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>{
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function exportDoc(doc){
  const exportBtn = $('#exportBtn');
  exportBtn.disabled = true;
  const originalLabel = exportBtn.innerHTML;
  exportBtn.innerHTML = 'Exporting…';
  try{
    const outBytes = await flattenDocToBytes(doc);
    downloadBlob(new Blob([outBytes], { type: 'application/pdf' }), renamedFile(doc.name));
  } catch(err){
    console.error(err);
    showHint('Export failed — see console for details.');
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML = originalLabel;
  }
}

function orderedDocIds(){
  // tab order on screen = merge order, not arbitrary object-key order
  return Array.from(document.querySelectorAll('.tab[data-doc-id]')).map(t => t.dataset.docId);
}

async function mergeAllDocs(){
  const ids = orderedDocIds();
  if(ids.length < 2){
    showHint(ids.length === 1 ? 'Open at least 2 PDFs to merge.' : 'Upload PDFs first.');
    return;
  }
  const mergeBtn = $('#mergeBtn');
  mergeBtn.disabled = true;
  const originalLabel = mergeBtn.innerHTML;
  mergeBtn.innerHTML = 'Merging…';
  try{
    const { PDFDocument } = PDFLib;
    const mergedPdf = await PDFDocument.create();

    for(const id of ids){
      const doc = state.docs[id];
      if(!doc) continue;
      const flatBytes = await flattenDocToBytes(doc);
      const srcPdf = await PDFDocument.load(flatBytes);
      const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
      copiedPages.forEach(p => mergedPdf.addPage(p));
    }

    const outBytes = await mergedPdf.save();
    downloadBlob(new Blob([outBytes], { type: 'application/pdf' }), 'merged.pdf');
    showHint(`Merged ${ids.length} PDFs into one file.`);
  } catch(err){
    console.error(err);
    showHint('Merge failed — see console for details.');
  } finally {
    mergeBtn.disabled = false;
    mergeBtn.innerHTML = originalLabel;
  }
}

function base64ToUint8Array(base64){
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function renamedFile(name){
  const dot = name.lastIndexOf('.');
  const base = dot > -1 ? name.slice(0, dot) : name;
  return `${base}-edited.pdf`;
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 2000);
}

/* ============================================================
   KEYBOARD SHORTCUTS
============================================================ */
window.addEventListener('keydown', (e)=>{
  if(e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){
    e.preventDefault();
    const page = getVisiblePage();
    if(page) undoPage(page);
  }
  const map = { v:'select', p:'pen', h:'highlight', t:'text', s:'symbol', e:'erase' };
  if(map[e.key.toLowerCase()]){
    setTool(map[e.key.toLowerCase()]);
  }
});

/* drop-to-upload */
window.addEventListener('dragover', (e)=> e.preventDefault());
window.addEventListener('drop', (e)=>{
  e.preventDefault();
  if(e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
});

/* ============================================================
   ERASER CURSOR (visible circle matching the actual erase radius)
============================================================ */
function hideEraserCursor(){
  eraserCursor.style.display = 'none';
}
function eraserDiameter(){
  return Math.max(state.size * 2, 16);
}
window.addEventListener('pointermove', (e)=>{
  if(state.tool !== 'erase'){ return; }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if(el && el.classList && el.classList.contains('annot-canvas')){
    const d = eraserDiameter();
    eraserCursor.style.width = d + 'px';
    eraserCursor.style.height = d + 'px';
    eraserCursor.style.left = e.clientX + 'px';
    eraserCursor.style.top = e.clientY + 'px';
    eraserCursor.style.display = 'block';
  } else {
    hideEraserCursor();
  }
});
window.addEventListener('pointerleave', hideEraserCursor);