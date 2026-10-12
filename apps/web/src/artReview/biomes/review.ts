import './review.css';
import { canvas, type ReviewArt } from '../art';
import type { ReviewScene } from '../scene';
import { BIOME_DEFINITIONS, loadBiomeArt } from './catalog';
import { BiomeScene } from './scene';
import type { BiomeArt } from './types';

export function mountBiomeReview(sharedArt: ReviewArt, studio: ReviewScene): { dispose(): void } {
  const root = document.querySelector<HTMLElement>('#review')!;
  const workspace = root.querySelector<HTMLElement>('.workspace')!;
  const wrap = workspace.querySelector<HTMLElement>('.scene-wrap')!;
  const studioInspector = root.querySelector<HTMLElement>('.inspector')!;
  studioInspector.classList.add('studio-inspector');
  const nav = document.createElement('nav');
  nav.className = 'biome-navigation';
  nav.setAttribute('aria-label', 'Art review worlds');
  nav.innerHTML = `<label for="biome-select"><span class="eyebrow">EXPLORE AGORA</span><select id="biome-select"><option value="studio">Studio</option>${BIOME_DEFINITIONS.map((b) => `<option value="${b.id}">${b.label}</option>`).join('')}</select></label><span class="biome-nav-note">Four familiar worlds, a little more alive.</span>`;
  workspace.prepend(nav);
  const select = nav.querySelector<HTMLSelectElement>('select')!;
  const stage = document.createElement('div');
  stage.id = 'biome-stage';
  stage.hidden = true;
  stage.setAttribute('aria-label', 'Biome scene preview');
  wrap.append(stage);
  const caption = document.createElement('div');
  caption.className = 'biome-scene-caption';
  caption.hidden = true;
  caption.innerHTML =
    '<span class="eyebrow">AGORA / BIOMES</span><strong></strong><span>Click an animal to meet it.</span>';
  wrap.append(caption);
  const inspector = document.createElement('aside');
  inspector.className = 'inspector biome-inspector';
  inspector.hidden = true;
  inspector.innerHTML = `<div class="inspector-heading"><span class="eyebrow">A LIVING WORLD</span><h1 id="biome-title">Explore a biome.</h1><p id="biome-description"></p></div>
    <section class="biome-creatures"><div class="section-label">01 / ANIMALS</div><label class="biome-field" for="biome-animal-select">Meet an animal<select id="biome-animal-select"></select></label><div id="biome-animal-preview" class="object-preview"></div><div class="biome-animal-caption"><strong id="biome-animal-name"></strong><span id="biome-animal-kind" class="small-tag"></span></div><p id="biome-animal-behavior"></p><div class="biome-actions"><button id="biome-feed">Offer food</button><button id="biome-pet">Gentle pat</button></div><p id="biome-feedback" role="status" aria-live="polite">Choose an animal to get acquainted.</p><button id="biome-retry" hidden>Retry loading</button></section>
    <section class="biome-atmosphere"><div class="section-label">02 / ATMOSPHERE</div><div class="biome-actions"><button id="biome-pause" aria-pressed="false">Pause wildlife</button><button id="biome-dusk" aria-pressed="false">Daylight</button></div></section>
    <section class="biome-materials"><div class="section-label">03 / GROUND & WATER</div><div id="biome-swatches"></div></section>
    <section class="biome-objects"><div class="section-label">04 / PLANTS & OBJECTS</div><div id="biome-props"></div></section><div class="review-note"><span class="eyebrow">A PLACE TO BELONG</span><p>Rooted plants, layered water and animals at home in their surroundings. Feed or greet a visitor and watch its response.</p></div>`;
  studioInspector.after(inspector);
  const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
    inspector.querySelector<T>(`#${id}`)!;
  const animalSelect = el<HTMLSelectElement>('biome-animal-select');
  const feedback = el('biome-feedback');
  const preview = canvas(128, 128);
  preview.setAttribute('role', 'img');
  el('biome-animal-preview').append(preview);
  const context = preview.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  let active: BiomeScene | undefined;
  let art: BiomeArt | undefined;
  let current = 'studio';
  let request = 0;
  let disposed = false;
  let raf = 0;
  let renderedFrame = '';

  function controlsEnabled(enabled: boolean): void {
    for (const id of [
      'biome-animal-select',
      'biome-feed',
      'biome-pet',
      'biome-pause',
      'biome-dusk',
    ])
      el<HTMLButtonElement | HTMLSelectElement>(id).disabled = !enabled;
  }
  function showAnimal(index: number): void {
    if (!art) return;
    const animal = art.definition.animals[index];
    if (!animal) return;
    animalSelect.value = String(index);
    el('biome-animal-name').textContent = animal.label;
    el('biome-animal-kind').textContent = animal.kind === 'farm' ? 'Farm animal' : 'Wildlife';
    el('biome-animal-behavior').textContent = animal.behavior;
    preview.setAttribute('aria-label', animal.label);
    renderedFrame = '';
    drawPreview();
  }
  function drawPreview(): void {
    if (!active || !art) return;
    const index = active.selected;
    const state = active.snapshot() as { animals: { frame: number }[] };
    const frame = state.animals[index]?.frame ?? 0;
    const key = `${index}:${frame}`;
    if (renderedFrame === key) return;
    const source = art.animals[index]?.[frame];
    if (!source) return;
    renderedFrame = key;
    context.clearRect(0, 0, 128, 128);
    context.drawImage(source, 0, 0, 128, 128);
  }
  function syncControls(): void {
    if (!active) return;
    el('biome-pause').textContent = active.paused ? 'Play wildlife' : 'Pause wildlife';
    el('biome-pause').setAttribute('aria-pressed', String(active.paused));
    el('biome-dusk').textContent = active.dusk ? 'Dusk' : 'Daylight';
    el('biome-dusk').setAttribute('aria-pressed', String(active.dusk));
    caption.classList.toggle('is-dusk', active.dusk);
  }
  function renderCollection(loaded: BiomeArt): void {
    const definition = loaded.definition;
    el('biome-title').textContent = definition.label;
    el('biome-description').textContent = definition.description;
    caption.querySelector('strong')!.textContent = definition.label;
    caption.querySelector('.eyebrow')!.textContent = `AGORA / ${definition.id.toUpperCase()}`;
    animalSelect.replaceChildren(
      ...definition.animals.map((animal, index) => new Option(animal.label, String(index))),
    );
    el('biome-props').replaceChildren(
      ...definition.props.map((prop, index) => {
        const figure = document.createElement('figure');
        const source = loaded.props[index]!;
        const thumb = canvas(source.width, source.height);
        thumb.getContext('2d')!.drawImage(source, 0, 0);
        thumb.setAttribute('role', 'img');
        thumb.setAttribute('aria-label', prop.label);
        const label = document.createElement('figcaption');
        label.textContent = prop.label;
        const id = document.createElement('code');
        id.textContent = prop.id;
        figure.append(thumb, label, id);
        return figure;
      }),
    );
    el('biome-swatches').replaceChildren(
      ...Object.entries(definition.colors).map(([id, color]) => {
        const swatch = document.createElement('div');
        const chip = document.createElement('span');
        chip.style.backgroundColor = color;
        const label = document.createElement('code');
        label.textContent = id;
        const hex = document.createElement('small');
        hex.textContent = color;
        swatch.append(chip, label, hex);
        return swatch;
      }),
    );
  }
  async function selectBiome(id: string): Promise<void> {
    if (disposed) return;
    if (id !== 'studio' && !BIOME_DEFINITIONS.some((b) => b.id === id))
      throw new Error(`Unknown review biome: ${id}`);
    const token = ++request;
    current = id;
    select.value = id;
    active?.setActive(false);
    active?.dispose();
    active = undefined;
    art = undefined;
    stage.replaceChildren();
    const isStudio = id === 'studio';
    root.dataset.biomeView = String(!isStudio);
    stage.hidden = isStudio;
    caption.hidden = isStudio;
    inspector.hidden = isStudio;
    studio.setActive(isStudio);
    if (isStudio) {
      studio.resize();
      return;
    }
    controlsEnabled(false);
    el('biome-retry').hidden = true;
    el('biome-title').textContent = BIOME_DEFINITIONS.find((b) => b.id === id)!.label;
    el('biome-description').textContent = 'Getting this little world ready…';
    caption.querySelector('strong')!.textContent = el('biome-title').textContent;
    feedback.textContent = 'Loading the scene and its inhabitants…';
    stage.setAttribute('aria-busy', 'true');
    try {
      const loaded = await loadBiomeArt(id);
      if (disposed || token !== request) return;
      art = loaded;
      renderCollection(loaded);
      active = new BiomeScene(stage, loaded, sharedArt, showAnimal);
      active.setActive(true);
      controlsEnabled(true);
      showAnimal(0);
      syncControls();
      feedback.textContent = 'Choose an animal, then offer food or a gentle pat.';
    } catch (error) {
      if (disposed || token !== request) return;
      active?.dispose();
      active = undefined;
      stage.replaceChildren();
      feedback.textContent = 'This biome could not load. Retry, or choose another world above.';
      el('biome-description').textContent = 'The scene is temporarily unavailable.';
      el('biome-retry').hidden = false;
      console.error('Biome review could not load', error);
    } finally {
      if (token === request) stage.removeAttribute('aria-busy');
    }
  }
  select.onchange = () => {
    void selectBiome(select.value);
  };
  animalSelect.onchange = () => {
    active?.selectAnimal(Number(animalSelect.value));
    showAnimal(Number(animalSelect.value));
    feedback.textContent = 'Offer food or a gentle pat to see how this animal responds.';
  };
  for (const action of ['feed', 'pet'] as const)
    el(`biome-${action}`).onclick = () => {
      if (active) feedback.textContent = active.interact(action);
      drawPreview();
    };
  el('biome-pause').onclick = () => {
    if (active) active.setPaused(!active.paused);
    syncControls();
  };
  el('biome-dusk').onclick = () => {
    if (active) active.setDusk(!active.dusk);
    syncControls();
  };
  el('biome-retry').onclick = () => {
    void selectBiome(current);
  };
  function update(): void {
    drawPreview();
    raf = requestAnimationFrame(update);
  }
  update();
  const hook = {
    ready: true,
    snapshot: () => active?.snapshot() ?? { biome: current, loading: current !== 'studio' },
    select: selectBiome,
    seek: (time: number) => {
      active?.seek(time);
      drawPreview();
      syncControls();
    },
  };
  const global = window as unknown as Record<string, unknown>;
  global.__biomeReview = hook;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      ++request;
      cancelAnimationFrame(raf);
      active?.dispose();
      if (global.__biomeReview === hook) delete global.__biomeReview;
      delete root.dataset.biomeView;
      studioInspector.classList.remove('studio-inspector');
      nav.remove();
      stage.remove();
      caption.remove();
      inspector.remove();
    },
  };
}
