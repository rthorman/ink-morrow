// Scene imagery: condense the current page into a tone-honoring image prompt,
// paint it with cast identity references (announce-and-wait on moderation
// refusals, reference-dropping after a second refusal), and the zoomable/
// pannable viewer whose painting can be bound into the tale as a plate.

import { SCENE_RENDER_VARIANTS } from '../../core/state.js';
import { formatUsd } from '../../core/dom.js';
import { approxCostText, estimatePageCost } from '../../core/cost.js';
import { wireModal } from '../../core/dialogs.js';

export function createImagery({ api, state, notify, shell, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess, scribeErrorMessage } = notify;
  const { settings, data } = state;
  const IMAGE_PROMPT_BUTTON_LABEL = 'Scene image';

  // Moderation escalation state: refused once -> rewrite + repaint; refused
  // twice in a row -> the cast portraits are probably what offends; drop them.
  let sceneRefusals = 0;
  let dropSceneReferences = false;
  let imageryReviewing = false; // a paid-consent check is running: no second submission
  let imagePromptModal = null; // wired lifecycle controllers
  let sceneViewerModal = null;

  // Viewer state.
  let sceneViewerDataUrl = null;
  let sceneViewerMediaType = null;
  let sceneViewerPrompt = null;
  let sceneViewerCostUsd = null;
  let sceneViewerFilename = 'scene.png';
  let viewerScale = 1;
  let viewerX = 0;
  let viewerY = 0;

  function applySceneViewerTransform() {
    const img = document.getElementById('sceneViewerImg');
    if (img) img.style.transform = `translate(${viewerX}px, ${viewerY}px) scale(${viewerScale})`;
  }

  function resetSceneViewer() {
    viewerScale = 1;
    viewerX = 0;
    viewerY = 0;
    applySceneViewerTransform();
  }

  function openSceneViewer(dataUrl, mediaType, meta = {}) {
    const modal = document.getElementById('sceneImageViewerModal');
    const img = document.getElementById('sceneViewerImg');
    if (!modal || !img) return;
    sceneViewerDataUrl = dataUrl;
    sceneViewerMediaType = mediaType || null;
    sceneViewerPrompt = typeof meta.prompt === 'string' && meta.prompt.trim() ? meta.prompt.trim() : null;
    sceneViewerCostUsd = typeof meta.costUsd === 'number' && Number.isFinite(meta.costUsd) ? meta.costUsd : null;
    const ext = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png';
    sceneViewerFilename = `scene-page-${data.currentStory ? data.currentPage : 0}.${ext}`;
    img.src = dataUrl;
    sceneViewerModal.open(); // wired lifecycle: the viewer locks the background too
    resetSceneViewer();
  }

  function closeSceneViewer() {
    sceneViewerModal.close(); // restores focus (to the prompt popup or the opener), unlocks
    const img = document.getElementById('sceneViewerImg');
    if (img) img.removeAttribute('src');
    sceneViewerDataUrl = null;
    sceneViewerMediaType = null;
    sceneViewerPrompt = null;
    sceneViewerCostUsd = null;
    resetSceneViewer();
  }

  // Bind the painting on display into the story: a new image page lands right
  // after the one it illustrates, both modals close, and the reader turns to
  // the fresh plate.
  async function addSceneAsPage() {
    const { currentStory, currentPage, storyPages } = data;
    if (!sceneViewerDataUrl || !currentStory || currentPage < 1 || currentPage > storyPages.length) return;
    const btn = document.getElementById('sceneViewerAddPageBtn');
    // Capture everything BEFORE closing: closeSceneViewer wipes the viewer state.
    const comma = sceneViewerDataUrl.indexOf(',');
    const base64 = sceneViewerDataUrl.startsWith('data:') && comma > 0 ? sceneViewerDataUrl.slice(comma + 1) : sceneViewerDataUrl;
    const mediaType = sceneViewerMediaType;
    const prompt = sceneViewerPrompt;
    const costUsd = sceneViewerCostUsd;
    if (!mediaType || !base64) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Binding…';
    }
    try {
      const res = await apiCall(`/stories/${currentStory.id}/pages/${currentPage}/image-page`, 'POST', {
        image: base64,
        media_type: mediaType,
        ...(prompt ? { prompt } : {}),
        ...(typeof costUsd === 'number' ? { cost_usd: costUsd } : {}),
      });
      closeSceneViewer();
      imagePromptModal.close();
      features.generation.discardSpeculative(); // a live write: any prepared next page is stale now
      const list = await apiCall(`/stories/${currentStory.id}/pages`);
      data.storyPages = list.pages || [];
      data.currentPage = Math.max(1, Math.min(data.storyPages.length, res.page.page_number));
      features.write.displayCurrentPage();
      showSuccess(`The painting is bound into the tale as page ${res.page.page_number}.`);
      shell.checkDiskSpace(); // a plate just landed on disk — the banner must know
    } catch (error) {
      showError(scribeErrorMessage(error.message)); // floats above the open modals
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Add as page';
      }
    }
  }

  function saveSceneViewer() {
    if (!sceneViewerDataUrl) return;
    const a = document.createElement('a');
    a.href = sceneViewerDataUrl;
    a.download = sceneViewerFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Zoom by `factor`, keeping the screen point (clientX/clientY) under the
  // cursor pinned to the same image point; no anchor = zoom about the center.
  function zoomSceneViewerAt(factor, clientX, clientY) {
    const img = document.getElementById('sceneViewerImg');
    if (!img || !img.getAttribute('src')) return;
    const nextScale = Math.min(8, Math.max(0.25, viewerScale * factor));
    if (nextScale === viewerScale) return;
    const rect = img.getBoundingClientRect();
    const tcx = rect.left + rect.width / 2; // transformed center
    const tcy = rect.top + rect.height / 2;
    const ax = typeof clientX === 'number' ? clientX : tcx;
    const ay = typeof clientY === 'number' ? clientY : tcy;
    const px = (ax - tcx) / viewerScale; // image-space point under the anchor
    const py = (ay - tcy) / viewerScale;
    const lcx = tcx - viewerX; // layout (untranslated) center
    const lcy = tcy - viewerY;
    viewerScale = nextScale;
    viewerX = ax - lcx - px * viewerScale;
    viewerY = ay - lcy - py * viewerScale;
    applySceneViewerTransform();
  }

  function readyCastReferences() {
    const { currentStory } = data;
    if (!currentStory) return [];
    const cast = (currentStory.characters || [])
      .slice()
      .sort((a, b) => {
        const rank = (c) => (c.role === 'mc' ? 0 : c.role === 'supporting' ? 1 : 2);
        return rank(a) - rank(b);
      });
    const refs = [];
    for (const entry of cast) {
      if (refs.length >= 3) break;
      const character = state.data.characters.find((c) => c.id === entry.id);
      if (character && character.image_status === 'ready') refs.push(character.name);
    }
    return refs;
  }

  function updatePaintButtonPrice() {
    const btn = document.getElementById('imagePromptGenerateBtn');
    if (!btn) return;
    const variant = SCENE_RENDER_VARIANTS.has(settings.sceneRenderQuality) ? settings.sceneRenderQuality : 'low_1k';
    btn.textContent = variant === 'medium_2k' ? 'Paint scene (≈$0.08)' : 'Paint scene (≈$0.04)';
  }

  async function generateSceneImage() {
    const { currentStory, currentPage, storyPages } = data;
    if (!currentStory || currentPage < 1 || currentPage > storyPages.length) {
      showError('Select a page to illustrate first.');
      return;
    }
    const box = document.getElementById('imagePromptText');
    const btn = document.getElementById('imagePromptGenerateBtn');
    const costEl = document.getElementById('sceneImageCost');
    if (!box || !btn) return;
    const prompt = box.value.trim();
    if (!prompt) {
      showError('The prompt box is empty — condense the scene first.');
      return;
    }
    // The paid paint commitment: resolution, identity references, and the
    // possible moderation rewrite are all disclosed before the press costs.
    const variant = SCENE_RENDER_VARIANTS.has(settings.sceneRenderQuality) ? settings.sceneRenderQuality : 'low_1k';
    const paintEstimate = variant === 'medium_2k' ? 0.08 : 0.04;
    const rewriteEstimate = estimatePageCost({
      models: state.modelsCache,
      model: settings.model,
      wordsPerPage: 90,
      pageChars: prompt.length,
    });
    const retryMaximum = typeof rewriteEstimate === 'number' && Number.isFinite(rewriteEstimate)
      ? Math.max(paintEstimate, rewriteEstimate * 3)
      : null;
    const refs = readyCastReferences();
    if (imageryReviewing) return;
    imageryReviewing = true;
    const yes = await dialogs.confirmPaid({
      title: 'Paint this scene?',
      review: {
        action: `Paint page ${currentPage} of "${currentStory.title}" from the prompt in the box.`,
        object: `page ${currentPage} of "${currentStory.title}"`,
        quantity: variant === 'medium_2k' ? 'one 2K painting (≈$0.08)' : 'one 1K painting (≈$0.04)',
        sends: dropSceneReferences
          ? 'the prompt text only (cast portraits are dropped after repeat refusals)'
          : refs.length > 0
            ? `the prompt text and ${refs.length} cast portrait${refs.length === 1 ? '' : 's'} (${refs.join(', ')}) as identity reference${refs.length === 1 ? '' : 's'}`
            : 'the prompt text only (no cast portraits are ready)',
        also: `if the image model refuses, the scribe rewrites the prompt safely and that rewrite is billed (${approxCostText(rewriteEstimate)} before any retry)`,
        estimate: paintEstimate,
        maximum: retryMaximum,
        note: 'A refusal paints nothing: image billing is all-or-nothing, only the rewrite costs.',
      },
      confirmLabel: `Paint it (${approxCostText(paintEstimate)})`,
    });
    imageryReviewing = false;
    if (!yes) return; // cancel: the prompt stays in the box, nothing is sent
    btn.disabled = true;
    btn.textContent = 'Painting…';
    if (costEl) costEl.hidden = true;
    try {
      const res = await apiCall(`/stories/${currentStory.id}/pages/${currentPage}/scene-image`, 'POST', {
        prompt,
        render: variant,
        ...(settings.model ? { model: settings.model } : {}),
        ...(features.settings.reasoningApplies() ? { reasoning_effort: settings.reasoningEffort || 'medium' } : {}),
        ...(dropSceneReferences ? { drop_references: true } : {}),
      });
      // The moderator refused. Do NOT repaint: announce, put the rewritten
      // prompt in the box, and wait for the user to press Generate again.
      if (res.refused) {
        sceneRefusals++;
        box.value = res.sanitized_prompt || prompt;
        if (typeof res.rewrite_cost_usd === 'number' && res.rewrite_cost_usd > 0) {
          state.addCost(res.rewrite_cost_usd); // the rewrite LLM billed either way
        }
        if (sceneRefusals >= 2) {
          dropSceneReferences = true;
          showSuccess('Refused again — the scribe suspects the cast portraits. The next painting drops them. Review the rewritten prompt and press Generate image.');
        } else {
          showSuccess('The image model refused this draft (' + (res.reason || 'no reason given') + '). The scribe rewrote it — review the prompt box and press Generate image again.');
        }
        return;
      }
      sceneRefusals = 0;
      dropSceneReferences = false;
      openSceneViewer(`data:${res.media_type};base64,${res.image}`, res.media_type, { prompt, costUsd: res.cost_usd });
      if (costEl && typeof res.cost_usd === 'number') {
        const refs = Array.isArray(res.references) ? res.references.length : 0;
        costEl.textContent =
          `This painting cost ${formatUsd(res.cost_usd)}` +
          (refs > 0 ? ` · ${refs} cast portrait${refs > 1 ? 's' : ''} as reference${refs > 1 ? 's' : ''}` : '');
        costEl.hidden = false;
        state.addCost(res.cost_usd); // scene images belong to the tale: session + story
      }
    } catch (error) {
      state.addCost(error.costUsd); // a failed local rewrite may still have billed the tale
      showError(scribeErrorMessage(error.message));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate image';
    }
  }

  async function generateImagePrompt() {
    const { currentStory, currentPage, storyPages } = data;
    if (!currentStory || currentPage < 1 || currentPage > storyPages.length) {
      showError('Select a page to illustrate first.');
      return;
    }
    const btn = document.getElementById('imagePromptBtn');
    const modal = document.getElementById('imagePromptModal');
    const box = document.getElementById('imagePromptText');
    if (!modal || !box) return;
    // The condensation is paid writing-model work: pass the remembered
    // consent gate before sending it.
    const page = storyPages.find((p) => p.page_number === currentPage);
    const estimate = estimatePageCost({
      models: state.modelsCache,
      model: settings.model,
      wordsPerPage: 90, // a condensed scene prompt is short prose
      pageChars: String(page?.content || '').length,
    });
    const retryMaximum = typeof estimate === 'number' && Number.isFinite(estimate) ? estimate * 3 : null;
    if (imageryReviewing) return;
    imageryReviewing = true;
    const yes = await dialogs.confirmPaid({
      title: 'Condense this page into a prompt?',
      review: {
        action: `Condense page ${currentPage} of "${currentStory.title}" into an editable image prompt.`,
        object: `page ${currentPage} of "${currentStory.title}"`,
        model: settings.model || 'the scribe\u2019s default model',
        quantity: 'a short prompt draft (≈90 words)',
        sends: 'the text of this page to the writing model',
        estimate,
        maximum: retryMaximum,
        note: 'You review and may edit the prompt before anything is painted. A failed quality check can require up to three billable attempts.',
      },
      confirmLabel: `Condense it (${approxCostText(estimate)})`,
    });
    imageryReviewing = false;
    if (!yes) return; // cancel: no condensation, no modal
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Thinking…';
    }
    try {
      const res = await apiCall(`/stories/${currentStory.id}/pages/${currentPage}/image-prompt`, 'POST', {
        ...(settings.model ? { model: settings.model } : {}),
        ...(features.settings.reasoningApplies() ? { reasoning_effort: settings.reasoningEffort || 'medium' } : {}),
      });
      box.value = res.prompt || '';
      state.addCost(res.cost_usd); // condensation is paid work for this story
      sceneRefusals = 0; // a fresh condense resets the moderation escalation
      dropSceneReferences = false;
      const costEl = document.getElementById('sceneImageCost');
      if (costEl) {
        // Before the paid press: which identity references ride along.
        const refs = readyCastReferences();
        costEl.textContent = dropSceneReferences
          ? 'Identity references are dropped (after repeat refusals).'
          : refs.length > 0
            ? `Identity references: ${refs.join(', ')}`
            : 'No cast portraits are ready - the scene paints without identity references.';
        costEl.hidden = false;
      }
      updatePaintButtonPrice();
      imagePromptModal.open(); // wired lifecycle: focus entry, scroll lock, opener
    } catch (error) {
      state.addCost(error.costUsd);
      showError(scribeErrorMessage(error.message));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = IMAGE_PROMPT_BUTTON_LABEL;
      }
    }
  }

  function init() {
    // Registered FIRST so Escape dismisses the viewer before the prompt popup.
    const modal = document.getElementById('sceneImageViewerModal');
    const img = document.getElementById('sceneViewerImg');
    if (modal && img) {
      img.addEventListener('wheel', (event) => {
        event.preventDefault();
        zoomSceneViewerAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
      });
      img.addEventListener('dblclick', (event) => {
        if (viewerScale > 1.05) {
          // Back to the full view, pan reset - a clean overview, not a half-shifted one
          viewerScale = 1;
          viewerX = 0;
          viewerY = 0;
          applySceneViewerTransform();
        } else {
          zoomSceneViewerAt(2.5, event.clientX, event.clientY); // zoom into where the eye landed
        }
      });

      // Pointer pan (one finger / mouse drag) and pinch zoom (two fingers)
      const pointers = new Map();
      img.addEventListener('pointerdown', (event) => {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (typeof img.setPointerCapture === 'function') {
          try { img.setPointerCapture(event.pointerId); } catch { /* jsdom */ }
        }
      });
      img.addEventListener('pointermove', (event) => {
        const prev = pointers.get(event.pointerId);
        if (!prev) return;
        if (pointers.size === 1) {
          viewerX += event.clientX - prev.x;
          viewerY += event.clientY - prev.y;
          applySceneViewerTransform();
        } else if (pointers.size === 2) {
          const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
          const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
          const dist = Math.hypot(event.clientX - other.x, event.clientY - other.y);
          const midX = (event.clientX + other.x) / 2;
          const midY = (event.clientY + other.y) / 2;
          if (prevDist > 0 && dist > 0) zoomSceneViewerAt(dist / prevDist, midX, midY);
        }
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      });
      const endPointer = (event) => pointers.delete(event.pointerId);
      img.addEventListener('pointerup', endPointer);
      img.addEventListener('pointercancel', endPointer);

      document.getElementById('sceneViewerAddPageBtn')?.addEventListener('click', addSceneAsPage);
      document.getElementById('sceneViewerSaveBtn')?.addEventListener('click', saveSceneViewer);
      document.getElementById('sceneViewerCloseBtn')?.addEventListener('click', closeSceneViewer);
      // The viewer is structurally distinct (an image, not a form) but lives
      // on the SAME wired lifecycle: on top of the prompt popup in the modal
      // stack, Escape dismisses the viewer first, focus returns underneath.
      sceneViewerModal = wireModal('sceneImageViewerModal', { focusId: 'sceneViewerCloseBtn' });
    }

    const btn = document.getElementById('imagePromptBtn');
    if (btn) btn.addEventListener('click', generateImagePrompt);
    const renderSelect = document.getElementById('imageQualitySelect');
    if (renderSelect) renderSelect.addEventListener('change', () => {
      state.setSetting('sceneRenderQuality', renderSelect.value);
      updatePaintButtonPrice();
    });
    const generateBtn = document.getElementById('imagePromptGenerateBtn');
    if (generateBtn) generateBtn.addEventListener('click', generateSceneImage);
    // The prompt popup: no dirty guard - its box keeps its text either way.
    imagePromptModal = wireModal('imagePromptModal', { focusId: 'imagePromptText' });
    const cancel = document.getElementById('imagePromptCancelBtn');
    if (cancel) cancel.addEventListener('click', () => imagePromptModal.close());
  }

  return {
    generateImagePrompt,
    generateSceneImage,
    openSceneViewer,
    closeSceneViewer,
    saveSceneViewer,
    addSceneAsPage,
    __sceneModerationState: () => ({ refusals: sceneRefusals, dropReferences: dropSceneReferences }),
    __sceneViewerState: () => ({ scale: viewerScale, x: viewerX, y: viewerY, dataUrl: sceneViewerDataUrl }),
    init,
  };
}
