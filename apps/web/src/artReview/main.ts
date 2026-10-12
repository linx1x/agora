import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './review.css';
import { DIRECTIONS, canvas, loadReviewArt } from './art';
import { ICONS, PROPS } from './catalog';
import { ReviewScene } from './scene';
import { REVIEW_CROPS, type ReviewCrop } from './crops';
import { CROP_STAGES } from './cropSoil';
import { mountPlantCollection } from './plantCollection';
import { mountBiomeReview } from './biomes/review';

const mount = document.querySelector<HTMLDivElement>('#review')!;

async function start(): Promise<void> {
  const art = await loadReviewArt();
  mount.innerHTML = `
    <header class="review-header">
      <a class="wordmark" href="/" aria-label="Return to Agora"><span class="brand-mark">a</span> agora<span class="wordmark-dot">.</span></a>
      <div class="header-title"><span class="eyebrow">THE ART STUDIO</span><span>A little more life.</span></div>
      <span class="review-badge"><i></i> Art direction · 08</span>
    </header>
    <main class="review-layout">
      <section class="workspace" aria-label="Scene preview">
        <div class="scene-toolbar">
          <div class="segmented" aria-label="Compare artwork">
            <button id="new-art" class="active" aria-pressed="true">New artwork</button>
            <button id="old-art" aria-pressed="false">Current artwork</button>
          </div>
          <div class="view-controls"><button id="ambience" aria-pressed="true">Pause wildlife</button><button id="light" aria-pressed="false">Daylight</button><button id="grid" aria-pressed="false">Grid</button><button id="gallery-open">All sprites ↗</button></div>
        </div>
        <div class="scene-wrap">
          <div id="stage"></div>
          <div class="location-card"><span class="eyebrow">AGORA / MEADOW</span><strong>The garden office</strong><span class="location-sub">A familiar place, freshly drawn.</span></div>
          <div class="clock-card"><span class="sun-symbol">☀</span><div><strong id="scene-time">10:30 AM</strong><span id="scene-weather">A quiet, sunny morning</span></div></div>
          <div class="world-tag">2.5D · Sample scene</div>
          <div class="hotbar-wrap"><div class="hotbar" aria-label="Sample inventory"></div><div id="item-status" class="item-status" aria-live="polite">Axe · Inventory artwork preview</div></div>
          <div class="move-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Click the scene, then walk. Click an object to inspect it.</span></div>
          <div class="zoom-control"><label for="zoom">Zoom</label><input id="zoom" aria-label="Scene zoom" type="range" min="85" max="150" value="110" step="5" /><output id="zoom-value">110%</output></div>
        </div>
        <footer class="scene-footer"><span><i></i> Original art · Existing biomes</span><span>Review build / 08</span></footer>
      </section>
      <aside class="inspector">
        <div class="inspector-heading"><span class="eyebrow">UP CLOSE</span><h1>Made to belong.</h1><p>Warm materials. Clear silhouettes.<br>A world with a little more character.</p></div>
        <section class="specimen"><div class="section-label"><span>01 / OBJECTS</span><span id="object-index">01 of 16</span></div><div class="object-preview" id="object-preview"></div><div class="object-caption"><strong id="object-title">Oak tree</strong><span class="small-tag">Existing item</span></div><code id="object-id">oak_tree</code><div class="object-strip" aria-label="Inspect object"></div></section>
        <section class="character-section"><div class="section-label"><span>02 / CHARACTER</span><button id="animate" aria-pressed="true">Pause</button></div><div class="character-demo"><div id="avatar-preview"></div><div><strong>A new face for Agora</strong><p>Pixel art, four directions.<br>One complete walk cycle.</p></div></div><div class="directions" aria-label="Character direction">${DIRECTIONS.map((d, i) => `<button data-dir="${i}" aria-pressed="${i === 0}" class="${i === 0 ? 'active' : ''}">${{ down: 'Front', left: 'Left', right: 'Right', up: 'Back' }[d]}</button>`).join('')}</div></section>
        <section class="palette-section"><div class="section-label"><span>03 / COLOUR & MATERIAL</span></div><div class="swatches">${['#293f3b', '#4f7150', '#8d9f54', '#dbc18c', '#b9814d', '#3e7782', '#f0e2be'].map((c) => `<span style="background:${c}" title="${c}"></span>`).join('')}</div><p>Forest shade · Honey oak · Soft linen</p></section>
        <section class="growth-section"><div class="section-label"><span>04 / TREE GROWTH</span></div><div id="growth-preview" class="growth-preview"></div><div class="directions">${['Seedling', 'Sapling', 'Young', 'Mature'].map((s, i) => `<button data-stage="${i}" aria-pressed="${i === 3}" class="${i === 3 ? 'active' : ''}">${s}</button>`).join('')}</div><p class="growth-caption">Change the main trees' age. The small grove shows three younger stages together.</p></section>
        <section class="growth-section"><div class="section-label"><span>05 / BED PLACEMENT</span></div><div class="directions"><button data-bed="vertical" class="active" aria-pressed="true">Vertical ↕</button><button data-bed="horizontal" aria-pressed="false">Horizontal ↔</button></div><p class="growth-caption">In your world, hold a bed and use Turn or R before placing it.</p></section>
        <section class="growth-section"><div class="section-label"><span>06 / CROP GARDEN</span><button id="water-crops">Water crops</button></div><div class="directions">${REVIEW_CROPS.filter(
          (c) => ['dawn_radish', 'meadow_kale', 'honey_pea'].includes(c.id),
        )
          .map(
            (c, i) =>
              `<button data-crop="${c.id}" aria-pressed="${i === 0}" class="${i === 0 ? 'active' : ''}">${c.short}</button>`,
          )
          .join(
            '',
          )}</div><label class="crop-growth-control" for="crop-growth">Garden growth<select id="crop-growth"><option value="-1">Mixed stages</option>${CROP_STAGES.map((s, i) => `<option value="${i}">${s}</option>`).join('')}</select></label><div id="crop-preview" class="crop-preview"></div><p id="crop-caption" class="growth-caption" aria-live="polite">Dawn radish · Five growth stages. Leaves flutter while the bulb stays rooted.</p></section>
        <div class="review-note"><span class="eyebrow">A LIVING CLEARING</span><p>Radish leaves flutter, kale rustles, and pea vines sway. Water the garden to see leaves nod and soil darken. Pause wildlife freezes the garden too.</p></div>
      </aside>
    </main>
    <dialog id="sprite-gallery"><div class="gallery-heading"><div><span class="eyebrow">THE FIRST COLLECTION</span><h2>Every little detail.</h2></div><button id="gallery-close" aria-label="Close sprite gallery">Close ×</button></div><p>Original artwork for the existing Agora catalogue. Select a prop to inspect it in the scene.</p><div id="gallery-props" class="gallery-grid"></div><h3>Inventory & interface</h3><div id="gallery-icons" class="gallery-grid icons-grid"></div></dialog>
  `;
  const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
    document.getElementById(id) as T;
  const scene = new ReviewScene(el('stage'), art, selectProp);
  scene.zoom = 1.1;
  scene.resize();
  const collection = mountPlantCollection(art, scene, showCrops);
  const biomes = mountBiomeReview(art, scene);
  let selected = PROPS[0]!.id;
  let previewFrame = -1,
    previewDir = -1,
    previewMode = '';
  const preview = canvas(48, 72);
  el('avatar-preview').append(preview);
  const pctx = preview.getContext('2d')!;
  pctx.imageSmoothingEnabled = false;
  function copyCanvas(source: HTMLCanvasElement, name: string): HTMLCanvasElement {
    const out = canvas(source.width, source.height);
    out.getContext('2d')!.drawImage(source, 0, 0);
    out.setAttribute('role', 'img');
    out.setAttribute('aria-label', name);
    return out;
  }
  function selectProp(id: string): void {
    if (REVIEW_CROPS.some((c) => c.id === id)) {
      showCrops();
      el('crop-preview').scrollIntoView({ block: 'nearest' });
      return;
    }
    const prop = PROPS.find((p) => p.id === id);
    if (!prop) return;
    selected = id;
    const growth =
      scene.mode === 'new' && scene.treeStage < 3
        ? art.growth.get(id)?.[scene.treeStage]
        : undefined;
    el('object-preview').replaceChildren(
      copyCanvas(
        id === 'bed' && scene.mode === 'new'
          ? art.beds[scene.bedAxis]
          : (growth ?? art.props[scene.mode].get(id)!),
        prop.label,
      ),
    );
    el('object-title').textContent = prop.label;
    el('object-id').textContent = prop.id;
    el('object-index').textContent = `${String(PROPS.indexOf(prop) + 1).padStart(2, '0')} of 16`;
    document.querySelectorAll<HTMLButtonElement>('.object-strip button').forEach((b) => {
      const active = b.dataset.id === id;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  }
  PROPS.forEach((prop) => {
    const b = document.createElement('button');
    b.dataset.id = prop.id;
    b.title = prop.label;
    b.setAttribute('aria-label', prop.label);
    b.setAttribute('aria-pressed', 'false');
    b.append(copyCanvas(art.props.new.get(prop.id)!, prop.label));
    b.onclick = () => selectProp(prop.id);
    document.querySelector('.object-strip')!.append(b);
    const g = document.createElement('button');
    g.className = 'gallery-item';
    g.append(copyCanvas(art.props.new.get(prop.id)!, prop.label));
    const label = document.createElement('strong');
    label.textContent = prop.label;
    g.append(label);
    const code = document.createElement('code');
    code.textContent = prop.id;
    g.append(code);
    g.onclick = () => {
      selectProp(prop.id);
      el<HTMLDialogElement>('sprite-gallery').close();
    };
    el('gallery-props').append(g);
  });
  ICONS.forEach((icon, i) => {
    const b = document.createElement('button');
    b.className = `inventory-slot ${i === 0 ? 'selected' : ''}`;
    b.setAttribute('aria-label', icon.label);
    b.setAttribute('aria-pressed', String(i === 0));
    b.title = icon.label;
    const key = document.createElement('span');
    key.className = 'slot-key';
    key.textContent = String(i + 1);
    b.append(key, copyCanvas(art.icons[i]!, icon.label));
    b.onclick = () => {
      document.querySelectorAll('.inventory-slot').forEach((s) => {
        s.classList.remove('selected');
        s.setAttribute('aria-pressed', 'false');
      });
      b.classList.add('selected');
      b.setAttribute('aria-pressed', 'true');
      el('item-status').textContent = `${b.title} · Inventory artwork preview`;
    };
    document.querySelector('.hotbar')!.append(b);
    const g = document.createElement('div');
    g.className = 'gallery-item';
    g.append(copyCanvas(art.icons[i]!, icon.label));
    const label = document.createElement('strong');
    label.textContent = icon.label;
    g.append(label);
    el('gallery-icons').append(g);
  });
  selectProp(selected);
  function showCrops(): void {
    el('crop-preview').replaceChildren(
      ...art.crops
        .get(scene.cropSpecies)!
        .map((source, i) => copyCanvas(source, `${scene.cropSpecies} growth stage ${i + 1}`)),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-crop]').forEach((button) => {
      const active = button.dataset.crop === scene.cropSpecies;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const crop = REVIEW_CROPS.find((c) => c.id === scene.cropSpecies)!;
    const slots = document.querySelectorAll<HTMLButtonElement>('.inventory-slot');
    for (const [index, source, label] of [
      [4, art.seeds.get(crop.id)!, `${crop.label} seeds`],
      [5, art.harvest.get(crop.id)!, crop.label],
    ] as const) {
      const slot = slots[index]!;
      slot.querySelector('canvas')!.replaceWith(copyCanvas(source, label));
      slot.title = label;
      slot.setAttribute('aria-label', label);
      if (slot.classList.contains('selected'))
        el('item-status').textContent = `${label} · Inventory artwork preview`;
    }
    const motion = {
      leaf: 'Leaves flutter while the root stays planted.',
      broad: 'Broad leaves rustle in the breeze.',
      vine: 'Flexible stems sway; fruit and blossoms follow.',
      grass: 'Slender blades ripple in the breeze.',
      flower: 'Flower heads nod gently above rooted stems.',
    };
    el('crop-caption').textContent =
      `${crop.label} · ${scene.cropStage < 0 ? 'Five growth stages' : CROP_STAGES[scene.cropStage]}. ${motion[crop.motion]} Soil builds around the roots as they grow.`;
    collection?.sync();
  }
  showCrops();
  el<HTMLSelectElement>('crop-growth').onchange = (event) => {
    scene.setCropStage(Number((event.target as HTMLSelectElement).value));
    showCrops();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-crop]').forEach((button) => {
    button.onclick = () => {
      scene.setCropSpecies(button.dataset.crop as ReviewCrop);
      showCrops();
    };
  });
  el('water-crops').onclick = () => {
    scene.waterCrops();
    el('crop-caption').textContent = scene.ambience
      ? 'Freshly watered. Leaves settle and the soil slowly dries.'
      : 'Freshly watered. Play wildlife to see the watering animation.';
  };
  const syncAmbience = () => {
    el('ambience').textContent = scene.ambience ? 'Pause wildlife' : 'Play wildlife';
    el('ambience').setAttribute('aria-pressed', String(scene.ambience));
  };
  syncAmbience();
  el('ambience').onclick = () => {
    scene.ambience = !scene.ambience;
    syncAmbience();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-bed]').forEach(
    (b) =>
      (b.onclick = () => {
        scene.setBedAxis(b.dataset.bed as 'vertical' | 'horizontal');
        document.querySelectorAll<HTMLButtonElement>('[data-bed]').forEach((button) => {
          const active = button.dataset.bed === scene.bedAxis;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        });
        selectProp('bed');
      }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((b) => {
    b.onclick = () => {
      scene.setTreeStage(Number(b.dataset.stage));
      collection?.sync();
      document.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((button) => {
        const active = Number(button.dataset.stage) === scene.treeStage;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      selectProp(selected);
    };
  });
  for (const mode of ['new', 'old'] as const)
    el(`${mode}-art`).onclick = () => {
      scene.setMode(mode);
      selectProp(selected);
      for (const m of ['new', 'old']) {
        const button = el(`${m}-art`);
        button.classList.toggle('active', m === mode);
        button.setAttribute('aria-pressed', String(m === mode));
      }
      mount.dataset.mode = mode;
    };
  el('light').onclick = () => {
    scene.setDusk(!scene.dusk);
    el('light').textContent = scene.dusk ? 'Dusk' : 'Daylight';
    el('light').setAttribute('aria-pressed', String(scene.dusk));
    el('scene-time').textContent = scene.dusk ? '6:40 PM' : '10:30 AM';
    el('scene-weather').textContent = scene.dusk
      ? 'The evening settles in'
      : 'A quiet, sunny morning';
  };
  el('grid').onclick = () => {
    scene.setGrid(!scene.grid);
    el('grid').setAttribute('aria-pressed', String(scene.grid));
  };
  const syncAnimation = () => {
    el('animate').textContent = scene.walking ? 'Pause' : 'Play';
    el('animate').setAttribute('aria-pressed', String(scene.walking));
  };
  syncAnimation();
  el('animate').onclick = () => {
    scene.walking = !scene.walking;
    syncAnimation();
  };
  el<HTMLInputElement>('zoom').oninput = (e) => {
    const value = Number((e.target as HTMLInputElement).value);
    scene.zoom = value / 100;
    scene.resize();
    el('zoom-value').textContent = `${value}%`;
  };
  document.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach(
    (b) =>
      (b.onclick = () => {
        scene.direction = Number(b.dataset.dir);
      }),
  );
  const gallery = el<HTMLDialogElement>('sprite-gallery');
  el('gallery-open').onclick = () => gallery.showModal();
  el('gallery-close').onclick = () => gallery.close();
  gallery.addEventListener('click', (e) => {
    if (e.target === gallery) {
      const r = gallery.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        gallery.close();
    }
  });
  let raf = 0;
  function updatePreview(): void {
    if (
      previewFrame !== scene.frame ||
      previewDir !== scene.direction ||
      previewMode !== scene.mode
    ) {
      previewFrame = scene.frame;
      previewDir = scene.direction;
      previewMode = scene.mode;
      pctx.clearRect(0, 0, preview.width, preview.height);
      pctx.drawImage(
        art.avatars[scene.mode][scene.direction]![scene.frame]!,
        0,
        0,
        preview.width,
        preview.height,
      );
      document.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((b) => {
        const on = Number(b.dataset.dir) === scene.direction;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }
    raf = requestAnimationFrame(updatePreview);
  }
  updatePreview();
  (window as unknown as Record<string, unknown>).__artReview = {
    snapshot: () => scene.snapshot(),
    seekAmbience: (time: number) => {
      scene.seekAmbience(time);
      syncAmbience();
    },
    depthProbe: (id: string) => scene.depthProbe(id),
    // Review-only positioning for repeatable visual occlusion checks.
    pose: (x: number, z: number) => {
      scene.px = x;
      scene.pz = z;
      scene.walking = false;
      scene.direction = 0;
    },
    ready: true,
  };
  window.addEventListener(
    'pagehide',
    () => {
      cancelAnimationFrame(raf);
      scene.dispose();
      collection?.dispose();
      biomes.dispose();
    },
    { once: true },
  );
  if (import.meta.hot)
    import.meta.hot.dispose(() => {
      cancelAnimationFrame(raf);
      scene.dispose();
      collection?.dispose();
      biomes.dispose();
    });
}

start().catch((error: unknown) => {
  console.error(error);
  mount.textContent = 'The art preview could not load. Refresh to try again.';
});
