/* ============================================================
   HIGHLIGHT FIX + EDITOR HOOKS
============================================================ */
(function () {
  function cloneBox(box) {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  window.computeTextLines = async function computeTextLines(pdfPage, viewport) {
    const textContent = await pdfPage.getTextContent();
    const items = [];

    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const scaleX = Math.hypot(tx[0], tx[1]);
      const scaleY = Math.hypot(tx[2], tx[3]);
      const height = (item.height ? item.height * scaleY : scaleY) || 10;
      const width = (item.width ? item.width * scaleX : 0);
      const x = tx[4];
      const top = tx[5] - height;
      if (width > 0) {
        items.push({ x, y: top, width, height, str: item.str });
      }
    }

    items.sort((a, b) => a.y - b.y || a.x - b.x);

    const lines = [];
    const Y_TOL = 4;

    for (const it of items) {
      let line = lines.find(l => Math.abs(l.y - it.y) <= Y_TOL);
      if (!line) {
        line = { y: it.y, height: it.height, minX: it.x, maxX: it.x + it.width, items: [cloneBox(it)] };
        lines.push(line);
      } else {
        line.minX = Math.min(line.minX, it.x);
        line.maxX = Math.max(line.maxX, it.x + it.width);
        line.height = Math.max(line.height, it.height);
        line.items.push(cloneBox(it));
      }
    }

    for (const line of lines) {
      line.x = line.minX;
      line.width = Math.max(1, line.maxX - line.minX);
      line.items.sort((a, b) => a.x - b.x);
    }

    return lines;
  };

  function intersect(a1, a2, b1, b2) {
    return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  }

  window.drawHighlightPreview = function drawHighlightPreview(page, baseline, start, current) {
    page.ctx.putImageData(baseline, 0, 0);

    let lines = window.linesBetween(page, start.y, current.y);
    if (!lines.length) {
      const line = window.findLineAt(page, current.y);
      if (line) lines = [line];
    }
    if (!lines.length) return;

    const dragDistance = Math.hypot(current.x - start.x, current.y - start.y);
    const ctx = page.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = state.color;
    ctx.globalAlpha = 0.55;

    const drawLineSegments = (line, x1, x2) => {
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const segments = (line.items && line.items.length) ? line.items : [{ x: line.x, y: line.y, width: line.width, height: line.height }];
      for (const box of segments) {
        const ix = Math.max(box.x, left);
        const iw = intersect(box.x, box.x + box.width, left, right);
        if (iw > 0) {
          ctx.fillRect(ix, line.y, Math.max(iw, 2), line.height);
        }
      }
    };

    if (lines.length === 1) {
      const line = lines[0];
      if (dragDistance < 3) {
        drawLineSegments(line, line.x, line.x + line.width);
      } else {
        drawLineSegments(line, Math.min(start.x, current.x), Math.max(start.x, current.x));
      }
    } else {
      const upPoint = start.y <= current.y ? start : current;
      const downPoint = start.y <= current.y ? current : start;
      lines.forEach((line, idx) => {
        let x1, x2;
        if (idx === 0) x1 = upPoint.x, x2 = line.x + line.width;
        else if (idx === lines.length - 1) x1 = line.x, x2 = downPoint.x;
        else x1 = line.x, x2 = line.x + line.width;
        drawLineSegments(line, x1, x2);
      });
    }

    ctx.restore();
  };

  window.exportDoc = async function exportDoc(doc) {
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.innerHTML = 'Exporting…';
    }

    try {
      const outBytes = await window.flattenDocToBytes(doc);
      const filename = window.renamedFile ? window.renamedFile(doc.name) : `${doc.name.replace(/\.pdf$/i, '')}-edited.pdf`;
      window.downloadBlob(new Blob([outBytes], { type: 'application/pdf' }), filename);

      if (window.cloudSaveEditedPdf) {
        await window.cloudSaveEditedPdf(doc, outBytes, filename);
      }
    } catch (err) {
      console.error(err);
      if (typeof showHint === 'function') showHint('Export failed — see console for details.');
    } finally {
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
          Export PDF
        `;
      }
    }
  };

  window.editorAPI = {
    get state() { return window.state; },
    get activeDoc() {
      return window.state?.docs?.[window.state.activeDocId] || null;
    },
    exportDoc: (...args) => window.exportDoc(...args),
    flattenDocToBytes: (...args) => window.flattenDocToBytes(...args)
  };
})();
